use std::time::{Instant, SystemTime, UNIX_EPOCH};
use keytap_core::protocol::{AccountSummary, ErrorCode, ErrorPayload, ExtensionRequest, GetCodeResponse, ListAccountsPayload, NativeHostResponse, PongPayload, StatusPayload};
use keytap_core::vault::{Vault, VaultError, VaultStatus};
use keytap_core::LockConfig;

pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const CAPABILITIES: &[&str] = &["totp-sha1", "totp-sha256", "totp-sha512", "mock-vault", "encrypted-vault"];

pub struct Handler { vault: Vault, lock: keytap_core::LockState }

impl Handler {
    pub fn new() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        let path = std::path::PathBuf::from(home).join(".keytap").join("vault.json");
        if path.exists() { tracing::info!(?path, "vault file found; using mock until passphrase handshake"); }
        Self { vault: Vault::new_mock(), lock: keytap_core::LockState::new(LockConfig::default()) }
    }
    pub fn vault_status(&self) -> VaultStatus { self.vault.status() }

    pub fn handle(&mut self, req: ExtensionRequest) -> NativeHostResponse {
        if !matches!(req, ExtensionRequest::GetStatus(_) | ExtensionRequest::Lock(_)) {
            if let Some(reason) = self.lock.check_and_lock(Instant::now()) {
                return err(ErrorCode::VaultLocked, &reason.to_string(), false);
            }
        }
        match req {
            ExtensionRequest::Ping(_) => NativeHostResponse::Pong(PongPayload { host_version: HOST_VERSION.into(), capabilities: CAPABILITIES.iter().map(|s| s.to_string()).collect() }),
            ExtensionRequest::ListAccounts(_) => {
                let accounts: Vec<AccountSummary> = self.vault.list_accounts();
                NativeHostResponse::Accounts(ListAccountsPayload { accounts, vault_locked: self.vault.is_locked() })
            }
            ExtensionRequest::GetCode(p) => self.handle_get_code(&p.account_id, &p.origin),
            ExtensionRequest::Lock(_) => { let _ = self.lock.lock(); self.status_response() }
            ExtensionRequest::GetStatus(_) => self.status_response(),
        }
    }

    fn handle_get_code(&mut self, id: &str, origin: &str) -> NativeHostResponse {
        if self.vault.is_locked() { return err(ErrorCode::VaultLocked, "locked", false); }
        match self.vault.get_code(id, origin, now_ms()) {
            Ok(r) => { self.lock.note_activity(Instant::now()); NativeHostResponse::Code(GetCodeResponse { account_id: id.into(), code: r.code, issued_at: r.issued_at, expires_at: r.expires_at }) }
            Err(VaultError::AccountNotFound(id)) => err(ErrorCode::AccountNotFound, &format!("not found: {id}"), false),
            Err(VaultError::OriginNotAuthorized(id)) => { tracing::warn!("origin mismatch: {id} {origin}"); err(ErrorCode::OriginMismatch, &format!("origin {origin} not authorized for {id}"), false) }
            Err(VaultError::Locked) => err(ErrorCode::VaultLocked, "locked", false),
            Err(other) => { tracing::error!("get_code: {other:?}"); err(ErrorCode::InternalError, "internal", false) }
        }
    }

    fn status_response(&self) -> NativeHostResponse {
        let now = Instant::now();
        let ms = self.lock.ms_until_lock(now);
        let now_ms = now_ms();
        NativeHostResponse::Status(StatusPayload {
            vault_locked: matches!(self.vault.status(), VaultStatus::Locked),
            auto_lock_at: ms.map(|m| now_ms + m),
            session_expires_at: Some(now_ms + LockConfig::default().max_session.as_millis() as u64),
            host_version: HOST_VERSION.into(),
        })
    }
}

fn err(code: ErrorCode, msg: &str, retryable: bool) -> NativeHostResponse {
    NativeHostResponse::Error(ErrorPayload { code, message: msg.into(), retryable })
}

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }
