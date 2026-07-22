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
# Also passes HARMONY_LINK_WSS_URL + HARMONY_LINK_WS_URL via -P flags so
# gradle's buildConfigField picks them up reliably (avoids the daemon env
# caching issues with ENVFILE).
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

try {
    Write-Host "Building devRelease APK (JS-bundled, debug-signed) with E2E gradle properties..."
    .\gradlew.bat assembleDevRelease `
      "-PE2E_DEBUG_SIGNING=true" `
      "-PHARMONY_LINK_WSS_URL=wss://10.0.2.2:28443" `
      "-PHARMONY_LINK_WS_URL=ws://10.0.2.2:28080"
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
