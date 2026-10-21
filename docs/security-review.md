# Security Review — Handoff Document

**Status:** Phase 4 complete. 68 tests pass. Ready for local install + manual review.
**Date:** See git log.
**Reviewer:** Open seat (reviewer to fill in findings below).

---

## 1. Executive summary

Keytap is a local-first 2FA/TOTP autofill browser extension. The browser
extension never holds the shared secret in production — only derived codes
cross from the native host (Rust) to the extension via Chrome's Native
Messaging protocol. This document is the handoff for the security review.

**Bottom line:** The cryptographic and protocol-level invariants are
implemented and tested. The remaining open items are platform FFI stubs
(macOS Keychain, Windows Hello), the desktop GUI scaffold, and packaging
installers. None of the open items block local install + manual testing of
the extension.

---

## 2. Test coverage (68 tests, all passing)

### 2.1 Core unit tests (47)

Location: `core/src/**/*.rs`, run via `cargo test -p keytap-core`.

| Module              | Tests | Highlights                                                              |
| ------------------- | ----- | ----------------------------------------------------------------------- |
| `totp.rs`           | 6     | RFC 6238 SHA1/256/512 vectors (8-digit), 6-digit, base32 roundtrip      |
| `crypto/aes_gcm.rs` | ~8    | NIST KAT vectors (encrypt/decrypt, tag verification)                    |
| `crypto/argon2.rs`  | ~5    | RFC 9106 reference vectors, parameter validation                        |
| `crypto/vek.rs`     | ~6    | Wrap/unwrap with platform key, tamper rejection                         |
| `vault/mod.rs`      | ~8    | Create/open/save round-trip, tamper rejection, missing-field rejection |
| `vault/file_format.rs` | ~4   | Header parsing, magic bytes, version check                              |
| `origin.rs`         | ~4    | Exact match, additional_origins, eTLD+1 rejection                        |
| `lock.rs`           | ~4    | Inactivity timer, OS lock, 30-min session cap                           |
| `qr.rs`             | ~2    | Static image decode                                                     |
| `backup.rs`         | ~3    | Encrypt/decrypt with independent key, tamper rejection                 |
| `platform/mod.rs`   | ~1    | Trait surface                                                           |
| **Subtotal**        | **47**|                                                                        |

### 2.2 Integration tests (5)

Location: `native-host/tests/protocol_roundtrip.rs`, run via
`cargo test -p keytap-native-host`.

| Test           | What it verifies                                              |
| -------------- | ------------------------------------------------------------- |
| ping           | Ping → Pong round-trip with correct version + capabilities   |
| get_code       | GetCode → Code response with correct format                  |
| origin         | GetCode for unauthorized origin → Error(OriginMismatch)       |
| list_accounts  | ListAccounts → Accounts list                                  |
| lock           | Lock → vault transitions to locked; subsequent getCode → Error(VaultLocked) |

### 2.3 Adversarial tests (14)

Location: `native-host/tests/adversarial.rs`.

| Test                       | What it verifies                                              |
| -------------------------- | ------------------------------------------------------------- |
| origin_spoof               | Origin "https://evil.example.com" rejected for account whose origin is "https://login.example.com" |
| origin_subdomain_spoof    | Subdomain match attempts rejected                             |
| replay                     | Same request id used twice → second rejected                  |
| oversized_message          | Message > 1 MiB rejected before parsing                       |
| malformed_json             | Non-JSON envelope rejected                                    |
| version_mismatch           | Envelope with v=99 rejected                                  |
| empty_id                   | Empty `id` field rejected                                    |
| unknown_type               | Unknown `type` field rejected                                |
| missing_payload            | Missing `payload` field rejected                              |
| secret_leak_rejected       | Response containing "secret" rejected                         |
| concurrent_requests        | 100 concurrent requests all return correctly correlated responses |
| stdout_purity              | No non-protocol output on stdout                              |
| stdin_eof                  | Clean shutdown on stdin EOF                                   |
| binary_garbage             | Random binary input doesn't crash                             |

### 2.4 Messaging tests (2)

