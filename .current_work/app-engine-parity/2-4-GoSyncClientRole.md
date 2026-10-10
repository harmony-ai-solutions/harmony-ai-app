# Phase 2-4 — Engine: Go Sync Client Role (dial-out)

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §7.4.2 (engines have only ever served sync — the gap), §12.3
> **Depends on:** 2-3

## Objective

Give the engine a **client** half: dial a peer engine (desktop over LAN/TLS, cloud through the conduct proxy), authenticate, and participate in the changeset protocol from the non-authority side. Required because the embedded engine — not the app's TS code — now performs sync.

## Design

- NEW `syncclient/` package (engine): connection lifecycle (dial wss/ws with the engine's existing TLS security modes: secure / insecure-SSL / unencrypted-local), reconnect with backoff, event pump shared with the eventserver client patterns.
- Handshake: same negotiation as 2-3 from the dialing side; identity = engine instance id + dataset id (the engine's DB identity — derive a stable `dataset_id` UUID stored in DB meta at creation).
- Auth for cloud path: **PASETO injection** — the host app supplies the token via facade/config (same `v4.local.` PASETO the app uses today; Sec-WebSocket-Protocol `Bearer.<token>` fallback mirroring conduct-proxy conventions). Token refresh: host app rotates → facade updates client config → client re-handshakes on next reconnect (v1: reconnect-on-rotate; document).
- Yield semantics (2-2): while connected as client, local writes still occur app-side? **No** — in local mode with an active desktop/cloud authority, the embedded engine routes writes to the authority (facade write ops forward over the client connection) OR buffers in pending epoch if disconnected. v1 choice: **buffer-and-forward on reconnect** (simpler, offline-first; conflicts resolved by policy at authority). Document the UX implication (changes land on desktop when reconnected).
- Foreground gating: client runs while the host is alive (Android FGS window / iOS foreground); no background dialing.

## Implementation steps

1. `syncclient/` core: dial, security modes, handshake, event loop, reconnect/backoff.
2. Write routing seam: facade write operations tagged `local-authoritative` vs `routed`; pending-epoch buffering when client mode active (integrates 2-2 pending epochs).
3. PASETO config surface + rotation behavior + docs.
4. Tests: dial against an in-process serving engine (loopback), reconnect storms, buffered-writes flush order, token-rotate re-handshake.

## Files to create/modify

- NEW `syncclient/` (+ tests)
- Facade config surface (feeds 4-1; for Android sidecar: CLI/env flags in 1-1 extended)
- Engine docs `docs/Changeset-Sync.md` (client role, yield/buffer semantics)

## Verification gates

- `go build/vet/test ./...` green; client integration suite (dial/exchange/buffer/flush) green
- Two-device lab test prep (desktop engine ↔ sidecar on emulator/device) handed to 2-5/3-x verification

## Risks & rollback

- Buffer-and-forward latency on desktop-authority setups — product decision visible to users; capture in review
- Token in process env (Android) — same-UID visibility only; acceptable, documented

## Progress checklist

- [ ] Client core + security modes
- [ ] Handshake from dialing side
- [ ] Pending-epoch buffering + flush
- [ ] PASETO injection + rotation
- [ ] Integration tests green
