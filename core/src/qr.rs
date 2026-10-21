use image::GrayImage;
use rqrr::PreparedImage;
use url::Url;
use zeroize::Zeroizing;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtpAuthAccount {
    pub account_type: String, pub label: String, pub issuer: Option<String>,
    pub secret: String, pub algorithm: String, pub digits: u32, pub period: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum QrError {
    #[error("image decode: {0}")] ImageDecode(String),
    #[error("QR: {0}")] Qr(#[from] rqrr::DeQRError),
    #[error("not found")] NotFound,
    #[error("not otpauth: {0}")] NotOtpAuth(String),
    #[error("invalid: {0}")] InvalidOtpAuth(String),
}

pub fn decode_otpauth_from_png(png: &[u8]) -> Result<OtpAuthAccount, QrError> {
    let img = image::load_from_memory(png).map_err(|e| QrError::ImageDecode(e.to_string()))?.to_luma8();
    decode_otpauth_from_image(&img)
}

pub fn decode_otpauth_from_image(img: &GrayImage) -> Result<OtpAuthAccount, QrError> {
    let w = img.width() as usize;
    let h = img.height() as usize;
    let mut prepared = PreparedImage::prepare_from_greyscale(w, h, |x, y| img.get_pixel(x as u32, y as u32).0[0]);
    for grid in prepared.detect_grids() {
        let (_meta, text) = grid.decode()?;
        if text.starts_with("otpauth://") { return parse_otpauth_uri(&text); }
    }
    Err(QrError::NotFound)
}

pub fn parse_otpauth_uri(uri: &str) -> Result<OtpAuthAccount, QrError> {
    let url = Url::parse(uri).map_err(|e| QrError::InvalidOtpAuth(e.to_string()))?;
    if url.scheme() != "otpauth" { return Err(QrError::NotOtpAuth(uri.into())); }
    let account_type = url.host_str().unwrap_or("totp").to_lowercase();
    if account_type != "totp" && account_type != "hotp" { return Err(QrError::InvalidOtpAuth(format!("type: {account_type}"))); }
    let label = url.path().trim_start_matches('/').to_string();
    let issuer_from_label = if label.contains(':') { label.split(':').next().map(|s| s.trim().to_string()) } else { None };
    let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
    let secret = params.get("secret").ok_or_else(|| QrError::InvalidOtpAuth("missing secret".into()))?.to_string();
    let issuer = params.get("issuer").map(|s| s.to_string()).or(issuer_from_label);
    let algorithm = params.get("algorithm").map(|s| s.to_uppercase()).unwrap_or_else(|| "SHA1".into());
    let digits = params.get("digits").and_then(|s| s.parse().ok()).unwrap_or(6);
    let period = params.get("period").and_then(|s| s.parse().ok()).unwrap_or(30);
    Ok(OtpAuthAccount { account_type, label, issuer, secret, algorithm, digits, period })
}

pub fn zeroize_secret(a: &OtpAuthAccount) -> Zeroizing<String> { Zeroizing::new(a.secret.clone()) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn parse_standard() {
        let uri = "otpauth://totp/GitHub:user@ex.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30";
        let a = parse_otpauth_uri(uri).unwrap();
        assert_eq!(a.issuer, Some("GitHub".into()));
        assert_eq!(a.secret, "JBSWY3DPEHPK3PXP");
    }
    #[test] fn defaults() {
        let a = parse_otpauth_uri("otpauth://totp/Acme:bob?secret=JBSWY3DPEHPK3PXP").unwrap();
        assert_eq!(a.algorithm, "SHA1"); assert_eq!(a.digits, 6); assert_eq!(a.period, 30);
    }
    #[test] fn reject_non_otpauth() { assert!(parse_otpauth_uri("https://github.com").is_err()); }
    #[test] fn reject_missing_secret() { assert!(parse_otpauth_uri("otpauth://totp/A:b?issuer=A").is_err()); }
}
