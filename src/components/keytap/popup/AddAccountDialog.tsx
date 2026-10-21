/**
 * AddAccountDialog — Add a single 2FA account to the vault.
 *
 * Supports:
 *   - Authenticator setup links (`otpauth://totp/...`)
 *   - Raw base32 setup keys (e.g. `JBSWY3DPEHPK3PXP`)
 *   - Single-service QR code image scanning
 */

import { useRef, useState, useEffect } from "react";
import { ImagePlus, Plus, Globe2, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { parseOtpAuthUri, inferOriginForIssuer } from "@keytap/lib";

export function AddAccountDialog({
  open,
  onOpenChange,
  mockMode,
  onAddMock,
  origin,
  vaultExists,
  vaultLocked,
  onImport,
  onUnlock,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  mockMode: boolean;
  onAddMock: (uri: string) => { ok: true } | { ok: false; error: string };
  origin: string | null;
  vaultExists: boolean;
  vaultLocked: boolean;
  onImport: (uri: string, passphrase: string, targetOrigin?: string) => Promise<void>;
  onUnlock: (passphrase: string) => Promise<void>;
}) {
  const [uri, setUri] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [customOrigin, setCustomOrigin] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Derive default service name from origin
  useEffect(() => {
    if (open) {
      setError(null);
      if (origin) {
        try {
          const u = new URL(origin);
          const parts = u.hostname.replace(/^www\./, "").split(".");
          const inferred = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : "";
          setServiceName((prev) => prev || inferred);
          setCustomOrigin(origin);
        } catch {
          setCustomOrigin(origin);
        }
      }
    } else {
      setUri("");
      setPassphrase("");
      setConfirmation("");
      setError(null);
    }
  }, [open, origin]);

  // Detect whether the input is a raw secret key instead of a full otpauth:// URL
  const trimmedInput = uri.trim();
  const isMigrationUri = trimmedInput.toLowerCase().startsWith("otpauth-migration://");
  const isOtpAuthUri = trimmedInput.toLowerCase().startsWith("otpauth://");
  const cleanKey = trimmedInput.replace(/\s+/g, "").toUpperCase();
  const isRawSecretKey = !isOtpAuthUri && !isMigrationUri && /^[A-Z2-7]{8,}$/.test(cleanKey);

  function buildEffectiveOtpAuthUri(): string {
    if (isMigrationUri) {
      throw new Error("This is an authenticator export link. Please use the Import button in the top bar instead.");
    }

    if (isRawSecretKey) {
      const issuer = serviceName.trim() || "Authenticator";
      const label = accountName.trim() || "account";
      return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${cleanKey}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    }

    // Standard otpauth:// URI
    parseOtpAuthUri(trimmedInput);
    return trimmedInput;
  }

  function getEffectiveOrigin(): string {
    if (origin && origin.startsWith("https://")) return origin;
    if (customOrigin.trim().startsWith("https://")) return customOrigin.trim();
    if (serviceName.trim()) {
      return inferOriginForIssuer(serviceName.trim(), accountName.trim());
    }
    return "https://authenticator.local";
  }

  async function submit() {
    setError(null);
    try {
      const finalUri = buildEffectiveOtpAuthUri();
      const targetOrigin = getEffectiveOrigin();

      const needsPassphrase = !mockMode && (!vaultExists || vaultLocked);
      if (needsPassphrase && passphrase.length < 8) {
        throw new Error("Choose a vault passphrase with at least 8 characters.");
      }
      if (!mockMode && !vaultExists && passphrase !== confirmation) {
        throw new Error("The passphrases do not match.");
      }

      setBusy(true);
      if (mockMode) {
        const result = onAddMock(finalUri);
        if (!result.ok) throw new Error(result.error);
      } else {
        await onImport(finalUri, passphrase, targetOrigin);
      }
      onOpenChange(false);
      setUri("");
      setPassphrase("");
      setConfirmation("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    setError(null);
    setBusy(true);
    try {
      await onUnlock(passphrase);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function scanImage(file?: File) {
    if (!file) return;
    setError(null);
    try {
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (options: { formats: string[] }) => {
            detect(source: ImageBitmap): Promise<Array<{ rawValue: string }>>;
          };
        }
      ).BarcodeDetector;
      if (!Detector) {
        throw new Error("QR image scanning is unavailable in this browser. Paste the setup link or secret key instead.");
      }
      const bitmap = await createImageBitmap(file);
      try {
        const results = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
        const value = results[0]?.rawValue;
        if (!value) {
          throw new Error("No QR code was detected in that image.");
        }
        if (value.toLowerCase().startsWith("otpauth-migration://")) {
          throw new Error("This is an authenticator export QR code. Please use the Import button in the top bar to import it.");
        }
        if (!value.toLowerCase().startsWith("otpauth://")) {
          throw new Error("No valid 2FA setup QR code was found in that image.");
        }
        parseOtpAuthUri(value);
        setUri(value);
      } finally {
        bitmap.close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[360px] p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" />
            Add 2FA account
          </DialogTitle>
          <DialogDescription className="text-xs">
            {mockMode
              ? "Paste a setup link, secret key, or scan a QR image. Demo accounts are temporary."
              : "Paste an authenticator link, secret key, or scan a QR image. The native host encrypts it locally."}
          </DialogDescription>
        </DialogHeader>

        {!mockMode && vaultExists && vaultLocked && (
          <Alert>
            <AlertTitle>Unlock your vault</AlertTitle>
            <AlertDescription className="text-[11px]">
              Enter your existing vault passphrase to unlock it and add this account.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="otpauth-uri" className="text-xs">
              Authenticator setup link or secret key
            </Label>
            <Input
              id="otpauth-uri"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="otpauth://totp/... or JBSWY3DPEHPK3PXP"
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-xs"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void scanImage(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="size-3.5" />
              Scan QR from image
            </Button>
          </div>

          {/* If the user entered a raw secret key, show service & account inputs */}
          {isRawSecretKey && (
            <div className="space-y-2 rounded-md border p-2.5 bg-muted/30">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <KeyRound className="size-3.5 text-primary" />
                <span>Account details</span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="service-name" className="text-[11px]">
                  Service / Website
                </Label>
                <Input
                  id="service-name"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  placeholder="e.g. GitHub, Google, Amazon"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="account-name" className="text-[11px]">
                  Username or email
                </Label>
                <Input
                  id="account-name"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="e.g. user@example.com"
                  className="h-8 text-xs"
                />
              </div>
            </div>
          )}

          {/* Website origin info or manual domain */}
          {!mockMode && !origin && (
            <div className="space-y-1.5">
              <Label htmlFor="custom-origin" className="text-xs flex items-center gap-1">
                <Globe2 className="size-3" />
                Website domain
              </Label>
              <Input
                id="custom-origin"
                value={customOrigin}
                onChange={(e) => setCustomOrigin(e.target.value)}
                placeholder="https://github.com"
                className="font-mono text-xs h-8"
              />
            </div>
          )}

          {!mockMode && (!vaultExists || vaultLocked) && (
            <div className="space-y-2">
              <Label htmlFor="vault-passphrase" className="text-xs">
                {vaultExists ? "Vault passphrase" : "Create vault passphrase"}
              </Label>
              <Input
                id="vault-passphrase"
                type="password"
                autoComplete={vaultExists ? "current-password" : "new-password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="At least 8 characters"
                className="h-8 text-xs"
              />
              {!vaultExists && (
                <Input
                  aria-label="Confirm vault passphrase"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="Confirm passphrase"
                  className="h-8 text-xs"
                />
              )}
              {vaultExists && vaultLocked && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-8"
                  onClick={() => void unlock()}
                  disabled={busy || !passphrase}
                >
                  Unlock vault
                </Button>
              )}
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not add account</AlertTitle>
              <AlertDescription className="break-all text-[11px]">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={busy || !uri.trim()}
          >
            {busy ? "Saving…" : mockMode ? "Add demo account" : "Save account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
