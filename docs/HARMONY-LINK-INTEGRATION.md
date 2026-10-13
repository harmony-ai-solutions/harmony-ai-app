# Soulbits Engine Integration — Overview

This document describes how the Harmony AI App integrates with **Soulbits Engine**.
As of the app-engine-parity work, the app does **not** talk to a remote engine
as a client of a rows-v1 sync protocol. Instead it runs the Soulbits Engine
embedded on the device and is a thin client of that engine.

> Superseded model: the older "mobile Events-API client with an app-side TS
> SQLite replica + rows-v1 sync + cloud-hosted sessions" architecture was deleted
> (app 3-4; cloud 6-1/6-2). Its diagrams are archived under
> [`docs/history/harmony-link-diagrams/`](history/harmony-link-diagrams/RETIRED.md).

## The model at a glance

| Relationship | Mechanism |
|---|---|
| App (JS) ↔ embedded engine | Management REST + event WebSocket over `127.0.0.1` |
| Embedded engine ↔ desktop engine | changeset-v1 sync over WS (engine-side; desktop is the write authority) |
| Embedded engine ↔ cloud | inference API (injected provider configs) + account/W1 key escrow + user-owned-storage backup — **no cloud engine peer, no readable user data** |
| Cloud ↔ lifecycle | **data-blind**: hourly iOS keepalive cron + device-initiated visible-push relay |

There is **one database** — the engine's, on the device. The app keeps no schema,
runs no migrations, and no longer ships a SQLite replica.

## 1. The embedded engine

The engine runs on the device in one of two placements, unified behind a single
`EngineHost` abstraction (`src/services/engine/EngineHost.ts`):

- **Android — sidecar process** (`SidecarEngineHost`): the app ships the engine
  as `libengine.so` in `jniLibs` and execs it from `nativeLibraryDir` as a typed
  foreground service (task 1-2). It prints a machine-readable `ENGINE_READY`
  handshake with the loopback ports + a per-process loopback token.
- **iOS — in-process** (`EmbeddedEngineHost`): the app links the gomobile facade
  `SoulbitsEngine.xcframework` and runs the engine inside the app process (task
  4-1/4-2). iOS is a **foreground tier**: `EngineLifecycle` starts the engine on
  foreground and stops it on background after a short grace window.

Both placements yield the same `{wsPort, wssPort, adminPort, token}` readiness,
so everything downstream is platform-agnostic. `EngineService` routes through the
selected host.

**Data access.** Every read and write goes over the engine's **management REST
API** on loopback (the same API the desktop Wails frontend uses) — see
[engine-contract-gates.md](engine-contract-gates.md) for the endpoint manifest
and contract-version pin. Real-time updates arrive over the engine's **event
WebSocket**. Auth to the app-facing `/api` surface is the per-process loopback
token (`X-Loopback-Token`) — the app never embeds the fixed admin key.

**DB-key custody.** The engine's database is encrypted at rest. Android passes
the key to the sidecar via the `SE_DB_KEY` environment variable; iOS provisions a
256-bit key into the device Keychain (`EngineDbKey`) and hands it to the facade.

## 2. Engine ↔ desktop pairing (changeset sync)

Multi-device sync is **engine↔engine**, not app↔remote. The on-device engine
speaks **changeset-v1** to a desktop Soulbits Engine over the LAN:

- SQLite's **session extension** records logical changesets; the desktop is the
  single write authority and the phone **yields** and buffers its writes into a
  pending epoch, forwarding them on (re)connect (buffer-and-forward).
- Authority is arbitrated by **epochs**; a peer whose continuity is broken is
  served a **baseline snapshot + fresh epoch** (rejoin).
- Pairing reuses the engine's device-approval **handshake** and its three TLS
  security modes (`secure` / `insecure-ssl` / `unencrypted`).

The app **does not implement the protocol**. It drives the engine's sync-client
REST surface through the **`DesktopSyncScreen`**
(`src/screens/settings/DesktopSyncScreen.tsx`): live reconfigure, status, and
authority hand-over. The full wire spec lives in the engine repo's
`docs/Changeset-Sync.md`; the client role is the engine's `syncclient` package.

## 3. Cloud account

Signing in with a **SoulbitsCloud** account does **not** provision a cloud
Soulbits Engine. Instead:

