/**
 * PK Registry Tests (4-1, Q5).
 *
 * The centralized table→primary-key-column map replaces ~7 scattered
 * `pkField ?`/`getPrimaryKeyField` ternaries across the sync layer. Every
 * registered (non-`id`-PK) table must resolve to its real PK column, and any
 * unlisted table falls back to `id`.
 *
 * A7: `lifecycle_state` must resolve to `entity_id` — its real PK (migration
 * 000040: `entity_id TEXT PRIMARY KEY`). The pre-registry send path keyed it by
 * `id` (a bug); this test locks the corrected behavior.
 */

import {PK_FIELDS, getPkField} from '../pkRegistry';

describe('PK registry (4-1, Q5)', () => {
  it('registers every non-`id`-PK table with its real primary key column', () => {
    expect(PK_FIELDS).toEqual({
      entity_module_mappings: 'entity_id',
      emotion_state: 'entity_id',
      lifecycle_state: 'entity_id',
      character_favorites: 'profile_id',
      chat_conversation_settings: 'participant_key',
    });
  });

  it('getPkField resolves every registered table', () => {
    expect(getPkField('entity_module_mappings')).toBe('entity_id');
    expect(getPkField('emotion_state')).toBe('entity_id');
    expect(getPkField('lifecycle_state')).toBe('entity_id');
    expect(getPkField('character_favorites')).toBe('profile_id');
    expect(getPkField('chat_conversation_settings')).toBe('participant_key');
  });

  it('getPkField falls back to `id` for unlisted tables', () => {
    expect(getPkField('conversation_messages')).toBe('id');
    expect(getPkField('entities')).toBe('id');
    expect(getPkField('character_profiles')).toBe('id');
    expect(getPkField('provider_config_openai')).toBe('id');
  });

  // A7 — the pre-existing send-path ternary keyed lifecycle_state by `id`.
  it('A7: lifecycle_state resolves to entity_id (000040 PK), not id', () => {
    expect(getPkField('lifecycle_state')).toBe('entity_id');
  });
});
