import { defineContentScript } from "wxt/utils/define-content-script";
import { detectOtpFields } from "~/services/field-detector";
import { promptTouchIdOrPasscode } from "~/services/biometrics";

export default defineContentScript({
  matches: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
  runAt: "document_idle",
  main() {
    let activePill: HTMLDivElement | null = null;
    let currentTargetInput: HTMLInputElement | null = null;

    function removePill() {
      if (activePill) {
        activePill.remove();
        activePill = null;
        currentTargetInput = null;
      }
    }

    function positionPill(input: HTMLInputElement, pill: HTMLDivElement) {
      const rect = input.getBoundingClientRect();
      const top = rect.bottom + window.scrollY + 6;
      const left = Math.max(8, rect.left + window.scrollX);
      pill.style.top = `${top}px`;
      pill.style.left = `${left}px`;
    }

    async function handleInputFocus(input: HTMLInputElement) {
      if (currentTargetInput === input && activePill) return;

      // Ask background if we have an account for this origin
      let matchInfo: {
        hasMatch: boolean;
        vaultLocked?: boolean;
        account?: { id: string; issuer: string; label: string };
      };

      try {
        matchInfo = await chrome.runtime.sendMessage({
          type: "keytap:check-match",
          origin: window.location.origin,
        });
      } catch {
        return;
      }

      if (!matchInfo?.hasMatch || !matchInfo.account) {
        removePill();
        return;
      }

      removePill();
      currentTargetInput = input;

      const pill = document.createElement("div");
      activePill = pill;
      pill.setAttribute("data-keytap-autofill", "true");
      pill.style.position = "absolute";
      pill.style.zIndex = "2147483647";
      pill.style.display = "flex";
      pill.style.alignItems = "center";
      pill.style.gap = "8px";
      pill.style.padding = "6px 12px";
      pill.style.backgroundColor = "#0f172a";
      pill.style.color = "#f8fafc";
      pill.style.borderRadius = "10px";
      pill.style.boxShadow = "0 4px 14px 0 rgba(0, 0, 0, 0.25)";
      pill.style.cursor = "pointer";
      pill.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      pill.style.fontSize = "12px";
      pill.style.fontWeight = "600";
      pill.style.border = "1px solid rgba(255, 255, 255, 0.15)";
      pill.style.transition = "transform 0.15s ease, opacity 0.15s ease";
      pill.style.userSelect = "none";

      const iconSpan = document.createElement("span");
      iconSpan.textContent = "🔑";
      iconSpan.style.fontSize = "13px";

      const textSpan = document.createElement("span");
      textSpan.textContent = `Fill 2FA with Keytap (${matchInfo.account.issuer || matchInfo.account.label})`;

      pill.appendChild(iconSpan);
      pill.appendChild(textSpan);

      pill.addEventListener("mouseenter", () => {
        pill.style.transform = "scale(1.02)";
        pill.style.backgroundColor = "#1e293b";
      });
      pill.addEventListener("mouseleave", () => {
        pill.style.transform = "scale(1)";
        pill.style.backgroundColor = "#0f172a";
      });

      pill.addEventListener("mousedown", (e) => {
        e.preventDefault(); // prevent input blur
      });

      pill.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        textSpan.textContent = "Touch ID / Passcode required…";
        pill.style.cursor = "wait";

        try {
          // Trigger Touch ID or system passcode authentication
          const authenticated = await promptTouchIdOrPasscode("autofill 2FA code");
          if (!authenticated) {
            textSpan.textContent = "Authentication cancelled";
            setTimeout(removePill, 1500);
            return;
          }

          textSpan.textContent = "Filling code…";

          const fillRes = await chrome.runtime.sendMessage({
            type: "keytap:fill-active-tab",
            accountId: matchInfo.account!.id,
            origin: window.location.origin,
          });

          if (fillRes?.ok) {
            textSpan.textContent = "✓ 2FA code filled!";
            pill.style.backgroundColor = "#065f46"; // emerald
            setTimeout(removePill, 1200);
          } else {
            textSpan.textContent = fillRes?.error || "Autofill failed";
            setTimeout(removePill, 2000);
          }
        } catch (err) {
          textSpan.textContent = "Authentication failed";
          setTimeout(removePill, 1500);
        }
      });

      document.body.appendChild(pill);
      positionPill(input, pill);
    }

    function checkPageInputs() {
      const detected = detectOtpFields(document);
      for (const info of detected) {
        const el = info.element;
        if (el.dataset.keytapBound) continue;
        el.dataset.keytapBound = "true";

        el.addEventListener("focus", () => void handleInputFocus(el));
        el.addEventListener("click", () => void handleInputFocus(el));

        if (document.activeElement === el) {
          void handleInputFocus(el);
        }
      }
    }

    // Initial scan and document listeners
    checkPageInputs();

    // Re-scan when inputs or forms change dynamically
    const observer = new MutationObserver(() => {
      checkPageInputs();
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Dismiss pill on click outside
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-keytap-autofill]") && target !== currentTargetInput) {
        removePill();
      }
    });

    // Reposition on scroll or resize
    window.addEventListener("scroll", () => {
      if (currentTargetInput && activePill) {
        positionPill(currentTargetInput, activePill);
      }
    }, { passive: true });

    window.addEventListener("resize", () => {
      if (currentTargetInput && activePill) {
        positionPill(currentTargetInput, activePill);
      }
    }, { passive: true });
  },
});