- **Inference** — the account's PASETO is injected as the credential on the
  `soulbitscloud` provider configs; the engine calls the inference API directly.
- **Backup** — **user-owned storage**: the engine produces an encrypted snapshot
  (DB + RAG + media) and uploads it to the user's own iCloud / WebDAV / Dropbox /
  OneDrive / local folder. The account holds only a **W1 escrow** of the wrapped
  backup key. The operator stores **no readable user database data**.
- **Lifecycle** — the cloud is **data-blind**. On iOS the engine advances via
  Apple's wake rules: a best-effort hourly keepalive silent ping plus an overnight
  `BGProcessingTask`, both processing batches **on-device**
  (`IOSLifecycleWakeHandler` / `IOSMaintenanceScheduler`). The cloud only nudges
  the device and relays device-authored visible notifications
  (`PushRelayClient` → `POST /v1/lifecycle/notify`).

The retired cloud engine peer (broker, conduct proxy, per-user containers, S3
snapshot plane) is gone — see the cloud repo's memory bank / CHANGELOG.

## 4. Real-time chat

Chat runs against the **embedded engine's** event WebSocket (and, for iOS, the
facade's event callback). The app's `EntitySessionService` manages interaction
sessions and sends/receives the same event vocabulary:

- **Sessions**: `INIT_ENTITY`, `ENTITY_SESSION_END`
- **Messages**: `ENTITY_UTTERANCE`
- **Speech**: `STT_INPUT_AUDIO`, `STT_OUTPUT_TEXT`
- **Indicators**: `TYPING_INDICATOR`, `RECORDING_INDICATOR`
- **Heartbeat**: `CONNECTION_PING` / `CONNECTION_PONG`

The engine authors the data; the app renders **optimistic pending rows** for its
own outgoing messages (no app-authored ids, no SQLite mirror) and reconciles
against engine reads.

## 5. Connection security modes

The engine↔engine (LAN) transport supports three modes, selected per pairing:

- **secure** — TLS with certificate validation
- **insecure-ssl** — TLS without validation (self-signed peer certs)
- **unencrypted** — plain WebSocket (LAN only; sensitive data does not cross it
  during pairing)

The app↔engine leg is always **loopback** (`127.0.0.1`), authenticated by the
per-process loopback token. See [CONNECTION-SECURITY.md](CONNECTION-SECURITY.md).

## Implementation status

**Fully implemented:** embedded engine host (Android sidecar + iOS in-process),
loopback management-API data layer (repository seam fully API-backed),
engine-required sequencing, DB-key custody, changeset-sync desktop configuration
screen, cloud-account inference injection + W1 escrow, user-owned-storage backup
& restore, iOS blind-tick lifecycle + push relay, notification authorization.

**Owner gates (device/build):** XCFramework/AAR builds, on-device smoke, LAN
pairing smoke, iOS wake/overnight observation.

## File map

```
src/services/engine/
├── EngineHost.ts            # EngineHost interface (+ readiness shape)
├── SidecarEngineHost.ts     # Android: exec libengine.so child process
├── EmbeddedEngineHost.ts    # iOS: in-process gomobile facade
├── EngineService.ts         # host selection + lifecycle orchestration
├── EngineLifecycle.ts       # AppState foreground-tier start/stop
├── EngineDbKey.ts           # at-rest key custody (Keychain)
├── EngineApiClient.ts       # loopback management REST client
├── engineContract.ts        # ENGINE_CONTRACT_VERSION + endpoint manifest
├── IOSLifecycleWakeHandler.ts / IOSMaintenanceScheduler.ts / PushRelayClient.ts
src/services/backup/         # BackupOrchestrator + targets
src/screens/settings/DesktopSyncScreen.tsx   # engine sync-client control
```

## References

- [Engine-contract gates](engine-contract-gates.md) — the app↔engine coupling
  contract (version pin, wire fixtures, endpoint manifest, loopback smoke)
- [Entity interaction model](entity-interaction-model.md)
- Engine repo: `docs/Changeset-Sync.md`, `docs/Sidecar-Deployment.md`,
  `docs/Embed-Facade.md`, `docs/Backup.md`
- [Connection security modes](CONNECTION-SECURITY.md)

---

**Last Updated**: October 2026
