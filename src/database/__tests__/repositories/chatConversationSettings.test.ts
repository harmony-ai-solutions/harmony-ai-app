/**
 * Chat Conversation Settings Repository Tests
 *
 * Locks the client-only per-conversation state used by the chat list long-press
 * actions (pin / archive / mute / block) and unread counters.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {
  getChatConversationSettings,
  getChatConversationSettingsBatch,
  setConversationPinned,
  setConversationArchived,
  setConversationMuted,
  setConversationBlocked,
  incrementConversationUnread,
  clearConversationUnread,
  conversationSettingsExistForEntity,
  listConversationsByFlag,
  getBlockedConversation,
  getBlockedEntityIds,
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
      muted: false,
      blocked: false,
      unreadCount: 0,
    });
  });

  it('persists pin / archive / mute / block flags independently', async () => {
    await setConversationPinned('user+e1', 'e1', true);
    await setConversationArchived('user+e1', 'e1', false);
    await setConversationMuted('user+e1', 'e1', true);
    await setConversationBlocked('user+e1', 'e1', false);

    let s = await getChatConversationSettings('user+e1');
    expect(s.pinned).toBe(true);
    expect(s.archived).toBe(false);
    expect(s.muted).toBe(true);
    expect(s.blocked).toBe(false);
    expect(s.entityId).toBe('e1');

    // Toggle off pin, keep the rest.
    await setConversationPinned('user+e1', 'e1', false);
    s = await getChatConversationSettings('user+e1');
    expect(s.pinned).toBe(false);
    expect(s.muted).toBe(true);
  });

  it('increments and clears unread counters', async () => {
    await incrementConversationUnread('user+e2', 'e2');
    await incrementConversationUnread('user+e2', 'e2');
    await incrementConversationUnread('user+e2', 'e2');

    let s = await getChatConversationSettings('user+e2');
    expect(s.unreadCount).toBe(3);

    await clearConversationUnread('user+e2');
    s = await getChatConversationSettings('user+e2');
    expect(s.unreadCount).toBe(0);
    // Flags survive the clear.
    expect(s.blocked).toBe(false);
  });

  it('incrementConversationUnread creates the row for a brand-new key', async () => {
    await incrementConversationUnread('user+e3', 'e3');
    const s = await getChatConversationSettings('user+e3');
    expect(s.unreadCount).toBe(1);
    expect(s.entityId).toBe('e3');
  });

  it('batch load returns only keys with rows', async () => {
    await setConversationPinned('user+e4', 'e4', true);
    await incrementConversationUnread('user+e5', 'e5');

    const map = await getChatConversationSettingsBatch(['user+e4', 'user+e5', 'user+e6']);
    expect(map.size).toBe(2);
    expect(map.get('user+e4')?.pinned).toBe(true);
    expect(map.get('user+e5')?.unreadCount).toBe(1);
    expect(map.has('user+e6')).toBe(false);
  });

  it('batch load handles empty input', async () => {
    const map = await getChatConversationSettingsBatch([]);
    expect(map.size).toBe(0);
  });

  it('lists conversations by flag', async () => {
    await setConversationBlocked('user+e7', 'e7', true);
    await setConversationBlocked('user+e8', 'e8', true);
    await setConversationMuted('user+e9', 'e9', true);

    const blocked = await listConversationsByFlag('blocked');
    const blockedKeys = blocked.map(b => b.participantKey).sort();
    expect(blockedKeys).toEqual(['user+e7', 'user+e8']);

    const muted = await listConversationsByFlag('muted');
    expect(muted.map(m => m.participantKey)).toEqual(['user+e9']);
  });

  it('getBlockedConversation returns the row only when blocked', async () => {
    await setConversationBlocked('user+e10', 'e10', true);
    const blocked = await getBlockedConversation('user+e10');
    expect(blocked?.participantKey).toBe('user+e10');

    // Not blocked yet → null even though a row exists.
    await setConversationMuted('user+e11', 'e11', true);
    const notBlocked = await getBlockedConversation('user+e11');
    expect(notBlocked).toBeNull();
  });

  it('getBlockedEntityIds returns only non-null entity ids of blocked conversations', async () => {
    await setConversationBlocked('user+e12', 'e12', true);
    await setConversationBlocked('group:1+2+3', null, true);
    const ids = await getBlockedEntityIds();
    expect(ids).toEqual(['e12']);
  });

  it('conversationSettingsExistForEntity reflects row presence', async () => {
    expect(await conversationSettingsExistForEntity('e13')).toBe(false);
    await setConversationPinned('user+e13', 'e13', true);
    expect(await conversationSettingsExistForEntity('e13')).toBe(true);
  });
});
