use super::errors::ResolutionError;
use super::shared::{deserialize_srs_mappings, serialize_srs_mappings, SrsMapping, NAME_MAPPING_TYPE};
#[cfg(feature = "fetch")]
use super::shared::{find_record_pda, normalize_name};
#[cfg(feature = "fetch")]
use solana_pubkey::Pubkey;

/// The name stored in a reverse resolution record.
#[derive(borsh::BorshSerialize, borsh::BorshDeserialize, Debug, Clone, PartialEq)]
pub struct NameMapping {
    /// Second-level domain, e.g. `"example"`.
    pub sld: String,
    /// Top-level domain, e.g. `"com"`.
    pub tld: String,
}

/// Serializes a [`NameMapping`] into an `SrsRecordData` blob.
pub fn serialize_name_mapping(mapping: &NameMapping) -> Vec<u8> {
    use borsh::BorshSerialize;
    let mut payload = Vec::new();
    mapping.serialize(&mut payload).expect("NameMapping Borsh serialization is infallible");
    serialize_srs_mappings(&[SrsMapping { mapping_type: NAME_MAPPING_TYPE, data: payload }])
}

/// Deserializes an `SrsRecordData` blob into a [`NameMapping`].
///
/// Returns `Ok(None)` if the blob contains no type-2 entry.
///
/// # Errors
/// Returns [`ResolutionError::DecodeError`] if the data is malformed.
pub fn deserialize_name_mapping(data: &[u8]) -> Result<Option<NameMapping>, ResolutionError> {
    use borsh::BorshDeserialize;
    let srs_mappings = deserialize_srs_mappings(data)?;
    let Some(m) = srs_mappings.into_iter().find(|m| m.mapping_type == NAME_MAPPING_TYPE) else {
        return Ok(None);
    };
    NameMapping::deserialize(&mut m.data.as_slice())
        .map(Some)
        .map_err(|e| ResolutionError::DecodeError(e.to_string()))
}

// ── RPC-dependent functions ──────────────────────────────────────────────────

/// Resolves a wallet address to its primary domain name.
///
/// `forward_class_address`:
/// - `Some(addr)` — verify by forward-resolving the returned name back to `wallet`; returns `None`
///   on mismatch (silently omits rather than errors, matching TS behaviour).
/// - `None` — skip verification and return the name directly.
///
/// # Errors
/// - [`ResolutionError::DecodeError`] if the on-chain record data is malformed.
/// - [`ResolutionError::RpcError`] on network failures.
#[cfg(feature = "fetch")]
pub fn reverse_resolve(
    rpc: &impl super::rpc::Rpc,
    wallet: &Pubkey,
    class_address: &Pubkey,
    forward_class_address: Option<&Pubkey>,
) -> Result<Option<String>, ResolutionError> {
    use crate::client::accounts::record::Record;
    use crate::resolution::resolve::{resolve, DEFAULT_SOLANA_CAIP2};

    let seed = wallet.to_bytes();
    let (pda, _) = find_record_pda(class_address, &seed);

    let Some(data) = rpc.get_account(&pda)? else {
        return Ok(None);
    };

    let record = Record::from_bytes(&data)
        .map_err(|e| ResolutionError::DecodeError(e.to_string()))?;

    let Some(name_mapping) = deserialize_name_mapping(&record.data)? else {
        return Ok(None);
    };

    let name = normalize_name(&format!("{}.{}", name_mapping.sld, name_mapping.tld))?;

    if let Some(fwd_class) = forward_class_address {
        let resolved = resolve(rpc, &name, fwd_class, Some(DEFAULT_SOLANA_CAIP2))?;
        match resolved {
            Some(ref addr) if addr == &wallet.to_string() => {}
            _ => return Ok(None),
        }
    }

    Ok(Some(name))
}

