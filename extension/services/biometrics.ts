/**
 * Biometric / Device Passcode authentication using Web Authentication API.
 * Prompts Touch ID or macOS system passcode on supported devices.
 */

export async function promptTouchIdOrPasscode(reason = "authenticate with Keytap"): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    // WebAuthn not available in this environment, allow fallback
    return true;
  }

  try {
    const isAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!isAvailable) {
      // Device does not have Touch ID or Windows Hello hardware
      return true;
    }

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);

    // Calling navigator.credentials.create with userVerification: "required"
    // and authenticatorAttachment: "platform" triggers the native macOS Touch ID
    // or system password prompt dialog.
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
