use std::collections::HashMap;
use std::sync::Mutex;
use super::{PlatformError, PlatformKeyProtector};

pub struct TestProtector { keys: Mutex<HashMap<String, [u8; 32]>> }
impl TestProtector { pub fn new() -> Self { Self { keys: Mutex::new(HashMap::new()) } } }
impl PlatformKeyProtector for TestProtector {
    fn store_key(&self, key: &[u8; 32]) -> super::PlatformResult<String> {
        let handle = format!("test-{}", uuid_v4());
        self.keys.lock().unwrap().insert(handle.clone(), *key);
        Ok(handle)
    }
    fn retrieve_key(&self, handle: &str) -> super::PlatformResult<[u8; 32]> {
        self.keys.lock().unwrap().get(handle).copied().ok_or_else(|| PlatformError::KeyNotFound(handle.into()))
    }
    fn delete_key(&self, handle: &str) -> super::PlatformResult<()> {
        self.keys.lock().unwrap().remove(handle).ok_or_else(|| PlatformError::KeyNotFound(handle.into()))?;
        Ok(())
    }
    fn platform_name(&self) -> &'static str { "linux-test-only" }
}

fn uuid_v4() -> String {
    let mut b = [0u8; 16]; rand::rngs::OsRng.fill_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    format!("{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15])
}
use rand::RngCore;
