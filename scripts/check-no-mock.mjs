#!/usr/bin/env node
/**
 * check-no-mock.mjs — CI guard that rejects mock symbols in production
 * extension builds.
 *
 * Scans the production bundle directory (typically
 * `extension/.output/chrome-mv3/`) for any file that imports or references
 * mock-only symbols. If any are found, exits with status 1.
 *
 * Mock symbols we reject:
 *   - `import ... from "@keytap/lib/totp"`
 *   - `import ... from "@keytap/lib/mock-accounts"`
 *   - `import ... from "@keytap/lib/mock-mode"`
 *   - `import ... from "./mock-accounts"`
 *   - The string `RFC6238_TEST_SECRET_BASE32`
 *   - The string `MOCK_ACCOUNTS`
 *   - The string `createMockBackend` (in non-popup-context)
 *
 * The mock backend + TOTP lib + mock-accounts module are intentional for
 * dev (preview harness + KEYTAP_MOCK=1 extension dev builds). They must
 * NEVER ship in production builds.
 *
 * SECURITY INVARIANT (INV-6 in SECURITY.md).
 *
 * Usage:
 *   node scripts/check-no-mock.mjs <bundle-dir>
 *
 *   Default bundle dir: extension/.output/chrome-mv3
 *
 * Exit codes:
 *   0 — no mock symbols found, build is clean
 *   1 — mock symbols found, build is rejected
 *   2 — invalid usage (e.g. missing argument)
 */

import { readdir, stat, readFile } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

const BUNDLE_DIR = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(PROJECT_ROOT, "extension", ".output", "chrome-mv3");

// Patterns that indicate a mock symbol leaked into the production bundle.
// Each entry is a [name, regex-source] tuple.
const FORBIDDEN_PATTERNS = [
  // Imports of mock-only modules.
  ["mock-totp-import", /@keytap\/lib\/totp\b/],
  ["mock-accounts-import", /@keytap\/lib\/mock-accounts\b/],
  ["mock-mode-import", /@keytap\/lib\/mock-mode\b/],
  ["relative-mock-accounts-import", /(?:from\s*['"]\.{1,2}\/[^'"]*mock-accounts)/],
  ["relative-mock-mode-import", /(?:from\s*['"]\.{1,2}\/[^'"]*mock-mode)/],
  // Symbol references.
  ["rfc6238-test-secret", /RFC6238_TEST_SECRET_BASE32/],
  ["mock-accounts-symbol", /\bMOCK_ACCOUNTS\b/],
  ["create-mock-backend-symbol", /\bcreateMockBackend\b/],
  ["getMockAccounts-symbol", /\bgetMockAccounts\b/],
  // String literal: a known base32 test vector.
  ["rfc6238-secret-value", /GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/],
  // Env-var reads from the mock-mode modules.
  ["next-public-keytap-mock-env", /NEXT_PUBLIC_KEYTAP_MOCK/],
];

const SCAN_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".html", ".json", ".map", ".css"]);
const SKIP_NAMES = new Set(["node_modules", ".git", "vendor"]);

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_NAMES.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (SCAN_EXTENSIONS.has(extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  try {
    const s = await stat(BUNDLE_DIR);
    if (!s.isDirectory()) {
      console.error(`error: ${BUNDLE_DIR} is not a directory`);
      process.exit(2);
    }
  } catch {
    console.error(`error: bundle directory not found: ${BUNDLE_DIR}`);
    console.error(`       build the extension first: cd extension && bun run build`);
    process.exit(2);
  }

  console.info(`[check-no-mock] scanning: ${BUNDLE_DIR}`);
  const files = await walk(BUNDLE_DIR);
  console.info(`[check-no-mock] ${files.length} file(s) to scan`);

  const violations = [];
  for (const file of files) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // binary or unreadable — skip
    }
    for (const [name, pattern] of FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) {
        const rel = relative(BUNDLE_DIR, file);
        violations.push({ file: rel, pattern: name });
      }
    }
  }

  if (violations.length === 0) {
    console.info(`[check-no-mock] ✓ no mock symbols found — build is clean`);
    process.exit(0);
  }

  console.error(`[check-no-mock] ✗ ${violations.length} mock symbol(s) found in production bundle:`);
  for (const v of violations) {
    console.error(`  - ${v.file}  (${v.pattern})`);
  }
  console.error("");
  console.error("This is a security violation (INV-6 in SECURITY.md).");
  console.error("Rebuild with: cd extension && bun run build");
  console.error("(Do NOT set KEYTAP_MOCK=1 for production builds.)");
  process.exit(1);
}

function printHelp() {
  console.log(`Usage: node scripts/check-no-mock.mjs [bundle-dir]

Scans the production extension bundle for mock symbols and rejects the
build if any are found.

  bundle-dir   Path to the production extension output directory.
               Defaults to: extension/.output/chrome-mv3

Exits 0 if clean, 1 if violations found, 2 if usage error.
`);
}

void main();
