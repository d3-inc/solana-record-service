use crate::resolution::errors::{ResolutionError, ResolutionResult};

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ParsedWalletValue {
    pub chain_id: String,
    pub wallet_address: String,
}

fn is_valid_caip2(chain_id: &str) -> bool {
    let Some((namespace, reference)) = chain_id.split_once(':') else {
        return false;
    };

    if namespace.len() < 3 || namespace.len() > 8 {
        return false;
    }
    if !namespace
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    {
        return false;
    }

    if reference.is_empty() || reference.len() > 32 {
        return false;
    }

    reference
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn normalize_chain_caip2(chain_id: &str) -> ResolutionResult<String> {
    let trimmed = chain_id.trim();
    if !is_valid_caip2(trimmed) {
        return Err(ResolutionError::Input(format!(
            "Invalid CAIP-2 chain id: {chain_id}"
        )));
    }

    Ok(trimmed.to_lowercase())
}

fn parse_caip_wallet_value(value: &str) -> Option<ParsedWalletValue> {
    let trimmed = value.trim();
    let parts: Vec<&str> = trimmed.split(':').collect();

    if parts.len() < 3 {
        return None;
    }

    // did:pkh:<namespace>:<reference>:<account>
    if parts[0] == "did" && parts[1] == "pkh" && parts.len() >= 5 {
        let chain = format!("{}:{}", parts[2], parts[3]);
        if !is_valid_caip2(&chain) {
            return None;
        }

        let wallet_address = parts[4..].join(":").trim().to_string();
        if wallet_address.is_empty() {
            return None;
        }

        return Some(ParsedWalletValue {
            chain_id: chain.to_lowercase(),
            wallet_address,
        });
    }

    let chain_id = format!("{}:{}", parts[0], parts[1]);
    if !is_valid_caip2(&chain_id) {
        return None;
    }

    let wallet_address = parts[2..].join(":").trim().to_string();
    if wallet_address.is_empty() {
        return None;
    }

    Some(ParsedWalletValue {
        chain_id: chain_id.to_lowercase(),
        wallet_address,
    })
}

pub fn parse_wallet_tuple(
    key: &str,
    value: &str,
    default_chain_caip2: &str,
) -> ResolutionResult<Option<ParsedWalletValue>> {
    let normalized_default = normalize_chain_caip2(default_chain_caip2)?;
    let normalized_key = key.trim().to_uppercase();

    if normalized_key == "WALLET" {
        if let Some(parsed) = parse_caip_wallet_value(value) {
            return Ok(Some(parsed));
        }

        let wallet_address = value.trim();
        if wallet_address.is_empty() {
            return Ok(None);
        }

        return Ok(Some(ParsedWalletValue {
            chain_id: normalized_default,
            wallet_address: wallet_address.to_string(),
        }));
    }

    if !normalized_key.starts_with("WALLET:") {
        return Ok(None);
    }

    let chain_in_key_raw = key["WALLET:".len()..].trim();
    if chain_in_key_raw.is_empty() {
        return Ok(None);
    }

    let chain_id = normalize_chain_caip2(chain_in_key_raw)?;
    if let Some(parsed) = parse_caip_wallet_value(value) {
        return Ok(Some(ParsedWalletValue {
            chain_id,
            wallet_address: parsed.wallet_address,
        }));
    }

    let wallet_address = value.trim();
    if wallet_address.is_empty() {
        return Ok(None);
    }

    Ok(Some(ParsedWalletValue {
        chain_id,
        wallet_address: wallet_address.to_string(),
    }))
}
