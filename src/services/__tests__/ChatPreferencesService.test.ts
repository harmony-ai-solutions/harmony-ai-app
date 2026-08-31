/**
 * ChatPreferencesService — reply-mode getter/setter tests (A6).
 *
 * The reply-mode toggle controls instant vs realistic reply pacing per
 * participant key. Storage is AsyncStorage keyed
 * `@harmony_chat_reply_mode_<participantKey>` (interim client-side storage —
 * becomes a synced `chat_conversation_settings` column in engine Phase 2/B2).
 *
 * Follows the repo's AsyncStorage test convention (jest async-storage-mock),
 * so assertions run against real get/set round-trips through the mock.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatPreferencesService, { ChatReplyMode } from '../ChatPreferencesService';

// In-memory AsyncStorage mock with the full key-enumeration surface the sweep
// needs (getAllKeys / multiRemove) plus per-test isolation. Kept as a plain
// `mock`-prefixed store so the jest.mock factory may reference it.
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach(key => mockStore.delete(key));
    }),
    getAllKeys: jest.fn(async () => Array.from(mockStore.keys())),
    clear: jest.fn(async () => {
      mockStore.clear();
    }),
  },
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const REPLY_MODE_PREFIX = '@harmony_chat_reply_mode_';

describe('ChatPreferencesService reply mode', () => {
  it('defaults to realistic when nothing is stored', async () => {
    expect(await ChatPreferencesService.getReplyMode('max+user')).toBe('realistic');
  });

  it('round-trips instant through set → get', async () => {
    await ChatPreferencesService.setReplyMode('max+user', 'instant');
    expect(await ChatPreferencesService.getReplyMode('max+user')).toBe('instant');
  });

  it('round-trips realistic through set → get', async () => {
    await ChatPreferencesService.setReplyMode('max+user', 'realistic');
    expect(await ChatPreferencesService.getReplyMode('max+user')).toBe('realistic');
  });

  it('is keyed per participant key (conversations are isolated)', async () => {
    await ChatPreferencesService.setReplyMode('max+user', 'instant');
    expect(await ChatPreferencesService.getReplyMode('max+user')).toBe('instant');
    // A different conversation is unaffected.
    expect(await ChatPreferencesService.getReplyMode('claire+user')).toBe('realistic');
    // A conversation with a similar-but-distinct key is unaffected too.
    expect(await ChatPreferencesService.getReplyMode('max2+user')).toBe('realistic');
  });

  it('stores under the @harmony_chat_reply_mode_<participantKey> key', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem');
    await ChatPreferencesService.setReplyMode('max+user', 'instant');
    expect(spy).toHaveBeenCalledWith(
      `${REPLY_MODE_PREFIX}max+user`,
      'instant',
    );
    spy.mockRestore();
  });

  it('falls back to realistic for an unknown stored value', async () => {
    await AsyncStorage.setItem(`${REPLY_MODE_PREFIX}max+user`, 'asap');
    expect(await ChatPreferencesService.getReplyMode('max+user')).toBe('realistic');
  });

  it('returns realistic when storage read fails', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    expect(await ChatPreferencesService.getReplyMode('max+user')).toBe('realistic');
  });

  it('setReplyMode type is the ChatReplyMode union', () => {
    const mode: ChatReplyMode = 'instant';
    expect(['instant', 'realistic']).toContain(mode);
  });
});

describe('ChatPreferencesService legacy-entity-pref sweep (Q14)', () => {
  it('removes every `chat_entity_pref_*` key but keeps unrelated ones', async () => {
    const keys = [
      'chat_entity_pref_char1',
      'chat_entity_pref_char2',
      'chat_global_impersonated_entity',
      '@harmony_chat_reply_mode_pk',
    ];
    const getAllKeys = jest.spyOn(AsyncStorage, 'getAllKeys').mockResolvedValue(keys);
    const multiRemove = jest.spyOn(AsyncStorage, 'multiRemove').mockResolvedValue(undefined);

    await ChatPreferencesService.sweepLegacyEntityPrefs();

    expect(getAllKeys).toHaveBeenCalled();
    // Only the dead legacy per-chat persona prefs are swept (Q14); the global
    // entity key and reply-mode key survive.
    expect(multiRemove).toHaveBeenCalledWith([
      'chat_entity_pref_char1',
      'chat_entity_pref_char2',
    ]);
  });

  it('does nothing when there are no legacy keys', async () => {
    jest.spyOn(AsyncStorage, 'getAllKeys').mockResolvedValue([
      'chat_global_impersonated_entity',
      '@harmony_chat_reply_mode_pk',
    ]);
    const multiRemove = jest.spyOn(AsyncStorage, 'multiRemove').mockResolvedValue(undefined);

    await ChatPreferencesService.sweepLegacyEntityPrefs();

    expect(multiRemove).not.toHaveBeenCalled();
  });

  it('does not throw when storage read fails', async () => {
    jest.spyOn(AsyncStorage, 'getAllKeys').mockRejectedValueOnce(new Error('boom'));
    await expect(ChatPreferencesService.sweepLegacyEntityPrefs()).resolves.toBeUndefined();
  });
});