use std::sync::Arc;

use solana_program::pubkey::Pubkey;

use crate::resolution::caip::normalize_chain_caip2;
use crate::resolution::constants::{DEFAULT_SOLANA_CAIP2, SRS_DEFAULT_PROGRAM_ID};
use crate::resolution::errors::{ResolutionError, ResolutionResult};
use crate::resolution::forward_resolver::ForwardNameResolver;
use crate::resolution::namehash::normalize_name;
use crate::resolution::pda::{find_record_pda, reverse_record_seed};
use crate::resolution::provider::RawRecordAccountProvider;
use crate::resolution::record_decoder::decode_srs_record;
use crate::resolution::tuple_codec::{parse_resolution_tuples, ResolutionTuple};

pub struct SrsReverseResolverConfig {
    pub provider: Arc<dyn RawRecordAccountProvider>,
    pub reverse_class_address: Pubkey,
    pub program_id: Option<Pubkey>,
    pub default_chain_caip2: Option<String>,
    pub verify_reverse_with_forward: Option<bool>,
    pub forward_verifier: Option<Arc<dyn ForwardNameResolver>>,
}

pub struct SrsReverseResolver {
    provider: Arc<dyn RawRecordAccountProvider>,
    reverse_class_address: Pubkey,
    program_id: Pubkey,
    default_chain_caip2: String,
    verify_reverse_with_forward: bool,
    forward_verifier: Option<Arc<dyn ForwardNameResolver>>,
}

impl SrsReverseResolver {
    pub fn new(config: SrsReverseResolverConfig) -> ResolutionResult<Self> {
        let default_chain_caip2 = normalize_chain_caip2(
            config
                .default_chain_caip2
                .as_deref()
                .unwrap_or(DEFAULT_SOLANA_CAIP2),
        )?;

        let verify_reverse_with_forward = config.verify_reverse_with_forward.unwrap_or(true);
        if verify_reverse_with_forward && config.forward_verifier.is_none() {
            return Err(ResolutionError::Input(
                "forward_verifier is required when verify_reverse_with_forward is enabled"
                    .to_string(),
            ));
        }

        Ok(Self {
            provider: config.provider,
            reverse_class_address: config.reverse_class_address,
            program_id: config.program_id.unwrap_or(SRS_DEFAULT_PROGRAM_ID),
            default_chain_caip2,
            verify_reverse_with_forward,
            forward_verifier: config.forward_verifier,
        })
    }

    pub fn reverse_resolve(&self, wallet: &str) -> ResolutionResult<Option<String>> {
        let reverse_seed = reverse_record_seed(wallet)?;
        let (record_pda, _) =
            find_record_pda(&self.reverse_class_address, &reverse_seed, &self.program_id)?;

        let Some(tuples) = self.fetch_record_tuples(&record_pda)? else {
            return Ok(None);
        };

        let mut selected_name: Option<String> = None;
        for (key, value) in tuples {
            if key.trim().to_uppercase() != "NAME" {
                continue;
            }

            let candidate_name = value.trim();
            if candidate_name.is_empty() {
                continue;
            }

            selected_name = Some(normalize_name(candidate_name)?);
        }

        let Some(selected_name) = selected_name else {
            return Ok(None);
        };

        if !self.verify_reverse_with_forward {
            return Ok(Some(selected_name));
        }

        let forward_verifier = self
            .forward_verifier
            .as_ref()
            .expect("forward verifier is validated in constructor");
        let resolved_wallet =
            forward_verifier.resolve_forward(&selected_name, Some(&self.default_chain_caip2))?;

        Ok(match resolved_wallet {
            Some(wallet_from_forward) if wallet_from_forward == wallet => Some(selected_name),
            _ => None,
        })
    }

    pub fn batch_reverse_resolve<S: AsRef<str>>(
        &self,
        wallets: &[S],
    ) -> ResolutionResult<Vec<Option<String>>> {
        wallets
            .iter()
            .map(|wallet| self.reverse_resolve(wallet.as_ref()))
            .collect()
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
