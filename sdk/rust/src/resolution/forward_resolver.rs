use std::sync::Arc;

use solana_program::pubkey::Pubkey;

use crate::resolution::caip::{normalize_chain_caip2, parse_wallet_tuple};
use crate::resolution::constants::{DEFAULT_SOLANA_CAIP2, SRS_DEFAULT_PROGRAM_ID};
use crate::resolution::errors::ResolutionResult;
use crate::resolution::namehash::namehash;
use crate::resolution::pda::find_record_pda;
use crate::resolution::provider::RawRecordAccountProvider;
use crate::resolution::record_decoder::decode_srs_record;
use crate::resolution::tuple_codec::{parse_resolution_tuples, ResolutionTuple};

pub trait ForwardNameResolver: Send + Sync {
    fn resolve_forward(
        &self,
        name: &str,
        chain_caip2: Option<&str>,
    ) -> ResolutionResult<Option<String>>;
}

pub struct DomaForwardResolverConfig {
    pub provider: Arc<dyn RawRecordAccountProvider>,
    pub doma_class_address: Pubkey,
    pub program_id: Option<Pubkey>,
    pub default_chain_caip2: Option<String>,
}

#[derive(Clone)]
pub struct DomaForwardResolver {
    provider: Arc<dyn RawRecordAccountProvider>,
    doma_class_address: Pubkey,
    program_id: Pubkey,
    default_chain_caip2: String,
}

impl DomaForwardResolver {
    pub fn new(config: DomaForwardResolverConfig) -> ResolutionResult<Self> {
        let default_chain_caip2 = normalize_chain_caip2(
            config
                .default_chain_caip2
                .as_deref()
                .unwrap_or(DEFAULT_SOLANA_CAIP2),
        )?;

        Ok(Self {
            provider: config.provider,
            doma_class_address: config.doma_class_address,
            program_id: config.program_id.unwrap_or(SRS_DEFAULT_PROGRAM_ID),
            default_chain_caip2,
        })
    }

    pub fn resolve(
        &self,
        name: &str,
        chain_caip2: Option<&str>,
    ) -> ResolutionResult<Option<String>> {
        let normalized_chain =
            normalize_chain_caip2(chain_caip2.unwrap_or(&self.default_chain_caip2))?;
        let token_id = namehash(name)?;
        let (record_pda, _) =
            find_record_pda(&self.doma_class_address, &token_id, &self.program_id)?;

        let Some(tuples) = self.fetch_record_tuples(&record_pda)? else {
            return Ok(None);
        };

        let mut selected_wallet: Option<String> = None;
        for (key, value) in tuples {
            let Some(parsed) = parse_wallet_tuple(&key, &value, &normalized_chain)? else {
                continue;
            };

            if parsed.chain_id == normalized_chain {
                selected_wallet = Some(parsed.wallet_address);
            }
        }

        Ok(selected_wallet)
    }

    fn fetch_record_tuples(
        &self,
        record_pda: &Pubkey,
    ) -> ResolutionResult<Option<Vec<ResolutionTuple>>> {
        let Some(raw) = self.provider.fetch_raw_record_account(record_pda)? else {
            return Ok(None);
        };

        let decoded = decode_srs_record(&raw)?;
        Ok(Some(parse_resolution_tuples(&decoded.data)?))
    }
}

impl ForwardNameResolver for DomaForwardResolver {
    fn resolve_forward(
        &self,
        name: &str,
        chain_caip2: Option<&str>,
    ) -> ResolutionResult<Option<String>> {
        self.resolve(name, chain_caip2)
    }
}
