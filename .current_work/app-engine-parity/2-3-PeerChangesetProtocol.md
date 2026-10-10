# Phase 2-3 — Engine: Peer Changeset Protocol (engine ↔ engine over WS)

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.3 relationship 2; memory-bank sync protocol conventions (handshake, version gate)
> **Depends on:** 2-1, 2-2

## Objective

The wire protocol by which two engines exchange epoch/changeset state over the existing event-server WS transport — desktop ↔ embedded, and later cloud ↔ embedded (2-5).

## Design

- Rides the **existing `/ws/sync` connection + handshake** with a new negotiated mode: `HANDSHAKE_ACCEPT` advertises `sync_protocol: "changeset-v1"` alongside legacy `"rows-v1"`. Peers pick the highest common. **`sync_schema_version` bumps to 3** (bump policy: semantics of sync change).
- Message set (eventserver events, snake_case wire, gzipped binary payloads base64 or binary frames per existing binary event support):
  - `EPOCH_STATE` — announce `(current_epoch, seq, baseline_id)`; peers compute delta or rejoin need
  - `CHANGESET_BATCH` — ordered `(epoch_id, seq…)` blobs with cumulative checksum
  - `CHANGESET_ACK` — ack up to `(epoch_id, seq)` (drives retention)
  - `BASELINE_OFFER` / `BASELINE_ACCEPT` — snapshot transfer (chunked; reuses compression conventions; flow-control windowed)
  - `EPOCH_HANDOVER` — authority transfer (graceful): old authority flushes, sends final batch + handover marker, client promotes its pending epoch
  - `SYNC_REJECT` (typed) — incompatible protocol/schema → existing sticky `serverUpdateRequired` UX on the *app* side still applies when an old app meets a new engine; a new *engine peer* gets a typed reject + min versions
- Application: incoming batches → 2-2 store → `sessionext.Apply` under the per-class policy → applied inside one savepoint per batch; on ABORT (unexpected) → typed error, batch quarantined, connection stays for diagnostics (never half-applied).
- Back-compat: engine keeps serving `rows-v1` to old apps during the transition window (dual-protocol server; removal tracked in the future cloud-cleanup plan + app 3-4 deletes the client).
- Security: unchanged TLS/security modes for desktop peers; loopback exempt (1-3).

## Implementation steps

1. `eventserver/synchronization.go`: protocol negotiation + new event handlers; keep legacy path isolated behind an interface (`SyncProtocol` implementations: `rowsV1`, `changesetV1`).
2. Batch pipeline: receive → validate continuity (epoch/seq) → apply → ack; send side driven by 2-2 store flushes.
3. Handover choreography + crash-safety (handover marker persisted before promote; on reconnect, ambiguity resolved by epoch ledger compare).
4. Tests: full-matrix integration — two in-process engines, scenarios: fresh pairing, delta exchange both directions, rejoin (gap beyond retention), handover during in-flight write, protocol mismatch reject, legacy client served rows-v1 while peer uses changeset-v1.
5. Load test: large history baseline transfer + steady-state deltas; record numbers.

## Files to create/modify

- `eventserver/synchronization.go` (+ NEW `eventserver/sync_changeset.go`)
- `database/changesetstore/` (ack/handover hooks)
- Engine docs: extend `docs/Changeset-Sync.md` with wire spec; CHANGELOG.md

## Verification gates

- `go build/vet/test ./...` green incl. the two-engine integration suite
- Scenario matrix green; crash-injection (kill between handover steps) recovers deterministically
- Legacy rows-v1 regression suite untouched/green

## Risks & rollback

- Handover is the dangerous window → crash-injection tests mandatory; conservative default: handover only at clean boundaries (no in-flight writes), forced-flush first
- Dual protocol doubles server surface temporarily — isolated behind interface + explicit removal tracking

## Progress checklist

- [ ] Negotiation + version bump
- [ ] Batch exchange + ack + retention hook
- [ ] Baseline transfer + rejoin
- [ ] Handover + crash-safety tests
- [ ] Scenario matrix green
- [ ] Wire spec documented
