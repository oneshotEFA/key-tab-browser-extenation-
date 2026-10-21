/**
 * @keytap/protocol — TypeScript protocol types matching the Rust structs in
 * core/src/protocol.rs. Used by both the Next.js preview harness and the
 * browser extension to talk to the native host (and the in-page mock backend).
 *
 * SECURITY INVARIANTS enforced by this module:
 *
 * 1. PROTOCOL_VERSION is fixed at 1. Any envelope with a different version
 *    is rejected by `parseResponse`. The native host does the same on the
 *    request side (see core/src/protocol.rs `parse_request`).
 *
 * 2. `serializeRequest` ALWAYS embeds PROTOCOL_VERSION. Never send an
 *    envelope without it — the host will reject it as malformed.
 *
 * 3. `parseResponse` rejects host responses containing "secret". An explicit
 *    user-initiated addAccount request carries an otpauth URI to the local
 *    native host, which encrypts it before persistence; responses never echo it.
 *
 * 4. `requestId` MUST be non-empty. Empty / whitespace-only IDs are rejected.
 *
 * 5. NativeHostResponse is a tagged union (tag = "type", content = "payload")
 *    matching the Rust enum's serde tag/content layout. Adding a variant
 *    here requires a matching Rust change and vice-versa.
 *
 * 6. Field names are camelCase to match `#[serde(rename_all = "camelCase")]`
 *    on the Rust side.
 *
 * NEVER add a raw shared-secret field or return a setup URI in a response.
 * The sole inbound import URI is handled only by the local native host.
 */

/** Wire protocol version. Bumped on breaking changes. Mirrors Rust `PROTOCOL_VERSION`. */
export const PROTOCOL_VERSION = 1;

/** Native Messaging host name registered with Chrome (see native-host/scripts/). */
export const NATIVE_HOST_NAME = "com.keytap.nativehost";

/** Maximum length of a single native-messaging message (1 MiB). Chrome's hard
 *  limit is 1 MiB per host message; we reject anything larger. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface PingPayload {
  client: string;
  clientVersion: string;
}

export interface PongPayload {
  hostVersion: string;
  capabilities: string[];
}

export interface GetCodePayload {
  accountId: string;
  origin: string;
  /** Optional Chrome tab id, for audit logging on the host side. */
  tabId?: number;
}

/** User-initiated import. The native host parses the URI and stores its key
 * only inside the encrypted vault. The URI and passphrase are never returned. */
export interface AddAccountPayload {
  otpauthUri: string;
  origin: string;
  passphrase: string;
}

export interface DeleteAccountPayload {
  accountId: string;
}

export interface UpdateAccountOriginPayload {
  accountId: string;
  origin: string;
}

export interface UnlockVaultPayload {
  passphrase: string;
}

/** Empty payload for ListAccounts / Lock / GetStatus. Rust uses EmptyPayload {}. */
export type EmptyPayload = Record<string, never>;

export interface AccountSummary {
  id: string;
  issuer: string;
  label: string;
  origin: string;
  /** Additional origins the account is authorized for (exact match only). */
  additionalOrigins?: string[];
  /** If true, the host requires a fresh OS re-auth before returning a code. */
  requiresReauth?: boolean;
}

export interface ListAccountsPayload {
  accounts: AccountSummary[];
  vaultLocked: boolean;
}

export interface GetCodeResponse {
  accountId: string;
  /** 6–8 digit TOTP code. NEVER contains the shared secret. */
  code: string;
  /** Unix ms when the code was generated. */
  issuedAt: number;
  /** Unix ms when the code expires (issuedAt + period * 1000). */
  expiresAt: number;
}

export interface StatusPayload {
  vaultLocked: boolean;
  vaultExists: boolean;
  /** Unix ms when the vault will auto-lock, or null if no timer is armed. */
  autoLockAt: number | null;
  /** Unix ms when the unlock session expires (hard cap = 30 min), or null. */
  sessionExpiresAt: number | null;
  hostVersion: string;
}

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

/** Mirrors `core::protocol::ErrorCode`. Wire format is the SCREAMING_SNAKE_CASE
 *  Rust identifier (serde default for unit variants). */
export type ErrorCode =
  | "VaultLocked"
  | "AuthRequired"
  | "AuthCancelled"
  | "OriginMismatch"
  | "AccountNotFound"
  | "HostUnavailable"
  | "InvalidRequest"
  | "ProtocolVersionMismatch"
  | "InternalError";

export const ERROR_CODES: readonly ErrorCode[] = [
  "VaultLocked",
  "AuthRequired",
  "AuthCancelled",
  "OriginMismatch",
  "AccountNotFound",
  "HostUnavailable",
  "InvalidRequest",
  "ProtocolVersionMismatch",
  "InternalError",
] as const;

// ---------------------------------------------------------------------------
// Tagged unions
// ---------------------------------------------------------------------------

/**
 * Extension -> Native host request. Tagged union matching the Rust enum:
 *   #[serde(tag = "type", content = "payload", rename_all = "camelCase")]
 *
 * Discriminant values are camelCase: "ping", "listAccounts", "getCode",
 * "lock", "getStatus".
 */
export type ExtensionRequest =
  | { type: "ping"; payload: PingPayload }
  | { type: "listAccounts"; payload: EmptyPayload }
  | { type: "getCode"; payload: GetCodePayload }
  | { type: "addAccount"; payload: AddAccountPayload }
  | { type: "deleteAccount"; payload: DeleteAccountPayload }
  | { type: "updateAccountOrigin"; payload: UpdateAccountOriginPayload }
  | { type: "unlockVault"; payload: UnlockVaultPayload }
  | { type: "lock"; payload: EmptyPayload }
  | { type: "getStatus"; payload: EmptyPayload };

