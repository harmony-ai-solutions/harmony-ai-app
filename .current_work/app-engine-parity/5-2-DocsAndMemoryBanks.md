# Phase 5-2 — Docs & Memory Banks

> **Repos:** all three
> **Workspace rules:** memory-bank conventions (`.toon` first, then markdown; docs + changelogs checked in every touched repo)
> **Codebase mapping consulted:** `.planning/codebase/` — all three repos (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md; TESTING.md where present)

## Objective

Bring all documentation in line with the shipped architecture; per workspace rules this is mandatory, not optional.

## Work items

### harmony-ai-app
- `memory-bank/*.toon`: systemPatterns (Sync section rewritten: changeset epochs; new EngineHost/embedding section), techContext (engine artifact dependency, loopback, API data layer), activeContext entry for this plan, progress entries per phase as executed
- `README.md`, `docs/HARMONY-LINK-INTEGRATION.md` (engine-in-app model: local engine primary, desktop pairing engine-side, cloud account), `docs/entity-interaction-model.md` (unchanged concepts; update storage references), `docs/TESTING.md` (new suites), `docs/INSTALLATION.md` (local mode setup)
- `CHANGELOG.md` — major entry (engine embedding, TS stack removal)

### harmony-link-private
- `memory-bank/*.toon`: systemPatterns (lazy temporal model, catch-up seam, changeset sync, embed facade, sidecar build), techContext (session-extension fork flags, gomobile artifacts), progress
- `docs/Entity-Lifecycle.md` (D1/D2), `docs/Changeset-Sync.md` (epochs, policy, wire spec), `docs/Sidecar-Deployment.md`, `docs/Embed-Facade.md` — final polish pass
- `CHANGELOG.md`

### soulbits-cloud-backend
- `memory-bank/*.toon`: systemPatterns (data-blind cloud: keepalive cron + relay, lifecycle-worker removal), progress
- Ops/README (keepalive cron + push relay, lifecycle-worker removal); `CHANGELOG.md`

## Verification gates

- Memory banks updated in all touched repos; changelogs present; no doc still describing the TS replica as current
- This plan's `summary.md` implementation status fully checked off

## Progress checklist

- [x] App memory bank + docs + changelog
- [x] Engine memory bank + docs + changelog
- [x] Cloud memory bank + docs + changelog
- [x] Plan status finalized

## Status (2026-10-12 — task 5-2 complete)

All three repos' docs, memory banks (`.toon` first) and changelogs are in line
with the shipped architecture. No doc anywhere still describes the TS replica /
rows-v1 / cloud session-hosting as current (the app integration diagrams were
archived to `docs/history/harmony-link-diagrams/` with a retirement note; the
cloud lifecycle-ops doc was rewritten data-blind).

**Remnants landed (all 5):**

1. **Engine-side gate halves** — canonical shared wire fixtures hosted engine-side
   (`docs/api/management/fixtures/management-contract.fixtures.json`); the app CI
   `contract-drift` job's pinned-path fetch now points at them
   (`--engine-fixtures engine/docs/api/management/fixtures/management-contract.fixtures.json`);
   changeset-protocol conformance golden fixtures added
   (`eventserver/sync_changeset_conformance_test.go`, table-driven, reusing 2-3's
   harness); openapi `info.version` bump procedure documented
   (`docs/Management-API-Versioning.md`, the doc `docs/engine-contract-gates.md`
   points to).
2. **`dump-schema` retirement** — verified zero live consumers (only the command,
   its own tests, and the README); retired `cmd/dump_schema.go`,
   `cmd/dump_schema_test.go`, `schema/go-schema.json`, and the orphaned
   `database.DumpSchemaRows` (+ its tests). `CheckpointWAL` retained (live).
3. **`sync_gc_state` cleanup migration** — migration **000049** drops the now-unread
   table (down recreates); `database/migrations_test.go` updated.
4. **Desktop Wails backup hook** — new `frontend/src/services/management/backupService.js`
   + a "Backup & Restore" section in `GeneralSettingsView.jsx` (target picker,
   "Back up now", probe, "Restore from backup", recovery code, status line) driving
   the existing `/api/backup/*` routes; frontend build green.
5. **App backup OAuth TODO (report-only)** — `docs/INSTALLATION.md` now documents
   that Dropbox/OneDrive client ids in `BackupModule.kt` are empty placeholders
   requiring owner-created credentials wired via `scripts/oauth-secrets.cjs`; no
   ids invented.

**Gates:** engine `go build`/`go vet`/`go test ./...` exit 0 (with the mandatory
`CGO_CFLAGS` session-extension defines); frontend `npm run build` exit 0; app
`npx tsc --noEmit` 0 + `npm test` green; cloud `go build`/`go vet`/`go test`
green. See the task's final report for exact numbers.
