# Soulbits Cloud Connection Guide

The Harmony AI App supports two connection modes: **self-hosted** (direct to your own Harmony Link instance) and **cloud** (via the Soulbits Cloud backend). This guide covers the cloud mode.

## Overview

Cloud mode routes all Harmony Link WebSocket traffic through the **Soulbits conduct proxy** at `wss://connect.soulbits.app`, using a Soulbits Cloud PASETO token for authentication instead of a self-hosted device JWT.

```
┌──────────────┐     WSS (TLS)       ┌────────────────┐      WSS (pinned cert)     ┌─────────────────┐
│  App (cloud) │ ───────────────────→│ Conduct Proxy  │ ──────────────────────────→│ HL Cloud        │
│              │  Sec-WebSocket-      │ connect.       │   Encrypted internal leg   │ (per-user       │
│              │  Protocol: Bearer    │ soulbits.app   │                            │  container)     │
└──────────────┘                     └────────────────┘                            └─────────────────┘
```

## Portal Login

Before you can connect to the cloud, you need a Soulbits Cloud account. Login is available through:

| Method | Platform | Notes |
|--------|----------|-------|
| **Email + Password** | All platforms | Requires email verification |
| **Google Sign-In** | Android (WebView) | Uses Google Play Services; 409 on email conflict (link flow) |
| **Apple Sign-In** | iOS | Native `ASAuthorizationAppleIDCredential`; 409 on email conflict |

### Authentication Flow

```
Login → PASETO + refresh token received
                              ↓
Tokens stored in Keychain (com.harmonyai.cloud.auth)
                              ↓
PASETO used for all authenticated requests
                              ↓
Refresh proactively before expiry (-10 min) using TokenResponse.expires_at
```

The PASETO (`v4.local.…`) is encrypted — the App cannot decode its payload. The backend returns an `expires_at` field so the App schedules refresh proactively.

Tokens are stored in the `com.harmonyai.cloud.auth` Keychain service, independent from the self-hosted `harmony_jwt` Keychain entry. Both can coexist.

## Cloud Session Lifecycle

### Spawn

1. The user selects **Cloud Mode** (instead of self-hosted)
2. The App calls `POST /v1/session/connect` with the PASETO Bearer token
3. The session broker spawns a per-user Harmony Link container on ECS Fargate
4. The init container downloads the latest S3 snapshot
5. The sidecar publishes the HL container's IP and certificate fingerprint to Valkey
6. Response: `{session_id, proxy_endpoint, status, image_version}`
7. The App begins WebSocket upgrades to `wss://connect.soulbits.app`

> The warm pool typically has a container ready. If not, expect ~30–35s for the init container to finish. The App retries the WS upgrade with backoff.

### Connect

Cloud mode uses the same **N+1 connection model** as self-hosted:

| Connection | Path | Purpose |
|-----------|------|---------|
| Sync WS | `wss://connect.soulbits.app/ws/sync` | Data synchronisation (characters, configs, messages) |
| Entity WS | `wss://connect.soulbits.app/ws/worker` | Real-time chat sessions (one per active AI character) |

**WebSocket authentication** uses the `Sec-WebSocket-Protocol` header:

```
Sec-WebSocket-Protocol: Bearer.<paseto>
```

This is the 4th connection mode (`cloud`) — a new `CloudWebSocketConnection` implementation that authenticates via the PASETO subprotocol instead of the `Authorization` header (which cannot survive a WebSocket upgrade handshake).

### Disconnect

- On app background: `POST /v1/session/disconnect` triggers a 5-minute grace period
- The HL container takes a snapshot to S3 and enters a suspended state
- On foreground: reconnect via the existing WS resume mechanism (session is preserved)
- On logout: the session is terminated and the PASETO is invalidated via Valkey cutoff

## Roaming Sync (Tier 1)

The App is the roaming source of truth between self-hosted and cloud Harmony Link instances. **One active source at a time** — the user switches via the mode toggle.

### How it Works

- **Per-source lastSync**: The sync timestamp is tracked per source (self-hosted or cloud)
- **Switch warning**: Changing sources shows an alert explaining the impact
- **Standard upsert-by-PK**: All configuration tables use UUID primary keys, so sync is standard upsert-by-PK
- **Incremental**: Only records changed since `lastSync` are transferred

### Provider Configurations

The `soulbitscloud` provider configuration roams like any other config table — it uses a UUID primary key and is synced via standard upsert-by-PK.

## Switching Between Modes

1. Go to **Settings** → **Connection Setup**
2. Toggle between **Self-Hosted** and **Cloud** mode
3. Confirm the switch warning (current session data will be managed per-source)
4. If switching to cloud and not logged in, the login screen appears
5. If switching to self-hosted, enter your HL connection details

## Keychain Storage

| Credential | Keychain Service | Notes |
|-----------|-----------------|-------|
| Cloud PASETO | `com.harmonyai.cloud.auth` | Independent from self-hosted JWT |
| Self-hosted HL JWT | `harmony_jwt` | Unchanged from existing pairing flow |

## Build Flavours

Cloud host selection depends on the build flavour:

- **Android `dev` flavour**: Targets `beta.cloud.soulbits.app` (co-installable with prod via `.dev` applicationId suffix)
- **Android `prod` flavour**: Targets `cloud.soulbits.app`
- **iOS**: Dev/prod distinguished by the CI build matrix — `build-release.yml` regenerates `.env` and overrides `PRODUCT_BUNDLE_IDENTIFIER` (dev → `ai.soulbits.chat.dev`)

## Apple Sign-In on iOS

> Apple Sign-In (`ASAuthorizationAppleIDCredential`) requires a **signed build** with the SIWA entitlement. On unsigned sideload IPAs, Apple Sign-In is not available — use email/password or Google Sign-In instead.

## Session Disconnect on Background

When the App moves to the background, `POST /v1/session/disconnect` is called to initiate the 5-minute grace period. This allows the HL container to take a snapshot and reduces costs when the user is not actively interacting. On foreground, the existing session-resume flow reconnects seamlessly.

---

**See Also:**
- [Harmony Link Integration](HARMONY-LINK-INTEGRATION.md) — full integration architecture
- [Connection Security](CONNECTION-SECURITY.md) — security modes for self-hosted connections
