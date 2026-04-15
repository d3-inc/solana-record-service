use solana_pubkey::Pubkey;

use super::errors::ResolutionError;

/// Minimal RPC interface required by the resolution functions.
///
/// [`solana_client::rpc_client::RpcClient`] implements this trait. In tests, a
/// [`std::collections::HashMap`]-backed mock can be used instead.
pub trait Rpc {
    /// Fetch raw account data for a single address. Returns `Ok(None)` when the
    /// account does not exist.
    fn get_account(&self, pubkey: &Pubkey) -> Result<Option<Vec<u8>>, ResolutionError>;

    /// Fetch raw account data for multiple addresses in a single call. Indices
    /// in the returned `Vec` correspond 1-to-1 with `pubkeys`; missing accounts
    /// are `None`.
    fn get_multiple_accounts(
        &self,
        pubkeys: &[Pubkey],
    ) -> Result<Vec<Option<Vec<u8>>>, ResolutionError>;
}

impl Rpc for solana_client::rpc_client::RpcClient {
    fn get_account(&self, pubkey: &Pubkey) -> Result<Option<Vec<u8>>, ResolutionError> {
        use solana_sdk::commitment_config::CommitmentConfig;
        Ok(self
            .get_account_with_commitment(pubkey, CommitmentConfig::confirmed())
            .map_err(|e| ResolutionError::RpcError(e.to_string()))?
            .value
            .map(|a| a.data))
    }

    fn get_multiple_accounts(
        &self,
        pubkeys: &[Pubkey],
    ) -> Result<Vec<Option<Vec<u8>>>, ResolutionError> {
        // UFCS avoids ambiguity with the same-named inherent method on RpcClient.
        solana_client::rpc_client::RpcClient::get_multiple_accounts(self, pubkeys)
            .map_err(|e| ResolutionError::RpcError(e.to_string()))
            .map(|v| v.into_iter().map(|a| a.map(|a| a.data)).collect())
    }
}
