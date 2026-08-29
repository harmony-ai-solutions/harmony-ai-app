# 1-1 — Engine Migration 000041 (Canonical Rebuild + Favorites + Settings)

> Phase 1 / repo: **harmony-link-private** (branch `feat/engine-track-phase2` off `main`).
> Contract: `21-Engine-Contract-Persona-Enums.md` §3.1–3.3, Q4/Q5/Q6/Q8/Q15.
> Prerequisite: run `npx gitnexus analyze` in the engine root first (index 4 commits stale).

## Objective

Create `database/migrations/000041_consolidate_senju_features.up.sql` + `.down.sql` — the byte-identical mirror of
the **edited** app `000041` (landed together with 1-2): canonical `conversation_messages` rebuild + synced
`character_favorites` + slimmed `chat_conversation_settings`. Never touches `personas` (does not exist engine-side,
never will). Latest engine migration today: `000040_lifecycle_state_sync_columns`.

## Up migration SQL (verbatim contract §3)

```sql
-- 1. Canonical conversation_messages rebuild (Q4): byte-identical final DDL both repos.
CREATE TABLE conversation_messages_new ( id TEXT PRIMARY KEY NOT NULL, entity_id TEXT NOT NULL, sender_entity_id TEXT NOT NULL, interaction_id TEXT, content TEXT NOT NULL, audio_duration REAL, message_type TEXT NOT NULL, audio_data TEXT, audio_mime_type TEXT, image_data TEXT, image_mime_type TEXT, vl_model TEXT, vl_model_interpretation TEXT, emotional_state_bits INTEGER NOT NULL DEFAULT 0, is_recon_followup INTEGER NOT NULL DEFAULT 0, is_edited INTEGER NOT NULL DEFAULT 0, edit_of_message_id TEXT, reply_to_message_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, reactions_json TEXT, is_pinned INTEGER NOT NULL DEFAULT 0, is_read INTEGER NOT NULL DEFAULT 0 );
INSERT INTO conversation_messages_new ( id, entity_id, sender_entity_id, interaction_id, content, audio_duration, message_type, audio_data, audio_mime_type, image_data, image_mime_type, vl_model, vl_model_interpretation, emotional_state_bits, is_recon_followup, is_edited, edit_of_message_id, created_at, updated_at, deleted_at )
  SELECT id, entity_id, sender_entity_id, interaction_id, content, audio_duration, message_type, audio_data, audio_mime_type, image_data, image_mime_type, vl_model, vl_model_interpretation, emotional_state_bits, is_recon_followup, is_edited, edit_of_message_id, created_at, updated_at, deleted_at FROM conversation_messages;
DROP TABLE conversation_messages;
ALTER TABLE conversation_messages_new RENAME TO conversation_messages;
CREATE INDEX idx_conversation_messages_entity ON conversation_messages(entity_id);
CREATE INDEX idx_conversation_messages_interaction_id ON conversation_messages(interaction_id);
CREATE INDEX idx_conversation_messages_pinned ON conversation_messages(is_pinned);
CREATE INDEX idx_conversation_messages_reply_to ON conversation_messages(reply_to_message_id);

-- 2. Synced favorites (Q5)
CREATE TABLE IF NOT EXISTS character_favorites ( profile_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, deleted_at TIMESTAMP );

-- 3. Slimmed conversation settings (Q6/Q8)
CREATE TABLE IF NOT EXISTS chat_conversation_settings ( participant_key TEXT PRIMARY KEY, entity_id TEXT, pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, reply_mode TEXT NOT NULL DEFAULT 'realistic', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, deleted_at TIMESTAMP );
```

**Critical parity notes** (compare is exact-string after whitespace collapse):
- Final DDL text must be **byte-identical** to the app side (1-2), including identifier quoting — use UNQUOTED
  `conversation_messages` in the CREATE (matches today's quoted-stored `"conversation_messages"` form both sides
  produce via rename — verify against the regenerated dumps; if the app stores quoted, quote identically here).
- The rebuild normalizes away today's ALTER-append artifacts (`deleted_at TEXT , reactions_json …`) — intended.
- Rebuild drops the engine-only `FOREIGN KEY (entity_id) … CASCADE` clause and `content`/`message_type` defaults,
  `BLOB`/`BOOLEAN` labels — deliberate (Q4 canonical = app-flavored; affinity-equivalent, no data risk).
- BLOB→TEXT carries values verbatim (SQLite stores what was written; labels don't convert data).

## Down migration

Rebuild `conversation_messages` back to the **pre-000041 engine shape** (BLOB/BOOLEAN/TIMESTAMP labels, defaults,
FK clause, no reactions/reply/pinned/is_read), recreate the two original indexes, DROP the two new indexes,
`DROP TABLE IF EXISTS chat_conversation_settings; DROP TABLE IF EXISTS character_favorites;`.
No `DROP COLUMN` (guard in `migrations.go:287-358` bans it) — use a rebuild in the down too.

## Files

- Create: `database/migrations/000041_consolidate_senju_features.up.sql`, `…down.sql`
- No registration file (runner loads `database/migrations/*.sql` via `//go:embed`, `migrations.go:14-15,74-146`)

## Verification (this subtask)

- [ ] `go build ./...` clean
- [ ] `go test ./database/...` green — roll-forward, idempotency, key-table checks, **rollback + re-apply** (`migrations_test.go:10-90`)
- [ ] `go run . dump-schema | tail -n +4 > /tmp/go-schema.json` — contains canonical `conversation_messages`, both new tables, `personas` absent
- [ ] Local compare vs regenerated app dump: `conversation_messages`, `character_favorites`, `chat_conversation_settings` all MATCH (after 1-2 lands; until then app dump diverges — coordinate the commit pair)
- [ ] Commit on `feat/engine-track-phase2`; `gitnexus_detect_changes()` (repo `harmony-link-private`) before committing
