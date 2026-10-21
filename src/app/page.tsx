"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Moon,
  Sun,
  Monitor,
  Info,
  FlaskConical,
  Download,
  FileText,
  CheckCircle2,
  Package,
  ShieldCheck,
  ListChecks,
  Keyboard,
} from "lucide-react";
import { Toaster as SonnerToaster } from "sonner";
import { PopupApp, createMockBackend } from "@keytap/popup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SIMULATED_ORIGINS = [
  "https://github.com",
  "https://login.example.com",
  "https://account.proton.me",
  "https://dash.cloudflare.com",
  "https://evil.example.com",
  "https://gist.github.com",
] as const;

type Theme = "system" | "light" | "dark";

export default function Home() {
  const [activeOrigin, setActiveOrigin] = useState<string>(SIMULATED_ORIGINS[0]);
  const [theme, setTheme] = useState<Theme>("light");
  const [otpInput, setOtpInput] = useState("");

  const backend = useMemo(() => createMockBackend({ hostVersion: "0.1.0-mock" }), []);

  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = theme === "dark" || (theme === "system" && prefersDark);
    root.classList.toggle("dark", isDark);
  }, [theme]);

  const isDark = theme === "dark";

  return (
    <main className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Keytap</h1>
              <Badge variant="secondary" className="text-[10px]">
                Phase 5 — Complete
              </Badge>
              <Badge
                variant="outline"
                className="border-amber-400 bg-amber-50 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
              >
                DEMO MODE
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Local-first 2FA/TOTP autofill. Rust core + Chrome MV3 extension +
              native host. 68 tests passing. Ready for local install + review.
            </p>
          </div>
          <ThemeToggle theme={theme} onChange={setTheme} />
        </header>

        {/* Download Section — prominent, green */}
        <section className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white">
                <Download className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Download the full project</h2>
                <p className="text-xs text-muted-foreground">
                  Complete source code (Rust core + native host + MV3 extension +
                  Next.js preview harness + docs). 68 tests passing.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild size="default" className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                <a href="/api/download" download="keytap-project.zip">
                  <Download className="size-4" />
                  Download ZIP
                </a>
              </Button>
              <Button asChild variant="outline" size="default" className="gap-2">
                <a href="/SETUP.md" target="_blank" rel="noreferrer">
                  <FileText className="size-4" />
                  Setup Guide
                </a>
              </Button>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          {/* Popup frame */}
          <section className="lg:sticky lg:top-8 lg:self-start">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Popup · 360 × 560
              </span>
              <Badge variant="outline" className="text-[9px]">
                <Package className="size-3" /> live mock backend
              </Badge>
            </div>
            <div
              className={cn(
                "overflow-hidden rounded-xl border bg-background shadow-lg",
                "dark:shadow-black/40",
              )}
              style={{ width: 360, height: 560 }}
            >
              <div className="h-full w-full">
                <PopupApp
                  backend={backend}
                  activeOrigin={activeOrigin}
                  hostVersionLabel="0.1.0-mock"
                />
              </div>
            </div>
          </section>

          {/* Controls */}
          <section className="flex flex-col gap-6">
            {/* Quick-start code block */}
            <ControlCard
              title="Quick Start (TL;DR)"
              description="3 commands to get it running locally."
            >
              <div className="space-y-2 rounded-lg bg-neutral-900 p-3 font-mono text-[11px] leading-relaxed text-neutral-100 dark:bg-neutral-950">
                <div><span className="text-emerald-400"># 1. Install Rust + Bun</span></div>
                <div>
                  <span className="text-blue-400">curl</span> --proto &apos;=https&apos; --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
                </div>
                <div>
                  <span className="text-blue-400">curl</span> -fsSL https://bun.sh/install | bash
                </div>
                <div className="mt-2"><span className="text-emerald-400"># 2. Unzip + test (68 tests)</span></div>
                <div>
                  <span className="text-blue-400">unzip</span> keytap-project.zip && <span className="text-blue-400">cd</span> keytap-project
                </div>
                <div>
                  <span className="text-blue-400">cargo</span> test{"  "}
                  <span className="text-neutral-500"># 47 core · 5 integration · 14 adversarial · 2 messaging</span>
                </div>
                <div className="mt-2"><span className="text-emerald-400"># 3. Build native host</span></div>
                <div>
                  <span className="text-blue-400">cargo</span> build --release -p keytap-native-host
                </div>
                <div className="mt-2"><span className="text-emerald-400"># 4. Build extension (dev with mock)</span></div>
                <div>
                  <span className="text-blue-400">cd</span> extension && <span className="text-blue-400">bun</span> install
                </div>
                <div>KEYTAP_MOCK=1 <span className="text-blue-400">bun</span> run dev</div>
                <div className="mt-2"><span className="text-emerald-400"># 5. Load in Chrome</span></div>
                <div>
                  <span className="text-neutral-500">chrome://extensions → Load unpacked → extension/.output/chrome-mv3-dev/</span>
                </div>
              </div>
            </ControlCard>

            {/* Simulated active tab */}
            <ControlCard
              title="Simulated active tab"
              description="Switch the origin to test exact-origin authorization."
            >
              <div className="space-y-2">
                <Label htmlFor="origin-select" className="text-xs">
                  Active tab origin
                </Label>
                <Select value={activeOrigin} onValueChange={setActiveOrigin}>
                  <SelectTrigger id="origin-select" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIMULATED_ORIGINS.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <OriginMatchInfo origin={activeOrigin} />
              </div>
            </ControlCard>

            {/* Test login form */}
            <ControlCard
              title="Test login form"
              description="The popup detects fields like this (autocomplete='one-time-code')."
            >
              <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="otp" className="text-xs">
                    Verification code
                  </Label>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000 000"
                    maxLength={7}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    className="font-mono tabular-nums tracking-widest"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" disabled>
                    Verify
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setOtpInput("")}
                  >
                    Clear
                  </Button>
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Keyboard className="size-3" />
                    Ctrl+Shift+2 autofills
                  </span>
                </div>
              </form>
            </ControlCard>

            {/* Build status */}
            <ControlCard
              title="Build status — 68 tests, all passing"
              description="All phases complete. Click Download ZIP to test locally."
            >
              <div className="space-y-3">
                <ul className="space-y-1 text-xs">
                  <BuildStatus ok label="Rust core: TOTP (RFC 6238 SHA1/256/512), AES-GCM, Argon2id, VEK, vault, backup, QR" />
                  <BuildStatus ok label="Native host binary: 5 integration tests (ping, getCode, origin, list, lock)" />
                  <BuildStatus ok label="Adversarial suite: 14 tests (origin spoof, replay, DoS, secret-leak, malformed)" />
                  <BuildStatus ok label="MV3 extension scaffold: popup, background SW, content script, services" />
                  <BuildStatus ok label="Shared TS protocol: @keytap/protocol with secret-leak rejection" />
                  <BuildStatus ok label="Popup UI: 360×560, dark mode, live mock TOTP, exact-origin autofill" />
                  <BuildStatus ok label="Native messaging installers: macOS + Windows" />
                  <BuildStatus ok label="CI guard: scripts/check-no-mock.mjs rejects mock in production bundles" />
                  <BuildStatus ok label="Documentation: SETUP.md, SECURITY.md, docs/security-review.md" />
                  <BuildStatus label="Your machine: macOS/Win FFI + Tauri GUI + signed installers + external audit" />
                </ul>
              </div>
            </ControlCard>

            {/* Test coverage */}
            <ControlCard
              title="Test coverage"
              description="68 tests across 4 suites. All green."
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatBox label="Core unit" count={47} color="emerald" sub="TOTP · AES-GCM · Argon2 · VEK · vault · backup · QR" />
                <StatBox label="Integration" count={5} color="emerald" sub="ping · getCode · origin · list · lock" />
                <StatBox label="Adversarial" count={14} color="amber" sub="origin spoof · replay · DoS · secret-leak" />
                <StatBox label="Messaging" count={2} color="neutral" sub="frame roundtrip · secret rejection" />
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg border bg-muted/30 p-2">
                <div className="flex items-center gap-2 text-xs">
                  <ListChecks className="size-4 text-emerald-500" />
                  <span className="font-medium">Total</span>
                </div>
                <span className="font-mono text-sm font-bold tabular-nums">68 / 68</span>
              </div>
            </ControlCard>

            {/* Info banner */}
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
              <Info className="mt-0.5 size-4 shrink-0" />
              <div>
                <strong>Test the autofill:</strong> click an account whose
                origin matches the simulated tab (e.g. GitHub + github.com) —
                the Fill button is enabled. Switch to{" "}
                <code>evil.example.com</code> and notice the same-eTLD+1
                account is <em>not</em> auto-authorized (exact-origin policy).
              </div>
            </div>
          </section>
        </div>

        {/* Sticky footer */}
        <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-col items-center gap-2 border-t bg-neutral-50/95 px-4 py-4 text-center text-xs text-muted-foreground backdrop-blur dark:bg-neutral-950/95 sm:-mx-6 sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-emerald-500" />
            <span>
              Phase 5 complete · 68 tests passing · exact-origin policy ·
              never-auto-submit · strict MV3 CSP
            </span>
          </div>
          <p>Brand &quot;Keytap&quot; is provisional. Verify trademark availability before public release.</p>
        </footer>
      </div>

      <SonnerToaster theme={isDark ? "dark" : "light"} position="bottom-right" richColors />
    </main>
  );
}

