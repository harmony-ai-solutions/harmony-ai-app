# 4-4 — App: Gate Hard-Delete Paths

## Objective

Remove user-reachable hard deletes from the app so every deletion is a tombstone (D1), aligning with engine
1-2.

## Context (from investigation, 2026-09-05)

Hard-delete sites (app):

| Site | File:Line | Notes |
|---|---|---|
| `deleteEntity(id, permanent=true)` | `src/database/repositories/entities.ts:680-702` | hard-deletes emoji actions, interactions, messages, entities |
| `deleteEntityModuleMapping(permanent)` | `entities.ts:940-959` | |
| `deleteCharacterProfile(permanent)` | `src/database/repositories/characters.ts:443-467` | |
| `deleteCharacterImage(permanent)` | `characters.ts:679-699` | |
| `deleteConversationByParticipantKey` settings row | `src/database/repositories/conversation_messages.ts:457-494` | hard-deletes `chat_conversation_settings` |
| `cleanupOrphanedMemories` | `src/database/sync.ts:477-499` | handled in 4-1 |

## Implementation Steps

1. Audit all `permanent`-flag call sites (grep `permanent`). **Verified in plan review: production code never
   passes `permanent=true`** — the branches are exercised only by tests. Expected outcome holds: no user flow
   needs physical deletion.
2. Remove the `permanent` branches (or make them throw in dev builds) — the soft path becomes the only path.
   Keep the function signatures if callers pass the flag; ignore + warn once. **Audit scope beyond the table:**
   8 module-config repos (`modules.ts`: backend/cognition/movement/rag/stt/tts/vision/imagination) and 16
   provider-config repos also carry `permanent` branches — include them in the sweep (config tables, not
   entity-id tables, but the D1 audit claim should cover them).
3. `deleteConversationByParticipantKey`: switch the settings-row delete to a **full** soft delete
   (**ruling D18 — review-2 corrected; "just set deleted_at" is insufficient**):
   - The `deleted_at` column already exists (`000041:160`) — no schema migration.
   - **Add `deleted_at IS NULL` to all five read predicates** in `chatConversationSettings.ts`
     (`getChatConversationSettings :86-89`, `getChatConversationSettingsBatch :118-122`,
     `conversationSettingsExistForEntity :197-200`, `listConversationsByFlag :212-215`,
     `getReplyMode :265-267`) — without them, softened rows ghost-render in ArchivedChats and leak stale
     pins/reply-modes into ChatList.
   - **`upsertSettings` gains `deleted_at = NULL` in its `ON CONFLICT DO UPDATE`** (`:145-164`) so re-opening
     a deleted conversation (same participant_key) resurrects fresh instead of updating a zombie.
   - This is the one user-reachable hard delete today: `ChatListScreen.tsx:951`, `ArchivedChatsScreen.tsx:386`.
   - Rationale: a hard delete here would resurrect "deleted" conversations on every full re-pull under D11.
4. Compensating deletes: `CreateAIScreen.tsx:1177` rollback — **verified already soft**
   (`deleteCharacterProfileCascade`, `characters.ts:481-503`); no change needed. Route any future
   compensating deletes through soft as well (tombstone of a never-synced row is inert).
5. Update repository tests that assert physical deletion to assert tombstones instead. **Review-5
   enumeration:** `characters.test.ts:482`, `entities.test.ts:592-596`, `cross-repo.test.ts:190-209`
   (permanent-branch asserts), and `conversationDeleteCascade.test.ts:84-105` (pins the settings
   hard-delete observable — rewrite together with D18's filters and ship the filters WITH or BEFORE the
   DELETE→soft switch, or the suite is red mid-window).

## Files to Modify

- `src/database/repositories/entities.ts`, `characters.ts`, `conversation_messages.ts`
- Call sites in `CharactersScreen.tsx`, `ChatDetailScreen.tsx`, `PersonaEditScreen.tsx`,
  `ChatListScreen.tsx`, `ArchivedChatsScreen.tsx`, `CreateAIScreen.tsx` (no behavioral change expected —
  they already call the soft path).

## Tests

- Every delete seam produces `deleted_at` set, rows physically present.
- Softened settings delete: row filtered from all five read paths; re-open on same participant_key
  resurrects fresh (D18).
- No `DELETE FROM` on never-erase tables in any unit/integration path (add a DB-spy assertion where cheap).

## Checklist

- [ ] `permanent` branches removed/neutralized (incl. module/provider config repos in the audit)
- [ ] Settings-row delete fully softened (5 read filters + upsert resurrect — D18; column exists at
      `000041_consolidate_senju_features.ts:159`)
- [ ] Compensating deletes verified soft (CreateAIScreen rollback AND
      `compensateOrphanedPersona` `userEntities.ts:292-298` — both already soft; enumerate both in the audit)
- [ ] Tests updated; suites green; phase doc updated

### Review-3 notes

- Consider a shared `NOT_DELETED = 'deleted_at IS NULL'` const for the five D18 predicates (precedent:
  `emoji_actions.ts:27`) to prevent five-site drift.
- 4-1 cross-reference: once the finalize purge is gone (4-1) these settings tombstones accumulate — the
  five filters are what keep them invisible; ship D18 before or with 4-1's removal if sequencing allows.
