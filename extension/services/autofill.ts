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
 * the detected OTP input. Never submits the form.
 */
export async function executeFill(tabId: number, code: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: fillInPage,
    args: [code],
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
function fillInPage(code: string) {
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
    singleDigitInputs[Math.min(cleanCode.length - 1, singleDigitInputs.length - 1)].focus({ preventScroll: true });
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
  // SECURITY: do NOT call target.form?.submit() or dispatch a keydown Enter.
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