/// Resolves a batch of wallet addresses to their primary domain names in at most two RPC calls
/// (one for reverse records, one optional forward-verification batch).
///
/// Every input wallet appears in the returned map:
/// - `Ok(Some(name))` — successfully resolved (and verified, if requested).
/// - `Ok(None)` — no reverse record, no name mapping, or forward-verification mismatch.
/// - `Err(e)` — the on-chain record exists but is malformed.
///
/// `forward_class_address`:
/// - `Some(addr)` — verify each resolved name by forward-resolving it back to the wallet;
///   mismatches become `Ok(None)`.
/// - `None` — skip verification.
///
/// # Errors
/// Returns `Err` only for batch-level failures (RPC network errors). Per-wallet decode errors
/// are returned as `Err` values inside the map.
#[cfg(feature = "fetch")]
pub fn reverse_resolve_batch(
    rpc: &impl super::rpc::Rpc,
    wallets: &[Pubkey],
    class_address: &Pubkey,
    forward_class_address: Option<&Pubkey>,
) -> Result<std::collections::HashMap<Pubkey, Result<Option<String>, ResolutionError>>, ResolutionError>
{
    use crate::resolution::resolve::{resolve_batch, DEFAULT_SOLANA_CAIP2};
    use std::collections::HashMap;

    if wallets.is_empty() {
        return Ok(HashMap::new());
    }

    let reverse_pdas: Vec<Pubkey> =
        wallets.iter().map(|w| find_record_pda(class_address, &w.to_bytes()).0).collect();

    let accounts = rpc.get_multiple_accounts(&reverse_pdas)?;

    let mut result: HashMap<Pubkey, Result<Option<String>, ResolutionError>> = HashMap::new();
    // Tracks successfully resolved names for the optional forward-verification pass.
    let mut resolved_names: HashMap<Pubkey, String> = HashMap::new();

    for (i, account_opt) in accounts.into_iter().enumerate() {
        let wallet = wallets[i];
        let entry = resolve_one(account_opt);
        if let Ok(Some(ref name)) = entry {
            if forward_class_address.is_some() {
                resolved_names.insert(wallet, name.clone());
            }
        }
        result.insert(wallet, entry);
    }

    if let Some(fwd_class) = forward_class_address {
        // Deduplicate names, then verify all with a single resolve_batch call.
        let mut seen = std::collections::HashSet::new();
        let unique_names: Vec<String> =
            resolved_names.values().filter(|n| seen.insert((*n).clone())).cloned().collect();
        let unique_name_refs: Vec<&str> = unique_names.iter().map(String::as_str).collect();

        let forward_results =
            resolve_batch(rpc, &unique_name_refs, fwd_class, Some(DEFAULT_SOLANA_CAIP2))?;

        for (wallet, name) in &resolved_names {
            let matches = match forward_results.get(name.as_str()) {
                Some(Ok(Some(addr))) => addr == &wallet.to_string(),
                _ => false,
            };
            if !matches {
                result.insert(*wallet, Ok(None));
            }
        }
    }

    Ok(result)
}

#[cfg(feature = "fetch")]
fn resolve_one(account_opt: Option<Vec<u8>>) -> Result<Option<String>, ResolutionError> {
    use crate::client::accounts::record::Record;
    let Some(data) = account_opt else { return Ok(None) };
    let record =
        Record::from_bytes(&data).map_err(|e| ResolutionError::DecodeError(e.to_string()))?;
    let Some(name_mapping) = deserialize_name_mapping(&record.data)? else { return Ok(None) };
    let name = normalize_name(&format!("{}.{}", name_mapping.sld, name_mapping.tld))?;
    Ok(Some(name))
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolution::resolve::serialize_wallet_mappings;
    use crate::resolution::resolve::WalletMapping;

    // ── serialize/deserialize_name_mapping ────────────────────────────────

    #[test]
    fn round_trip_example_com() {
        let original = NameMapping { sld: "example".to_string(), tld: "com".to_string() };
        let bytes = serialize_name_mapping(&original);
        let decoded = deserialize_name_mapping(&bytes).unwrap();
        assert_eq!(decoded, Some(original));
    }

    #[test]
    fn deserialize_returns_none_when_no_type2_mapping() {
        // A blob with wallet mappings only — no name mapping.
        let wallet_blob = serialize_wallet_mappings(&[WalletMapping {
            chain_caip2: "solana:_".to_string(),
            address: "addr".to_string(),
        }]);
        assert_eq!(deserialize_name_mapping(&wallet_blob).unwrap(), None);
    }

    #[test]
    fn deserialize_error_too_short() {
        assert!(matches!(
            deserialize_name_mapping(&[0u8; 11]),
            Err(ResolutionError::DecodeError(_))
        ));
    }

    #[test]
    fn deserialize_error_wrong_discriminator() {
        let mut bytes = serialize_name_mapping(&NameMapping {
            sld: "example".to_string(),
            tld: "com".to_string(),
        });
        bytes[0] = 0x00;
        assert!(matches!(
            deserialize_name_mapping(&bytes),
            Err(ResolutionError::DecodeError(_))
        ));
    }

    // ── byte-layout sanity ────────────────────────────────────────────────

    #[test]
    fn serialized_layout_example_com() {
        let bytes = serialize_name_mapping(&NameMapping {
            sld: "example".to_string(),
            tld: "com".to_string(),
        });
        assert_eq!(bytes.len(), 35);
        assert_eq!(&bytes[..8], b"mappings");
        assert_eq!(u32::from_le_bytes(bytes[8..12].try_into().unwrap()), 1);
        assert_eq!(bytes[12], NAME_MAPPING_TYPE);
        // sld_len
        assert_eq!(u32::from_le_bytes(bytes[17..21].try_into().unwrap()), 7);
        assert_eq!(&bytes[21..28], b"example");
        // tld_len
        assert_eq!(u32::from_le_bytes(bytes[28..32].try_into().unwrap()), 3);
        assert_eq!(&bytes[32..35], b"com");
    }
}

