# 5-1 — Engine: Deleted-List & Restore Management API

## Objective

Make soft-deletion a first-class lifecycle: list deleted entities, restore them. Implements the deletion
strategy (**D1/D4/D9** — tombstones forever + explicit restore as the only path back; resurrect ≡ restore).

## API Contract (management API, port 28081 — gin router)

| Endpoint | Behavior |
|---|---|
| `GET /api/entities/deleted` | Returns tombstoned entities (both `ai` and `user` types), slim `EntityConfig` shape + `deleted_at`, ordered by `deleted_at desc`. **Routing (verified):** gin 1.10.1 resolves static before `:id` (precedent: `/character-profiles/import` beside `/:id`, `management/server.go:362-366`), so this coexists with `GET /api/entities/:id` (`management/server.go:391` — path corrected in review 2) without panic — and the reserved id `deleted` (D10) guarantees no entity is shadowed. |
| `POST /api/entities/:id/restore` | Resurrect via the **shared `RestoreEntity` helper (D9 — identical logic to the 1-1 sync-apply resurrect branch)**: capture the tombstone's `deleted_at`, set the entity row live (`deleted_at = NULL`, `updated_at` bumped **above the tombstone's** — required or the app's LWW gate drops the resurrect, `SyncService.ts:1069`), then equality-resurrect the cascaded children. 200 slim entity; 404 unknown; 409 `entity is not deleted`. |
| Audit both in `docs/api/management/openapi.yaml` (**correct path — `docs/openapi.yaml` does not exist**) — partially addresses ledger **N6** (entity routes are currently entirely undocumented there). | |

## Implementation Steps

