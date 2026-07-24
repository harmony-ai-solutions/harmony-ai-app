# Test Cases Inventory — Pre-Deletion

This document enumerates every test case in the hand-rolled DB test files that
were deleted in Phase 1-2. Phase 3-3 uses this as input for porting them to
real Jest tests using the `NodeDatabase` adapter.

The original files used a custom `runTestWithCleanup(name, fn)` wrapper that:
- Ran the test function
- Recorded pass/fail with duration
- Called `clearDatabaseData(true)` between every test for isolation

The new Jest tests (Phase 3-3) should use `beforeEach` with a fresh
in-memory migrated DB (`useFreshDatabase()` fixture) for the same isolation.

**Totals:** 47 test cases across 5 files.

---

## entities.test.ts → `src/database/__tests__/repositories/entities.test.ts`

Exports `runEntityTests()`. **11 tests.**

| # | Test name | What it tests | Expected behavior | Repository functions exercised |
|---|-----------|---------------|-------------------|-------------------------------|
| 1 | Create Entity | Insert a new entity with a generated ID and verify the returned record matches | Returned entity has the same ID | `createEntity` |
| 2 | Get Entity | Create then fetch by ID | Retrieved entity's ID matches | `createEntity`, `getEntity` |
| 3 | Get Non-existent Entity | `getEntity('non-existent-id')` | Returns `null` | `getEntity` |
| 4 | Get All Entities | Fetch the full list | No throw (no assertion on count) — improve in Jest port | `getAllEntities` |
| 5 | Update Entity | Create then update with same data | Returns truthy (no throw) | `createEntity`, `updateEntity` |
| 6 | Create Entity Module Mapping | Create entity, then create its module mapping | No throw | `createEntity`, `createEntityModuleMapping` |
| 7 | Get Entity Module Mapping | Create entity + mapping, then retrieve | Mapping returned truthy | `createEntity`, `createEntityModuleMapping`, `getEntityModuleMapping` |
| 8 | Update Entity Module Mapping | Create entity + mapping, then update with same data | No throw | `createEntity`, `createEntityModuleMapping`, `updateEntityModuleMapping` |
| 9 | CASCADE Delete Test | Create entity + mapping, delete entity, verify both are gone | `getEntity` and `getEntityModuleMapping` both return null (FK CASCADE worked) | `createEntity`, `createEntityModuleMapping`, `deleteEntity`, `getEntity`, `getEntityModuleMapping` |
| 10 | Update Non-existent Entity (Error Handling) | `updateEntity({ id: 'non-existent-id', ... })` | Throws (any error message other than the sentinel) | `updateEntity` |
| 11 | Delete Non-existent Entity (Error Handling) | `deleteEntity('non-existent-id')` | Throws | `deleteEntity` |

---

## characters.test.ts → `src/database/__tests__/repositories/characters.test.ts`

Exports `runCharacterTests()`. **14 tests.** All character profile creations
use a full set of fields set to `null` (except `name`).

| # | Test name | What it tests | Expected behavior | Repository functions exercised |
|---|-----------|---------------|-------------------|-------------------------------|
| 1 | Create Character Profile | Create with all fields populated | No throw | `createCharacterProfile` |
| 2 | Get Character Profile | Create then fetch by ID | Retrieved ID matches | `createCharacterProfile`, `getCharacterProfile` |
| 3 | Get All Character Profiles | Fetch list | No throw (no count assertion) | `getAllCharacterProfiles` |
| 4 | Update Character Profile | Create then update description | No throw | `createCharacterProfile`, `updateCharacterProfile` |
| 5 | Check Profile In Use | Create profile, check `isCharacterProfileInUse` | Returns `false` (not linked to any entity) | `createCharacterProfile`, `isCharacterProfileInUse` |
| 6 | Create Character Image | Create profile then image (PNG magic bytes, is_primary=true) | No throw | `createCharacterProfile`, `createCharacterImage` |
| 7 | Get Character Image | Create profile+image, fetch image by ID | Retrieved image truthy | `createCharacterProfile`, `createCharacterImage`, `getCharacterImage` |
| 8 | Get Character Images for Profile | Create profile, fetch its images list | No throw | `createCharacterProfile`, `getCharacterImages` |
| 9 | Get Primary Image | Create profile with primary image, fetch primary | Primary image truthy | `createCharacterProfile`, `createCharacterImage`, `getPrimaryImage` |
| 10 | Image to Data URL Conversion | Call `imageToDataURL` on a mock image object | Returned string starts with `data:image/png;base64,` | `imageToDataURL` |
| 11 | Get Images with Data URLs | Create profile, fetch images with embedded data URLs | No throw | `createCharacterProfile`, `getCharacterImagesWithDataURLs` |
| 12 | Set Primary Image | Create profile with 2 images (id1 primary, id2 not), set id2 as primary, verify | `getPrimaryImage().id === id2` (primary was switched atomically) | `createCharacterProfile`, `createCharacterImage`, `setPrimaryImage`, `getPrimaryImage` |
| 13 | Delete Character Image | Create profile+image, delete image, verify gone | `getCharacterImage` returns `null` | `createCharacterProfile`, `createCharacterImage`, `deleteCharacterImage`, `getCharacterImage` |
| 14 | Delete Character Profile & CASCADE | Create profile+image, delete profile, verify both gone | Profile and image both return `null` (FK CASCADE worked) | `createCharacterProfile`, `createCharacterImage`, `deleteCharacterProfile`, `getCharacterProfile`, `getCharacterImage` |

