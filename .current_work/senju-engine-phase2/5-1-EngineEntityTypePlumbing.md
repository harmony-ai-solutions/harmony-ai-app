# 5-1 — Engine entity_type Plumbing

> Phase 5 / repo: **harmony-link-private**. Contract: `21-Engine-Contract` Q9, §5.1. Prerequisite: 1-3.

## Objective

`entity_type` (+ flags) flow through models, repo, sync, runtime cache, and client discovery.

## Changes

1. **Models** (`database/models/entity.go`): `Entity` += `EntityType string`, (flags from 4-3 if not yet);
   `EntitySync` += `EntityType *string`; `ToSyncModel`/`ToDBModel` round-trip; decode-default safety beside the
   existing `LifecycleConfig` fallback (:65-68): empty `entity_type` → `'ai'`.
2. **Repo** (`database/repository/entities/entities.go`): `CreateEntity` (:11-22) INSERT += `entity_type` (callers
   must pass; default 'ai' at call sites); `GetEntity`/`ListEntities`/scan helpers column lists in lockstep;
   `UpdateEntity` (:100-121) allowlist += nothing (type is immutable post-creation by convention — document).
3. **Sync** (`database/sync_utils.go:30-33` `queryGetChangedEntities` + scan :310): += `entity_type` (and flags);
   apply case (`synchronization.go:1306-1324`) round-trips them (app-created user entities arrive typed correctly).
4. **Runtime cache**: `config.EntityConfig` (`config/types.go:6-11`) += `EntityType`, `IsMuted`, `IsDisabled`;
   `LoadFullEntityConfig`/`LoadAllEntities` (`database/controllers/entity_controller.go:251-320, 383-399`) populate
   them; cache rebuild paths stay type-agnostic otherwise (they already carry the row).
5. **Discovery**: `events.EntityInfo` in `handleFetchConfiguredEntities` (`eventprocessor.go:906-934`) response +=
   `entity_type`, `is_muted`, `is_disabled` (app uses this later for UI filtering; additive wire change).
6. **Management API** (`management/routes_entities.go`): create-entity handler accepts optional `entity_type`
   (default 'ai'); update handler rejects `entity_type` changes (immutable); list endpoints carry the column.
7. **Seeder tagging** (`config/db/init.go`): `claire` → `'ai'` explicitly; `user` → `'user'` explicitly (belt-and-braces
   with the 000042 backfill).

## Tests (TDD — red → green)

- **RED first**: round-trip test (sync model preserves type + flags; empty-string decode → 'ai') — compile-fails
  before the fields exist.
- **RED first**: cache test (entity loaded with correct type) + FETCH response includes new fields
  (snapshot/assert) — fail before plumbing.
- Management: create with/without type; type-change rejected (red before the handler guards).

## Verification

- [ ] `go build ./...`; `go test ./...` green
- [ ] `gitnexus_impact` on `LoadAllEntities`, `CreateEntity`, `handleFetchConfiguredEntities` before editing;
      `gitnexus_detect_changes()` before committing
