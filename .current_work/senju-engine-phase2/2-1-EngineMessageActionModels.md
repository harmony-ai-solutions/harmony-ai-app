# 2-1 — Engine Message-Action Models & Query Constants

> Phase 2 / repo: **harmony-link-private**. Contract: `21-Engine-Contract` §3.1, §4.4, Q1/Q3/Q4.
> Prerequisite: Phase 1 merged on the branch (schema exists).

## Objective

Make the canonical `conversation_messages` columns first-class in the Go data layer.

## Changes

1. **`database/models/conversation.go`** — `ConversationMessage` (:9-39) += `ReactionsJSON sql.NullString`,
   `ReplyToMessageID sql.NullString`, `IsPinned bool/int64`, `IsRead bool/int64`; `ConversationMessageSync` (:42-72)
   += pointer twins (`ReactionsJSON *string`, `ReplyToMessageID *string`, `IsPinned *bool`, `IsRead *bool`);
   extend `ToSyncModel`/`ToDBModel` round-trip (pattern: the `ConversationMessage` pair is the template, :9-163).
   JSON tags must match the app's wire keys exactly: `reactions_json`, `reply_to_message_id`, `is_pinned`, `is_read`
   (the app's `normalizeBooleanFields` sends real booleans for `is_pinned` — `sync.ts:193` — and `is_read` after 3-1).
2. **`database/sync_utils.go`** — `queryGetChangedConversationMessages` (:48-55) += the four columns in the SELECT
   list; scan targets in `GetChangedConversationMessages` (:382-409) updated in lockstep.
3. **`database/repository/conversation/messages.go`** —
   - `CreateConversationMessage` (:70-109): INSERT column list += `reactions_json`, `reply_to_message_id`,
     `is_pinned`, `is_read`; **stop stamping `time.Now()`** — persist the model's inbound `CreatedAt`/`UpdatedAt`
     when present, and only fall back to now for engine-native creation (greeting/reply/outreach paths already set
     IDs/timestamps upstream — audit `storeOutgoingResponse`, `FireDreamBeat` persist, `PersistOutreachMessage`,
     `CognitionModule.HandleEvent:841-856` to confirm they pass explicit timestamps; where they don't, set them at
     the call site, NOT hidden in the repo).
   - `DeleteConversationMessage` (:112-116): unchanged (soft delete).
   - New: `UpdateConversationMessageActions(tx, id, reactionsJSON, isPinned, isRead, updatedAt)` — the field-scoped
     update used by 2-2 (content columns never touched).
4. **Engine-generated rows** (greetings, replies, outreach, dreams): must write coherent zero-values —
   `ReactionsJSON` NULL/`'[]'`, `ReplyToMessageID` NULL, `IsPinned` 0, `IsRead` **0** — do not stamp `is_read` at
   all; the column default covers it (**amendment A2, retracts the earlier "born read" decision**). Verified copy
   model: each entity keeps its OWN record — the app stores POV copies (`entity_id` = persona, app-minted uuidv7
   even for WS-received partner messages, `EntitySessionService.ts:1965-1995`), the engine stores its own
   (`entity_id` = engine entity); user messages share one id across sides, AI messages have per-side ids. `is_read`
   on a record means "the record owner's counterpart has read it": own messages stay 0, only the app's read action
   ever writes 1 (flowing up as a read-receipt via the 2-2 merge). Stamping 1 at birth would make every
   engine-authored message permanently read app-side (no unread badge for synced-in outreach/greetings — the exact
   bug 3-1 exists to fix) and would pre-implement read-by-AI semantics that Q2 deferred.

## Verification

- [ ] `go build ./...`; `go test ./...` green (existing conversation tests still pass — they now see the new columns)
- [ ] Round-trip: a unit test asserting `ToSyncModel`/`ToDBModel` preserve all four fields + timestamps verbatim
- [ ] `gitnexus_impact` on `CreateConversationMessage` + `GetChangedConversationMessages` before editing;
      `gitnexus_detect_changes()` before committing
