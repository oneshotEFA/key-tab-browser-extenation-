/**
 * Background service worker.
 *
 * Responsibilities:
 *   - Listen for the `autofill-current-tab` keyboard command
 *     (Ctrl+Shift+2 / Cmd+Shift+2).
 *   - On command: query the active tab, ask the native host for a code
 *     matching the active origin, then inject the autofill script via
 *     chrome.scripting.executeScript.
 *   - Maintain a long-lived chrome.runtime.connectNative port to the host
 *     for low-latency getCode requests.
 *   - NEVER submit a form (never-auto-submit invariant).
 *
 * SECURITY:
 *   - Origin matching is EXACT (see origin-validator.ts). The native host
 *     also enforces it — defense in depth.
 *   - The "secret" word must never appear in any message we send or accept
 *     (see native-messaging.ts validateResponse).
 */

import { isMockMode } from "~/services/mock-mode";
import { connectNativeHost, requestGetCode, requestListAccounts } from "~/services/native-messaging";
import { authorizeAutofill } from "~/services/origin-validator";
import { executeFill, isCodeSafeToFill } from "~/services/autofill";
import { defineBackground } from "wxt/utils/define-background";

console.info("[keytap:bg] service worker starting (mock=%s)", isMockMode());

// Keep the native host port alive for the lifetime of the service worker.
// Reconnect on disconnect (Chrome may tear down the SW after 30s idle).
let port: chrome.runtime.Port | null = null;
function ensurePort(): chrome.runtime.Port | null {
  if (isMockMode()) return null;
  if (port) return port;
  port = connectNativeHost({
    onDisconnect: () => {
      console.warn("[keytap:bg] native host disconnected; will reconnect on next request");
      port = null;
    },
    onMessage: () => {
      // Correlated responses are handled via the in-flight promise map
      // inside native-messaging.ts. This is a no-op listener.
    },
  });
  return port;
}

// Keyboard shortcut: Ctrl+Shift+2 (Cmd+Shift+2 on macOS). WXT evaluates
// entrypoints with a partial fake browser during build; that fake intentionally
// does not implement commands.onCommand, while Chrome does.
try {
  chrome.commands?.onCommand.addListener(async (command) => {
    if (command !== "autofill-current-tab") return;
    console.info("[keytap:bg] command: %s", command);
    try {
      await autofillActiveTab();
    } catch (e) {
      console.error("[keytap:bg] autofill failed", e);
    }
  });
} catch {
  // Build-time fake browser only; the real listener is registered in Chrome.
}

// Message from the popup (for "Fill" button clicks that need the SW).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "keytap:fill-from-popup" && typeof msg.accountId === "string") {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url) {
          sendResponse({ ok: false, error: "no active tab" });
          return;
        }
        const origin = tabUrlToOrigin(tab.url);
        if (!origin) {
          sendResponse({ ok: false, error: "no https origin" });
          return;
        }
        await autofillActiveTab({ accountId: msg.accountId as string, origin, tabId: tab.id });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true; // keep channel open for async sendResponse
  }
  return false;
});

/**
 * Main autofill orchestrator. Picks the best-matching account (or uses
 * the caller-supplied accountId), asks the host for a fresh code, and
 * injects it into the active tab's OTP field.
 */
async function autofillActiveTab(opts?: {
  accountId?: string;
  origin?: string;
  tabId?: number;
}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("no active tab");
  }
  const origin = opts?.origin ?? tabUrlToOrigin(tab.url);
  if (!origin) {
    throw new Error("active tab is not https://");
  }

  // Choose account: prefer the one the popup pre-selected, else pick the
  // first account whose origin list matches.
  let accountId = opts?.accountId;
  if (!accountId) {
    const accounts = await requestListAccounts(ensurePort());
    for (const a of accounts.accounts) {
      const allowed = [a.origin, ...(a.additionalOrigins ?? [])];
      if (authorizeAutofill(allowed, origin)) {
        accountId = a.id;
        break;
      }
    }
    if (!accountId) {
      throw new Error(`no account authorized for ${origin}`);
    }
  }

  // Get a fresh code from the host.
  const resp = await requestGetCode(ensurePort(), { accountId, origin, tabId: tab.id });

  // Refuse to fill an expired or about-to-expire code.
  if (!isCodeSafeToFill(resp.expiresAt)) {
    throw new Error(
      `code is not safe to fill (expires at ${resp.expiresAt}, now ${Date.now()})`,
    );
  }

  // Inject via chrome.scripting. Never submits the form.
  await executeFill(tab.id, resp.code);
  console.info("[keytap:bg] filled code for account=%s origin=%s", accountId, origin);
}

function tabUrlToOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// Periodic keepalive ping to prevent SW teardown during active use.
// Chrome tears down idle SWs after ~30s; we ping the host every 25s
// while a popup is open (the popup signals "alive" via the message
// channel below).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "keytap:popup-alive") {
    void ensurePort();
  }
  return false;
});

// WXT requires background entrypoints to expose the standard definition.
// The implementation above intentionally registers listeners at module load,
// matching Chrome MV3 service-worker semantics.
export default defineBackground(() => {});
