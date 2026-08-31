/**
 * Conversation Messages — derived-unread core (A5 pull-forward)
 *
 * Locks `markConversationMessagesRead` / `markConversationMessagesUnread` /
 * `getUnreadCountByParticipantKeys`. Every query must scope `entity_id = own
 * POV` (A2): engine-perspective copies join the same `interaction_id` under a
 * different entity_id (and uuid), so unscoped queries double-count.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {
  markConversationMessagesRead,
  markConversationMessagesUnread,
  getUnreadCountByParticipantKeys,
} from '../../repositories/conversation_messages';
import {createInteraction} from '../../repositories/interactions';
import {createEntity} from '../../repositories/entities';
import type {Interaction} from '../../models';

describe('conversation messages derived unread', () => {
  const {getDb} = useFreshDatabase();

  const own = 'user';
  const partner = 'claire';
  const key = 'claire+user'; // deriveParticipantKey sorts the pair

  const makeInteraction = (
    id: string,
    entityId: string,
    participantIds: string[],
  ): Interaction => {
    const iso = new Date().toISOString();
    return {
      id,
      entity_id: entityId,
      interaction_scope: 'private',
      participant_key: key,
      participant_ids: JSON.stringify(participantIds),
      status: 'active',
      started_at: iso,
      last_activity_at: iso,
      ended_at: null,
      memory_id: null,
      continued_interaction_id: null,
      metadata: null,
      summary: null,
      presence_type: 'phone',
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
    };
  };

  /** Raw-insert a message so created_at is controllable (repo fn stamps now). */
  async function insertMessage(
    id: string,
    entityId: string,
    senderEntityId: string,
    interactionId: string,
    createdAt: string,
  ): Promise<void> {
    await getDb().executeSql(
      `INSERT INTO conversation_messages (
        id, entity_id, sender_entity_id, interaction_id, content,
        audio_duration, message_type, emotional_state_bits,
        is_recon_followup, is_edited, edit_of_message_id,
        reply_to_message_id, created_at, updated_at, deleted_at,
        reactions_json, is_pinned, is_read
      ) VALUES (?, ?, ?, ?, ?, NULL, 'text', 0, 0, 0, NULL, NULL, ?, ?, NULL, NULL, 0, 0)`,
      [id, entityId, senderEntityId, interactionId, `msg ${id}`, createdAt, createdAt],
    );
  }

  async function seed(): Promise<void> {
    // The interactions FK references entities(id) — seed the POV + partner
    // entities first (interactions.entity_id is FK-constrained).
    await createEntity(
      {id: own, alias: own, character_profile_id: null, lifecycle_config: '{}', rag_reindex_required: 1},
      {entity_type: 'user'},
    );
    await createEntity(
      {id: partner, alias: partner, character_profile_id: null, lifecycle_config: '{}', rag_reindex_required: 1},
      {entity_type: 'ai'},
    );

    // POV interaction (entity_id = user)
    await createInteraction(makeInteraction('int-pov', own, [own, partner]));
    // Engine-perspective copy (entity_id = claire) joining the SAME key
    await createInteraction(makeInteraction('int-eng', partner, [partner, own]));

    await insertMessage('m-1', own, partner, 'int-pov', '2026-01-01T00:00:00.000Z');
    await insertMessage('m-2', own, partner, 'int-pov', '2026-01-01T00:00:01.000Z');
    // Own-sent message — never counted (A2: "own messages stay 0")
    await insertMessage('m-own', own, own, 'int-pov', '2026-01-01T00:00:02.000Z');
  }

  it('counts only unread partner-sent POV rows for a key', async () => {
    await seed();
    const map = await getUnreadCountByParticipantKeys([key], own);
    expect(map.get(key)).toBe(2); // m-1 + m-2; own-sent excluded; engine copy excluded
  });

  it('scopes to entity_id = own POV (engine copy double-count guard, both directions)', async () => {
    await seed();
    // Partner-rooted (engine-perspective) message must NOT count from user POV.
    await insertMessage('m-eng-view', partner, own, 'int-eng', '2026-01-01T00:00:03.000Z');
    const map = await getUnreadCountByParticipantKeys([key], own);
    expect(map.get(key)).toBe(2); // still only the user-POV unread partner rows
  });

  it('markConversationMessagesRead sets is_read on partner-sent POV rows only (A2)', async () => {
    await seed();
    const count = await markConversationMessagesRead(key, own);
    expect(count).toBe(2);

    const map = await getUnreadCountByParticipantKeys([key], own);
    expect(map.get(key)).toBeUndefined(); // zero unread → key absent
  });

  it('markConversationMessagesRead respects deleted rows', async () => {
    await seed();
    await getDb().executeSql(
      'UPDATE conversation_messages SET deleted_at = ? WHERE id = ?',
      [new Date().toISOString(), 'm-1'],
    );
    const count = await markConversationMessagesRead(key, own);
    expect(count).toBe(1); // only m-2 (m-1 soft-deleted)
  });

  it('markConversationMessagesRead honors the upTo boundary', async () => {
    await seed();
    // upTo = m-1's id → only m-1 (created_at <= m-1) is marked, not m-2.
    const count = await markConversationMessagesRead(key, own, 'm-1');
    expect(count).toBe(1);

    const map = await getUnreadCountByParticipantKeys([key], own);
    expect(map.get(key)).toBe(1); // m-2 still unread
  });

  it('markConversationMessagesUnread sets the LAST partner-sent message unread', async () => {
    await seed();
    // Mark all read first.
    await markConversationMessagesRead(key, own);
    await markConversationMessagesUnread(key, own);
    const map = await getUnreadCountByParticipantKeys([key], own);
    expect(map.get(key)).toBe(1); // exactly one (m-2, the last partner sent)
  });

  it('returns empty map for empty key input', async () => {
    const map = await getUnreadCountByParticipantKeys([], own);
    expect(map.size).toBe(0);
  });
});
