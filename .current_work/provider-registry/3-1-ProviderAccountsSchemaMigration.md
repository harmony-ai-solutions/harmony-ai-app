# Phase 3-1 — Engine: provider_accounts Schema + Migration + Sync Surface

**Repo:** harmony-link-private · **Depends on:** 1-1 · **Blocks:** 3-2, 3-3, 4-*, 5-*, 6-1
**Refs:** plan.md §3.1-3.3, §4, §11 audit decisions · SYNTHESIS §1/§2

## Objective

Land the Option B data model: `provider_accounts` table, capability-overlay
columns on all 8 module-config tables, the auto-merge migration from the 13
remaining `provider_config_*` tables, the shared **field-split source of
truth**, and the sync-surface change 32 → 20. This phase owns MECHANICAL
compatibility only (everything keeps compiling + engine green); semantic API
rework is 3-2.

## Implementation steps

1. **Field-split source of truth (new shared file, e.g.
   `database/controllers/provider_field_split.go`):** per type, the account
   fields (`id`, `name`, `api_key`, `base_url`, timestamps, `deleted_at`)
   vs capability fields (everything else). Audit facts baked in:
   - `created_at`/`updated_at` are account bookkeeping — NEVER serialized
     into `capability_json`
   - `soulvoice` stores the endpoint as `endpoint` (provider_soulvoice.go:12)
     — maps to account `base_url`
   - Only 4 of 13 old tables have `base_url` (ollama, comfyui,
     openaicompatible, soulbitscloud); the other 9 have no such field
   - Consumed by: this migration, 3-2's mapper, 3-3's validation
2. **Migration 000052 — Go-hook (D62 pattern; `GoUp func(*sql.Tx) error`
   registered in `goUpMigrations`, migrations.go:28-35, precedent
   migration 45; comment-only `.up.sql` stub alongside):**
   1. `CREATE TABLE provider_accounts` + type index — exact plan §3.1 DDL
   2. Per remaining `provider_config_<type>` (13): read non-deleted rows,
      group by `(type, api_key, base_url)` — with soulvoice's `endpoint`
      normalized to `base_url` — INSERT one account per group (keep first
      row's id; prefer longest name / earliest created)
   3. Per module config (incl. stt ×2 slots): serialize capability fields
      per the field-split into `capability_json` /
      `transcription_capability_json` / `vad_capability_json`; set
      `transcription_provider_account_id` / `vad_provider_account_id`
      (plan §3.2 naming)
   4. Drop the 13 old tables. **`DROP COLUMN` is forbidden by
      `assertMigrationSQLSupported` (migrations.go:354-357)** — drop the old
      FK columns by rebuilding each module table (`_new`-table pattern:
      create with final schema, copy, swap), inside the Go hook
3. **Models:** `database/models/provider_account.go` (DB + sync variants,
   ToSyncModel/ToDBModel — entity.go pattern); module-config models gain
   the overlay/FK columns (DB + sync structs + mappers, stt dual)
4. **Repos:** `database/repository/providers/accounts.go` — type-generic
   CRUD (list by type, get, getByName, create, update, softDelete)
5. **Mechanical caller compatibility (engine must stay green here —
   semantic rework is 3-2):**
   - `management/routes_providers.go` (built on the per-type repos,
     L146-279 + 587-1017 incl. `RefreshAllActiveTokens`) — mechanically
     retargeted to the accounts repo (old envelopes preserved where
     possible; full rework in 3-2)
   - `database/controllers/module_controller.go` + `provider_mapper.go` —
     extract/load branches mechanically switched to account FK + overlay
     (using the field-split)
   - **`config/db/init.go` `createDefaultData` — REWORK to the new model:**
     seeds ONE soulbitscloud account (empty `api_key`, `base_url =
     config.SoulbitsCloudBaseURL()`) + module configs with
     `provider_account_id` + capability overlays. Defaults aligned per
     §11 A8–A10: backend **`qwen-35-9b`** (was starfallen-24b),
     cognition/movement/vision `qwen-35-9b`, tts `kitten-tts-mini` +
     voice `bella`, rag `harrier-oss-v1-0-6b`, stt transcription
     `faster-whisper-tiny`, stt VAD **`silero-vad`**; imagination
     intentionally NOT seeded (matches today); entity 'claire' + user
     STT unchanged. The account starts with an empty key; the PASETO
     lands via 6-4's ensure-flow on cloud auth/re-auth (A9) or the
     engine-side refresh paths
6. **Sync surface 32 → 20:** `registeredSyncTables`
   (sync_handshake.go:393) + changesetstore `policy.go` key set: remove 13
   `provider_config_*`, add `provider_accounts`; pins:
   `changesetstore_parity_test.go:27`, `policy_test.go:85`
   (`assert.Len(t, tables, 35…)` → 20 — note it still says 35 because 1-1
   landed 32; final 20), `store.go:93` comment, `policy_test.go` coverage
   list
7. **Per-type repo deletion:** the 13 old repo files are deleted HERE
   (all callers were mechanically retargeted in step 5)
8. **Migration tests (round-trip, pattern `migrations_goup_test.go`):**
   fixture old-schema DB — identical keys across module configs → ONE
   account; distinct keys → distinct accounts; overlays populated with
   capability fields ONLY (no timestamps); stt dual-slot; soulvoice
   endpoint → base_url; orphan configs with dangling FK → account NULL;
   post-migrate invariant: exactly one account row per real credential

## Files touched

`database/migrations/000052_*`, `database/controllers/provider_field_split.go`
(new), `database/models/` (account + 8 module models),
`database/repository/providers/` (accounts.go + 13 deletions),
`database/controllers/module_controller.go` + `provider_mapper.go`,
`management/routes_providers.go` (mechanical), `config/db/init.go`,
`database/repository/modules/*.go` (all 8 — column rebuild fallout:
INSERT/SELECT/UPDATE use the new FK/overlay columns),
`eventserver/sync_handshake.go`, `database/changesetstore/{policy.go,store.go}`,
both parity tests, `database/test/database_integration_test.go`.

## Test gates

- Engine gate (summary.md conventions) — full build/vet/test
- New migration round-trip suite green
- Parity tests green with count 20

## Checklist

- [ ] Field-split source of truth (shared file; soulvoice endpoint; no timestamps)
- [ ] Migration 000052 Go-hook: accounts DDL, auto-merge, overlays, table rebuilds (no DROP COLUMN)
- [ ] Account models + repo
- [ ] Mechanical retarget: routes_providers, module_controller/mapper
- [ ] init.go createDefaultData reworked (1 account + overlays)
- [ ] repository/modules/*.go (8) on new columns
- [ ] 13 per-type repos deleted
- [ ] Sync surface 20 + all parity pins updated
- [ ] Migration round-trip tests (merge, overlays, orphans, invariants)
- [ ] Engine gate green
