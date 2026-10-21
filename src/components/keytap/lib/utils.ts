/**
 * Shared utilities for the popup UI. Re-exports `cn` from the Next.js
 * shadcn helpers so the popup doesn't have to know about @/lib/utils paths.
 *
 * SECURITY NOTE: nothing in this file touches secrets or talks to the
 * native host. It is pure presentation + time math.
 */

export { cn } from "@/lib/utils";

/**
 * Format a millisecond countdown as "M:SS" (or just "SS" if < 60s).
 * Returns "--" for non-finite inputs (NaN / Infinity).
 *
 * @example formatCountdown(30000)  // "0:30"
 * @example formatCountdown(5000)   // "0:05"
 * @example formatCountdown(90000)  // "1:30"
 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Strip an origin down to a short, human-readable label suitable for the
 * account row's secondary text.
 *
 *   "https://github.com"            -> "github.com"
 *   "https://account.proton.me"     -> "account.proton.me"
 *   "https://login.example.com:8443"-> "login.example.com"
 *   ""                              -> "(no origin)"
 *
 * The port is intentionally dropped — it's not interesting to the user
 * and is not part of the origin comparison we do in origin-validator.ts.
 */
export function shortOrigin(origin: string): string {
  if (!origin) return "(no origin)";
  try {
    const u = new URL(origin);
    return u.hostname;
  } catch {
    return origin.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
  }
}

/**
 * Derive 1–2 uppercase initials from an issuer name.
 *
 *   "GitHub"      -> "GH"
 *   "Proton Mail" -> "PM"
 *   "Cloudflare"  -> "CL"
 *   ""            -> "??"
 *
 * Used for the colored badge avatar on each account row.
 */
export function initials(issuer: string): string {
  if (!issuer || !issuer.trim()) return "??";
  const parts = issuer.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const w = parts[0];
    return (w[0] + (w[1] ?? "")).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