1. **Prerequisite — unified cascade stamp (ruling D17, review-2; extended by D25/D26 in review 3; count
   fixed review 4):**
   `DeleteEntity` (`entities.go:160-222`) currently stamps each of its cascade UPDATEs with its own
   `CURRENT_TIMESTAMP`, and the persona route deletes profile + entity in two separate calls
   (`routes_entities.go:442-447` — two repo calls inside one `WithTransaction`, each stamping
   independently). Change to ONE captured `now` (Go-side, UTC, second-truncated) used for
   the entity row + all cascade UPDATEs + the profile delete; cascade UPDATEs gain `AND deleted_at IS NULL`
   so already-tombstoned children keep their earlier independent stamps. **D26 (review 3; count corrected
   review 4): the cascade grows to entity + 8 children** — `chat_conversation_settings` and
   `lifecycle_state` join (neither is tombstoned today). D17 becomes "**9 stamps, one captured `now`**".
   **D25 (review 3, completed review 4): the same captured-now helper is used by all sync delete ops,
   `DeleteEmojiAction` (gains its missing `deleted_at IS NULL` guard), AND the profile/image sync
   deletes (`DeleteCharacterProfileForSync` + its image cascade `character_profiles.go:258, 265`,
   `DeleteCharacterImage` `images.go:157`)** — without this, sync-arrived tombstone families carry
   divergent stamps and the matcher below misses children (the engine re-stamps children's `deleted_at`
   at apply time today). The persona profile+entity pair then shares one stamp
   and restores together. *(Review-4 implementation note: a `now time.Time` param on `DeleteEntity` —
   one function with 8 internal UPDATEs — and on the per-table sync-delete fns; no struct threading.
   The helper lives in a leaf package reachable from every repo (`models` or a new import-free
   package — NOT eventserver/controllers; the import graph forbids it.) The persona profile+entity pair then shares one stamp
   and restores together.*
2. Repository: `ListDeletedEntities` + `RestoreEntity` in `database/repository/entities/entities.go` /
    `database/controllers/entity_controller.go`, **shared with 1-1's sync-apply resurrect** (same function,
    parameterized by entity id + the tombstone's pre-overwrite `deleted_at`).
    *(Review-4: the restore route loads the tombstone via the **unfiltered**
    `GetEntityIncludingDeleted` — `GetEntity` filters `deleted_at IS NULL` and 404s tombstones
    (`entities.go:33-49`).)*
    **Matcher (D17 + D25):** identify cascade-tombstoned children via **parsed-instant equality,
    second-truncated** against the captured `deleted_at` — never string equality (engine format A/B and
    app ISO-ms cascades must compare as instants; live-verified review 5: formats A/B/C coexist in one
    DB, so a SQL `WHERE deleted_at = ?` string comparison cannot work — the matcher is GO-side).
    **Review-5 deliverable:** the **shared 3-format timestamp parser** (new, leaf package — `models` or
    an import-free util; also required by 3-1's Go migration (D62) and reusable by 1-1) — name it once,
    test it against 6-1 §2's vectors; do NOT write a third ad-hoc parser. Sound for engine-native AND sync-arrived tombstones
    **because D25 unified the delete-op stamps** (pre-D25, the engine re-stamped children's `deleted_at`
    at apply time — `interactions.go:242-245`, `messages.go:166`, `memory.go:144`, `emoji_action.go:72` —
    which would have defeated the matcher for the mainline post-Phase-4 delete path).
    **D53 (review 4):** `emotion_state`/`lifecycle_state` are NOT part of the guaranteed
    child-resurrection set — they are ephemeral (D1 carve-out; an interim `INSERT OR REPLACE` may
    legitimately have rewritten them live). The uniform matcher may resurrect them when still tombstoned
    with the unified stamp, but tests must not assert it (state re-creates on first use).
    *(Review-4 evaluated & rejected: a dedicated `deleted_cascade_at` column — it would break the
    cross-repo migration-numbering parity contract (every engine migration mirrors app-side,
    `migrations.go:290-295`) and the 3-format parser is required by 3-1 anyway; keep instant-equality
    with no window tolerance.)*
    **Legacy caveat (accepted):** tombstones created by the pre-D17/D25 code restore best-effort (a
    second-boundary crossing may miss children) — document; do not add window tolerance.
    **Alias-collision guard (added with D41 — 5-3 parity fallout):** if the tombstone's `alias` is held by a
    **live** entity at restore time, re-suffix via `ResolveAliasCopy` before resurrecting — the partial
    unique index on `alias WHERE deleted_at IS NULL` would otherwise abort the restore (and, for app-initiated
    restores, the engine's sync apply of the resurrect). The same guard is mirrored app-side in 5-3.
3. **Cascade scope (D26 — rewritten in review 3; count fixed review 4)**: `DeleteEntity` tombstones
      (post-D26) `entity_module_mappings`, `entity_emoji_actions`, `memories`, `emotion_state`,
      `interactions`, `conversation_messages`, **`chat_conversation_settings`, `lifecycle_state`** (8
      children) — restore mirrors exactly this set (emotion/lifecycle best-effort per D53). **Remaining exclusion (document):** partner-side mirror rows (e.g. the
      `user`-owned interaction); the persona profile is deleted by the route and restored via the D17
      unified stamp (step 1). **(Review-5 note: `chat_conversation_settings.entity_id` is unindexed —
      the PK is `participant_key` — so the new cascade UPDATE is a full-table scan; acceptable at current
      scale, add an index in a later migration only if it matters.)**
4. **Runtime state (D16)**: restore needs NO session guard (nothing legitimately attached to a tombstoned
   id) but DOES run the shared zombie teardown (**helper in `eventserver` — review-5 home fix, see
   2-1b**; stop runner/emotion-engine if a pre-fix delete leaked one —
   the incident's `Isabella` tombstone may have lingering state in a long-running process), then
   `RefreshEntityCache` (`routes_entities.go:125-137` — the existing post-mutation pattern) so the next
   INIT_ENTITY finds it.
5. **Sync propagation**: the restored row's `updated_at` (**D29: `max(incoming, engine-now UTC)` — the
    engine tombstone's `updated_at` is pre-delete while the app's is delete-time, so anything weaker can
    be dropped by the app's LWW gate, `SyncService.ts:1069`) makes `GetChangedEntities`
    (`database/sync_utils.go:302-331`) emit it; with 1-1 + 4-1 resurrect support both directions land
    correctly (engine sync-out must carry the `deleted_at: null` key — 1-1 step 5, incl. the three
    `omitempty` tag fixes). Add an explicit engine test: restore → sync out → client apply → live.
6. **Greeting semantics (D9 — no guard change)**: the greeting guard stays **live-only**
   (`HasPriorConversation` → `FindPriorInteractions`, `interaction/interactions.go:279-317`). Because restore
   resurrects the interactions/messages back to **live**, the guard sees prior history and correctly suppresses
   a fresh greeting — what must be tested is **restore completeness**: restored entity with prior messages →
   history visible in UI → no new greeting. (Do NOT make the guard tombstone-aware — see D9.)
7. **Persona restore caveat**: restoring a `user` persona whose profile was cascade-deleted — the profile
   restore follows the D17 unified stamp; if the profile was separately purged/restored, surface a 409
   with guidance. Keep v1 simple; document. (Note: `user` itself cannot be deleted via the API —
   `PersonasView.jsx:337` blocks it — so the user-persona restore path is mostly theoretical.)
8. Management tests (`routes_entities_test.go` currently 33; package 39): list shape, restore transitions,
   404/409, cache refresh, sync-out resurrect (payload includes `deleted_at: null`), greeting suppression
   via restore completeness, **unified-stamp delete → complete restore** (D17 regression lock;
   emotion/lifecycle resurrection NOT asserted — D53).

## Files to Modify

- `database/repository/entities/entities.go`, `database/controllers/entity_controller.go` (shared helper with 1-1)
- `management/routes_entities.go` (routes + cache refresh)
- `docs/api/management/openapi.yaml`

## Checklist

- [ ] `GET /api/entities/deleted` (static route, no `:id` shadowing)
- [ ] `POST /api/entities/:id/restore` (+ child resurrect via shared D9 helper, cache refresh, updated_at bump)
- [ ] Equality matcher verified for engine-native AND sync-arrived tombstones
- [ ] Sync-out resurrect test (payload carries `deleted_at: null`); greeting-suppression test (restore completeness)
- [ ] openapi documented at the correct path; tests green; phase doc updated
