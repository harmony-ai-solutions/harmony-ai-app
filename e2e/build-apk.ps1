# e2e/build-apk.ps1
# Helper script: build the dev-debug APK with E2E gradle properties applied.
#
# Passes HARMONY_LINK_WSS_URL + HARMONY_LINK_WS_URL via -P flags so gradle's
# buildConfigField picks them up reliably (avoids the daemon env caching
# issues with ENVFILE).
#
# Usage (from repo root):
#   .\e2e\build-apk.ps1
#
# Output:
#   e2e\app-debug.apk — ready for `docker compose up maestro-runner`

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path "$PSScriptRoot\.."
Push-Location "$repoRoot\android"

try {
    Write-Host "Building APK with E2E gradle properties..."
    .\gradlew.bat assembleDevDebug `
      "-PHARMONY_LINK_WSS_URL=wss://10.0.2.2:28443" `
      "-PHARMONY_LINK_WS_URL=ws://10.0.2.2:28080"
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }

    Write-Host "Copying APK to e2e\app-debug.apk..."
    $apkSrc = "app\build\outputs\apk\dev\debug\app-dev-debug.apk"
    $apkDst = Join-Path $repoRoot "e2e\app-debug.apk"
    Copy-Item -LiteralPath $apkSrc -Destination $apkDst -Force

    Write-Host "Done: $apkDst"
}
finally {
    Pop-Location
}
