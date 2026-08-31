# 4-1 — App Sync Registration + Centralized PK Registry

> Phase 4 / repo: **harmony-ai-app**. Contract: `21-Engine-Contract` §4.1/§4.3, Q5/Q7.
> Prerequisites: Phase 1 (schema), Phase 3 (read-flags live).

## Objective

Register `character_favorites` + `chat_conversation_settings` for engine sync app-side; build the PK registry.

## 1. PK registry (Q5)

- New `src/database/pkRegistry.ts`: single source `PK_FIELDS: Record<string, string>` =
  `{ entity_module_mappings: 'entity_id', emotion_state: 'entity_id', lifecycle_state: 'entity_id',
     character_favorites: 'profile_id', chat_conversation_settings: 'participant_key' }` (+ default `id`),
  with `getPkField(table)`.
- Replace ALL scattered sites: `getPrimaryKeyField` (`src/database/sync.ts:364-375`) and the five pkField ternaries
  in `SyncService.ts` (:792, :903, :1165, :1252, :1269, :1286) → import from the registry. **NOT behavior-neutral
  (A7)**: the send-path ternaries (:1252/:1269/:1286) key `lifecycle_state` by `id` today while the apply path
  (:792/:903/:1165) keys it by `entity_id` — a pre-existing asymmetry. The registry standardizes on `entity_id`
  (verify against the `lifecycle_state` PK in migration 000040 when implementing); the send-path change is a
  deliberate bugfix — update affected tests, don't paper over the difference.
- `gitnexus_impact` on `getPrimaryKeyField` + `applyBufferedSyncData` first (this is the riskiest refactor of the phase).

## 2. Table registration (both new tables)

1. Upload list: `SyncService.ts:1113-1153` — `character_favorites` after `character_profiles` (FK), `chat_conversation_settings`
   after `conversation_messages` (FK-ish order: participant_key references nothing hard, keep after messages).
2. Apply order `TABLE_ORDER` (`SyncService.ts:851-886`): same relative positions.
3. Soft-delete cleanup list (`SyncService.ts:1492-1525`): both tables appended.
4. Boolean normalization (`sync.ts:189-211`): none needed (all INTEGER columns; `pinned`/`archived` ride as 0/1 —
   confirm Go model uses int64/bool consistently with 0/1 JSON … if Go side sends real booleans for these fields,
   add `chat_conversation_settings: ['pinned','archived']`; decide by the Go model written in 4-2, keep both sides honest).
5. TEXT_TABLES (`sync.ts:9-14`): not needed (no blob-ish columns).
6. FK diagnostics map (`SyncService.ts:1558-1585`): add favorites → character_profiles.

## 3. Per-table initial upload set (Q7, app mirror)

- `src/services/SyncService.ts` or `ConnectionStateManager`: persistent set (AsyncStorage key
  `@harmony_sync_initial_upload_done:<source>`, JSON array) of tables whose initial full upload was completed.
- In the upload path: for each registered table not in the set → `getChangedRecords(table, 0)` (full); on
  `SYNC_FINALIZE` add all registered tables to the set (finalize = session completed, not per-table ack).
- Comment the contract: re-sends are harmless (LWW), the set exists to avoid full re-uploads on every sync.

## 4. Cache invalidation (open screens)

- After `applyBufferedSyncData` applies rows for either table → invalidate/notify: settings rows → ChatList
  debounced reload (reuse the `sync:messages-applied` event from 3-1, generalized to `sync:data-applied` with a
  table list payload); favorites → CharactersScreen favorite ids refresh hook (it already reloads on focus; add the
  subscription for live correctness).

## Tests

- PK registry: table-driven unit test (all registered tables + default); regression: existing sync tests green.
- Initial-upload set: new tables upload with since=0 once; second sync incremental; set persisted.
- Favorites soft-delete/resurrect round-trips through `getChangedRecords`.

## Verification

- [ ] tsc 0; `npm test` green; grep `pkField ?` ternaries in SyncService → zero
- [ ] `gitnexus_impact` before edits; `gitnexus_detect_changes()` before committing
