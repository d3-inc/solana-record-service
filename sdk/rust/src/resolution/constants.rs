use solana_program::{pubkey, pubkey::Pubkey};

pub const SRS_DEFAULT_PROGRAM_ID: Pubkey = pubkey!("srsUi2TVUUCyGcZdopxJauk8ZBzgAaHHZCVUhm5ifPa");
pub const SRS_RECORD_PDA_SEED: &[u8] = b"record";
pub const SRS_RECORD_DISCRIMINATOR: u8 = 2;
pub const SRS_RECORD_TUPLE_VERSION: u8 = 1;
pub const DEFAULT_SOLANA_CAIP2: &str = "solana:mainnet";
