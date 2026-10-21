use std::io::{Read, Write};
use std::process::{Command, Stdio};

const BINARY: &str = env!("CARGO_BIN_EXE_keytap-native-host");

fn frame(json: &[u8]) -> Vec<u8> { let mut o = Vec::with_capacity(4 + json.len()); o.extend_from_slice(&(json.len() as u32).to_le_bytes()); o.extend_from_slice(json); o }

fn response_json(frame: &[u8]) -> serde_json::Value {
    let mut child = Command::new(BINARY).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    { let mut si = child.stdin.take().unwrap(); si.write_all(frame).unwrap(); si.flush().unwrap(); }
    let mut so = child.stdout.take().unwrap();
    let mut len_buf = [0u8; 4];
    match so.read_exact(&mut len_buf) {
        Ok(_) => {} Err(_) => { let _ = child.wait(); return serde_json::json!({"type":"host_exited"}); }
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len]; so.read_exact(&mut buf).unwrap();
    let _ = child.wait();
    serde_json::from_slice(&buf).unwrap()
}

#[test] fn attack_evil_etld() {
    let req = br#"{"v":1,"id":"a1","type":"getCode","payload":{"accountId":"example","origin":"https://evil.example.com"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "OriginMismatch");
}
#[test] fn attack_subdomain() {
    let req = br#"{"v":1,"id":"a2","type":"getCode","payload":{"accountId":"github","origin":"https://attacker.github.com"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "OriginMismatch");
}
#[test] fn attack_http() {
    let req = br#"{"v":1,"id":"a3","type":"getCode","payload":{"accountId":"github","origin":"http://github.com"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "OriginMismatch");
}
#[test] fn attack_userinfo() {
    let req = br#"{"v":1,"id":"a4","type":"getCode","payload":{"accountId":"github","origin":"https://user:pass@github.com"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "OriginMismatch");
}
#[test] fn attack_path() {
    let req = br#"{"v":1,"id":"a5","type":"getCode","payload":{"accountId":"github","origin":"https://github.com/login"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "OriginMismatch");
}
#[test] fn attack_port() {
    let req = br#"{"v":1,"id":"a6","type":"getCode","payload":{"accountId":"github","origin":"https://github.com:8443"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "OriginMismatch");
}
#[test] fn attack_missing_origin() {
    let req = br#"{"v":1,"id":"a7","type":"getCode","payload":{"accountId":"github"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "InvalidRequest");
}
#[test] fn attack_missing_account_id() {
    let req = br#"{"v":1,"id":"a8","type":"getCode","payload":{"origin":"https://github.com"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "InvalidRequest");
}
#[test] fn attack_wrong_type_for_origin() {
    let req = br#"{"v":1,"id":"a9","type":"getCode","payload":{"accountId":"github","origin":12345}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "InvalidRequest");
}
#[test] fn attack_unknown_type() {
    let req = br#"{"v":1,"id":"a10","type":"exfiltrate","payload":{}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["type"], "error");
}
#[test] fn attack_secret_request() {
    let reqs: &[&[u8]] = &[
        br#"{"v":1,"id":"a11","type":"getSecret","payload":{"accountId":"github"}}"#,
        br#"{"v":1,"id":"a12","type":"dumpVault","payload":{}}"#,
    ];
    for req in reqs {
        let r = response_json(&frame(req));
        assert_eq!(r["type"], "error");
        let s = serde_json::to_string(&r).unwrap();
        assert!(!s.contains("secret"));
    }
}
#[test] fn attack_version_zero() {
    let req = br#"{"v":0,"id":"a13","type":"ping","payload":{"client":"t","clientVersion":"1"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "ProtocolVersionMismatch");
}
#[test] fn attack_empty_id() {
    let req = br#"{"v":1,"id":"","type":"ping","payload":{"client":"t","clientVersion":"1"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "InvalidRequest");
}
#[test] fn attack_whitespace_id() {
    let req = br#"{"v":1,"id":"   ","type":"ping","payload":{"client":"t","clientVersion":"1"}}"#;
    let r = response_json(&frame(req));
    assert_eq!(r["payload"]["code"], "InvalidRequest");
}
