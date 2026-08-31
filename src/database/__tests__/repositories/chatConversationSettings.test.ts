/**
 * Chat Conversation Settings Repository Tests
 *
 * Locks the client-only per-conversation state used by the chat list long-press
 * actions (pin / archive) in their FINAL Phase-1 shape:
 *   - unread_count / muted / blocked are GONE (derived unread / entity flags)
 *   - reply_mode added (default 'realistic')
 *   - entity_id is the POV entity (Q6 — never the partner)
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {
  getChatConversationSettings,
  getChatConversationSettingsBatch,
  setConversationPinned,
  setConversationArchived,
  conversationSettingsExistForEntity,
  listConversationsByFlag,
} from '../../repositories/chatConversationSettings';

describe('chat conversation settings repository', () => {
  const {getDb} = useFreshDatabase();

  it('returns the default all-off settings for a conversation with no row', async () => {
    const s = await getChatConversationSettings('user+e1');
    expect(s).toEqual({
      participantKey: 'user+e1',
      entityId: null,
      pinned: false,
      archived: false,
      replyMode: 'realistic',
    });
  });

  it('persists pin / archive flags independently and writes the POV entity id', async () => {
    await setConversationPinned('user+e1', 'pov-entity', true);
    await setConversationArchived('user+e1', 'pov-entity', false);

    let s = await getChatConversationSettings('user+e1');
    expect(s.pinned).toBe(true);
    expect(s.archived).toBe(false);
    // A6: entity_id is the POV entity, never the partner.
    expect(s.entityId).toBe('pov-entity');
    expect(s.replyMode).toBe('realistic');

    // Toggle off pin, keep the rest.
    await setConversationPinned('user+e1', 'pov-entity', false);
    s = await getChatConversationSettings('user+e1');
    expect(s.pinned).toBe(false);
    expect(s.archived).toBe(false);
  });

  it('defaults reply_mode to realistic after upsert (no explicit reply_mode column write)', async () => {
    await setConversationPinned('user+sky', 'pov-sky', true);
    const s = await getChatConversationSettings('user+sky');
    expect(s.replyMode).toBe('realistic');
  });

  it('batch load returns only keys with rows', async () => {
    await setConversationPinned('user+e4', 'pov-4', true);
    await setConversationArchived('user+e5', 'pov-5', true);

    const map = await getChatConversationSettingsBatch(['user+e4', 'user+e5', 'user+e6']);
    expect(map.size).toBe(2);
    expect(map.get('user+e4')?.pinned).toBe(true);
    expect(map.get('user+e5')?.archived).toBe(true);
    expect(map.get('user+e5')?.entityId).toBe('pov-5');
    expect(map.has('user+e6')).toBe(false);
  });

  it('batch load handles empty input', async () => {
    const map = await getChatConversationSettingsBatch([]);
    expect(map.size).toBe(0);
  });

  it('lists conversations by pinned / archived flags only', async () => {
    await setConversationPinned('user+e7', 'pov-7', true);
    await setConversationArchived('user+e8', 'pov-8', true);

    const pinned = await listConversationsByFlag('pinned');
    expect(pinned.map(p => p.participantKey)).toEqual(['user+e7']);

    const archived = await listConversationsByFlag('archived');
    expect(archived.map(p => p.participantKey)).toEqual(['user+e8']);
  });

  it('conversationSettingsExistForEntity reflects row presence', async () => {
    expect(await conversationSettingsExistForEntity('e13')).toBe(false);
    await setConversationPinned('user+e13', 'pov-13', true);
    expect(await conversationSettingsExistForEntity('pov-13')).toBe(true);
  });
});
