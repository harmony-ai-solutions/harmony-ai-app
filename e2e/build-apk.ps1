# e2e/build-apk.ps1
# Helper script: build a JS-bundled dev-release APK for the Docker E2E stack.
#
# Why devRelease (not devDebug): devDebug is in `debuggableVariants`, so the
# React Native Gradle Plugin does NOT bundle JS into the APK — it expects to
# load JS from the Metro dev server at runtime. The Docker E2E stack runs no
# Metro, so a devDebug APK boots to a blank screen (or falls back to a stale
# bundled JS). devRelease is NOT in debuggableVariants, so JS gets bundled
# into the APK from current source. See e2e/build-apk.sh for the full note.
#
# The -P flags also inject the E2E-only engine-peer override (plan 7-13):
# `E2E_ENGINE_PEER_WS_URL` / `E2E_ENGINE_PEER_WSS_URL` are the container
# engine's LAN endpoints (the Android emulator reaches the host at 10.0.2.2).
# They point the app's embedded engine sync client at the container engine so
# the standard device-approval handshake runs (approve with
# e2e/approve-pending-devices.sh). Override via $env:E2E_PEER_WS_URL /
# $env:E2E_PEER_WSS_URL. Pairing also needs the engine sidecar vendored into
# the APK (gradle -PENGINE_SIDECAR_*); otherwise the override is a no-op.
#
# Usage (from repo root):
#   .\e2e\build-apk.ps1
#
# Output:
#   e2e\app-debug.apk — devRelease APK, ready for `docker compose up maestro-runner`
#   (filename kept for docker-compose.yml mount compatibility; it is gitignored)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path "$PSScriptRoot\.."
Push-Location "$repoRoot\android"

$peerWs = if ($env:E2E_PEER_WS_URL) { $env:E2E_PEER_WS_URL } else { "10.0.2.2:28080" }
$peerWss = if ($env:E2E_PEER_WSS_URL) { $env:E2E_PEER_WSS_URL } else { "10.0.2.2:28443" }

try {
    Write-Host "Building devRelease APK (JS-bundled, debug-signed) with E2E gradle properties..."
    .\gradlew.bat assembleDevRelease `
      "-PE2E_DEBUG_SIGNING=true" `
      "-PE2E_ENGINE_PEER_WS_URL=$peerWs" `
      "-PE2E_ENGINE_PEER_WSS_URL=$peerWss"
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }

    Write-Host "Copying APK to e2e\app-debug.apk..."
    $apkSrc = "app\build\outputs\apk\dev\release\app-dev-release.apk"
    $apkDst = Join-Path $repoRoot "e2e\app-debug.apk"
    Copy-Item -LiteralPath $apkSrc -Destination $apkDst -Force

    Write-Host "Done: $apkDst"
}
finally {
    Pop-Location
}
