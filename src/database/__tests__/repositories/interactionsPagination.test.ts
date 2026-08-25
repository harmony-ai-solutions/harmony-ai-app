/**
 * getPhoneConversationsPage — paginated chat-list query tests.
 *
 * Locks the F6/O11 behavior: the chat list pages conversations (deduped by
 * participant_key) ordered by the LAST MESSAGE `created_at` — NOT
 * `interactions.last_activity_at` — with offset/limit pagination, and
 * conversations without messages sorting last.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {createInteraction, getPhoneConversationsPage} from '../../repositories/interactions';
import {Interaction} from '../../models';

describe('getPhoneConversationsPage', () => {
  const {getDb} = useFreshDatabase();

  async function seedInteraction(
    id: string,
    participantKey: string,
    participantIds: string[],
    lastActivityAt?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const interaction: Interaction = {
      id,
      entity_id: 'user',
      interaction_scope: participantIds.length === 2 ? 'private' : 'group',
      participant_key: participantKey,
      participant_ids: JSON.stringify(participantIds),
      status: 'active',
      started_at: now,
      last_activity_at: lastActivityAt ?? now,
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
    await createInteraction(interaction);
  }

  /** Insert a message with a CONTROLLED created_at (repo always uses "now"). */
  async function seedMessage(interactionId: string, createdAtIso: string): Promise<void> {
    const db = getDb();
    await db.executeSql(
      `INSERT INTO conversation_messages
         (id, entity_id, sender_entity_id, interaction_id, content,
          message_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [`msg-${interactionId}-${createdAtIso}`, 'user', 'e1', interactionId, 'hi', 'text', createdAtIso, createdAtIso],
    );
  }

  it('orders conversations by last-message created_at, newest first', async () => {
    // conv-a: message at 10:00 (newest)
    await seedInteraction('ix-a', 'user+a', ['user', 'a']);
    await seedMessage('ix-a', '2026-08-20T10:00:00.000Z');
    // conv-b: message at 09:00
    await seedInteraction('ix-b', 'user+b', ['user', 'b']);
    await seedMessage('ix-b', '2026-08-20T09:00:00.000Z');
    // conv-c: NO messages — sorts last even though its interaction row is newest
    await seedInteraction('ix-c', 'user+c', ['user', 'c']);

    const rows = await getPhoneConversationsPage('user', {limit: 10, offset: 0});
    expect(rows.map(r => r.participantKey)).toEqual(['user+a', 'user+b', 'user+c']);
  });

  it('uses last-message time, NOT interactions.last_activity_at', async () => {
    // conv-x has the NEWER interaction row (last_activity_at)...
    await seedInteraction(
      'ix-x',
      'user+x',
      ['user', 'x'],
      '2026-08-20T12:00:00.000Z',
    );
    // ...but its last message is OLD (yesterday).
    await seedMessage('ix-x', '2026-08-19T08:00:00.000Z');
    // conv-y's interaction row is OLDER...
    await seedInteraction(
      'ix-y',
      'user+y',
      ['user', 'y'],
      '2026-08-20T08:00:00.000Z',
    );
    // ...but its last message is NEWER.
    await seedMessage('ix-y', '2026-08-20T10:00:00.000Z');

    // The old query (ORDER BY last_activity_at DESC) would return [x, y].
    // The unified recency (last message created_at) must return [y, x].
    const rows = await getPhoneConversationsPage('user', {limit: 10, offset: 0});
    expect(rows.map(r => r.participantKey)).toEqual(['user+y', 'user+x']);
  });

  it('dedupes multiple interactions of the same participant_key into one row', async () => {
    await seedInteraction('ix-1', 'user+dup', ['user', 'dup']);
    await seedInteraction('ix-2', 'user+dup', ['user', 'dup']);
    await seedMessage('ix-1', '2026-08-20T10:00:00.000Z');

    const rows = await getPhoneConversationsPage('user', {limit: 10, offset: 0});
    expect(rows).toHaveLength(1);
    expect(rows[0].participantKey).toBe('user+dup');
  });

  it('pages with offset and never repeats keys across pages', async () => {
    for (let i = 0; i < 5; i++) {
      const id = `ix-p${i}`;
      const key = `user+p${i}`;
      await seedInteraction(id, key, ['user', `p${i}`]);
      // Stagger message times so ordering is deterministic (p0 newest).
      await seedMessage(id, `2026-08-20T1${4 - i}:00:00.000Z`);
    }

    const page1 = await getPhoneConversationsPage('user', {limit: 2, offset: 0});
    const page2 = await getPhoneConversationsPage('user', {limit: 2, offset: 2});
    const page3 = await getPhoneConversationsPage('user', {limit: 2, offset: 4});

    expect(page1.map(r => r.participantKey)).toEqual(['user+p0', 'user+p1']);
    expect(page2.map(r => r.participantKey)).toEqual(['user+p2', 'user+p3']);
    expect(page3.map(r => r.participantKey)).toEqual(['user+p4']);

    const all = [...page1, ...page2, ...page3].map(r => r.participantKey);
    expect(new Set(all).size).toBe(5); // disjoint pages
  });

  it('excludes soft-deleted interactions and non-phone presence', async () => {
    await seedInteraction('ix-live', 'user+live', ['user', 'live']);
    await seedMessage('ix-live', '2026-08-20T10:00:00.000Z');

    // Soft-deleted interaction of another key.
    await seedInteraction('ix-gone', 'user+gone', ['user', 'gone']);
    await seedMessage('ix-gone', '2026-08-20T11:00:00.000Z');
    const db = getDb();
    await db.executeSql(
      `UPDATE interactions SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), new Date().toISOString(), 'ix-gone'],
    );

    // Non-phone interaction must not appear either.
    const now = new Date().toISOString();
    await createInteraction({
      id: 'ix-web',
      entity_id: 'user',
      interaction_scope: 'private',
      participant_key: 'user+web',
      participant_ids: JSON.stringify(['user', 'web']),
      status: 'active',
      started_at: now,
      last_activity_at: now,
      ended_at: null,
      memory_id: null,
      continued_interaction_id: null,
      metadata: null,
      summary: null,
      presence_type: 'web',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });

    const rows = await getPhoneConversationsPage('user', {limit: 10, offset: 0});
    expect(rows.map(r => r.participantKey)).toEqual(['user+live']);
  });
});