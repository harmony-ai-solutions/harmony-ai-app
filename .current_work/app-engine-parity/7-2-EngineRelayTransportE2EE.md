# Phase 7-2 — Engine: Relay Transport + End-to-End Encryption

> **Repo:** `harmony-link-private` (engine `syncclient` extension + crypto layer + key escrow consumer)
> **Created:** 2026-10-12 (Phase 7)
> **Depends on:** 2-3/2-4 (changeset-v1 client/server machinery — landed), 7-1 (relay wire contract — coordinate on the envelope), 2-5 (W1 escrow pattern — extended for the sync-group key)
> **Amends:** config `SyncClientConfig` comment "There is NO cloud/PASETO configuration here" (2026-10-11) — the relay transport adds cloud transport, still **no cloud engine peer**; the ruling's substance (cloud never runs engine logic, never reads user data) holds.

## Objective

Give the sync client a second transport — the Soulbits Cloud relay — and wrap all sync frames in an end-to-end AEAD layer so the relay (and the operator) is structurally blind. LAN-direct transport and its TLS/device-approval flow stay exactly as 2-4 built them.

## Design

### 1. Transport selection

`SyncClientConfig` gains: `Transport` (`lan` | `relay`, default `lan`), `RelayURL` (wss://…/v1/sync/ws), `RelayToken` (account-issued relay credential — the app injects/refreshes it via the 3-5 PUT route; the engine never does Soulbits auth itself). `syncclient` grows a `relayDialer` beside `DialWebSocket`: same `Conn` interface, so pairing/handshake/pump/buffer-and-forward logic is reused unchanged — the relay carries the same changeset-v1 frames, only framed differently (relay envelope + E2E layer).
- LAN mode: untouched (device approval, TLS modes, pinned certs).
- Relay mode: dial with `Authorization: Bearer <relay token>`; first connect presents the pairing token (7-1 consume); frames = E2E envelope (below). Reconnect/backoff identical.

### 2. E2E layer (new small package, e.g. `syncclient/e2ee`)

- **Cipher:** XChaCha20-Poly1305 AEAD, random 24-byte nonce per frame (libsodium-style; `golang.org/x/crypto/chacha20poly1305` — check go.mod; if only Poly1305 is present, promote the dep, no new dependency family).
- **Key: one symmetric 256-bit *sync-group key* per dataset.** Minted by the first/authority engine ("create sync group"), never transmitted in the clear.
- **Distribution:** account-escrow wrap, W1-style — the 2-5 escrow service gains a second wrapped-key slot (`sync_key` alongside `backup_key`): the engine wraps the group key under the account KEK envelope via the app (app signs in → escrow GET returns wrapped sync key → inject to engine via management route). New device joins: sign in → unwrap → member. No-cloud users simply don't use relay mode (LAN stays fully functional key-free).
- **Rotation:** manual "reset sync key" action (portal or engine route) and mandatory-on-revoke. **Clarified 2026-10-12 (orchestrator): rotation is engine-authoritative — a surviving member engine mints the new key; the portal only *triggers* (sets a rotation-required flag the engines see on next contact / key-status); the operator never sees key material, even ephemerally.** v1 rotation = new key + baseline re-transfer (the 2-2 rejoin rule makes this cheap and already implemented). All devices revoked ⇒ next pairing starts a fresh group.
- **Envelope on the wire:** `{v, sender_device_id, dataset_id, seq, nonce, aead_frame}` where `aead_frame` = AEAD(changeset-v1 frame, AAD = v|sender|dataset|seq). Per-sender monotonic `seq`; receivers reject non-monotonic/duplicate (replay defense independent of the relay).
- **What is NOT covered (document):** metadata (sizes/timing/device ids — the 7-1 accepted-metadata list); LAN-mode frames remain TLS-protected only (peer-to-peer, no third party). Forward secrecy is limited by the static group key — documented limitation; per-session DH upgrade path noted.

### 3. Management surface (extends 3-5)

- `GET/PUT /api/sync/client` config fields add `transport`, `relay_url`; `GET status` adds `sync_group` state (`uninitialized | member | key_pending`) and relay connection state.
- New: `POST /api/sync/group/init` (mint group key + wrap for escrow), `GET /api/sync/group/key-status`, `POST /api/sync/group/rotate`. Escrow interactions flow **through the app** (the engine returns the wrap blob; the app's signed-in session PUTs it to the account escrow — the engine never holds Soulbits credentials).

### 4. Tests

Two engines through an in-process fake relay (7-1 harness pattern): full exchange, offline-buffer drain, replay rejection (duplicate/reordered seq), wrong-key rejection, rotation → old frames unreadable + baseline re-transfer, pairing-token consume, escrow wrap/unwrap round-trip (fake escrow), LAN regression (2-4 suite untouched and green).

## Implementation steps

1. `e2ee` package (AEAD, envelope, seq window) + unit tests.
2. `relayDialer` + `SyncClientConfig` fields + transport switch + pairing-token connect.
3. Group-key lifecycle routes + escrow blob flow (app-facing contract documented for 7-3).
4. openapi + docs (`docs/Changeset-Sync.md` gains the relay chapter + threat model) + CHANGELOG.

## Verification gates

- Canonical env: `go build ./...`, `go vet ./...`, `go test ./...` exit 0 (2-4 suite stays green untouched).

## Owner device gates

- Phone + desktop syncing through deployed staging relay (after 7-1 deploy); rotation drill.

## Progress checklist

- [x] e2ee package + tests
- [x] relayDialer + transport switch + pairing consume
- [x] Group-key lifecycle + escrow flow
- [x] Two-engine-through-relay integration tests
- [x] Docs/openapi/CHANGELOG
- [ ] Owner device gates

## Implementation notes (2026-10-12, `feat/app-engine-parity`)

Engine (`harmony-link-private`) — DONE.

- **Wire deltas vs the design sketch (reconciled with 7-1, which is binding):**
  the relay envelope has **no** `nonce` field — the 24-byte nonce lives inside
  `aead_frame` as `nonce(24) || ciphertext || tag(16)`. The engine is configured
  with `device_id` + `dataset_id` (added to `SyncClientConfig`) because the relay
  forces them from the connection. AAD is the canonical
  `v|sender_device_id|dataset_id|seq`.
- **`syncclient/e2ee`** — XChaCha20-Poly1305 (`x/crypto`, already direct), the
  sync-group key, the frame envelope, and the per-sender monotonic seq + receive
  window.
- **`syncclient/relay.go`** — `DialRelay` (bearer auth + pairing-token connect +
  `welcome`) and a `relayConn` implementing the same `Conn` interface; the
  changeset-v1 handler/pump are reused unchanged. Close-code → state mapping
  incl. `auth_needed`.
- **Group-key lifecycle** — `Manager` methods + loopback-authed
  `/api/sync/group/{key-status,init,import,rotate,rotation-required}`; the raw
  key crosses the loopback boundary and the app wraps + escrows it (W1 style).
- **Rotation** is engine-authoritative (a surviving member mints; the portal only
  sets the flag); v1 = new key + baseline re-transfer.
- **Tests** — `syncclient/e2ee` unit suite; a two-engine-through-a-fake-relay
  integration suite (full exchange, offline-buffer drain, replay rejection,
  wrong-key rejection, pairing consume, close-code mapping, rotation); group-key
  lifecycle + escrow-wrap round-trip; management-route tests. 2-4 LAN suite
  untouched and green.
- **Docs** — `docs/Changeset-Sync.md` relay chapter + threat model + "what is NOT
  covered"; management openapi + shared wire fixtures (contract 1.0.0 → 1.1.0);
  CHANGELOG.

### Owner device gates (unchecked — require a deployed staging relay + devices)

1. **Staging relay drill** (after 7-1 deploy): on two real devices, set
   `transport=relay` with the app-injected `relay_url`/`relay_token`; scan the
   portal QR (7-4) → the app PUTs the pairing token → engine status goes
   `pairing → syncing`; write on one device and confirm it lands on the other
   through the relay (not the LAN); confirm the relay never logs payloads.
2. **Rotation drill:** trigger "Reset sync key" on a surviving device → confirm
   the other device re-imports via escrow and re-baselines on its next connect;
   confirm old frames are unreadable (post-rotation writes only).
3. **Auth-needed drill:** force-expire the relay token → engine surfaces
   `auth_needed` → the app refreshes the PASETO and the session recovers.
4. **Quota/revoke drill:** exceed `sync_devices` → `quota_exceeded`; revoke a
   device from the portal → it is kicked (4009 → `rejected`).

