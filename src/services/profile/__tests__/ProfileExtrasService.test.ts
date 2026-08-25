/**
 * ProfileExtrasService tests.
 *
 * Follows the repo's AsyncStorage test convention (jest async-storage-mock):
 * an in-memory store is swapped in, so each test asserts against real
 * get/set round-trips through the mock. Mirrors the CategoryPreferencesService
 * test setup.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import ProfileExtrasService, { ProfileExtras } from '../ProfileExtrasService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const EMPTY: ProfileExtras = { username: '', bio: '', avatarDataUrl: null };

describe('ProfileExtrasService', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns the empty shape when nothing is stored', async () => {
    expect(await ProfileExtrasService.getExtras('user-1')).toEqual(EMPTY);
  });

  it('saveExtras trims strings and round-trips through storage', async () => {
    await ProfileExtrasService.saveExtras('user-1', {
      username: '  skyfarer  ',
      bio: '  Moonlit oracle in training.  ',
      avatarDataUrl: 'data:image/jpeg;base64,abc123',
    });

    const extras = await ProfileExtrasService.getExtras('user-1');
    expect(extras).toEqual({
      username: 'skyfarer',
      bio: 'Moonlit oracle in training.',
      avatarDataUrl: 'data:image/jpeg;base64,abc123',
    });
  });

  it('saveExtras is a FULL replace (stale fields do not survive)', async () => {
    await ProfileExtrasService.saveExtras('user-1', {
      username: 'first',
      bio: 'old bio',
      avatarDataUrl: null,
    });
    await ProfileExtrasService.saveExtras('user-1', {
      username: 'second',
      bio: '',
      avatarDataUrl: 'data:image/png;base64,new',
    });

    expect(await ProfileExtrasService.getExtras('user-1')).toEqual({
      username: 'second',
      bio: '',
      avatarDataUrl: 'data:image/png;base64,new',
    });
  });

  it('tolerates malformed stored JSON (defensive read → defaults)', async () => {
    await AsyncStorage.setItem('@harmony_profile/user-1', 'not-json{');
    expect(await ProfileExtrasService.getExtras('user-1')).toEqual(EMPTY);
  });

  it('defaults missing/malformed fields on a partial stored object', async () => {
    await AsyncStorage.setItem(
      '@harmony_profile/user-1',
      JSON.stringify({ username: 'kept', bio: 42, avatarDataUrl: null }),
    );
    expect(await ProfileExtrasService.getExtras('user-1')).toEqual({
      username: 'kept',
      bio: '',
      avatarDataUrl: null,
    });
  });

  it('isolates data per user id', async () => {
    await ProfileExtrasService.saveExtras('user-1', {
      username: 'one',
      bio: 'first',
      avatarDataUrl: null,
    });
    await ProfileExtrasService.saveExtras('user-2', {
      username: 'two',
      bio: 'second',
      avatarDataUrl: null,
    });

    expect((await ProfileExtrasService.getExtras('user-1')).username).toBe('one');
    expect((await ProfileExtrasService.getExtras('user-2')).username).toBe('two');
    expect(await ProfileExtrasService.getExtras('user-3')).toEqual(EMPTY);
  });
});