---

## modules.test.ts → `src/database/__tests__/repositories/modules.test.ts`

Exports `runModuleTests()`. **7 tests.** Every test creates a provider config
first (because module configs FK-reference provider configs), then exercises
the module config CRUD, then cleans up both. Each test exercises `create`,
`get`, optionally `update`, and `delete`.

| # | Test name | What it tests | Expected behavior | Repository functions exercised |
|---|-----------|---------------|-------------------|-------------------------------|
| 1 | Backend Config CRUD | Create OpenAI provider, then create/get/update/delete backend config | `retrieved.name === 'Test Backend'`; no throw on update/delete | `createBackendConfig`, `getBackendConfig`, `updateBackendConfig`, `deleteBackendConfig` + `createOpenAIProviderConfig`, `deleteOpenAIProviderConfig` |
| 2 | Movement Config CRUD | Create OpenRouter provider, then create/get/delete movement config | `retrieved` truthy; no throw | `createMovementConfig`, `getMovementConfig`, `deleteMovementConfig` + OpenRouter provider CRUD |
| 3 | STT Config CRUD | Create TWO OpenAI providers (transcription + VAD), then create/get/delete STT config | `retrieved` truthy | `createSTTConfig`, `getSTTConfig`, `deleteSTTConfig` + OpenAI provider CRUD |
| 4 | Cognition Config CRUD | Create OpenAI provider, then create/get/delete cognition config | `retrieved` truthy | `createCognitionConfig`, `getCognitionConfig`, `deleteCognitionConfig` + OpenAI provider CRUD |
| 5 | RAG Config CRUD | Create Ollama provider, then create/get/delete RAG config | `retrieved` truthy | `createRAGConfig`, `getRAGConfig`, `deleteRAGConfig` + Ollama provider CRUD |
| 6 | TTS Config CRUD | Create OpenAI provider, then create/get/delete TTS config | `retrieved` truthy | `createTTSConfig`, `getTTSConfig`, `deleteTTSConfig` + OpenAI provider CRUD |
| 7 | Vision Config CRUD | Create OpenAI provider, create/get/update/get/delete vision config; verify resolution change | First retrieved has resolution 640x480; after update, 1280x720 | `createVisionConfig`, `getVisionConfig`, `updateVisionConfig`, `deleteVisionConfig` + OpenAI provider CRUD |

---

## providers.test.ts → `src/database/__tests__/repositories/providers.test.ts`

Exports `runProviderTests()`. **11 tests.** One per provider type. Each
follows the same create → get → delete pattern with a minimal config.

