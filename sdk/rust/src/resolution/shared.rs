use borsh::{BorshDeserialize, BorshSerialize};
use sha3::{Digest, Keccak256};
use solana_pubkey::Pubkey;

use super::errors::ResolutionError;
use crate::client::programs::SOLANA_RECORD_SERVICE_ID;

// Shared discriminator for every SrsRecordData blob.
const SRS_RECORD_DATA_DISCRIMINATOR: [u8; 8] = *b"mappings";

/// `mapping_type` value for a wallet (forward-resolution) mapping.
pub const WALLET_MAPPING_TYPE: u8 = 1;
/// `mapping_type` value for a name (reverse-resolution) mapping.
pub const NAME_MAPPING_TYPE: u8 = 2;

/// A single type-tagged entry inside an `SrsRecordData` blob.
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct SrsMapping {
    pub mapping_type: u8,
    pub data: Vec<u8>,
}

/// Serializes a list of [`SrsMapping`] entries into an `SrsRecordData` blob.
///
/// Binary layout: `discriminator(8) || borsh(Vec<SrsMapping>)`
/// where each `SrsMapping` is Borsh-encoded as `type_u8 + data_len_u32_le + data`.
pub fn serialize_srs_mappings(mappings: &[SrsMapping]) -> Vec<u8> {
    let mut body = Vec::new();
    mappings.to_vec().serialize(&mut body).expect("Vec<SrsMapping> Borsh serialization is infallible");
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&SRS_RECORD_DATA_DISCRIMINATOR);
    out.extend_from_slice(&body);
    out
}

/// Deserializes an `SrsRecordData` blob into its constituent [`SrsMapping`] entries.
///
/// # Errors
/// Returns [`ResolutionError::DecodeError`] if the data is too short, has a wrong
/// discriminator, or is otherwise malformed.
pub fn deserialize_srs_mappings(data: &[u8]) -> Result<Vec<SrsMapping>, ResolutionError> {
    if data.len() < 8 {
        return Err(ResolutionError::DecodeError(format!(
            "SrsRecordData too short: {} bytes",
            data.len()
        )));
    }
    if data[..8] != SRS_RECORD_DATA_DISCRIMINATOR {
        return Err(ResolutionError::DecodeError(
            "Invalid SrsRecordData discriminator".to_string(),
        ));
    }
    let mut slice = &data[8..];
    Vec::<SrsMapping>::deserialize(&mut slice)
        .map_err(|e| ResolutionError::DecodeError(e.to_string()))
}

/// Validates and trims a CAIP-2 chain identifier (`namespace:reference`).
///
/// Pattern: `[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}`
///
/// # Errors
/// Returns [`ResolutionError::InvalidCaip2`] if the format does not match.
pub fn validate_and_normalize_caip2(caip2: &str) -> Result<String, ResolutionError> {
    let trimmed = caip2.trim();
    if !is_valid_caip2(trimmed) {
        return Err(ResolutionError::InvalidCaip2(caip2.to_string()));
    }
    Ok(trimmed.to_string())
}

fn is_valid_caip2(s: &str) -> bool {
    match s.split_once(':') {
        Some((ns, reference)) => {
            let ns_len = ns.len();
            let ref_len = reference.len();
            let ns_ok = ns_len >= 3
                && ns_len <= 8
                && ns.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            let ref_ok = ref_len >= 1
                && ref_len <= 32
                && reference
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '_');
            ns_ok && ref_ok
        }
        None => false,
    }
}

/// Normalizes a domain name using IDNA/UTS#46 (lowercase, punycode, STD3 rules).
///
/// Mirrors the TS SDK's `tr46.toASCII` call: `checkHyphens`, `useSTD3ASCIIRules`, and
/// `verifyDNSLength` are enabled and `transitionalProcessing` is disabled. `checkBidi`
/// and `checkJoiners` are always enforced by the `idna` crate and are not configurable.
///
/// # Errors
/// Returns [`ResolutionError::InvalidName`] if the name is empty or fails IDNA validation.
pub fn normalize_name(name: &str) -> Result<String, ResolutionError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ResolutionError::InvalidName(name.to_string()));
    }
    let ascii = idna::Config::default()
        .use_std3_ascii_rules(true)
        .transitional_processing(false)
        .verify_dns_length(true)
        .check_hyphens(true)
        .to_ascii(trimmed)
        .map_err(|_| ResolutionError::InvalidName(name.to_string()))?;
    Ok(ascii)
}

/// Computes the Keccak-256 namehash of a domain name.
///
/// The name is IDNA-normalized before hashing; labels are hashed right-to-left (TLD first).
///
/// # Errors
/// Returns [`ResolutionError::InvalidName`] if normalization fails.
pub fn namehash(name: &str) -> Result<[u8; 32], ResolutionError> {
    let normalized = normalize_name(name)?;
    let labels: Vec<&str> = normalized.split('.').collect();
    let mut node = [0u8; 32];
    for label in labels.iter().rev() {
        let label_hash = Keccak256::digest(label.as_bytes());
        let mut combined = [0u8; 64];
        combined[..32].copy_from_slice(&node);
        combined[32..].copy_from_slice(&label_hash);
        node = Keccak256::digest(combined).into();
    }
    Ok(node)
}

