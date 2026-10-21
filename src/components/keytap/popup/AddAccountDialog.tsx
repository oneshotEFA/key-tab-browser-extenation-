/**
 * AddAccountDialog — dialog for adding a new TOTP account.
 *
 * Behavior:
 *   - In MOCK mode: paste an `otpauth://` URI and the account is added
 *     to the in-memory mock backend. The URI is validated and the secret
 *     is parsed via parseOtpAuthUri.
 *
 *   - In production: the popup cannot hold secrets (security invariant).
 *     The dialog instructs the user to add accounts via the desktop app
 *     or by scanning a QR code there. The popup then re-queries
 *     `listAccounts` after the desktop app updates the vault.
 *
 * The dialog itself never persists a secret in either mode — the mock
 * backend keeps it in-memory only.
 */

import { useState } from "react";
import { ExternalLink, QrCode, Plus } from "lucide-react";
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
import { parseOtpAuthUri } from "@keytap/lib";

export function AddAccountDialog({
  open,
  onOpenChange,
  mockMode,
  onAddMock,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  mockMode: boolean;
  onAddMock: (uri: string) => { ok: true } | { ok: false; error: string };
}) {
  const [uri, setUri] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens — uses a key derived from `open` to avoid
  // setting state during render.
  const formKey = open ? "open" : "closed";

  function submit() {
    setError(null);
    if (!mockMode) {
      // Should never be reached — the form is hidden in production.
      setError("Add via desktop app in production builds.");
      return;
    }
    try {
      parseOtpAuthUri(uri.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const result = onAddMock(uri.trim());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[340px] p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" />
            Add 2FA account
          </DialogTitle>
          <DialogDescription className="text-xs">
            {mockMode
              ? "Paste an otpauth:// URI. The mock backend keeps it in memory only — it is not persisted and not used in production builds."
              : "Accounts are added via the desktop app or by scanning a QR code there. The popup only reads accounts from the vault."}
          </DialogDescription>
        </DialogHeader>

        {mockMode ? (
          <div className="space-y-2">
            <Label htmlFor="otpauth-uri" className="text-xs">
              otpauth:// URI
            </Label>
            <Input
              id="otpauth-uri"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example"
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-xs"
            />
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Could not add account</AlertTitle>
                <AlertDescription className="text-[11px]">{error}</AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Alert>
              <AlertTitle className="text-sm">Open the desktop app</AlertTitle>
              <AlertDescription className="text-[11px]">
                The popup never holds shared secrets. Add accounts in the
                Keytap desktop app, then click <strong>Refresh</strong> below
                to re-query the vault.
              </AlertDescription>
            </Alert>
            <Button asChild variant="outline" size="sm" className="w-full gap-2">
              <a href="keytap://open" target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                Open Keytap desktop app
              </a>
            </Button>
            <Button variant="outline" size="sm" className="w-full gap-2">
              <QrCode className="size-3.5" />
              Scan QR via desktop app
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {mockMode && (
            <Button size="sm" onClick={submit} disabled={!uri.trim()}>
              Add to mock vault
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
