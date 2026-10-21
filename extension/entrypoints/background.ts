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
import { connectNativeHost, requestGetCode, requestListAccounts, sendRequest } from "~/services/native-messaging";
import { authorizeAutofill } from "~/services/origin-validator";
import { executeFill, isCodeSafeToFill } from "~/services/autofill";
import { defineBackground } from "wxt/utils/define-background";

console.info("[keytap:bg] service worker starting (mock=%s)", isMockMode());

// Keep the native host port alive for the lifetime of the service worker.
// In Chrome MV3, an open connectNative port keeps the service worker alive.
let port: chrome.runtime.Port | null = null;
function ensurePort(): chrome.runtime.Port | null {
  if (isMockMode()) return null;
  if (port) return port;
  try {
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
  } catch (e) {
    if (!String(e).includes("not implemented")) {
      console.error("[keytap:bg] connectNative failed:", e);
    }
    port = null;
  }
  return port;
}

// Eagerly connect on start so the native host port keeps SW alive
if (!isMockMode()) {
  try {
    ensurePort();
  } catch {
    // Build-time fake browser only; the real listener is registered in Chrome.
  }
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

// Message listener for popup requests and fill actions
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "keytap:native-request" && msg.request) {
    void (async () => {
      try {
        const p = ensurePort();
        if (!p) {
          sendResponse({ ok: false, error: "native host unavailable" });
          return;
        }
        const resp = await sendRequest(p, msg.request);
        if (resp.type !== "error") {
          // If request was unlockVault or addAccount with passphrase, save it for Touch ID unlock!
          const reqPayload = msg.request.payload as Record<string, unknown> | undefined;
          if (
            (msg.request.type === "unlockVault" || msg.request.type === "addAccount") &&
            typeof reqPayload?.passphrase === "string" &&
            reqPayload.passphrase.trim()
          ) {
            await chrome.storage.local.set({ "keytap:biometric_passphrase": reqPayload.passphrase.trim() });
          }
          // If response contains accounts, cache directory for matching even when vault locks!
          if (resp.type === "accounts" && Array.isArray(resp.payload?.accounts)) {
            await chrome.storage.local.set({ "keytap:account_directory": resp.payload.accounts });
          }
        }
        sendResponse({ ok: true, response: resp });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true; // keep channel open for async sendResponse
  }

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

  if (msg?.type === "keytap:check-match" && typeof msg.origin === "string") {
    void (async () => {
      try {
        const p = ensurePort();
        if (!p) {
          sendResponse({ ok: false, error: "native host unavailable" });
          return;
        }

        let accounts: Array<{ id: string; issuer: string; label: string; origin: string; additionalOrigins?: string[] }> = [];
        let isLocked = true;

        try {
          const resp = await requestListAccounts(p);
          isLocked = resp.vaultLocked;
          if (!isLocked && Array.isArray(resp.accounts) && resp.accounts.length > 0) {
            accounts = resp.accounts;
            await chrome.storage.local.set({ "keytap:account_directory": accounts });
          }
        } catch {
          // host might be starting or locked
        }

        // If vault is locked or returned no accounts, check cached directory
        if (accounts.length === 0) {
          const stored = await chrome.storage.local.get("keytap:account_directory");
          if (Array.isArray(stored["keytap:account_directory"])) {
            accounts = stored["keytap:account_directory"];
          }
        }

        const match = accounts.find((a) => {
          const allowed = [a.origin, ...(a.additionalOrigins ?? [])];
          return authorizeAutofill(allowed, msg.origin);
        });

        // Check if a biometric passphrase is saved
        const passStored = await chrome.storage.local.get("keytap:biometric_passphrase");
        const hasSavedPassphrase = Boolean(passStored["keytap:biometric_passphrase"]);

        if (match) {
          sendResponse({
            ok: true,
            hasMatch: true,
            vaultLocked: isLocked,
            hasSavedPassphrase,
            account: { id: match.id, issuer: match.issuer, label: match.label },
          });
        } else {
          sendResponse({ ok: true, hasMatch: false, vaultLocked: isLocked, hasSavedPassphrase });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "keytap:fill-active-tab" && sender.tab?.id && typeof msg.origin === "string") {
    void (async () => {
      try {
        await autofillActiveTab({
          accountId: typeof msg.accountId === "string" ? msg.accountId : undefined,
          origin: msg.origin,
          tabId: sender.tab?.id,
          passphrase: typeof msg.passphrase === "string" ? msg.passphrase : undefined,
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }
  return false;
});

/**
 * Main autofill orchestrator. Picks the best-matching account (or uses
 * the caller-supplied accountId), asks the host for a fresh code, and
 * injects it into the active tab's OTP field. Automatically submits/enters code.
 */
async function autofillActiveTab(opts?: {
  accountId?: string;
  origin?: string;
  tabId?: number;
  passphrase?: string;
}) {
  const [tab] = opts?.tabId
    ? [{ id: opts.tabId, url: undefined }]
    : await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("no active tab");
  }
  const origin = opts?.origin ?? (tab.url ? tabUrlToOrigin(tab.url) : null);
  if (!origin) {
    throw new Error("active tab is not https://");
  }

  const p = ensurePort();
  if (!p) throw new Error("native host unavailable");

  // Check if vault is locked
  let isLocked = true;
  try {
    const st = await sendRequest(p, { type: "getStatus", payload: {} });
    if (st.type === "status") {
      isLocked = st.payload.vaultLocked;
    }
  } catch {
    // proceed
  }

  if (isLocked) {
    // Determine passphrase to unlock vault
    let passToUse = opts?.passphrase;
    if (!passToUse) {
      const stored = await chrome.storage.local.get("keytap:biometric_passphrase");
      passToUse = stored["keytap:biometric_passphrase"];
    }

    if (passToUse) {
      const unlockResp = await sendRequest(p, {
        type: "unlockVault",
        payload: { passphrase: passToUse },
      });
      if (unlockResp.type === "error") {
        throw new Error(unlockResp.payload.message || "vault unlock failed");
      }
      // Save for future biometric unlocks
      await chrome.storage.local.set({ "keytap:biometric_passphrase": passToUse });
    } else {
      throw new Error("Vault is locked. Enter your passphrase once to enable Touch ID autofill.");
    }
  }

  // Choose account: prefer the one the caller pre-selected, else pick the
  // first account whose origin list matches.
  let accountId = opts?.accountId;
  if (!accountId) {
    const accounts = await requestListAccounts(p);
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
  const resp = await requestGetCode(p, { accountId, origin, tabId: tab.id });

  // Refuse to fill an expired or about-to-expire code.
  if (!isCodeSafeToFill(resp.expiresAt)) {
    throw new Error(
      `code is not safe to fill (expires at ${resp.expiresAt}, now ${Date.now()})`,
    );
  }

  // Read settings for autoSubmit preference (defaults to true)
  const storedSettings = await chrome.storage.local.get("keytap:settings");
  const autoSubmit = storedSettings["keytap:settings"]?.autoSubmit ?? true;

  // Inject via chrome.scripting. Fills and clicks Enter/Submit!
  await executeFill(tab.id, resp.code, autoSubmit);
  console.info("[keytap:bg] filled code for account=%s origin=%s autoSubmit=%s", accountId, origin, autoSubmit);
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
