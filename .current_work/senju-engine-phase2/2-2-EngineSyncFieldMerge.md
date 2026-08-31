# 2-2 — Engine Sync Field-Merge for Message Actions + reply_to Ingestion

> Phase 2 / repo: **harmony-link-private**. Contract: `21-Engine-Contract` §4.4, Q3; findings §1.1/§1.4.
> Prerequisite: 2-1.

## Objective

Replace the insert-only `conversation_messages` sync case with insert + **field-scoped merge**, and persist
`reply_to_message_id` on insert.

## Current state (evidence)

`eventserver/synchronization.go:1364-1386` — `"conversation_messages"` case: `json.Unmarshal` into
`ConversationMessageSync`, `ToDBModel()`, insert-if-not-exists only ("mostly immutable"), delete op → soft delete.
The app already transmits `reactions_json`/`is_pinned`/`reply_to_message_id` in every changed row (boolean map
`sync.ts:193`; TEXT_TABLES row upload `sync.ts:218-294`) — the engine silently discards them today.

## New behavior

```go
case "conversation_messages":
    // existing row → field-scoped merge (Q3): content immutable; only action/read state merges.
    if existing != nil {
        if inbound.UpdatedAt.After(existing.UpdatedAt) {
            UpdateConversationMessageActions(tx, …, reactions, isPinned, isRead, inbound.UpdatedAt)
        } // else: local newer → skip (LWW)
        return nil
    }
    // insert path: full row incl. reply_to_message_id, timestamps verbatim (2-1)
```

- **Inbound timestamps verbatim** — never re-stamp (echo-safety: equal timestamps → no-op re-apply; the row's
  `updated_at` only advances when someone actually edits). Wire format is RFC3339 ('T'-separated) in BOTH
  directions (Go marshals `time.Time` as RFC3339Nano; the engine's DB-internal space format never crosses the
  wire), so no mixed-format values can enter either DB.
- **`is_read` direction (A2)**: the merge is the read-receipt channel — an app 0→1 read bumps `updated_at` and
  flows up; the engine NEVER writes `is_read` (its rows are born 0 per 2-1 §4), so no engine→app read state
  exists (read-by-AI stays deferred, Q2).
- Operation semantics with `DetermineOperation` (`sync_utils.go:1258-1285`): `insert` = new row (unchanged);
  `update` = existing row → the merge branch; `delete` = soft delete (unchanged). Size-estimate `countChanges`
  list needs no change (row counts identical).
- **Engine-side reaction writes** (from 2-3) go through the same repo fn and simply bump `updated_at` → rows sync
  back down on the next device sync. No special propagation.
- **TDD order (red → green)**: write the four engine tests FIRST against today's insert-only behavior —
  (a) insert carries reply_to + reactions; (b) update-merge changes ONLY the four fields (assert content/audio
  untouched); (c) older `updated_at` loses; (d) timestamp preserved exactly (string compare) — RED = (a)/(b)/(d)
  fail (fields discarded, no merge, timestamps re-stamped). Then implement the merge + repo fn until green.
  Caveat for (d): compare the value the engine RETURNS/re-reads, not the Go in-memory `time.Time` formatting —
  RFC3339Nano trailing-zero normalization can differ from the stored string; assert on the DB round-trip.

## Files

- Modify: `eventserver/synchronization.go` (messages case), `database/repository/conversation/messages.go` (fn from 2-1)
- Test: `eventserver/` sync tests + `database/repository/conversation/` tests (follow existing naming)

## Verification

- [ ] `go build ./...`; `go test ./...` green incl. the four new cases
- [ ] `gitnexus_impact` on the sync handler symbol before editing; `gitnexus_detect_changes()` before committing
