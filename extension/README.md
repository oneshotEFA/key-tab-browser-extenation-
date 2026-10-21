# @keytap/extension

Keytap — local-first 2FA/TOTP autofill Chrome MV3 extension.

This package contains the browser extension UI + background service worker
that talks to the Rust native host (`com.keytap.nativehost`) over Chrome's
[Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
protocol.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Chrome extension (MV3)                                            │
│                                                                    │
│  ┌──────────────────┐    chrome.runtime   ┌─────────────────────┐  │
│  │  popup (React)   │ ◄──────────────────►│  background.ts     │  │
│  │  entrypoints/    │     connectNative   │  (service worker)   │  │
│  │  popup/          │                     │                     │  │
│  └──────────────────┘                     │  ┌────────────────┐ │  │
│                                           │  │ native-        │ │  │
│                                           │  │ messaging.ts   │ │  │
│                                           │  └───────┬────────┘ │  │
│                                           └──────────┼──────────┘  │
│                                                      │             │
│                                           ┌────────┴────────────┐ │
│                                           │  chrome.scripting   │ │
│                                           │  (executeScript)    │ │
│                                           └─────────────────────┘ │
│                                                                    │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ stdin/stdout (length-prefixed JSON)
                          ┌───────▼────────┐
                          │  Native host   │  (Rust binary)
                          │  com.keytap.    │
                          │  nativehost     │
                          └─────────────────┘
```

## Layout

```
extension/
├── entrypoints/
│   ├── popup/               # 360×560 React popup
│   │   ├── index.html
│   │   ├── main.tsx         # React root + Sonner toaster
│   │   ├── App.tsx          # Wires PopupApp to mock or native backend
│   │   └── styles.css       # Tailwind + shadcn tokens
│   ├── background.ts        # Service worker: commands, autofill orchestration
├── services/
│   ├── mock-mode.ts         # isMockMode() flag
│   ├── native-messaging.ts  # connectNativeHost, request correlation, validation
│   ├── origin-validator.ts  # EXACT origin matching, isSecureHttpsOrigin
│   ├── autofill.ts          # Strict autofill rules, never-auto-submit
│   └── field-detector.ts    # OTP field detection + uniqueSelector
├── schemas/
│   └── account.ts           # Account interface (NO secret field by design)
├── tests/
│   └── test-login.html      # Synthetic test page with autocomplete="one-time-code"
├── package.json
├── tsconfig.json
└── wxt.config.ts
```

## Develop

```bash
cd extension
bun install
KEYTAP_MOCK=1 bun run dev
```

This launches WXT in dev mode with `KEYTAP_MOCK=1`. The popup uses the
mock backend (RFC 6238 test vector) — no native host required.

## Build (production)

```bash
cd extension
bun install
bun run build
# Output: extension/.output/chrome-mv3/
```

Production builds DO NOT include mock code. `scripts/check-no-mock.mjs`
(in the project root) scans the output bundle and rejects any production
build that contains mock symbols.

## Load in Chrome

1. Visit `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select `extension/.output/chrome-mv3/` (or `extension/.output/chrome-mv3-dev/` for dev).
5. Note the 32-char extension ID — needed for the native-messaging host
   manifest (see `native-host/scripts/install-host-*.sh`).

## Keyboard shortcut

`Ctrl+Shift+2` (or `Cmd+Shift+2` on macOS) triggers an autofill on the
active tab. The popup must have been opened at least once for the host
to be reachable; the shortcut is honored in any case once the SW is up.

## Permissions

| Permission       | Why                                              |
| ---------------- | ------------------------------------------------ |
| `activeTab`      | Read the active tab's URL + inject the fill script |
| `scripting`      | `chrome.scripting.executeScript` for the autofill |
| `nativeMessaging`| Talk to `com.keytap.nativehost`                  |
| `storage`        | Persist popup settings (chrome.storage.local)    |
| `commands`       | Register the `Ctrl+Shift+2` shortcut              |

No `host_permissions` and no static content script. The extension injects
only the small autofill function through `chrome.scripting.executeScript`
after the user clicks Fill or invokes the keyboard shortcut.

## Content Security Policy

Strict MV3 CSP:

```
script-src 'self'; object-src 'self'; base-uri 'self'; frame-ancestors 'none';
```

No `unsafe-eval`, no `unsafe-inline`, no remote origins.

## Security invariants

1. **No secrets in the extension.** The popup never holds a shared secret.
   Codes are derived by the native host and sent over native messaging.
2. **Exact origin match.** `https://gist.github.com` ≠ `https://github.com`.
   Same-eTLD+1 origins are rejected. (See `services/origin-validator.ts`.)
3. **Never auto-submit.** The fill sets the input value + dispatches
   `input`/`change` events only. No `.submit()`, no Enter keydown.
4. **No "secret" in any wire message.** `services/native-messaging.ts`
   rejects any response containing the substring "secret" — defense in
   depth against a compromised host.
5. **5-second expiry guard.** Codes that expire in less than 5 seconds
   are not filled — the user wouldn't have time to submit.
6. **Strict CSP** (above). No remote code, no inline scripts.
7. **No mock code in production builds.** Enforced by
   `scripts/check-no-mock.mjs` at build time.

See `SECURITY.md` (project root) for the full threat model.
