#!/usr/bin/env bash
#
# install-host-macos.sh — register the Keytap native messaging host with
# Chrome on macOS.
#
# Usage:
#   ./install-host-macos.sh <EXTENSION_ID>
#
# This script:
#   1. Locates the keytap-native-host binary (release build).
#   2. Writes the native-messaging host manifest JSON to:
#        ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.keytap.nativehost.json
#   3. The manifest's `allowed_origins` is set to "chrome-extension://<EXTENSION_ID>/".
#   4. The manifest's `path` is set to the absolute path of the binary.
#
# After running, restart Chrome (or reload the extension) for it to pick up
# the new host.

set -euo pipefail

EXT_ID="${1:-}"

if [[ -z "$EXT_ID" ]]; then
  echo "usage: $0 <EXTENSION_ID>" >&2
  echo "" >&2
  echo "Find the extension ID at chrome://extensions (Developer mode)." >&2
  exit 1
fi

# Validate the extension ID — 32 lowercase letters (a-p).
if ! [[ "$EXT_ID" =~ ^[a-p]{32}$ ]]; then
  echo "error: EXTENSION_ID looks malformed: '$EXT_ID'" >&2
  echo "expected 32 lowercase letters in the range a-p." >&2
  exit 1
fi

# Locate the binary. Prefer the release build; fall back to debug.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BIN_PATH=""
for candidate in \
  "$PROJECT_ROOT/target/release/keytap-native-host" \
  "$PROJECT_ROOT/target/debug/keytap-native-host" \
  "$(command -v keytap-native-host 2>/dev/null || true)"
do
  if [[ -x "$candidate" ]]; then
    BIN_PATH="$candidate"
    break
  fi
done

if [[ -z "$BIN_PATH" ]]; then
  echo "error: keytap-native-host binary not found." >&2
  echo "build it with: cargo build --release -p keytap-native-host" >&2
  exit 1
fi

echo "[keytap] using binary: $BIN_PATH"

# Destination: Chrome's NativeMessagingHosts directory (user-level).
DEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
DEST_JSON="$DEST_DIR/com.keytap.nativehost.json"

mkdir -p "$DEST_DIR"

# Write the manifest. The host name (com.keytap.nativehost) MUST match the
# string the extension passes to chrome.runtime.connectNative.
cat > "$DEST_JSON" <<JSON
{
  "name": "com.keytap.nativehost",
  "description": "Keytap native messaging host — local-first 2FA vault",
  "path": "$BIN_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
JSON

chmod 644 "$DEST_JSON"

echo "[keytap] wrote manifest: $DEST_JSON"
echo "[keytap] allowed_origins: chrome-extension://$EXT_ID/"
echo ""
echo "Done. Restart Chrome (or reload the extension) to pick up the host."
