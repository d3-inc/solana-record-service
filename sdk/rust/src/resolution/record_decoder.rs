use solana_program::pubkey::Pubkey;

use crate::client::accounts::Record;
use crate::resolution::constants::SRS_RECORD_DISCRIMINATOR;
use crate::resolution::errors::{ResolutionError, ResolutionResult};

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct DecodedSrsRecord {
    pub discriminator: u8,
    pub class: Pubkey,
    pub owner_type: u8,
    pub owner: Pubkey,
    pub is_frozen: bool,
    pub expiry: i64,
    pub seed: Vec<u8>,
    pub data: Vec<u8>,
}

pub fn decode_srs_record(raw_account_data: &[u8]) -> ResolutionResult<DecodedSrsRecord> {
    let record = Record::from_bytes(raw_account_data)
        .map_err(|e| ResolutionError::Decode(format!("Failed to decode record account: {e}")))?;

    if record.discriminator != SRS_RECORD_DISCRIMINATOR {
        return Err(ResolutionError::Decode(format!(
            "Unexpected record discriminator: {}",
            record.discriminator
        )));
    }

    Ok(DecodedSrsRecord {
        discriminator: record.discriminator,
        class: record.class,
        owner_type: record.owner_type,
        owner: record.owner,
        is_frozen: record.is_frozen,
        expiry: record.expiry,
        seed: record.seed.iter().copied().collect(),
        data: record.data.iter().copied().collect(),
    })
}
