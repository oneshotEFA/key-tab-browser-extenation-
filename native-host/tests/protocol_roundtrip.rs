use std::io::{Read, Write};
use std::process::{Command, Stdio};

const BINARY: &str = env!("CARGO_BIN_EXE_keytap-native-host");

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

#[test] fn ping() {
    let req = br#"{"v":1,"id":"r1","type":"ping","payload":{"client":"test","clientVersion":"1.0"}}"#;
    let r = send_and_recv(&frame(req));
    assert_eq!(r["type"], "pong");
    assert!(r["payload"]["capabilities"].as_array().is_some());
}

#[test] fn get_code_matching_origin() {
    let req = br#"{"v":1,"id":"r2","type":"getCode","payload":{"accountId":"github","origin":"https://github.com"}}"#;
    let r = send_and_recv(&frame(req));
    assert_eq!(r["type"], "code");
    let s = serde_json::to_string(&r).unwrap();
    assert!(!s.to_lowercase().contains("secret"));
}

#[test] fn get_code_wrong_origin() {
    let req = br#"{"v":1,"id":"r3","type":"getCode","payload":{"accountId":"example","origin":"https://evil.example.com"}}"#;
    let r = send_and_recv(&frame(req));
    assert_eq!(r["type"], "error");
    assert_eq!(r["payload"]["code"], "OriginMismatch");
}

#[test] fn list_accounts() {
    let req = br#"{"v":1,"id":"r4","type":"listAccounts","payload":{}}"#;
    let r = send_and_recv(&frame(req));
    assert_eq!(r["type"], "accounts");
    assert!(r["payload"]["accounts"].as_array().unwrap().len() >= 4);
}

#[test] fn version_mismatch() {
    let req = br#"{"v":99,"id":"r5","type":"ping","payload":{"client":"t","clientVersion":"1"}}"#;
    let r = send_and_recv(&frame(req));
    assert_eq!(r["type"], "error");
}
