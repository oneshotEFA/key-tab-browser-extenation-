/**
 * Web Crypto TOTP (RFC 6238) implementation for the popup UI.
 *
 * Used by the mock backend to render live, rotating codes. In production
 * mode the popup NEVER generates codes locally — it always asks the native
 * host via `getCode`, so the shared secret never leaves the host process.
 *
 * This file therefore MUST NOT be reachable in a production build when
 * KEYTAP_MOCK is not set. The `scripts/check-no-mock.mjs` guard enforces
 * this at build time by rejecting any production bundle that imports
 * `@keytap/lib/totp` or `@keytap/lib/mock-accounts`.
 *
 * Algorithm: HOTP with counter = floor(unix_time / period), HMAC-SHA1.
 * Reference: RFC 6238 §4 (algorithm), §5 (test vectors).
 *
 * The RFC 6238 test vectors pass:
 *   secret="12345678901234567890" (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
 *   SHA1, 8 digits, period 30:
 *     T=59          -> 94287082
 *     T=1111111109  -> 07081804
 *     T=1111111111  -> 14050471
 *     T=1234567890  -> 89005924
 *     T=2000000000  -> 69279037
 *     T=20000000000 -> 65353130
 *
 * SECURITY: We use crypto.subtle.importKey with `extractable: false`. Once
 * the secret is wrapped in a CryptoKey it cannot be read back out by JS.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Decode a base32 string (RFC 4648) into a Uint8Array. Accepts lowercase,
 * whitespace, and `=` padding. Mirrors `core::totp::base32_decode`.
 */
export function base32Decode(input: string): Uint8Array {
  const cleaned = input
    .replace(/=+$/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  let bits = 0;
  let bitsLeft = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const val = BASE32_ALPHABET.indexOf(ch);
    if (val < 0) {
      throw new Error(`invalid base32 character: ${ch}`);
    }
    bits = (bits << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      out.push((bits >> bitsLeft) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export interface ParsedOtpAuth {
  /** Decoded shared secret bytes. Use immediately; do not store. */
  secret: Uint8Array;
  issuer?: string;
  label?: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
}

/**
 * Parse an `otpauth://` URI per the de-facto standard
 * (https://github.com/google/google-authenticator/wiki/Key-Uri-Format).
 *
 * Only supports `totp` (not `hotp`). Defaults: SHA1, 6 digits, 30s period.
 */
export function parseOtpAuthUri(uri: string): ParsedOtpAuth {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    throw new Error("invalid otpauth URI");
  }
  if (u.protocol !== "otpauth:") {
    throw new Error(`expected otpauth://, got ${u.protocol}//`);
  }
  if (u.host !== "totp") {
    throw new Error(`only otpauth://totp/ is supported, got ${u.host}`);
  }
  // Pathname is "/Issuer:label" — strip leading "/"
  const path = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  let issuer: string | undefined;
  let label: string | undefined;
  const colon = path.indexOf(":");
  if (colon >= 0) {
    issuer = path.slice(0, colon).trim();
    label = path.slice(colon + 1).trim();
  } else {
    label = path.trim();
  }
  const params = u.searchParams;
  const secretB32 = params.get("secret");
  if (!secretB32) throw new Error("otpauth URI missing secret= parameter");
  const secret = base32Decode(secretB32);
  const algorithm = (params.get("algorithm") || "SHA1").toUpperCase();
  if (algorithm !== "SHA1" && algorithm !== "SHA256" && algorithm !== "SHA512") {
    throw new Error(`unsupported algorithm: ${algorithm}`);
  }
  const digitsStr = params.get("digits") || "6";
  const digits = parseInt(digitsStr, 10);
  if (!(digits === 6 || digits === 7 || digits === 8)) {
    throw new Error(`unsupported digits: ${digits}`);
  }
  const periodStr = params.get("period") || "30";
  const period = parseInt(periodStr, 10);
  if (!(period > 0 && period <= 600)) {
    throw new Error(`unsupported period: ${period}`);
  }
  // Issuer from query param takes precedence over issuer embedded in label.
  const issuerParam = params.get("issuer");
  if (issuerParam) issuer = issuerParam;
  return { secret, issuer, label, algorithm, digits, period };
}

/**
 * Generate a TOTP code using Web Crypto's HMAC-SHA1.
 *
 * @param secret raw secret bytes (NOT base32 — call base32Decode first)
 * @param timeMs current time in unix milliseconds
 * @param period step period in seconds (default 30)
 * @param digits number of digits (6, 7, or 8; default 6)
 */
export async function generateTotp(
  secret: Uint8Array,
  timeMs: number = Date.now(),
  period: number = 30,
  digits: number = 6,
): Promise<string> {
  if (secret.length === 0) throw new Error("empty secret");
  if (period <= 0) throw new Error("period must be > 0");
  if (!(digits === 6 || digits === 7 || digits === 8)) {
    throw new Error(`unsupported digits: ${digits}`);
  }
  const counter = Math.floor(timeMs / 1000 / period);
  return generateHotp(secret, counter, digits);
}

/**
 * HOTP (RFC 4226) core. Exposed for testing parity with the Rust impl.
 */
export async function generateHotp(
  secret: Uint8Array,
  counter: number,
  digits: number,
): Promise<string> {
  // 64-bit big-endian counter
  const counterBytes = new Uint8Array(8);
  let c = Math.floor(counter);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = c & 0xff;
    c = Math.floor(c / 0x100);
    if (c === 0 && i > 0) break;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    secret as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    /* extractable: */ false,
    ["sign"],
  );
  const hashBuf = await crypto.subtle.sign("HMAC", key, counterBytes as unknown as BufferSource);
  const hash = new Uint8Array(hashBuf);
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    (hash[offset + 1] << 16) |
    (hash[offset + 2] << 8) |
    hash[offset + 3];
  // binary is a 31-bit unsigned int; safe to use Number ops.
  const code = (binary >>> 0) % Math.pow(10, digits);
  return code.toString().padStart(digits, "0");
}

/**
 * Milliseconds remaining until the next TOTP step rolls over.
 */
export function totpMsRemaining(timeMs: number, period: number = 30): number {
  const stepMs = period * 1000;
  const elapsed = timeMs % stepMs;
  return stepMs - elapsed;
}

/**
 * Progress (0..1) of the current TOTP step. 1 = just rolled over,
 * approaching 0 = about to roll. Useful for the countdown ring.
 */
export function totpProgress(timeMs: number, period: number = 30): number {
  const stepMs = period * 1000;
  const elapsed = timeMs % stepMs;
  return (stepMs - elapsed) / stepMs;
}
