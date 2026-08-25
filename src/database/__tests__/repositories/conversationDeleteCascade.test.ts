/**
 * Conversation Delete Cascade Tests
 *
 * Locks the F3 behavior of `deleteConversationByParticipantKey`: deleting a
 * conversation must ALSO delete its `chat_conversation_settings` row so no
 * stale pinned / muted / archived / disabled / unread state resurrects when
 * the conversation is later re-created. The settings table has no FK to
 * interactions, so this is an explicit repo-level cascade.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {createInteraction, getInteractionById} from '../../repositories/interactions';
import {
  createConversationMessage,
  getConversationMessage,
  deleteConversationByParticipantKey,
} from '../../repositories/conversation_messages';
import {
  getChatConversationSettings,
  setConversationPinned,
  incrementConversationUnread,
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

  it('deletes the chat_conversation_settings row along with messages + interaction', async () => {
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

    // Seed settings: pinned + unread — must NOT survive the delete.
    await setConversationPinned(participantKey, 'e1', true);
    await incrementConversationUnread(participantKey, 'e1');
    expect((await getChatConversationSettings(participantKey)).pinned).toBe(true);

    await deleteConversationByParticipantKey('user', participantKey);

    // Settings row gone → default all-off, zero unread.
    const settings = await getChatConversationSettings(participantKey);
    expect(settings.pinned).toBe(false);
    expect(settings.unreadCount).toBe(0);

    // Message soft-deleted (no longer readable).
    expect(await getConversationMessage('msg-1')).toBeNull();

    // Interaction soft-deleted.
    const interaction = await getInteractionById('ix-1');
    expect(interaction?.deleted_at).not.toBeNull();
  });

  it('does not touch settings rows for OTHER conversations', async () => {
    await createInteraction(makeInteraction('ix-keep', 'user+e1'));
    await createInteraction(makeInteraction('ix-del', 'user+e2'));

    await setConversationPinned('user+e1', 'e1', true);
    await setConversationPinned('user+e2', 'e2', true);

    await deleteConversationByParticipantKey('user', 'user+e2');

    // The untouched conversation keeps its settings row.
    expect((await getChatConversationSettings('user+e1')).pinned).toBe(true);
    expect((await getChatConversationSettings('user+e2')).pinned).toBe(false);
  });

  it('is a no-op for a conversation with no settings row', async () => {
    await createInteraction(makeInteraction('ix-nosettings', 'user+e3'));
    await deleteConversationByParticipantKey('user', 'user+e3');
    // Just must not throw.
    expect((await getChatConversationSettings('user+e3')).unreadCount).toBe(0);
  });
});