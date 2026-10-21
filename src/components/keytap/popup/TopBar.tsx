/**
 * TopBar — compact header for the popup.
 *
 * Shows: brand mark, vault-state badge, and add/settings/lock buttons.
 *
 * Layout: 360px wide × 48px tall. Dense.
 */

import { ShieldCheck, Lock, Plus, Settings, ShieldAlert, ShieldX, FlaskConical, ArrowDownToLine } from "lucide-react";
import type { VaultState } from "./types";
import { cn } from "@keytap/lib";

export function TopBar({
  vaultState,
  onAdd,
  onImport,
  onSettings,
  onLock,
  canLock,
}: {
  vaultState: VaultState;
  onAdd: () => void;
  onImport?: () => void;
  onSettings: () => void;
  onLock: () => void;
  canLock: boolean;
}) {
  const badge = renderStateBadge(vaultState);
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-card px-3",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <BrandMark />
        <span className="truncate text-sm font-semibold tracking-tight">Keytap</span>
        {badge}
      </div>
      <div className="flex items-center gap-1">
        {onImport && (
          <IconButton label="Import accounts from Google Authenticator, etc." onClick={onImport} disabled={vaultState === "host-down"}>
            <ArrowDownToLine className="size-4" />
          </IconButton>
        )}
        <IconButton label="Add account" onClick={onAdd} disabled={vaultState === "host-down"}>
          <Plus className="size-4" />
        </IconButton>
        <IconButton label="Settings" onClick={onSettings}>
          <Settings className="size-4" />
        </IconButton>
        <IconButton
          label="Lock vault"
          onClick={onLock}
          disabled={!canLock}
          variant={canLock ? "default" : "ghost"}
        >
          <Lock className="size-4" />
        </IconButton>
      </div>
    </header>
  );
}

function renderStateBadge(state: VaultState) {
  switch (state) {
    case "demo":
      return (
        <span
          title="Mock backend — codes are derived from a published RFC 6238 test vector, not real secrets"
          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
        >
          <FlaskConical className="size-3" />
          DEMO
        </span>
      );
    case "locked":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <Lock className="size-3" />
          Locked
        </span>
      );
    case "unlocked":
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
          <ShieldCheck className="size-3" />
          Unlocked
        </span>
      );
    case "host-down":
      return (
        <span
          title="Native host is not running or unreachable. Load the unpacked extension and install the native messaging host (see SETUP.md)."
          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
        >
          <ShieldX className="size-3" />
          Host down
        </span>
      );
  }
}

function BrandMark() {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
    >
      <ShieldAlert className="size-3.5" />
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  variant = "ghost",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "ghost" | "default";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "pointer-events-none opacity-40",
        variant === "ghost"
          ? "text-muted-foreground hover:bg-accent hover:text-foreground"
          : "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      {children}
    </button>
  );
}
