use std::error::Error;
use std::fmt::{Display, Formatter};

pub type ResolutionResult<T> = Result<T, ResolutionError>;

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ResolutionError {
    Input(String),
    Codec(String),
    Decode(String),
    Provider(String),
}

impl Display for ResolutionError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Input(message) => write!(f, "input error: {message}"),
            Self::Codec(message) => write!(f, "codec error: {message}"),
            Self::Decode(message) => write!(f, "decode error: {message}"),
            Self::Provider(message) => write!(f, "provider error: {message}"),
        }
    }
}

impl Error for ResolutionError {}
