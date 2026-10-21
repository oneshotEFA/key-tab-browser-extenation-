/**
 * Mock-mode flag for the popup UI.
 *
 * Two sources of truth, either enables mock mode:
 *
 *   1. process.env.NEXT_PUBLIC_KEYTAP_MOCK === "1"
 *      — Next.js dev preview harness. Always set in .env.local for dev.
 *
 *   2. import.meta.env.KEYTAP_MOCK === "1"
 *      — WXT/Vite extension build with `KEYTAP_MOCK=1 bun run dev`.
 *
 * In production:
 *   - .env.local must NOT set NEXT_PUBLIC_KEYTAP_MOCK
 *   - The extension MUST be built with `bun run build` (no KEYTAP_MOCK env)
 *   - scripts/check-no-mock.mjs fails the build if mock symbols leak through.
 *
 * SECURITY INVARIANT: the mock backend contains a hard-coded RFC 6238 test
 * vector secret. It is NEVER safe to ship in production. The CI guard
 * ensures mock files are tree-shaken out of production bundles.
 */

/** True if mock mode is enabled. */
export const MOCK_MODE: boolean =
  (typeof process !== "undefined" &&
    process.env &&
    process.env.NEXT_PUBLIC_KEYTAP_MOCK === "1") ||
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string | undefined> }).env?.KEYTAP_MOCK === "1");

/**
 * Hard assertion that mock mode is currently enabled. Throws if not.
 *
 * Use this at the top of any function that returns mock data or talks to
 * the mock backend — defense in depth in case a mock symbol accidentally
 * makes it into a production bundle.
 */
export function assertMockAllowed(): void {
  if (!MOCK_MODE) {
    throw new Error(
      "mock-mode: assertMockAllowed() failed — mock code reached in a non-mock build. " +
        "This is a security violation; the production bundle must not include mock data.",
    );
  }
}
