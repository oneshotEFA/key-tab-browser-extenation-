use serde::{Deserialize, Serialize};
use crate::crypto::aes_gcm;
use crate::crypto::argon2::{derive_kek, Argon2Params};
use crate::vault::VaultAccount;

pub const BACKUP_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile { pub version: u32, pub format: String, pub kdf: Argon2Params, pub data: EncryptedBackupData }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedBackupData { pub algo: String, pub blob: Vec<u8> }

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("crypto: {0}")] Crypto(#[from] crate::crypto::VekError),
    #[error("aes-gcm: {0}")] AesGcm(#[from] crate::crypto::AesGcmError),
    #[error("argon2: {0}")] Argon2(#[from] crate::crypto::Argon2Error),
    #[error("serde: {0}")] Serde(#[from] serde_json::Error),
    #[error("wrong passphrase")] WrongPassphrase,
    #[error("unsupported version: {0}")] UnsupportedVersion(u32),
    #[error("wrong format")] WrongFormat,
    #[error("empty passphrase")] EmptyPassphrase,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupContents { pub accounts: Vec<VaultAccount>, pub exported_at: u64 }

pub fn export_backup(accounts: &[VaultAccount], passphrase: &[u8]) -> Result<Vec<u8>, BackupError> {
    if passphrase.is_empty() { return Err(BackupError::EmptyPassphrase); }
    let contents = BackupContents { accounts: accounts.to_vec(), exported_at: now_ms() };
    let plaintext = serde_json::to_vec(&contents)?;
    let kdf = Argon2Params::new();
    let kek = derive_kek(passphrase, &kdf)?;
    let key = crate::crypto::aes_gcm::AesGcmKey::from_bytes(&*kek)?;
    let blob = aes_gcm::encrypt(&key, &plaintext)?;
    let backup = BackupFile { version: BACKUP_FORMAT_VERSION, format: "keytap-backup".into(), kdf, data: EncryptedBackupData { algo: "aes-256-gcm".into(), blob } };
    Ok(serde_json::to_vec_pretty(&backup)?)
}

pub fn import_backup(bytes: &[u8], passphrase: &[u8]) -> Result<Vec<VaultAccount>, BackupError> {
    let backup: BackupFile = serde_json::from_slice(bytes)?;
    if backup.format != "keytap-backup" { return Err(BackupError::WrongFormat); }
    if backup.version != BACKUP_FORMAT_VERSION { return Err(BackupError::UnsupportedVersion(backup.version)); }
    let kek = derive_kek(passphrase, &backup.kdf)?;
    let key = crate::crypto::aes_gcm::AesGcmKey::from_bytes(&*kek)?;
    let plaintext = aes_gcm::decrypt(&key, &backup.data.blob).map_err(|_| BackupError::WrongPassphrase)?;
    let contents: BackupContents = serde_json::from_slice(&plaintext)?;
    Ok(contents.accounts)
}

fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

#[cfg(test)]
mod tests {
    use super::*;
    fn test_account(id: &str) -> VaultAccount {
        VaultAccount { id: id.into(), issuer: id.into(), label: "t".into(), origin: format!("https://{id}.com"), additional_origins: vec![], requires_reauth: None, secret: "JBSWY3DPEHPK3PXP".into(), algorithm: "SHA1".into(), digits: 6, period: 30 }
    }

    #[test] fn roundtrip() {
        let accounts = vec![test_account("github"), test_account("proton")];
        let backup = export_backup(&accounts, b"pass").unwrap();
        let restored = import_backup(&backup, b"pass").unwrap();
        assert_eq!(restored.len(), 2);
    }

    #[test] fn wrong_passphrase() {
        let backup = export_backup(&[test_account("g")], b"right").unwrap();
        assert!(matches!(import_backup(&backup, b"wrong"), Err(BackupError::WrongPassphrase)));
    }

    #[test] fn no_plaintext_leak() {
        let backup = export_backup(&[test_account("secret-account")], b"pass").unwrap();
        let s = String::from_utf8_lossy(&backup);
        assert!(!s.contains("secret-account"));
        assert!(!s.contains("JBSWY3DPEHPK3PXP"));
    }
}
