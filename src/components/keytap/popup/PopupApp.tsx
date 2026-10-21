/**
 * PopupApp — the main popup shell.
 *
 * Wires together TopBar / SearchBar / AccountList / StatusBar / dialogs and
 * owns the popup's runtime state:
 *
 *   - accounts (queried via backend.listAccounts())
 *   - codes    (queried via backend.getCode(); refreshed periodically)
 *   - search   (local input state)
 *   - settings (persisted via backend.saveSettings())
 *   - status   (vault state, auto-lock countdown)
 *
 * Two backends:
 *   - createMockBackend(): in-page mock that uses Web Crypto TOTP to rotate
 *     codes every second. Used by the preview harness AND by `KEYTAP_MOCK=1`
 *     extension dev builds. NEVER holds real secrets.
 *   - createNativeBackend(): talks to chrome.runtime.connectNative via the
 *     extension's native-messaging service. Used in production builds.
 *
 * SECURITY INVARIANTS:
 *   1. The popup NEVER sees or stores a shared secret in production mode.
 *   2. getCode is requested per-account and the response is held only as
 *      long as the popup is open. When the popup closes, all in-memory
 *      codes are GC'd by the service worker.
 *   3. Origin matching is EXACT. Even same-eTLD+1 origins are rejected.
 *   4. The popup never auto-submits a form. Fill = type code into the OTP
 *      field, no submit event dispatched.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AccountSummary, GetCodeResponse, StatusPayload } from "@keytap/protocol";
import {
  DEFAULT_SETTINGS,
  type PopupAccount,
  type PopupOtp,
  type PopupSettings,
  type PopupStatus,
  type VaultState,
} from "./types";
import { TopBar } from "./TopBar";
import { SearchBar } from "./SearchBar";
import { AccountList, originMatches } from "./AccountList";
import { StatusBar } from "./StatusBar";
import { AddAccountDialog } from "./AddAccountDialog";
import { SettingsDialog } from "./SettingsDialog";
import {
  parseOtpAuthUri,
} from "@keytap/lib";

// ---------------------------------------------------------------------------
// PopupBackend interface
// ---------------------------------------------------------------------------

/**
 * Backend abstraction. Both the mock and native backends implement this.
 *
 * All methods are async to allow for native-messaging round-trips.
 */
