use std::io::{self, Read, Write};
use keytap_core::protocol::{parse_request, serialize_response, ExtensionRequest, NativeHostResponse, ProtocolError};

pub const MAX_MESSAGE_SIZE: usize = 1024 * 1024;

pub fn read_message<R: Read>(r: &mut R) -> io::Result<Vec<u8>> {
    let mut len_buf = [0u8; 4]; r.read_exact(&mut len_buf)?;
    let len = u32::from_le_bytes(len_buf) as usize;
    if len == 0 { return Ok(Vec::new()); }
    if len > MAX_MESSAGE_SIZE { return Err(io::Error::new(io::ErrorKind::InvalidData, format!("len {len} > max {MAX_MESSAGE_SIZE}"))); }
    let mut buf = vec![0u8; len]; r.read_exact(&mut buf)?; Ok(buf)
}

pub fn write_message<W: Write>(w: &mut W, bytes: &[u8]) -> io::Result<()> {
    w.write_all(&(bytes.len() as u32).to_le_bytes())?; w.write_all(bytes)?; w.flush()
}

pub fn read_request<R: Read>(r: &mut R) -> Result<(String, ExtensionRequest), ProtocolError> {
    let raw = read_message(r).map_err(ProtocolError::Io)?; parse_request(&raw)
}

pub fn extract_id_lenient(raw: &[u8]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(raw).ok()?;
    let id = v.get("id")?.as_str()?.trim();
    if id.is_empty() { None } else { Some(id.to_string()) }
}

pub fn write_response<W: Write>(w: &mut W, id: &str, resp: &NativeHostResponse) -> Result<(), ProtocolError> {
    let bytes = serialize_response(id, resp)?; write_message(w, &bytes).map_err(ProtocolError::Io)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test] fn roundtrip() {
        let bytes = serialize_response("r1", &NativeHostResponse::Pong(keytap_core::protocol::PongPayload { host_version: "1".into(), capabilities: vec![] })).unwrap();
        let mut f = Vec::new(); f.extend_from_slice(&(bytes.len() as u32).to_le_bytes()); f.extend_from_slice(&bytes);
        let mut c = Cursor::new(&f); let raw = read_message(&mut c).unwrap(); assert_eq!(raw, bytes);
    }
    #[test] fn oversized_rejected() {
        let mut f = Vec::new(); f.extend_from_slice(&((MAX_MESSAGE_SIZE + 1) as u32).to_le_bytes()); f.extend_from_slice(&[0u8; 10]);
        let mut c = Cursor::new(&f); assert!(read_message(&mut c).is_err());
    }
}
