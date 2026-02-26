use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use solana_program::pubkey::Pubkey;

use crate::resolution::constants::SRS_DEFAULT_PROGRAM_ID;
use crate::resolution::errors::{ResolutionError, ResolutionResult};
use crate::resolution::forward_resolver::{DomaForwardResolver, DomaForwardResolverConfig};
use crate::resolution::namehash::namehash;
use crate::resolution::pda::{find_record_pda, reverse_record_seed};
use crate::resolution::provider::RawRecordAccountProvider;
use crate::resolution::record_decoder::decode_srs_record;
use crate::resolution::resolver::{DomaSrsResolver, DomaSrsResolverConfig};
use crate::resolution::reverse_resolver::{SrsReverseResolver, SrsReverseResolverConfig};
use crate::resolution::tuple_codec::{parse_resolution_tuples, serialize_resolution_tuples};

#[derive(Default)]
struct InMemoryRecordProvider {
    records: Mutex<HashMap<String, Vec<u8>>>,
}

impl InMemoryRecordProvider {
    fn put(&self, record_pda: Pubkey, data: Vec<u8>) {
        self.records
            .lock()
            .expect("in-memory provider lock poisoned")
            .insert(record_pda.to_string(), data);
    }
}

impl RawRecordAccountProvider for InMemoryRecordProvider {
    fn fetch_raw_record_account(&self, record_pda: &Pubkey) -> ResolutionResult<Option<Vec<u8>>> {
        Ok(self
            .records
            .lock()
            .expect("in-memory provider lock poisoned")
            .get(&record_pda.to_string())
            .cloned())
    }
}

#[derive(Clone, Copy)]
struct BuildSrsRecordOptions<'a> {
    class_address: Pubkey,
    owner_address: Pubkey,
    seed: &'a [u8],
    data: &'a [u8],
    owner_type: u8,
    is_frozen: bool,
    expiry: i64,
}

fn deterministic_public_key(seed_byte: u8) -> Pubkey {
    Pubkey::new_from_array([seed_byte; 32])
}

fn build_srs_record_account_data(options: BuildSrsRecordOptions<'_>) -> Vec<u8> {
    assert!(
        options.seed.len() <= u8::MAX as usize,
        "seed must fit into u8"
    );

    let fixed_length = 1 + 32 + 1 + 32 + 1 + 8 + 1;
    let mut out = Vec::with_capacity(fixed_length + options.seed.len() + options.data.len());

    out.push(2);
    out.extend_from_slice(options.class_address.as_ref());
    out.push(options.owner_type);
    out.extend_from_slice(options.owner_address.as_ref());
    out.push(if options.is_frozen { 1 } else { 0 });
    out.extend_from_slice(&options.expiry.to_le_bytes());

    out.push(options.seed.len() as u8);
    out.extend_from_slice(options.seed);
    out.extend_from_slice(options.data);

    out
}

#[test]
fn serializes_and_parses_resolution_tuples() {
    let tuples = vec![
        (
            "WALLET:solana:mainnet".to_string(),
            deterministic_public_key(88).to_string(),
        ),
        ("NAME".to_string(), "alice.sol".to_string()),
    ];

    let encoded = serialize_resolution_tuples(&tuples).expect("serialize tuples");
    let decoded = parse_resolution_tuples(&encoded).expect("parse tuples");

    assert_eq!(decoded, tuples);
}

#[test]
fn emits_utf8_payload_compatible_with_current_srs_record_data() {
    let tuples = vec![
        (
            "WALLET".to_string(),
            deterministic_public_key(89).to_string(),
        ),
        ("NAME".to_string(), "alice.sol".to_string()),
    ];

    let encoded = serialize_resolution_tuples(&tuples).expect("serialize tuples");
    let decoded_utf8 = String::from_utf8(encoded.clone()).expect("tuple payload should be utf-8");

    assert!(!decoded_utf8.is_empty());
    assert_eq!(
        parse_resolution_tuples(&encoded).expect("parse tuples"),
        tuples
    );
}

