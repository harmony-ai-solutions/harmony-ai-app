/**
 * Migration 000041: Final consolidate + reconcile senju pre-release features
 *
 * This migration's FINAL form (edited in place — pre-mainline, dev-only surface)
 * folds in the Phase-1 schema parity work (§9-A9/A13):
 *
 *   personas                   — DELETED entirely (Q10). Personas become user
 *                                entities (entity_type='user') managed by the
 *                                new userEntities repo; conversion of existing
 *                                persona rows is SKIPPED (dev-only exposure —
 *                                the wipe note covers it).
 *   conversation_messages      — canonical `_new`-table rebuild (byte-identical
 *                                to engine 000041 after comment + quote
 *                                normalization, §9-A9). Adopts the ENGINE
 *                                timestamp labels (created_at TIMESTAMP,
 *                                updated_at DATETIME, deleted_at DATETIME —
 *                                no DEFAULTs, the actual 000025 hazard), and
 *                                includes reply_to_message_id + is_read. The
 *                                old three ALTERs are REPLACED by this rebuild.
 *   character_favorites        — synced shape (watermark triple, `favorited_at`
 *                                dropped; created_at subsumes it).
 *   chat_conversation_settings — slimmed shape (drop unread_count/muted/blocked;
 *                                add reply_mode + deleted_at). `entity_id` is
 *                                the POV entity (Q6).
 *   emotion_state              — §9-A9 rebuild (deleted_at TEXT → DATETIME).
 *   entity_emoji_actions       — §9-A9 rebuild (created_at/updated_at TEXT →
 *                                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
 *                                deleted_at TEXT → DATETIME DEFAULT NULL).
 *   interactions               — §9-A9 rebuild (6 timestamp labels TEXT →
 *                                DATETIME, explicit NULL keywords on
 *                                memory_id/continued_interaction_id, and the
 *                                engine's trailing FK clause).
 *
 * Dropped SQL (NOT carried over, per the approved consolidation amendment):
 *   character_profile_sources + backfill + visibility rebuilds (000041/42/49/52)
 *   persona-row cleanup DELETE (000044 — moot per B3)
 *   character_categories + character_category_members (000045)
 *   character-social tables (000047), user-social + notifications (000048),
 *   marketplace + wallet tables (000051), blocked_users (000053),
 *   signup-bonus ALTER (000054), marketplace cache tables (000055)
 *
 * Note: 000039 remains the reserved-number placeholder for the engine-only
 * device_push_tokens migration (no-op app-side), so the 1:1 number mirror
 * between app and engine survives.
 *
 * DEV-DEVICE WIPE NOTE (EXTENDED): this migration was amended in place MANY
 * times, and an already-applied migration never re-runs. Devices that ran ANY
 * EARLIER build of this branch — the old 000041 (personas table + 3 ALTERs +
 * unconverted settings shape), the old chat_conversation_settings shape
 * (muted/blocked/unread_count columns), the now-dropped personas table, and the
 * pre-000042 entities (no entity_type/is_muted/is_disabled) — keep orphaned SQL
 * and MISS the canonical column set until wiped. A one-time dev DB wipe (Dev DB
 * viewer wipe or reinstall) is REQUIRED on those devices. Only dev installs
 * ever executed these migrations; fresh installs are unaffected and run the
 * final form directly.
 *
 * PRAGMA foreign_keys: the `_new`-table rebuilds DROP referenced tables
 * (conversation_messages; and the FK-children emotion_state /
 * entity_emoji_actions / interactions reference entities — dropping a child
 * does not fire parent FKs, but the DROP is not the concern here). Following
 * the 000037 pattern (documented at 000037:10-19), FKs are disabled for the
 * migration session so the rebuilds' DROP TABLE cannot fire FK cascades on
 * production data (e.g. existing entities referencing a dropped table).
 *
 * The surviving pieces (character_favorites / chat_conversation_settings)
 * become sync-able engine mirrors in Phase 2 (B2); conversation_messages now
 * matches the engine byte-for-byte.
 */
