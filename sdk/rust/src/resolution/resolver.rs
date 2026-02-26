use std::sync::Arc;

use solana_program::pubkey::Pubkey;

use crate::resolution::errors::{ResolutionError, ResolutionResult};
use crate::resolution::forward_resolver::{
    DomaForwardResolver, DomaForwardResolverConfig, ForwardNameResolver,
};
use crate::resolution::provider::RawRecordAccountProvider;
use crate::resolution::reverse_resolver::{SrsReverseResolver, SrsReverseResolverConfig};

pub struct DomaSrsResolverConfig {
    pub provider: Arc<dyn RawRecordAccountProvider>,
    pub doma_class_address: Option<Pubkey>,
    // Backward-compatible alias for older call sites.
    pub forward_class_address: Option<Pubkey>,
    pub reverse_class_address: Pubkey,
    pub program_id: Option<Pubkey>,
    pub default_chain_caip2: Option<String>,
    pub verify_reverse_with_forward: Option<bool>,
}

pub struct DomaSrsResolver {
    forward_resolver: Arc<DomaForwardResolver>,
    reverse_resolver: SrsReverseResolver,
}

impl DomaSrsResolver {
    pub fn new(config: DomaSrsResolverConfig) -> ResolutionResult<Self> {
        let doma_class_address = config
            .doma_class_address
            .or(config.forward_class_address)
            .ok_or_else(|| ResolutionError::Input("doma_class_address is required".to_string()))?;

        let forward_resolver = Arc::new(DomaForwardResolver::new(DomaForwardResolverConfig {
            provider: config.provider.clone(),
            doma_class_address,
            program_id: config.program_id,
            default_chain_caip2: config.default_chain_caip2.clone(),
        })?);

        let forward_verifier: Arc<dyn ForwardNameResolver> = forward_resolver.clone();
        let reverse_resolver = SrsReverseResolver::new(SrsReverseResolverConfig {
            provider: config.provider,
            reverse_class_address: config.reverse_class_address,
            program_id: config.program_id,
            default_chain_caip2: config.default_chain_caip2,
            verify_reverse_with_forward: config.verify_reverse_with_forward,
            forward_verifier: Some(forward_verifier),
        })?;

        Ok(Self {
            forward_resolver,
            reverse_resolver,
        })
    }

    pub fn resolve(
        &self,
        name: &str,
        chain_caip2: Option<&str>,
    ) -> ResolutionResult<Option<String>> {
        self.forward_resolver.resolve(name, chain_caip2)
    }

    pub fn reverse_resolve(&self, wallet: &str) -> ResolutionResult<Option<String>> {
        self.reverse_resolver.reverse_resolve(wallet)
    }

    pub fn batch_reverse_resolve<S: AsRef<str>>(
        &self,
        wallets: &[S],
    ) -> ResolutionResult<Vec<Option<String>>> {
        self.reverse_resolver.batch_reverse_resolve(wallets)
    }
}
