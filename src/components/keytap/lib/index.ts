/**
 * Barrel export for the @keytap/lib path alias.
 *
 * Re-exports everything that the popup UI (and the preview harness)
 * legitimately needs. The mock-accounts module is intentionally NOT
 * re-exported here — it should only be imported from the mock backend
 * or from the preview harness, never from production popup components.
 */

export * from "./utils";
export * from "./totp";
export * from "./migration";
