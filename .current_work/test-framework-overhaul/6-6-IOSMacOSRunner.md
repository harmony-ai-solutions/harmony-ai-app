# Phase 6-6: iOS E2E via macOS GitHub Actions Runner

## Objective

Establish iOS E2E coverage by running Maestro against the iOS Simulator on a **macOS GitHub Actions runner**. No cloud device service, no vendor dependency. The same Maestro YAML flows written for Android in Phase 6-5 are reused for iOS with minimal adjustment.

## Context

The Android E2E stack (Phases 6-1 through 6-5) cannot be replicated for iOS:

- iOS Simulator is a macOS binary depending on XNU kernel, Metal, SpringBoard — none of which exist in a Linux Docker container
- Apple's EULA prohibits running iOS Simulator on non-Apple hardware
- macOS GitHub Actions hosted runners are real Apple hardware (Mac mini/M1/M2), so this is fully licensed

This is the simplest credible iOS E2E strategy for a small team that already pays for GitHub Actions. No additional SaaS spend, no vendor lock-in, no TestingBot/Maestro Cloud accounts to manage.

**Cost model**: GitHub Actions `macos-latest` runners bill at ~$0.08/min (8× the Linux rate). A 10-minute iOS E2E run costs ~$0.80. Across 30 nightly runs + a handful of manual dispatches, that's roughly $25–35/month — comparable to TestingBot's cheapest tier but without the recurring vendor relationship.

## Prerequisites

- Phase 6-5 complete (Maestro flows exist; the same YAML works for both platforms).
- An iOS build pipeline that produces a `.app` bundle for the simulator (verify by reading existing `.github/workflows/build-release.yml` — the iOS job already runs `xcodebuild` for Release; we need a Debug-for-Simulator variant).
- Repository on a GitHub plan that includes macOS runner minutes (any paid plan, or free tier with limited monthly minutes).

## Implementation Steps

### 1. Add an npm script to build the iOS Simulator `.app`

In `package.json`:

```json
{
  "scripts": {
    "build:ios:simulator": "cd ios && xcodebuild -workspace HarmonyAIChat.xcworkspace -scheme HarmonyAIChat -configuration Debug -sdk iphonesimulator -derivedDataPath build -destination 'generic/platform=iOS Simulator' && cd build/Build/Products/Debug-iphonesimulator && zip -r HarmonyAIChat.app.zip HarmonyAIChat.app"
  }
}
```

The output is `ios/build/Build/Products/Debug-iphonesimulator/HarmonyAIChat.app.zip`. The zip step is for portability (the `.app` is a directory).

### 2. Create an `.env.e2e.ios` for build-time config

Same pattern as Android (Phase 6-4):

```bash
# e2e/.env.e2e.ios
# The iOS Simulator maps host's localhost to 127.0.0.1 directly.
# Since Harmony Link will run as a sibling process on the macOS runner
# (not in Docker, since we don't need containerization on macOS),
# the app can reach it via simple localhost.
HARMONY_LINK_WSS_URL=wss://localhost:9443
IS_BETA=true
```

Build with this env:

```bash
ENVFILE=.env.e2e.ios npm run build:ios:simulator
```

### 3. Create the iOS E2E workflow

`.github/workflows/e2e-ios.yml`:

