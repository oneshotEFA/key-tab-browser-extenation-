/**
 * Extension-side mock-mode flag.
 *
 * Mirrors `@keytap/lib/mock-mode.ts` but uses the extension-specific env
 * var. WXT injects `import.meta.env.KEYTAP_MOCK` at build time.
 *
 * SECURITY: in production builds (no KEYTAP_MOCK env), this MUST be false.
 * scripts/check-no-mock.mjs enforces this by scanning the production
 * bundle for any symbol that conditionally imports the mock backend.
 */

/** True if this extension build was compiled with KEYTAP_MOCK=1. */
export function isMockMode(): boolean {
  return (
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string | undefined> }).env?.KEYTAP_MOCK === "1"
  );
}

/** Hard assert — throws if mock mode is on in a production build. */
export function assertNotMockMode(): void {
  const mode = (import.meta as { env?: Record<string, string | undefined> }).env?.MODE;
  if (mode === "production" && isMockMode()) {
    throw new Error(
      "mock-mode: KEYTAP_MOCK=1 in a production build — this is a security violation",
    );
  }
}
