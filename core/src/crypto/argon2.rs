use argon2::{Algorithm, Argon2, Params, Version};
use rand::rngs::OsRng;
use rand::RngCore;
use zeroize::Zeroizing;

pub const SALT_LEN: usize = 16;
pub const DEFAULT_M_COST: u32 = 65_536;
pub const DEFAULT_T_COST: u32 = 3;
pub const DEFAULT_P_COST: u32 = 4;
pub const KEK_LEN: usize = 32;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Argon2Params { pub m_cost: u32, pub t_cost: u32, pub p_cost: u32, pub salt: Vec<u8> }

impl Argon2Params {
    pub fn new() -> Self { let mut salt = vec![0u8; SALT_LEN]; OsRng.fill_bytes(&mut salt); Self { m_cost: DEFAULT_M_COST, t_cost: DEFAULT_T_COST, p_cost: DEFAULT_P_COST, salt } }
    pub fn with_params(m: u32, t: u32, p: u32) -> Self { let mut salt = vec![0u8; SALT_LEN]; OsRng.fill_bytes(&mut salt); Self { m_cost: m, t_cost: t, p_cost: p, salt } }
}

impl Default for Argon2Params { fn default() -> Self { Self::new() } }

#[derive(Debug, thiserror::Error)]
pub enum Argon2Error {
    #[error("derive failed: {0}")] DeriveFailed(String),
    #[error("invalid params: {0}")] InvalidParams(String),
}

pub fn derive_kek(passphrase: &[u8], params: &Argon2Params) -> Result<Zeroizing<[u8; KEK_LEN]>, Argon2Error> {
    if params.salt.len() < SALT_LEN { return Err(Argon2Error::InvalidParams("salt too short".into())); }
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, Params::new(params.m_cost, params.t_cost, params.p_cost, Some(KEK_LEN)).map_err(|e| Argon2Error::InvalidParams(e.to_string()))?);
    let mut out = [0u8; KEK_LEN];
    argon2.hash_password_into(passphrase, &params.salt, &mut out).map_err(|e| Argon2Error::DeriveFailed(e.to_string()))?;
    Ok(Zeroizing::new(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn produces_32_bytes() { let p = Argon2Params::with_params(1024, 1, 1); assert_eq!(derive_kek(b"pass", &p).unwrap().len(), KEK_LEN); }
    #[test] fn deterministic() { let p = Argon2Params::with_params(1024, 1, 1); assert_eq!(*derive_kek(b"pass", &p).unwrap(), *derive_kek(b"pass", &p).unwrap()); }
    #[test] fn different_passphrase() { let p = Argon2Params::with_params(1024, 1, 1); assert_ne!(*derive_kek(b"a", &p).unwrap(), *derive_kek(b"b", &p).unwrap()); }
    #[test] fn camelcase_json() { let p = Argon2Params::with_params(1024, 1, 1); let j = serde_json::to_string(&p).unwrap(); assert!(j.contains("\"mCost\"") && j.contains("\"tCost\"") && j.contains("\"pCost\"")); }
}
