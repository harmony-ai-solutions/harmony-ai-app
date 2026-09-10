# 16 — Engine Phase 2 Post-Alignment Record (Persona Cards, FE Bugfixes, Id/Alias Hardening & App Parity)

> Continuation of the engine-track phase-2 record chain (companion to [`15-Engine-Phase2-Record.md`](15-Engine-Phase2-Record.md)),
> covering 2026-09-02 → 2026-09-04 on `feat/engine-track-phase2` (engine + nested `frontend/` repo) and
> `senju-design-updates-rebase` (app). Per-wave plan folders with ticked checklists:
> [`.current_work/persona-shared-modules/`](../persona-shared-modules/),
> [`.current_work/persona-card-alignment/`](../persona-card-alignment/),
> [`.current_work/app-parity-fixes/`](../app-parity-fixes/). **No merges to `main` anywhere (Q16 unchanged).**

## Status

| Wave | State | Engine commits | Engine-FE commits (nested repo) | App commits |
|---|---|---|---|---|
| Persona shared modules (streaming, entity-context) | ✅ (recorded in own folder + memory bank) | `2f41756`, `df1295f`, `3536554` | `6dc400f`, `9605e55`, `5b9c784` (+ rejected nav variants, cleaned up) | `7e35b4c`, `0854bce` |
| Persona card alignment (waves 1–3, decisions 1–15) | ✅ (recorded in own folder) | `be1fa62`, `1cedcc3`, `28847da` | `6aee7d3`, `ed28e84`, `e9fcb34`, `3265f1e`, `0ab51ed`, `50f27de` | `dd479ce`, `4cea501`, `4c81c4c`, `b1b8340` |
| Post-alignment loop: FE persona bugfixes (5) | ✅ | — | `e47e130`, `d47bac6`, `3051903`, `3d26a0a` | — |
| Id/alias hardening + atomic duplicate | ✅ | `eb1124e`, `08ccdf4`, `783105f`, `7a81fe1`, `ed517ea` | `e471d16`, `a3facf8`, `3f9931e`, `be3f5a7`* , `c3e4859`, `fae83b8` | — |
| App parity wave (batches A–D) | ✅ | — | — | `4622210`, `1b3d359`, `df1f6bf`, `d1006e0`, `f39de6c`, `5023e78`, `54e903a` |

\* `be3f5a7` (FE id-conflict retry loop) was **superseded and removed** by `c3e4859` after the user rejected
client-side retrying in favor of server-side resolution — kept in history for the decision trail.

## Session decisions (2026-09-03/04, binding)

1. **Server-side id resolution over client retry** — the FE retry loop was replaced by engine `dedupe_id_if_taken`
   (in-transaction next-free id, ghost-aware). Client-side "find free id" can never be complete: the `entities.id`
   PK spans **soft-deleted rows** while every list/read filters `deleted_at IS NULL`.
2. **Opt-in flag semantics preserved** — explicit-id creators (persona editor name=id, add-entity dialog) keep
   exact-id-or-400; the flag exists for **derived** ids only. (Rationale corrected in review: the management API
   serves only the Wails UI; the app never calls it — the seam is user-typed vs derived, not sync.)
3. **One-click entity copy** — `POST /entities/:id/duplicate` (AI only): same profile LIVE-linked, mappings +
   lifecycle verbatim, muted/disabled reset, id (`base-2` series, ghost-aware) and alias (`"Name 2"` series,
   live-aware) server-derived. FE copy prompt retired (user-approved UX change).
4. **App "create AI from existing card" = LIVE LINK** (user ruling) — the app's fork path for that entry is
   retired; the shared card is referenced, not copied. V3 field-fidelity fix became moot.
5. **Cross-device id collisions accepted as-is** (user ruling: "only cover Wails") — LWW merge on sync is a
   documented known limitation (see ledger below).
6. Favorites + i18n complaints closed: nothing favorites-related was ever deleted (RN intact + test-pinned;
   engine FE never had favorites); all new strings keyed, service literals wrapped by i18n'd UI messages.

## Engine management API contract deltas (this session)

- `POST /entities` body: optional `alias` (persisted atomically) and optional `dedupe_id_if_taken: true`
  (ghost-aware in-transaction id resolution; 201 echoes the **resolved** id).
- `POST /entities/:id/duplicate` (no body; AI entities only) → 201 slim entity; 404 `entity not found`;
  400 `persona entities cannot be duplicated`.
- Clean 400s: `entity alias is already in use` (create + update, self-reference allowed) and
  `entity id already exists` (create, live **or** soft-deleted) — both with defense-in-depth translation of
  residual UNIQUE-constraint driver errors.
