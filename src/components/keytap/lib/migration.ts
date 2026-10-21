/**
 * Google Authenticator Migration (otpauth-migration://) parser.
 *
 * Decodes the base64-encoded Protobuf payload exported from Google Authenticator
 * and extracts all TOTP/HOTP accounts without any external heavy dependencies.
 */

export interface MigratedAccount {
  issuer: string;
  label: string;
  secretB32: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  suggestedOrigin: string;
  otpauthUri: string;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let bitsLeft = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    bits = (bits << 8) | bytes[i];
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      out += BASE32_ALPHABET[(bits >> bitsLeft) & 0x1f];
    }
  }
  if (bitsLeft > 0) {
    out += BASE32_ALPHABET[(bits << (5 - bitsLeft)) & 0x1f];
  }
  return out;
}

/**
 * Infer a secure HTTPS origin for an account based on its issuer name or label.
 */
export function inferOriginForIssuer(issuer: string, label = ""): string {
  const norm = (issuer || label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  
  if (norm.includes("github")) return "https://github.com";
  if (norm.includes("google") || norm.includes("gmail")) return "https://google.com";
  if (norm.includes("aws") || norm.includes("amazon")) return "https://aws.amazon.com";
  if (norm.includes("microsoft") || norm.includes("live") || norm.includes("office")) return "https://login.microsoftonline.com";
  if (norm.includes("discord")) return "https://discord.com";
  if (norm.includes("twitter") || norm.includes("x")) return "https://x.com";
  if (norm.includes("reddit")) return "https://reddit.com";
  if (norm.includes("binance")) return "https://binance.com";
  if (norm.includes("coinbase")) return "https://coinbase.com";
  if (norm.includes("gitlab")) return "https://gitlab.com";
  if (norm.includes("bitbucket") || norm.includes("atlassian")) return "https://bitbucket.org";
  if (norm.includes("facebook") || norm.includes("meta")) return "https://facebook.com";
  if (norm.includes("instagram")) return "https://instagram.com";
  if (norm.includes("dropbox")) return "https://dropbox.com";
  if (norm.includes("slack")) return "https://slack.com";
  if (norm.includes("apple") || norm.includes("icloud")) return "https://appleid.apple.com";
  if (norm.includes("cloudflare")) return "https://dash.cloudflare.com";
  if (norm.includes("digitalocean")) return "https://cloud.digitalocean.com";
  if (norm.includes("heroku")) return "https://dashboard.heroku.com";
  if (norm.includes("paypal")) return "https://paypal.com";
  if (norm.includes("stripe")) return "https://dashboard.stripe.com";
  if (norm.includes("twitch")) return "https://twitch.tv";
  if (norm.includes("bitwarden")) return "https://vault.bitwarden.com";
  if (norm.includes("1password")) return "https://1password.com";
  if (norm.includes("steam")) return "https://store.steampowered.com";
  if (norm.includes("proton")) return "https://account.proton.me";
  if (norm.includes("epic")) return "https://epicgames.com";
  if (norm.includes("npm")) return "https://npmjs.com";
  if (norm.includes("docker")) return "https://hub.docker.com";
  if (norm.includes("linkedin")) return "https://linkedin.com";
  if (norm.includes("notion")) return "https://notion.so";
  if (norm.includes("openai") || norm.includes("chatgpt")) return "https://openai.com";
  if (norm.includes("vercel")) return "https://vercel.com";
  if (norm.includes("zoom")) return "https://zoom.us";
  if (norm.includes("salesforce")) return "https://login.salesforce.com";
  if (norm.includes("okta")) return "https://okta.com";
  
  // Return empty string if not a recognized service so the user must provide it
  return "";
}

/**
 * Normalize any website URL, domain, or hostname into a valid HTTPS origin (e.g. "https://github.com").
 * Returns null if the domain is invalid or empty.
 */
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  // If no scheme was provided, default to https://
  if (!candidate.startsWith("http://") && !candidate.startsWith("https://")) {
    candidate = `https://${candidate}`;
  }

  try {
    const u = new URL(candidate);
    const host = u.host.toLowerCase();
    // Host must exist and have at least one dot or be localhost
    if (!host || (!host.includes(".") && host !== "localhost")) {
      return null;
    }
    // Must not have trailing/leading dots
    if (host.startsWith(".") || host.endsWith(".")) {
      return null;
    }
    // Return strict https origin without path, query or fragment
    return `https://${host}`;
  } catch {
    return null;
  }
}

/**
 * Parse an otpauth-migration://offline?data=... URI.
 */
