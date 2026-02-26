use std::str::FromStr;

use solana_program::pubkey::Pubkey;

use crate::resolution::constants::SRS_RECORD_PDA_SEED;
use crate::resolution::errors::{ResolutionError, ResolutionResult};

pub fn find_record_pda(
    class_address: &Pubkey,
    token_id: &[u8],
    program_id: &Pubkey,
) -> ResolutionResult<(Pubkey, u8)> {
    if token_id.is_empty() || token_id.len() > 32 {
        return Err(ResolutionError::Input(format!(
            "token_id must be in range [1, 32], got {}",
            token_id.len()
        )));
    }

    Ok(Pubkey::find_program_address(
        &[SRS_RECORD_PDA_SEED, class_address.as_ref(), token_id],
        program_id,
    ))
}

pub fn reverse_record_seed(wallet: &str) -> ResolutionResult<[u8; 32]> {
    let wallet_pk = Pubkey::from_str(wallet)
        .map_err(|_| ResolutionError::Input(format!("Invalid wallet public key: {wallet}")))?;
    Ok(wallet_pk.to_bytes())
}
