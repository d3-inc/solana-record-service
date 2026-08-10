pub mod errors;
pub mod resolve;
pub mod reverse_resolve;
#[cfg(feature = "name-resolution-fetch")]
pub mod rpc;
pub mod shared;

pub use errors::ResolutionError;
pub use resolve::{
    deserialize_wallet_mappings, find_name_record_pda, serialize_wallet_mappings, WalletMapping,
    DEFAULT_SOLANA_CAIP2,
};
pub use reverse_resolve::{deserialize_name_mapping, serialize_name_mapping, NameMapping};
pub use shared::{
    deserialize_srs_mappings, find_record_pda, namehash, normalize_name, serialize_srs_mappings,
    validate_and_normalize_caip2, NameToNameId, SrsMapping, NAME_MAPPING_TYPE, WALLET_MAPPING_TYPE,
};

#[cfg(feature = "name-resolution-fetch")]
pub use resolve::{resolve, resolve_batch};
#[cfg(feature = "name-resolution-fetch")]
pub use reverse_resolve::{reverse_resolve, reverse_resolve_batch};
#[cfg(feature = "name-resolution-fetch")]
pub use rpc::Rpc;
