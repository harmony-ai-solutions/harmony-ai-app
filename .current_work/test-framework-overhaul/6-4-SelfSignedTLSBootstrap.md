# Phase 6-4: Self-Signed TLS Bootstrap

## Objective

Establish how the RN app, running inside the Android emulator during E2E tests, establishes trust with the self-signed WSS server (the `harmony-link` Go backend). This is the trickiest single piece of the E2E setup because React Native's WebSocket implementation does not respect Node.js-style `rejectUnauthorized: false`.

## Context

In production, the app uses `react-native-websocket-self-signed` to bypass certificate validation entirely. For E2E, we have two options:

1. **Keep using `react-native-websocket-self-signed`** — simplest, app code unchanged. But this means the E2E test isn't exercising the real TLS trust path (it's bypassed entirely).
2. **Configure the app to trust the E2E CA explicitly** — more faithful to a real TLS handshake. Requires either pushing the CA into the Android user cert store or including it in the app's `network_security_config.xml`.

For Phase 6, **start with option 1** (just make it work). Phase 8 backlog can add option 2 as a hardening step.

The `react-native-websocket-self-signed` library is already in the app's dependencies, so no production code change is needed — it just works against any self-signed server.

The remaining work is mostly about coordinating cert generation (in the `harmony-link` container) with the cert persistence (in the volume mounted across all services).

## Prerequisites

- Phase 6-2 complete (Harmony Link container generates certs at startup).
- Phase 6-3 complete (emulator service is up).
- Confirm `react-native-websocket-self-signed` is actually used in production code (it is — `src/services/connection/ConnectionManager.ts` likely imports it).

## Implementation Steps

### 1. Verify current TLS handling in the app

Read `src/services/connection/ConnectionManager.ts`. Confirm:

- The WebSocket constructor is `react-native-websocket-self-signed`'s default export
- The WSS URL is configurable (env var, build config, or runtime setting)
- There's no certificate-pinning logic that would reject the E2E-generated cert

Document the current behavior in `.current_work/test-framework-overhaul/tls-current-state.md`.

### 2. Make the WSS URL configurable

For E2E, the app needs to connect to `wss://harmony-link:28443` (the Docker Compose hostname) instead of whatever production URL it defaults to. Two approaches:

**Option A: Build-time configuration via `react-native-config`**

The app already depends on `react-native-config`. Add an `.env.e2e` file:

```bash
# .env.e2e
HARMONY_LINK_WSS_URL=wss://harmony-link:28443
IS_BETA=true
```

Then build a special E2E variant of the APK:

```bash
# Build the APK with E2E env
ENVFILE=.env.e2e cd android && ./gradlew assembleDevDebug
```

**Option B: Runtime configuration via launch arguments**

Use `react-native-launch-arguments` to pass the WSS URL at app start. Maestro's `launchApp` step can pass arguments:

```yaml
# In a Maestro flow
- launchApp:
    appId: ai.soulbits.chat.dev
    arguments:
      HARMONY_LINK_WSS_URL: wss://harmony-link:28443
```

And the app reads them on startup:

```typescript
// App.tsx or a bootstrap module
import LaunchArguments from 'react-native-launch-arguments';
const launchArgs = LaunchArguments.value();
const wssUrl = launchArgs.HARMONY_LINK_WSS_URL || Config.HARMONY_LINK_WSS_URL_DEFAULT;
```

**Recommendation**: Option A is simpler (no extra dep) but requires a special APK build. Option B is more flexible (same APK works against any URL) but adds a dependency.

Start with Option A for Phase 6.

### 3. Decide on the cert handling approach

For Phase 6 (make it work):

- Keep `react-native-websocket-self-signed` as the WebSocket implementation
- The E2E build's WSS URL points at `wss://harmony-link:28443`
- The Go backend serves a self-signed cert generated at startup
- The app accepts it (because `react-native-websocket-self-signed` bypasses validation)
- No CA pushing, no `network_security_config.xml` changes needed

This is documented as a known simplification — the test doesn't validate TLS hardening.

### 4. Plan the Phase 8 hardening (deferred)

For the future, document what "proper" cert trust would look like:

```xml
<!-- android/app/src/main/res/xml/network_security_config.xml -->
<network-security-config>
    <domain-config cleartext-traffic-permitted="false">
        <domain includeSubdomains="true">harmony-link</domain>
        <trust-anchors>
            <certificates src="user"/>           <!-- Trust user-installed CAs -->
            <certificates src="system"/>
        </trust-anchors>
    </domain-config>
</network-security-config>
```

