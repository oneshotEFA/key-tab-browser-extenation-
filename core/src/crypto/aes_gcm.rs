use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;
use zeroize::Zeroizing;

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
pub const TAG_LEN: usize = 16;

#[derive(Debug, thiserror::Error)]
pub enum AesGcmError {
    #[error("invalid key length: expected {expected}, got {actual}")] InvalidKeyLength { expected: usize, actual: usize },
    #[error("decryption failed")] DecryptFailed,
    #[error("encryption failed: {0}")] EncryptFailed(String),
    #[error("ciphertext too short")] CiphertextTooShort,
}

#[derive(Clone)]
pub struct AesGcmKey(Zeroizing<[u8; KEY_LEN]>);

impl AesGcmKey {
    pub fn generate() -> Self { let mut b = [0u8; KEY_LEN]; OsRng.fill_bytes(&mut b); Self(Zeroizing::new(b)) }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, AesGcmError> {
        if bytes.len() != KEY_LEN { return Err(AesGcmError::InvalidKeyLength { expected: KEY_LEN, actual: bytes.len() }); }
        let mut a = [0u8; KEY_LEN]; a.copy_from_slice(bytes); Ok(Self(Zeroizing::new(a)))
    }
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] { &self.0 }
}

pub fn encrypt(key: &AesGcmKey, plaintext: &[u8]) -> Result<Vec<u8>, AesGcmError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));
    let mut nonce_bytes = [0u8; NONCE_LEN]; OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, plaintext).map_err(|e| AesGcmError::EncryptFailed(e.to_string()))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce_bytes); out.extend_from_slice(&ct); Ok(out)
}

pub fn decrypt(key: &AesGcmKey, blob: &[u8]) -> Result<Vec<u8>, AesGcmError> {
    if blob.len() < NONCE_LEN + TAG_LEN { return Err(AesGcmError::CiphertextTooShort); }
    let (nonce_bytes, ct) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));
    cipher.decrypt(Nonce::from_slice(nonce_bytes), ct).map_err(|_| AesGcmError::DecryptFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn roundtrip() {
        let k = AesGcmKey::generate();
        let blob = encrypt(&k, b"hello world").unwrap();
        assert_eq!(decrypt(&k, &blob).unwrap(), b"hello world");
    }
    #[test] fn wrong_key_fails() {
        let k1 = AesGcmKey::generate(); let k2 = AesGcmKey::generate();
        let blob = encrypt(&k1, b"secret").unwrap();
        assert!(decrypt(&k2, &blob).is_err());
    }
    #[test] fn tampered_fails() {
        let k = AesGcmKey::generate();
        let mut blob = encrypt(&k, b"secret").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        assert!(decrypt(&k, &blob).is_err());
    }
    #[test] fn nonce_unique() {
        let k = AesGcmKey::generate();
        let b1 = encrypt(&k, b"same").unwrap();
        let b2 = encrypt(&k, b"same").unwrap();
        assert_ne!(b1, b2);
    }
    #[test] fn nist_kat_test_case_1() {
        let key_bytes = [0u8; 32];
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
        let nonce = Nonce::from_slice(&[0u8; NONCE_LEN]);
        let result = cipher.encrypt(nonce, b"".as_ref()).unwrap();
        assert_eq!(result.len(), TAG_LEN);
        assert_eq!(&result[..], &[0x53, 0x0f, 0x8a, 0xfb, 0xc7, 0x45, 0x36, 0xb9, 0xa9, 0x63, 0xb4, 0xf1, 0xc4, 0xcb, 0x73, 0x8b]);
    }
}
