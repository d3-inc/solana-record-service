use idna::domain_to_ascii;
use sha3::{Digest, Keccak256};

use crate::resolution::errors::{ResolutionError, ResolutionResult};

fn keccak256(input: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(input);
    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

pub fn normalize_name(name: &str) -> ResolutionResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ResolutionError::Input("Name cannot be empty".to_string()));
    }

    if trimmed == "." {
        return Ok(".".to_string());
    }

    let normalized = domain_to_ascii(trimmed)
        .map_err(|_| ResolutionError::Input(format!("Could not normalize name: {name}")))?;

    if normalized.is_empty() {
        return Err(ResolutionError::Input(format!(
            "Could not normalize name: {name}"
        )));
    }

    Ok(normalized.to_lowercase())
}

pub fn namehash(name: &str) -> ResolutionResult<[u8; 32]> {
    let normalized = normalize_name(name)?;
    if normalized == "." {
        return Ok([0u8; 32]);
    }

    let labels: Vec<&str> = normalized
        .split('.')
        .filter(|label| !label.is_empty())
        .collect();

    let mut node = [0u8; 32];

    for label in labels.iter().rev() {
        let label_hash = keccak256(label.as_bytes());
        let mut combined = [0u8; 64];
        combined[..32].copy_from_slice(&node);
        combined[32..].copy_from_slice(&label_hash);
        node = keccak256(&combined);
    }

    Ok(node)
}