- Payload shape reminder (caused two FE bugs): the entity list/get response is `EntityConfig` — **no top-level
  `character_profile_id`**; the profile is embedded as `character_profile` (non-pointer: empty id ⇒ profile-less).

## The ghost-id saga (chronology)

1. `UNIQUE constraint failed: entities.alias` 500 on the alias-sync PUT → atomic alias-on-create + 400s
   (`eb1124e`, `08ccdf4`) + FE dedupe (`e471d16`).
2. `UNIQUE constraint failed: entities.id` 500 — id held by a **soft-deleted** row (invisible to the FE list;
   triggered by deleting an orphaned entity) → clean 400 (`783105f`) → FE retry loop (`be3f5a7`) → **rejected
   by user** → server-side resolution A+B (`7a81fe1`, `ed517ea`) → retry machinery removed, one-click copy
   (`c3e4859`, `fae83b8`).
3. App parity review found the **same blind spot app-side** (local SQLite PK also spans soft-deleted rows;
   recreate-after-delete hit the ghost PK and orphaned the profile) → fixed with ghost-aware
   `resolveNextEntityIdCopy` + create compensation (`4622210`), `duplicateAIPartner` (`1b3d359`), plus screens.
4. **Subagent lesson:** the data-layer agent could not find the engine reference (looked at origin refs —
   `feat/engine-track-phase2` is **local-only, never pushed**) and implemented from spec; the audit against the
   real reference found one ordering divergence (strip-before-verbatim) → fixed `d1006e0`. **Rule: subagents
   read reference repos at their absolute local paths, never via remote refs.**

## Verification state

- Engine: `go build`/`go vet`/`go test ./...` all 0 (management suite grew 21 → 33 tests across the session).
- Engine FE: `npm run build` exit 0 per commit (no test runner exists in that repo — static traces only).
- App: `tsc` 0; final **125 suites / 1108 unit + 52 integration (+1 known skip)**; flakes (`nodeSide`,
  `nodeDatabase.smoke`) proven isolated-green each time.
- Schema parity: **unchanged 55/55 + 3 Go-only allowlisted** — no migrations this entire record (all fixes were
  behavioral; the alias column/index existed since `000018`/`000042`).
- Unchanged pending from 15: coordinated **engine-first** mainline merge order; on-device smoke list.

## Follow-up ledger (NEW items — extends 15's "intentionally NOT fixed / deferred ledger")

| # | Item | Where | Severity |
|---|---|---|---|
| N1 | **Sync-apply ghost-PK failure**: app→engine sync of an id held by an engine-side soft-deleted row raw-INSERT-fails (`eventserver/synchronization.go` entities case — `GetEntity` filters deleted, `CreateEntity` hits the PK). Fix shape: ghost-aware existence probe in sync apply (replace instead of insert). | engine | Med |
| N2 | **Cross-device derived-id LWW merge** (two devices derive the same name between syncs → silent LWW overwrite of *different* entities). Accepted as known limitation by user 2026-09-04; structural fixes (UUID ids / namespacing / sync-time rename-on-conflict) all deferred. | architecture | known-limitation |
| N3 | **Space-containing entity ids** (RN persona convention `"Max 2"`) — verify round-trip through engine sync → management `/entities/:id` URL paths before ever normalizing id charsets. | engine+app | Open ❓ |
| N4 | **`renameEntity` onto a ghost id** returns a raw constraint error (same class as the create-path fix `783105f`; create-path only was scoped). | engine | Low |
| N5 | **Engine FE**: editor-variant export menu can clip via the editor modal's `overflow-hidden` (pre-existing positioning). | engine FE | Low |
| N6 | **Management `openapi.yaml` is partial** — `/api/entities`, `/api/characters*`, `/api/character-profiles*` routes (incl. everything in "contract deltas" above) were never documented in the spec. | engine docs | Med |
| N7 | **App full-render harness gaps**: CreateAIScreen / AIProfileScreen / ChatListScreen (RN 0.86 node-env crash) — this wave's screen logic is statically traced + seam-tested only. | app | Med |
| N8 | **App GitNexus `gitnexus_query` returns empty** even after `analyze` (FTS/vector pipeline broken in this CLI build); graph tools (impact/context/cypher/detect_changes) work. | app dev-infra | Low |
| N9 | (carried) 2026-09-07 legacy sweeps — see 15's ledger, unchanged. | app | sched |

## Engine-FE notes for the record

- The nested `frontend/` repo is its own git repo on the same branch name; it has **no docs system** — this
  record + commit messages are its documentation (nav Variant C chosen over B; persona tab search/card-size;
  export menu uses `.nav-menu-panel` glass treatment).
- Favorites: engine FE intentionally has **no** favorites feature (RN-only, `character_profiles.is_favorite`).
