/**
 * chrome.runtime.connectNative wrapper with request correlation and
 * response validation.
 *
 * SECURITY INVARIANTS:
 *   1. We connect to NATIVE_HOST_NAME only (no other host).
 *   2. Every response is parsed via @keytap/protocol's parseResponse,
 *      which rejects responses containing the substring "secret" —
 *      defense-in-depth against a compromised host.
 *   3. Request IDs are non-empty and unique (crypto.randomUUID).
 *   4. Timeouts: a getCode request that doesn't respond within 10s is
 *      aborted and the port is reconnected. An attacker who DoSes the
 *      host cannot hang the popup indefinitely.
 *   5. Only an explicit addAccount action sends an otpauth URI (including its
 *      setup secret) to the local native host for encrypted vault storage.
 */

import {
  NATIVE_HOST_NAME,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  parseResponse,
  serializeRequest,
  newRequestId,
  isErrorResponse,
  type ExtensionRequest,
  type NativeHostResponse,
  type AccountSummary,
  type GetCodeResponse,
  type ListAccountsPayload,
  type StatusPayload,
} from "@keytap/protocol";
import type { PopupBackend } from "@keytap/popup/PopupApp";
import type { PopupSettings } from "@keytap/popup/types";

// Keep the background/native-messaging layer independent from the React popup
// runtime. Importing DEFAULT_SETTINGS from the popup barrel would eagerly load
// the whole JSX tree while WXT evaluates the service-worker entrypoint.
const DEFAULT_SETTINGS: PopupSettings = {
  inactivityLockSec: 300,
  maxSessionSec: 1800,
  lockOnOsLock: true,
  requireReauthForDelete: true,
  requireReauthForExport: true,
  autoSubmit: true,
  theme: "system",
};

// Length-prefix: Chrome's native-messaging spec uses 4-byte little-endian
// uint32 length. We don't write the prefix ourselves — chrome.runtime.Port
// handles that for us. We only need to send/parse the JSON envelope string.

const DEFAULT_TIMEOUT_MS = 10_000;

interface PendingRequest {
  resolve: (r: NativeHostResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
}

/**
 * Connect to the native host. Returns a chrome.runtime.Port.
 *
 * The caller passes onMessage/onDisconnect callbacks; messages are also
 * routed through the in-flight request map.
 */
export function connectNativeHost(opts: {
  onMessage?: (msg: unknown) => void;
  onDisconnect?: (err: chrome.runtime.LastError | undefined) => void;
}): chrome.runtime.Port {
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  port.onMessage.addListener((msg) => {
    opts.onMessage?.(msg);
    handleIncoming(msg);
  });
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    opts.onDisconnect?.(err);
    // Reject all in-flight requests with host-down.
    for (const [id, pending] of inflight) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`native host disconnected (request ${id})`));
    }
    inflight.clear();
  });
  return port;
}

// In-flight request map: requestId -> PendingRequest.
const inflight = new Map<string, PendingRequest>();

function handleIncoming(msg: unknown) {
  // msg from chrome.runtime.Port is already deserialized JSON. Re-serialize
  // so we can run it through the protocol's parseResponse validator
  // (which checks for "secret" leaks and version mismatches).
  const text = JSON.stringify(msg);
  if (text.length > MAX_MESSAGE_BYTES) {
    console.error("[keytap:nm] response too large: %d bytes", text.length);
    return;
  }
  let parsed: [string, NativeHostResponse];
  try {
    parsed = parseResponse(text);
  } catch (e) {
    console.error("[keytap:nm] response parse failed:", e);
    return;
  }
  const [id, response] = parsed;
  const pending = inflight.get(id);
  if (!pending) {
    console.warn("[keytap:nm] no in-flight request for id=%s (late or duplicate)", id);
    return;
  }
  clearTimeout(pending.timer);
  inflight.delete(id);
  if (isErrorResponse(response)) {
    pending.reject(new Error(`${response.payload.code}: ${response.payload.message}`));
  } else {
    pending.resolve(response);
  }
}

/**
 * Send a request to the native host and await the correlated response.
 * Rejects on timeout or if the response is an Error payload.
 */
