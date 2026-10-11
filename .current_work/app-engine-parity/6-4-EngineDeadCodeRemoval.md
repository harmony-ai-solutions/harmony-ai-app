# Phase 6-4 — Engine: Dead-Code Removal (rows-v1 Sync Server + Cloud-Mode Machinery)

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`) incl. Wails frontend
> **Assessment basis:** two engine-side surfaces are dead code once this plan lands — (a) the rows-v1 sync server (the app's rows-v1 client died in 3-4; changeset-v1 from 2-3 is the only sync protocol left), (b) the cloud-mode machinery built for session hosting (retired in 6-1/6-2)
> **Depends on:** 3-4 (app rows-v1 client gone), 6-1 (backend consumers gone — incl. the BE e2e `sync_request.go` guard, deleted there); 5-1 coordination (schema-parity gates retire in the same window — sequence either order, not both mid-flight)

## Objective

Delete the rows-v1 sync server and the cloud-mode machinery outright (pre-launch ruling: no old versions in the wild; changeset-v1 replaced rows-v1 for the only remaining pairing, desktop ↔ embedded).

## Deletion scope A — rows-v1 sync server

- `eventserver/synchronization.go` (~3.1k lines: SYNC_*/HANDSHAKE_* handling, 35-table master-slave LWW `sendLocalChanges`, size-estimate confirm + 60 s timeout, schema-version gate (`SyncSchemaVersion=2` constants), purge floor (`GetMaxPurgedDeletedAt`), sync error codes) + its test suites (incl. `synchronization_gc_test.go`'s 35-table assertion)
- `database/repository/synchronization/` (`device.go`, `history.go`, `lww.go`, `gc_state.go`, `maintenance.go` + tests) — sync_devices/sync_history bookkeeping; soft-delete stamp columns across the 35 tables **stay** (data model; `utils/delete_stamps.go` survives — verify remaining callers)
- `management/routes_sync.go` (device approve/reject/revoke/pending/history) + `config/db/handler.go` facade methods
- Wails frontend: `DeviceManagementView.jsx`, `DeviceManagementModal.jsx`, `deviceApprovalWatcher.js`, `syncService.js`, pending-device wiring in `HarmonyLinkApp.jsx`
- **Seam edits:** `eventprocessor.go` (`synchronizationHandler` field/construction/dispatch, `SetRAGSyncHelper` wiring), `handler_http.go` attach, `handler_websocket.go` `ReapActiveSyncs`, `request.go` event-routing entries — remove the rows-v1 `SyncProtocol` implementation, keep the interface shape 2-3 introduced (only `changesetV1` remains)
- **RAG write-mirror re-home:** `modules/rag/sync.go`'s `SyncHelper` (memories/messages/lore → vector store on sync-apply) must move to the direct mutation paths (changeset apply already routes through 2-2's store hooks — verify the mirror rides those; otherwise wire repository-level hooks) — this is the one place deletion touches live behavior
- `cmd/dump_schema.go` + `schema/go-schema.json`: retire with the parity gates (5-1) — confirm sequencing in that phase
- Docs: `docs/Entity-Sync-Modes.md` (rewrite to changeset-only), `docs/Events-API.md` sync family removal, `docs/WebSocket-Security.md` handshake notes, memory banks

## Deletion scope B — cloud-mode machinery

- `cmd/cloud_mode.go` (env overrides, PASETO seeder for `soulbitscloud` provider rows) + `cloud_mode_seed_test.go`, `cmd/cloud_reload.go` (`.snapshot-ready` watcher, DEK-file/env/config reopen precedence) + its tests
- `cmd/run.go` snapshot-watcher start; `eventserver/server.go` cloud-shutdown/checkpoint watcher blocks (`checkpointAndSignalDBReady`, `StartSnapshotRequestWatcher`) — **keep** the plain `CheckpointWAL` maintenance helper (2-2 baselines + 2-6 staging use it)
- `push/decay_context.go` cloud-worker SQL path (6-3 removes the backend's engine-push import entirely; the engine keeps its light internal `push/` package — only this cloud-worker path dies)
- Engine `Dockerfile`: **keep** (local container testing); its BE consumers are gone (mirror workflow deleted in 6-1)
- `docs/Cloud-Mode.md` deleted; `docs/Database-Encryption.md` key-custody section rewritten (config.json custody note now points to the 2-6 backup key story)

## Implementation steps

1. RAG write-mirror re-home first (smallest behavior-carrying change; tests: vector store still populated on mutations + on changeset apply).
2. rows-v1 server + repository + management routes + frontend pieces deletion (single atomic PR).
3. Cloud-mode machinery deletion (separate PR — independent blast radius).
4. Docs + memory banks.

## Verification gates

- `go build/vet/test ./...` green incl. the 2-3 two-engine changeset suite (fresh pairing, delta exchange, rejoin, handover) — the surviving protocol proven unaffected
- RAG mirror tests green on both paths (direct mutation + changeset apply)
- Wails frontend builds; desktop smoke: management UI without sync-device surfaces; changeset pairing to an embedded engine still works on device
- Grep gates: no `rows-v1`, no `synchronization.go` symbols, no `cloud_mode` references

## Risks & rollback

- The RAG re-home is the only live-behavior change → land first, independently reviewed + tested; revert-friendly single commit
- Handshake/`request.go` routing surgery misses a reference → compile-time catches (Go); frontend type-check catches UI remnants
- A hidden rows-v1 consumer (third-party?) → none exist by ruling (unlaunched, engine never distributed beyond desktop builds)

## Progress checklist

- [ ] RAG write-mirror re-homed + tested
- [ ] rows-v1 server/repo/routes/frontend deleted; grep gates green
- [ ] Cloud-mode machinery deleted
- [ ] Docs + memory banks updated (Entity-Sync-Modes, Database-Encryption, Cloud-Mode removal)