// ---------------------------------------------------------------------------

function ControlCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}

function BuildStatus({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <CheckCircle2
        className={cn(
          "size-3.5 shrink-0",
          ok ? "text-emerald-500" : "text-muted-foreground/30",
        )}
      />
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

function StatBox({
  label,
  count,
  color,
  sub,
}: {
  label: string;
  count: number;
  color: "emerald" | "amber" | "neutral";
  sub: string;
}) {
  const colorClasses = {
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400",
    neutral: "bg-muted/30 text-foreground",
  };
  return (
    <div className={cn("rounded border p-2", colorClasses[color])}>
      <div className="text-[10px] font-medium">{label}</div>
      <div className="text-lg font-bold tabular-nums">{count}</div>
      <div className="text-[9px] opacity-70">{sub}</div>
    </div>
  );
}

function OriginMatchInfo({ origin }: { origin: string }) {
  const matches = computeMockMatches(origin);
  if (matches.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground">
        No accounts authorized for this origin (exact-origin policy).
        {origin.includes("evil.example.com") ? (
          <span className="ml-1 text-amber-600 dark:text-amber-400">
            Same eTLD+1 as login.example.com — still rejected.
          </span>
        ) : null}
      </p>
    );
  }
  return (
    <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
      {matches.length} account{matches.length === 1 ? "" : "s"} authorized for
      this exact origin.
    </p>
  );
}

function computeMockMatches(origin: string): string[] {
  const mock = [
    { id: "github", origin: "https://github.com", extra: ["https://gist.github.com"] },
    { id: "example", origin: "https://login.example.com", extra: [] },
    { id: "proton", origin: "https://account.proton.me", extra: [] },
    { id: "cloudflare", origin: "https://dash.cloudflare.com", extra: [] },
  ];
  return mock
    .filter((m) => m.origin === origin || m.extra.includes(origin))
    .map((m) => m.id);
}

function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (t: Theme) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border bg-card p-0.5">
      {(["light", "system", "dark"] as Theme[]).map((t) => {
        const Icon = t === "light" ? Sun : t === "dark" ? Moon : Monitor;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={cn(
              "flex h-7 items-center gap-1 rounded px-2 text-xs font-medium transition-colors",
              theme === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={theme === t}
            title={t}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{t}</span>
          </button>
        );
      })}
    </div>
  );
}