```yaml
name: E2E (iOS, macOS runner)

on:
  schedule:
    # Nightly at 04:00 UTC (after Android at 03:00)
    - cron: '0 4 * * *'
  workflow_dispatch:
  pull_request:
    paths:
      - 'e2e/.maestro/**'
      - '.github/workflows/e2e-ios.yml'
      - 'ios/**'

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  e2e-ios:
    name: iOS E2E (Maestro on macOS runner)
    runs-on: macos-15
    timeout-minutes: 30
    steps:
      - name: Checkout RN app
        uses: actions/checkout@v4

      - name: Checkout Harmony Link (Go)
        uses: actions/checkout@v4
        with:
          repository: harmony-ai-solutions/harmony-link-private
          token: ${{ secrets.HARMONY_LINK_REPO_PAT }}
          path: harmony-link
          ref: main

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - name: Install RN dependencies
        run: npm ci

      - name: Install CocoaPods
        working-directory: ios
        run: pod install

      - name: Build iOS Simulator app (with E2E env)
        env:
          ENVFILE: .env.e2e.ios
        run: npm run build:ios:simulator

      - name: Build Harmony Link binary (macOS native)
        working-directory: harmony-link
        run: |
          # Cross-compile for macOS — Go supports this natively.
          # No Docker needed on macOS runner; just build the binary.
          go build -o /tmp/harmony-link ./cmd/harmony-link

      - name: Generate self-signed cert
        run: |
          mkdir -p /tmp/certs
          # Generate CA
          openssl genrsa -out /tmp/certs/ca-key.pem 2048
          openssl req -new -x509 -key /tmp/certs/ca-key.pem \
            -out /tmp/certs/ca.pem -days 1 \
            -subj "/CN=Harmony Link E2E CA"
          # Generate server cert
          openssl genrsa -out /tmp/certs/server-key.pem 2048
          openssl req -new -key /tmp/certs/server-key.pem \
            -out /tmp/certs/server.csr -subj "/CN=localhost"
          cat > /tmp/certs/server.ext <<EOF
          subjectAltName = DNS:localhost, IP:127.0.0.1
          extendedKeyUsage = serverAuth
          EOF
          openssl x509 -req -in /tmp/certs/server.csr \
            -CA /tmp/certs/ca.pem -CAkey /tmp/certs/ca-key.pem \
            -CAcreateserial -out /tmp/certs/server.pem -days 1 \
            -extfile /tmp/certs/server.ext

      - name: Start Harmony Link
        env:
          TLS_CERT: /tmp/certs/server.pem
          TLS_KEY: /tmp/certs/server-key.pem
          WSS_PORT: '9443'
          LOG_LEVEL: debug
        run: |
          /tmp/harmony-link serve &
          # Wait for healthcheck
          for i in $(seq 1 30); do
            curl -k -s https://localhost:9443/health && echo " → healthy" && break
            echo "Waiting for Harmony Link ($i/30)..."
            sleep 2
          done

      - name: Install Maestro CLI
        run: curl -Ls "https://get.maestro.mobile.dev" | bash

      - name: Boot iOS Simulator and install app
        run: |
          # Boot a simulator (iPhone 15 on iOS 17 — adjust as available on runner)
          xcrun simctl boot "iPhone 15" || true
          xcrun simctl bootstatus "iPhone 15"
          # Install the .app bundle
          unzip -o ios/build/Build/Products/Debug-iphonesimulator/HarmonyAIChat.app.zip -d /tmp/
          xcrun simctl install booted /tmp/HarmonyAIChat.app

      - name: Run Maestro flows
        env:
          PATH: ${{ env.PATH }}:${{ runner.home }}/.maestro/bin
        run: |
          maestro test e2e/.maestro --format junit --output e2e/reports/ios/

      - name: Collect reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-ios-reports
          path: e2e/reports/ios/

      - name: Capture simulator logs on failure
        if: failure()
        run: |
          xcrun simctl spawn booted log show --last 5m > simulator.log 2>&1 || true

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-ios-logs
          path: simulator.log

      - name: Shutdown simulator
        if: always()
        run: xcrun simctl shutdown all || true
```

### 4. Adapt the Maestro flows for iOS

The Phase 6-5 YAML flows are mostly cross-platform. Two adjustments:

- **`appId` may differ**: Android uses `ai.soulbits.chat.dev`; iOS uses the bundle identifier (verify — may be the same string, since `react-native.config.js` and Xcode settings often align).
- **Selector robustness**: prefer `text:` selectors over `id:` for cross-platform compatibility. Where `id:` is used, verify the testID exists on both platforms.

Add a `platform:` filter if a step is platform-specific:

```yaml
# Example: a step that only runs on iOS
- runFlow:
    when:
      platform: iOS
    commands:
      - tapOn: "iOS-only button"
```

### 5. Validate locally (if a Mac is available)

If you (or a teammate) have a Mac, validate the workflow's core steps locally before pushing:

```bash
# 1. Build the iOS Simulator .app
ENVFILE=.env.e2e.ios npm run build:ios:simulator

# 2. Boot a simulator
xcrun simctl boot "iPhone 15"
xcrun simctl bootstatus "iPhone 15"

# 3. Install the .app
unzip ios/build/Build/Products/Debug-iphonesimulator/HarmonyAIChat.app.zip -d /tmp/
xcrun simctl install booted /tmp/HarmonyAIChat.app

# 4. Install Maestro CLI
curl -Ls "https://get.maestro.mobile.dev" | bash
export PATH="$PATH:$HOME/.maestro/bin"

# 5. Start Harmony Link locally (or via Docker)
# ... (assume it's running on localhost:9443)

# 6. Run a single flow
maestro test e2e/.maestro/01-smoke-boot.yaml
```

