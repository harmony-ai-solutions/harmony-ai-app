export const migration037 = `
-- Add Character Card V3 standard fields AND drop the pre-V3 legacy columns
-- appearance, backstory, example_dialogues. Mirrors engine migration 000037
-- (harmony-link-private). RN migrations are forward-only (no down).
--
-- Legacy content is folded into the V3 columns so nothing is lost on migrate:
--   * appearance + backstory  ->  description   (appended as labelled sections)
--   * example_dialogues       ->  mes_example
--
-- SQLite cannot DROP COLUMN on RN's older Android build, so this uses the
-- established _new-table rebuild pattern (see migration 000031). FKs are disabled
-- for the migration session, so the DROP TABLE on the parent does not fire FK
-- cascades. Baseline note: at the 000036 schema the V3 columns do not exist yet,
-- so the SELECT seeds them with '' (description/mes_example excepted — those
-- receive the folded legacy content).

CREATE TABLE IF NOT EXISTS character_profiles_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    voice_characteristics TEXT NOT NULL DEFAULT '',
    base_prompt TEXT NOT NULL DEFAULT '',
    scenario TEXT NOT NULL DEFAULT '',
    typing_speed_wpm INTEGER NOT NULL DEFAULT 60,
    audio_response_chance_percent INTEGER NOT NULL DEFAULT 50,
    vision_config_id TEXT REFERENCES vision_configs(id) ON DELETE SET NULL,
    lifecycle_config TEXT NOT NULL DEFAULT '{}',
    deleted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Character Card V3 standard fields (spec-compliant).
    first_mes TEXT NOT NULL DEFAULT '',
    mes_example TEXT NOT NULL DEFAULT '',
    alternate_greetings TEXT NOT NULL DEFAULT '',
    post_history_instructions TEXT NOT NULL DEFAULT '',
    creator_notes TEXT NOT NULL DEFAULT '',
    creator TEXT NOT NULL DEFAULT '',
    character_version TEXT NOT NULL DEFAULT '',
    nickname TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    group_only_greetings TEXT NOT NULL DEFAULT '',
    extensions TEXT NOT NULL DEFAULT '',
    assets TEXT NOT NULL DEFAULT '',
    card_provenance TEXT NOT NULL DEFAULT '',
    character_book TEXT NOT NULL DEFAULT ''
);

INSERT INTO character_profiles_new (
    id, name, description, personality,
    voice_characteristics, base_prompt, scenario,
    typing_speed_wpm, audio_response_chance_percent, vision_config_id,
    lifecycle_config, deleted_at, created_at, updated_at,
    first_mes, mes_example, alternate_greetings, post_history_instructions,
    creator_notes, creator, character_version, nickname, tags,
    group_only_greetings, extensions, assets, card_provenance, character_book
)
SELECT
    t.id, t.name,
    (
        t.description
        || CASE WHEN trim(COALESCE(t.appearance, '')) <> ''
                THEN char(10) || char(10) || 'Appearance: ' || trim(t.appearance)
                ELSE '' END
        || CASE WHEN trim(COALESCE(t.backstory, '')) <> ''
                THEN char(10) || char(10) || 'Backstory: ' || trim(t.backstory)
                ELSE '' END
    ),
    t.personality,
    t.voice_characteristics, COALESCE(t.base_prompt, ''), COALESCE(t.scenario, ''),
    COALESCE(t.typing_speed_wpm, 60), COALESCE(t.audio_response_chance_percent, 50), t.vision_config_id,
    t.lifecycle_config, t.deleted_at, t.created_at, t.updated_at,
    '',
    COALESCE(NULLIF(trim(COALESCE(t.example_dialogues, '')), ''), ''),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ''
FROM character_profiles t;

DROP TABLE character_profiles;
ALTER TABLE character_profiles_new RENAME TO character_profiles;
`;
