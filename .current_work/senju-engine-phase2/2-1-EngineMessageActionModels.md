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
   `ReactionsJSON` NULL/`'[]'`, `ReplyToMessageID` NULL, `IsPinned` 0, `IsRead` 1 for AI-authored messages
   (**decided: engine-authored rows are born read** — a partner's own message is never "unread" to itself; app
   unread derivation counts only rows where `sender != POV entity`, so this is consistency, not behavior).

## Verification

- [ ] `go build ./...`; `go test ./...` green (existing conversation tests still pass — they now see the new columns)
- [ ] Round-trip: a unit test asserting `ToSyncModel`/`ToDBModel` preserve all four fields + timestamps verbatim
- [ ] `gitnexus_impact` on `CreateConversationMessage` + `GetChangedConversationMessages` before editing;
      `gitnexus_detect_changes()` before committing
