/**
 * Account schema — the in-extension representation of a vault account.
 *
 * SECURITY INVARIANT: this interface has NO `secret` field. The popup and
 * extension NEVER hold the shared secret. Only derived TOTP codes (short-
 * lived, 6-8 digits) cross from the native host to the extension.
 *
 * The native host's `AccountSummary` (see @keytap/protocol) is a strict
 * subset of this — additional UI-only fields (e.g. lastUsedAt) live here.
 */

import type { AccountSummary } from "@keytap/protocol";

export interface Account extends AccountSummary {
  /** UI-only: when this account was last used (filled). Null = never. */
  lastUsedAt?: number | null;
  /** UI-only: user-assigned color index (for the avatar badge). */
  colorIndex?: number;
}
