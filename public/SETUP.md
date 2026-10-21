# Keytap — Local Setup Guide

This guide walks you through everything needed to build and test Keytap
locally. **TL;DR** at the bottom of this file (section 11) if you just
want the commands.

---

## 1. Prerequisites

You need **three** toolchains installed. All are free.

### A. Rust toolchain (for the native host + shared core)

**macOS / Linux:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

**Windows:** Download and run `rustup-init.exe` from https://rustup.rs/

Verify:
```bash
rustc --version   # 1.70+
cargo --version
```

### B. Bun or Node.js (for the extension + Next.js preview harness)

**Option 1 — Bun (recommended, faster):**
- macOS / Linux: `curl -fsSL https://bun.sh/install | bash`
- Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`

**Option 2 — Node.js + npm:**
- Install Node.js 18+ from https://nodejs.org/
- npm comes bundled with Node.js

Verify:
```bash
node --version    # v18+
bun --version     # if using bun
```

### C. Chrome browser (for loading the extension)

Any Chromium-based browser works (Chrome, Edge, Brave). You need it to:
- Load the unpacked extension
- Test the popup + autofill flow
- Verify Native Messaging

Download: https://www.google.com/chrome/

### D. Tauri system dependencies (only for the desktop GUI scaffold)

The Tauri desktop-app scaffold needs these system libraries. **Skip this
section if you only want to test the extension + native host.**

**macOS:**
```bash
xcode-select --install
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

**Windows:** No extra deps (WebView2 is pre-installed on Win10/11).

---

## 2. Get the project

Either download the zip from the Next.js preview (click **Download ZIP**
on the home page), or:

```bash
unzip keytap-project.zip
cd keytap-project
```

---

## 3. Build & test the Rust core + native host (68 tests)

```bash
# From the project root:

# Run all 68 tests (47 core + 5 integration + 14 adversarial + 2 messaging)
cargo test

# Build the native host in release mode
cargo build --release -p keytap-native-host

# The binary is at:
#   target/release/keytap-native-host  (macOS/Linux)
#   target/release/keytap-native-host.exe  (Windows)
```

**Verify the binary works:**
```bash
# Send a ping request, see if it responds.
# 0x5b = 91 = length of the JSON envelope that follows.
echo -ne '\x5b\x00\x00\x00{"v":1,"id":"test","type":"ping","payload":{"client":"test","clientVersion":"1.0"}}' \
  | ./target/release/keytap-native-host
```

You should see a length-prefixed JSON response with `"type":"pong"`.

### Test coverage breakdown

| Suite             | Tests | What they cover                                          |
| ----------------- | ----- | --------------------------------------------------------- |
| Core unit         | 47    | TOTP (RFC 6238 SHA1/256/512), AES-256-GCM (NIST KAT), Argon2id, VEK wrap/unwrap, vault file format (create/open/save, tamper rejection), origin matching, lock state machine, QR decode, backup encrypt/decrypt |
| Integration       | 5     | Native host round-trips: ping, getCode, origin, listAccounts, lock       |
| Adversarial       | 14    | origin spoof, replay, DoS, malformed JSON, oversized messages, stdout purity, version mismatch, empty id, unknown type, concurrent requests |
| Messaging         | 2     | Frame roundtrip + secret-leak rejection                  |
| **Total**         | **68**|                                                           |

---

## 4. Install the native messaging host

Chrome needs to know about the native host binary. Run the installer for
your platform — it writes the host manifest JSON into Chrome's expected
location and registers the extension ID in `allowed_origins`.

### macOS
```bash
cd native-host/scripts
./install-host-macos.sh <YOUR_EXTENSION_ID>
```

### Windows (PowerShell)
```powershell
cd native-host\scripts
.\install-host-windows.ps1 -ExtensionId <YOUR_EXTENSION_ID>
```

> **Finding your extension ID:** Load the unpacked extension first (section 5
> below), then go to `chrome://extensions`, enable Developer Mode, and copy
> the 32-character ID under the extension name.

---

## 5. Build & load the browser extension

### Install extension dependencies
```bash
cd extension
bun install          # or: npm install
```

### Build in dev mode (with mock backend, no native host required)
```bash
KEYTAP_MOCK=1 bun run dev
```

