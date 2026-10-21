/**
 * Popup root component. Wires PopupApp to either the mock or native backend
 * and reads the active tab's origin (chrome.tabs) before mounting.
 *
 * In dev (KEYTAP_MOCK=1): uses createMockBackend from @keytap/popup.
 * In prod: uses createNativeBackend (defined in services/native-messaging.ts),
 *          which talks to the Rust native host over stdio.
 *
 * SECURITY: the mock backend is loaded via dynamic import so that production
 * builds (KEYTAP_MOCK unset) can tree-shake the mock code out of the main
 * bundle chunk. `scripts/check-no-mock.mjs` additionally scans the entire
 * production output for mock symbols and fails the build if any leak through.
 */

import { useEffect, useState } from "react";
import type { PopupBackend } from "@keytap/popup";
import { PopupApp } from "@keytap/popup";
import { isMockMode } from "@/services/mock-mode";
import { createNativeBackend } from "@/services/native-messaging";
import { listenForFillEvents } from "@/services/autofill";

export function App() {
  const [backend, setBackend] = useState<PopupBackend | null>(null);
  const [activeOrigin, setActiveOrigin] = useState<string | null>(null);
  const [hostVersionLabel, setHostVersionLabel] = useState<string>("0.1.0-dev");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (isMockMode()) {
        // Dynamic import so production builds can drop the mock chunk.
        const mod = await import("@keytap/popup");
        if (cancelled) return;
        setBackend(mod.createMockBackend({ hostVersion: "0.1.0-mock" }));
        setHostVersionLabel("0.1.0-mock");
      } else {
        if (cancelled) return;
        const native = createNativeBackend();
        setBackend(native);
        setHostVersionLabel(native.hostVersionLabel);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Read the active tab's origin.
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.tabs?.query) return;
    let cancelled = false;
    const run = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (cancelled) return;
        if (tab?.url) {
          try {
            const u = new URL(tab.url);
            // Only set if it's an http(s) origin (chrome://, file://, etc are not fillable).
            if (u.protocol === "https:" || u.protocol === "http:") {
              setActiveOrigin(`${u.protocol}//${u.host}`);
            } else {
              setActiveOrigin(null);
            }
          } catch {
            setActiveOrigin(null);
          }
        }
      } catch {
        setActiveOrigin(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Wire up the "keytap:fill" event from PopupApp to the autofill service.
  useEffect(() => {
    const off = listenForFillEvents(async (detail) => {
      // Delegate the actual fill to the autofill service, which talks to
      // the content script via chrome.tabs.sendMessage.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? 0 },
          func: fillInPage,
          args: [detail.code],
        });
      } catch (e) {
        console.error("keytap:fill failed", e);
      }
    });
    return off;
  }, []);

  if (!backend) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <PopupApp
      backend={backend}
      activeOrigin={activeOrigin}
      hostVersionLabel={hostVersionLabel}
    />
  );
}

/**
 * Injected into the page by chrome.scripting.executeScript. Sets the value
 * of the detected OTP field. Does NOT submit the form (never-auto-submit).
 *
 * NOTE: this function is stringified and runs in the page context, not in
 * the extension's content-script context. Keep it dependency-free.
 */
function fillInPage(code: string) {
  const fields = document.querySelectorAll<HTMLInputElement>(
    'input[autocomplete="one-time-code"], input[inputmode="numeric"][name*="otp" i], input[inputmode="numeric"][name*="code" i], input[inputmode="numeric"][name*="token" i], input[inputmode="numeric"][name*="2fa" i], input[name*="twofactor" i]',
  );
  const target = fields[0];
  if (!target) {
    console.warn("Keytap: no OTP field detected on this page");
    return;
  }
  // Set value + dispatch events so frameworks (React, Vue) pick up the change.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(target, code);
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  target.focus({ preventScroll: true });
}