/**
 * Native host -> Extension response. Tagged union matching the Rust enum.
 * Discriminant values: "pong", "accounts", "code", "status", "error".
 */
export type NativeHostResponse =
  | { type: "pong"; payload: PongPayload }
  | { type: "accounts"; payload: ListAccountsPayload }
  | { type: "code"; payload: GetCodeResponse }
  | { type: "status"; payload: StatusPayload }
  | { type: "error"; payload: ErrorPayload };

// ---------------------------------------------------------------------------
// Wire envelope
// ---------------------------------------------------------------------------

/**
 * On-wire envelope. Identical layout to the Rust `Envelope`/`Out` structs
 * in core/src/protocol.rs:
 *
 *   { "v": 1, "id": "<request-id>", "type": "<tag>", "payload": { ... } }
 *
 * The version + id are flattened into the request/response via the `v`/`id`
 * top-level fields; `type`/`payload` come from the tagged union.
 */
export interface Envelope {
  v: number;
  id: string;
  type: string;
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ProtocolErrorKind =
  | "invalidJson"
  | "versionMismatch"
  | "missingField"
  | "unknownType"
  | "malformedId"
  | "messageTooLarge"
  | "secretLeak"
  | "io";

export class ProtocolError extends Error {
  readonly kind: ProtocolErrorKind;
  constructor(kind: ProtocolErrorKind, message: string) {
    super(`[${kind}] ${message}`);
    this.name = "ProtocolError";
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Serialization / parsing
// ---------------------------------------------------------------------------

/**
 * Serialize an ExtensionRequest into a UTF-8 JSON envelope for transmission.
 * The caller is responsible for length-prefixing if sending to the native host
 * over stdio (see native-messaging.ts).
 */
export function serializeRequest(
  requestId: string,
  request: ExtensionRequest,
): string {
  if (!requestId || requestId.trim().length === 0) {
    throw new ProtocolError("malformedId", "requestId must be non-empty");
  }
  const env: Envelope = {
    v: PROTOCOL_VERSION,
    id: requestId,
    type: request.type,
    payload: request.payload,
  };
  return JSON.stringify(env);
}

/**
 * Parse a NativeHostResponse envelope. Enforces the security invariants
 * documented at the top of this file.
 *
 * @param raw UTF-8 bytes or string from the native host.
 * @returns tuple of [requestId, response]
 */
export function parseResponse(raw: string | Uint8Array): [string, NativeHostResponse] {
  const text =
    typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);

  // SECURITY: reject any response containing the substring "secret". This is
  // defense-in-depth: the Rust host is structured to never emit it, but a
  // compromised host must not be able to silently exfiltrate a shared secret
  // via a "code" response. False positives are acceptable here — the wire
  // protocol never legitimately contains the word "secret" in any field.
  if (text.toLowerCase().includes("secret")) {
    throw new ProtocolError(
      "secretLeak",
      "response payload contained the substring 'secret' — rejecting as a precaution",
    );
  }

  let env: Envelope;
  try {
    env = JSON.parse(text) as Envelope;
  } catch (e) {
    throw new ProtocolError("invalidJson", e instanceof Error ? e.message : String(e));
  }

  if (typeof env.v !== "number") {
    throw new ProtocolError("missingField", "envelope missing `v`");
  }
  if (env.v !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      "versionMismatch",
      `expected v=${PROTOCOL_VERSION}, got v=${env.v}`,
    );
  }
  if (typeof env.id !== "string" || env.id.trim().length === 0) {
    throw new ProtocolError("malformedId", "envelope id missing or empty");
  }
  if (typeof env.type !== "string") {
    throw new ProtocolError("missingField", "envelope missing `type`");
  }
  if (env.payload === undefined || env.payload === null) {
    throw new ProtocolError("missingField", "envelope missing `payload`");
  }

  const response = parseTypedResponse(env.type, env.payload);
  return [env.id, response];
}

function parseTypedResponse(type: string, payload: unknown): NativeHostResponse {
  switch (type) {
    case "pong":
      return { type: "pong", payload: payload as PongPayload };
    case "accounts":
      return { type: "accounts", payload: payload as ListAccountsPayload };
    case "code":
      return { type: "code", payload: payload as GetCodeResponse };
    case "status":
      return { type: "status", payload: payload as StatusPayload };
    case "error":
      return { type: "error", payload: payload as ErrorPayload };
    default:
      throw new ProtocolError("unknownType", `unknown response type: ${type}`);
  }
}

/** Type guard: is the response an Error? */
export function isErrorResponse(
  r: NativeHostResponse,
): r is { type: "error"; payload: ErrorPayload } {
  return r.type === "error";
}

/** Type guard: is the response a code? */
export function isCodeResponse(
  r: NativeHostResponse,
): r is { type: "code"; payload: GetCodeResponse } {
  return r.type === "code";
}

/** Generate a fresh request id (URL-safe, 22 chars). */
export function newRequestId(): string {
  // crypto.randomUUID is available in browsers, service workers, and
  // Node 19+. Fall back to Math.random if unavailable (mock-only path).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Array.from({ length: 22 }, () =>
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[
      Math.floor(Math.random() * 62)
    ],
  ).join("");
}
