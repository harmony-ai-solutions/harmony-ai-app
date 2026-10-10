# Phase 3-4 — App: Migration Bridge Execution & TS Stack Deletion

> **Repo:** `harmony-ai-app` (branch `feat/app-engine-parity`) + engine coordination
> **Assessment basis:** §12.6 (what dies), §12.8 step 4 (old protocol as the bridge, then deleted)
> **Depends on:** 1-4 (bridge proven), 2-5 (cloud path live), 3-2 (flagged API layer), 3-3 (verdicts)

## Objective

Ship the transition release: existing installs import their data into the embedded engine via the **old sync protocol one final time**, all reads/writes move to the API layer (flag becomes default-on for local mode), and the TS replica + sync stack is deleted.

## Release design

1. **Import mode (one-time):** on first launch of the transition release, if a legacy TS database exists → start sidecar → run the existing full-sync flow against `127.0.0.1` (exactly the 1-4 pilot path, but automatic + progress UI "Moving your data into the Soulbits engine…"). Success → mark `engine_migration_done`, keep the legacy DB file as `legacy-backup-<date>.db` (user-deletable; never read again). Failure → keep old architecture active (flag stays off), surface retry — **no destructive path**.
2. **Cloud-mode users:** the same release switches cloud mode to the 2-5 path (engine client through conduct proxy). Users who skip the sidecar (iOS, or flag-off) — see decision point: iOS release timing (Phase 4) must precede or accompany this release for cloud-mode iOS users; otherwise gate the deletion release Android-first.
3. **Deletion (after migration success rate telemetry ≥ threshold, min 2 weeks soak):**
   - `src/database/` TS SQLite layer: repositories for synced tables, mirrored migrations, models duplicating engine schema
   - `src/services/SyncService.ts` + `syncNameClash.ts` + all `sync*.test.ts` integration suites for the old protocol; `WebSocketConnectionFactory` legacy branches for self-hosted rows-v1 (self-hosted users must run engine ≥ changeset version — enforced by existing `sync_schema_version` sticky gate, now pointing at the engine-client handshake result)
   - Wipe/rebuild machinery (`WipeRebuildFlag`, `react-native-restart` dependency), estimate-confirm app-side logic (engine-side estimate now handled at engine client), purge-floor client handling
   - `scripts/dump-schema.ts` + schema-parity test suites + `docs/schema-parity.md` (retired → historical note)
   - SQLCipher/RN-SQLite dependency: keep ONLY if 3-3 verdicts left app-local tables in SQLite; else drop the dependency (size win)
4. **Keep:** `EntitySessionService` (talks to loopback/cloud engine), `CloudSessionService` (broker client), connection state per source, `ConnectionManager` event plumbing, all UI, AsyncStorage layer.

## Implementation steps

1. Import-mode orchestrator + progress UI + backup-file handling + `engine_migration_done` persistence; failure/retry path; tests with fixture legacy DBs (populated via old-protocol mock).
2. Telemetry counters (import attempted/succeeded/failed/skipped) — privacy-respectful, aggregate only.
3. Soak window; then the deletion PR (single, atomic, reviewable): file list generated from the audit tables (3-1/3-3), CI green without deleted suites.
4. Post-deletion verification: clean-install + upgraded-install + cloud-mode + local-mode matrices on device.

## Files to create/modify

- NEW `src/services/engine/LegacyImportService.ts` + progress screen
- Deletion: per audit lists (tracked as a generated manifest in this phase folder)
- `package.json` (dependency drops), `docs/` updates, CHANGELOG.md (major entry)

## Verification gates

- `npx tsc --noEmit` 0; jest green (reduced suite reflects deletions — intentional, documented)
- Device matrices green; import from real legacy dataset (the pilot device) verified
- Bundle size delta recorded (expect meaningful reduction)

## Risks & rollback

- Migration failure on long-tail datasets (weird legacy states) → non-destructive design guarantees rollback to old architecture per-device; telemetry drives fixes before deletion ships
- Self-hosted users on ancient engines → sticky `serverUpdateRequired` gate already handles (upgrade engine prompt)
- This is the point of no return for the TS stack — the soak threshold is the safety

## Progress checklist

- [ ] Import orchestrator + UI + backup + retry
- [ ] Telemetry
- [ ] Release + soak (≥2 weeks, threshold met)
- [ ] Deletion manifest generated + reviewed
- [ ] Deletion PR merged; CI retooled
- [ ] Device matrices green
