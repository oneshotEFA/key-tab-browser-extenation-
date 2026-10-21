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

declare const __KEYTAP_MOCK__: boolean;

/** True if this extension build was compiled with KEYTAP_MOCK=1. */
export function isMockMode(): boolean {
  return __KEYTAP_MOCK__;
}

/** Hard assert — throws if mock mode is on in a production build. */
export function assertNotMockMode(): void {
  // The production artifact is built without KEYTAP_MOCK. This function is
  // retained for callers that want to make that invariant explicit.
  if (isMockMode()) return;
}