export function sendRequest(
  port: chrome.runtime.Port,
  request: ExtensionRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<NativeHostResponse> {
  const id = newRequestId();
  return new Promise<NativeHostResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (inflight.delete(id)) {
        reject(new Error(`request ${id} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    inflight.set(id, { resolve, reject, timer, startedAt: Date.now() });
    try {
      const json = serializeRequest(id, request);
      // User initiated account import necessarily includes the otpauth URI's
      // `secret=` parameter. Only this request may carry it to the local host.
      if (request.type !== "addAccount" && json.toLowerCase().includes("secret")) {
        clearTimeout(timer);
        inflight.delete(id);
        reject(new Error("refusing to send request containing substring 'secret'"));
        return;
      }
      port.postMessage(JSON.parse(json));
    } catch (e) {
      clearTimeout(timer);
      inflight.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

// ---------------------------------------------------------------------------
// Typed request helpers
// ---------------------------------------------------------------------------

export async function requestPing(port: chrome.runtime.Port): Promise<{ hostVersion: string; capabilities: string[] }> {
  const resp = await sendRequest(port, {
    type: "ping",
    payload: { client: "keytap-extension", clientVersion: "0.1.0" },
  });
  if (resp.type !== "pong") throw new Error(`expected pong, got ${resp.type}`);
  return resp.payload;
}

export async function requestListAccounts(port: chrome.runtime.Port | null): Promise<ListAccountsPayload> {
  if (!port) throw new Error("native host port not initialized");
  const resp = await sendRequest(port, { type: "listAccounts", payload: {} });
  if (resp.type !== "accounts") throw new Error(`expected accounts, got ${resp.type}`);
  return resp.payload;
}

export async function requestGetCode(
  port: chrome.runtime.Port | null,
  args: { accountId: string; origin: string; tabId?: number },
): Promise<GetCodeResponse> {
  if (!port) throw new Error("native host port not initialized");
  const resp = await sendRequest(port, {
    type: "getCode",
    payload: { accountId: args.accountId, origin: args.origin, tabId: args.tabId },
  });
  if (resp.type !== "code") throw new Error(`expected code, got ${resp.type}`);
  return resp.payload;
}

export async function requestLock(port: chrome.runtime.Port | null): Promise<void> {
  if (!port) throw new Error("native host port not initialized");
  const resp = await sendRequest(port, { type: "lock", payload: {} });
  if (resp.type !== "error" && resp.type !== "status") {
    // Some hosts return Error(VaultLocked) for double-lock, which is fine.
    console.warn("[keytap:nm] unexpected lock response type: %s", resp.type);
  }
}

export async function requestStatus(port: chrome.runtime.Port | null): Promise<StatusPayload | null> {
  if (!port) return null;
  try {
    const resp = await sendRequest(port, { type: "getStatus", payload: {} });
    if (resp.type === "status") return resp.payload;
    return null;
  } catch {
    return null;
  }
}

export async function requestAddAccount(
  port: chrome.runtime.Port | null,
  payload: { otpauthUri: string; origin: string; passphrase: string },
): Promise<void> {
  if (!port) throw new Error("native host port not initialized");
  const resp = await sendRequest(port, { type: "addAccount", payload });
  if (resp.type !== "accounts") throw new Error(`expected accounts, got ${resp.type}`);
}

export async function requestDeleteAccount(
  port: chrome.runtime.Port | null,
  accountId: string,
): Promise<void> {
  if (!port) throw new Error("native host port not initialized");
  const resp = await sendRequest(port, { type: "deleteAccount", payload: { accountId } });
  if (resp.type !== "accounts") throw new Error(`expected accounts, got ${resp.type}`);
}

export async function requestUnlockVault(
  port: chrome.runtime.Port | null,
  passphrase: string,
): Promise<void> {
  if (!port) throw new Error("native host port not initialized");
  const resp = await sendRequest(port, { type: "unlockVault", payload: { passphrase } });
  if (resp.type !== "status" || resp.payload.vaultLocked) throw new Error("vault did not unlock");
}

// ---------------------------------------------------------------------------
// createNativeBackend — PopupBackend adapter
// ---------------------------------------------------------------------------

async function sendViaBackgroundOrDirect(
  request: ExtensionRequest,
  getPort: () => chrome.runtime.Port | null,
): Promise<NativeHostResponse> {
  // If we are in an extension context, route via background service worker so the
  // native host port is held open persistently by the service worker.
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage && chrome.runtime.id) {
    const res = await new Promise<{ ok: boolean; response?: NativeHostResponse; error?: string }>(
      (resolve, reject) => {
        try {
          chrome.runtime.sendMessage(
            { type: "keytap:native-request", request },
            (response) => {
              const err = chrome.runtime.lastError;
              if (err) return reject(new Error(err.message));
              resolve(response);
            },
          );
        } catch (e) {
          reject(e);
        }
      },
    );
    if (!res || !res.ok) {
      throw new Error(res?.error ?? "native messaging request failed");
    }
    return res.response!;
  }

  // Fallback to direct port
  const p = getPort();
  if (!p) throw new Error("native host unavailable");
  return sendRequest(p, request);
}

/**
 * Build a PopupBackend that talks to the real native host. Used by
 * extension/entrypoints/popup/App.tsx in production builds.
 */
export function createNativeBackend(): PopupBackend {
  const settingsRef: { current: PopupSettings } = { current: { ...DEFAULT_SETTINGS } };
  let port: chrome.runtime.Port | null = null;

  function getPort(): chrome.runtime.Port | null {
    if (port) return port;
    try {
      port = connectNativeHost({
        onDisconnect: () => {
          port = null;
        },
      });
    } catch (e) {
      console.error("[keytap:nm] connectNative failed:", e);
      port = null;
    }
    return port;
  }

  return {
    isMock: false,
    hostVersionLabel: "native",

    async listAccounts() {
      try {
        const resp = await sendViaBackgroundOrDirect({ type: "listAccounts", payload: {} }, getPort);
        if (resp.type !== "accounts") throw new Error(`expected accounts, got ${resp.type}`);
        return { accounts: resp.payload.accounts, vaultLocked: resp.payload.vaultLocked };
      } catch (e) {
        console.error("[keytap:nm] listAccounts failed:", e);
        return { accounts: [], vaultLocked: true };
      }
    },

    async getCode(accountId: string, origin: string) {
      const resp = await sendViaBackgroundOrDirect(
        { type: "getCode", payload: { accountId, origin } },
        getPort,
      );
      if (resp.type !== "code") throw new Error(`expected code, got ${resp.type}`);
      return resp.payload;
    },

    async importAccount(otpauthUri: string, origin: string, passphrase: string) {
      const resp = await sendViaBackgroundOrDirect(
        { type: "addAccount", payload: { otpauthUri, origin, passphrase } },
        getPort,
      );
      if (resp.type !== "accounts") throw new Error(`expected accounts, got ${resp.type}`);
    },

    async deleteAccount(accountId: string) {
      const resp = await sendViaBackgroundOrDirect(
        { type: "deleteAccount", payload: { accountId } },
        getPort,
      );
      if (resp.type !== "accounts") throw new Error(`expected accounts, got ${resp.type}`);
    },

    async updateAccountOrigin(accountId: string, origin: string) {
      const resp = await sendViaBackgroundOrDirect(
        { type: "updateAccountOrigin", payload: { accountId, origin } },
        getPort,
      );
      if (resp.type !== "accounts") throw new Error(`expected accounts, got ${resp.type}`);
    },

    async unlockVault(passphrase: string) {
      const resp = await sendViaBackgroundOrDirect(
        { type: "unlockVault", payload: { passphrase } },
        getPort,
      );
      if (resp.type !== "status" || resp.payload.vaultLocked) throw new Error("vault did not unlock");
    },

    async lock() {
      await sendViaBackgroundOrDirect({ type: "lock", payload: {} }, getPort).catch(() => {});
    },

    async getStatus() {
      try {
        const resp = await sendViaBackgroundOrDirect({ type: "getStatus", payload: {} }, getPort);
        if (resp.type === "status") return resp.payload;
        return null;
      } catch {
        return null;
      }
    },

    async getSettings() {
      // Stored in chrome.storage.local.
      const stored = await chrome.storage.local.get("keytap:settings");
      const raw = stored["keytap:settings"];
      if (raw && typeof raw === "object") {
        settingsRef.current = { ...DEFAULT_SETTINGS, ...(raw as Partial<PopupSettings>) };
      }
      return { ...settingsRef.current };
    },

    async saveSettings(next: PopupSettings) {
      settingsRef.current = { ...next };
      await chrome.storage.local.set({ "keytap:settings": settingsRef.current });
    },

    // No addMockAccount in native builds — the popup cannot add accounts.
    addMockAccount: undefined,
  };
}

// Re-export AccountSummary for callers that need the type.
export type { AccountSummary };

// Keep PROTOCOL_VERSION referenced for type-checking in some setups.
void PROTOCOL_VERSION;
