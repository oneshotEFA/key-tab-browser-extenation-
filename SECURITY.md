# Security Policy

This document describes the threat model, security invariants, build
security, and dependency policy for Keytap.

---

## 1. Overview

Keytap is a **local-first 2FA/TOTP autofill** browser extension. Shared
secrets (the symmetric keys used to derive TOTP codes) live in an encrypted
vault on disk; only derived codes cross from the native host to the browser
extension. The extension never holds a shared secret in production mode.

**Trusted Computing Base (TCB):**

| Component             | Runs where                       | Holds secret? | Attack surface            |
| --------------------- | -------------------------------- | ------------- | ------------------------- |
| Rust core             | Native host process (out-of-band browser) | YES (in memory, decrypted vault) | Memory disclosure, side channels |
| Native host binary    | User OS, spawned by Chrome       | YES (inherits from core) | Binary tampering, privilege escalation |
| Browser extension     | Chrome MV3 service worker + popup | **NO**        | XSS, origin spoofing, MitM |
| Native messaging wire | Chrome-managed stdio pipe        | NO (only derived codes) | Sniffing, injection |
| Vault file            | Disk, AES-256-GCM encrypted      | YES (at rest, encrypted) | File theft, offline brute force |

The browser, the renderer process, and any compromised web page are
**untrusted** from the perspective of the vault.

---

## 2. Threat Model

### Assets
- **A1: Shared secrets** in the vault (the actual TOTP seed for each account).
- **A2: Derived TOTP codes** (short-lived, 6-8 digits).
- **A3: Vault passphrase** (Argon2id-derived, never stored).
- **A4: Vault encryption key** (VEK — wrapped by Argon2id + platform key).

### Attackers
- **M1: Malicious web page** — runs JS in a tab; can read DOM, dispatch events,
  attempt to exfiltrate via network. Cannot read the extension's storage
  directly (origin isolation).
- **M2: Malicious extension** — another extension installed in the same
  browser. Cannot read Keytap's storage (`chrome.storage.local` is scoped
  per-extension) and cannot intercept native-messaging traffic.