export interface PopupBackend {
  listAccounts(): Promise<{ accounts: AccountSummary[]; vaultLocked: boolean }>;
  getCode(accountId: string, origin: string): Promise<GetCodeResponse>;
  lock(): Promise<void>;
  getStatus(): Promise<StatusPayload | null>;
  /** Persisted settings. Backends should cache in chrome.storage.local. */
  getSettings(): Promise<PopupSettings>;
  saveSettings(next: PopupSettings): Promise<void>;
  /**
   * Mock-only: add an account from an otpauth:// URI. Returns an error in
   * native builds (the popup cannot add accounts in production).
   */
  addMockAccount?(uri: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Human-readable label for the status bar. */
  readonly hostVersionLabel: string;
  readonly isMock: boolean;
}

// ---------------------------------------------------------------------------
// PopupApp component
// ---------------------------------------------------------------------------

export function PopupApp({
  backend,
  activeOrigin,
  hostVersionLabel,
}: {
  backend: PopupBackend;
  /** Active tab origin (e.g. "https://github.com"), or null if no tab. */
  activeOrigin: string | null;
  hostVersionLabel?: string;
}) {
  const [accounts, setAccounts] = useState<PopupAccount[]>([]);
  const [codes, setCodes] = useState<Map<string, PopupOtp>>(new Map());
  const [search, setSearch] = useState("");
  const [settings, setSettings] = useState<PopupSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<PopupStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshAccounts = useCallback(async () => {
    try {
      const result = await backend.listAccounts();
      const popupAccounts: PopupAccount[] = result.accounts.map((a) => ({
        ...a,
        additionalOrigins: a.additionalOrigins ?? [],
        allOrigins: dedupe([a.origin, ...(a.additionalOrigins ?? [])]),
      }));
      setAccounts(popupAccounts);
      setStatus((prev) => ({
        vaultState: backend.isMock ? "demo" : result.vaultLocked ? "locked" : prev?.vaultState ?? "unlocked",
        vaultLocked: result.vaultLocked,
        autoLockAt: prev?.autoLockAt ?? null,
        sessionExpiresAt: prev?.sessionExpiresAt ?? null,
        hostVersion: hostVersionLabel ?? backend.hostVersionLabel,
      }));
    } catch (e) {
      setStatus({
        vaultState: "host-down",
        vaultLocked: true,
        autoLockAt: null,
        sessionExpiresAt: null,
        hostVersion: hostVersionLabel ?? backend.hostVersionLabel,
      });
      toast.error("Vault host unavailable", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [backend, hostVersionLabel]);

  // Initial load.
  useEffect(() => {
    void (async () => {
      const s = await backend.getSettings().catch(() => DEFAULT_SETTINGS);
      setSettings({ ...s, neverAutoSubmit: true });
      await refreshAccounts();
      const st = await backend.getStatus().catch(() => null);
      if (st) {
        setStatus({
          vaultState: backend.isMock ? "demo" : st.vaultLocked ? "locked" : "unlocked",
          vaultLocked: st.vaultLocked,
          autoLockAt: st.autoLockAt,
          sessionExpiresAt: st.sessionExpiresAt,
          hostVersion: hostVersionLabel ?? backend.hostVersionLabel,
        });
      }
    })();
  }, [backend, hostVersionLabel, refreshAccounts]);

  // Tick: every 1s update `now` so countdowns stay live.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Periodic status refresh (every 10s).
  useEffect(() => {
    const id = window.setInterval(async () => {
      const st = await backend.getStatus().catch(() => null);
      if (st) {
        setStatus({
          vaultState: backend.isMock ? "demo" : st.vaultLocked ? "locked" : "unlocked",
          vaultLocked: st.vaultLocked,
          autoLockAt: st.autoLockAt,
          sessionExpiresAt: st.sessionExpiresAt,
          hostVersion: hostVersionLabel ?? backend.hostVersionLabel,
        });
      }
    }, 10000);
    return () => window.clearInterval(id);
  }, [backend, hostVersionLabel]);

  // Code refresh: poll getCode for every account every ~5s, and also
  // regenerate near rollover. Mock backend derives locally; native goes
  // over stdio. The popup NEVER holds the secret in either case.
  const codeRefreshInFlight = useRef(false);
  const refreshCodes = useCallback(async () => {
    if (codeRefreshInFlight.current) return;
    if (accounts.length === 0) return;
    codeRefreshInFlight.current = true;
    try {
      const next = new Map<string, PopupOtp>();
      const nowMs = Date.now();
      await Promise.all(
        accounts.map(async (a) => {
          try {
            const resp = await backend.getCode(a.id, activeOrigin ?? a.origin);
            next.set(a.id, {
              accountId: a.id,
              code: resp.code,
              issuedAt: resp.issuedAt,
              expiresAt: resp.expiresAt,
              period: 30,
              digits: resp.code.length,
            });
          } catch {
            /* leave missing — the row shows "------" */
          }
        }),
      );
      setCodes(next);
      // Schedule a near-rollover refresh so the user sees a fresh code
      // immediately after the boundary crosses.
      const minRemaining = Math.min(
        ...Array.from(next.values()).map((o) => o.expiresAt - nowMs),
        30_000,
      );
      const delay = Math.max(2_000, Math.min(minRemaining + 250, 30_000));
      window.setTimeout(() => void refreshCodes(), delay);
    } finally {
      codeRefreshInFlight.current = false;
    }
  }, [accounts, backend, activeOrigin]);

  useEffect(() => {
    if (accounts.length === 0) return;
    if (status?.vaultLocked && !backend.isMock) return;
    void refreshCodes();
  }, [accounts, status, backend, refreshCodes]);

  // Theme application.
  useEffect(() => {
    const root = document.documentElement;
    const apply = (isDark: boolean) => root.classList.toggle("dark", isDark);
    if (settings.theme === "dark") apply(true);
    else if (settings.theme === "light") apply(false);
    else {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mql.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
  }, [settings.theme]);

  // Handlers
  const handleReveal = useCallback(
    (account: PopupAccount) => {
      const otp = codes.get(account.id);
      if (!otp) {
        toast.error("No code available", { description: "Try again in a moment." });
        return;
      }
      // Copy to clipboard as a convenience.
      void navigator.clipboard
        ?.writeText(otp.code)
        .then(() => toast.success(`Code copied: ${otp.code}`, { duration: 2000 }))
        .catch(() => toast.info(`Code: ${otp.code}`));
    },
    [codes],
  );

  const handleFill = useCallback(
    async (account: PopupAccount) => {
      if (!activeOrigin) {
        toast.error("No active tab", { description: "Open a tab to fill the code into." });
        return;
      }
      if (!originMatches(account, activeOrigin)) {
        toast.error("Origin mismatch", {
          description: `This account is not authorized for ${activeOrigin}.`,
        });
        return;
      }
      const otp = codes.get(account.id);
      if (!otp) {
        toast.error("No code available");
        return;
      }
      // In the extension, App.tsx wraps PopupApp and provides a FillProvider.
      // In the preview harness there's no real tab — simulate a fill event.
      const evt = new CustomEvent("keytap:fill", {
        detail: { accountId: account.id, code: otp.code, origin: activeOrigin },
      });
      window.dispatchEvent(evt);
      toast.success(`Filled ${otp.code} into OTP field`, {
        description: "Form was NOT submitted (never-auto-submit is on).",
      });
    },
    [activeOrigin, codes],
  );

  const handleLock = useCallback(async () => {
    try {
      await backend.lock();
      setStatus((prev) =>
        prev
          ? { ...prev, vaultState: backend.isMock ? "demo" : "locked", vaultLocked: true }
          : prev,
      );
      setCodes(new Map());
      toast.success("Vault locked");
    } catch (e) {
      toast.error("Could not lock", { description: e instanceof Error ? e.message : String(e) });
    }
  }, [backend]);

  const handleAddMock = useCallback(
    (uri: string): { ok: true } | { ok: false; error: string } => {
      if (!backend.addMockAccount) {
        return { ok: false, error: "Mock add not supported by this backend." };
      }
      // Synchronous parse-and-validate before going async.
      try {
        parseOtpAuthUri(uri);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      void backend
        .addMockAccount(uri)
        .then((r) => {
          if (r.ok) {
            toast.success("Account added to mock vault");
            void refreshAccounts();
          } else {
            toast.error("Could not add account", { description: r.error });
          }
        })
        .catch((e) =>
          toast.error("Could not add account", { description: String(e) }),
        );
      return { ok: true };
    },
    [backend, refreshAccounts],
  );

  const saveSettings = useCallback(
    (next: PopupSettings) => {
      setSettings(next);
      void backend.saveSettings(next).catch(() => {
        /* non-fatal */
      });
    },
    [backend],
  );

  const vaultState: VaultState = status?.vaultState ?? (backend.isMock ? "demo" : "host-down");
  const canLock = backend.isMock ? true : vaultState === "unlocked";

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <TopBar
        vaultState={vaultState}
        onAdd={() => setShowAdd(true)}
        onSettings={() => setShowSettings(true)}
        onLock={handleLock}
        canLock={canLock}
      />
      <SearchBar value={search} onChange={setSearch} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && accounts.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <AccountList
            accounts={accounts}
            codes={codes}
            now={now}
            activeOrigin={activeOrigin}
            search={search}
            onReveal={handleReveal}
            onFill={handleFill}
          />
        )}
      </div>
      <StatusBar status={status} settings={settings} now={now} />

      <AddAccountDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        mockMode={backend.isMock}
        onAddMock={handleAddMock}
      />
      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        settings={settings}
        onChange={saveSettings}
      />
    </div>
  );
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function Spinner() {
  return (
    <span className="inline-block size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
  );
}

/* Legacy mock backend moved to PopupMockBackend.ts. The block is kept in this
   checkpoint temporarily so the production component stays unchanged beyond
   the split. */
/*
  // The mock account store. Mutable — AddAccountDialog can add to it.
  let mockAccounts: MockAccount[] = getMockAccounts();
  let vaultLocked = false;
  const settingsRef: { current: PopupSettings } = { current: { ...DEFAULT_SETTINGS } };

  return {
    isMock: true,
    hostVersionLabel: opts?.hostVersion ?? "0.1.0-mock",

    async listAccounts() {
      assertMock();
      return {
        accounts: mockAccounts.map((m) => ({
          id: m.id,
          issuer: m.issuer,
          label: m.label,
          origin: m.origin,
          additionalOrigins: m.additionalOrigins,
        })),
        vaultLocked,
      };
    },

    async getCode(accountId: string, origin: string) {
      assertMock();
      const m = mockAccounts.find((a) => a.id === accountId);
      if (!m) throw new Error(`account not found: ${accountId}`);
      // Enforce exact-origin even in mock mode.
      const allowed = [m.origin, ...m.additionalOrigins];
      if (origin && !allowed.includes(origin)) {
        // Mock mode still returns a code so the preview can show a code in
        // the "Reveal" path; the popup's UI enforces origin matching before
        // calling Fill. The native host would reject this with OriginMismatch.
      }
      const secret = base32Decode(m.secretB32);
      const nowMs = Date.now();
      const code = await generateTotp(secret, nowMs, m.period, m.digits);
      const expiresAt = nowMs + totpMsRemaining(nowMs, m.period);
      return {
        accountId: m.id,
        code,
        issuedAt: nowMs,
        expiresAt,
      };
    },

    async lock() {
      assertMock();
      vaultLocked = false; // mock: lock is cosmetic
    },

    async getStatus() {
      assertMock();
      const nowMs = Date.now();
      return {
        vaultLocked: false,
        autoLockAt: nowMs + 5 * 60 * 1000,
        sessionExpiresAt: nowMs + 30 * 60 * 1000,
        hostVersion: opts?.hostVersion ?? "0.1.0-mock",
      };
    },

    async getSettings() {
      assertMock();
      // Try to read from localStorage (preview harness).
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem("keytap:settings");
        if (raw) {
          try {
            return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), neverAutoSubmit: true };
          } catch {
            // ignore
          }
        }
      }
      return { ...settingsRef.current };
    },

    async saveSettings(next: PopupSettings) {
      assertMock();
      settingsRef.current = next;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("keytap:settings", JSON.stringify(next));
      }
    },

    async addMockAccount(uri: string) {
      assertMock();
      try {
        const parsed = parseOtpAuthUri(uri);
        const id = `mock-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        mockAccounts = [
          ...mockAccounts,
          {
            id,
            issuer: parsed.issuer ?? "Unknown",
            label: parsed.label ?? "",
            // We don't know the real origin from an otpauth URI — default to
            // a placeholder that won't match any real tab.
            origin: "https://unknown.local",
            additionalOrigins: [],
            secretB32: base32EncodeSecret(parsed.secret),
            period: parsed.period,
            digits: parsed.digits,
          },
        ];
        return { ok: true } as const;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) } as const;
      }
    },
  };

  function assertMock() {
    if (!MOCK_MODE) {
      throw new Error("createMockBackend() called in a non-mock build — this is a bug");
    }
  }
}

function base32EncodeSecret(bytes: Uint8Array): string {
  // Minimal base32 encoder — only used to round-trip the parsed secret back
  // into a mock account. Not exported; not security-sensitive.
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let bitsLeft = 0;
  let out = "";
  for (const b of bytes) {
    bits = (bits << 8) | b;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      out += ALPHABET[(bits >> bitsLeft) & 0x1f];
    }
  }
  if (bitsLeft > 0) {
    out += ALPHABET[(bits << (5 - bitsLeft)) & 0x1f];
  }
  return out;
}

// Re-export so callers can grab everything from one import.
export { MOCK_MODE as MOCK_MODE_FLAG } from "@keytap/lib";
*/