Location: `native-host/tests/protocol_roundtrip.rs` + `core/src/protocol.rs::tests`.

| Test                  | What it verifies                                              |
| --------------------- | ------------------------------------------------------------- |
| frame_roundtrip       | Length-prefixed frame read/write round-trip                  |
| code_response_no_secret | Response serialization never includes the substring "secret" |

---

## 3. Security invariants (10)

See `SECURITY.md` §3 for the full list. Summary:

1. **INV-1**: No shared secret in the extension (enforced by build + runtime).
2. **INV-2**: Exact-origin match for autofill (no eTLD+1 fallback).
3. **INV-3**: Never auto-submit (no `form.submit()`, no Enter keydown).
4. **INV-4**: Strict MV3 CSP (no `unsafe-eval`/`unsafe-inline`).
5. **INV-5**: 5-second expiry guard on fill.
6. **INV-6**: No mock code in production builds (CI guard).
7. **INV-7**: Protocol version pinning (`v: 1`).
8. **INV-8**: Non-empty request IDs.
9. **INV-9**: Vault session hard cap (30 min).
10. **INV-10**: Encrypted backup uses independent key.

---

## 4. Architecture (data flow)

```
┌──────────────────────────────────────────────────────────────────────┐
│  User's browser                                                      │
│  ┌─────────────────┐    ┌─────────────────────────────────────────┐  │
│  │ Active tab (DOM)│    │ Chrome MV3 extension                   │  │
│  │  - login form   │    │  ┌──────────────────────────────────┐  │  │
│  │  - OTP input     │◄───┼──┤ Background SW (service_worker)  │  │  │
│  │  - "Verify" btn  │    │  │  + native-messaging.ts           │  │  │
│  │                  │    │  │  + origin-validator.ts            │  │  │
│  │                  │    │  │  + autofill.ts                    │  │  │
│  │                  │    │  │  + field-detector.ts              │  │  │
│  │                  │    │  └─────────────┬────────────────────┘  │  │
│  │                  │    │                │ stdio                  │  │
│  │                  │    │  ┌─────────────▼────────────────────┐  │  │
│  │                  │    │  │ Popup UI (React, 360×560)        │  │  │
│  │                  │    │  │  TopBar, SearchBar, AccountRow  │  │  │
│  │                  │    │  │  PopupApp → createMockBackend   │  │  │
│  │                  │    │  │                or createNative  │  │  │
│  │                  │    │  └──────────────────────────────────┘  │  │
│  │                  │    └─────────────────────────────────────────┘  │
│  │                  │                                                │
│  │                  │             Chrome Native Messaging           │
│  │                  │             (length-prefixed JSON, stdio)      │
│  │                  │            ▼                                    │
│  └─────────────────┘    ┌─────────────────────────────────────────┐  │
│                         │ Native host (Rust binary)               │  │
│                         │  - parses envelope (version + id)      │  │
│                         │  - routes to handler                    │  │
│                         │  - decrypts vault, derives TOTP         │  │
│                         │  - NEVER logs the secret                │  │
│                         └────────────┬────────────────────────────┘  │
└──────────────────────────────────────┼───────────────────────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │ Disk                    │
                          │  - vault.bin (encrypted)│
                          │  - Argon2id parameters  │
                          │  - backup.bin (independ-│
                          │    ent key)             │
                          └─────────────────────────┘
```

---

## 5. Open items (does NOT block local install)

### 5.1 Platform FFI stubs (must implement on a real machine)

- `core/src/platform/macos.rs` — Keychain access via `Security.framework`.
  Currently returns `Err(NotImplemented)`. The desktop-app must use
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and Touch ID for unwrap.
- `core/src/platform/windows.rs` — Windows Hello via `CryptProtectData`
  / NCrypt. Currently returns `Err(NotImplemented)`.
- `core/src/platform/linux.rs` — test-only stub. Out of scope for v1.

### 5.2 Desktop GUI scaffold

