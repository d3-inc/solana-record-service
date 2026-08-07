use solana_pubkey::Pubkey;

use super::errors::ResolutionError;
use super::shared::{
    deserialize_srs_mappings, find_record_pda, namehash, serialize_srs_mappings, SrsMapping,
    WALLET_MAPPING_TYPE,
};
#[cfg(feature = "fetch")]
use super::shared::validate_and_normalize_caip2;

/// Default CAIP-2 chain identifier for Solana.
/// Uses the wildcard namespace per CAIP-363.
pub const DEFAULT_SOLANA_CAIP2: &str = "solana:_";

/// A wallet address associated with a specific blockchain chain.
#[derive(borsh::BorshSerialize, borsh::BorshDeserialize, Debug, Clone, PartialEq)]
pub struct WalletMapping {
    /// CAIP-2 chain identifier, e.g. `"solana:_"`, `"eip155:1"`.
    pub chain_caip2: String,
    /// Chain-native address string.
    pub address: String,
}

/// Derives the on-chain PDA for a forward resolution record.
///
/// Seeds: `["record", class_address, keccak256_namehash(name)]`
///
/// # Errors
/// Returns [`ResolutionError::InvalidName`] if the name fails IDNA normalization.
pub fn find_name_record_pda(name: &str, class_address: &Pubkey) -> Result<Pubkey, ResolutionError> {
    let name_hash = namehash(name)?;
    let (pda, _) = find_record_pda(class_address, &name_hash);
    Ok(pda)
}

/// Serializes a slice of [`WalletMapping`] entries into an `SrsRecordData` blob.
pub fn serialize_wallet_mappings(mappings: &[WalletMapping]) -> Vec<u8> {
    use borsh::BorshSerialize;
    let srs: Vec<SrsMapping> = mappings
        .iter()
        .map(|m| {
            let mut data = Vec::new();
            m.serialize(&mut data).expect("WalletMapping Borsh serialization is infallible");
            SrsMapping { mapping_type: WALLET_MAPPING_TYPE, data }
        })
        .collect();
    serialize_srs_mappings(&srs)
}

/// Deserializes an `SrsRecordData` blob into [`WalletMapping`] entries.
/// Entries with unknown `mapping_type` values are silently ignored.
///
/// # Errors
/// Returns [`ResolutionError::DecodeError`] if the data is malformed.
pub fn deserialize_wallet_mappings(data: &[u8]) -> Result<Vec<WalletMapping>, ResolutionError> {
    use borsh::BorshDeserialize;
    deserialize_srs_mappings(data)?
        .into_iter()
        .filter(|m| m.mapping_type == WALLET_MAPPING_TYPE)
        .map(|m| {
            WalletMapping::deserialize(&mut m.data.as_slice())
                .map_err(|e| ResolutionError::DecodeError(e.to_string()))
        })
        .collect()
}

#[cfg(feature = "fetch")]
fn find_wallet_address(mappings: &[WalletMapping], chain_caip2: &str) -> Option<String> {
    mappings.iter().find(|m| m.chain_caip2 == chain_caip2).map(|m| m.address.clone())
}

// ── RPC-dependent functions ──────────────────────────────────────────────────

/// Resolves a domain name to a wallet address.
///
/// Fetches the forward record PDA for `name` under `class_address` and returns the address
/// for `chain_caip2` (default: `"solana:_"`), or `None` if no matching mapping exists.
///
/// # Errors
/// - [`ResolutionError::InvalidName`] if `name` is not a valid domain.
/// - [`ResolutionError::InvalidCaip2`] if `chain_caip2` is not a valid CAIP-2 identifier.
/// - [`ResolutionError::DecodeError`] if the on-chain record data is malformed.
/// - [`ResolutionError::RpcError`] on network failures.
#[cfg(feature = "fetch")]
pub fn resolve(
    rpc: &impl super::rpc::Rpc,
    name: &str,
    class_address: &Pubkey,
    chain_caip2: Option<&str>,
) -> Result<Option<String>, ResolutionError> {
    use crate::client::accounts::record::Record;

    let chain = validate_and_normalize_caip2(chain_caip2.unwrap_or(DEFAULT_SOLANA_CAIP2))?;
    let pda = find_name_record_pda(name, class_address)?;

    let Some(data) = rpc.get_account(&pda)? else {
        return Ok(None);
    };

    let record = Record::from_bytes(&data)
        .map_err(|e| ResolutionError::DecodeError(e.to_string()))?;

    let mappings = deserialize_wallet_mappings(&record.data)?;
    Ok(find_wallet_address(&mappings, &chain))
}