export const migration041 = `
PRAGMA foreign_keys = OFF;

-- ── conversation_messages: canonical rebuild (byte-identical to engine 000041) ──
-- Data carried by INSERT SELECT. The app's pre-000041 message rows lack
-- reply_to_message_id / reactions_json / is_pinned / is_read (those were added
-- by ALTERs in earlier revisions) — reply/reactions/pinned default NULL/0, and
-- is_read is born 0 (A2: per-record, never "born read"). The engine's column
-- set is adopted EXACTLY, including the TIMESTAMP/DATETIME labels (no DEFAULTs —
-- writers always supply explicit ISO timestamps; RN reads by storage class).
CREATE TABLE conversation_messages_new (
    id TEXT PRIMARY KEY NOT NULL,
    entity_id TEXT NOT NULL,
    sender_entity_id TEXT NOT NULL,
    interaction_id TEXT,
    content TEXT NOT NULL,
    audio_duration REAL,
    message_type TEXT NOT NULL,
    audio_data TEXT,
    audio_mime_type TEXT,
    image_data TEXT,
    image_mime_type TEXT,
    vl_model TEXT,
    vl_model_interpretation TEXT,
    emotional_state_bits INTEGER NOT NULL DEFAULT 0,
    is_recon_followup INTEGER NOT NULL DEFAULT 0,
    is_edited INTEGER NOT NULL DEFAULT 0,
    edit_of_message_id TEXT,
    reply_to_message_id TEXT,
    created_at TIMESTAMP NOT NULL,
    updated_at DATETIME NOT NULL,
    deleted_at DATETIME,
    reactions_json TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_read INTEGER NOT NULL DEFAULT 0
);

INSERT INTO conversation_messages_new (
    id, entity_id, sender_entity_id, interaction_id, content,
    audio_duration, message_type, audio_data, audio_mime_type,
    image_data, image_mime_type, vl_model, vl_model_interpretation,
    emotional_state_bits, is_recon_followup, is_edited, edit_of_message_id,
    reply_to_message_id, created_at, updated_at, deleted_at,
    reactions_json, is_pinned, is_read
)
SELECT
    id, entity_id, sender_entity_id, interaction_id, content,
    audio_duration, message_type, audio_data, audio_mime_type,
    image_data, image_mime_type, vl_model, vl_model_interpretation,
    emotional_state_bits, is_recon_followup, is_edited, edit_of_message_id,
    NULL, created_at, updated_at, deleted_at,
    NULL, 0, 0
FROM conversation_messages;

DROP TABLE conversation_messages;
ALTER TABLE conversation_messages_new RENAME TO conversation_messages;

-- Re-create the 4 engine-backed indexes (the rebuild dropped them).
CREATE INDEX idx_conversation_messages_entity ON conversation_messages(entity_id);
CREATE INDEX idx_conversation_messages_interaction_id ON conversation_messages(interaction_id);
CREATE INDEX idx_conversation_messages_pinned ON conversation_messages(is_pinned);
CREATE INDEX idx_conversation_messages_reply_to ON conversation_messages(reply_to_message_id);

-- ── character_favorites: synced shape (watermark triple, favorited_at dropped) ──
-- Created FRESH in its final shape. This table is created here for the FIRST
-- time (only this migration ever created it), so on the fresh / wiped path it
-- does NOT pre-exist and a direct CREATE is all that is required — the final
-- text is identical to the engine mirror (Q5: favorited_at dropped; created_at
-- subsumes it). Devices that ran an earlier 000041 revision are wiped per the
-- header note.
CREATE TABLE character_favorites (
    profile_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- ── chat_conversation_settings: slimmed shape (Q6 + Q8 final) ──
-- Created FRESH in its final shape (same rationale as character_favorites).
-- unread_count/muted/blocked gone (derived unread / entity-level flags).
-- entity_id is the POV entity (Q6 — never the partner). reply_mode defaults
-- 'realistic'.
CREATE TABLE chat_conversation_settings (
    participant_key TEXT PRIMARY KEY,
    entity_id TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    reply_mode TEXT NOT NULL DEFAULT 'realistic',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- ── emotion_state: §9-A9 rebuild (deleted_at TEXT → DATETIME) ──
CREATE TABLE emotion_state_new (
    entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    joy_intensity REAL NOT NULL DEFAULT 0.1,
    sadness_intensity REAL NOT NULL DEFAULT 0.1,
    trust_intensity REAL NOT NULL DEFAULT 0.1,
    disgust_intensity REAL NOT NULL DEFAULT 0.1,
    fear_intensity REAL NOT NULL DEFAULT 0.1,
    anger_intensity REAL NOT NULL DEFAULT 0.1,
    surprise_intensity REAL NOT NULL DEFAULT 0.1,
    anticipation_intensity REAL NOT NULL DEFAULT 0.1,
    joy_baseline REAL NOT NULL DEFAULT 0.1,
    sadness_baseline REAL NOT NULL DEFAULT 0.1,
    trust_baseline REAL NOT NULL DEFAULT 0.1,
    disgust_baseline REAL NOT NULL DEFAULT 0.1,
    fear_baseline REAL NOT NULL DEFAULT 0.1,
    anger_baseline REAL NOT NULL DEFAULT 0.1,
    surprise_baseline REAL NOT NULL DEFAULT 0.1,
    anticipation_baseline REAL NOT NULL DEFAULT 0.1,
    joy_crystallize_start TIMESTAMP NULL,
    sadness_crystallize_start TIMESTAMP NULL,
    trust_crystallize_start TIMESTAMP NULL,
    disgust_crystallize_start TIMESTAMP NULL,
    fear_crystallize_start TIMESTAMP NULL,
    anger_crystallize_start TIMESTAMP NULL,
    surprise_crystallize_start TIMESTAMP NULL,
    anticipation_crystallize_start TIMESTAMP NULL,
    last_update TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decay_tau REAL NOT NULL DEFAULT 3600.0,
    high_threshold REAL NOT NULL DEFAULT 6.0,
    low_threshold REAL NOT NULL DEFAULT 1.0,
    crystallize_intensity REAL NOT NULL DEFAULT 7.0,
    crystallize_min_hours REAL NOT NULL DEFAULT 2.0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ,
    deleted_at DATETIME DEFAULT NULL);

INSERT INTO emotion_state_new (
    entity_id, joy_intensity, sadness_intensity, trust_intensity, disgust_intensity,
    fear_intensity, anger_intensity, surprise_intensity, anticipation_intensity,
    joy_baseline, sadness_baseline, trust_baseline, disgust_baseline, fear_baseline,
    anger_baseline, surprise_baseline, anticipation_baseline,
    joy_crystallize_start, sadness_crystallize_start, trust_crystallize_start,
    disgust_crystallize_start, fear_crystallize_start, anger_crystallize_start,
    surprise_crystallize_start, anticipation_crystallize_start,
    last_update, decay_tau, high_threshold, low_threshold,
    crystallize_intensity, crystallize_min_hours, created_at, updated_at, deleted_at
)
SELECT
    entity_id, joy_intensity, sadness_intensity, trust_intensity, disgust_intensity,
    fear_intensity, anger_intensity, surprise_intensity, anticipation_intensity,
    joy_baseline, sadness_baseline, trust_baseline, disgust_baseline, fear_baseline,
    anger_baseline, surprise_baseline, anticipation_baseline,
    joy_crystallize_start, sadness_crystallize_start, trust_crystallize_start,
    disgust_crystallize_start, fear_crystallize_start, anger_crystallize_start,
    surprise_crystallize_start, anticipation_crystallize_start,
    last_update, decay_tau, high_threshold, low_threshold,
    crystallize_intensity, crystallize_min_hours, created_at, updated_at, deleted_at
FROM emotion_state;

DROP TABLE emotion_state;
ALTER TABLE emotion_state_new RENAME TO emotion_state;

-- ── entity_emoji_actions: §9-A9 rebuild (timestamp labels → DATETIME + dormant defaults) ──
CREATE TABLE entity_emoji_actions_new (
    id TEXT PRIMARY KEY NOT NULL,
    entity_id TEXT NOT NULL,
    emoji_native TEXT NOT NULL,
    emotion_effect TEXT,
    metabolism_vector TEXT,
    substitution_text TEXT,
    auto_generated INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME DEFAULT NULL,
    FOREIGN KEY (entity_id) REFERENCES entities(id),
    UNIQUE(entity_id, emoji_native)
);

INSERT INTO entity_emoji_actions_new (
    id, entity_id, emoji_native, emotion_effect, metabolism_vector,
    substitution_text, auto_generated, is_default,
    created_at, updated_at, deleted_at
)
SELECT
    id, entity_id, emoji_native, emotion_effect, metabolism_vector,
    substitution_text, auto_generated, is_default,
    created_at, updated_at, deleted_at
FROM entity_emoji_actions;

DROP TABLE entity_emoji_actions;
ALTER TABLE entity_emoji_actions_new RENAME TO entity_emoji_actions;

-- ── interactions: §9-A9 rebuild (6 timestamp labels → DATETIME, NULL keywords, engine FK) ──
CREATE TABLE interactions_new (
    id TEXT PRIMARY KEY NOT NULL,
    entity_id TEXT NOT NULL,
    interaction_scope TEXT NOT NULL,
    participant_key TEXT,
    participant_ids TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    started_at DATETIME NOT NULL,
    last_activity_at DATETIME NOT NULL,
    ended_at DATETIME,
    metadata TEXT,
    deleted_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    summary TEXT DEFAULT '',
    memory_id TEXT NULL,
    continued_interaction_id TEXT NULL,
    presence_type TEXT NOT NULL DEFAULT 'unknown',
    FOREIGN KEY (entity_id) REFERENCES entities(id)
);

INSERT INTO interactions_new (
    id, entity_id, interaction_scope, participant_key, participant_ids,
    status, started_at, last_activity_at, ended_at, metadata, deleted_at,
    created_at, updated_at, summary, memory_id, continued_interaction_id, presence_type
)
SELECT
    id, entity_id, interaction_scope, participant_key, participant_ids,
    status, started_at, last_activity_at, ended_at, metadata, deleted_at,
    created_at, updated_at, summary, memory_id, continued_interaction_id, presence_type
FROM interactions;

DROP TABLE interactions;
ALTER TABLE interactions_new RENAME TO interactions;

-- Re-create the engine-backed indexes on the rebuilt FK-child tables (the
-- rebuilds dropped them). idx_interactions_active / idx_interactions_lookup are
-- engine-mirror performance indexes the app must carry for schema parity.
CREATE INDEX idx_emoji_actions_entity_id ON entity_emoji_actions(entity_id);
CREATE INDEX idx_emotion_state_entity_id ON emotion_state(entity_id);
CREATE INDEX idx_interactions_active ON interactions(entity_id, status, last_activity_at DESC);
CREATE INDEX idx_interactions_lookup ON interactions(entity_id, interaction_scope, participant_key);

PRAGMA foreign_keys = ON;
`;
