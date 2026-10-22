/**
 * Biometric / Device Passcode authentication using Web Authentication API.
 * Prompts Touch ID or macOS system passcode on supported devices.
 */

export async function isBiometricsAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function promptTouchIdOrPasscode(reason = "authenticate with Keytap"): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return true;
  }

  try {
    const isAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!isAvailable) {
      return true;
    }

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Keytap 2FA Autofill" },
        user: {
          id: userId,
          name: "keytap-user",
          displayName: "Keytap User",
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" }, // ES256
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
        },
        timeout: 60000,
      },
    });

    return !!credential;
  } catch (err) {
    console.warn(`[keytap:biometrics] verification failed or cancelled for ${reason}:`, err);
    return false;
  }
}

export async function getSavedBiometricPassphrase(): Promise<string | null> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("keytap:biometric_passphrase");
      return (stored["keytap:biometric_passphrase"] as string) || null;
    }
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("keytap:biometric_passphrase");
    }
  } catch {
    // ignore
  }
  return null;
}

export async function saveBiometricPassphrase(passphrase: string): Promise<void> {
  const trimmed = passphrase.trim();
  if (!trimmed) return;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ "keytap:biometric_passphrase": trimmed });
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("keytap:biometric_passphrase", trimmed);
    }
  } catch {
    // ignore
  }
}

export async function clearBiometricPassphrase(): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.remove("keytap:biometric_passphrase");
    }
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("keytap:biometric_passphrase");
    }
  } catch {
    // ignore
  }
}
