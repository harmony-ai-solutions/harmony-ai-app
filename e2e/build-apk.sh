#!/usr/bin/env bash
# e2e/build-apk.sh
# Helper script: build a JS-bundled dev-release APK for the Docker E2E stack.
#
# Why devRelease (not devDebug): devDebug is in `debuggableVariants`, so the
# React Native Gradle Plugin does NOT bundle JS into the APK — it expects to
# load JS from the Metro dev server at runtime. The Docker E2E stack runs no
# Metro, so a devDebug APK boots to a blank screen (or falls back to a stale
# bundled JS). devRelease is NOT in debuggableVariants, so JS gets bundled
# into the APK from current source → the E2E app runs standalone.
#
# `-PE2E_DEBUG_SIGNING=true` makes the release buildType sign with the debug
# keystore (always present, no release secrets needed) and disables ProGuard.
# See android/app/build.gradle (release buildType). Production/beta builds
# (prodRelease without this flag) are completely unaffected.
#
# Also passes HARMONY_LINK_WSS_URL + HARMONY_LINK_WS_URL via -P flags so
# gradle's buildConfigField picks them up reliably (avoids the daemon env
# caching issues with ENVFILE).
#
# Usage:
#   ./e2e/build-apk.sh
#
# Output:
#   e2e/app-debug.apk — devRelease APK, ready for `docker compose up maestro-runner`
#   (filename kept for docker-compose.yml mount compatibility; it is gitignored)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/android"

echo "Building devRelease APK (JS-bundled, debug-signed) with E2E gradle properties..."
./gradlew assembleDevRelease \
  -PE2E_DEBUG_SIGNING=true \
  -PHARMONY_LINK_WSS_URL=wss://10.0.2.2:28443 \
  -PHARMONY_LINK_WS_URL=ws://10.0.2.2:28080

echo "Copying APK to e2e/app-debug.apk..."
APK_SRC="app/build/outputs/apk/dev/release/app-dev-release.apk"
APK_DST="$REPO_ROOT/e2e/app-debug.apk"
cp "$APK_SRC" "$APK_DST"

echo "Done: $APK_DST"
