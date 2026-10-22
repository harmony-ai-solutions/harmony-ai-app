# 3-1 — Engine Mobile Read Endpoints: Audit Table

> **Produced by:** phase 3-1 (`3-1-EngineMobileReadEndpoints.md`), repo `harmony-link-private` (branch `feat/app-engine-parity`).
> **Method:** enumerate every read/query in the app's `src/database/repositories/*.ts` (read-only reference: `harmony-ai-app`), map each to an existing management endpoint (`management/routes_*.go`) or mark the gap; then extend the management API under `/api/mobile/*` for the genuine gaps. The Wails frontend (`frontend/src/services/management/*.js`) is the *proof* of what the management API already serves.
> **Verdict legend:** `EXISTS` = already served by an existing management endpoint; `NEW` = added by 3-1; `DERIVED` = the app computes it client-side from an `EXISTS`/`NEW` endpoint (no engine round-trip of its own); `INTERNAL` = write-path/guard/pure helper, not a screen read; `WRITE` = a mutation (out of 3-1's read-only scope; continues via existing endpoints / the entity-session facade, audited in 3-2).

## 1. Wails frontend usage (the proof — what the management API already serves)

`frontend/src/services/management/*.js` calls only these management routes: `character-profiles` (list/get/create/update/delete/duplicate/import/export + images CRUD/analyze), `entities` (list/get/create/update/mappings/duplicate/reset-lifecycle/disabled/sessions/sessions-stop), `config`, `voices`, `validate-provider`, `models`, `module-configs`, `presets`, `themes`, `sync/devices`, `system`, `integrations`, `development/logs`.

**No chat / message / interaction / emoji-action / emotion / memory reads exist on the management API.** That is the read gap 3-1 closes: the app's chat list, message windows, emoji, emotion and memory screens query local SQLite today and need an engine contract before 3-2 can swap them.

## 2. App TS repository reads → verdict

### `entities.ts`

| App read | Query semantics | Engine endpoint | Verdict |
|---|---|---|---|
| `getEntity(id)` | entity row by id | `GET /api/entities/:id` (full config) | EXISTS |
| `getAllEntities()` | all live entities | `GET /api/entities` | EXISTS |
| `getEntityByCharacterProfileId` | entities by `character_profile_id`, newest | filter `GET /api/entities` | DERIVED |
| `getEntityModuleMappings` | mapping row | `GET /api/entities/:id` | EXISTS |
| `getNextEntityAliasCopy` / `stripCopySuffix` | alias series (write helper) | — | INTERNAL |
| `listProfileOwnerEntities` / `isProfilePersonaOwned` / `enforceProfileAssignmentGuard` | profile-ownership guard | — | INTERNAL |
| muted / disabled id sets | entity flags | `GET /api/entities` | EXISTS |

### `characters.ts`

| App read | Query semantics | Engine endpoint | Verdict |
|---|---|---|---|
| `getCharacterProfile(id)` | profile by id | `GET /api/character-profiles/:id` | EXISTS |
| `getAllCharacterProfiles()` | all profiles minus persona-owned | `GET /api/character-profiles` (+ client filter) | EXISTS |
| `getUserCharacterProfiles()` | = all | `GET /api/character-profiles` | EXISTS |
| `getAICharacterProfile(id)` | profile + persona-owner check | `GET /api/character-profiles/:id` (+ filter) | EXISTS |
| `getDistinctTags()` | distinct `tags` | — | DERIVED |
| `getCharacterImages` / `getCharacterImage` | image metadata + bytes | `GET /api/character-profiles/:id/images`, `/images/:image_id` (raw bytes) | EXISTS |
| `isCharacterFavorite` / `getFavoriteCharacterProfileIds` | `is_favorite` | `GET /api/character-profiles` (field) | EXISTS |
| `getSiblingCharacterProfiles` | profiles sharing a base name | — | DERIVED |
| `getCharacterStats` | likes/chats aggregates | — | DERIVED |
| `getChatPickerRows` / `hasChatPickerLibrary` | picker union (cards + entities) | `GET /api/entities` + `GET /api/character-profiles` | DERIVED |
| `resolveChatPickerRowLabel` | pure label | — | INTERNAL |

### `userEntities.ts`

| App read | Query semantics | Engine endpoint | Verdict |
|---|---|---|---|
| `getUserEntities` / `getUserPersona` | user entities ⨝ profile | `GET /api/entities` (filter `entity_type=user`) + profiles | DERIVED |
| primary-image avatar | image | `GET /api/character-profiles/:id/images` | EXISTS |

### `interactions.ts`

| App read | Query semantics | Engine endpoint | Verdict |
|---|---|---|---|
| `getPhoneConversationsPage` | one row per `participant_key`, recency = last message | `GET /api/mobile/entities/:id/chat-list` | **NEW** |
| `getLastInteractionMessage` | last message per `participant_key` | `GET /api/mobile/entities/:id/chat-list` (`last_message`) | **NEW** |
| `getRecentPhoneInteractions` | phone interactions by `last_activity_at` | `GET /api/mobile/entities/:id/interactions?presence_type=phone` | **NEW** |
| `getActiveInteractionsByEntity` | interactions `status='active'` | `GET /api/mobile/entities/:id/interactions?status=active` | **NEW** |
| `getInteractionByParticipantKey` | interaction by `participant_key` | `GET /api/mobile/entities/:id/interactions?participant_key=` | **NEW** |
| `entityHasPhoneInteraction` | existence probe | `GET /api/mobile/entities/:id/interactions?presence_type=phone&participant_key=` | **NEW** |
| `getInteractionById` | interaction by id | from the interactions list | DERIVED |
| `createInteraction` / `updateInteraction` | writes | — | WRITE |

### `conversation_messages.ts`

| App read | Query semantics | Engine endpoint | Verdict |
|---|---|---|---|
| `getConversationMessagesByParticipantKey` | paginated window (JOIN interactions, `before` cursor) | `GET /api/mobile/entities/:id/messages` | **NEW** |
| `getRecentConversationMessages` | recent window | `GET /api/mobile/entities/:id/messages?limit=` | **NEW** |
| `getLastConversationMessage` | last message preview | `GET /api/mobile/entities/:id/chat-list` (`last_message`) | **NEW** |
| `getUnreadCountByParticipantKeys` | batched unread counts | `GET /api/mobile/entities/:id/chat-list` (`unread_count`) | **NEW** |
| `getConversationMessage(id)` | single message | the messages list contains it | DERIVED |
| `messageExists` | existence | — | DERIVED |
| audio / image bytes (two-phase `loadTextColumn`) | blob bytes | `GET /api/mobile/messages/:id/audio` \| `/image` (HTTP `Range`) | **NEW** |
| `createConversationMessage` / `updateConversationMessage` / `deleteConversationMessage` / `deleteConversationByParticipantKey` | writes | — | WRITE |
| `markConversationMessagesRead` / `Unread` | write `is_read` | — | WRITE |

### `chatConversationSettings.ts`

| App read | Query semantics | Engine endpoint | Verdict |
|---|---|---|---|
| `getChatConversationSettings` / `...Batch` | per-key pin/archive/reply_mode | `GET /api/mobile/entities/:id/chat-list` (`pinned`/`archived`/`reply_mode`) | **NEW** |
| `getReplyMode` | reply mode | chat-list `reply_mode` | **NEW** |
| `conversationSettingsExistForEntity` / `listConversationsByFlag` | flag scans | — | DERIVED |
| `setConversationPinned` / `setConversationArchived` / `setReplyMode` | writes | — | WRITE |

### `emoji_actions.ts`

| App read | Query semantics | Engine endpoint | Verdict |
|---|---|---|---|
| `getEmojiActionsForEntity` / `getEmojiAction` / `getAllEmojiActionsArray` / `countEmojiActions` | emoji reads by entity | `GET /api/mobile/entities/:id/emoji-actions` | **NEW** |
| `createEmojiAction` / `upsertEmojiAction` / `deleteEmojiAction` / `deleteAllEmojiActions` / `deleteDefaultEmojiActions` | writes | — | WRITE |

### `emotion_state.ts`

| App read | Query semantics | Engine endpoint | Verdict |
|---|---|---|---|
| `getEmotionState` | live emotion row by entity | `GET /api/mobile/entities/:id/emotion` | **NEW** |
| `upsertEmotionState` / `softDeleteEmotionState` | writes | — | WRITE |

### `memories.ts`

| App read | Query semantics | Engine endpoint | Verdict |
|---|---|---|---|
| `getMemoriesForEntity` | memories by entity (oldest first) | `GET /api/mobile/entities/:id/memories` | **NEW** |
| `insertMemory` / `upsertMemory` | writes | — | WRITE |

### `modules.ts` + `providers/*.ts`

| App read | Query semantics | Engine endpoint | Verdict |
|---|---|---|---|
| `get*ModuleConfig` / `getAll*ModuleConfigs` | module config by id / list | `GET /api/module-configs/:module`, `/:module/:id` | EXISTS |
| provider config by id / by name / list (all `provider_config_*`) | provider config reads | `GET /api/module-configs/:module` (embeds the provider config) | EXISTS (name lookup DERIVED) |
| `count*References` | mapping-count checks | — | DERIVED |
| module/provider create/update/delete | writes | existing endpoints | WRITE |

## 3. Result

- **MISSING rows at completion: 0.** Every app read resolves to EXISTS / NEW / DERIVED / INTERNAL / WRITE.
- **New endpoints implemented (8 routes, one new group):**

| Method | Path | Backs |
|---|---|---|
| GET | `/api/mobile/entities/:id/chat-list` | `getPhoneConversationsPage` + `getLastInteractionMessage` + `getUnreadCountByParticipantKeys` + `getChatConversationSettingsBatch` |
| GET | `/api/mobile/entities/:id/messages` | `getConversationMessagesByParticipantKey` / `getRecentConversationMessages` |
| GET | `/api/mobile/entities/:id/interactions` | `getActiveInteractionsByEntity` / `getRecentPhoneInteractions` / `getInteractionByParticipantKey` / `entityHasPhoneInteraction` |
| GET | `/api/mobile/messages/:messageId/audio` | message audio bytes (Range) |
| GET | `/api/mobile/messages/:messageId/image` | message image bytes (Range) |
| GET | `/api/mobile/entities/:id/emoji-actions` | `getEmojiActionsForEntity` etc. |
| GET | `/api/mobile/entities/:id/emotion` | `getEmotionState` |
| GET | `/api/mobile/entities/:id/memories` | `getMemoriesForEntity` |

Payload discipline: list payloads are projected (no audio/image blobs) and paginated (`limit`/`offset` or an opaque `before` cursor); heavy bytes ride the dedicated byte endpoints with HTTP `Range`, preserving the app's two-phase loading. All wire shapes are snake_case and reuse the canonical `*Sync` models; the 3-2 adapter maps them to the camelCase domain.

Auth: the `/api/mobile` group accepts `X-Admin-API-Key` (Wails/desktop parity) **or**, from loopback peers only, the per-process `X-Loopback-Token` the sidecar prints in its readiness line — so the app never embeds the fixed admin key. See `docs/Sidecar-Deployment.md` and `docs/api/management/openapi.yaml`.

## 4. Benchmark (step 4)

`BenchmarkMobileChatListEndpoint_500Conversations` (`management/routes_mobile_bench_test.go`) — full `GET /api/mobile/entities/:id/chat-list` request over a populated in-memory DB (500 conversations × 20 messages = 10 000 messages; page size 50):

```
BenchmarkMobileChatListEndpoint_500Conversations-48    20    7363525 ns/op   (~7.4 ms/op)
```

Host: Windows, 48 logical cores, in-memory SQLite (single connection), `-benchtime=20x`.

Notes:
- This is the **engine-side half** of the bench. The app-local JOIN half runs against `react-native-sqlite-storage` in the app repo and could not be measured here (different SQLite build / device); it should be captured during 3-2's on-device verification and recorded there.
- Hot spot: the per-conversation last-message preview is an N+1 (bounded by page size). A future optimization is a single window-function (`ROW_NUMBER() OVER (PARTITION BY participant_key …)`) query. The endpoint is well within budget for a 50-row page on the host; device-class timings will be higher.

## 5. Notes for 3-2 (app repository swap)

Exact endpoint list + request/response shapes are in `docs/api/management/openapi.yaml` (`Mobile` tag) and `docs/Sidecar-Deployment.md`. Key adapter points:

1. **Auth/token plumbing:** parse `token` from the `ENGINE_READY` readiness line (`EngineSidecarModule.parseReadyLine`) and send it as `X-Loopback-Token`. Absent `token` (non-loopback bind) → fall back to `X-Admin-API-Key`.
2. **Chat list** replaces four app calls in one: `getPhoneConversationsPage` + `getLastInteractionMessage` + `getUnreadCountByParticipantKeys` + `getChatConversationSettingsBatch`. `participant_ids` is a JSON **string** (same as the app's column) — parse client-side.
3. **Message window:** `before` is the opaque `next_cursor` from the previous page (the raw stored `created_at`); never synthesize it from a parsed Date — the engine stores timestamps in mixed formats. The response is chronological (oldest-first), matching the app repo.
4. **Blobs:** the message list omits `audio_data`/`image_data`; fetch bytes from `/api/mobile/messages/:id/audio|image`. The app's two-phase loader maps directly.
5. **Snake_case wire → camelCase domain** mapping is required (the established DTO/domain split); Go silently drops unknown camelCase keys — send snake_case.
6. **Emotion** returns `null` when the entity has no live state (app `getEmotionState` parity). **Memories** are oldest-first (app parity) and paginated.
7. Existing endpoints cover entity/profile/module/provider reads — those repo functions swap onto `/api/entities`, `/api/character-profiles`, `/api/module-configs/*` without new engine work.

## 6. Notes for 5-1 (parity gates)

- The mobile group is read-only and separate from `/api`; the Wails contract is unchanged (no existing route removed or reshaped).
- New engine test surface: `management/routes_mobile_test.go` (endpoint behavior + auth) and `cmd/engine-sidecar/main_test.go` (loopback-token readiness). Parity gates that enumerate management routes must include the 8 `/api/mobile/*` paths.
- The `token` field is additive on the readiness line; the app's existing parser ignores unknown fields, so no app change is required to stay compatible.
