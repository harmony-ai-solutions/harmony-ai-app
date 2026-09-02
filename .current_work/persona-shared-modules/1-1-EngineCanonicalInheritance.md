# 1-1 — Engine: Canonical Module Inheritance for User Entities

> Repo: `harmony-link-private` (branch `feat/engine-track-phase2`). Consult `.planning/codebase/` docs (ARCHITECTURE/CONVENTIONS) for the config/DB layering before starting. Protocol: `gitnexus_impact` before edits, `gitnexus_detect_changes` before commit, TDD.

## Objective

User-type entities (personas) resolve their module configuration from the **canonical built-in `user` entity's mapping** instead of their own (nonexistent) mapping row. One source of truth; zero drift; any future user-entity module inherits automatically. Enforce via the management API: mapping edits on non-canonical user entities are rejected.

## Verified current state

- `LoadFullEntityConfig` (`database/controllers/entity_controller.go:268-398`) loads the entity's own mapping with a missing-mapping tolerance (empty mapping → all providers `config.ProviderDisabled`).
- The seeder creates the `user` entity + its mapping with an STT config (`config/db/init.go:79,301,336`).
- `createUserPersona` (app) creates NO mapping row — personas are mapping-less today; nothing to migrate.
- Entity cache rebuild (`LoadAllEntities` → `LoadFullEntityConfig`) feeds `INIT_ENTITY` module init, so inheritance here covers session init + inline reload automatically.

## Implementation steps (TDD — tests RED first)

1. **Controller tests** (`database/controllers/entity_controller_test.go`):
   - persona entity (type `user`, id ≠ `user`, NO own mapping) + `user` entity WITH an STT-mapped mapping → `LoadFullEntityConfig(persona)` resolves the canonical mapping (STT config present, same IDs as `user`'s).
   - persona with a stray OWN mapping row → canonical still wins (own row ignored).
   - AI entity → own mapping, unaffected (regression guard).
   - canonical `user` mapping row missing → all-disabled tolerance preserved.
2. **`LoadFullEntityConfig` change:** after loading the entity, if `entity.EntityType == config.EntityTypeUser && entity.ID != "user"` → load the mapping via `GetEntityModuleMapping(tx, "user")` (same missing-row tolerance) instead of the entity's own. Comment: "one voice, many faces — user entities inherit the canonical user module mapping (2026-09-02 ruling)". LifecycleConfig/flags still come from the persona's own row.
3. **Management API guard** (`management/routes_entities.go` `handleUpdateEntityMappings`): load the entity; if `entity_type == 'user' && id != 'user'` → 400 `{"error": "user entities share the built-in user module mapping"}`. Existing behavior for `user` itself and AI entities unchanged. Route tests: persona → 400, `user` → 200, AI → 200 (extend `management/routes_entities_test.go`).
4. Grep sweep: no other per-entity mapping loader bypasses `LoadFullEntityConfig` for runtime use (check `database/sync_utils.go`, eventserver module init paths) — if a bypass exists, route it through the same resolution or document why it's safe.

## Files

- `database/controllers/entity_controller.go` (+ tests)
- `management/routes_entities.go` (+ tests)

## Gates

- `go build ./...` = 0 · `go vet ./...` = 0 · `go test ./...` all green
- Commit: `feat(entities): user entities inherit the canonical user module mapping - one voice, many faces (persona modules 1-1)`

## Checklist

- [x] RED controller tests (inheritance, stray-row ignored, AI regression, missing-canonical tolerance)
- [x] Inheritance implemented in `LoadFullEntityConfig`
- [x] RED route tests + 400 guard on `handleUpdateEntityMappings`
- [x] Bypass sweep documented
- [x] Gates green, committed, phase doc + summary.md updated

## Deviations

- **Q13 symmetric test superseded.** `TestLoadFullEntityConfig_UserEntityWithRAGMapping_Symmetric` (phase 5-3) asserted a `user`-type entity with its own RAG mapping loads that mapping (mapping decides, not type). The 2026-09-02 ruling directly contradicts this for user entities, so that test was rewritten as `TestLoadFullEntityConfig_UserEntityOwnRAGMappingIgnored`: a persona's own RAG mapping row is now a *stray row* and is ignored; the persona inherits the canonical `user` mapping. The AI-entity type-agnostic path is preserved by the new `TestLoadFullEntityConfig_AiEntityUnaffected` guard.
- **New `config/db.GetEntity` facade.** The management guard needed the raw entity row (entity_type) before mutating mappings. There was no `GetEntity` wrapper on the `config/db` facade (it existed only on the controller), so a small `GetEntity(db, ctx, id)` facade was added following the existing facade convention.
- **Bypass sweep result.** All runtime module-config resolution funnels through `controllers.LoadFullEntityConfig` (`hldb.LoadFullEntityConfig` → `eventserver/eventprocessor.go:506` on INIT, `hldb.LoadAllEntities` → `cmd/run.go:255` + `eventserver/synchronization.go:1634` for startup/post-sync cache). `eventserver/synchronization.go:1127,1418` only *writes* raw mapping rows (sync apply) — it never consumes a persona's own mapping for runtime config. `RenameEntity` copies mappings, but the canonical `user` rename is already rejected by the route guard, so no bypass exists. No code change needed beyond `LoadFullEntityConfig`.
