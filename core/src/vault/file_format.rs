use serde::{Deserialize, Serialize};
use crate::crypto::argon2::Argon2Params;

pub const VAULT_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFile {
    pub version: u32,
    pub kdf: Argon2Params,
    pub wrapped_keys: WrappedKeys,
    pub vault: EncryptedBlob,
}

impl VaultFile {
    pub fn read(path: &std::path::Path) -> std::io::Result<Self> {
        let bytes = std::fs::read(path)?;
        serde_json::from_slice(&bytes).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }
    pub fn write(&self, path: &std::path::Path) -> std::io::Result<()> {
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        let dir = path.parent().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent"))?;
        std::fs::create_dir_all(dir)?;
        let tmp = dir.join(format!(".{}.tmp", path.file_name().and_then(|s| s.to_str()).unwrap_or("vault")));
        std::fs::write(&tmp, &bytes)?;
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; let mut p = std::fs::metadata(&tmp)?.permissions(); p.set_mode(0o600); std::fs::set_permissions(&tmp, p)?; }
        std::fs::rename(&tmp, path)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedKeys {
    pub passphrase: WrappedKey,
    #[serde(skip_serializing_if = "Option::is_none", default)] pub os_protected: Option<OsProtectedKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedKey { pub algo: String, pub blob: Vec<u8> }
impl WrappedKey { pub fn new_aes_gcm(blob: Vec<u8>) -> Self { Self { algo: "aes-256-gcm".into(), blob } } }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsProtectedKey { pub platform: String, pub handle: String, pub blob: Vec<u8> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedBlob { pub algo: String, pub blob: Vec<u8> }
impl EncryptedBlob { pub fn new_aes_gcm(blob: Vec<u8>) -> Self { Self { algo: "aes-256-gcm".into(), blob } } }
