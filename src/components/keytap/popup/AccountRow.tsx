/**
 * AccountRow — single account row with countdown ring + code display.
 *
 * Layout (360px wide, ~64px tall):
 *
 *   [ring] [issuer/label/origin]    [code]    [Fill|Reveal]
 *
 * The Fill button is enabled only if `originMatch` is true (the active
 * tab's origin is in the account's `allOrigins` list). Otherwise a
 * Reveal button shows the code in-place without filling any field.
 */

import { ShieldCheck, ShieldAlert, Eye, Keyboard, Trash2, Globe2 } from "lucide-react";
import type { PopupAccount, PopupOtp } from "./types";
import { cn, formatCountdown, shortOrigin, initials } from "@keytap/lib";

export function AccountRow({
  account,
  otp,
  now,
  originMatch,
  onReveal,
  onFill,
  onDelete,
  onEditOrigin,
}: {
  account: PopupAccount;
  otp: PopupOtp | null;
  now: number;
  originMatch: boolean;
  onReveal: (account: PopupAccount) => void;
  onFill: (account: PopupAccount) => void;
  onDelete: (account: PopupAccount) => void;
  onEditOrigin?: (account: PopupAccount) => void;
}) {
  const remainingMs = otp ? Math.max(0, otp.expiresAt - now) : 0;
  const progress = otp ? remainingMs / (otp.period * 1000) : 0;
  const code = otp?.code ?? "";
  const formatted = formatCode(code);

  return (
    <li
      className={cn(
        "group rounded-xl border p-3 transition-colors",
        originMatch
          ? "border-emerald-200 bg-emerald-50/70 shadow-sm shadow-emerald-950/5 dark:border-emerald-900/70 dark:bg-emerald-950/20"
          : "border-border bg-card hover:border-foreground/20 hover:bg-accent/30",
      )}
    >
      <div className="flex items-start gap-2.5">
        <CountdownRing progress={progress} remainingLabel={formatCountdown(remainingMs)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Avatar initials={initials(account.issuer)} />
            <span className="truncate text-sm font-semibold">{account.issuer || account.label}</span>
            {originMatch ? (
              <ShieldCheck className="size-3.5 shrink-0 text-emerald-600" aria-label="Matches current website" />
            ) : (
              <ShieldAlert className="size-3.5 shrink-0 text-muted-foreground/50" aria-label="Does not match current website" />
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {account.label || "Account"} · <span className="font-mono">{shortOrigin(account.origin)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={cn(
              "font-mono text-base font-semibold tabular-nums tracking-[0.12em]",
              code ? "text-foreground" : "text-muted-foreground/40",
            )}
            aria-label={code ? `Current code ${code}` : "No code available"}
          >
            {formatted}
          </div>
          <span className="text-[10px] text-muted-foreground">{code ? `${formatCountdown(remainingMs)} left` : "Loading"}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {originMatch ? (
          <ActionButton
            label="Fill code into the OTP field"
            onClick={() => onFill(account)}
            icon={<Keyboard className="size-3.5" />}
            variant="default"
          >
            Fill code
          </ActionButton>
        ) : (
          <ActionButton
            label="Reveal code (origin not authorized for autofill)"
            onClick={() => onReveal(account)}
            icon={<Eye className="size-3.5" />}
            variant="outline"
          >
            Copy code
          </ActionButton>
        )}
        {onEditOrigin && (
          <button
            type="button"
            onClick={() => onEditOrigin(account)}
            title={`Change authorized website for ${account.issuer || account.label}`}
            aria-label={`Change authorized website for ${account.issuer || account.label}`}
            className="flex size-7 items-center justify-center rounded-lg border border-transparent text-muted-foreground/60 transition-colors hover:border-foreground/20 hover:bg-accent/40 hover:text-foreground"
          >
            <Globe2 className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(account)}
          title={`Delete ${account.issuer || account.label}`}
          aria-label={`Delete ${account.issuer || account.label}`}
          className="flex size-7 items-center justify-center rounded-lg border border-transparent text-muted-foreground/50 transition-colors hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {originMatch ? "Safe for this site" : "Different website"}
        </span>
      </div>
    </li>
  );
}

/** "123456" -> "123 456"; "12345678" -> "1234 5678"; "" -> "------" */
function formatCode(code: string): string {
  if (!code) return "------";
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  if (code.length === 7) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}

function CountdownRing({
  progress,
  remainingLabel,
}: {
  /** 0..1 — fraction of the step remaining. */
  progress: number;
  remainingLabel: string;
}) {
  const r = 11;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  const dash = c * clamped;
  const danger = progress < 0.2;
  return (
    <div className="relative size-7 shrink-0" aria-label={`${remainingLabel} remaining`}>
      <svg viewBox="0 0 28 28" className="size-7 -rotate-90">
        <circle
          cx="14"
          cy="14"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground/20"
        />
        <circle
          cx="14"
          cy="14"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          className={cn(
            "transition-[stroke-dasharray] duration-300",
            danger ? "text-amber-500" : "text-primary",
          )}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center text-[9px] font-medium tabular-nums",
          danger ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}
      >
        {remainingLabel.replace(/^0:/, "")}
      </span>
    </div>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[8px] font-bold text-muted-foreground"
    >
      {initials}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  icon,
  variant,
  children,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  variant: "default" | "outline";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        variant === "default"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
