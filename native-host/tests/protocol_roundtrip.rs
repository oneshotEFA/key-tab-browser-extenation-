use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

const BINARY: &str = env!("CARGO_BIN_EXE_keytap-native-host");
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn frame(json: &[u8]) -> Vec<u8> { let mut o = Vec::with_capacity(4 + json.len()); o.extend_from_slice(&(json.len() as u32).to_le_bytes()); o.extend_from_slice(json); o }
fn read_frame(r: &mut impl Read) -> Vec<u8> {
    let mut len_buf = [0u8; 4]; r.read_exact(&mut len_buf).unwrap();
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len]; r.read_exact(&mut buf).unwrap(); buf
}
fn send_and_recv(frame: &[u8]) -> serde_json::Value {
    let mut child = Command::new(BINARY).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    { let mut si = child.stdin.take().unwrap(); si.write_all(frame).unwrap(); si.flush().unwrap(); }
    let mut so = child.stdout.take().unwrap();
    let raw = match so.read_exact(&mut [0u8; 4]) {
        Ok(_) => { let mut buf = vec![0u8; 4]; /* re-read len */ std::io::copy(&mut so, &mut buf).ok(); buf }
        Err(_) => { let _ = child.wait(); return serde_json::json!({"type":"host_exited"}); }
    };
    // Re-do properly:
    let mut child2 = Command::new(BINARY).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    { let mut si = child2.stdin.take().unwrap(); si.write_all(frame).unwrap(); si.flush().unwrap(); }
    let mut so2 = child2.stdout.take().unwrap();
    let mut len_buf = [0u8; 4];
    match so2.read_exact(&mut len_buf) {
        Ok(_) => {} Err(_) => { let _ = child2.wait(); return serde_json::json!({"type":"host_exited"}); }
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len]; so2.read_exact(&mut buf).unwrap();
    let _ = child2.wait();
    let _ = raw; // unused
    serde_json::from_slice(&buf).unwrap()
}

fn request_child(child: &mut Child, request: &[u8]) -> serde_json::Value {
    child.stdin.as_mut().unwrap().write_all(&frame(request)).unwrap();
    child.stdin.as_mut().unwrap().flush().unwrap();
    serde_json::from_slice(&read_frame(child.stdout.as_mut().unwrap())).unwrap()
}

#[test] fn ping() {
    let req = br#"{"v":1,"id":"r1","type":"ping","payload":{"client":"test","clientVersion":"1.0"}}"#;
    let r = send_and_recv(&frame(req));
    assert_eq!(r["type"], "pong");
    assert!(r["payload"]["capabilities"].as_array().is_some());
}

#[test] fn get_code_requires_vault_unlock() {
    let req = br#"{"v":1,"id":"r2","type":"getCode","payload":{"accountId":"github","origin":"https://github.com"}}"#;
    let r = send_and_recv(&frame(req));
    assert_eq!(r["type"], "error");
    assert_eq!(r["payload"]["code"], "VaultLocked");
    let s = serde_json::to_string(&r).unwrap();
    assert!(!s.to_lowercase().contains("secret"));
}

#[test] fn get_code_wrong_origin() {
    let req = br#"{"v":1,"id":"r3","type":"getCode","payload":{"accountId":"example","origin":"https://evil.example.com"}}"#;
    let r = send_and_recv(&frame(req));
    assert_eq!(r["type"], "error");
    assert_eq!(r["payload"]["code"], "VaultLocked");
}

#[test] fn list_accounts() {
    let req = br#"{"v":1,"id":"r4","type":"listAccounts","payload":{}}"#;
    let r = send_and_recv(&frame(req));
    assert_eq!(r["type"], "accounts");
    assert!(r["payload"]["accounts"].as_array().unwrap().is_empty());
    assert_eq!(r["payload"]["vaultLocked"], true);
}

#[test] fn version_mismatch() {
    let req = br#"{"v":99,"id":"r5","type":"ping","payload":{"client":"t","clientVersion":"1"}}"#;
    let r = send_and_recv(&frame(req));
    assert_eq!(r["type"], "error");
}

#[test]
fn imported_account_survives_host_restart_and_unlock() {
    let home = std::env::temp_dir().join(format!("keytap-host-import-{}-{}", std::process::id(), TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(&home).unwrap();
    let mut child = Command::new(BINARY).env("HOME", &home).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let import = br#"{"v":1,"id":"import-1","type":"addAccount","payload":{"otpauthUri":"otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example","origin":"https://example.com","passphrase":"correct-horse-battery"}}"#;
    let imported = request_child(&mut child, import);
    assert_eq!(imported["type"], "accounts");
    assert_eq!(imported["payload"]["accounts"].as_array().unwrap().len(), 1);
    drop(child.stdin.take());
    assert!(child.wait().unwrap().success());

    let mut restarted = Command::new(BINARY).env("HOME", &home).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let unlock = br#"{"v":1,"id":"unlock-1","type":"unlockVault","payload":{"passphrase":"correct-horse-battery"}}"#;
    let unlocked = request_child(&mut restarted, unlock);
    assert_eq!(unlocked["type"], "status");
    assert_eq!(unlocked["payload"]["vaultLocked"], false);
    let list = br#"{"v":1,"id":"list-1","type":"listAccounts","payload":{}}"#;
    let accounts = request_child(&mut restarted, list);
    assert_eq!(accounts["payload"]["accounts"].as_array().unwrap().len(), 1);

    // When already unlocked, importing a second account does not require passphrase:
    let import2 = br#"{"v":1,"id":"import-2","type":"addAccount","payload":{"otpauthUri":"otpauth://totp/Example:bob?secret=JBSWY3DPEHPK3PXP&issuer=Example","origin":"https://example.com","passphrase":""}}"#;
    let imported2 = request_child(&mut restarted, import2);
    assert_eq!(imported2["type"], "accounts");
    assert_eq!(imported2["payload"]["accounts"].as_array().unwrap().len(), 2);

    let account_id = imported2["payload"]["accounts"][0]["id"].as_str().unwrap();
    let delete_req = format!(r#"{{"v":1,"id":"del-1","type":"deleteAccount","payload":{{"accountId":"{account_id}"}}}}"#);
    let deleted = request_child(&mut restarted, delete_req.as_bytes());
    assert_eq!(deleted["type"], "accounts");
    assert_eq!(deleted["payload"]["accounts"].as_array().unwrap().len(), 1);

    drop(restarted.stdin.take());
    assert!(restarted.wait().unwrap().success());
    std::fs::remove_dir_all(home).unwrap();
}
