#!/usr/bin/env bash
# e2e/build-apk.sh
# Helper script: build the dev-debug APK with E2E gradle properties applied.
#
# Passes HARMONY_LINK_WSS_URL + HARMONY_LINK_WS_URL via -P flags so gradle's
# buildConfigField picks them up reliably (avoids the daemon env caching
# issues with ENVFILE).
#
# Usage:
#   ./e2e/build-apk.sh
#
# Output:
#   e2e/app-debug.apk — ready for `docker compose up maestro-runner`

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/android"

echo "Building APK with E2E gradle properties..."
./gradlew assembleDevDebug \
  -PHARMONY_LINK_WSS_URL=wss://10.0.2.2:28443 \
  -PHARMONY_LINK_WS_URL=ws://10.0.2.2:28080

echo "Copying APK to e2e/app-debug.apk..."
APK_SRC="app/build/outputs/apk/dev/debug/app-dev-debug.apk"
APK_DST="$REPO_ROOT/e2e/app-debug.apk"
cp "$APK_SRC" "$APK_DST"

echo "Done: $APK_DST"
