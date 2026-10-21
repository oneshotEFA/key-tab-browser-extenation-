/**
 * Synthetic test accounts for the mock backend.
 *
 * SECURITY: This file MUST NOT ship in production builds.
 * `scripts/check-no-mock.mjs` rejects any production bundle that imports it.
 *
 * The shared secret used here is the RFC 6238 test vector
 * ("12345678901234567890", base32 = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ).
 * It is published in the RFC and safe to expose — but it must NEVER be
 * used to generate real production 2FA codes. The mock backend exists
 * purely to make the popup UI demoable without the native host.
 */

import { assertMockAllowed } from "./mock-mode";

/** RFC 6238 test vector secret (base32). */
export const RFC6238_TEST_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

export interface MockAccount {
  id: string;
  issuer: string;
  label: string;
  origin: string;
  additionalOrigins: string[];
  /** Base32-encoded secret. Used by the mock backend only. */
  secretB32: string;
  period: number;
  digits: number;
}

/**
 * Four synthetic accounts covering the four origins used in the preview
 * harness's simulated tab switcher (github.com, login.example.com,
 * account.proton.me, dash.cloudflare.com). One of them (GitHub) also
 * authorizes gist.github.com to demonstrate additionalOrigins.
 */
export const MOCK_ACCOUNTS: readonly MockAccount[] = [
  {
    id: "mock-github",
    issuer: "GitHub",
    label: "octocat",
    origin: "https://github.com",
    additionalOrigins: ["https://gist.github.com"],
    secretB32: RFC6238_TEST_SECRET_BASE32,
    period: 30,
    digits: 6,
  },
  {
    id: "mock-example",
    issuer: "Example",
    label: "alice@example.com",
    origin: "https://login.example.com",
    additionalOrigins: [],
    secretB32: RFC6238_TEST_SECRET_BASE32,
    period: 30,
    digits: 6,
  },
  {
    id: "mock-proton",
    issuer: "Proton",
    label: "alice@proton.me",
    origin: "https://account.proton.me",
    additionalOrigins: [],
    secretB32: RFC6238_TEST_SECRET_BASE32,
    period: 30,
    digits: 6,
  },
  {
    id: "mock-cloudflare",
    issuer: "Cloudflare",
    label: "alice@cloudflare.com",
    origin: "https://dash.cloudflare.com",
    additionalOrigins: [],
    secretB32: RFC6238_TEST_SECRET_BASE32,
    period: 30,
    digits: 6,
  },
];

/**
 * Return the mock accounts. Asserts mock mode is enabled first.
 *
 * Returns a fresh array (shallow copy of each account) so callers cannot
 * mutate the exported `MOCK_ACCOUNTS` constant.
 */
export function getMockAccounts(): MockAccount[] {
  assertMockAllowed();
  return MOCK_ACCOUNTS.map((a) => ({ ...a }));
}
