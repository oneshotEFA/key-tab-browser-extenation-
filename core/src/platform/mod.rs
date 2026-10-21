pub mod linux;
pub mod macos;
pub mod windows;

pub type PlatformResult<T> = std::result::Result<T, PlatformError>;

pub trait PlatformKeyProtector {
    fn store_key(&self, key: &[u8; 32]) -> PlatformResult<String>;
    fn retrieve_key(&self, handle: &str) -> PlatformResult<[u8; 32]>;
    fn delete_key(&self, handle: &str) -> PlatformResult<()>;
    fn platform_name(&self) -> &'static str;
}

#[derive(Debug, thiserror::Error)]
pub enum PlatformError {
    #[error("auth cancelled")] AuthCancelled,
    #[error("auth required")] AuthRequired,
    #[error("auth failed: {0}")] AuthFailed(String),
    #[error("key not found: {0}")] KeyNotFound(String),
    #[error("keystore: {0}")] Keystore(String),
    #[error("unsupported")] Unsupported,
}

#[cfg(target_os = "macos")]
pub fn current() -> impl PlatformKeyProtector { macos::KeychainProtector::new() }
#[cfg(target_os = "windows")]
pub fn current() -> impl PlatformKeyProtector { windows::NCryptProtector::new() }
#[cfg(target_os = "linux")]
pub fn current() -> impl PlatformKeyProtector { linux::TestProtector::new() }
