pub mod file_format;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use crate::crypto::aes_gcm::{self, AesGcmKey};
use crate::crypto::argon2::Argon2Params;
use crate::crypto::vek::VaultKey;
use crate::origin;
use crate::totp::{TotpAlgorithm, TotpError, TotpGenerator};
use file_format::{EncryptedBlob, VaultFile, VAULT_FORMAT_VERSION, WrappedKey, WrappedKeys};

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("locked")] Locked,
    #[error("account not found: {0}")] AccountNotFound(String),
    #[error("origin not authorized: {0}")] OriginNotAuthorized(String),
    #[error("totp: {0}")] Totp(#[from] TotpError),
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("crypto: {0}")] Crypto(#[from] crate::crypto::VekError),
    #[error("aes-gcm: {0}")] AesGcm(#[from] crate::crypto::AesGcmError),
    #[error("format: {0}")] Format(#[from] serde_json::Error),
    #[error("unsupported version: {0}")] UnsupportedVersion(u32),
    #[error("wrong passphrase")] WrongPassphrase,
    #[error("platform: {0}")] Platform(#[from] crate::platform::PlatformError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultStatus { Locked, Unlocked, Mock }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultAccount {
    pub id: String, pub issuer: String, pub label: String, pub origin: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub additional_origins: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub requires_reauth: Option<bool>,
    pub secret: String, pub algorithm: String, pub digits: u32, pub period: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultContents { accounts: Vec<VaultAccount> }

pub struct Vault { inner: Mutex<Inner> }
struct Inner { status: VaultStatus, vek: Option<VaultKey>, accounts: Vec<VaultAccount>, path: Option<PathBuf>, kdf_params: Option<Argon2Params>, os_protected: Option<file_format::OsProtectedKey> }

impl Vault {
    pub fn create_new(path: &Path, passphrase: &[u8]) -> Result<Self, VaultError> {
        if passphrase.is_empty() { return Err(VaultError::WrongPassphrase); }
        let vek = VaultKey::generate();
        let (kdf_params, passphrase_blob) = vek.wrap_with_passphrase(passphrase)?;
        let contents = VaultContents { accounts: vec![] };
        let plaintext = serde_json::to_vec(&contents)?;
        let vault_blob = aes_gcm::encrypt(&vek_to_key(&vek), &plaintext)?;
        let vf = VaultFile { version: VAULT_FORMAT_VERSION, kdf: kdf_params.clone(), wrapped_keys: WrappedKeys { passphrase: WrappedKey::new_aes_gcm(passphrase_blob), os_protected: None }, vault: EncryptedBlob::new_aes_gcm(vault_blob) };
        vf.write(path)?;
        Ok(Self { inner: Mutex::new(Inner { status: VaultStatus::Unlocked, vek: Some(vek), accounts: contents.accounts, path: Some(path.to_path_buf()), kdf_params: Some(kdf_params), os_protected: None }) })
    }

    pub fn open(path: &Path, passphrase: &[u8]) -> Result<Self, VaultError> {
        let vf = VaultFile::read(path)?;
        if vf.version != VAULT_FORMAT_VERSION { return Err(VaultError::UnsupportedVersion(vf.version)); }
        let vek = VaultKey::unwrap_with_passphrase(passphrase, &vf.kdf, &vf.wrapped_keys.passphrase.blob).map_err(|_| VaultError::WrongPassphrase)?;
        let plaintext = aes_gcm::decrypt(&vek_to_key(&vek), &vf.vault.blob)?;
        let contents: VaultContents = serde_json::from_slice(&plaintext)?;
        let os_protected = vf.wrapped_keys.os_protected;
        Ok(Self { inner: Mutex::new(Inner { status: VaultStatus::Unlocked, vek: Some(vek), accounts: contents.accounts, path: Some(path.to_path_buf()), kdf_params: Some(vf.kdf), os_protected }) })
    }

    pub fn new_mock() -> Self {
        let seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".to_string();
        let accounts = [("github","GitHub","personal","https://github.com",vec!["https://gist.github.com"]),("example","Example Corp","work","https://login.example.com",vec![]),("proton","Proton","personal","https://account.proton.me",vec![]),("cloudflare","Cloudflare","team","https://dash.cloudflare.com",vec![])];
        let vault_accounts: Vec<VaultAccount> = accounts.iter().map(|(id,iss,label,orig,extra)| VaultAccount { id: id.to_string(), issuer: iss.to_string(), label: label.to_string(), origin: orig.to_string(), additional_origins: extra.iter().map(|s| s.to_string()).collect(), requires_reauth: Some(*id == "example"), secret: seed.clone(), algorithm: "SHA1".into(), digits: 6, period: 30 }).collect();
        Self { inner: Mutex::new(Inner { status: VaultStatus::Mock, vek: None, accounts: vault_accounts, path: None, kdf_params: None, os_protected: None }) }
    }

    pub fn status(&self) -> VaultStatus { self.inner.lock().unwrap().status }
    pub fn is_locked(&self) -> bool { matches!(self.status(), VaultStatus::Locked) }
    pub fn lock(&self) { let mut i = self.inner.lock().unwrap(); i.vek = None; i.accounts.clear(); i.status = VaultStatus::Locked; }

    pub fn list_accounts(&self) -> Vec<crate::protocol::AccountSummary> {
        self.inner.lock().unwrap().accounts.iter().map(|a| crate::protocol::AccountSummary { id: a.id.clone(), issuer: a.issuer.clone(), label: a.label.clone(), origin: a.origin.clone(), additional_origins: a.additional_origins.clone(), requires_reauth: a.requires_reauth }).collect()
    }

    pub fn add_account(&self, account: VaultAccount) -> Result<(), VaultError> {
        let mut i = self.inner.lock().unwrap();
        if matches!(i.status, VaultStatus::Locked) { return Err(VaultError::Locked); }
        i.accounts.push(account); Ok(())
    }

    pub fn delete_account(&self, id: &str) -> Result<(), VaultError> {
        let mut i = self.inner.lock().unwrap();
        if matches!(i.status, VaultStatus::Locked) { return Err(VaultError::Locked); }
        let before = i.accounts.len();
        i.accounts.retain(|a| a.id != id);
        if i.accounts.len() == before { return Err(VaultError::AccountNotFound(id.into())); }
        Ok(())
    }

    pub fn update_origin(&self, id: &str, origin: &str) -> Result<(), VaultError> {
        let mut i = self.inner.lock().unwrap();
        if matches!(i.status, VaultStatus::Locked) { return Err(VaultError::Locked); }
        if let Some(a) = i.accounts.iter_mut().find(|a| a.id == id) {
            a.origin = origin.to_string();
            Ok(())
        } else {
            Err(VaultError::AccountNotFound(id.into()))
        }
    }

    pub fn save(&self) -> Result<(), VaultError> {
        let i = self.inner.lock().unwrap();
        let path = i.path.as_ref().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no path"))?;
        let vek = i.vek.as_ref().ok_or(VaultError::Locked)?;
        let kdf = i.kdf_params.as_ref().ok_or(VaultError::Locked)?;
        let contents = VaultContents { accounts: i.accounts.clone() };
        let plaintext = serde_json::to_vec(&contents)?;
        let vault_blob = aes_gcm::encrypt(&vek_to_key(vek), &plaintext)?;
        let existing = VaultFile::read(path)?;
        let vf = VaultFile { version: VAULT_FORMAT_VERSION, kdf: kdf.clone(), wrapped_keys: WrappedKeys { passphrase: existing.wrapped_keys.passphrase, os_protected: i.os_protected.clone() }, vault: EncryptedBlob::new_aes_gcm(vault_blob) };
        vf.write(path)?; Ok(())
    }

    pub fn save_with_passphrase(&self, passphrase: &[u8]) -> Result<(), VaultError> {
        let i = self.inner.lock().unwrap();
        let path = i.path.as_ref().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no path"))?;
        let vek = i.vek.as_ref().ok_or(VaultError::Locked)?;
        let kdf = i.kdf_params.as_ref().ok_or(VaultError::Locked)?;
        let passphrase_blob = vek.wrap_with_passphrase_and_params(passphrase, kdf)?;
        let contents = VaultContents { accounts: i.accounts.clone() };
        let plaintext = serde_json::to_vec(&contents)?;
        let vault_blob = aes_gcm::encrypt(&vek_to_key(vek), &plaintext)?;
        let vf = VaultFile { version: VAULT_FORMAT_VERSION, kdf: kdf.clone(), wrapped_keys: WrappedKeys { passphrase: WrappedKey::new_aes_gcm(passphrase_blob), os_protected: i.os_protected.clone() }, vault: EncryptedBlob::new_aes_gcm(vault_blob) };
        vf.write(path)?; Ok(())
    }

    pub fn get_code(&self, account_id: &str, origin: &str, now_unix_ms: u64) -> Result<GetCodeResult, VaultError> {
        if self.is_locked() { return Err(VaultError::Locked); }
        let i = self.inner.lock().unwrap();
        let account = i.accounts.iter().find(|a| a.id == account_id).ok_or_else(|| VaultError::AccountNotFound(account_id.into()))?;
        let check = origin::check_origin(origin, &account.origin, &account.additional_origins);
        if !check.authorized { return Err(VaultError::OriginNotAuthorized(account_id.into())); }
        let algo = TotpAlgorithm::from_str_ci(&account.algorithm).ok_or_else(|| TotpError::Hmac(format!("unknown algo: {}", account.algorithm)))?;
        let secret_bytes = crate::totp::base32_decode(&account.secret)?;
        let totp = TotpGenerator::new(secret_bytes, algo, account.digits, account.period)?;
        let now_secs = now_unix_ms / 1000;
        let code = totp.generate(now_secs)?;
        let step_start = (now_secs / (account.period as u64)) * (account.period as u64);
        Ok(GetCodeResult { code, issued_at: now_unix_ms, expires_at: (step_start + account.period as u64) * 1000 })
    }
}

#[derive(Debug)]
pub struct GetCodeResult { pub code: String, pub issued_at: u64, pub expires_at: u64 }

fn vek_to_key(vek: &VaultKey) -> AesGcmKey { AesGcmKey::from_bytes(vek.as_bytes()).expect("VEK is 32 bytes") }

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_account(id: &str, origin: &str) -> VaultAccount {
        VaultAccount { id: id.into(), issuer: id.into(), label: "test".into(), origin: origin.into(), additional_origins: vec![], requires_reauth: None, secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".into(), algorithm: "SHA1".into(), digits: 6, period: 30 }
    }

    #[test]
    fn create_open_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.json");
        { let v = Vault::create_new(&path, b"pass").unwrap(); v.add_account(test_account("github","https://github.com")).unwrap(); v.save_with_passphrase(b"pass").unwrap(); }
        let v = Vault::open(&path, b"pass").unwrap();
        assert_eq!(v.list_accounts().len(), 1);
        assert_eq!(v.list_accounts()[0].id, "github");
    }

    #[test] fn wrong_passphrase() {
        let dir = tempdir().unwrap(); let path = dir.path().join("v.json");
        Vault::create_new(&path, b"right").unwrap();
        assert!(matches!(Vault::open(&path, b"wrong"), Err(VaultError::WrongPassphrase)));
    }

    #[test] fn get_code_works() {
        let dir = tempdir().unwrap(); let path = dir.path().join("v.json");
        { let v = Vault::create_new(&path, b"pass").unwrap(); v.add_account(test_account("github","https://github.com")).unwrap(); v.save_with_passphrase(b"pass").unwrap(); }
        let v = Vault::open(&path, b"pass").unwrap();
        assert_eq!(v.get_code("github","https://github.com",59_000).unwrap().code, "287082");
    }

    #[test] fn origin_mismatch_rejected() {
        let dir = tempdir().unwrap(); let path = dir.path().join("v.json");
        { let v = Vault::create_new(&path, b"pass").unwrap(); v.add_account(test_account("example","https://login.example.com")).unwrap(); v.save_with_passphrase(b"pass").unwrap(); }
        let v = Vault::open(&path, b"pass").unwrap();
        assert!(matches!(v.get_code("example","https://evil.example.com",59_000), Err(VaultError::OriginNotAuthorized(_))));
    }

    #[test] fn tampered_rejected() {
        let dir = tempdir().unwrap(); let path = dir.path().join("v.json");
        { let v = Vault::create_new(&path, b"pass").unwrap(); v.add_account(test_account("g","https://g.com")).unwrap(); v.save_with_passphrase(b"pass").unwrap(); }
        let bytes = std::fs::read(&path).unwrap();
        let mut t = bytes.clone(); let pos = t.len() - 10; t[pos] ^= 0x01; std::fs::write(&path, &t).unwrap();
        assert!(Vault::open(&path, b"pass").is_err());
    }

    #[test] fn mock_works() {
        let v = Vault::new_mock();
        assert_eq!(v.list_accounts().len(), 4);
    }
}
