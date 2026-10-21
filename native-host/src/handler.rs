use std::time::{Instant, SystemTime, UNIX_EPOCH};
use std::sync::atomic::{AtomicU64, Ordering};
use keytap_core::protocol::{ErrorCode, ErrorPayload, ExtensionRequest, GetCodeResponse, ListAccountsPayload, NativeHostResponse, PongPayload, StatusPayload};
use keytap_core::vault::{Vault, VaultAccount, VaultError};
use keytap_core::LockConfig;

pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const CAPABILITIES: &[&str] = &["totp-sha1", "totp-sha256", "totp-sha512", "mock-vault", "encrypted-vault"];
static ACCOUNT_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub struct Handler { vault: Option<Vault>, vault_path: std::path::PathBuf, lock: keytap_core::LockState }

impl Handler {
    pub fn new() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        let path = std::path::PathBuf::from(home).join(".keytap").join("vault.json");
        Self { vault: None, vault_path: path, lock: keytap_core::LockState::new(LockConfig::default()) }
    }

    pub fn handle(&mut self, req: ExtensionRequest) -> NativeHostResponse {
        if !matches!(req, ExtensionRequest::GetStatus(_) | ExtensionRequest::Lock(_)) {
            if let Some(reason) = self.lock.check_and_lock(Instant::now()) {
                if let Some(vault) = self.vault.take() { vault.lock(); }
                return err(ErrorCode::VaultLocked, &reason.to_string(), false);
            }
        }
        match req {
            ExtensionRequest::Ping(_) => NativeHostResponse::Pong(PongPayload { host_version: HOST_VERSION.into(), capabilities: CAPABILITIES.iter().map(|s| s.to_string()).collect() }),
            ExtensionRequest::ListAccounts(_) => NativeHostResponse::Accounts(ListAccountsPayload {
                accounts: self.vault.as_ref().map(Vault::list_accounts).unwrap_or_default(),
                vault_locked: self.vault.is_none(),
            }),
            ExtensionRequest::GetCode(p) => self.handle_get_code(&p.account_id, &p.origin),
            ExtensionRequest::AddAccount(p) => self.handle_add_account(&p.otpauth_uri, &p.origin, &p.passphrase),
            ExtensionRequest::DeleteAccount(p) => self.handle_delete_account(&p.account_id),
            ExtensionRequest::UpdateAccountOrigin(p) => self.handle_update_origin(&p.account_id, &p.origin),
            ExtensionRequest::UnlockVault(p) => self.handle_unlock(&p.passphrase),
            ExtensionRequest::Lock(_) => {
                if let Some(vault) = self.vault.take() { vault.lock(); }
                let _ = self.lock.lock();
                self.status_response()
            }
            ExtensionRequest::GetStatus(_) => self.status_response(),
        }
    }

    fn handle_get_code(&mut self, id: &str, origin: &str) -> NativeHostResponse {
        let Some(vault) = self.vault.as_ref() else { return err(ErrorCode::VaultLocked, "unlock the vault first", false); };
        match vault.get_code(id, origin, now_ms()) {
            Ok(r) => { self.lock.note_activity(Instant::now()); NativeHostResponse::Code(GetCodeResponse { account_id: id.into(), code: r.code, issued_at: r.issued_at, expires_at: r.expires_at }) }
            Err(VaultError::AccountNotFound(id)) => err(ErrorCode::AccountNotFound, &format!("not found: {id}"), false),
            Err(VaultError::OriginNotAuthorized(id)) => { tracing::warn!("origin mismatch: {id} {origin}"); err(ErrorCode::OriginMismatch, &format!("origin {origin} not authorized for {id}"), false) }
            Err(VaultError::Locked) => err(ErrorCode::VaultLocked, "locked", false),
            Err(other) => { tracing::error!("get_code: {other:?}"); err(ErrorCode::InternalError, "internal", false) }
        }
    }

    fn handle_unlock(&mut self, passphrase: &str) -> NativeHostResponse {
        if passphrase.is_empty() { return err(ErrorCode::InvalidRequest, "passphrase is required", false); }
        match Vault::open(&self.vault_path, passphrase.as_bytes()) {
            Ok(vault) => {
                self.vault = Some(vault);
                if self.lock.is_locked() { let _ = self.lock.unlock(Instant::now()); }
                self.status_response()
            }
            Err(VaultError::WrongPassphrase) => err(ErrorCode::AuthRequired, "incorrect vault passphrase", false),
            Err(other) => { tracing::error!("vault unlock failed: {other:?}"); err(ErrorCode::InternalError, "could not open vault", false) }
        }
    }

    fn handle_add_account(&mut self, uri: &str, origin: &str, passphrase: &str) -> NativeHostResponse {
        if !keytap_core::origin::is_secure_https_origin(origin) {
            return err(ErrorCode::InvalidRequest, "an HTTPS website must be active to add this account", false);
        }
        let parsed = match keytap_core::qr::parse_otpauth_uri(uri) {
            Ok(value) if value.account_type == "totp" => value,
            Ok(_) => return err(ErrorCode::InvalidRequest, "only TOTP accounts are supported", false),
            Err(_) => return err(ErrorCode::InvalidRequest, "invalid authenticator setup link", false),
        };
        if self.vault.is_none() {
            if passphrase.trim().len() < 8 {
                return err(ErrorCode::InvalidRequest, "vault passphrase must be at least 8 characters", false);
            }
            let opened = if self.vault_path.exists() {
                Vault::open(&self.vault_path, passphrase.as_bytes())
            } else {
                Vault::create_new(&self.vault_path, passphrase.as_bytes())
            };
            match opened {
                Ok(vault) => self.vault = Some(vault),
                Err(VaultError::WrongPassphrase) => return err(ErrorCode::AuthRequired, "incorrect vault passphrase", false),
                Err(other) => { tracing::error!("vault setup failed: {other:?}"); return err(ErrorCode::InternalError, "could not open or create vault", false); }
            }
        }
        if self.lock.is_locked() { let _ = self.lock.unlock(Instant::now()); }
        self.lock.note_activity(Instant::now());
        let now = now_ms();
        let account = VaultAccount {
            id: format!("account-{now}-{}", ACCOUNT_ID_SEQUENCE.fetch_add(1, Ordering::Relaxed)),
            issuer: parsed.issuer.unwrap_or_else(|| "Authenticator".into()),
            label: parsed.label,
            origin: origin.to_string(),
            additional_origins: Vec::new(),
            requires_reauth: None,
            secret: parsed.secret,
            algorithm: parsed.algorithm,
            digits: parsed.digits,
            period: parsed.period,
        };
        let Some(vault) = self.vault.as_ref() else { return err(ErrorCode::InternalError, "vault unavailable", false); };
        if let Err(error) = vault.add_account(account) {
            tracing::error!("account import rejected: {error:?}");
            return err(ErrorCode::InternalError, "could not add account", false);
        }
        if let Err(error) = vault.save() {
            tracing::error!("vault save failed: {error:?}");
            return err(ErrorCode::InternalError, "could not save encrypted vault", false);
        }
        self.lock.note_activity(Instant::now());
        NativeHostResponse::Accounts(ListAccountsPayload { accounts: vault.list_accounts(), vault_locked: false })
    }

    fn handle_delete_account(&mut self, account_id: &str) -> NativeHostResponse {
        let Some(vault) = self.vault.as_ref() else {
            return err(ErrorCode::VaultLocked, "unlock the vault first", false);
        };
        if let Err(e) = vault.delete_account(account_id) {
            tracing::warn!("delete_account failed: {e:?}");
            return err(ErrorCode::AccountNotFound, "account not found in vault", false);
        }
        if let Err(e) = vault.save() {
            tracing::error!("vault save failed after delete: {e:?}");
            return err(ErrorCode::InternalError, "could not save encrypted vault", false);
        }
        self.lock.note_activity(Instant::now());
        NativeHostResponse::Accounts(ListAccountsPayload { accounts: vault.list_accounts(), vault_locked: false })
    }

    fn handle_update_origin(&mut self, account_id: &str, origin: &str) -> NativeHostResponse {
        if !keytap_core::origin::is_secure_https_origin(origin) {
            return err(ErrorCode::InvalidRequest, "an HTTPS website must be specified for this account", false);
        }
        let Some(vault) = self.vault.as_ref() else {
            return err(ErrorCode::VaultLocked, "unlock the vault first", false);
        };
        if let Err(e) = vault.update_origin(account_id, origin) {
            tracing::warn!("update_origin failed: {e:?}");
            return err(ErrorCode::AccountNotFound, "account not found in vault", false);
        }
        if let Err(e) = vault.save() {
            tracing::error!("vault save failed after update: {e:?}");
            return err(ErrorCode::InternalError, "could not save encrypted vault", false);
        }
        self.lock.note_activity(Instant::now());
        NativeHostResponse::Accounts(ListAccountsPayload { accounts: vault.list_accounts(), vault_locked: false })
    }

    fn status_response(&self) -> NativeHostResponse {
        let now = Instant::now();
        let ms = self.lock.ms_until_lock(now);
        let now_ms = now_ms();
        NativeHostResponse::Status(StatusPayload {
            vault_locked: self.vault.is_none() || self.lock.is_locked(),
            vault_exists: self.vault_path.exists(),
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
