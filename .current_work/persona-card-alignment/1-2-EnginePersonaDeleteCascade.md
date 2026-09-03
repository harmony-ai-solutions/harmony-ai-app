# 1-2 — Engine: Persona Delete Cascade

> Repo: `harmony-link-private`, branch `feat/engine-track-phase2`. TDD.
> Files: `management/routes_entities.go` (+ tests). May touch profile/image deletion helpers in `routes_character_profiles.go` (reuse, don't duplicate).

## Objective (decision 1)

Deleting a persona cleans up entity + its owned card (and card images) — no orphans.

## Behavior

- `handleDeleteEntity` for a `user`-type entity: after existing entity teardown (eventserver teardown, sync tombstone etc. — verify current flow), also delete the owned `character_profiles` row + its images, **in the correct FK order** (profile delete must come after the entity row delete — `character_profile_id` FK is `ON DELETE RESTRICT`; reuse/extract the same image+profile deletion path the character-profile DELETE route uses so image cleanup semantics match).
- Built-in `user` remains undeletable (existing guard/test — no change).
- AI entity delete behavior unchanged (profile survives, as today).
- **Cascade is unconditional** — user verified no dual-referenced profiles exist (decision 10), and 1-1 guards make the state impossible going forward. If a FK violation ever surfaces anyway, let the existing error path report it (no silent skip).
- Sync consideration: profile + images get their normal delete tombstones through existing sync paths (profile deletion already syncs; verify image rows propagate — add a sync test if the harness covers profile deletes; otherwise document verification).

## Tests (RED first)

- Delete persona → entity gone AND profile gone AND images gone.
- Delete AI entity → profile still present (no regression).
- Delete built-in `user` → still rejected.

## Gates

`go build ./...` && `go vet ./...` && `go test ./...` exit 0.
Commit: `feat(entities): persona delete cascades owned character profile and images (persona cards 1-2)`

## Checklist

- [ ] Cascade + FK ordering verified
- [x] No stale-data handling needed (decision 10: unconditional cascade; FK error path surfaces if ever hit)
- [ ] Gates green, committed
