use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const NATIVE_HOST_NAME: &str = "com.keytap.nativehost";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PingPayload { pub client: String, pub client_version: String }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PongPayload { pub host_version: String, pub capabilities: Vec<String> }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GetCodePayload { pub account_id: String, pub origin: String, #[serde(skip_serializing_if = "Option::is_none", default)] pub tab_id: Option<u32> }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddAccountPayload { pub otpauth_uri: String, pub origin: String, pub passphrase: String }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAccountPayload { pub account_id: String }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountOriginPayload { pub account_id: String, pub origin: String }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnlockVaultPayload { pub passphrase: String }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EmptyPayload {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String, pub issuer: String, pub label: String, pub origin: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub additional_origins: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub requires_reauth: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListAccountsPayload { pub accounts: Vec<AccountSummary>, pub vault_locked: bool }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GetCodeResponse { pub account_id: String, pub code: String, pub issued_at: u64, pub expires_at: u64 }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub vault_locked: bool, pub vault_exists: bool, pub auto_lock_at: Option<u64>, pub session_expires_at: Option<u64>, pub host_version: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ErrorCode {
    VaultLocked, AuthRequired, AuthCancelled, OriginMismatch, AccountNotFound,
    HostUnavailable, InvalidRequest, ProtocolVersionMismatch, InternalError,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload { pub code: ErrorCode, pub message: String, pub retryable: bool }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum ExtensionRequest {
    Ping(PingPayload),
    ListAccounts(EmptyPayload),
    GetCode(GetCodePayload),
    AddAccount(AddAccountPayload),
    DeleteAccount(DeleteAccountPayload),
    UpdateAccountOrigin(UpdateAccountOriginPayload),
    UnlockVault(UnlockVaultPayload),
    Lock(EmptyPayload),
    GetStatus(EmptyPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum NativeHostResponse {
    Pong(PongPayload),
    Accounts(ListAccountsPayload),
    Code(GetCodeResponse),
    Status(StatusPayload),
    Error(ErrorPayload),
}

#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("invalid UTF-8: {0}")] InvalidUtf8(#[from] std::string::FromUtf8Error),
    #[error("invalid JSON: {0}")] InvalidJson(#[from] serde_json::Error),
    #[error("message length {0} exceeds max {1}")] MessageTooLarge(usize, usize),
    #[error("version mismatch: expected {expected}, got {got}")] VersionMismatch { expected: u32, got: u32 },
    #[error("missing field: {0}")] MissingField(&'static str),
    #[error("unknown type: {0}")] UnknownType(String),
    #[error("duplicate id: {0}")] DuplicateRequestId(String),
    #[error("malformed id")] MalformedRequestId,
    #[error("io error: {0}")] Io(#[from] std::io::Error),
}

pub fn parse_request(raw: &[u8]) -> Result<(String, ExtensionRequest), ProtocolError> {
    #[derive(Deserialize)]
    struct Envelope { v: u32, id: String, #[serde(flatten)] message: ExtensionRequest }
    let env: Envelope = serde_json::from_slice(raw)?;
    if env.v != PROTOCOL_VERSION {
        return Err(ProtocolError::VersionMismatch { expected: PROTOCOL_VERSION, got: env.v });
    }
    if env.id.trim().is_empty() { return Err(ProtocolError::MalformedRequestId); }
    Ok((env.id, env.message))
}

pub fn serialize_response(request_id: &str, response: &NativeHostResponse) -> Result<Vec<u8>, ProtocolError> {
    #[derive(Serialize)]
    struct Out<'a> { v: u32, id: &'a str, #[serde(flatten)] message: &'a NativeHostResponse }
    Ok(serde_json::to_vec(&Out { v: PROTOCOL_VERSION, id: request_id, message: response })?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_get_code() {
        let raw = br#"{"v":1,"id":"abc","type":"getCode","payload":{"accountId":"a1","origin":"https://github.com"}}"#;
        let (id, req) = parse_request(raw).unwrap();
        assert_eq!(id, "abc");
        match req { ExtensionRequest::GetCode(p) => { assert_eq!(p.account_id, "a1"); assert_eq!(p.origin, "https://github.com"); } _ => panic!() }
    }

    #[test] fn reject_version() { assert!(parse_request(br#"{"v":99,"id":"x","type":"ping","payload":{"client":"e","clientVersion":"1"}}"#).is_err()); }
    #[test] fn reject_empty_id() { assert!(parse_request(br#"{"v":1,"id":"","type":"ping","payload":{"client":"e","clientVersion":"1"}}"#).is_err()); }
    #[test] fn reject_unknown_type() { assert!(parse_request(br#"{"v":1,"id":"x","type":"exfil","payload":{}}"#).is_err()); }

    #[test]
    fn code_response_no_secret() {
        let resp = NativeHostResponse::Code(GetCodeResponse { account_id: "a1".into(), code: "123456".into(), issued_at: 1000, expires_at: 31000 });
        let bytes = serialize_response("r1", &resp).unwrap();
        let s = String::from_utf8(bytes).unwrap();
        assert!(!s.to_lowercase().contains("secret"));
        assert!(s.contains("\"code\":\"123456\""));
    }
}
