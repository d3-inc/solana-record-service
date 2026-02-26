use solana_program::pubkey::Pubkey;

use crate::resolution::errors::ResolutionResult;

pub trait RawRecordAccountProvider: Send + Sync {
    fn fetch_raw_record_account(&self, record_pda: &Pubkey) -> ResolutionResult<Option<Vec<u8>>>;
}