// ── RPC-gated tests (require --features fetch) ────────────────────────────────

#[cfg(all(test, feature = "fetch"))]
mod fetch_tests {
    use super::*;
    use crate::resolution::resolve::{find_name_record_pda, serialize_wallet_mappings, WalletMapping};
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

    fn reverse_record(sld: &str, tld: &str) -> Vec<u8> {
        make_account_bytes(serialize_name_mapping(&NameMapping {
            sld: sld.to_string(),
            tld: tld.to_string(),
        }))
    }

    fn forward_record(chain: &str, addr: &str) -> Vec<u8> {
        make_account_bytes(serialize_wallet_mappings(&[WalletMapping {
            chain_caip2: chain.to_string(),
            address: addr.to_string(),
        }]))
    }

    // ── reverse_resolve ───────────────────────────────────────────────────────

    #[test]
    fn reverse_resolve_returns_name_without_verification() {
        let class = Pubkey::default();
        let wallet = Pubkey::new_unique();
        let (rev_pda, _) = find_record_pda(&class, &wallet.to_bytes());
        let rpc = MockRpc(HashMap::from([(rev_pda, reverse_record("example", "com"))]));
        let result = reverse_resolve(&rpc, &wallet, &class, None).unwrap();
        assert_eq!(result, Some("example.com".to_string()));
    }

