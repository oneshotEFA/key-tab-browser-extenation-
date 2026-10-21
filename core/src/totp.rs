use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use zeroize::Zeroizing;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TotpAlgorithm { Sha1, Sha256, Sha512 }

impl TotpAlgorithm {
    pub fn from_str_ci(s: &str) -> Option<Self> {
        match s.to_ascii_uppercase().as_str() {
            "SHA1" | "SHA-1" => Some(Self::Sha1),
            "SHA256" | "SHA-256" => Some(Self::Sha256),
            "SHA512" | "SHA-512" => Some(Self::Sha512),
            _ => None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TotpError {
    #[error("invalid secret length: {0} bytes")]
    InvalidSecretLength(usize),
    #[error("unsupported digits: {0}")]
    UnsupportedDigits(u32),
    #[error("unsupported period: {0}")]
    UnsupportedPeriod(u32),
    #[error("HMAC error: {0}")]
    Hmac(String),
}

#[derive(Debug, Clone)]
pub struct TotpGenerator {
    secret: Zeroizing<Vec<u8>>,
    algorithm: TotpAlgorithm,
    digits: u32,
    period: u32,
}

impl TotpGenerator {
    pub fn new(secret: Vec<u8>, algorithm: TotpAlgorithm, digits: u32, period: u32) -> Result<Self, TotpError> {
        if secret.is_empty() { return Err(TotpError::InvalidSecretLength(secret.len())); }
        if !(6..=8).contains(&digits) { return Err(TotpError::UnsupportedDigits(digits)); }
        if period == 0 { return Err(TotpError::UnsupportedPeriod(period)); }
        Ok(Self { secret: Zeroizing::new(secret), algorithm, digits, period })
    }

    pub fn generate(&self, time_unix_secs: u64) -> Result<String, TotpError> {
        let counter = time_unix_secs / (self.period as u64);
        let code = match self.algorithm {
            TotpAlgorithm::Sha1 => compute_hotp::<Hmac<Sha1>>(&self.secret, counter, self.digits)?,
            TotpAlgorithm::Sha256 => compute_hotp::<Hmac<Sha256>>(&self.secret, counter, self.digits)?,
            TotpAlgorithm::Sha512 => compute_hotp::<Hmac<Sha512>>(&self.secret, counter, self.digits)?,
        };
        Ok(code)
    }

    pub fn ms_remaining(&self, time_unix_ms: u64) -> u64 {
        let step_ms = (self.period as u64) * 1000;
        let elapsed = time_unix_ms % step_ms;
        step_ms - elapsed
    }

    pub fn period(&self) -> u32 { self.period }
    pub fn digits(&self) -> u32 { self.digits }
}

fn compute_hotp<D>(secret: &[u8], counter: u64, digits: u32) -> Result<String, TotpError>
where D: Mac + KeyInit {
    let mut mac = <D as Mac>::new_from_slice(secret)
        .map_err(|e| TotpError::Hmac(format!("key init: {e}")))?;
    mac.update(&counter.to_be_bytes());
    let hash = mac.finalize().into_bytes();
    let offset = (hash[hash.len() - 1] & 0x0f) as usize;
    let binary: u32 = (((hash[offset] & 0x7f) as u32) << 24)
        | ((hash[offset + 1] as u32) << 16)
        | ((hash[offset + 2] as u32) << 8)
        | (hash[offset + 3] as u32);
    let modulo = 10u32.pow(digits);
    Ok(format!("{:0>digits$}", binary % modulo, digits = digits as usize))
}

pub fn base32_decode(input: &str) -> Result<Vec<u8>, TotpError> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let cleaned: String = input.trim_end_matches('=').chars().filter(|c| !c.is_whitespace()).map(|c| c.to_ascii_uppercase()).collect();
    let mut bits: u32 = 0;
    let mut bits_left: u32 = 0;
    let mut out = Vec::with_capacity(cleaned.len() * 5 / 8);
    for ch in cleaned.chars() {
        let val = ALPHABET.iter().position(|&a| a as char == ch)
            .ok_or_else(|| TotpError::Hmac(format!("invalid base32: {ch}")))? as u32;
        bits = (bits << 5) | val;
        bits_left += 5;
        if bits_left >= 8 {
            bits_left -= 8;
            out.push(((bits >> bits_left) & 0xff) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rfc6238_seed(byte_len: usize) -> Vec<u8> {
        let digits = b"1234567890";
        let mut out = Vec::with_capacity(byte_len);
        let mut i = 0;
        while out.len() < byte_len { out.push(digits[i % digits.len()]); i += 1; }
        out
    }

    #[test]
    fn rfc6238_sha1() {
        let totp = TotpGenerator::new(rfc6238_seed(20), TotpAlgorithm::Sha1, 8, 30).unwrap();
        assert_eq!(totp.generate(59).unwrap(), "94287082");
        assert_eq!(totp.generate(1_111_111_109).unwrap(), "07081804");
        assert_eq!(totp.generate(1_111_111_111).unwrap(), "14050471");
        assert_eq!(totp.generate(1_234_567_890).unwrap(), "89005924");
        assert_eq!(totp.generate(2_000_000_000).unwrap(), "69279037");
        assert_eq!(totp.generate(20_000_000_000).unwrap(), "65353130");
    }

    #[test]
    fn rfc6238_sha256() {
        let totp = TotpGenerator::new(rfc6238_seed(32), TotpAlgorithm::Sha256, 8, 30).unwrap();
        assert_eq!(totp.generate(59).unwrap(), "46119246");
        assert_eq!(totp.generate(1_111_111_109).unwrap(), "68084774");
        assert_eq!(totp.generate(1_234_567_890).unwrap(), "91819424");
    }

    #[test]
    fn rfc6238_sha512() {
        let totp = TotpGenerator::new(rfc6238_seed(64), TotpAlgorithm::Sha512, 8, 30).unwrap();
        assert_eq!(totp.generate(59).unwrap(), "90693936");
        assert_eq!(totp.generate(1_111_111_109).unwrap(), "25091201");
    }

    #[test]
    fn six_digit() {
        let totp = TotpGenerator::new(rfc6238_seed(20), TotpAlgorithm::Sha1, 6, 30).unwrap();
        assert_eq!(totp.generate(59).unwrap(), "287082");
    }

    #[test]
    fn base32_roundtrip() {
        assert_eq!(base32_decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").unwrap(), b"12345678901234567890");
    }
}