#[test]
fn decodes_srs_account_data_and_extracts_tuple_payload() {
    let class_address = deterministic_public_key(20);
    let owner_address = deterministic_public_key(21);
    let seed = namehash("alice.sol").expect("namehash");
    let tuples = serialize_resolution_tuples(&[("NAME".to_string(), "alice.sol".to_string())])
        .expect("serialize tuples");

    let raw_record = build_srs_record_account_data(BuildSrsRecordOptions {
        class_address,
        owner_address,
        seed: &seed,
        data: &tuples,
        owner_type: 0,
        is_frozen: false,
        expiry: 123,
    });

    let decoded = decode_srs_record(&raw_record).expect("decode record");
    assert_eq!(decoded.class, class_address);
    assert_eq!(decoded.owner, owner_address);
    assert_eq!(decoded.expiry, 123);
    assert_eq!(
        parse_resolution_tuples(&decoded.data).expect("parse tuples"),
        vec![("NAME".to_string(), "alice.sol".to_string())]
    );
}

#[test]
fn resolves_forward_records_with_chain_aware_last_write_wins() {
    let doma_class_address = deterministic_public_key(30);
    let owner_address = deterministic_public_key(32);
    let latest_wallet = deterministic_public_key(33).to_string();

    let provider = Arc::new(InMemoryRecordProvider::default());
    let resolver = DomaForwardResolver::new(DomaForwardResolverConfig {
        provider: provider.clone(),
        doma_class_address,
        program_id: None,
        default_chain_caip2: Some("solana:mainnet".to_string()),
    })
    .expect("create forward resolver");

    let seed = namehash("alice.sol").expect("namehash");
    let (record_pda, _) =
        find_record_pda(&doma_class_address, &seed, &SRS_DEFAULT_PROGRAM_ID).expect("find pda");

    provider.put(
        record_pda,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: doma_class_address,
            owner_address,
            seed: &seed,
            data: &serialize_resolution_tuples(&[
                (
                    "WALLET:solana:mainnet".to_string(),
                    deterministic_public_key(34).to_string(),
                ),
                ("WALLET:eip155:1".to_string(), "0x123".to_string()),
                ("WALLET".to_string(), latest_wallet.clone()),
            ])
            .expect("serialize tuples"),
            owner_type: 0,
            is_frozen: false,
            expiry: 0,
        }),
    );

    let resolved = resolver
        .resolve("alice.sol", None)
        .expect("resolve forward record");
    assert_eq!(resolved, Some(latest_wallet));
}

#[test]
fn resolves_token_owned_forward_records_and_supports_did_pkh_wallet_values() {
    let doma_class_address = deterministic_public_key(35);
    let token_owner_address = deterministic_public_key(37);
    let wallet = deterministic_public_key(38).to_string();

    let provider = Arc::new(InMemoryRecordProvider::default());
    let resolver = DomaForwardResolver::new(DomaForwardResolverConfig {
        provider: provider.clone(),
        doma_class_address,
        program_id: None,
        default_chain_caip2: Some("solana:mainnet".to_string()),
    })
    .expect("create forward resolver");

    let seed = namehash("tokenized.sol").expect("namehash");
    let (record_pda, _) =
        find_record_pda(&doma_class_address, &seed, &SRS_DEFAULT_PROGRAM_ID).expect("find pda");

    provider.put(
        record_pda,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: doma_class_address,
            owner_address: token_owner_address,
            seed: &seed,
            data: &serialize_resolution_tuples(&[(
                "WALLET".to_string(),
                format!("did:pkh:solana:mainnet:{wallet}"),
            )])
            .expect("serialize tuples"),
            owner_type: 1,
            is_frozen: false,
            expiry: 0,
        }),
    );

    let resolved = resolver
        .resolve("tokenized.sol", None)
        .expect("resolve forward record");
    assert_eq!(resolved, Some(wallet));
}

