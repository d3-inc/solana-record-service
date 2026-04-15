use std::fmt;

/// Errors returned by the resolution SDK.
#[derive(Debug)]
pub enum ResolutionError {
    /// A CAIP-2 chain identifier did not match the expected `namespace:reference` format.
    InvalidCaip2(String),
    /// A domain name failed IDNA/UTS#46 normalization.
    InvalidName(String),
    /// On-chain record account data is malformed or unrecognized.
    DecodeError(String),
    /// `forward_class_address` was not supplied when forward-verification was requested.
    MissingForwardClassAddress,
    /// An RPC call failed.
    #[cfg(feature = "fetch")]
    RpcError(String),
}

impl fmt::Display for ResolutionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCaip2(caip2) => write!(f, "Invalid CAIP-2 format: {}", caip2),
            Self::InvalidName(name) => write!(f, "Invalid name: {}", name),
            Self::DecodeError(msg) => write!(f, "Failed to decode SRS record data: {}", msg),
            Self::MissingForwardClassAddress => write!(
                f,
                "forward_class_address is required when forward verification is enabled"
            ),
            #[cfg(feature = "fetch")]
            Self::RpcError(msg) => write!(f, "RPC error: {}", msg),
        }
    }
}

impl std::error::Error for ResolutionError {}