/// Resolves a batch of domain names to wallet addresses in a single RPC call.
///
/// Every input name appears in the returned map:
/// - `Ok(Some(addr))` — successfully resolved to a wallet address.
/// - `Ok(None)` — no record or no mapping for the requested chain.
/// - `Err(e)` — invalid name or malformed on-chain record for this name.
///
/// # Errors
/// Returns `Err` only for batch-level failures: invalid CAIP-2 chain or RPC network errors.
/// Per-name decode and name-validation errors are returned as `Err` values inside the map.
#[cfg(feature = "fetch")]
pub fn resolve_batch(
    rpc: &impl super::rpc::Rpc,
    names: &[&str],
    class_address: &Pubkey,
    chain_caip2: Option<&str>,
) -> Result<std::collections::HashMap<String, Result<Option<String>, ResolutionError>>, ResolutionError>
{
    use std::collections::HashMap;

    if names.is_empty() {
        return Ok(HashMap::new());
    }

    let chain = validate_and_normalize_caip2(chain_caip2.unwrap_or(DEFAULT_SOLANA_CAIP2))?;

    // Separate valid names (those with a derivable PDA) from invalid ones.
    let mut result: HashMap<String, Result<Option<String>, ResolutionError>> = HashMap::new();
    let mut valid_indices: Vec<usize> = Vec::new();
    let mut valid_pdas: Vec<Pubkey> = Vec::new();

    for (i, name) in names.iter().enumerate() {
        match find_name_record_pda(name, class_address) {
            Ok(pda) => {
                valid_indices.push(i);
                valid_pdas.push(pda);
            }
            Err(e) => {
                result.insert(name.to_string(), Err(e));
            }
        }
    }

    if !valid_pdas.is_empty() {
        let accounts = rpc.get_multiple_accounts(&valid_pdas)?;
        for (account_opt, &name_idx) in accounts.into_iter().zip(valid_indices.iter()) {
            result.insert(names[name_idx].to_string(), resolve_one_forward(account_opt, &chain));
        }
    }

    Ok(result)
}

