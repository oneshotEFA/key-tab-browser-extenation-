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

import { ShieldCheck, ShieldAlert, Eye, Keyboard } from "lucide-react";
import type { PopupAccount, PopupOtp } from "./types";
import { cn, formatCountdown, shortOrigin, initials } from "@keytap/lib";

export function AccountRow({
  account,
  otp,
  now,
  originMatch,
  onReveal,
  onFill,
}: {
  account: PopupAccount;
  otp: PopupOtp | null;
  now: number;
  originMatch: boolean;
  onReveal: (account: PopupAccount) => void;
  onFill: (account: PopupAccount) => void;
}) {
  const remainingMs = otp ? Math.max(0, otp.expiresAt - now) : 0;
  const progress = otp ? remainingMs / (otp.period * 1000) : 0;
  const code = otp?.code ?? "";
  const formatted = formatCode(code);

  return (
    <li
      className={cn(
        "group flex items-center gap-3 px-3 py-2 transition-colors",
        "hover:bg-accent/40",
        originMatch && "bg-emerald-50/60 dark:bg-emerald-950/20",
      )}
    >
      {/* Countdown ring */}
      <CountdownRing progress={progress} remainingLabel={formatCountdown(remainingMs)} />

      {/* Identity */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Avatar initials={initials(account.issuer)} />
          <span className="truncate text-sm font-medium">{account.issuer || account.label}</span>
          {originMatch ? (
            <ShieldCheck
              className="size-3.5 shrink-0 text-emerald-500"
              aria-label="Origin matches active tab"
            />
          ) : (
            <ShieldAlert
              className="size-3.5 shrink-0 text-muted-foreground/40"
              aria-label="Origin does not match active tab"
            />
          )}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {account.label || shortOrigin(account.origin)}
          <span className="mx-1 text-muted-foreground/50">·</span>
          <span className="font-mono">{shortOrigin(account.origin)}</span>
        </div>
      </div>

      {/* Code */}
      <div
        className={cn(
          "shrink-0 font-mono text-sm tabular-nums tracking-wider",
          code ? "text-foreground" : "text-muted-foreground/40",
        )}
        aria-label={code ? `Current code ${code}` : "No code available"}
      >
        {formatted}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {originMatch ? (
          <ActionButton
            label="Fill code into the OTP field"
            onClick={() => onFill(account)}
            icon={<Keyboard className="size-3.5" />}
            variant="default"
          />
        ) : (
          <ActionButton
            label="Reveal code (origin not authorized for autofill)"
            onClick={() => onReveal(account)}
            icon={<Eye className="size-3.5" />}
            variant="outline"
          />
        )}
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
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  variant: "default" | "outline";
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        variant === "default"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon}
    </button>
  );
}
