import {
  base32Decode,
  generateTotp,
  parseOtpAuthUri,
  totpMsRemaining,
} from "@keytap/lib";
import { MOCK_MODE } from "@keytap/lib/mock-mode";
import { getMockAccounts, type MockAccount } from "@keytap/lib/mock-accounts";
import { DEFAULT_SETTINGS, type PopupSettings } from "./types";
import type { PopupBackend } from "./PopupApp";

/** Development-only backend. Never import this module from production UI. */
export function createMockBackend(opts?: { hostVersion?: string }): PopupBackend {
  let mockAccounts: MockAccount[] = getMockAccounts();
  let vaultLocked = false;
  const settingsRef: { current: PopupSettings } = { current: { ...DEFAULT_SETTINGS } };

  return {
    isMock: true,
    hostVersionLabel: opts?.hostVersion ?? "0.1.0-mock",

    async listAccounts() {
      assertMock();
      return {
        accounts: mockAccounts.map((m) => ({
          id: m.id,
          issuer: m.issuer,
          label: m.label,
          origin: m.origin,
          additionalOrigins: m.additionalOrigins,
        })),
        vaultLocked,
      };
    },

    async getCode(accountId: string, origin: string) {
      assertMock();
      const account = mockAccounts.find((a) => a.id === accountId);
      if (!account) throw new Error(`account not found: ${accountId}`);
      const allowed = [account.origin, ...account.additionalOrigins];
      if (origin && !allowed.includes(origin)) {
        // Reveal is allowed in demo mode; the UI still blocks unauthorized fill.
      }
      const secret = base32Decode(account.secretB32);
      const nowMs = Date.now();
      const code = await generateTotp(secret, nowMs, account.period, account.digits);
      return {
        accountId: account.id,
        code,
        issuedAt: nowMs,
        expiresAt: nowMs + totpMsRemaining(nowMs, account.period),
      };
    },

    async lock() {
      assertMock();
      vaultLocked = false;
    },

    async getStatus() {
      assertMock();
      const nowMs = Date.now();
      return {
        vaultLocked: false,
        vaultExists: false,
        autoLockAt: nowMs + 5 * 60 * 1000,
        sessionExpiresAt: nowMs + 30 * 60 * 1000,
        hostVersion: opts?.hostVersion ?? "0.1.0-mock",
      };
    },

    async getSettings() {
      assertMock();
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem("keytap:settings");
        if (raw) {
          try {
            return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
          } catch {
            // Ignore malformed demo settings.
          }
        }
      }
      return { ...settingsRef.current };
    },

    async saveSettings(next: PopupSettings) {
      assertMock();
      settingsRef.current = next;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("keytap:settings", JSON.stringify(next));
      }
    },

    async addMockAccount(uri: string) {
      assertMock();
      try {
        const parsed = parseOtpAuthUri(uri);
        const id = `mock-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        mockAccounts = [
          ...mockAccounts,
          {
            id,
            issuer: parsed.issuer ?? "Unknown",
            label: parsed.label ?? "",
            origin: "https://unknown.local",
            additionalOrigins: [],
            secretB32: base32EncodeSecret(parsed.secret),
            period: parsed.period,
            digits: parsed.digits,
          },
        ];
        return { ok: true } as const;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) } as const;
      }
    },

    async deleteAccount(accountId: string) {
      assertMock();
      mockAccounts = mockAccounts.filter((m) => m.id !== accountId);
    },

    async updateAccountOrigin(accountId: string, origin: string) {
      assertMock();
      const acc = mockAccounts.find((m) => m.id === accountId);
      if (!acc) throw new Error("Account not found");
      acc.origin = origin;
    },
  };
}

function assertMock() {
  if (!MOCK_MODE) {
    throw new Error("createMockBackend() called in a non-mock build — this is a bug");
  }
}

function base32EncodeSecret(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let bitsLeft = 0;
  let out = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      out += alphabet[(bits >> bitsLeft) & 0x1f];
    }
  }
  if (bitsLeft > 0) out += alphabet[(bits << (5 - bitsLeft)) & 0x1f];
  return out;
}