If the smoke flow passes locally, the GitHub Actions run has a high probability of working.

### 6. Run the workflow manually for the first time

Trigger via GitHub Actions UI → "Run workflow". Watch the live logs. The first run will likely surface one or two issues — common culprits:

- **Simulator name wrong**: the runner's available simulators differ from your local Xcode install. Run `xcrun simctl list devices available` on the runner first to discover names.
- **App bundle path mismatch**: verify the build output path matches the install command.
- **Maestro can't find flows**: paths are relative to the workflow's working directory.
- **Harmony Link didn't start in time**: bump the healthcheck retry count.

### 7. Document the iOS strategy in `e2e/README.md`

```markdown
## iOS E2E

iOS Simulator cannot run in Docker (Apple EULA + technical reasons).
We run iOS E2E on a macOS GitHub Actions runner.

### Cost
~$0.08/min for `macos-latest` runner. A 10-minute run costs ~$0.80.
30 nightly runs + ~5 manual dispatches ≈ $25-35/month.

### Schedule
- Nightly at 04:00 UTC (after Android at 03:00)
- Manual dispatch
- On PRs that touch `e2e/.maestro/**` or `ios/**`

### Reusing Android flows
The same `e2e/.maestro/*.yaml` flows work for both platforms.
Prefer `text:` selectors over `id:` for cross-platform compatibility.
Use Maestro's `platform:` filter for platform-specific steps.
```

## Files to Create

- `e2e/.env.e2e.ios` — iOS E2E env file
- `.github/workflows/e2e-ios.yml` — the macOS runner workflow

## Files to Modify

- `package.json` — add `build:ios:simulator` script
- `e2e/README.md` — document iOS strategy

## Validation

- [ ] `npm run build:ios:simulator` produces a valid `.app.zip`
- [ ] `.env.e2e.ios` is correctly picked up by `react-native-config` at build time
- [ ] The macOS runner workflow runs to completion on manual dispatch
- [ ] At least the smoke flow (`01-smoke-boot.yaml`) passes on iOS Simulator
- [ ] Harmony Link starts and responds to `/health` on the runner
- [ ] App successfully connects to Harmony Link via WSS with the self-signed cert
- [ ] Reports artifact contains JUnit XML
- [ ] On failure, simulator logs are captured and uploaded

## Open Questions to Resolve During Implementation

- **Which iPhone Simulator is available on `macos-15` runner?** Run `xcrun simctl list devices available` on the runner to discover. Update the `xcrun simctl boot` line accordingly.
- **Does `react-native-websocket-self-signed` behave the same on iOS as Android?** iOS uses `NSURLSession` for WebSockets, which has different self-signed cert behavior than Android's OkHttp. Verify the library handles both.
- **Should Harmony Link run as a native Go binary or in Docker on the macOS runner?** Native binary is simpler (no Docker overhead). Docker is also available on macOS runners if you prefer consistency with the Android stack. Pick one and document.
- **Can the same `e2e/.maestro/*.yaml` flows be used unchanged?** Verify by running the Android flows against iOS. Adjust selectors as needed.

## Risk

iOS-specific behaviors may surface bugs that don't appear on Android. The first iOS E2E run will likely reveal something — budget time for triage.

Common iOS-specific issues:
- Status bar / safe area rendering differences (text selectors may need to scroll)
- Keyboard dismissal behavior differs (may need explicit tap-outside-keyboard steps)
- Animation timing differs (may need longer `waitFor` timeouts)
- Network ATS (App Transport Security) may block self-signed certs even with `react-native-websocket-self-signed` — verify

## Estimated Effort

Two to three days. Most of the time is the first workflow run debugging (simulator selection, cert handling, Maestro flow tuning).

## Alternative: Skip iOS E2E Entirely

If iOS users are a small fraction of the user base or iOS churn is low, it's defensible to skip iOS E2E for now and rely on:

- Manual iOS smoke testing before each release
- Cross-platform unit and integration tests (Phases 3, 4) that cover iOS-relevant logic
- A Phase 8-2 backlog item: "Add iOS E2E when justified by user metrics"

Document this decision explicitly if taken — it should be a conscious choice, not an oversight.