| # | Test name | What it tests | Expected behavior | Repository functions exercised |
|---|-----------|---------------|-------------------|-------------------------------|
| 1 | OpenAI Provider CRUD | create/get/delete with name='Test OpenAI', model='gpt-4' | `retrieved.name === 'Test OpenAI'` | `createOpenAIProviderConfig`, `getOpenAIProviderConfig`, `deleteOpenAIProviderConfig` |
| 2 | OpenRouter Provider CRUD | create/get/delete with model='meta-llama/llama-3-70b' | `retrieved` truthy | OpenRouter CRUD |
| 3 | OpenAI Compatible Provider CRUD | create/get/delete with base_url='http://localhost:8080' | `retrieved` truthy | OpenAICompatible CRUD |
| 4 | Harmony Speech Provider CRUD | create/get/delete with endpoint, model | `retrieved` truthy | HarmonySpeech CRUD |
| 5 | ElevenLabs Provider CRUD | create/get/delete with voice_id, api_key | `retrieved` truthy | ElevenLabs CRUD |
| 6 | Kindroid Provider CRUD | create/get/delete with kindroid_id, api_key | `retrieved` truthy | Kindroid CRUD |
| 7 | Kajiwoto Provider CRUD | create/get/delete with username/password/room_url | `retrieved` truthy | Kajiwoto CRUD |
| 8 | CharacterAI Provider CRUD | create/get/delete with api_token/chatroom_url | `retrieved` truthy | CharacterAI CRUD |
| 9 | LocalAI Provider CRUD | create/get/delete with model only | `retrieved` truthy | LocalAI CRUD |
| 10 | Mistral Provider CRUD | create/get/delete with api_key | `retrieved` truthy | Mistral CRUD |
| 11 | Ollama Provider CRUD | create/get/delete with base_url='http://ollama' | `retrieved` truthy | Ollama CRUD |

**Note for Phase 3-3:** The plan mentions additional providers in
`src/database/repositories/providers/` that are NOT covered by the old tests:
- `ComfyUIProviderConfigRepository`
- `XAIProviderConfigRepository`
- `GoogleProviderConfigRepository`
- `AnthropicProviderConfigRepository`
- `SoulbitsCloudProviderConfigRepository`

Phase 3-3 should add coverage for these (new tests, not ports).

---

## memories.test.ts → `src/database/__tests__/repositories/memories.test.ts`

Exports `runMemoryCleanupTests()` (NOT `runMemoryTests` — note the actual name).
**4 tests.** These test the `cleanupOrphanedMemories` function from
`src/database/sync.ts`, which deletes memories that have no conversation
messages linked to them. They do NOT test the memory repository CRUD directly
(`insertMemory`, `getMemoriesForEntity` are used as setup, not as the subject
under test).

| # | Test name | What it tests | Expected behavior | Functions exercised |
|---|-----------|---------------|-------------------|---------------------|
| 1 | Delete orphaned memories | Create entity + memory with NO linked message; run cleanup | `cleanupOrphanedMemories()` returns 1; `getMemoriesForEntity(entityId)` returns `[]` | `createEntity`, `insertMemory`, `getMemoriesForEntity`, `cleanupOrphanedMemories` |
| 2 | Keep memories with messages | Create entity + memory WITH a linked conversation message; run cleanup | Returns 0; memory still present | + `createConversationMessage` |
| 3 | Mixed orphaned and linked memories | Create entity with one orphaned memory and one linked memory; run cleanup | Returns 1; only the linked memory remains (verifies the survivor is the right one by ID) | + `createConversationMessage` |
| 4 | Empty database cleanup | Run cleanup on a fresh empty DB | Returns 0 | `cleanupOrphanedMemories` |

**Note for Phase 3-3:** These tests touch multiple repositories
(entities + memories + conversation_messages + sync.ts) so they fit better in
a `cross-repo.test.ts` than a pure `memories.test.ts`. Also consider adding
direct CRUD coverage for `MemoryRepository` (insert, update, delete, soft-delete
via `deleted_at`).

---

## Gaps in the original test suite (for Phase 3-3 to address)

While porting, Phase 3-3 should add coverage for these **gaps** in the
original tests:

1. **Soft-delete (`deleted_at`) semantics** — not directly tested. The
   `entities.test.ts` "Get Entity" test doesn't verify that `getEntity`
   returns `null` for soft-deleted records (the `includeDeleted` parameter
   is never exercised).

2. **FK RESTRICT constraints** — only CASCADE is tested. Some FKs in the
   schema are RESTRICT, not CASCADE — verify those work too.

3. **`getAllEntities(includeDeleted=true)`** — never called with the flag.

4. **Number-binding divergence** — none of these tests would catch the
   `react-native-sqlite-storage` issue #4141 (numbers bound as doubles)
   because they don't assert on numeric column types. Phase 2-4's
   `mimicRnNumberBinding` flag exists for this; consider adding tests that
   assert INTEGER column round-trips.

5. **Missing providers** (listed above) — 5 provider repositories have zero
   test coverage.

6. **Memory repository CRUD** — only the cleanup function is tested, not the
   repository's `insert`/`update`/`delete` functions directly.
