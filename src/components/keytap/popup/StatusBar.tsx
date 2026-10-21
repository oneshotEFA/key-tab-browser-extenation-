/**
 * StatusBar — footer for the popup.
 *
 * Shows: DEMO mode warning (when applicable), auto-lock countdown, and the
 * host version. Compact: 360px wide × 24px tall.
 */

import { FlaskConical, Clock } from "lucide-react";
import type { PopupSettings, PopupStatus } from "./types";
import { cn, formatCountdown } from "@keytap/lib";

export function StatusBar({
  status,
  settings,
  now,
}: {
  status: PopupStatus | null;
  settings: PopupSettings;
  now: number;
}) {
  const autoLockMs =
    status?.autoLockAt && status.autoLockAt > now ? status.autoLockAt - now : null;
  const sessionMs =
    status?.sessionExpiresAt && status.sessionExpiresAt > now
      ? status.sessionExpiresAt - now
      : null;
  const isDemo = status?.vaultState === "demo";

  return (
    <footer
      className={cn(
        "flex h-6 shrink-0 items-center justify-between gap-2 border-t bg-card px-3 text-[10px] text-muted-foreground",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {isDemo && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <FlaskConical className="size-3" />
            <span className="truncate">DEMO · RFC test vector</span>
          </span>
        )}
        {!isDemo && autoLockMs !== null && (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            <span className="tabular-nums">Lock in {formatCountdown(autoLockMs)}</span>
          </span>
        )}
        {!isDemo && sessionMs !== null && autoLockMs === null && (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            <span className="tabular-nums">Session {formatCountdown(sessionMs)}</span>
          </span>
        )}
        {!isDemo && autoLockMs === null && sessionMs === null && status?.vaultState === "unlocked" && (
          <span className="truncate">Unlocked</span>
        )}
        {status?.vaultState === "locked" && <span className="truncate">Locked</span>}
        {status?.vaultState === "host-down" && (
          <span className="truncate text-destructive">Host unavailable</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {settings.neverAutoSubmit && <span className="hidden sm:inline">· no auto-submit</span>}
        <span className="font-mono tabular-nums">
          v{status?.hostVersion ?? "0.0.0"}
        </span>
      </div>
    </footer>
  );
}
