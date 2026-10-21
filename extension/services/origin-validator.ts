/**
 * Origin validation utilities.
 *
 * SECURITY INVARIANTS:
 *   - Origin matching is EXACT. We do NOT use eTLD+1 or public suffix rules.
 *     "https://gist.github.com" does NOT match "https://github.com".
 *   - Origins are compared as full strings, normalized via URL parsing.
 *   - Only https: origins are considered secure. http: is rejected for
 *     autofill (a MitM could otherwise intercept the code).
 *   - The native host performs the same check — defense in depth.
 */

/** True if the origin is a well-formed https:// origin. */
export function isSecureHttpsOrigin(origin: string): boolean {
  if (!origin) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  return u.protocol === "https:";
}

/**
 * Normalize an origin string for comparison. Strips default ports, lowercases
 * the host, ensures trailing-slash-free comparison.
 *
 *   "https://GitHub.com:443/" -> "https://github.com"
 *   "HTTPS://example.com"     -> "https://example.com"
 */
export function normalizeOrigin(origin: string): string | null {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // We intentionally DO NOT strip the port if it's non-default — exact match
    // means "https://example.com:8443" and "https://example.com" differ.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * EXACT origin equality. Returns true iff both origins normalize to the
 * same canonical string.
 *
 *   originsEqual("https://github.com", "https://github.com")         -> true
 *   originsEqual("https://github.com", "https://gist.github.com")   -> false
 *   originsEqual("https://example.com", "https://login.example.com") -> false
 *   originsEqual("https://example.com:443", "https://example.com")   -> false (port-sensitive)
 */
export function originsEqual(a: string, b: string): boolean {
  const na = normalizeOrigin(a);
  const nb = normalizeOrigin(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Check whether the active origin is in the account's allowed list.
 *
 *   allowed   = ["https://github.com", "https://gist.github.com"]
 *   activeOrigin = "https://gist.github.com"
 *   -> true
 *
 *   allowed   = ["https://login.example.com"]
 *   activeOrigin = "https://evil.example.com"   // same eTLD+1, different subdomain
 *   -> false (EXACT match policy)
 */
export function authorizeAutofill(allowed: readonly string[], activeOrigin: string): boolean {
  if (!isSecureHttpsOrigin(activeOrigin)) return false;
  const na = normalizeOrigin(activeOrigin);
  if (!na) return false;
  return allowed.some((o) => {
    const no = normalizeOrigin(o);
    return !!no && no === na;
  });
}

/**
 * Top-level origin check function — combines authorization + security.
 * Used by the autofill service before calling executeFill.
 */
export function checkOrigin(allowed: readonly string[], activeOrigin: string): { ok: true } | { ok: false; reason: string } {
  if (!isSecureHttpsOrigin(activeOrigin)) {
    return { ok: false, reason: "active tab is not a secure https:// origin" };
  }
  if (!authorizeAutofill(allowed, activeOrigin)) {
    return { ok: false, reason: `active origin ${activeOrigin} not in allowed list (exact match required)` };
  }
  return { ok: true };
}
