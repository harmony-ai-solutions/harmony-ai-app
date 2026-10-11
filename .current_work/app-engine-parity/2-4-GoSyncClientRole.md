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

- [ ] Client core + security modes
- [ ] Handshake + device approval from dialing side
- [ ] Pending-epoch buffering + flush
- [ ] Integration tests green