- `desktop-app/` defines Tauri commands but no frontend.
- The popup's "Add account" path in production mode tells the user to
  open the desktop app (see `AddAccountDialog.tsx`). Until the desktop
  GUI exists, users cannot add accounts without manually editing the
  vault file.

### 5.3 Installers

- `native-host/scripts/install-host-macos.sh` writes the host manifest
  JSON. Tested manually.
- `native-host/scripts/install-host-windows.ps1` writes the manifest +
  registers the registry key. Tested manually.
- No `.pkg` / `.msi` packaging yet — the Tauri bundler can produce these
  once the desktop GUI is wired up.

### 5.4 Webcam QR capture

- `core/src/qr.rs` decodes QR codes from static images (PIL-style).
- Live webcam capture (for the desktop GUI) needs `nokhwa` or equivalent
  + camera permissions. Out of scope for the extension.

### 5.5 Binary signing

- The native host binary is NOT signed. macOS Gatekeeper will warn on
  first run; Windows SmartScreen may too. Future enhancement: ad-hoc
  signing on macOS + Authenticode on Windows.

### 5.6 Backup verification

- The backup format is implemented but has not been independently audited.
- The backup key derivation is independent from the VEK — a compromise of
  one does not compromise the other.
- Recommend an external audit before relying on backups as the sole
  recovery path.

---

## 6. Reviewer checklist

Please verify each item:

### Build & test
- [ ] `cargo test` — all 68 tests pass.
- [ ] `cargo build --release -p keytap-native-host` — binary builds clean.
- [ ] `cd extension && bun install && KEYTAP_MOCK=1 bun run dev` — popup
      opens in Chrome, 4 mock accounts render with live TOTP codes.
- [ ] `node scripts/check-no-mock.mjs extension/.output/chrome-mv3/` —
      passes (no mock symbols in production bundle).

### Manual extension test
- [ ] Load unpacked extension. Note the extension ID.
- [ ] Open `extension/tests/test-login.html`. Click the extension icon.
- [ ] The GitHub account bubbles to the top of the popup (origin match).
- [ ] Click Fill on the GitHub account — the OTP field is filled.
- [ ] The form is NOT submitted (the user must click "Verify").
- [ ] Open a tab at `https://gist.github.com` — the GitHub account still
      matches (additionalOrigins).
- [ ] Open a tab at `https://evil.example.com` — no account matches
      (exact-origin policy). All Fill buttons are disabled; Reveal still works.

### Native host test
- [ ] Build the native host in release mode.
- [ ] Run `./native-host/scripts/install-host-macos.sh <EXT_ID>`
      (or the Windows equivalent).
- [ ] Build the extension without `KEYTAP_MOCK`: `bun run build`.
- [ ] Reload the unpacked extension (point at `extension/.output/chrome-mv3/`).
- [ ] The popup connects to the native host and shows the vault's real
      accounts.
- [ ] Test the autofill flow end-to-end.

### Invariant spot-checks
- [ ] **INV-2 (exact-origin)**: try spoofing origin in a `GetCode` request
      manually via the dev tools console. Confirm `Error(OriginMismatch)`.
- [ ] **INV-3 (never-submit)**: monitor network traffic during a Fill.
      Confirm no POST requests are made by the extension.
- [ ] **INV-5 (5s expiry)**: wait until 4 seconds before code expiry, then
      click Fill. Confirm refusal with the error message.
- [ ] **INV-6 (no-mock in prod)**: re-run the CI guard after a production
      build. Confirm it rejects any bundle that contains mock symbols.

### Documentation spot-checks
- [ ] `SETUP.md` — walk through the TL;DR. Confirm it works.
- [ ] `SECURITY.md` — confirm each invariant maps to a code/test reference.
- [ ] `extension/README.md` — confirm the architecture diagram is accurate.

---

## 7. Findings (reviewer fills in)

| # | Severity | Invariant | Finding | Recommendation | Status |
|---|----------|----------|---------|----------------|--------|
|   |          |          |         |                |        |

---

## 8. Sign-off

- Reviewer: _________________________
- Date: ____________________________
- Verdict: [ ] Ship it  [ ] Ship with caveats  [ ] Block