#[test]
fn supports_caip10_wallet_values() {
    let doma_class_address = deterministic_public_key(45);
    let owner_address = deterministic_public_key(46);
    let wallet = deterministic_public_key(47).to_string();

    let provider = Arc::new(InMemoryRecordProvider::default());
    let resolver = DomaForwardResolver::new(DomaForwardResolverConfig {
        provider: provider.clone(),
        doma_class_address,
        program_id: None,
        default_chain_caip2: Some("solana:mainnet".to_string()),
    })
    .expect("create forward resolver");

    let seed = namehash("caip10.sol").expect("namehash");
    let (record_pda, _) =
        find_record_pda(&doma_class_address, &seed, &SRS_DEFAULT_PROGRAM_ID).expect("find pda");

    provider.put(
        record_pda,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: doma_class_address,
            owner_address,
            seed: &seed,
            data: &serialize_resolution_tuples(&[(
                "WALLET".to_string(),
                format!("solana:mainnet:{wallet}"),
            )])
            .expect("serialize tuples"),
            owner_type: 0,
            is_frozen: false,
            expiry: 0,
        }),
    );

    let resolved = resolver
        .resolve("caip10.sol", None)
        .expect("resolve forward record");
    assert_eq!(resolved, Some(wallet));
}

#[test]
fn requires_forward_verifier_when_verification_is_enabled_by_default() {
    let provider = Arc::new(InMemoryRecordProvider::default());

    let result = SrsReverseResolver::new(SrsReverseResolverConfig {
        provider,
        reverse_class_address: deterministic_public_key(90),
        program_id: None,
        default_chain_caip2: None,
        verify_reverse_with_forward: None,
        forward_verifier: None,
    });

    assert!(
        matches!(
            result,
            Err(ResolutionError::Input(message))
                if message
                    == "forward_verifier is required when verify_reverse_with_forward is enabled"
        ),
        "expected missing forward_verifier validation error"
    );
}

#[test]
fn reverse_resolves_name_only_when_forward_mapping_matches() {
    let doma_class_address = deterministic_public_key(40);
    let reverse_class_address = deterministic_public_key(41);
    let owner_address = deterministic_public_key(42);
    let wallet = deterministic_public_key(43).to_string();
    let name = "alice.sol";

    let provider = Arc::new(InMemoryRecordProvider::default());
    let forward_resolver = Arc::new(
        DomaForwardResolver::new(DomaForwardResolverConfig {
            provider: provider.clone(),
            doma_class_address,
            program_id: None,
            default_chain_caip2: None,
        })
        .expect("create forward resolver"),
    );
    let reverse_resolver = SrsReverseResolver::new(SrsReverseResolverConfig {
        provider: provider.clone(),
        reverse_class_address,
        program_id: None,
        default_chain_caip2: None,
        verify_reverse_with_forward: Some(true),
        forward_verifier: Some(forward_resolver),
    })
    .expect("create reverse resolver");

    let forward_seed = namehash(name).expect("namehash");
    let (forward_pda, _) =
        find_record_pda(&doma_class_address, &forward_seed, &SRS_DEFAULT_PROGRAM_ID)
            .expect("find pda");
    provider.put(
        forward_pda,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: doma_class_address,
            owner_address,
            seed: &forward_seed,
            data: &serialize_resolution_tuples(&[("WALLET".to_string(), wallet.clone())])
                .expect("serialize tuples"),
            owner_type: 0,
            is_frozen: false,
            expiry: 0,
        }),
    );

    let reverse_seed = reverse_record_seed(&wallet).expect("reverse seed");
    let (reverse_pda, _) = find_record_pda(
        &reverse_class_address,
        &reverse_seed,
        &SRS_DEFAULT_PROGRAM_ID,
    )
    .expect("find pda");
    provider.put(
        reverse_pda,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: reverse_class_address,
            owner_address,
            seed: &reverse_seed,
            data: &serialize_resolution_tuples(&[("NAME".to_string(), "ALICE.sol".to_string())])
                .expect("serialize tuples"),
            owner_type: 0,
            is_frozen: false,
            expiry: 0,
        }),
    );

    let reverse = reverse_resolver
        .reverse_resolve(&wallet)
        .expect("reverse resolve");
    assert_eq!(reverse, Some(name.to_string()));
}