#[cfg(feature = "fetch")]
fn resolve_one_forward(
    account_opt: Option<Vec<u8>>,
    chain: &str,
) -> Result<Option<String>, ResolutionError> {
    use crate::client::accounts::record::Record;
    let Some(data) = account_opt else { return Ok(None) };
    let record =
        Record::from_bytes(&data).map_err(|e| ResolutionError::DecodeError(e.to_string()))?;
    let mappings = deserialize_wallet_mappings(&record.data)?;
    Ok(find_wallet_address(&mappings, chain))
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── serialize/deserialize_wallet_mappings ──────────────────────────────

    #[test]
    fn round_trip_empty() {
        let original: Vec<WalletMapping> = vec![];
        let bytes = serialize_wallet_mappings(&original);
        let decoded = deserialize_wallet_mappings(&bytes).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn round_trip_single() {
        let original = vec![WalletMapping {
            chain_caip2: "solana:_".to_string(),
            address: "So11111111111111111111111111111111111111112".to_string(),
        }];
        let bytes = serialize_wallet_mappings(&original);
        let decoded = deserialize_wallet_mappings(&bytes).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn round_trip_multiple_chains() {
        let original = vec![
            WalletMapping { chain_caip2: "solana:_".to_string(), address: "addr-sol".to_string() },
            WalletMapping { chain_caip2: "eip155:1".to_string(), address: "0xdeadbeef".to_string() },
            WalletMapping { chain_caip2: "bip122:_".to_string(), address: "bc1qxyz".to_string() },
        ];
        let bytes = serialize_wallet_mappings(&original);
        let decoded = deserialize_wallet_mappings(&bytes).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn deserialize_ignores_unknown_types() {
        use crate::resolution::shared::{serialize_srs_mappings, SrsMapping};
        // A type-99 entry alongside a type-1 entry — the unknown type is silently skipped.
        let good = WalletMapping {
            chain_caip2: "solana:_".to_string(),
            address: "addr1".to_string(),
        };
        let mut payload = Vec::new();
        borsh::BorshSerialize::serialize(&good, &mut payload).unwrap();
        let bytes = serialize_srs_mappings(&[
            SrsMapping { mapping_type: WALLET_MAPPING_TYPE, data: payload },
            SrsMapping { mapping_type: 99, data: b"ignored".to_vec() },
        ]);
        let decoded = deserialize_wallet_mappings(&bytes).unwrap();
        assert_eq!(decoded, vec![good]);
    }

    // ── find_name_record_pda ───────────────────────────────────────────────

    #[test]
    fn pda_is_case_insensitive() {
        let class = Pubkey::default();
        let pda1 = find_name_record_pda("Example.COM", &class).unwrap();
        let pda2 = find_name_record_pda("example.com", &class).unwrap();
        assert_eq!(pda1, pda2);
    }

    /// Cross-SDK golden value: must match the TS SDK test for the same inputs.
    #[test]
    fn pda_golden_value_matches_ts() {
        // TS test: findNameRecordPDA(ctx, 'example.com', '1111...1111') === '8E1gwbcWbejdmjqZ8MFUpMA5mfnWLcaXWxGMPoDzBtP2'
        let class = Pubkey::default(); // all-zeros = "11111111111111111111111111111111"
        let pda = find_name_record_pda("example.com", &class).unwrap();
        assert_eq!(pda.to_string(), "8E1gwbcWbejdmjqZ8MFUpMA5mfnWLcaXWxGMPoDzBtP2");
    }
}

// ── RPC-gated tests (require --features fetch) ────────────────────────────────

#[cfg(all(test, feature = "fetch"))]
mod fetch_tests {
    use super::*;
    use crate::resolution::rpc::Rpc;
    use std::collections::HashMap;

    // ── MockRpc ───────────────────────────────────────────────────────────────

    struct MockRpc(HashMap<Pubkey, Vec<u8>>);

    impl Rpc for MockRpc {
        fn get_account(&self, pubkey: &Pubkey) -> Result<Option<Vec<u8>>, ResolutionError> {
            Ok(self.0.get(pubkey).cloned())
        }

        fn get_multiple_accounts(
            &self,
            pubkeys: &[Pubkey],
        ) -> Result<Vec<Option<Vec<u8>>>, ResolutionError> {
            Ok(pubkeys.iter().map(|k| self.0.get(k).cloned()).collect())
        }
    }

    // ── Fixture builder ───────────────────────────────────────────────────────

    fn make_account_bytes(srs_data: Vec<u8>) -> Vec<u8> {
        // Manual layout: disc(1) + class(32) + owner_type(1) + owner(32)
        //                + is_frozen(1) + expiry(8) + seed_len_u8(1) + srs_data
        let mut bytes = Vec::with_capacity(76 + srs_data.len());
        bytes.push(0u8);                         // discriminator
        bytes.extend_from_slice(&[0u8; 32]);     // class = default Pubkey
        bytes.push(0u8);                         // owner_type
        bytes.extend_from_slice(&[0u8; 32]);     // owner = default Pubkey
        bytes.push(0u8);                         // is_frozen = false
        bytes.extend_from_slice(&0i64.to_le_bytes()); // expiry = 0
        bytes.push(0u8);                         // U8PrefixVec seed length = 0
        bytes.extend_from_slice(&srs_data);      // RemainderVec data (no framing)
        bytes
    }

    // ── resolve ───────────────────────────────────────────────────────────────

    #[test]
    fn resolve_returns_address_for_matching_chain() {
        let class = Pubkey::default();
        let pda = find_name_record_pda("example.com", &class).unwrap();
        let srs = serialize_wallet_mappings(&[WalletMapping {
            chain_caip2: "solana:_".to_string(),
            address: "So11111111111111111111111111111111111111112".to_string(),
        }]);
        let rpc = MockRpc(HashMap::from([(pda, make_account_bytes(srs))]));
        let result = resolve(&rpc, "example.com", &class, None).unwrap();
        assert_eq!(result, Some("So11111111111111111111111111111111111111112".to_string()));
    }

    #[test]
    fn resolve_returns_none_for_unmatched_chain() {
        let class = Pubkey::default();
        let pda = find_name_record_pda("example.com", &class).unwrap();
        let srs = serialize_wallet_mappings(&[WalletMapping {
            chain_caip2: "solana:_".to_string(),
            address: "some_addr".to_string(),
        }]);
        let rpc = MockRpc(HashMap::from([(pda, make_account_bytes(srs))]));
        let result = resolve(&rpc, "example.com", &class, Some("eip155:1")).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn resolve_returns_none_when_account_missing() {
        let class = Pubkey::default();
        let rpc = MockRpc(HashMap::new());
        let result = resolve(&rpc, "example.com", &class, None).unwrap();
        assert_eq!(result, None);
    }

    // ── resolve_batch ─────────────────────────────────────────────────────────

    fn batch_one(
        rpc: &MockRpc,
        name: &str,
        class: &Pubkey,
    ) -> Result<Option<String>, ResolutionError> {
        resolve_batch(rpc, &[name], class, None).unwrap().remove(name).unwrap()
    }

    #[test]
    fn resolve_batch_all_names_present_in_result() {
        let class = Pubkey::default();
        let names = ["alice.com", "bob.com", "missing.com"];
        let alice_pda = find_name_record_pda("alice.com", &class).unwrap();
        let bob_pda = find_name_record_pda("bob.com", &class).unwrap();
        let alice_srs = serialize_wallet_mappings(&[WalletMapping {
            chain_caip2: "solana:_".to_string(),
            address: "alice_addr".to_string(),
        }]);
        let bob_srs = serialize_wallet_mappings(&[WalletMapping {
            chain_caip2: "solana:_".to_string(),
            address: "bob_addr".to_string(),
        }]);
        let rpc = MockRpc(HashMap::from([
            (alice_pda, make_account_bytes(alice_srs)),
            (bob_pda, make_account_bytes(bob_srs)),
        ]));
        let result = resolve_batch(&rpc, &names, &class, None).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result["alice.com"].as_ref().unwrap(), &Some("alice_addr".to_string()));
        assert_eq!(result["bob.com"].as_ref().unwrap(), &Some("bob_addr".to_string()));
        assert_eq!(result["missing.com"].as_ref().unwrap(), &None);
    }

    #[test]
    fn resolve_batch_none_for_unmatched_chain() {
        let class = Pubkey::default();
        let pda = find_name_record_pda("alice.com", &class).unwrap();
        let srs = serialize_wallet_mappings(&[WalletMapping {
            chain_caip2: "solana:_".to_string(),
            address: "addr".to_string(),
        }]);
        let rpc = MockRpc(HashMap::from([(pda, make_account_bytes(srs))]));
        assert_eq!(
            resolve_batch(&rpc, &["alice.com"], &class, Some("eip155:1")).unwrap()["alice.com"]
                .as_ref()
                .unwrap(),
            &None
        );
    }

    #[test]
    fn resolve_batch_errors_on_malformed_record_bytes() {
        let class = Pubkey::default();
        let pda = find_name_record_pda("alice.com", &class).unwrap();
        let rpc = MockRpc(HashMap::from([(pda, b"garbage".to_vec())]));
        assert!(matches!(batch_one(&rpc, "alice.com", &class), Err(ResolutionError::DecodeError(_))));
    }

    #[test]
    fn resolve_batch_errors_on_malformed_srs_data() {
        let class = Pubkey::default();
        let pda = find_name_record_pda("alice.com", &class).unwrap();
        let rpc = MockRpc(HashMap::from([(pda, make_account_bytes(b"not_srs!".to_vec()))]));
        assert!(matches!(batch_one(&rpc, "alice.com", &class), Err(ResolutionError::DecodeError(_))));
    }

    #[test]
    fn resolve_batch_errors_per_name_for_invalid_name() {
        let class = Pubkey::default();
        let rpc = MockRpc(HashMap::new());
        // "-bad.com" is an invalid domain; the batch itself succeeds (outer Ok),
        // but that name's entry carries an Err.
        let result = resolve_batch(&rpc, &["-bad.com", "valid.com"], &class, None).unwrap();
        assert_eq!(result.len(), 2);
        assert!(matches!(result["-bad.com"], Err(_)));
        assert_eq!(result["valid.com"].as_ref().unwrap(), &None);
    }
}
