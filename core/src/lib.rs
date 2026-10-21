pub mod backup;
pub mod crypto;
pub mod lock;
pub mod origin;
pub mod platform;
pub mod protocol;
pub mod qr;
pub mod totp;
pub mod vault;

pub use backup::{export_backup, import_backup, BackupError, BackupFile};
pub use lock::{LockConfig, LockState, LockStateError};
pub use origin::{check_origin, OriginCheck, OriginError};
pub use protocol::{
    AccountSummary, ErrorCode, ExtensionRequest, NativeHostResponse, ProtocolError,
    PROTOCOL_VERSION,
};
pub use qr::{decode_otpauth_from_png, parse_otpauth_uri, OtpAuthAccount, QrError};
pub use totp::{base32_decode, TotpAlgorithm, TotpError, TotpGenerator};
pub use vault::{Vault, VaultError, VaultStatus};

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("origin not authorized: {0}")]
    Origin(#[from] OriginError),
    #[error("vault error: {0}")]
    Vault(#[from] VaultError),
    #[error("totp error: {0}")]
    Totp(#[from] TotpError),
    #[error("lock state error: {0}")]
    Lock(#[from] LockStateError),
    #[error("protocol error: {0}")]
    Protocol(#[from] ProtocolError),
}