#[test]
fn returns_none_for_reverse_mapping_mismatch() {
    let doma_class_address = deterministic_public_key(50);
    let reverse_class_address = deterministic_public_key(51);
    let owner_address = deterministic_public_key(52);
    let wallet = deterministic_public_key(53).to_string();

    let provider = Arc::new(InMemoryRecordProvider::default());
    let forward_resolver = Arc::new(
        DomaForwardResolver::new(DomaForwardResolverConfig {
            provider: provider.clone(),
            doma_class_address,
            program_id: None,
            default_chain_caip2: None,
        })
        .expect("create forward resolver"),
    );
    let reverse_resolver = SrsReverseResolver::new(SrsReverseResolverConfig {
        provider: provider.clone(),
        reverse_class_address,
        program_id: None,
        default_chain_caip2: None,
        verify_reverse_with_forward: Some(true),
        forward_verifier: Some(forward_resolver),
    })
    .expect("create reverse resolver");

    let forward_seed = namehash("alice.sol").expect("namehash");
    let (forward_pda, _) =
        find_record_pda(&doma_class_address, &forward_seed, &SRS_DEFAULT_PROGRAM_ID)
            .expect("find pda");
    provider.put(
        forward_pda,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: doma_class_address,
            owner_address,
            seed: &forward_seed,
            data: &serialize_resolution_tuples(&[(
                "WALLET".to_string(),
                deterministic_public_key(54).to_string(),
            )])
            .expect("serialize tuples"),
            owner_type: 0,
            is_frozen: false,
            expiry: 0,
        }),
    );

    let reverse_seed = reverse_record_seed(&wallet).expect("reverse seed");
    let (reverse_pda, _) = find_record_pda(
        &reverse_class_address,
        &reverse_seed,
        &SRS_DEFAULT_PROGRAM_ID,
    )
    .expect("find pda");
    provider.put(
        reverse_pda,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: reverse_class_address,
            owner_address,
            seed: &reverse_seed,
            data: &serialize_resolution_tuples(&[("NAME".to_string(), "alice.sol".to_string())])
                .expect("serialize tuples"),
            owner_type: 0,
            is_frozen: false,
            expiry: 0,
        }),
    );

    let reverse = reverse_resolver
        .reverse_resolve(&wallet)
        .expect("reverse resolve");
    assert_eq!(reverse, None);
}

#[test]
fn batch_reverse_resolves_wallets_in_order() {
    let reverse_class_address = deterministic_public_key(61);
    let owner_address = deterministic_public_key(62);

    let wallet_a = deterministic_public_key(63).to_string();
    let wallet_b = deterministic_public_key(64).to_string();

    let provider = Arc::new(InMemoryRecordProvider::default());
    let reverse_resolver = SrsReverseResolver::new(SrsReverseResolverConfig {
        provider: provider.clone(),
        reverse_class_address,
        program_id: None,
        default_chain_caip2: None,
        verify_reverse_with_forward: Some(false),
        forward_verifier: None,
    })
    .expect("create reverse resolver");

    let reverse_seed_a = reverse_record_seed(&wallet_a).expect("reverse seed");
    let reverse_seed_b = reverse_record_seed(&wallet_b).expect("reverse seed");
    let (reverse_pda_a, _) = find_record_pda(
        &reverse_class_address,
        &reverse_seed_a,
        &SRS_DEFAULT_PROGRAM_ID,
    )
    .expect("find pda");
    let (reverse_pda_b, _) = find_record_pda(
        &reverse_class_address,
        &reverse_seed_b,
        &SRS_DEFAULT_PROGRAM_ID,
    )
    .expect("find pda");

    provider.put(
        reverse_pda_a,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: reverse_class_address,
            owner_address,
            seed: &reverse_seed_a,
            data: &serialize_resolution_tuples(&[("NAME".to_string(), "alice.sol".to_string())])
                .expect("serialize tuples"),
            owner_type: 0,
            is_frozen: false,
            expiry: 0,
        }),
    );

    provider.put(
        reverse_pda_b,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: reverse_class_address,
            owner_address,
            seed: &reverse_seed_b,
            data: &serialize_resolution_tuples(&[("NAME".to_string(), "bob.sol".to_string())])
                .expect("serialize tuples"),
            owner_type: 0,
            is_frozen: false,
            expiry: 0,
        }),
    );

    let results = reverse_resolver
        .batch_reverse_resolve(&[wallet_a.clone(), wallet_b.clone()])
        .expect("batch reverse resolve");
    assert_eq!(
        results,
        vec![Some("alice.sol".to_string()), Some("bob.sol".to_string())]
    );
}

