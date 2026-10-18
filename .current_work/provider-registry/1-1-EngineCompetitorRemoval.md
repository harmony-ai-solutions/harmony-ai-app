# Phase 1-1 — Engine: Competitor Removal (Kindroid, Character.AI, Kajiwoto)

**Repo:** harmony-link-private · **Parallel with:** 1-2 (app side, disjoint repo)
**Refs:** plan.md R9, §8 Phase 0, §11 audit decisions · research/SYNTHESIS.md §5 item 11

## Objective

Remove the three competitor provider types from the engine entirely, with a
Go-hook migration that drops their tables and **hard-deletes** module configs
referencing them (owner ruling — no disabled-sentinel preservation). Includes
the legacy Kajiwoto URL shim and the vendored competitor SDKs (owner ruling
2026-10-18: **remove fully**).

## Implementation steps

1. **Delete provider clients + registry entries + legacy shim**
   - `providers/kindroid.go`, `providers/characterai.go`, `providers/kajiwoto.go`;
     remove the three entries in `providers/registry.go`
   - `providers/soulvoice.go:114-115` — delete the legacy
     `https://kajiwoto.ai/v/` → `server.chiefhappiness.co` URL rewrite
     (owner accepted breakage of any kajiwoto.ai voice-config URLs)
   - `constants/constants.go:19-21` — remove the `// Kajiwoto` comment, `KW*`
     constants, and the chiefhappiness host constants (dead after shim removal)
2. **Dependencies:** `go.mod:23,24,26` — remove the three
   `harmony-ai-solutions/{CharacterAI,KindroidAI}-Golang` +
   `kajiwoto-clientsdk-golang` requires; then `go mod tidy` **and**
   `go mod vendor` (drops `vendor/modules.txt:313-326` + the 30+ vendor trees)
3. **Config layer:** `config/config.go`, `config/types.go` — remove the three
   config structs and mapstructure keys
4. **Data layer:**
   - Delete `database/models/provider_{kindroid,characterai,kajiwoto}.go`
   - Delete `database/repository/providers/{kindroid,characterai,kajiwoto}.go`
     (+ `_test.go`)
   - `database/repository/modules/backend.go:173-178` — remove the three
     branches (`modules/backend.go:139-140` holds only a comment — remove it)
   - `database/controllers/module_controller.go` — remove create/update
     branches; `provider_mapper.go` (+`_test.go`) — remove mappings
5. **Management API:** `management/routes_providers.go` — remove the three
     types from the `providerTypes` map + per-type dispatch; update
     `routes_providers_test.go`
6. **Sync surface 35 → 32:**
   - `eventserver/sync_handshake.go` `registeredSyncTables` (~L393) — remove
     the 3 `provider_config_*` entries
   - `database/changesetstore/policy.go` key set — remove the 3
   - Parity pins: `changesetstore_parity_test.go:27` (35→32);
     `policy_test.go:85` `assert.Len(t, tables, 35…)` → 32;
     `database/changesetstore/store.go:93` "35-table surface" comment → 32
     (`policy_test.go:67` `ClassOf("provider_config_openai")` stays valid)
7. **Migration 000051 — Go-hook (D62 pattern):**
   - Data migrations are only expressible via `GoUp func(*sql.Tx) error`
     registered in `goUpMigrations` (`migrations.go:28-35`; precedent
     migration 45); ship a comment-only `.up.sql` stub alongside
   - DROP the 3 `provider_config_*` tables
   - Hard-delete referencing rows in the 8 module-config tables
     (`WHERE provider IN ('kindroid','characterai','kajiwoto')`; stt checks
     both `transcription_provider` and `vad_provider` slots)
   - NULL the entity-module mapping columns AND
     `character_profiles.vision_config_id` — the 000031 FK declares
     `ON DELETE SET NULL` but FK enforcement is off during migration
     (`migrations.go:251`) and `checkForeignKeys` only warns
     (`migrations.go:278-281`)
8. **Tests:** delete suites for removed code; migration round-trip test
   (pattern: `migrations_goup_test.go`) proving hard-delete + NULL-ing on a
   fixture DB with rows in all three tables; `database/test/database_integration_test.go`
   `TestMixedProviderConfiguration` (uses kindroid → switch fixture to a
   surviving provider); `modules/backend_test.go`
   `TestKajiwotoModuleTestSuite` wrapper → delete

## Files touched

`providers/`, `constants/`, `config/`, `database/models/`,
`database/repository/providers/`, `database/repository/modules/backend.go`,
`database/controllers/module_controller.go` + `provider_mapper*.go`,
`database/migrations/000051_*`, `eventserver/sync_handshake.go`,
`database/changesetstore/{policy.go,store.go}` + parity tests,
`management/routes_providers*.go`, `go.mod`/`go.sum`/`vendor/`.

## Test gates

- Engine gate (summary.md conventions) — incl. the new migration test
- `go test ./database/... ./eventserver/... ./management/...` green
- grep gate: case-insensitive `kindroid|kajiwoto|characterai` over the repo,
  excluding `database/migrations/*` and `_test` fixtures — zero hits
  (vendor regen removes the SDK trees; go.mod cleaned in step 2)

## Checklist

- [ ] Clients + registry entries + soulvoice shim + KW constants removed
- [ ] go.mod tidy + vendor regen (competitor SDK trees gone)
- [ ] Config structs/keys removed
- [ ] Models/repos/controller/mapper branches removed
- [ ] Management routes cleaned
- [ ] Sync surface 32 + all parity pins updated
- [ ] Migration 000051 (Go-hook): drop 3 tables, hard-delete, NULL mappings + vision_config_id
- [ ] Migration round-trip test added
- [ ] Engine gate green
