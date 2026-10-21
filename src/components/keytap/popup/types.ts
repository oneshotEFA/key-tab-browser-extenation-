/**
 * Popup-only types. These are UI-facing types distinct from the wire-protocol
 * types in @keytap/protocol — they are deliberately narrower and contain
 * NO secret material (no secretB32, no raw bytes).
 */

import type { AccountSummary } from "@keytap/protocol";

/**
 * Coarse state of the vault as displayed in the TopBar badge.
 *
 *   - "demo"      : mock backend (KEYTAP_MOCK=1)
 *   - "locked"    : native host reports vaultLocked=true
 *   - "unlocked"  : native host reports vaultLocked=false
 *   - "host-down" : connectNative failed / host process exited / parse error
 */
export type VaultState = "demo" | "locked" | "unlocked" | "host-down";

/**
 * Account row as displayed in the popup. NOTE: there is no `secret` field
 * here by design — the popup never holds the shared secret in production
 * mode (it gets only derived codes from the native host).
 */
export interface PopupAccount extends AccountSummary {
  /** Convenience: combined list of origin + additionalOrigins for matching. */
  allOrigins: string[];
}

/**
 * Live OTP state for one account. The code itself is short-lived (30s);
 * the popup UI re-polls/re-generates it periodically.
 */
export interface PopupOtp {
  accountId: string;
  code: string;
  /** Unix ms when this code was generated. */
  issuedAt: number;
  /** Unix ms when this code rolls over. */
  expiresAt: number;
  /** Step period in seconds (typically 30). */
  period: number;
  /** Number of digits (typically 6). */
  digits: number;
}

/**
 * Aggregated vault status returned by PopupBackend.getStatus().
 */
export interface PopupStatus {
  vaultState: VaultState;
  vaultLocked: boolean;
  vaultExists?: boolean;
  /** Unix ms when the vault auto-locks, or null. */
  autoLockAt: number | null;
  /** Unix ms when the unlock session expires (hard cap = 30 min), or null. */
  sessionExpiresAt: number | null;
  /** Host version string for display in StatusBar. */
  hostVersion: string;
}

/**
 * Persisted user settings. Stored in chrome.storage.local in the extension,
 * and in localStorage in the preview harness.
 */
export interface PopupSettings {
  /** Inactivity timeout in seconds before the vault auto-locks (15..1800). */
  inactivityLockSec: number;
  /** Hard cap on the unlock session in seconds (max 1800 = 30 min). */
  maxSessionSec: number;
  /** Lock the vault when the OS locks (screen-saver / sleep). */
  lockOnOsLock: boolean;
  /** Require OS re-auth (Touch ID / Windows Hello) before deleting accounts. */
  requireReauthForDelete: boolean;
  /** Require OS re-auth before exporting the encrypted vault backup. */
  requireReauthForExport: boolean;
  /**
   * If true, autofill places the code into the OTP field but does NOT
   * submit the form. ALWAYS on; UI exposes it as a read-only toggle.
   * This is a hard security invariant.
   */
  neverAutoSubmit: true;
  /** UI theme. */
  theme: "light" | "system" | "dark";
}

/** Default settings for a fresh install. */
export const DEFAULT_SETTINGS: PopupSettings = {
  inactivityLockSec: 300,
  maxSessionSec: 1800,
  lockOnOsLock: true,
  requireReauthForDelete: true,
  requireReauthForExport: true,
  neverAutoSubmit: true,
  theme: "system",
};