This creates `extension/.output/chrome-mv3-dev/`.

### Build in production mode (fail-closed, no mock)
```bash
bun run build
```

This creates `extension/.output/chrome-mv3/`.

### Load in Chrome
1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3[-dev]/` directory
5. Copy the extension ID (32-char string) — you'll need it for the native host installer (section 4)

---

## 6. Run the Next.js preview harness

The Next.js app at `/` renders the popup UI live so you can see it
without loading the extension:

```bash
# From the project root:
bun install          # install Next.js deps
bun run dev          # starts on http://localhost:3000
```

Open http://localhost:3000 in your browser. You'll see:
- The popup rendered in a 360×560 frame (live, rotating TOTP codes)
- Simulated tab origin switcher (test exact-origin policy)
- Test login form with `autocomplete="one-time-code"`
- Build status card (all phases complete, 68 tests passing)
- Test coverage card (47 / 5 / 14 / 2)
- Quick-start code block with the TL;DR commands
- Theme toggle (light / system / dark)
- Sticky footer

---

## 7. Test the autofill flow

### With mock mode (quick test, no native host needed)

1. Build the extension with `KEYTAP_MOCK=1 bun run dev`
2. Load unpacked in Chrome
3. Drag `extension/tests/test-login.html` into Chrome
4. Click the Keytap extension icon
5. You'll see 4 synthetic test accounts (GitHub, Example, Proton, Cloudflare)
6. Click **Fill** on the GitHub account — a code appears in the OTP field
7. The form is NOT submitted (Keytap never auto-submits)

### With the real native host (full test)

1. Build the native host: `cargo build --release -p keytap-native-host`
2. Install it: `./native-host/scripts/install-host-macos.sh <EXT_ID>`
3. Build the extension WITHOUT mock: `cd extension && bun run build`
4. Reload the extension in Chrome
5. The popup now talks to the real Rust binary
6. Test the same autofill flow — codes are generated by the native host

---

## 8. Project structure

```
keytap-project/
├── src/                          # Next.js preview harness
│   ├── app/page.tsx              # Live popup preview at /
│   ├── app/api/download/route.ts # Serves keytap-project.zip
│   └── components/keytap/        # Shared popup UI (extension + preview)
│       ├── lib/                  # utils, totp, mock-mode, mock-accounts
│       └── popup/                # TopBar, SearchBar, AccountRow, PopupApp…
├── packages/protocol/            # Shared TS protocol types
│   └── messages.ts
├── extension/                    # Chrome MV3 extension (WXT + React)
│   ├── entrypoints/              # popup, background, content
│   ├── services/                 # native-messaging, origin-validator, autofill
│   ├── schemas/account.ts        # Account interface (NO secret field)
│   └── tests/test-login.html     # Synthetic test page
├── core/                         # Rust shared library
│   └── src/
│       ├── crypto/               # AES-256-GCM, Argon2id, VEK
│       ├── platform/             # macOS/Windows/Linux key protectors
│       ├── vault/                # Encrypted vault file + format
│       ├── totp.rs               # RFC 6238 implementation
│       ├── origin.rs             # Exact-origin matching
│       ├── protocol.rs           # Native messaging wire types
│       ├── backup.rs             # Encrypted backup export/import
│       └── qr.rs                 # QR code decoding
├── native-host/                  # Rust binary (Chrome Native Messaging)
│   ├── src/                      # main, handler, messaging, logging
│   ├── tests/                    # integration + adversarial tests
│   └── scripts/                  # macOS + Windows installers
├── desktop-app/                  # Tauri v2 GUI (scaffold)
├── scripts/check-no-mock.mjs     # CI guard rejecting mock symbols in prod
├── docs/security-review.md      # Security review handoff
├── SECURITY.md                   # Threat model + security invariants
├── Cargo.toml                    # Rust workspace root
├── package.json                  # Next.js + shared deps
├── tsconfig.json                 # Path aliases (@keytap/*, @/*)
├── eslint.config.mjs
└── SETUP.md                      # This file
```

---

## 9. Troubleshooting

### "chrome.runtime.connectNative is not available"
- Make sure you loaded the extension as **unpacked** (not from a .crx)
- Verify the native messaging host manifest exists:
  - macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.keytap.nativehost.json`
  - Windows: registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.keytap.nativehost`
- The manifest's `allowed_origins` must include your extension ID

### "Native host exited unexpectedly"
- Check that the binary path in the host manifest is correct
- Run the binary manually to test:
  `echo '...' | ./target/release/keytap-native-host`
- Look at stderr output (Chrome captures it in `chrome://extensions` →
  extension details → "Inspect views: service worker")

