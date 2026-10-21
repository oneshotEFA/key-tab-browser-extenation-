# install-host-windows.ps1 — register the Keytap native messaging host
# with Chrome on Windows.
#
# Usage:
#   .\install-host-windows.ps1 -ExtensionId <EXTENSION_ID>
#
# This script:
#   1. Locates the keytap-native-host.exe binary (release build).
#   2. Writes the native-messaging host manifest JSON to:
#        %LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\com.keytap.nativehost.json
#   3. Also registers the host under the per-user registry key:
#        HKCU\Software\Google\Chrome\NativeMessagingHosts\com.keytap.nativehost
#      (Chrome looks at the registry on Windows, not just the JSON file.)
#   4. The manifest's `allowed_origins` is set to
#      "chrome-extension://<EXTENSION_ID>/".
#
# After running, restart Chrome (or reload the extension) for it to pick up
# the new host.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, HelpMessage = "The 32-char Chrome extension ID")]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'

# Locate the binary. Prefer release build, fall back to debug.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..\..')

$BinPath = $null
foreach ($candidate in @(
  (Join-Path $ProjectRoot 'target\release\keytap-native-host.exe'),
  (Join-Path $ProjectRoot 'target\debug\keytap-native-host.exe')
)) {
  if (Test-Path $candidate) {
    $BinPath = (Resolve-Path $candidate).Path
    break
  }
}

if (-not $BinPath) {
  $fromPath = Get-Command keytap-native-host.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    $BinPath = $fromPath.Source
  }
}

if (-not $BinPath) {
  Write-Error "keytap-native-host.exe not found. Build it with: cargo build --release -p keytap-native-host"
  exit 1
}

Write-Host "[keytap] using binary: $BinPath"

# Destination: Chrome's user-level NativeMessagingHosts directory.
$DestDir = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\NativeMessagingHosts'
$DestJson = Join-Path $DestDir 'com.keytap.nativehost.json'

if (-not (Test-Path $DestDir)) {
  New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
}

# Write the manifest. NOTE: paths in the JSON MUST use double backslashes
# (JSON escaping) on Windows.
$BinPathJson = $BinPath -replace '\\', '\\\\'
$AllowedOrigin = "chrome-extension://$ExtensionId/"

$Manifest = @"
{
  "name": "com.keytap.nativehost",
  "description": "Keytap native messaging host — local-first 2FA vault",
  "path": "$BinPathJson",
  "type": "stdio",
  "allowed_origins": [
    "$AllowedOrigin"
  ]
}
"@

Set-Content -Path $DestJson -Value $Manifest -Encoding UTF8 -NoNewline
Write-Host "[keytap] wrote manifest: $DestJson"

# Register under HKCU (no admin rights needed).
$RegKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.keytap.nativehost"
if (-not (Test-Path $RegKey)) {
  New-Item -Path $RegKey -Force | Out-Null
}
Set-ItemProperty -Path $RegKey -Name '(Default)' -Value $DestJson -Type String
Set-ItemProperty -Path $RegKey -Name 'allowed_origins' -Value @($AllowedOrigin) -Type MultiString

Write-Host "[keytap] registered registry key: $RegKey"
Write-Host "[keytap] allowed_origins: $AllowedOrigin"
Write-Host ""
Write-Host "Done. Restart Chrome (or reload the extension) to pick up the host."
