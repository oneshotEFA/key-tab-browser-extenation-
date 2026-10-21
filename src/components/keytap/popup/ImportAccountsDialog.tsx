/**
 * ImportAccountsDialog — Bulk import 2FA accounts from authenticator exports.
 *
 * Prompts and requires the user to provide/confirm the website origin for each
 * imported account so that in-page autofill actually matches and functions.
 */

import { useState, useRef, useEffect } from "react";
import {
  ArrowDownToLine,
  Globe2,
  Lock,
  UploadCloud,
  Check,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
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
import { Alert, AlertDescription } from "../../ui/alert";
import {
  parseMigrationUri,
  parseOtpAuthUri,
  inferOriginForIssuer,
  normalizeOrigin,
  shortOrigin,
} from "@keytap/lib";

export interface DiscoveredAccount {
  id: string;
  issuer: string;
  label: string;
  originInput: string;
  normalizedOrigin: string | null;
  otpauthUri: string;
  selected: boolean;
}

export function ImportAccountsDialog({
  open,
  onOpenChange,
  mockMode,
  activeOrigin,
  vaultExists,
  vaultLocked,
  onImportBatch,
  onUnlock,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  mockMode: boolean;
  activeOrigin?: string | null;
  vaultExists: boolean;
  vaultLocked: boolean;
  onImportBatch: (
    items: Array<{ uri: string; origin: string }>,
    passphrase: string,
  ) => Promise<{ succeeded: number; failed: number }>;
  onUnlock: (passphrase: string) => Promise<void>;
}) {
  const [step, setStep] = useState<"input" | "preview">("input");
  const [migrationUri, setMigrationUri] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredAccount[]>([]);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when closed
  useEffect(() => {
    if (!open) {
      setStep("input");
      setMigrationUri("");
      setDiscovered([]);
      setError(null);
      setImportProgress(null);
      setPassphrase("");
      setConfirmation("");
    }
  }, [open]);

  // Support pasting image directly into dialog (e.g. Cmd+V screenshot of Google Auth export QR)
  useEffect(() => {
    if (!open || step !== "input") return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            void processImageFile(file);
            return;
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [open, step]);

  function parseInputPayload(raw: string) {
    setError(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setError("Please paste a migration link or select an authenticator export QR image.");
      return;
    }

    try {
      // Check if it's a standard single otpauth:// URI
      if (trimmed.toLowerCase().startsWith("otpauth://")) {
        const parsed = parseOtpAuthUri(trimmed);
        const issuer = parsed.issuer || "Authenticator";
        const suggested = inferOriginForIssuer(issuer, parsed.label || "");
        const normalized = normalizeOrigin(suggested);
        setDiscovered([
          {
            id: "disc-0",
            issuer,
            label: parsed.label || "",
            originInput: suggested ? suggested.replace(/^https?:\/\//, "") : "",
            normalizedOrigin: normalized,
            otpauthUri: trimmed,
            selected: true,
          },
        ]);
        setStep("preview");
        return;
      }

      // Parse otpauth-migration export
      const accounts = parseMigrationUri(trimmed);
      if (accounts.length === 0) {
        throw new Error("No accounts found in that migration export.");
      }

      const formatted: DiscoveredAccount[] = accounts.map((acc, idx) => {
        const suggested = acc.suggestedOrigin; // Inferred origin or ""
        const normalized = normalizeOrigin(suggested);
        return {
          id: `disc-${idx}`,
          issuer: acc.issuer,
          label: acc.label,
          originInput: suggested ? suggested.replace(/^https?:\/\//, "") : "",
          normalizedOrigin: normalized,
          otpauthUri: acc.otpauthUri,
          selected: true,
        };
      });

      setDiscovered(formatted);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function processImageFile(file: File) {
    setError(null);
    setIsProcessing(true);
    try {
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (options: { formats: string[] }) => {
            detect(source: ImageBitmap): Promise<Array<{ rawValue: string }>>;
          };
        }
      ).BarcodeDetector;

      if (!Detector) {
        throw new Error(
          "Barcode detection is not natively supported in this browser window. Please paste the migration link instead.",
        );
      }

      const bitmap = await createImageBitmap(file);
      try {
        const detector = new Detector({ formats: ["qr_code"] });
        const results = await detector.detect(bitmap);

        if (!results || results.length === 0 || !results[0].rawValue) {
          throw new Error(
            "No QR code was detected in the uploaded image. Please ensure the Google Authenticator export QR is clearly visible.",
          );
        }

        const rawValue = results[0].rawValue;
        parseInputPayload(rawValue);
      } finally {
        bitmap.close();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  }

  const toggleSelectAll = () => {
    const allSelected = discovered.every((d) => d.selected);
    setDiscovered((prev) => prev.map((d) => ({ ...d, selected: !allSelected })));
  };

  const toggleAccount = (id: string) => {
    setDiscovered((prev) =>
      prev.map((d) => (d.id === id ? { ...d, selected: !d.selected } : d)),
    );
  };

  const updateAccountOrigin = (id: string, nextInput: string) => {
    const normalized = normalizeOrigin(nextInput);
    setDiscovered((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, originInput: nextInput, normalizedOrigin: normalized } : d,
      ),
    );
  };

  async function handleUnlockVault() {
    setError(null);
    setIsProcessing(true);
    try {
      await onUnlock(passphrase);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleExecuteImport() {
    setError(null);
    const selected = discovered.filter((d) => d.selected);
    if (selected.length === 0) {
      setError("Please select at least one account to import.");
      return;
    }

    // Strict validation: every selected account MUST have a valid normalized origin
    const missingOrigin = selected.find((s) => !s.normalizedOrigin);
    if (missingOrigin) {
      setError(
        `Please specify a valid website domain for "${missingOrigin.issuer || missingOrigin.label}" so autofill will function on that site.`,
      );
      return;
    }

    const needsPassphrase = !mockMode && (!vaultExists || vaultLocked);
    if (needsPassphrase) {
      if (passphrase.length < 8) {
        setError("Vault passphrase must be at least 8 characters.");
        return;
      }
      if (!vaultExists && passphrase !== confirmation) {
        setError("The vault passphrases do not match.");
        return;
      }
    }

    setIsProcessing(true);
    setImportProgress(`Importing 0 of ${selected.length}…`);

    try {
      const items = selected.map((s) => ({
        uri: s.otpauthUri,
        origin: s.normalizedOrigin!,
      }));

      const res = await onImportBatch(items, passphrase);
      if (res.failed > 0 && res.succeeded === 0) {
        throw new Error("Failed to save accounts to vault.");
      }

      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
      setImportProgress(null);
    }
  }

  const selectedCount = discovered.filter((d) => d.selected).length;
  const missingOriginsCount = discovered.filter((d) => d.selected && !d.normalizedOrigin).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[380px] p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowDownToLine className="size-4 text-primary" />
            Import accounts
          </DialogTitle>
          <DialogDescription className="text-xs">
            {step === "input"
              ? "Import accounts exported from Google Authenticator or other authenticator apps."
              : "Authenticator exports do not include website domains. Provide each account's website so Keytap can autofill codes when you visit that site."}
          </DialogDescription>
        </DialogHeader>

        {step === "input" ? (
          <div className="space-y-3">
            {/* Image Upload / Drop Zone */}
            <div
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition-colors cursor-pointer ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50 bg-muted/20"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void processImageFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void processImageFile(file);
                  e.currentTarget.value = "";
                }}
              />
              <UploadCloud className="size-8 text-muted-foreground mb-1" />
              <p className="text-xs font-medium">Scan Google Authenticator QR image</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Drop image here, browse, or press Cmd+V to paste
              </p>
            </div>

            <div className="relative flex items-center justify-center text-xs text-muted-foreground">
              <span className="bg-background px-2 z-10 text-[10px] uppercase font-medium">
                or paste migration link
              </span>
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
            </div>

            {/* Migration URI / Text input */}
            <div className="space-y-1.5">
              <Label htmlFor="migration-link" className="text-xs">
                Migration link or data
              </Label>
              <Input
                id="migration-link"
                placeholder="otpauth-migration://offline?data=..."
                value={migrationUri}
                onChange={(e) => setMigrationUri(e.target.value)}
                className="font-mono text-xs"
                spellCheck={false}
                autoComplete="off"
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-[11px] break-all">{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => parseInputPayload(migrationUri)}
                disabled={isProcessing || !migrationUri.trim()}
              >
                {isProcessing ? "Scanning…" : "Continue"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header controls for selection */}
            <div className="flex items-center justify-between text-xs px-1">
              <span className="font-medium text-muted-foreground">
                {selectedCount} of {discovered.length} selected
              </span>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-[11px] text-primary hover:underline font-medium"
              >
                {discovered.every((d) => d.selected) ? "Deselect all" : "Select all"}
              </button>
            </div>

            {/* Account List with Website/Origin inputs */}
            <div className="max-h-[220px] overflow-y-auto space-y-2 rounded-md border p-2 bg-muted/20">
              {discovered.map((acc) => (
                <div
                  key={acc.id}
                  className={`flex flex-col gap-1.5 rounded-lg p-2.5 transition-colors border ${
                    acc.selected
                      ? !acc.normalizedOrigin
                        ? "bg-amber-50/40 border-amber-300 dark:bg-amber-950/20 dark:border-amber-800"
                        : "bg-card border-primary/30"
                      : "bg-muted/40 border-transparent opacity-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`check-${acc.id}`}
                      checked={acc.selected}
                      onChange={() => toggleAccount(acc.id)}
                      className="size-3.5 rounded border-input text-primary focus:ring-primary cursor-pointer"
                    />
                    <label
                      htmlFor={`check-${acc.id}`}
                      className="flex-1 min-w-0 cursor-pointer select-none"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-semibold">{acc.issuer}</span>
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {acc.label || "(no username)"}
                      </p>
                    </label>
                  </div>

                  {acc.selected && (
                    <div className="space-y-1 pl-5 pt-0.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-medium text-muted-foreground flex items-center gap-1">
                          <Globe2 className="size-3 text-primary" />
                          Website (for autofill)
                        </span>
                        {acc.normalizedOrigin ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5">
                            <Check className="size-3" /> Ready
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-0.5">
                            <AlertCircle className="size-3" /> Website required
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <Input
                          value={acc.originInput}
                          onChange={(e) => updateAccountOrigin(acc.id, e.target.value)}
                          placeholder="e.g. github.com"
                          className={`h-7 text-xs font-mono ${
                            !acc.normalizedOrigin
                              ? "border-amber-400 focus:border-amber-500 bg-amber-50/30 dark:bg-amber-950/30"
                              : ""
                          }`}
                        />
                        {activeOrigin && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] shrink-0"
                            onClick={() => updateAccountOrigin(acc.id, activeOrigin)}
                            title={`Assign current tab origin (${activeOrigin})`}
                          >
                            Use active tab
                          </Button>
                        )}
                      </div>

                      {acc.normalizedOrigin && (
                        <p className="text-[10px] text-muted-foreground font-mono truncate">
                          Autofills on: <span className="font-semibold text-foreground">{acc.normalizedOrigin}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {missingOriginsCount > 0 && selectedCount > 0 && (
              <Alert className="border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30 py-2">
                <AlertTriangle className="size-3.5 text-amber-600" />
                <AlertDescription className="text-[11px] text-amber-800 dark:text-amber-300">
                  {missingOriginsCount === 1
                    ? "1 account needs a website domain so Keytap knows where to autofill it."
                    : `${missingOriginsCount} accounts need website domains so Keytap knows where to autofill them.`}
                </AlertDescription>
              </Alert>
            )}

            {/* Vault lock / passphrase requirement */}
            {!mockMode && (!vaultExists || vaultLocked) && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Lock className="size-3.5 text-primary" />
                  <span>{vaultExists ? "Unlock vault to import" : "Set vault passphrase"}</span>
                </div>
                <Input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Vault passphrase (8+ chars)"
                  className="h-8 text-xs"
                />
                {!vaultExists && (
                  <Input
                    type="password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder="Confirm vault passphrase"
                    className="h-8 text-xs"
                  />
                )}
                {vaultExists && vaultLocked && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs h-7"
                    onClick={() => void handleUnlockVault()}
                    disabled={isProcessing || !passphrase}
                  >
                    Unlock vault
                  </Button>
                )}
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-[11px] break-all">{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("input")}
                disabled={isProcessing}
              >
                Back
              </Button>
              <Button
                size="sm"
                onClick={() => void handleExecuteImport()}
                disabled={isProcessing || selectedCount === 0 || missingOriginsCount > 0}
              >
                {isProcessing
                  ? importProgress || "Importing…"
                  : missingOriginsCount > 0
                  ? `Provide website (${missingOriginsCount} missing)`
                  : `Import ${selectedCount} account${selectedCount === 1 ? "" : "s"}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