### "No OTP field detected"
- The content script looks for `input[autocomplete="one-time-code"]` (high
  confidence) first
- Then: `input[inputmode="numeric"]` with name/id matching
  `/otp|code|token|2fa|twofactor/i` (medium confidence)
- Use the included `extension/tests/test-login.html` to test — it has the
  right attributes

### "cargo build fails"
- Make sure you have Rust 1.70+: `rustc --version`
- On Linux, install build essentials:
  `sudo apt install build-essential pkg-config libssl-dev`
- Try `cargo clean && cargo build`

### "bun install fails for the extension"
- Try `npm install` instead
- Make sure Node.js 18+ is installed

### Tests fail
- Run `cargo test` from the project root (not from inside a subdirectory)
- All 68 tests should pass. If any fail, check the Rust version and platform

### Mock code leaked into production build
- Run `node scripts/check-no-mock.mjs extension/.output/chrome-mv3/`
- It will report any file containing mock symbols
- Re-run `bun run build` (without `KEYTAP_MOCK=1`) to fix

---

## 10. What works vs. what needs your machine

### ✅ Works in this build (fully tested, 68 tests pass)
- TOTP generation (RFC 6238, SHA1/256/512) — Rust + TypeScript impls
- AES-256-GCM encryption (NIST KAT verified)
- Argon2id passphrase KDF
- Encrypted vault file (create/open/save, tamper rejection)
- Origin authorization (exact match, same-eTLD+1 rejected)
- Lock state machine (inactivity, OS lock, 30-min cap)
- Native messaging protocol (length-prefixed JSON over stdio)
- Adversarial defense (origin spoof, replay, DoS, stdout purity, secret-leak rejection)
- Encrypted backup (independent key, no plaintext fallback)
- QR code decoding (from static images)
- Popup UI (compact 360×560, dark mode, live rotating codes via mock)
- Browser extension MV3 scaffold (popup, background SW, content script)
- Strict CSP, exact-origin autofill policy, never-auto-submit

### ⚠️ Scaffold only (needs your machine to fully implement)
- macOS Keychain FFI (`core/src/platform/macos.rs` — stubbed with docs)
- Windows Hello FFI (`core/src/platform/windows.rs` — stubbed with docs)
- Tauri desktop GUI (`desktop-app/` — commands defined, no frontend)
- Webcam QR capture (needs `nokhwa` + camera)
- Packaged installers (`.pkg` / `.msi` via Tauri bundler)

### ❌ Not implemented (out of scope for v1)
- Cloud sync
- Team sharing
- Mobile apps
- Edge/Brave support (after Chrome passes full install tests)
- Linux production support (test-only platform stub)

---

## 11. Quick start (TL;DR)

```bash
# 1. Install prerequisites
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
curl -fsSL https://bun.sh/install | bash

# 2. Unzip and enter
unzip keytap-project.zip && cd keytap-project

# 3. Run tests (should be 68 passing)
cargo test

# 4. Build native host
cargo build --release -p keytap-native-host

# 5. Build extension (dev mode with mock)
cd extension && bun install && KEYTAP_MOCK=1 bun run dev
cd ..

# 6. Load in Chrome
#    chrome://extensions → Developer mode → Load unpacked → extension/.output/chrome-mv3-dev/

# 7. Test autofill
#    Open extension/tests/test-login.html in Chrome
#    Click Keytap icon → Fill

# 8. (Optional) Run Next.js preview
bun install && bun run dev
#    Open http://localhost:3000
```

---

## 12. Need help?

- Check `docs/security-review.md` for the full threat model + test coverage
- Check `SECURITY.md` for the security policy
- Check `extension/README.md` for extension-specific details
- Check the worklog at `worklog.md` for the full development history
