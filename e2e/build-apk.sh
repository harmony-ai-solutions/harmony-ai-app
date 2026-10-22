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
# `-PE2E_ENGINE_PEER_WS_URL` / `-PE2E_ENGINE_PEER_WSS_URL` inject the container
# engine's LAN endpoints (plan 7-13). They are declared as BuildConfig fields
# ONLY for E2E builds (the `E2E_DEBUG_SIGNING` marker) and feed
# src/services/engine/e2eEngineOverride.ts, which points the app's embedded
# engine sync client at the container engine so the standard device-approval
# handshake runs (a new device registers PENDING; approve it with
# e2e/approve-pending-devices.sh). Override the defaults with E2E_PEER_WS_URL /
# E2E_PEER_WSS_URL. NOTE: pairing also requires the app to actually ship the
# engine sidecar (gradle `-PENGINE_SIDECAR_VERSION` + `-PENGINE_SIDECAR_BASE_URL`
# / `-PENGINE_SIDECAR_ARTIFACTS_DIR`); without it the override is a harmless
# no-op (no engine to configure). See e2e/README.md.
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

E2E_PEER_WS_URL="${E2E_PEER_WS_URL:-10.0.2.2:28080}"
E2E_PEER_WSS_URL="${E2E_PEER_WSS_URL:-10.0.2.2:28443}"

echo "Building devRelease APK (JS-bundled, debug-signed) with E2E gradle properties..."
./gradlew assembleDevRelease \
  -PE2E_DEBUG_SIGNING=true \
  -PE2E_ENGINE_PEER_WS_URL="$E2E_PEER_WS_URL" \
  -PE2E_ENGINE_PEER_WSS_URL="$E2E_PEER_WSS_URL"

echo "Copying APK to e2e/app-debug.apk..."
APK_SRC="app/build/outputs/apk/dev/release/app-dev-release.apk"
APK_DST="$REPO_ROOT/e2e/app-debug.apk"
cp "$APK_SRC" "$APK_DST"

echo "Done: $APK_DST"
