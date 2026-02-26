use crate::resolution::constants::SRS_RECORD_TUPLE_VERSION;
use crate::resolution::errors::{ResolutionError, ResolutionResult};

pub type ResolutionTuple = (String, String);

fn write_u16_le(out: &mut Vec<u8>, value: usize, label: &str) -> ResolutionResult<()> {
    if value > u16::MAX as usize {
        return Err(ResolutionError::Codec(format!("{label} must fit into u16")));
    }

    out.extend_from_slice(&(value as u16).to_le_bytes());
    Ok(())
}

fn read_u16_le(data: &[u8], offset: &mut usize) -> ResolutionResult<u16> {
    if *offset + 2 > data.len() {
        return Err(ResolutionError::Codec(
            "Unexpected EOF while reading u16".to_string(),
        ));
    }

    let value = u16::from_le_bytes([data[*offset], data[*offset + 1]]);
    *offset += 2;
    Ok(value)
}

pub fn serialize_resolution_tuples(tuples: &[ResolutionTuple]) -> ResolutionResult<Vec<u8>> {
    if tuples.len() > u16::MAX as usize {
        return Err(ResolutionError::Codec(
            "tuple count must fit into u16".to_string(),
        ));
    }

    let mut out = Vec::new();
    out.push(SRS_RECORD_TUPLE_VERSION);
    write_u16_le(&mut out, tuples.len(), "tuple count")?;

    for (key, value) in tuples {
        let key_bytes = key.as_bytes();
        let value_bytes = value.as_bytes();

        write_u16_le(&mut out, key_bytes.len(), "key length")?;
        out.extend_from_slice(key_bytes);

        write_u16_le(&mut out, value_bytes.len(), "value length")?;
        out.extend_from_slice(value_bytes);
    }

    Ok(out)
}

pub fn parse_resolution_tuples(data: &[u8]) -> ResolutionResult<Vec<ResolutionTuple>> {
    if data.len() < 3 {
        return Err(ResolutionError::Codec(
            "Tuple payload too short".to_string(),
        ));
    }

    let mut offset = 0usize;
    let version = data[offset];
    offset += 1;

    if version != SRS_RECORD_TUPLE_VERSION {
        return Err(ResolutionError::Codec(format!(
            "Unsupported tuple payload version: {version}"
        )));
    }

    let tuple_count = read_u16_le(data, &mut offset)? as usize;
    let mut tuples = Vec::with_capacity(tuple_count);

    for _ in 0..tuple_count {
        let key_len = read_u16_le(data, &mut offset)? as usize;
        if offset + key_len > data.len() {
            return Err(ResolutionError::Codec(
                "Unexpected EOF while reading key".to_string(),
            ));
        }

        let key_bytes = &data[offset..offset + key_len];
        let key = String::from_utf8(key_bytes.to_vec())
            .map_err(|_| ResolutionError::Codec("Invalid UTF-8 in key".to_string()))?;
        offset += key_len;

        let value_len = read_u16_le(data, &mut offset)? as usize;
        if offset + value_len > data.len() {
            return Err(ResolutionError::Codec(
                "Unexpected EOF while reading value".to_string(),
            ));
        }

        let value_bytes = &data[offset..offset + value_len];
        let value = String::from_utf8(value_bytes.to_vec())
            .map_err(|_| ResolutionError::Codec("Invalid UTF-8 in value".to_string()))?;
        offset += value_len;

        tuples.push((key, value));
    }

    if offset != data.len() {
        return Err(ResolutionError::Codec(
            "Trailing bytes after tuple payload".to_string(),
        ));
    }

    Ok(tuples)
}