Then push the CA into the emulator before running tests:

```bash
# In the maestro-runner container's command, before maestro test:
adb root
adb remount
adb push /certs/ca.pem /data/misc/user/0/certs/ca.pem
adb shell am start -a android.intent.action.VIEW -d "file:///data/misc/user/0/certs/ca.pem" -t "application/x-x509-ca-cert"
# (User has to confirm the install dialog — for E2E, use a different approach: install via settings or skip user cert)
```

Actually, the simplest "proper" approach is to bundle the E2E CA into the debug APK as a system-trusted CA via build-time resources. This avoids the install dialog but requires rebuilding the APK whenever the CA changes (which is per-container-startup in our design).

Given the complexity, defer this entirely. Use the `react-native-websocket-self-signed` bypass for Phase 6.

### 5. Handle DNS resolution inside the emulator

The Android emulator runs in its own container, but the app *inside* the emulator needs to resolve `harmony-link` (the Docker Compose hostname). The emulator's network is bridged to the container's network, so DNS resolution depends on how the emulator is configured.

Two paths:

**Path A: Use the host's IP, not the hostname**

```bash
HARMONY_LINK_WSS_URL=wss://host.docker.internal:28443
```

The emulator's app can reach the host (which is the Docker Desktop / Linux host) via `host.docker.internal`. The `harmony-link` service exposes port 28443 on the host (`ports: ["28443:28443"]` in compose), so this works.

Caveat: `host.docker.internal` is available inside Docker containers, but **not** inside an Android emulator running inside a Docker container. The emulator's view of the network is different from the container's.

**Path B: Use the emulator's special IP for the host**

The Android emulator maps `10.0.2.2` to the host (this is a long-standing convention). So:

```bash
HARMONY_LINK_WSS_URL=wss://10.0.2.2:28443
```

This is the recommended approach for emulator-to-host communication.

**Path C: Run the emulator with `-netdesk/bridged` and use Docker DNS**

More complex. Stick with Path B.

**Recommendation**: Use `10.0.2.2:28443` for the E2E WSS URL.

### 6. Configure `.env.e2e` accordingly

```bash
# e2e/app.env.e2e (or wherever react-native-config looks)
HARMONY_LINK_WSS_URL=wss://10.0.2.2:28443
IS_BETA=true
```

### 7. Test the connection

After the E2E stack is up, run a minimal Maestro flow that:

1. Launches the app
2. Waits for the "Connected to Harmony Link" toast (visible if the existing UI shows it)
3. Asserts the connection indicator shows "Connected"

If this passes, TLS bootstrap is working.

## Files to Create

- `e2e/app.env.e2e` — react-native-config env file for the E2E build
- `.current_work/test-framework-overhaul/tls-current-state.md` — documentation

## Files to Modify

- `package.json` (potentially) — add a `build:e2e` script: `ENVFILE=.env.e2e cd android && ./gradlew assembleDevDebug`

## Validation

- [ ] `.env.e2e` sets `HARMONY_LINK_WSS_URL=wss://10.0.2.2:28443`
- [ ] Building the APK with the E2E env produces an APK that defaults to that URL
- [ ] A minimal Maestro flow that boots the app and waits for "Connected" passes
- [ ] `react-native-websocket-self-signed` accepts the E2E-generated cert without error
- [ ] Phase 8 backlog item added for "proper" CA-based trust (no bypass)

## Open Questions to Resolve During Implementation

- **Is `10.0.2.2` reliably available inside `budtmo/docker-android`?** The emulator inside Docker should follow the same convention as a regular emulator, but verify. Run `adb shell ping -c 1 10.0.2.2` inside the booted emulator.
- **Does `react-native-config` support `.env.e2e` via `ENVFILE`?** Confirm the syntax. Some versions require `ENVFILE=.env.e2e` as a prefix on the gradle command.
- **Are there other env vars the app expects at build time?** (See `.env.example`.) Replicate them in `.env.e2e`.

## Risk

The TLS bootstrap is the most likely place for the E2E stack to silently fail. The app may "work" but never actually connect — and if the existing UI doesn't show a clear connection indicator, the failure is invisible.

Mitigation: as the first Maestro flow (Phase 6-5), write a "smoke" flow that ONLY verifies the app boots and reaches the connection screen. If connection isn't established within 30s, fail loudly.

## Estimated Effort

Half a day to one day. Most of the time is iterating on the cert trust path until something works.
