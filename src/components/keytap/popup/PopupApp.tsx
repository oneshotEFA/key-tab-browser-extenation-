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
 *   1. Outside explicit import, the popup never receives or persists shared
 *      secrets. An import URI exists only transiently while the dialog is open
 *      and is sent directly to the local native host for encrypted storage.
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
import { cn } from "@keytap/lib";
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
import { ImportAccountsDialog } from "./ImportAccountsDialog";
import { SettingsDialog } from "./SettingsDialog";
import {
  parseOtpAuthUri,
  normalizeOrigin,
  promptTouchIdOrPasscode,
  getSavedBiometricPassphrase,
} from "@keytap/lib";
import { Globe2, ShieldCheck, ShieldX, Lock, KeyRound, Plus, Trash2, Fingerprint, Sparkles } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Alert, AlertDescription } from "../../ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";

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
  importAccount?(uri: string, origin: string, passphrase: string): Promise<void>;
  deleteAccount?(accountId: string): Promise<void>;
  updateAccountOrigin?(accountId: string, origin: string): Promise<void>;
  unlockVault?(passphrase: string): Promise<void>;
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
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accountToDelete, setAccountToDelete] = useState<PopupAccount | null>(null);
  const [accountToEditOrigin, setAccountToEditOrigin] = useState<PopupAccount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdatingOrigin, setIsUpdatingOrigin] = useState(false);

  const refreshAccounts = useCallback(async () => {
    try {
      const result = await backend.listAccounts();
      let popupAccounts: PopupAccount[] = result.accounts.map((a) => ({
        ...a,
        additionalOrigins: a.additionalOrigins ?? [],
        allOrigins: dedupe([a.origin, ...(a.additionalOrigins ?? [])]),
      }));

      // If vault is locked and listAccounts returned empty, restore cached directory
      if (result.vaultLocked && popupAccounts.length === 0) {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const stored = await chrome.storage.local.get("keytap:account_directory");
          if (Array.isArray(stored["keytap:account_directory"]) && stored["keytap:account_directory"].length > 0) {
            popupAccounts = (stored["keytap:account_directory"] as AccountSummary[]).map((a) => ({
              ...a,
              additionalOrigins: a.additionalOrigins ?? [],
              allOrigins: dedupe([a.origin, ...(a.additionalOrigins ?? [])]),
            }));
          }
        }
      } else if (!result.vaultLocked && popupAccounts.length > 0) {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          void chrome.storage.local.set({ "keytap:account_directory": popupAccounts });
        }
      }

      setAccounts(popupAccounts);
      setStatus((prev) => ({
        vaultState: backend.isMock ? "demo" : result.vaultLocked ? "locked" : "unlocked",
        vaultLocked: result.vaultLocked,
        autoLockAt: prev?.autoLockAt ?? null,
        sessionExpiresAt: prev?.sessionExpiresAt ?? null,
        hostVersion: hostVersionLabel ?? backend.hostVersionLabel,
        vaultExists: prev?.vaultExists ?? false,
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
      setSettings(s);
      await refreshAccounts();
      const st = await backend.getStatus().catch(() => null);
      if (st) {
        setStatus({
          vaultState: backend.isMock ? "demo" : st.vaultLocked ? "locked" : "unlocked",
          vaultLocked: st.vaultLocked,
          autoLockAt: st.autoLockAt,
          sessionExpiresAt: st.sessionExpiresAt,
          hostVersion: hostVersionLabel ?? backend.hostVersionLabel,
          vaultExists: st.vaultExists,
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
          vaultExists: st.vaultExists,
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
      const delay = Math.max(300, Math.min(minRemaining + 100, 5_000));
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
    async (account: PopupAccount) => {
      let otp = codes.get(account.id);
      if (!otp || otp.expiresAt <= Date.now() + 1000) {
        try {
          const resp = await backend.getCode(account.id, activeOrigin ?? account.origin);
          otp = {
            accountId: account.id,
            code: resp.code,
            issuedAt: resp.issuedAt,
            expiresAt: resp.expiresAt,
            period: 30,
            digits: resp.code.length,
          };
          setCodes((prev) => new Map(prev).set(account.id, otp!));
        } catch {
          // fallback
        }
      }
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
    [codes, backend, activeOrigin],
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
      let otp = codes.get(account.id);
      if (!otp || otp.expiresAt <= Date.now() + 2000) {
        try {
          const resp = await backend.getCode(account.id, activeOrigin);
          otp = {
            accountId: account.id,
            code: resp.code,
            issuedAt: resp.issuedAt,
            expiresAt: resp.expiresAt,
            period: 30,
            digits: resp.code.length,
          };
          setCodes((prev) => new Map(prev).set(account.id, otp!));
        } catch {
          // fallback
        }
      }
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
        description: settings.autoSubmit
          ? "Code filled and submitted automatically."
          : "Form was NOT submitted (auto-submit is turned off).",
      });
    },
    [activeOrigin, codes, backend, settings.autoSubmit],
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

  const handleImport = useCallback(
    async (uri: string, passphrase: string, targetOrigin?: string) => {
      const effectiveOrigin = targetOrigin || activeOrigin;
      if (backend.isMock) {
        const result = await backend.addMockAccount?.(uri);
        if (!result || !result.ok) throw new Error(result?.error ?? "Demo import is unavailable");
      } else {
        if (!effectiveOrigin) throw new Error("Open the website this account belongs to before importing, or enter its domain.");
        if (!backend.importAccount) throw new Error("This native host build does not support account import yet. Rebuild and reinstall the native host.");
        await backend.importAccount(uri, effectiveOrigin, passphrase);
      }
      if (typeof chrome !== "undefined" && chrome.storage?.local && passphrase) {
        await chrome.storage.local.set({ "keytap:biometric_passphrase": passphrase.trim() });
      }
      await refreshAccounts();
      const st = await backend.getStatus().catch(() => null);
      if (st) setStatus({ vaultState: backend.isMock ? "demo" : st.vaultLocked ? "locked" : "unlocked", vaultLocked: st.vaultLocked, vaultExists: st.vaultExists, autoLockAt: st.autoLockAt, sessionExpiresAt: st.sessionExpiresAt, hostVersion: hostVersionLabel ?? backend.hostVersionLabel });
    },
    [backend, activeOrigin, refreshAccounts, hostVersionLabel],
  );

  const handleImportBatch = useCallback(
    async (
      items: Array<{ uri: string; origin: string }>,
      passphrase: string,
    ): Promise<{ succeeded: number; failed: number }> => {
      let succeeded = 0;
      let failed = 0;

      for (const item of items) {
        try {
          if (backend.isMock) {
            const res = await backend.addMockAccount?.(item.uri);
            if (res && res.ok) succeeded++;
            else failed++;
          } else {
            if (!backend.importAccount) {
              throw new Error("This native host build does not support account import yet.");
            }
            await backend.importAccount(item.uri, item.origin, passphrase);
            succeeded++;
          }
        } catch (e) {
          console.error("Failed importing account:", item.origin, e);
          failed++;
        }
      }

      if (typeof chrome !== "undefined" && chrome.storage?.local && passphrase && succeeded > 0) {
        await chrome.storage.local.set({ "keytap:biometric_passphrase": passphrase.trim() });
      }

      await refreshAccounts();
      const st = await backend.getStatus().catch(() => null);
      if (st) {
        setStatus({
          vaultState: backend.isMock ? "demo" : st.vaultLocked ? "locked" : "unlocked",
          vaultLocked: st.vaultLocked,
          vaultExists: st.vaultExists,
          autoLockAt: st.autoLockAt,
          sessionExpiresAt: st.sessionExpiresAt,
          hostVersion: hostVersionLabel ?? backend.hostVersionLabel,
        });
      }

      if (succeeded > 0) {
        toast.success(`Imported ${succeeded} account${succeeded === 1 ? "" : "s"} successfully`, {
          description: failed > 0 ? `${failed} account(s) could not be saved.` : undefined,
        });
      } else if (failed > 0) {
        toast.error("Failed to import accounts", {
          description: "Check your vault passphrase and try again.",
        });
      }

      return { succeeded, failed };
    },
    [backend, refreshAccounts, hostVersionLabel],
  );

  const handleUnlock = useCallback(async (passphrase: string) => {
    if (!backend.unlockVault) throw new Error("Vault unlock is unavailable in this host build.");
    await backend.unlockVault(passphrase);
    if (typeof chrome !== "undefined" && chrome.storage?.local && passphrase) {
      await chrome.storage.local.set({ "keytap:biometric_passphrase": passphrase.trim() });
    }
    await refreshAccounts();
    const st = await backend.getStatus();
    if (st) setStatus({ vaultState: st.vaultLocked ? "locked" : "unlocked", vaultLocked: st.vaultLocked, vaultExists: st.vaultExists, autoLockAt: st.autoLockAt, sessionExpiresAt: st.sessionExpiresAt, hostVersion: hostVersionLabel ?? backend.hostVersionLabel });
  }, [backend, refreshAccounts, hostVersionLabel]);

  const handleConfirmDelete = useCallback(async () => {
    if (!accountToDelete) return;
    setIsDeleting(true);
    try {
      if (backend.isMock) {
        await backend.deleteAccount?.(accountToDelete.id);
      } else {
        if (!backend.deleteAccount) {
          throw new Error("This native host build does not support account deletion yet.");
        }
        await backend.deleteAccount(accountToDelete.id);
      }
      await refreshAccounts();
      toast.success("Account deleted", {
        description: `${accountToDelete.issuer || accountToDelete.label} was removed from your vault.`,
      });
      setAccountToDelete(null);
    } catch (e) {
      toast.error("Could not delete account", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsDeleting(false);
    }
  }, [accountToDelete, backend, refreshAccounts]);

  const handleUpdateOrigin = useCallback(
    async (accountId: string, newOrigin: string) => {
      const normalized = normalizeOrigin(newOrigin);
      if (!normalized) {
        toast.error("Invalid website domain", {
          description: "Please enter a valid domain (e.g. github.com or https://github.com).",
        });
        return;
      }
      setIsUpdatingOrigin(true);
      try {
        if (!backend.updateAccountOrigin) {
          throw new Error("Updating origins is not supported by this backend build.");
        }
        await backend.updateAccountOrigin(accountId, normalized);
        await refreshAccounts();
        toast.success("Website updated", {
          description: `Account is now authorized to autofill on ${normalized}.`,
        });
        setAccountToEditOrigin(null);
      } catch (e) {
        toast.error("Could not update website", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setIsUpdatingOrigin(false);
      }
    },
    [backend, refreshAccounts],
  );

  const matchingAccount = useMemo(() => {
    if (!activeOrigin || accounts.length === 0) return null;
    return accounts.find((a) => originMatches(a, activeOrigin)) ?? null;
  }, [accounts, activeOrigin]);

  const vaultState: VaultState = status?.vaultState ?? (backend.isMock ? "demo" : "host-down");
  const canLock = backend.isMock ? true : vaultState === "unlocked";

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <TopBar
        vaultState={vaultState}
        onAdd={() => setShowAdd(true)}
        onImport={() => setShowImport(true)}
        onSettings={() => setShowSettings(true)}
        onLock={handleLock}
        canLock={canLock}
      />
      <ActiveSitePanel origin={activeOrigin} vaultState={vaultState} />
      {vaultState !== "locked" && vaultState !== "host-down" && (
        <SearchBar value={search} onChange={setSearch} />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : vaultState === "host-down" ? (
          <HostDownView />
        ) : vaultState === "locked" ? (
          <VaultLockedView
            vaultExists={status?.vaultExists ?? false}
            onUnlock={handleUnlock}
            onAddAccount={() => setShowAdd(true)}
            matchingAccount={matchingAccount}
            activeOrigin={activeOrigin}
            onAutofillActiveSite={handleFill}
          />
        ) : (
          <AccountList
            accounts={accounts}
            codes={codes}
            now={now}
            activeOrigin={activeOrigin}
            search={search}
            onReveal={handleReveal}
            onFill={handleFill}
            onDelete={setAccountToDelete}
            onEditOrigin={setAccountToEditOrigin}
          />
        )}
      </div>
      <StatusBar status={status} settings={settings} now={now} />

      <AddAccountDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        mockMode={backend.isMock}
        onAddMock={handleAddMock}
        origin={activeOrigin}
        vaultExists={status?.vaultExists ?? false}
        vaultLocked={status?.vaultLocked ?? !backend.isMock}
        onImport={handleImport}
        onUnlock={handleUnlock}
      />
      <ImportAccountsDialog
        open={showImport}
        onOpenChange={setShowImport}
        mockMode={backend.isMock}
        activeOrigin={activeOrigin}
        vaultExists={status?.vaultExists ?? false}
        vaultLocked={status?.vaultLocked ?? !backend.isMock}
        onImportBatch={handleImportBatch}
        onUnlock={handleUnlock}
      />
      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        settings={settings}
        onChange={saveSettings}
      />
      <DeleteAccountDialog
        open={!!accountToDelete}
        account={accountToDelete}
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setAccountToDelete(null)}
      />
      <EditOriginDialog
        open={!!accountToEditOrigin}
        account={accountToEditOrigin}
        activeOrigin={activeOrigin}
        isUpdating={isUpdatingOrigin}
        onConfirm={handleUpdateOrigin}
        onCancel={() => setAccountToEditOrigin(null)}
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

function ActiveSitePanel({
  origin,
  vaultState,
}: {
  origin: string | null;
  vaultState: VaultState;
}) {
  const label = origin ? origin.replace(/^https?:\/\//, "") : "No supported website";
  const isUnavailable = !origin;
  const isHostDown = vaultState === "host-down";

  return (
    <section
      className={cn(
        "mx-3 mt-3 rounded-xl border px-3 py-2.5",
        isUnavailable || isHostDown
          ? "border-amber-200 bg-amber-50/80 dark:border-amber-900/70 dark:bg-amber-950/20"
          : "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/70 dark:bg-emerald-950/20",
      )}
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
            isUnavailable || isHostDown
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
          )}
        >
          {isUnavailable || isHostDown ? <ShieldX className="size-4" /> : <Globe2 className="size-4" />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Current website
            {!isUnavailable && !isHostDown && <ShieldCheck className="size-3.5 text-emerald-600" />}
          </div>
          <p className="mt-0.5 truncate text-sm font-semibold" title={origin ?? undefined}>
            {label}
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {isHostDown
              ? "The native host is unavailable. Reopen Keytap after starting it."
              : isUnavailable
                ? "Open a regular website to enable secure autofill."
                : "Only accounts authorized for this exact origin can be filled."}
          </p>
        </div>
      </div>
    </section>
  );
}

function VaultLockedView({
  vaultExists,
  onUnlock,
  onAddAccount,
  matchingAccount,
  activeOrigin,
  onAutofillActiveSite,
}: {
  vaultExists: boolean;
  onUnlock: (passphrase: string) => Promise<void>;
  onAddAccount: () => void;
  matchingAccount?: PopupAccount | null;
  activeOrigin?: string | null;
  onAutofillActiveSite?: (account: PopupAccount) => Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasSavedPassphrase, setHasSavedPassphrase] = useState(false);

  useEffect(() => {
    void (async () => {
      const pass = await getSavedBiometricPassphrase();
      setHasSavedPassphrase(Boolean(pass));
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase.trim() || busy) return;
    setError(null);
    setBusy(true);
    try {
      await onUnlock(passphrase);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleTouchIdUnlock() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const verified = await promptTouchIdOrPasscode("unlock Keytap vault");
      if (!verified) {
        setBusy(false);
        return;
      }
      const savedPass = await getSavedBiometricPassphrase();
      if (!savedPass) {
        setError("No biometric credential saved. Enter your passphrase once to enable Touch ID.");
        setBusy(false);
        return;
      }
      await onUnlock(savedPass);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickAutofill() {
    if (busy || !matchingAccount) return;
    setError(null);
    setBusy(true);
    try {
      const verified = await promptTouchIdOrPasscode("autofill 2FA code");
      if (!verified) {
        setBusy(false);
        return;
      }
      const savedPass = await getSavedBiometricPassphrase();
      if (savedPass) {
        await onUnlock(savedPass);
      }
      await onAutofillActiveSite?.(matchingAccount);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!vaultExists) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <KeyRound className="size-7" />
        </div>
        <h2 className="text-base font-semibold">Welcome to Keytap</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          No vault found. Add your first 2FA account to create your encrypted vault.
        </p>
        <Button onClick={onAddAccount} className="mt-5 w-full gap-2">
          <Plus className="size-4" />
          Add first account
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-5 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-foreground">
        <Lock className="size-6" />
      </div>
      <h2 className="text-base font-semibold">Vault is locked</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {hasSavedPassphrase
          ? "Unlock with Touch ID or enter your vault passphrase."
          : "Enter your passphrase once to access your 2FA accounts and enable Touch ID."}
      </p>

      {error && (
        <Alert variant="destructive" className="mt-3 py-2 text-left w-full">
          <AlertDescription className="break-all text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {matchingAccount && (
        <div className="mt-4 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-left">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                <Sparkles className="size-3" />
                Current website match
              </div>
              <p className="mt-0.5 truncate text-xs font-semibold">
                {matchingAccount.issuer || matchingAccount.label}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {activeOrigin}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={handleQuickAutofill}
              className="gap-1.5 shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-8 px-2.5 shadow-sm"
            >
              <Fingerprint className="size-3.5" />
              Autofill
            </Button>
          </div>
        </div>
      )}

      {hasSavedPassphrase && (
        <div className="mt-3 w-full">
          <Button
            type="button"
            disabled={busy}
            onClick={handleTouchIdUnlock}
            className="w-full gap-2 bg-primary text-primary-foreground font-medium shadow-sm"
          >
            <Fingerprint className="size-4" />
            {busy ? "Authenticating…" : "Unlock with Touch ID"}
          </Button>

          <div className="relative my-3 flex items-center justify-center">
            <div className="w-full border-t border-border" />
            <span className="absolute bg-background px-2 text-[10px] uppercase text-muted-foreground">
              or enter passphrase
            </span>
          </div>
        </div>
      )}

      <form onSubmit={submit} className={cn("w-full space-y-2.5", !hasSavedPassphrase && "mt-4")}>
        <Input
          type="password"
          placeholder="Vault passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoFocus={!hasSavedPassphrase}
          disabled={busy}
          autoComplete="current-password"
        />
        <Button type="submit" variant={hasSavedPassphrase ? "outline" : "default"} className="w-full" disabled={busy || !passphrase}>
          {busy ? "Unlocking…" : "Unlock vault"}
        </Button>
      </form>
    </div>
  );
}

function HostDownView() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <ShieldX className="size-7" />
      </div>
      <h2 className="text-base font-semibold">Native host unavailable</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        Keytap cannot connect to its local native host. Please ensure the native host is registered and reload the extension.
      </p>
    </div>
  );
}

function DeleteAccountDialog({
  open,
  account,
  isDeleting,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  account: PopupAccount | null;
  isDeleting: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  if (!account) return null;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !isDeleting) onCancel(); }}>
      <DialogContent className="max-w-[340px] p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-destructive">
            <Trash2 className="size-4" />
            Delete account
          </DialogTitle>
          <DialogDescription className="text-xs">
            Are you sure you want to delete <span className="font-semibold text-foreground">{account.issuer || account.label}</span>? This will permanently remove the 2FA secret from your encrypted vault.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2 flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void onConfirm()} disabled={isDeleting}>
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditOriginDialog({
  open,
  account,
  activeOrigin,
  isUpdating,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  account: PopupAccount | null;
  activeOrigin: string | null;
  isUpdating: boolean;
  onConfirm: (accountId: string, newOrigin: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [domainInput, setDomainInput] = useState("");

  useEffect(() => {
    if (account) {
      setDomainInput(account.origin.replace(/^https?:\/\//, ""));
    }
  }, [account]);

  const normalized = normalizeOrigin(domainInput);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isUpdating) onCancel(); }}>
      <DialogContent className="max-w-[340px] p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Globe2 className="size-4 text-primary" />
            Edit autofill website
          </DialogTitle>
          <DialogDescription className="text-xs">
            Set the website domain where <span className="font-semibold text-foreground">{account?.issuer || account?.label}</span> should autofill.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="edit-domain" className="text-xs">
              Website domain or URL
            </Label>
            <Input
              id="edit-domain"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="e.g. github.com"
              className="font-mono text-xs h-8"
              autoFocus
            />
          </div>

          {activeOrigin && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs h-7 gap-1.5"
              onClick={() => setDomainInput(activeOrigin.replace(/^https?:\/\//, ""))}
            >
              <Globe2 className="size-3 text-primary" />
              Use current tab ({activeOrigin.replace(/^https?:\/\//, "")})
            </Button>
          )}

          {normalized ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-2 text-[11px] text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300">
              Autofills on: <span className="font-mono font-semibold">{normalized}</span>
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50/50 p-2 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
              Enter a valid website domain so autofill can match.
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isUpdating}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => account && void onConfirm(account.id, domainInput)}
            disabled={isUpdating || !normalized}
          >
            {isUpdating ? "Saving…" : "Save website"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
