use crate::crypto::aes_gcm::{self, AesGcmError, AesGcmKey};
use crate::crypto::argon2::{self, Argon2Error, Argon2Params};
use rand::RngCore;
use zeroize::Zeroizing;

#[derive(Clone)]
pub struct VaultKey(Zeroizing<[u8; 32]>);

#[derive(Debug, thiserror::Error)]
pub enum VekError {
    #[error("invalid key length: expected {expected}, got {actual}")] InvalidKeyLength { expected: usize, actual: usize },
    #[error("Argon2: {0}")] Argon2(#[from] Argon2Error),
    #[error("AES-GCM: {0}")] AesGcm(#[from] AesGcmError),
}

impl VaultKey {
    pub fn generate() -> Self { let mut b = [0u8; 32]; rand::rngs::OsRng.fill_bytes(&mut b); Self(Zeroizing::new(b)) }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, VekError> {
        if bytes.len() != 32 { return Err(VekError::InvalidKeyLength { expected: 32, actual: bytes.len() }); }
        let mut a = [0u8; 32]; a.copy_from_slice(bytes); Ok(Self(Zeroizing::new(a)))
    }
    pub fn as_bytes(&self) -> &[u8; 32] { &self.0 }

    pub fn wrap_with_passphrase(&self, passphrase: &[u8]) -> Result<(Argon2Params, Vec<u8>), VekError> {
        let params = Argon2Params::new();
        let kek = argon2::derive_kek(passphrase, &params)?;
        let key = AesGcmKey::from_bytes(&*kek)?;
        Ok((params, aes_gcm::encrypt(&key, self.as_bytes())?))
    }

    pub fn wrap_with_passphrase_and_params(&self, passphrase: &[u8], params: &Argon2Params) -> Result<Vec<u8>, VekError> {
        let kek = argon2::derive_kek(passphrase, params)?;
        let key = AesGcmKey::from_bytes(&*kek)?;
        Ok(aes_gcm::encrypt(&key, self.as_bytes())?)
    }

    pub fn unwrap_with_passphrase(passphrase: &[u8], params: &Argon2Params, wrapped: &[u8]) -> Result<Self, VekError> {
        let kek = argon2::derive_kek(passphrase, params)?;
        let key = AesGcmKey::from_bytes(&*kek)?;
        let vek_bytes = aes_gcm::decrypt(&key, wrapped)?;
        Self::from_bytes(&vek_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn passphrase_roundtrip() {
        let vek = VaultKey::generate();
        let (params, wrapped) = vek.wrap_with_passphrase(b"pass").unwrap();
        let unwrapped = VaultKey::unwrap_with_passphrase(b"pass", &params, &wrapped).unwrap();
        assert_eq!(vek.as_bytes(), unwrapped.as_bytes());
    }
    #[test] fn wrong_passphrase_fails() {
        let vek = VaultKey::generate();
        let (params, wrapped) = vek.wrap_with_passphrase(b"right").unwrap();
        assert!(VaultKey::unwrap_with_passphrase(b"wrong", &params, &wrapped).is_err());
    }
}
