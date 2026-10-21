/**
 * SettingsDialog — popup settings.
 *
 *   - Inactivity lock slider (15s..30min)
 *   - Max session (30min cap, hard)
 *   - lockOnOsLock toggle
 *   - requireReauthForDelete toggle
 *   - requireReauthForExport toggle
 *   - neverAutoSubmit toggle (READ-ONLY, always on — security invariant)
 *   - theme select (light/system/dark)
 *
 * Settings are persisted by the host (PopupBackend.saveSettings) into
 * chrome.storage.local. In the preview harness they go to localStorage.
 */

import { useEffect } from "react";
import { Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import { Slider } from "../../ui/slider";
import { Label } from "../../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { Separator } from "../../ui/separator";
import type { PopupSettings } from "./types";
import { cn } from "@keytap/lib";

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  settings: PopupSettings;
  onChange: (next: PopupSettings) => void;
}) {
  // Force neverAutoSubmit on every render — it is a hard invariant.
  useEffect(() => {
    if (!settings.neverAutoSubmit) {
      onChange({ ...settings, neverAutoSubmit: true });
    }
  }, [settings, onChange]);

  function patch(p: Partial<PopupSettings>) {
    onChange({ ...settings, ...p, neverAutoSubmit: true });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[340px] p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="size-4" />
            Settings
          </DialogTitle>
          <DialogDescription className="text-xs">
            Auto-lock, re-auth requirements, and theme. Changes apply on save.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Inactivity lock */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="inactivity" className="text-xs">
                Inactivity lock
              </Label>
              <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
                {formatSec(settings.inactivityLockSec)}
              </span>
            </div>
            <Slider
              id="inactivity"
              min={15}
              max={1800}
              step={15}
              value={[settings.inactivityLockSec]}
              onValueChange={(v) => patch({ inactivityLockSec: v[0] ?? 300 })}
            />
          </div>

          {/* Max session */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="max-session" className="text-xs">
                Max session
              </Label>
              <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
                {formatSec(settings.maxSessionSec)}
              </span>
            </div>
            <Slider
              id="max-session"
              min={60}
              max={1800}
              step={60}
              value={[settings.maxSessionSec]}
              onValueChange={(v) => patch({ maxSessionSec: Math.min(1800, v[0] ?? 1800) })}
            />
            <p className="text-[9px] text-muted-foreground">
              Hard cap: 30 minutes (per security policy).
            </p>
          </div>

          <Separator />

          {/* Toggles */}
          <ToggleRow
            label="Lock on OS lock"
            description="Lock when the screen locks / OS sleeps."
            checked={settings.lockOnOsLock}
            onChange={(v) => patch({ lockOnOsLock: v })}
          />
          <ToggleRow
            label="Re-auth to delete"
            description="Require Touch ID / Windows Hello to remove an account."
            checked={settings.requireReauthForDelete}
            onChange={(v) => patch({ requireReauthForDelete: v })}
          />
          <ToggleRow
            label="Re-auth to export"
            description="Require OS re-auth to export the encrypted backup."
            checked={settings.requireReauthForExport}
            onChange={(v) => patch({ requireReauthForExport: v })}
          />
          <ToggleRow
            label="Never auto-submit"
            description="Codes are filled, never submitted. This is a hard security invariant and cannot be turned off."
            checked
            disabled
            onChange={() => {
              /* no-op */
            }}
          />

          <Separator />

          {/* Theme */}
          <div className="space-y-1.5">
            <Label htmlFor="theme" className="text-xs">
              Theme
            </Label>
            <Select
              value={settings.theme}
              onValueChange={(v) => patch({ theme: v as PopupSettings["theme"] })}
            >
              <SelectTrigger id="theme" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3")}>
      <div className="space-y-0.5">
        <p className={cn("text-xs font-medium", disabled && "text-muted-foreground")}>
          {label}
        </p>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function formatSec(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}
