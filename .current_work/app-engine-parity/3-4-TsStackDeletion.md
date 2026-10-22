# Phase 3-4 — App: TS Stack Deletion

> **Repo:** `harmony-ai-app` (branch `feat/app-engine-parity`) + engine coordination
> **Assessment basis:** §12.6 (what dies), §12.8 step 4 (old protocol deleted without a bridge — pre-launch ruling)
> **Depends on:** 2-5 (cloud path live), 3-2 (API layer complete + default-on), 3-3 (verdicts)
> **Codebase mapping consulted:** `.planning/codebase/` — app + engine repos (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md)

## Objective

Delete the TS SQLite replica, mirrored migrations, and the app-side sync stack outright once every read/write flows through the engine's management API. **No import mode, no transition release, no soak thresholds**: the product is unlaunched — fresh installs only, existing dev-device data is discarded by ruling (2026-10-11).

## Release design

1. **Precondition:** 3-2's relink is complete and default-on — every call site that used to fetch/modify content in the local DB uses the engine's management API, and 3-1 has extended the API wherever the app genuinely needed more than the contract offered. Cloud mode runs the 2-5 path (on-device engine + injected configs; continuity = 2-6 user-owned-storage backup/restore).
2. **Deletion (single atomic PR):**
   - `src/database/` TS SQLite layer: repositories for synced tables, mirrored migrations, models duplicating engine schema
   - `src/services/SyncService.ts` + `syncNameClash.ts` + all `sync*.test.ts` integration suites for the old protocol; `WebSocketConnectionFactory` legacy rows-v1 branches (the app no longer speaks rows-v1 anywhere — engine↔engine sync is Phase 2, engine-side)
   - `src/services/CloudSessionService.ts` + broker client (dead code since the 2-5 path; the cloud has no engine peer)
   - Wipe/rebuild machinery (`WipeRebuildFlag`, `react-native-restart` dependency), estimate-confirm app-side logic (engine-side estimate now handled at the engine client), purge-floor client handling
   - `scripts/dump-schema.ts` + schema-parity test suites + `docs/schema-parity.md` (retired → historical note)
   - SQLCipher/RN-SQLite dependency: keep ONLY if 3-3 verdicts left app-local tables in SQLite; else drop the dependency (size win)
3. **Keep:** `EntitySessionService` (repointed to the loopback engine), connection state for the local engine, `ConnectionManager` event plumbing, all UI, AsyncStorage layer.
4. **Sequencing note:** after this deletion the app *requires* the embedded engine — iOS builds need 4-1/4-2 in the same release, or the release is Android-first (5-3 tracks the order).

## Implementation steps

1. Deletion PR (single, atomic, reviewable): file list generated from the audit tables (3-1/3-3), CI green without deleted suites.
2. Post-deletion verification: clean-install + cloud-mode + local-mode smoke on device; bundle size delta recorded.

> **Engine follow-up (2026-10-11):** the two engine gaps named in the §0 blocker are now CLOSED on engine branch `feat/app-engine-parity` — provider-config write routes (`POST /api/providers`, `PUT /api/providers/:id`, `DELETE /api/providers/:id`; see engine `docs/api/management/openapi.yaml`) and the cross-entity `GET /api/stats/characters` endpoint serving `getCharacterStats`; the 3-4 checklist items below remain the app task's to tick.
>
> **Engine follow-up (2026-10-12):** `PUT /api/entities/:id` now also accepts optional `is_muted` (boolean) alongside `is_disabled` — present → updates `entities.is_muted`, absent → untouched, mirroring `is_disabled` exactly; note the update handler's unknown-id path returns **500** (there is no 404 branch on this route).

## Files to create/modify

- Deletion: per audit lists (tracked as a generated manifest in this phase folder)
- `package.json` (dependency drops), `docs/` updates, CHANGELOG.md (major entry)

## Verification gates

- `npx tsc --noEmit` 0; jest green (reduced suite reflects deletions — intentional, documented)
- Device smoke green: fresh install (empty start + 2-6 backup-restore), cloud chat on-device, local mode
- Bundle size delta recorded (expect meaningful reduction)

## Risks & rollback

- Missed call site still reaching for a deleted repository → tsc catches statically (the 3-2 relink is typed end-to-end); device smoke covers the rest
- Deletion is recoverable via git revert — there is no user-data irreversibility (no migration ever ran)

## Progress checklist

> **Status (2026-10-12, deletion pass): the RELINK AND THE DELETION are
> LANDED.** The engine is the sole data layer (the seam is a pure re-export of
> the engine adapters), the five create seams are create-then-use-response,
> module configs are composite↔flat mapped, and character images upload as
> multipart. D-35 (send/ingest redesign) renders outgoing messages as optimistic
> in-memory pending rows reconciled against engine reads; mute is
> engine-authoritative; `SyncConnectionContext` is an engine-connection status
> context. The TS SQLite/sync/cloud stack, its 43 test suites and the
> schema-parity tooling are DELETED; the dropped deps are removed and the jest
> config is a single `unit` project. `npx tsc --noEmit` = 0; `npm test` green
> (104 suites / 823 tests). Full evidence:
> `3-4-deletion-manifest.md` §0.4/§0.5 + `3-4-resume-findings.md`. Remaining:
> device smoke + bundle-size delta (owner gates).

- [x] Preconditions verified — relink landed (owner rulings 1–3), flag ON, gates green
- [x] Provider write adapters + stats adapter landed + unit-tested (`services/engine/repositories/providers.ts`, `characters.ts`; seam-delegated)
- [x] Create-then-use-response relink (5 seams) + module composite/flat mapper + multipart images
- [x] Deletion manifest generated + reviewed — `3-4-deletion-manifest.md`
- [x] D-35 send/ingest redesign — **DONE** (`3-4-deletion-manifest.md` §0.4.1)
- [x] Deletion executed; jest retooled — **DONE** (`3-4-deletion-manifest.md` §0.4.3)
- [ ] Device smoke green (fresh install, cloud, local) — owner gate
- [ ] Bundle size delta recorded — owner gate
