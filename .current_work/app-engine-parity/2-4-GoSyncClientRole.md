# Phase 2-4 — Engine: Go Sync Client Role (dial-out)

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §7.4.2 (engines have only ever served sync — the gap), §12.3
> **Depends on:** 2-3
> **Codebase mapping consulted:** `.planning/codebase/` (engine — harmony-link-private): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

Give the engine a **client** half: dial a peer engine (desktop over LAN/TLS — the only engine-peer pairing; there is **no cloud engine peer** per the 2026-10-11 ruling, and the conduct-proxy is deleted in 6-1), authenticate, and participate in the changeset protocol from the non-authority side. Required because the embedded engine — not the app's TS code — now performs sync.

## Design

- NEW `syncclient/` package (engine): connection lifecycle (dial wss/ws with the engine's existing TLS security modes: secure / insecure-SSL / unencrypted-local), reconnect with backoff, event pump shared with the eventserver client patterns.
- Handshake: same negotiation as 2-3 from the dialing side — the engine's existing device-approval/pairing auth (the same model the app's WS connections use today against the desktop engine); identity = engine instance id + dataset id (the engine's DB identity — derive a stable `dataset_id` UUID stored in DB meta at creation).
- Auth (desktop ↔ embedded only, post-ruling): the engine's existing TLS security modes + device approval — **no PASETO/token machinery**. (The conduct-proxy `Bearer.` subprotocol convention died with the cloud-changeset path; if an operator-hosted tier is ever built, it would need its own auth design — out of scope, see summary "operator-hosted backup tier" exclusion.)
- Yield semantics (2-2): while connected as client, local writes still occur app-side? **No** — in local mode with an active desktop authority, the embedded engine routes writes to the authority (facade write ops forward over the client connection) OR buffers in pending epoch if disconnected. v1 choice: **buffer-and-forward on reconnect** (simpler, offline-first; conflicts resolved by policy at authority). Document the UX implication (changes land on desktop when reconnected).
- Foreground gating: client runs while the host is alive (Android FGS window / iOS foreground); no background dialing.

## Implementation steps

1. `syncclient/` core: dial, security modes, handshake (device-approval pairing from the dialing side), event loop, reconnect/backoff.
2. Write routing seam: facade write operations tagged `local-authoritative` vs `routed`; pending-epoch buffering when client mode active (integrates 2-2 pending epochs).
3. Pairing/config surface + docs (peer address book, security-mode selection).
4. Tests: dial against an in-process serving engine (loopback), reconnect storms, buffered-writes flush order, device-approval handshake from the dialing side.

## Files to create/modify

- NEW `syncclient/` (+ tests)
- Facade config surface (feeds 4-1; for Android sidecar: CLI/env flags in 1-1 extended)
- Engine docs `docs/Changeset-Sync.md` (client role, yield/buffer semantics)

## Verification gates

- `go build/vet/test ./...` green; client integration suite (dial/exchange/buffer/flush) green
- Two-device lab test prep (desktop engine ↔ sidecar on emulator/device) handed to 2-5/3-x verification

## Risks & rollback

- Buffer-and-forward latency on desktop-authority setups — product decision visible to users; capture in review

## Progress checklist

- [x] Client core + security modes
- [x] Handshake + device approval from dialing side
- [x] Pending-epoch buffering + flush
- [x] Integration tests green

## Implementation notes (2-4)

- **Reuse, not re-implementation.** The client reuses 2-3's
  `eventserver.ChangesetSyncHandler` with `Authority=false`; the `syncclient/`
  package owns only the transport, the device-approval handshake, the reconnect
  loop and the store/epoch lifecycle.
- **Yield/buffer semantics (v1) = buffer-and-forward.** Entering client mode
  yields any active epoch and buffers local writes into a pending epoch
  (`changesetstore.StartPending`), connected or not. On (re)connect the client
  forwards its pending changesets to the authority; an `EPOCH_HANDOVER`
  promotes the pending epoch to active.
- **Security modes** mirror the app's three (`secure`/`insecure-ssl`/
  `unencrypted`). TLS modes pair over the peer's plaintext WS (the only
  unauthenticated path) to obtain the device JWT + cert, then dial WSS
  presenting the JWT as `Authorization: Bearer` (no PASETO, no `Bearer.`
  subprotocol — that died with the cloud path).
- **Baseline re-pull is staged, not hot-applied.** The client receives and
  stages the rejoin baseline (`Client.BaselinePath()`); v1 does not swap/merge
  the live SQLite handle mid-session (adoption is a host-boundary operation, and
  the baseline is served before the client's pending is forwarded, so an
  in-session merge could drop offline writes). The full two-device rejoin stays
  a lab test handed to 2-5/3-x.
- **dataset_id** is derived deterministically (UUIDv5 over the engine instance
  id) rather than persisted: no generic meta table exists and the plan adds no
  migration; the derivation is stable, and `dataset_id` is informational in
  single-dataset v1.
- **Known limitation (for 2-5 / 5-1):** the client's per-connection handler
  starts with no peer position, so its first `EPOCH_STATE` sets `need_rejoin`
  and the authority serves a **baseline on every connect** (the delta path needs
  a persisted `(epoch, seq)` tracked across connections). v1 accepts a baseline
  re-pull per connect; seeding the announce with a persisted tracking position
  is a follow-up.
- **Config surface:** `config.SyncClientConfig` (`syncclient` block); desktop
  `cmd/run.go` starts it when enabled (and attaches the store as non-authority);
  sidecar gains `--sync-*` flags / `SE_SYNC_*` env. This is the surface 4-1
  consumes.
- **Runtime controller (3-5):** the live handle for this role is now
  `syncclient.Manager` (`syncclient/manager.go`) — mutex-guarded recreate,
  enable/disable authority transitions, and the config.json persistence the
  management REST surface (`/api/sync/client*`) drives; both `cmd/run.go` and
  `enginehost` own a Manager, and the 4-1 facade's `DialSync`/`YieldSync` route
  through it.
