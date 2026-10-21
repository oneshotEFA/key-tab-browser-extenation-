use super::{PlatformError, PlatformKeyProtector};

pub struct KeychainProtector { #[allow(dead_code)] service: String }
impl KeychainProtector { pub fn new() -> Self { Self { service: "com.keytap.nativehost".into() } } }
impl PlatformKeyProtector for KeychainProtector {
    fn store_key(&self, _: &[u8; 32]) -> super::PlatformResult<String> { Err(PlatformError::Unsupported) }
    fn retrieve_key(&self, _: &str) -> super::PlatformResult<[u8; 32]> { Err(PlatformError::Unsupported) }
    fn delete_key(&self, _: &str) -> super::PlatformResult<()> { Err(PlatformError::Unsupported) }
    fn platform_name(&self) -> &'static str { "macos-keychain-biometry" }
}
