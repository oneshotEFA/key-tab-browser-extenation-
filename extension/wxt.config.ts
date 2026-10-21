/**
 * WXT configuration for the Keytap MV3 extension.
 *
 * Manifest: MV3, strict CSP, no remote code. The popup is a React app
 * bundled by WXT; background is a service worker that talks to the native
 * host via chrome.runtime.connectNative.
 *
 * SECURITY:
 *   - `useContentScript` is set to ONLY run on activeTab. We do NOT inject
 *     scripts into every page; Chrome injects our content script only when
 *     the popup is invoked from a tab (activeTab permission).
 *   - `content_security_policy` is the strictest allowed in MV3: no
 *     `unsafe-eval`, no `unsafe-inline`, no remote origins.
 *   - `host_permissions` is empty — we never read page content without
 *     the user explicitly invoking us (activeTab).
 *   - The `commands` entry registers Ctrl+Shift+2 as the autofill shortcut.
 */

import { defineConfig } from "wxt";

// See extension/services/mock-mode.ts
const MOCK = process.env.KEYTAP_MOCK === "1";

export default defineConfig({
  srcDir: ".",
  manifestVersion: 3,
  // The extension imports React APIs explicitly. Disable WXT's auto-import
  // preset so the React module is not rewritten as a generated virtual
  // module during config/type generation.
  imports: false,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Keytap – 2FA Autofill",
    short_name: "Keytap",
    description:
      "Local-first 2FA/TOTP autofill. Secrets never leave the native host; " +
      "the popup only sees short-lived codes.",
    version: "0.1.0",
    action: {
      default_popup: "popup/index.html",
      default_title: "Keytap (Ctrl+Shift+2)",
    },
    permissions: [
      "activeTab",
      "scripting",
      "nativeMessaging",
      "storage",
      "commands",
    ],
    host_permissions: [],
    background: {
      service_worker: "background.js",
      type: "module",
    },
    commands: {
      "autofill-current-tab": {
        suggested_key: {
          default: "Ctrl+Shift+2",
          mac: "Command+Shift+2",
        },
        description: "Autofill the matching TOTP code into the active tab.",
      },
    },
    // Strictest CSP MV3 allows. No unsafe-eval, no unsafe-inline.
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; base-uri 'self'; frame-ancestors 'none';",
    },
    // Native messaging host name — must match the manifest under
    // NativeMessagingHosts/com.keytap.nativehost.json on the user's machine.
    externally_connectable: undefined as unknown as never,
  },
  // Public path alias info. WXT picks up tsconfig.json paths automatically;
  // we redeclare here so builds don't break if the root tsconfig is moved.
  alias: {
    "@": new URL("../src", import.meta.url).pathname,
    "~": new URL(".", import.meta.url).pathname,
    "@keytap/popup": new URL(
      "../src/components/keytap/popup/",
      import.meta.url,
    ).pathname,
    "@keytap/popup/": new URL(
      "../src/components/keytap/popup/",
      import.meta.url,
    ).pathname,
    "@keytap/lib": new URL(
      "../src/components/keytap/lib/",
      import.meta.url,
    ).pathname,
    "@keytap/lib/": new URL(
      "../src/components/keytap/lib/",
      import.meta.url,
    ).pathname,
    "@keytap/protocol": new URL(
      "../packages/protocol/messages.ts",
      import.meta.url,
    ).pathname,
  },
  // Always define the KEYTAP_MOCK env var, even when unset, so import.meta.env
  // shape is stable across dev/prod builds.
  vite: () => ({
    define: {
      "import.meta.env.KEYTAP_MOCK": JSON.stringify(MOCK ? "1" : "0"),
    },
    resolve: {
      alias: {
        "@": new URL("../src", import.meta.url).pathname,
        "~": new URL(".", import.meta.url).pathname,
        "@keytap/popup/": new URL("../src/components/keytap/popup/", import.meta.url).pathname,
        "@keytap/lib/": new URL("../src/components/keytap/lib/", import.meta.url).pathname,
      },
    },
    ssr: {
      // Shared popup components live above the extension root. Bundle their
      // React dependencies instead of asking ViteNode to resolve them from
      // the shared source file's parent directory.
      noExternal: true,
    },
  }),
});
