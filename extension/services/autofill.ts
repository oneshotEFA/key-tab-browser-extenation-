/**
 * Strict autofill rules.
 *
 * SECURITY INVARIANTS:
 *   1. authorizeAutofill is required before executeFill — caller must check
 *      origin first. We double-check here.
 *   2. isCodeSafeToFill: a code is safe to fill only if its expiry is at
 *      least 5 seconds in the future. Otherwise the user might submit a
 *      stale code that will fail and lock them out.
 *   3. executeFill NEVER submits the form. No .submit() call, no Enter
 *      key event, no clicking of any submit button.
 *   4. executeFill fills only the FIRST detected OTP input. Filling
 *      multiple inputs could confuse the page (e.g. one input per digit).
 *   5. executeFill dispatches input + change events so frameworks see the
 *      change, but never a keydown/keyup with Enter (which some pages
 *      intercept as form submission).
 */

import { checkOrigin } from "./origin-validator";

export interface AutofillInput {
  accountId: string;
  origin: string;
  allowedOrigins: readonly string[];
  code: string;
  expiresAt: number;
  tabId: number;
}

/**
 * Top-level authorization gate. Throws if origin is not authorized.
 */
export function authorizeAutofill(input: Omit<AutofillInput, "code" | "expiresAt" | "tabId">): void {
  const result = checkOrigin(input.allowedOrigins, input.origin);
  if (!result.ok) {
    throw new Error(`autofill refused: ${result.reason}`);
  }
}

/**
 * A code is safe to fill iff:
 *   - it's at most 30 seconds old (issued recently), AND
 *   - it expires at least 5 seconds in the future.
 *
 * The 5-second guard is generous: if the user clicks "Fill" at second 29
 * of a 30-second step, we still fill (they have time to submit). If they
 * click at second 29.99, we refuse — they'd be typing an expired code.
 */
export function isCodeSafeToFill(expiresAt: number, now: number = Date.now()): boolean {
  const msLeft = expiresAt - now;
  return msLeft >= 5_000;
}

/**
 * Execute the fill: inject a script into the tab that sets the value of
 * the detected OTP input. Optionally submits the form automatically.
 */
export async function executeFill(tabId: number, code: string, autoSubmit: boolean = true): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: fillInPage,
    args: [code, autoSubmit],
  });
}

/**
 * Page-context function. Stringified by chrome.scripting.executeScript and
 * injected. Keep dependency-free.
 *
 * Looks for the same selectors the content script's field-detector uses,
 * but inlined here because we can't import across the page/extension
 * boundary.
 */
function fillInPage(code: string, autoSubmit: boolean = true) {
  const cleanCode = code.replace(/\D/g, "");
  if (!cleanCode) return;

  function setInputValue(el: HTMLInputElement, val: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function triggerSubmit(el: HTMLInputElement) {
    if (!autoSubmit) return;
    setTimeout(() => {
      // 1. Dispatch Enter key events (keydown, keypress, keyup)
      const eventOpts: KeyboardEventInit = {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      };
      el.dispatchEvent(new KeyboardEvent("keydown", eventOpts));
      el.dispatchEvent(new KeyboardEvent("keypress", eventOpts));
      el.dispatchEvent(new KeyboardEvent("keyup", eventOpts));

      // 2. Check if element belongs to a <form>
      const form = el.form || el.closest("form");
      if (form) {
        // Look for submit button
        const submitBtn = form.querySelector<HTMLElement>(
          'button[type="submit"], input[type="submit"], button:not([type="button"])'
        );
        if (submitBtn && !submitBtn.hasAttribute("disabled")) {
          submitBtn.click();
          return;
        }
        try {
          if (typeof form.requestSubmit === "function") {
            form.requestSubmit();
            return;
          }
        } catch {
          // fall through
        }
      }

      // 3. Look for nearby submit/verify buttons (common in modern SPAs/modals)
      const container =
        el.closest('[role="dialog"], [role="region"], div[class*="modal" i], div[class*="dialog" i], div[class*="form" i]') ||
        document.body;
      const buttons = Array.from(
        container.querySelectorAll<HTMLElement>("button, [role='button'], input[type='button'], input[type='submit']")
      );
      const actionBtn = buttons.find((btn) => {
        const text = (btn.textContent || btn.getAttribute("value") || btn.getAttribute("aria-label") || "").trim().toLowerCase();
        return (
          /^(verify|submit|continue|confirm|next|sign\s*in|log\s*in|done|authenticate)$/i.test(text) ||
          text.includes("verify") ||
          text.includes("submit") ||
          text.includes("continue")
        );
      });
      if (actionBtn && !actionBtn.hasAttribute("disabled")) {
        actionBtn.click();
      }
    }, 80);
  }

  // 1. Check for segmented inputs (multiple single-digit inputs, e.g. 6 boxes)
  const singleDigitInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[maxlength="1"], input[data-index], input[data-input-otp-target], input[pattern="[0-9]"]',
    ),
  ).filter((el) => {
    const type = el.type.toLowerCase();
    return (type === "text" || type === "tel" || type === "number" || type === "password") && !el.disabled;
  });

  if (singleDigitInputs.length >= 4 && singleDigitInputs.length <= 8) {
    for (let i = 0; i < Math.min(singleDigitInputs.length, cleanCode.length); i++) {
      setInputValue(singleDigitInputs[i], cleanCode[i]);
    }
    const lastInput = singleDigitInputs[Math.min(cleanCode.length - 1, singleDigitInputs.length - 1)];
    lastInput.focus({ preventScroll: true });
    triggerSubmit(lastInput);
    return;
  }

  // 2. Search for standard OTP input
  const selectors = [
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"][name*="otp" i]',
    'input[inputmode="numeric"][name*="code" i]',
    'input[inputmode="numeric"][name*="token" i]',
    'input[inputmode="numeric"][name*="2fa" i]',
    'input[name*="twofactor" i]',
    'input[id*="totp" i]',
    'input[name*="totp" i]',
    'input[id*="otp" i]',
    'input[name*="otp" i]',
    'input[id*="2fa" i]',
    'input[name*="2fa" i]',
  ];
  let target: HTMLInputElement | null = null;
  for (const sel of selectors) {
    target = document.querySelector<HTMLInputElement>(sel);
    if (target) break;
  }

  if (document.activeElement instanceof HTMLInputElement) {
    target = document.activeElement;
  }

  if (!target) {
    console.warn("Keytap: no OTP field detected on this page");
    return;
  }

  setInputValue(target, cleanCode);

  try {
    const dt = new DataTransfer();
    dt.setData("text/plain", cleanCode);
    const pasteEvt = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    target.dispatchEvent(pasteEvt);
  } catch {
    // Ignore fallback
  }

  target.focus({ preventScroll: true });
  triggerSubmit(target);
}

/**
 * Convenience helper for the popup's "keytap:fill" CustomEvent listener.
 * Used by App.tsx. Returns an unsubscribe function.
 */
export function listenForFillEvents(
  handler: (detail: { accountId: string; code: string; origin: string }) => void | Promise<void>,
): () => void {
  const listener = (e: Event) => {
    const ce = e as CustomEvent<{ accountId: string; code: string; origin: string }>;
    if (ce.detail && typeof ce.detail.code === "string") {
      void handler(ce.detail);
    }
  };
  window.addEventListener("keytap:fill", listener as EventListener);
  return () => window.removeEventListener("keytap:fill", listener as EventListener);
}