- **M3: Network MitM** — between the user and a website. Cannot read native
  messaging (it's stdio, not networked).
- **M4: Local attacker with disk read access** — can read the vault file
  but not decrypt it without the passphrase (Argon2id, ~256 MiB memory,
  3 iterations — see crypto/argon2.rs).
- **M5: Local attacker with process memory access** — can read the decrypted
  vault from the native host process memory. Out of scope beyond standard
  OS protections (process isolation, mlock if available).

### Security goals (per attacker)
- vs M1 (malicious web page):
  - G1.1: Cannot exfiltrate a code into a non-matching origin.
  - G1.2: Cannot fill a code into a page whose origin doesn't EXACTLY match
    an authorized origin (no eTLD+1 fallback).
  - G1.3: Cannot submit a form via Keytap (never-auto-submit invariant).
  - G1.4: Cannot read codes belonging to other origins even if it can read
    the popup's DOM (the popup only renders codes for the active origin).

- vs M2 (malicious extension):
  - G2.1: Cannot read Keytap's `chrome.storage.local`.
  - G2.2: Cannot call `chrome.runtime.connectNative("com.keytap.nativehost")`
    (native messaging host manifest's `allowed_origins` is the gatekeeper).
  - G2.3: Cannot forge messages from Keytap's background SW.

- vs M3 (network MitM):
  - G3.1: Cannot read or modify native messaging traffic (not networked).
  - G3.2: Cannot impersonate a website (TLS + exact-origin match).

- vs M4 (disk attacker):
  - G4.1: Cannot decrypt the vault without the passphrase.
  - G4.2: Cannot tamper with the vault undetected (AES-GCM auth tag).

---

## 3. Security Invariants

These invariants are enforced in code and tested by the test suite.

### INV-1: No shared secret in the extension

The browser extension never holds the shared secret in production builds.
Only derived TOTP codes (short-lived, 6-8 digits) cross the native-messaging
wire. Enforced by:

- `packages/protocol/messages.ts` — no `secret` field in any protocol type.
- `extension/services/native-messaging.ts` — `validateResponse()` rejects any
  response containing the substring "secret".
- `scripts/check-no-mock.mjs` — production builds reject any file that
  imports `@keytap/lib/totp`, `@keytap/lib/mock-accounts`, or
  `@keytap/lib/mock-mode`.

Tested by: `core::totp::tests::*`, `native-host/tests/protocol_roundtrip.rs`,
`extension/services/native-messaging.ts::sendRequest`.

### INV-2: Exact-origin match for autofill

`https://gist.github.com` does NOT match `https://github.com`. Same-eTLD+1
origins are explicitly rejected. The native host performs the same check
(defense in depth).

Enforced by:
- `extension/services/origin-validator.ts::authorizeAutofill()`
- `core/src/origin.rs::origin_matches()`
- `native-host/src/handler.rs` (rejects GetCode for non-authorized origins)

Tested by: `core::origin::tests::*`, `native-host/tests/adversarial.rs::origin_spoof`.

### INV-3: Never auto-submit

Fill = set the input value + dispatch `input`/`change` events. NEVER call
`form.submit()` and NEVER dispatch an Enter keydown. Enforced by:

- `extension/services/autofill.ts::executeFill()` — only sets value + events.
- `extension/entrypoints/background.ts` — `executeFill` is the only fill path.
- The popup UI exposes `neverAutoSubmit` as a read-only, always-on toggle.

Tested by: `extension/tests/test-login.html` (manual — submit button must be
clicked by the user to send the form).

### INV-4: Strict Content Security Policy

MV3 CSP: `script-src 'self'; object-src 'self'; base-uri 'self';
frame-ancestors 'none';`

No `unsafe-eval`, no `unsafe-inline`, no remote origins. Enforced by
`extension/wxt.config.ts::content_security_policy.extension_pages`.

### INV-5: 5-second expiry guard on fill

A code is safe to fill iff its expiry is at least 5 seconds in the future.
Codes about to expire are refused — the user wouldn't have time to submit.

Enforced by `extension/services/autofill.ts::isCodeSafeToFill()`.

### INV-6: No mock code in production builds

The mock backend contains a hard-coded RFC 6238 test vector secret. It is
NEVER safe to ship in production. Enforced by:

- `scripts/check-no-mock.mjs` — scans production bundle, rejects any file
  that imports `@keytap/lib/totp`, `@keytap/lib/mock-accounts`,
  `@keytap/lib/mock-mode`, or contains `MOCK_ACCOUNTS` / `RFC6238_TEST_SECRET`.
- `extension/services/mock-mode.ts::assertNotMockMode()` — runtime check.
- `src/components/keytap/lib/mock-mode.ts::assertMockAllowed()` — runtime check
  in the shared lib used by both extension and preview harness.

### INV-7: Protocol version pinning

Wire envelope includes `v: 1`. Mismatched versions are rejected on both
sides. Enforced by:
- `packages/protocol/messages.ts::parseResponse()`
- `core/src/protocol.rs::parse_request()`

### INV-8: Non-empty request IDs

Every request envelope includes a non-empty `id`. Empty / whitespace-only
IDs are rejected. IDs are correlated with responses by the in-flight map
in `extension/services/native-messaging.ts`.

### INV-9: Vault session hard cap (30 min)

The unlock session is hard-capped at 30 minutes regardless of user activity.
Auto-lock triggers earlier if `inactivityLockSec` < 30 min. Enforced by:
- `core/src/lock.rs::SessionState` — `max_session_secs <= 1800`.
- `src/components/keytap/popup/types.ts::DEFAULT_SETTINGS.maxSessionSec = 1800`.
- The settings UI slider caps at 30 min and the toggle is enforced.

### INV-10: Encrypted backup uses an independent key

Vault backups are encrypted with a key derived independently from the
vault's VEK. Compromising one does not compromise the other.

Enforced by `core/src/backup.rs::BackupKey::derive()`.

---

## 4. Build Security

### Reproducible builds

The Rust workspace (`Cargo.lock` checked in) supports reproducible builds.
The TypeScript extension does not (WXT doesn't lock the entire dep tree
by default). Run `bun install --frozen-lockfile` to enforce the lockfile.

### CI guard: check-no-mock.mjs

`scripts/check-no-mock.mjs` walks the production extension bundle
(`extension/.output/chrome-mv3/`) and rejects any file containing:

- `import ... from "@keytap/lib/totp"`
- `import ... from "@keytap/lib/mock-accounts"`
- `import ... from "@keytap/lib/mock-mode"`
- `import ... from "./mock-accounts"`
- The string `MOCK_ACCOUNTS` or `RFC6238_TEST_SECRET_BASE32`

Run it locally:
```bash
node scripts/check-no-mock.mjs extension/.output/chrome-mv3/
```

### Strict CSP

The MV3 manifest declares:
```
script-src 'self'; object-src 'self'; base-uri 'self'; frame-ancestors 'none';
```

No `unsafe-eval`, no `unsafe-inline`. No remote script sources.

### Native messaging host manifest

The host manifest (`com.keytap.nativehost.json`, written by the installers
in `native-host/scripts/`) restricts `allowed_origins` to the user's
extension ID only. A different extension cannot connect to the host.

---

## 5. Dependency Policy

### Rust dependencies

All Rust deps are pinned in `Cargo.lock`. Key security-sensitive crates:

| Crate                  | Version  | Audit status                 |
| ---------------------- | -------- | ----------------------------- |
| `aes-gcm`              | 0.10.x   | NIST KAT verified (test)      |
| `argon2`               | 0.5.x    | RFC 9106 reference impl       |
| `sha1`, `sha2`         | 0.10.x   | RFC 6238 test vectors pass    |
| `hmac`                 | 0.12.x   | RFC 4226 test vectors pass    |
| `zeroize`              | 1.x      | Secret zeroization on drop    |
| `serde_json`           | 1.x      | Only parsing trusted host input |
| `thiserror`            | 1.x      | No I/O                        |

Run `cargo audit` to scan for known vulnerabilities.

### TypeScript / JS dependencies

The extension + Next.js harness use:

- `react`, `react-dom` (v19)
- `lucide-react` (icons)
- `sonner` (toasts)
- `tldts` (URL parsing, used for origin display only — NOT for matching,
  which is exact-string)
- `wxt` (extension build tooling)
- `@wxt-dev/module-react`

All runtime deps are pinned in `package.json` with caret ranges. Use
`bun install --frozen-lockfile` (or `npm ci`) to enforce.

### Updating dependencies

Before bumping any dep:
1. Read the changelog.
2. Run `cargo test` (Rust) and `bun run typecheck` (TS) — all 68 tests
   must pass.
3. Run `node scripts/check-no-mock.mjs extension/.output/chrome-mv3/`.
4. Manually re-test the autofill flow on `extension/tests/test-login.html`.

---

## 6. Reporting a vulnerability

If you find a security issue, please do NOT open a public GitHub issue.
Instead, email the maintainer (see `Cargo.toml` for the package authors)
with:

- A description of the issue and its impact
- Reproduction steps
- Suggested fix (if you have one)

We will acknowledge receipt within 72 hours and aim to ship a fix within
30 days for high-severity issues.

---

## 7. What is explicitly OUT OF SCOPE

- Cloud sync (we do not sync the vault across devices)
- Team sharing
- Mobile apps
- Remote attestation of the native host binary
- Protection against an attacker with kernel-level access (use full-disk
  encryption + secure boot for that)
- Protection against hardware keyloggers
- Protection against a malicious native host binary that the user
  deliberately substituted (binary signing is a future enhancement)