export function parseMigrationUri(uri: string): MigratedAccount[] {
  const trimmed = uri.trim();
  let dataParam = "";

  if (trimmed.toLowerCase().startsWith("otpauth-migration://")) {
    try {
      const u = new URL(trimmed);
      dataParam = u.searchParams.get("data") ?? "";
    } catch {
      const match = trimmed.match(/[?&]data=([^&]+)/);
      if (match) dataParam = match[1];
    }
  } else if (trimmed.includes("data=")) {
    const match = trimmed.match(/[?&]?data=([^&]+)/);
    if (match) dataParam = match[1];
  } else if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 10) {
    // Direct base64 string
    dataParam = trimmed;
  } else {
    throw new Error("Invalid migration URI: expected otpauth-migration:// protocol or base64 export data.");
  }

  if (!dataParam) {
    throw new Error("Migration data is missing or empty.");
  }

  let binary: Uint8Array;
  try {
    const decodedB64 = decodeURIComponent(dataParam);
    const rawStr = atob(decodedB64);
    binary = new Uint8Array(rawStr.length);
    for (let i = 0; i < rawStr.length; i++) {
      binary[i] = rawStr.charCodeAt(i);
    }
  } catch (err) {
    throw new Error(`Failed to decode base64 migration payload: ${String(err)}`);
  }

  return decodeMigrationProtobuf(binary);
}

function decodeMigrationProtobuf(data: Uint8Array): MigratedAccount[] {
  let offset = 0;
  const accounts: MigratedAccount[] = [];

  function readVarint(): number {
    let result = 0;
    let shift = 0;
    while (offset < data.length) {
      const b = data[offset++];
      result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    return result;
  }

  while (offset < data.length) {
    const tag = readVarint();
    const fieldNum = tag >> 3;
    const wireType = tag & 0x7;

    if (wireType === 2) {
      // Length-delimited
      const len = readVarint();
      const end = offset + len;
      if (fieldNum === 1) {
        // OtpParameters message
        const subData = data.subarray(offset, end);
        const acc = parseOtpParameters(subData);
        if (acc) accounts.push(acc);
      }
      offset = end;
    } else if (wireType === 0) {
      readVarint();
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }

  if (accounts.length === 0) {
    throw new Error("No valid accounts found in the authenticator migration data.");
  }

  return accounts;
}

function parseOtpParameters(data: Uint8Array): MigratedAccount | null {
  let offset = 0;
  let secretBytes: Uint8Array | null = null;
  let name = "";
  let issuer = "";
  let algorithm: "SHA1" | "SHA256" | "SHA512" = "SHA1";
  let digits = 6;
  let type = 2; // 2 = TOTP

  function readVarint(): number {
    let result = 0;
    let shift = 0;
    while (offset < data.length) {
      const b = data[offset++];
      result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    return result;
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });

  while (offset < data.length) {
    const tag = readVarint();
    const fieldNum = tag >> 3;
    const wireType = tag & 0x7;

    if (wireType === 2) {
      const len = readVarint();
      const end = offset + len;
      const sub = data.subarray(offset, end);
      offset = end;

      if (fieldNum === 1) {
        secretBytes = sub;
      } else if (fieldNum === 2) {
        name = decoder.decode(sub);
      } else if (fieldNum === 3) {
        issuer = decoder.decode(sub);
      }
    } else if (wireType === 0) {
      const val = readVarint();
      if (fieldNum === 4) {
        // Algorithm: 1 = SHA1, 2 = SHA256, 3 = SHA512
        if (val === 2) algorithm = "SHA256";
        else if (val === 3) algorithm = "SHA512";
        else algorithm = "SHA1";
      } else if (fieldNum === 5) {
        // Digits: 1 = 6 digits, 2 = 8 digits
        digits = val === 2 ? 8 : 6;
      } else if (fieldNum === 6) {
        type = val;
      }
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }

  if (!secretBytes || secretBytes.length === 0) return null;

  // Split label into issuer and account name if formatted like "Issuer:username"
  let cleanLabel = name;
  if (!issuer && name.includes(":")) {
    const colonIdx = name.indexOf(":");
    issuer = name.slice(0, colonIdx).trim();
    cleanLabel = name.slice(colonIdx + 1).trim();
  }

  const effectiveIssuer = issuer.trim() || cleanLabel.trim() || "Authenticator";
  const secretB32 = bytesToBase32(secretBytes);
  const suggestedOrigin = inferOriginForIssuer(effectiveIssuer, cleanLabel);
  const period = 30;

  const otpauthUri = `otpauth://totp/${encodeURIComponent(effectiveIssuer)}:${encodeURIComponent(cleanLabel)}?secret=${secretB32}&issuer=${encodeURIComponent(effectiveIssuer)}&algorithm=${algorithm}&digits=${digits}&period=${period}`;

  return {
    issuer: effectiveIssuer,
    label: cleanLabel,
    secretB32,
    algorithm,
    digits,
    period,
    suggestedOrigin,
    otpauthUri,
  };
}
