# Repository Test Gaps

## Identified During Phase 3-3 Porting

### 1. NOT NULL Constraint Mismatches (Test Values vs Schema)

**Issue:** Many repository function types allow `null` for fields that the SQLite schema defines as `NOT NULL ... DEFAULT`. These fields fail with `SqliteError: NOT NULL constraint failed` when tested with `null` values via the NodeDatabase adapter.

**Affected tables/fields:**
| Table | Field | Schema Default | Type allows null? |
|-------|-------|---------------|-------------------|
| `character_profiles` | `description`, `personality`, `appearance`, `backstory`, `voice_characteristics` | `DEFAULT ''` | Yes (in model) |
| `character_profiles` | `lifecycle_config` | `DEFAULT '{}'` | Yes (in model) |
| `entities` | `lifecycle_config` | `DEFAULT '{}'` | Yes (in model) |
| `entities` | `alias` | None (NOT NULL) | Yes (alias defaults to `''`) |
| `provider_config_openai` | `max_tokens`, `temperature`, `top_p`, `n`, etc. | `DEFAULT 0` or `DEFAULT ''` | Yes |
| `provider_config_openrouter` | Same pattern | `DEFAULT 0` or `DEFAULT ''` | Yes |
| `movement_configs` | `startup_sync_timeout`, `execution_threshold` | `DEFAULT 0` | Yes |
| `cognition_configs` | `max_cognition_events`, `generate_expressions` | `DEFAULT 20`, `DEFAULT 1` | Yes |
| `stt_configs` | `main_stream_time_millis`, etc. | `DEFAULT 0` | Yes |
| `tts_configs` | `output_type`, `words_to_replace`, `vocalize_nonverbal` | `DEFAULT ''`, `DEFAULT 0` | Yes |
| `rag_configs` | `embedding_concurrency` | `DEFAULT 0` | Yes |

**Recommendation:** Either:
- Update model types to reflect schema defaults (e.g., `lifecycle_config` defaults to `'{}'` not `null`)
- Or make repository functions apply defaults before INSERT

### 2. `cleanupOrphanedMemories` Behavior Changed

The deleted test file (`memories.test.ts`) tested the old implementation which linked memories to `conversation_messages`. The current implementation (Phase 5+) links memories via `interactions.memory_id`. Ported tests were updated to match the current implementation.

### 3. Missing Coverage Areas

| Area | Missing Tests | Priority |
|------|--------------|----------|
| Soft-delete (`deleted_at`) semantics | `getEntity(includeDeleted=true)`, `getCharacterProfile(includeDeleted=true)` | Medium |
| `getAllEntities(includeDeleted=true)` | Never called with the flag in any test | Low |
| FK RESTRICT constraints | Partially covered in `cross-repo.test.ts` | Low |
| Number-binding divergence | No INTEGER column round-trip tests | Low |
| `MemoryRepository` CRUD | Only `insertMemory` and `getMemoriesForEntity` used as setup; no `upsertMemory` or delete tests | Medium |
| `EmotionStateRepository` | Zero coverage | Low |
| `EmojiActionRepository` | Zero coverage | Low |
| `SyncRepository` (`createSyncDevice`, `getSyncDevice`, etc.) | Zero coverage | Low |
| `ConversationMessageRepository` (create, get, update, delete) | Zero coverage (only used as setup in memory tests) | Low |
| `InteractionRepository` | Zero coverage | Low |

### 4. Trivially-True Tests (Improved During Porting)

The original "Get All Entities" and "Get All Character Profiles" tests had no assertion on the return value — they only verified "no throw". During porting, these were improved to assert on count after creating known fixtures.

### 5. NodeDatabase: Callback-Based Transaction Handling Fixed

**Bug:** `NodeDatabase.makeTx()` ignored executeSql callbacks (successCallback/errorCallback). Repository functions using the callback-based `db.transaction(fn, errCb)` pattern (most provider config repos and character image functions) would hang indefinitely because the Promise was never resolved.

**Fix applied:** `nodeDatabase.ts` line 161-172: updated `makeTx()` to invoke callbacks based on Promise resolution.

### 6. Schema `NOT NULL` Defaults Do Not Apply in NodeDatabase

Unlike React Native's SQLite adapter where `null` bound to a `NOT NULL DEFAULT X` column inserts the default value, `better-sqlite3` (used by NodeDatabase) rejects the `null` with a NOT NULL constraint failure. This is a fundamental difference between SQLite drivers.

Tests must always provide explicit default values matching the schema's `DEFAULT` clause rather than relying on the driver to apply defaults.

### 7. `createCharacterImage` and `setPrimaryImage` Use Callback Transactions

These functions use the callback-based `db.transaction()` form. The `NodeDatabase` now handles this correctly (see fix #5), but it means these functions test the callback path while most other repositories use the `withTransaction` Promise-based path.
