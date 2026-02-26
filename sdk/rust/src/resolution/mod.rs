pub mod caip;
pub mod constants;
pub mod errors;
pub mod forward_resolver;
pub mod namehash;
pub mod pda;
pub mod provider;
pub mod record_decoder;
pub mod resolver;
pub mod reverse_resolver;
pub mod tuple_codec;

pub use caip::{normalize_chain_caip2, parse_wallet_tuple, ParsedWalletValue};
pub use constants::{
    DEFAULT_SOLANA_CAIP2, SRS_DEFAULT_PROGRAM_ID, SRS_RECORD_DISCRIMINATOR, SRS_RECORD_PDA_SEED,
    SRS_RECORD_TUPLE_VERSION,
};
pub use errors::{ResolutionError, ResolutionResult};
pub use forward_resolver::{DomaForwardResolver, DomaForwardResolverConfig, ForwardNameResolver};
pub use namehash::{namehash, normalize_name};
pub use pda::{find_record_pda, reverse_record_seed};
pub use provider::RawRecordAccountProvider;
pub use record_decoder::{decode_srs_record, DecodedSrsRecord};
pub use resolver::{DomaSrsResolver, DomaSrsResolverConfig};
pub use reverse_resolver::{SrsReverseResolver, SrsReverseResolverConfig};
pub use tuple_codec::{parse_resolution_tuples, serialize_resolution_tuples, ResolutionTuple};

#[cfg(test)]
mod tests;
