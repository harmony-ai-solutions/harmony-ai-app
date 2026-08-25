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

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const REPLY_MODE_PREFIX = '@harmony_chat_reply_mode_';

describe('ChatPreferencesService reply mode', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

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