/// Derives the PDA for a record account.
///
/// Seeds: `["record", class_address, record_seed]`, program: `SOLANA_RECORD_SERVICE_ID`.
pub fn find_record_pda(class_address: &Pubkey, record_seed: &[u8]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"record", class_address.as_ref(), record_seed],
        &SOLANA_RECORD_SERVICE_ID,
    )
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── serialize_srs_mappings / deserialize_srs_mappings ──────────────────

    #[test]
    fn round_trip_empty_mappings() {
        let bytes = serialize_srs_mappings(&[]);
        // discriminator(8) + count_u32_le(4) = 12
        assert_eq!(bytes.len(), 12);
        assert_eq!(&bytes[..8], b"mappings");
        assert_eq!(u32::from_le_bytes(bytes[8..12].try_into().unwrap()), 0);
        let mappings = deserialize_srs_mappings(&bytes).unwrap();
        assert!(mappings.is_empty());
    }

    #[test]
    fn round_trip_single_mapping() {
        let original = vec![SrsMapping { mapping_type: 1, data: b"hello".to_vec() }];
        let bytes = serialize_srs_mappings(&original);
        let decoded = deserialize_srs_mappings(&bytes).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn round_trip_multiple_mappings() {
        let original = vec![
            SrsMapping { mapping_type: 1, data: b"data1".to_vec() },
            SrsMapping { mapping_type: 2, data: b"data2longer".to_vec() },
            SrsMapping { mapping_type: 99, data: vec![] },
        ];
        let bytes = serialize_srs_mappings(&original);
        let decoded = deserialize_srs_mappings(&bytes).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn deserialize_error_too_short() {
        assert!(matches!(
            deserialize_srs_mappings(&[0u8; 11]),
            Err(ResolutionError::DecodeError(_))
        ));
    }

    #[test]
    fn deserialize_error_wrong_discriminator() {
        let mut bytes = serialize_srs_mappings(&[]);
        bytes[0] = 0x00;
        assert!(matches!(
            deserialize_srs_mappings(&bytes),
            Err(ResolutionError::DecodeError(_))
        ));
    }

    // ── validate_and_normalize_caip2 ───────────────────────────────────────

    #[test]
    fn caip2_valid_solana() {
        assert_eq!(validate_and_normalize_caip2("solana:_").unwrap(), "solana:_");
    }

    #[test]
    fn caip2_valid_eip155() {
        assert_eq!(validate_and_normalize_caip2("eip155:1").unwrap(), "eip155:1");
    }

    #[test]
    fn caip2_trims_whitespace() {
        assert_eq!(validate_and_normalize_caip2("  solana:_  ").unwrap(), "solana:_");
    }

    #[test]
    fn caip2_invalid_no_colon() {
        assert!(matches!(
            validate_and_normalize_caip2("INVALID"),
            Err(ResolutionError::InvalidCaip2(_))
        ));
    }

    #[test]
    fn caip2_invalid_ns_too_short() {
        assert!(matches!(
            validate_and_normalize_caip2("ab:x"),
            Err(ResolutionError::InvalidCaip2(_))
        ));
    }

    #[test]
    fn caip2_invalid_ns_too_long() {
        assert!(matches!(
            validate_and_normalize_caip2("toolongns:ref"),
            Err(ResolutionError::InvalidCaip2(_))
        ));
    }

    // ── normalize_name ─────────────────────────────────────────────────────

    #[test]
    fn normalize_lowercases() {
        assert_eq!(normalize_name("Example.COM").unwrap(), "example.com");
    }

    #[test]
    fn normalize_trims_whitespace() {
        assert_eq!(normalize_name("  example.com  ").unwrap(), "example.com");
    }

    #[test]
    fn normalize_rejects_empty() {
        assert!(matches!(normalize_name(""), Err(ResolutionError::InvalidName(_))));
    }

    #[test]
    fn normalize_rejects_leading_hyphen() {
        assert!(matches!(normalize_name("-bad.com"), Err(ResolutionError::InvalidName(_))));
    }

    // ── namehash ───────────────────────────────────────────────────────────

    #[test]
    fn namehash_is_correct() {
        let h1 = namehash("example.com").unwrap();
        assert_eq!(h1, hex_literal::hex!("f59ba973941fd531b0702df2592a8480fd9f28516c50a93626e652a8ce263832"));
    }

    #[test]
    fn namehash_differs_for_different_names() {
        let h1 = namehash("example.com").unwrap();
        let h2 = namehash("bob.sol").unwrap();
        assert_ne!(h1, h2);
    }

    #[test]
    fn namehash_case_insensitive() {
        let h1 = namehash("Example.COM").unwrap();
        let h2 = namehash("example.com").unwrap();
        assert_eq!(h1, h2);
    }

    // ── find_record_pda ────────────────────────────────────────────────────

    #[test]
    fn find_record_pda_is_deterministic() {
        let class = Pubkey::default();
        let seed = b"some_seed";
        let (pda1, _) = find_record_pda(&class, seed);
        let (pda2, _) = find_record_pda(&class, seed);
        assert_eq!(pda1, pda2);
    }

    #[test]
    fn find_record_pda_differs_for_different_class() {
        let class1 = Pubkey::default();
        let class2 = Pubkey::new_unique();
        let seed = b"some_seed";
        let (pda1, _) = find_record_pda(&class1, seed);
        let (pda2, _) = find_record_pda(&class2, seed);
        assert_ne!(pda1, pda2);
    }

    #[test]
    fn find_record_pda_differs_for_different_seed() {
        let class = Pubkey::default();
        let (pda1, _) = find_record_pda(&class, b"seed_a");
        let (pda2, _) = find_record_pda(&class, b"seed_b");
        assert_ne!(pda1, pda2);
    }
}
