/**
 * OTP field detector.
 *
 * Confidence tiers:
 *   - HIGH:   input[autocomplete="one-time-code"]
 *             (explicit browser hint; nearly always correct)
 *   - MEDIUM: input[inputmode="numeric"] AND name/id matches
 *             /otp|code|token|2fa|twofactor/i
 *   - LOW:    input[inputmode="numeric"] with no name/id hint
 *             (returned but not preferred)
 *
 * uniqueSelector() builds a stable CSS selector path for an element so the
 * background script can target the same field across reruns.
 */

export interface OtpFieldInfo {
  /** A stable CSS selector that uniquely identifies this field. */
  selector: string;
  /** Confidence tier. */
  confidence: "high" | "medium" | "low";
  /** The DOM element (only available in the content-script context). */
  element: HTMLInputElement;
  /** Matched name attribute (if any). */
  name: string | null;
  /** Matched autocomplete attribute (if any). */
  autocomplete: string | null;
  /** Matched inputmode attribute (if any). */
  inputmode: string | null;
}

const HIGH_SELECTOR = 'input[autocomplete="one-time-code"]';
const MEDIUM_NAME_REGEX = /otp|code|token|2fa|twofactor/i;
const MEDIUM_SELECTOR =
  'input[inputmode="numeric"][name*="otp" i], ' +
  'input[inputmode="numeric"][name*="code" i], ' +
  'input[inputmode="numeric"][name*="token" i], ' +
  'input[inputmode="numeric"][name*="2fa" i], ' +
  'input[inputmode="numeric"][name*="twofactor" i], ' +
  'input[inputmode="numeric"][id*="otp" i], ' +
  'input[inputmode="numeric"][id*="code" i], ' +
  'input[inputmode="numeric"][id*="token" i], ' +
  'input[inputmode="numeric"][id*="2fa" i], ' +
  'input[inputmode="numeric"][id*="twofactor" i]';
const LOW_SELECTOR = "input[inputmode='numeric']";

/**
 * Detect candidate OTP fields on the document. Returns at most 5 fields,
 * sorted by confidence (high first).
 *
 * Duplicates are deduped — a field that matches both HIGH and MEDIUM is
 * reported only once with its highest confidence tier.
 */
export function detectOtpFields(doc: Document = document): OtpFieldInfo[] {
  const seen = new Set<HTMLInputElement>();
  const out: OtpFieldInfo[] = [];

  for (const el of Array.from(doc.querySelectorAll<HTMLInputElement>(HIGH_SELECTOR))) {
    if (seen.has(el)) continue;
    seen.add(el);
    out.push({
      selector: uniqueSelector(el),
      confidence: "high",
      element: el,
      name: el.getAttribute("name"),
      autocomplete: el.getAttribute("autocomplete"),
      inputmode: el.getAttribute("inputmode"),
    });
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLInputElement>(MEDIUM_SELECTOR))) {
    if (seen.has(el)) continue;
    seen.add(el);
    out.push({
      selector: uniqueSelector(el),
      confidence: "medium",
      element: el,
      name: el.getAttribute("name"),
      autocomplete: el.getAttribute("autocomplete"),
      inputmode: el.getAttribute("inputmode"),
    });
  }
  // Low tier: only if no higher-confidence field was found, to keep noise down.
  if (out.length === 0) {
    for (const el of Array.from(doc.querySelectorAll<HTMLInputElement>(LOW_SELECTOR))) {
      if (seen.has(el)) continue;
      seen.add(el);
      // Only include if name/id looks code-like OR there's exactly one such input.
      const name = el.getAttribute("name") ?? "";
      const id = el.id ?? "";
      if (MEDIUM_NAME_REGEX.test(name) || MEDIUM_NAME_REGEX.test(id)) {
        out.push({
          selector: uniqueSelector(el),
          confidence: "low",
          element: el,
          name: el.getAttribute("name"),
          autocomplete: el.getAttribute("autocomplete"),
          inputmode: el.getAttribute("inputmode"),
        });
      }
    }
  }
  return out.slice(0, 5);
}

/**
 * Build a unique CSS selector for an input element.
 *
 * Strategy:
 *   1. If element has id, return "#<id>" (escaped).
 *   2. Otherwise walk up the DOM, building a path of tag + nth-of-type.
 */
export function uniqueSelector(el: Element): string {
  if (el.id) {
    return `#${cssEscape(el.id)}`;
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1) {
    const tag = cur.tagName.toLowerCase();
    const parent = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const currentTagName = cur.tagName;
    const siblings = [...parent.children].filter((c) => c.tagName === currentTagName);
    if (siblings.length === 1) {
      parts.unshift(tag);
    } else {
      const index = siblings.indexOf(cur) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
    }
    cur = parent;
    if (parts.length > 8) break; // cap depth
  }
  return parts.join(" > ");
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  // Minimal fallback for non-DOM contexts.
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