#[test]
fn reverse_resolves_from_standalone_reverse_class_without_forward_dependency_when_verification_disabled(
) {
    let reverse_class_address = deterministic_public_key(71);
    let owner_address = deterministic_public_key(72);
    let wallet = deterministic_public_key(73).to_string();

    let provider = Arc::new(InMemoryRecordProvider::default());
    let reverse_resolver = SrsReverseResolver::new(SrsReverseResolverConfig {
        provider: provider.clone(),
        reverse_class_address,
        program_id: None,
        default_chain_caip2: None,
        verify_reverse_with_forward: Some(false),
        forward_verifier: None,
    })
    .expect("create reverse resolver");

    let seed = reverse_record_seed(&wallet).expect("reverse seed");
    let (reverse_pda, _) =
        find_record_pda(&reverse_class_address, &seed, &SRS_DEFAULT_PROGRAM_ID).expect("find pda");

    provider.put(
        reverse_pda,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: reverse_class_address,
            owner_address,
            seed: &seed,
            data: &serialize_resolution_tuples(&[(
                "NAME".to_string(),
                "standalone.sol".to_string(),
            )])
            .expect("serialize tuples"),
            owner_type: 0,
            is_frozen: false,
            expiry: 0,
        }),
    );

    let resolved = reverse_resolver
        .reverse_resolve(&wallet)
        .expect("reverse resolve");
    assert_eq!(resolved, Some("standalone.sol".to_string()));
}

#[test]
fn compatibility_facade_supports_legacy_forward_class_address_alias() {
    let forward_class_address = deterministic_public_key(101);
    let reverse_class_address = deterministic_public_key(102);
    let owner_address = deterministic_public_key(103);

    let provider = Arc::new(InMemoryRecordProvider::default());
    let resolver = DomaSrsResolver::new(DomaSrsResolverConfig {
        provider: provider.clone(),
        doma_class_address: None,
        forward_class_address: Some(forward_class_address),
        reverse_class_address,
        program_id: None,
        default_chain_caip2: None,
        verify_reverse_with_forward: Some(false),
    })
    .expect("create compatibility resolver");

    let seed = namehash("legacy.sol").expect("namehash");
    let (forward_pda, _) =
        find_record_pda(&forward_class_address, &seed, &SRS_DEFAULT_PROGRAM_ID).expect("find pda");

    provider.put(
        forward_pda,
        build_srs_record_account_data(BuildSrsRecordOptions {
            class_address: forward_class_address,
            owner_address,
            seed: &seed,
            data: &serialize_resolution_tuples(&[(
                "WALLET".to_string(),
                deterministic_public_key(104).to_string(),
            )])
            .expect("serialize tuples"),
            owner_type: 0,
            is_frozen: false,
            expiry: 0,
        }),
    );

    let resolved = resolver
        .resolve("legacy.sol", None)
        .expect("resolve forward via facade");
    assert_eq!(resolved, Some(deterministic_public_key(104).to_string()));
}