    #[test]
    fn reverse_resolve_returns_none_when_account_missing() {
        let class = Pubkey::default();
        let wallet = Pubkey::new_unique();
        let rpc = MockRpc(HashMap::new());
        let result = reverse_resolve(&rpc, &wallet, &class, None).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn reverse_resolve_confirms_match_with_verification() {
        let class = Pubkey::default();
        let wallet = Pubkey::new_unique();
        let (rev_pda, _) = find_record_pda(&class, &wallet.to_bytes());
        let fwd_pda = find_name_record_pda("example.com", &class).unwrap();
        let rpc = MockRpc(HashMap::from([
            (rev_pda, reverse_record("example", "com")),
            (fwd_pda, forward_record("solana:_", &wallet.to_string())),
        ]));
        let result = reverse_resolve(&rpc, &wallet, &class, Some(&class)).unwrap();
        assert_eq!(result, Some("example.com".to_string()));
    }

    #[test]
    fn reverse_resolve_skips_mismatch_with_verification() {
        let class = Pubkey::default();
        let wallet = Pubkey::new_unique();
        let (rev_pda, _) = find_record_pda(&class, &wallet.to_bytes());
        let fwd_pda = find_name_record_pda("example.com", &class).unwrap();
        let rpc = MockRpc(HashMap::from([
            (rev_pda, reverse_record("example", "com")),
            // forward record points to a DIFFERENT wallet — mismatch
            (fwd_pda, forward_record("solana:_", "different_wallet_address")),
        ]));
        let result = reverse_resolve(&rpc, &wallet, &class, Some(&class)).unwrap();
        assert_eq!(result, None);
    }

    // ── reverse_resolve_batch: error propagation ──────────────────────────────

    fn batch_one(
        rpc: &MockRpc,
        wallet: Pubkey,
        class: &Pubkey,
    ) -> Result<Option<String>, ResolutionError> {
        reverse_resolve_batch(rpc, &[wallet], class, None)
            .unwrap()
            .remove(&wallet)
            .unwrap()
    }

    #[test]
    fn reverse_resolve_batch_errors_on_malformed_record_bytes() {
        // Account data that cannot be deserialized as a Record → per-wallet DecodeError.
        let class = Pubkey::default();
        let wallet = Pubkey::new_unique();
        let (rev_pda, _) = find_record_pda(&class, &wallet.to_bytes());
        let rpc = MockRpc(HashMap::from([(rev_pda, b"garbage".to_vec())]));
        assert!(matches!(batch_one(&rpc, wallet, &class), Err(ResolutionError::DecodeError(_))));
    }

    #[test]
    fn reverse_resolve_batch_errors_on_malformed_srs_data() {
        // Valid Record wrapper but the SrsRecordData payload has a wrong discriminator.
        let class = Pubkey::default();
        let wallet = Pubkey::new_unique();
        let (rev_pda, _) = find_record_pda(&class, &wallet.to_bytes());
        let rpc = MockRpc(HashMap::from([(rev_pda, make_account_bytes(b"not_srs!".to_vec()))]));
        assert!(matches!(batch_one(&rpc, wallet, &class), Err(ResolutionError::DecodeError(_))));
    }

    #[test]
    fn reverse_resolve_batch_errors_on_invalid_stored_name() {
        // Valid SrsRecordData with a NameMapping whose label starts with '-' — normalize_name rejects it.
        let class = Pubkey::default();
        let wallet = Pubkey::new_unique();
        let (rev_pda, _) = find_record_pda(&class, &wallet.to_bytes());
        let srs = serialize_name_mapping(&NameMapping {
            sld: "-bad".to_string(),
            tld: "sol".to_string(),
        });
        let rpc = MockRpc(HashMap::from([(rev_pda, make_account_bytes(srs))]));
        assert!(matches!(batch_one(&rpc, wallet, &class), Err(_)));
    }

    #[test]
    fn reverse_resolve_batch_none_for_wallet_with_no_name_mapping() {
        // Account exists but only carries a wallet mapping — no name mapping → Ok(None).
        let class = Pubkey::default();
        let wallet = Pubkey::new_unique();
        let (rev_pda, _) = find_record_pda(&class, &wallet.to_bytes());
        let wallet_only_srs = serialize_wallet_mappings(&[WalletMapping {
            chain_caip2: "solana:_".to_string(),
            address: wallet.to_string(),
        }]);
        let rpc = MockRpc(HashMap::from([(rev_pda, make_account_bytes(wallet_only_srs))]));
        assert_eq!(batch_one(&rpc, wallet, &class).unwrap(), None);
    }

    // ── reverse_resolve_batch ─────────────────────────────────────────────────

    #[test]
    fn reverse_resolve_batch_all_wallets_present_in_result() {
        let class = Pubkey::default();
        let w1 = Pubkey::new_unique(); // valid: reverse + matching forward
        let w2 = Pubkey::new_unique(); // mismatch: forward resolves to a different address
        let w3 = Pubkey::new_unique(); // missing: no reverse record

        let (rev_pda_w1, _) = find_record_pda(&class, &w1.to_bytes());
        let (rev_pda_w2, _) = find_record_pda(&class, &w2.to_bytes());
        let fwd_pda_w1 = find_name_record_pda("example.com", &class).unwrap();
        let fwd_pda_w2 = find_name_record_pda("another.net", &class).unwrap();

        let rpc = MockRpc(HashMap::from([
            (rev_pda_w1, reverse_record("example", "com")),
            (rev_pda_w2, reverse_record("another", "net")),
            (fwd_pda_w1, forward_record("solana:_", &w1.to_string())),
            (fwd_pda_w2, forward_record("solana:_", "wrong_addr")),
        ]));

        let result = reverse_resolve_batch(&rpc, &[w1, w2, w3], &class, Some(&class)).unwrap();

        assert_eq!(result.len(), 3);
        assert_eq!(result[&w1].as_ref().unwrap(), &Some("example.com".to_string()));
        assert_eq!(result[&w2].as_ref().unwrap(), &None); // mismatch → Ok(None)
        assert_eq!(result[&w3].as_ref().unwrap(), &None); // missing → Ok(None)
    }
}
