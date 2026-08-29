# 1-2 — App Migration 000041 Edit (Final Form, Personas Removed)

> Phase 1 / repo: **harmony-ai-app** (branch `senju-design-updates-rebase`).
> Contract: `21-Engine-Contract-Persona-Enums.md` §3.1–3.3, Q4/Q5/Q6/Q8/Q15.
> Pairs with 1-1: the two commits must land in lockstep (local parity compare green between them).

## Objective

Edit the **pre-mainline** `src/database/migrations/000041_consolidate_senju_features.ts` (B5 precedent — folding
into pre-release migrations is approved; only dev devices ever ran it) into its FINAL form:

1. Replace the `personas` CREATE with **nothing** (table dies; Q10 — personas become user entities; conversion
   skipped, wipe note covers).
2. Replace the three `ALTER TABLE conversation_messages ADD COLUMN …` + pinned index with the **canonical
   `_new`-table rebuild** (identical SQL to engine 1-1; includes `reply_to_message_id` + `is_read`).
3. Replace `character_favorites` with the synced shape (watermark triple, `favorited_at` dropped).
4. Replace `chat_conversation_settings` with the slimmed shape (drop `unread_count`, `muted`, `blocked`; add
   `reply_mode TEXT NOT NULL DEFAULT 'realistic'`, `deleted_at`).
5. Update the header comments: rationale, `000039` reserved-placeholder note (keep), **extended dev-DB-wipe note**
   (devices that ran ANY earlier build of this branch — old 000041, old settings shape, personas table, shim
   entities — need the one-time wipe; the edited migration never re-runs for them).

## Implementation notes

- **PRAGMA foreign_keys**: the rebuild drops `conversation_messages` (referenced by nothing via FK app-side, but be
  safe) — wrap like `000037` did (`PRAGMA foreign_keys = OFF` before, `ON` after; rationale documented at
  `000037:10-19`).
- The app INSERT SELECT source list = the app's current columns (includes `reactions_json`, `reply_to_message_id`,
  `is_pinned` already present from the restored reply feature); the engine's list (1-1) differs — both must
  produce identical final DDL text.
- **Code that breaks at this commit and must be updated in the SAME commit** (green-commit rule — these are direct
  schema consumers; deeper rewiring is Phases 3–5):
  - `src/database/models.ts` — remove `unread_count`/`muted`/`blocked` from the settings model; add `reply_mode`;
    keep message model (already has all fields; add `is_read?: boolean`).
  - `src/database/repositories/chatConversationSettings.ts` — interim-compile: drop mute/disable/unread functions
    and columns from mapping/upsert; keep pinned/archived/get/batch (Phase 4-4 does the full rewiring; keep the file
    honest — no dead columns).
  - `src/database/repositories/characters.ts` favorites fns — add `updated_at`/`deleted_at` handling to
    add/remove (soft-delete tombstones now; `removeCharacterFavorite` sets `deleted_at`, `addCharacterFavorite`
    clears it on resurrect).
  - `src/database/repositories/personas.ts` + screens importing it — **Phase 5 rewires these**; to stay green NOW,
    keep the `personas` repo compiling by having it create/access the table ONLY if it exists → NOT acceptable
    (orphaned DB access rule). Instead: minimum viable bridge — the repo's create/list functions switch to the
    entities-backed implementation in Phase 5; for THIS commit, delete the personas table access and stub the repo
    surface (`getAllPersonas` returns `[]`, create throws "personas are user entities now") with TODO(5-4) —
    persona UI is explicitly broken-until-Phase-5 (acceptable: dev branch, documented).
  - Migration snapshot tests: regenerate (`npx jest --selectProjects unit --testPathPatterns migrations -u`).
- Update `scripts/dump-schema.ts` — delete `personas`, `character_favorites`, `chat_conversation_settings` from
  `CLIENT_ONLY_TABLES` and (with 1-4) the whole mechanism; do the entry deletions HERE so the dump reflects
  reality the moment the mirror exists.

## Files

- Modify: `src/database/migrations/000041_consolidate_senju_features.ts`, `src/database/migrations.ts` (description
  string), `src/database/models.ts`, `src/database/repositories/chatConversationSettings.ts`,
  `src/database/repositories/characters.ts`, `src/database/repositories/personas.ts`, `scripts/dump-schema.ts`
- Regenerate: `src/database/__tests__/__snapshots__/migrations.*.snap`, `schema/rn-schema.json`

## Verification

- [ ] `npx tsc --noEmit` = 0; `npm test` green (snapshots updated)
- [ ] `npm run schema:dump -- --output schema/rn-schema.json`; local compare vs engine branch dump:
      the three objects MATCH; `personas` absent from the dump; no new divergences
- [ ] Wipe note present in the migration header; personas repo stub TODO(5-4) documented
- [ ] `gitnexus_impact` on touched symbols (e.g. `getChatConversationSettings`) before editing;
      `gitnexus_detect_changes()` before committing
