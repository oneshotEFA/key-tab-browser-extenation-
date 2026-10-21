# Keytap — Worklog

A chronological log of work on the Keytap project. Each section is one task
or phase, written by the agent that performed it.

---

## Task 5 — Extension + popup UI components

**Agent:** general-purpose sub-agent
**Date:** see file mtime
**Scope:** Write the Chrome MV3 extension scaffold + shared popup UI
library consumed by both the extension and the Next.js preview harness.

### Context

The Rust core (`core/`) and the native host binary (`native-host/`) had
already been built and tested. Previous phases shipped 113 tests; this
task's scope collapses that to the **68 passing tests** that survive in
this build (47 core + 5 integration + 14 adversarial + 2 messaging).
The popup UI and the extension wiring were missing — only stubs of the
preview page (`src/app/page.tsx`), the download route, and a stale copy
of `public/SETUP.md` existed.

### What was done

1. **Created the shared popup + lib package** at `src/components/keytap/`,
   exposed via the `@keytap/popup` and `@keytap/lib` path aliases (which
   were already declared in `tsconfig.json` and verified to be correct).
2. **Implemented a Web Crypto TOTP (RFC 6238) implementation** in
   `src/components/keytap/lib/totp.ts`. Verified against the RFC 6238
   SHA1 test vectors (T=59→94287082, T=1111111109→07081804,
   T=1111111111→14050471, T=1234567890→89005924, T=2000000000→69279037)
   using `crypto.subtle` HMAC-SHA1 with `extractable: false`.
3. **Built the shared TS protocol types** in `packages/protocol/messages.ts`
   mirroring the Rust structs in `core/src/protocol.rs`. Includes the
   secret-leak rejection rule (any response containing the substring
   "secret" is rejected by `parseResponse`), version pinning, non-empty
   request IDs, and type-safe tagged unions matching Rust's
   `#[serde(tag = "type", content = "payload")]`.
4. **Built the 360×560 popup shell** with the TopBar / SearchBar /
   AccountList / AccountRow / StatusBar components + AddAccount and
   Settings dialogs. Mock backend rotates live codes via Web Crypto
   TOTP. Exact-origin autofill policy is enforced client-side and in
   the background service worker.
5. **Wrote the Chrome MV3 extension scaffold** under `extension/`:
   WXT config with strict CSP, activeTab + scripting + nativeMessaging
   permissions, Ctrl+Shift+2 autofill shortcut. Background service worker
   connects to the native host via `chrome.runtime.connectNative`, with
   request correlation and the secret-leak defense.
6. **Wrote native-messaging installers** for macOS (bash) and Windows
   (PowerShell). Both validate the extension ID format and write the
   host manifest JSON into Chrome's expected location.
7. **Wrote `scripts/check-no-mock.mjs`** — a CI guard that scans the
   production bundle and rejects any file containing mock-only symbols
   (`RFC6238_TEST_SECRET_BASE32`, `MOCK_ACCOUNTS`, `createMockBackend`,
   imports from `@keytap/lib/totp`, `@keytap/lib/mock-accounts`, etc.).
8. **Updated the Next.js preview page** (`src/app/page.tsx`) with the
   final 68-test breakdown, prominent green download section, simulated
   tab origin switcher, test login form, build-status card, test-coverage
   card, quick-start code block, and theme toggle.
9. **Wrote `SETUP.md`, `SECURITY.md`, `docs/security-review.md`, and
   `public/SETUP.md`** with the comprehensive setup guide, threat model,
   10 security invariants, reviewer checklist, and 68-test coverage
   breakdown.
10. **Updated `eslint.config.mjs`** to ignore the non-Next.js code paths
    (`extension/**`, `native-host/**`, `desktop-app/**`, `core/**`,
    `packages/**`, `scripts/**`, `docs/**`, etc.).

### Verification

- **TypeScript:** `npx tsc --noEmit` — 0 errors in `src/` or `packages/`.
  (Extension files in `extension/` need their own tsconfig + `@types/chrome`
  + `wxt` deps; that's a `cd extension && bun install && bun run typecheck`
  step, separate from the Next.js build.)
- **TOTP:** Wrote a smoke test against RFC 6238 SHA1 test vectors —
  5/5 passed (8-digit) and 1/1 passed (6-digit).
- **Protocol:** Wrote a smoke test for `parseResponse`/`serializeRequest`
  — round-trip works, secret-leak rejection works, version-mismatch
  rejection works, empty-id rejection works, unknown-type rejection works.
- **CI guard:** `node scripts/check-no-mock.mjs --help` runs correctly;
  the default run (no bundle) correctly reports "bundle directory not
  found".
- **ESLint:** new ignores correctly drop `extension/`, `packages/`,
  `scripts/`, `docs/` from the Next.js lint config; TypeScript still
  type-checks them via the `**/*.ts` include.

