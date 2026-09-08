/**
 * Conversation Delete Cascade Tests
 *
 * Locks the F3/D18 behavior of `deleteConversationByParticipantKey`: deleting a
 * conversation must TOMBSTONE its `chat_conversation_settings` row (never hard-
 * delete) so no stale pinned / archived state resurrects when the conversation
 * is later re-created, while the row itself stays physically present for the
 * local GC (4-1) to purge. Every settings read predicates `deleted_at IS NULL`
 * and re-opening the same participant_key resurrects fresh (D18). The settings
 * table has no FK to interactions, so this is an explicit repo-level cascade.
 * (Mute/disable/unread no longer live on the settings table — they are entity
 * flags / derived, respectively.)
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {createInteraction, getInteractionById} from '../../repositories/interactions';
import {createEntity} from '../../repositories/entities';
import {
  createConversationMessage,
  getConversationMessage,
  deleteConversationByParticipantKey,
  getUnreadCountByParticipantKeys,
} from '../../repositories/conversation_messages';
import {
  getChatConversationSettings,
  getChatConversationSettingsBatch,
  conversationSettingsExistForEntity,
  listConversationsByFlag,
  getReplyMode,
  setConversationPinned,
} from '../../repositories/chatConversationSettings';
import {Interaction} from '../../models';

describe('deleteConversationByParticipantKey cascade', () => {
  const {getDb} = useFreshDatabase();

  function makeInteraction(id: string, participantKey: string): Interaction {
    const now = new Date().toISOString();
    return {
      id,
      entity_id: 'user',
      interaction_scope: 'private',
      participant_key: participantKey,
      participant_ids: JSON.stringify(['user', 'e1']),
      status: 'active',
      started_at: now,
      last_activity_at: now,
      ended_at: null,
      memory_id: null,
      continued_interaction_id: null,
      metadata: null,
      summary: null,
      presence_type: 'phone',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
  }

  /** Raw deleted_at for a settings row (physical presence check). */
  async function settingsDeletedAt(participantKey: string): Promise<string | null> {
    const [result] = await getDb().executeSql(
      'SELECT deleted_at FROM chat_conversation_settings WHERE participant_key = ?',
      [participantKey],
    );
    if (result.rows.length === 0) return undefined as unknown as null;
    return result.rows.item(0).deleted_at;
  }

  it('tombstones the chat_conversation_settings row (D18) along with messages + interaction', async () => {
    // interactions.entity_id FK-constrains entities(id) — seed the POV entity.
    await createEntity(
      {id: 'user', alias: 'user', character_profile_id: null, lifecycle_config: '{}', rag_reindex_required: 1},
      {entity_type: 'user'},
    );
    const participantKey = 'user+e1';
    await createInteraction(makeInteraction('ix-1', participantKey));

    await createConversationMessage({
      id: 'msg-1',
      entity_id: 'user',
      sender_entity_id: 'e1',
      interaction_id: 'ix-1',
      content: 'Hello',
      audio_duration: null,
      message_type: 'text',
      audio_data: null,
      audio_mime_type: null,
      image_data: null,
      image_mime_type: null,
      vl_model: null,
      vl_model_interpretation: null,
      emotional_state_bits: 0,
      is_recon_followup: false,
      is_edited: false,
      edit_of_message_id: null,
      reactions_json: null,
      is_pinned: false,
    });

    // Seed settings: pinned — must NOT survive the delete. (Unread is DERIVED
    // from conversation_messages.is_read now, not a settings column — the
    // partner-sent msg-1 below is the seeded unread row.)
    await setConversationPinned(participantKey, 'e1', true);
    expect((await getChatConversationSettings(participantKey)).pinned).toBe(true);

    // D18: the settings delete must be a soft UPDATE, never a hard DELETE.
    const executeSqlSpy = jest.spyOn(getDb(), 'executeSql');
    await deleteConversationByParticipantKey('user', participantKey);
    const deleteStatements = executeSqlSpy.mock.calls
      .map(call => String(call[0]).trim().toUpperCase())
      .filter(sql => sql.startsWith('DELETE FROM'));
    expect(deleteStatements).toEqual([]);

    // Settings row STAYS physically present but is tombstoned (D18) — the
    // local GC (4-1) purges it later; it must never be hard-deleted here.
    expect(await settingsDeletedAt(participantKey)).not.toBeNull();

    // D18: the tombstoned row is filtered from ALL five read paths.
    expect((await getChatConversationSettings(participantKey)).pinned).toBe(false);
    expect((await getChatConversationSettingsBatch([participantKey])).has(participantKey)).toBe(false);
    expect(await conversationSettingsExistForEntity('e1')).toBe(false);
    expect(await listConversationsByFlag('pinned')).toHaveLength(0);
    expect(await listConversationsByFlag('archived')).toHaveLength(0);
    expect(await getReplyMode(participantKey)).toBe('realistic');

    // D18: re-opening the same participant_key resurrects fresh — the upsert
    // clears deleted_at and the row is readable again (and purgable re-stamp
    // guards apply on a later delete).
    await setConversationPinned(participantKey, 'user', true);
    expect((await getChatConversationSettings(participantKey)).pinned).toBe(true);
    expect(await settingsDeletedAt(participantKey)).toBeNull();

    // Derived unread also gone (message soft-deleted).
    const unread = await getUnreadCountByParticipantKeys([participantKey], 'user');
    expect(unread.get(participantKey) ?? 0).toBe(0);

    // Message soft-deleted (no longer readable).
    expect(await getConversationMessage('msg-1')).toBeNull();

    // Interaction soft-deleted.
    const interaction = await getInteractionById('ix-1');
    expect(interaction?.deleted_at).not.toBeNull();
  });

  it('does not touch settings rows for OTHER conversations', async () => {
    await createEntity(
      {id: 'user', alias: 'user', character_profile_id: null, lifecycle_config: '{}', rag_reindex_required: 1},
      {entity_type: 'user'},
    );
    await createInteraction(makeInteraction('ix-keep', 'user+e1'));
    await createInteraction(makeInteraction('ix-del', 'user+e2'));

    await setConversationPinned('user+e1', 'e1', true);
    await setConversationPinned('user+e2', 'e2', true);

    await deleteConversationByParticipantKey('user', 'user+e2');

    // The untouched conversation keeps its live settings row.
    expect((await getChatConversationSettings('user+e1')).pinned).toBe(true);
    expect(await settingsDeletedAt('user+e1')).toBeNull();
    // The deleted conversation's row is tombstoned and filtered.
    expect(await settingsDeletedAt('user+e2')).not.toBeNull();
    expect((await getChatConversationSettings('user+e2')).pinned).toBe(false);
  });

  it('is a no-op for a conversation with no settings row', async () => {
    await createEntity(
      {id: 'user', alias: 'user', character_profile_id: null, lifecycle_config: '{}', rag_reindex_required: 1},
      {entity_type: 'user'},
    );
    await createInteraction(makeInteraction('ix-nosettings', 'user+e3'));
    await deleteConversationByParticipantKey('user', 'user+e3');
    // Just must not throw; settings fall back to the default (all-off).
    expect((await getChatConversationSettings('user+e3')).pinned).toBe(false);
  });
});