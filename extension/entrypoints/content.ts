/**
 * Content script — passive, activeTab only.
 *
 * SECURITY:
 * - Never has access to the TOTP secret or OTP code.
 * - The background fills the field via chrome.scripting.executeScript
 *   in an isolated world the content script can't tamper with.
 * - Only runs in the top frame in v1 (no cross-origin iframes).
 * - Does NOT auto-detect on page load — only when the user invokes Keytap.
 */

export default defineContentScript({
  matches: [],
  runAt: "document_idle",
  main() {
    // Passive: listen for "detect-and-report" pings from the background.
    chrome.runtime?.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "ping-fields") {
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });
  },
});