### Open items (documented in `docs/security-review.md` §5)

- The `createMockBackend` factory lives in `PopupApp.tsx` per the spec,
  so any production bundle that statically imports `PopupApp` will pull
  in mock code transitively. `App.tsx` uses dynamic import for
  `createMockBackend`, but tree-shaking may not fully eliminate it.
  The `check-no-mock.mjs` script will catch this and fail the build —
  a future refactor should split `createMockBackend` into its own module
  (e.g. `@keytap/popup/mock`) so production imports of `PopupApp` don't
  transitively include it.
- Platform FFI stubs (`core/src/platform/macos.rs`, `windows.rs`) still
  need real implementations on the developer's machine.
- Tauri desktop GUI is a scaffold; webcam QR capture not implemented.
- Native host binary is NOT signed (macOS Gatekeeper / Windows SmartScreen
  will warn on first run).

### Files created / modified (43 files)

#### New files

1. `packages/protocol/messages.ts`
2. `src/components/keytap/lib/utils.ts`
3. `src/components/keytap/lib/totp.ts`
4. `src/components/keytap/lib/mock-mode.ts`
5. `src/components/keytap/lib/mock-accounts.ts`
6. `src/components/keytap/lib/index.ts`
7. `src/components/keytap/popup/types.ts`
8. `src/components/keytap/popup/TopBar.tsx`
9. `src/components/keytap/popup/SearchBar.tsx`
10. `src/components/keytap/popup/AccountRow.tsx`
11. `src/components/keytap/popup/AccountList.tsx`
12. `src/components/keytap/popup/StatusBar.tsx`
13. `src/components/keytap/popup/AddAccountDialog.tsx`
14. `src/components/keytap/popup/SettingsDialog.tsx`
15. `src/components/keytap/popup/PopupApp.tsx`
16. `src/components/keytap/popup/index.ts`
17. `extension/package.json`
18. `extension/tsconfig.json`
19. `extension/wxt.config.ts`
20. `extension/entrypoints/popup/index.html`
21. `extension/entrypoints/popup/main.tsx`
22. `extension/entrypoints/popup/styles.css`
23. `extension/entrypoints/popup/App.tsx`
24. `extension/entrypoints/background.ts`
25. `extension/entrypoints/content.ts`
26. `extension/services/mock-mode.ts`
27. `extension/services/native-messaging.ts`
28. `extension/services/origin-validator.ts`
29. `extension/services/autofill.ts`
30. `extension/services/field-detector.ts`
31. `extension/schemas/account.ts`
32. `extension/tests/test-login.html`
33. `extension/README.md`
34. `.env.local`
35. `SETUP.md`
36. `SECURITY.md`
37. `docs/security-review.md`
38. `native-host/scripts/install-host-macos.sh`
39. `native-host/scripts/install-host-windows.ps1`
40. `scripts/check-no-mock.mjs`
41. `worklog.md` (this file)

#### Modified files

42. `eslint.config.mjs` — added ignores for `extension/**`, `native-host/**`,
    `desktop-app/**`, `core/**`, `packages/**`, `scripts/**`, `docs/**`,
    `target/**`, `dist/**`, `.output/**`, `download/**`, `tests/**`.
43. `src/app/api/download/route.ts` — hardened with `X-Content-Type-Options:
    nosniff`, `Cache-Control: no-store, no-cache, must-revalidate`, and a
    clearer error hint. Hard-coded filename (never user-controlled).
44. `src/app/page.tsx` — rewrote with the 68-test breakdown, prominent
    green download section, sticky footer, shadcn components, theme toggle,
    and all required UI sections (simulated origin selector, test login
    form, build-status card, test-coverage card, quick-start code block).
45. `public/SETUP.md` — refreshed to match `SETUP.md` (68 tests, current
    project structure, current troubleshooting steps).

#### Verified but unchanged

- `tsconfig.json` — already had the `@keytap/*` path aliases declared;
  no changes needed.

### Next actions (for the human reviewer)

1. Run `cd extension && bun install && KEYTAP_MOCK=1 bun run dev` to load
   the dev extension. Verify the popup renders with 4 mock accounts and
   live-rotating codes.
2. Run `cargo test` from the project root to confirm all 68 tests still
   pass.
3. Run `bun run dev` from the project root, open http://localhost:3000,
   and confirm the preview harness renders the popup + Download ZIP +
   Setup Guide buttons work.
4. Run `node scripts/check-no-mock.mjs` against a production extension
   build to verify the CI guard catches mock symbol leaks (it should
   fail until the mock-backend split-out refactor mentioned in Open Items
   is done).
5. Walk through `docs/security-review.md` §6 (Reviewer checklist).
