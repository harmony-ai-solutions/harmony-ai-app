/**
 * Migration 000047: add `language` column to provider_config_soulbitscloud
 * (paired with engine 000047 — the Soulbits Engine gains a `language` field on
 * the soulbitscloud TTS provider config; the beta TTS worker REQUIRES
 * `language: "default"` + a preset `voice` (e.g. "Bella") for kitten-tts-mini).
 *
 * The app previously had no `language` anywhere, so it could never send one
 * over WebSocket sync. This column lets the app persist and upload it.
 *
 * Identical ALTER (both repos): `ALTER TABLE provider_config_soulbitscloud
 * ADD COLUMN language TEXT NOT NULL DEFAULT '';` — matches the engine repo
 * mirror exactly. SQLite appends ALTER-added columns after the last column.
 * The `NOT NULL DEFAULT ''` matches the existing column style (api_key,
 * model, voice, … are all `TEXT NOT NULL DEFAULT ''`).
 *
 * The UPDATE backfill MUST be mirrored here too (not just in the engine):
 * this app is the sync SOURCE OF TRUTH — it uploads its rows to the engine and
 * the engine's copy is a replica. Existing kitten-tts rows would otherwise stay
 * at '' and sync that empty value up, OVERWRITING the engine's backfilled
 * 'default' (LWW by updated_at), so beta TTS would stay broken for exactly the
 * users the backfill exists for. `''` means "omit language" and is rejected by
 * the kitten-tts worker; `'default'` is the only language it accepts.
 */
export const migration047 = `
ALTER TABLE provider_config_soulbitscloud ADD COLUMN language TEXT NOT NULL DEFAULT '';

UPDATE provider_config_soulbitscloud SET language='default' WHERE language='' AND model IN ('kitten-tts-mini','kitten-tts-micro','kitten-tts-nano');
`;