use super::{PlatformError, PlatformKeyProtector};

pub struct NCryptProtector { #[allow(dead_code)] provider: String }
impl NCryptProtector { pub fn new() -> Self { Self { provider: "MS_PLATFORM_KEY_STORAGE_PROVIDER".into() } } }
impl PlatformKeyProtector for NCryptProtector {
    fn store_key(&self, _: &[u8; 32]) -> super::PlatformResult<String> { Err(PlatformError::Unsupported) }
    fn retrieve_key(&self, _: &str) -> super::PlatformResult<[u8; 32]> { Err(PlatformError::Unsupported) }
    fn delete_key(&self, _: &str) -> super::PlatformResult<()> { Err(PlatformError::Unsupported) }
    fn platform_name(&self) -> &'static str { "windows-ncrypt-hello" }
}
