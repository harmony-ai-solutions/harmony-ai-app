/**
 * Chat Conversation Settings Repository Tests
 *
 * Locks the client-only per-conversation state used by the chat list long-press
 * actions (pin / archive) in their FINAL Phase-1 shape:
 *   - unread_count / muted / blocked are GONE (derived unread / entity flags)
 *   - reply_mode added (default 'realistic')
 *   - entity_id is the POV entity (Q6 — never the partner)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {useFreshDatabase} from '../repositoryFixtures';
import {
  getChatConversationSettings,
  getChatConversationSettingsBatch,
  setConversationPinned,
  setConversationArchived,
  conversationSettingsExistForEntity,
  listConversationsByFlag,
  getReplyMode,
  setReplyMode,
} from '../../repositories/chatConversationSettings';

// In-memory AsyncStorage mock (4-4 legacy reply-mode migration). Kept as a
// module-scoped `mock`-prefixed store so the jest.mock factory may reference it.
const mockAsyncStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockAsyncStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockAsyncStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockAsyncStore.delete(key);
    }),
    getAllKeys: jest.fn(async () => Array.from(mockAsyncStore.keys())),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach(key => mockAsyncStore.delete(key));
    }),
    clear: jest.fn(async () => {
      mockAsyncStore.clear();
    }),
  },
}));

const LEGACY_REPLY_MODE_PREFIX = '@harmony_chat_reply_mode_';

beforeEach(async () => {
  mockAsyncStore.clear();
});

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

  // ==========================================================================
  // 4-4: reply_mode — synced column + legacy AsyncStorage migration (A6)
  // ==========================================================================

  describe('reply mode (synced chat_conversation_settings.reply_mode)', () => {
    it('returns the realistic default when there is no row and no legacy key', async () => {
      expect(await getReplyMode('user+e20')).toBe('realistic');
    });

    it('round-trips instant through setReplyMode → getReplyMode', async () => {
      await setReplyMode('user+e21', 'instant');
      expect(await getReplyMode('user+e21')).toBe('instant');
    });

    it('round-trips realistic through setReplyMode → getReplyMode', async () => {
      await setReplyMode('user+e21', 'realistic');
      expect(await getReplyMode('user+e21')).toBe('realistic');
    });

    it('setReplyMode is merge-preserving (keeps pinned/archived/entity id, bumps updated_at)', async () => {
      await setConversationPinned('user+e22', 'pov-22', true);
      // Read the raw row's updated_at BEFORE the reply-mode write.
      const before = await getDb().executeSql(
        'SELECT updated_at FROM chat_conversation_settings WHERE participant_key = ?',
        ['user+e22'],
      );
      const beforeUpdatedAt = before[0].rows.item(0).updated_at;

      // Seed a reply mode, then toggle pin off — reply mode must survive.
      await setReplyMode('user+e22', 'instant');
      await setConversationPinned('user+e22', 'pov-22', false);

      const s = await getChatConversationSettings('user+e22');
      expect(s.pinned).toBe(false);
      expect(s.replyMode).toBe('instant');
      expect(s.entityId).toBe('pov-22');
      expect(s.archived).toBe(false);

      // updated_at bumps on setReplyMode.
      const after = await getDb().executeSql(
        'SELECT updated_at FROM chat_conversation_settings WHERE participant_key = ?',
        ['user+e22'],
      );
      const afterUpdatedAt = after[0].rows.item(0).updated_at;
      expect(new Date(afterUpdatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeUpdatedAt).getTime(),
      );
    });

    it('falls back to the legacy AsyncStorage key once on a no-row miss, then writes the row and deletes the key', async () => {
      const legacyKey = `${LEGACY_REPLY_MODE_PREFIX}user+e23`;
      await AsyncStorage.setItem(legacyKey, 'instant');

      expect(await getReplyMode('user+e23')).toBe('instant');

      // Legacy key deleted after the one-time migration.
      expect(await AsyncStorage.getItem(legacyKey)).toBeNull();
      // The settings row is now written with the migrated mode.
      const row = await getChatConversationSettings('user+e23');
      expect(row.replyMode).toBe('instant');
      // And a second read comes from the row (no legacy key anymore).
      expect(await getReplyMode('user+e23')).toBe('instant');
    });

    it('does not re-migrate when a synced row already exists (row value wins over a stale legacy key)', async () => {
      await setReplyMode('user+e24', 'realistic');
      // Seed a conflicting stale legacy key — must NOT override the synced row.
      await AsyncStorage.setItem(`${LEGACY_REPLY_MODE_PREFIX}user+e24`, 'instant');
      expect(await getReplyMode('user+e24')).toBe('realistic');
    });
  });
});
