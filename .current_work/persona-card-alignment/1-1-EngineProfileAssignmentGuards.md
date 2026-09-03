# 1-1 — Engine: Profile-Assignment Guards

> Repo: `harmony-link-private`, branch `feat/engine-track-phase2`. TDD: write failing tests first.
> File: `management/routes_entities.go` (+ `routes_entities_test.go`).

## Objective (decision 1)

Persona-owned cards must never be linkable to AI entities; persona↔profile stays 1:1. API-level guard = defense in depth covering both frontends.

## Guards

1. **AI entity guard** — in `handleCreateEntity` and `handleUpdateEntity`, when the target entity is (or will be) `entity_type='ai'`: reject with 400 if the supplied `character_profile_id` is currently referenced by ANY `user`-type entity. Message: `"character profile is owned by a persona"` (align with existing error style).
2. **Persona 1:1 guard** — when creating/updating a `user`-type entity (persona): reject with 400 if the supplied profile is already referenced by a DIFFERENT user entity. (The canonical `user` mapping update path `handleUpdateEntityMappings` is untouched — module mapping only.)
3. Guard evaluation must run against the DB state inside the same request; return 404 semantics for missing entities/profiles unchanged.

## Tests (RED first)

- Create AI entity with persona-owned profile → 400 + message.
- Update AI entity onto persona-owned profile → 400.
- Update AI entity onto unlinked/AI-owned profile → 200 (no regression).
- Create persona with profile already owned by another persona → 400.
- Update persona onto its OWN profile (no-op change) → 200 (self-reference must not trip the guard).
- Built-in protections unchanged (existing tests keep passing).

## Gates

`go build ./...` && `go vet ./...` && `go test ./...` all exit 0.
Commit: `feat(entities): guard character profile assignment - persona cards cannot link to AI entities, persona-profile 1:1 (persona cards 1-1)`

## Checklist

- [ ] Guards + messages
- [ ] RED→GREEN tests
- [ ] Gates green, committed
