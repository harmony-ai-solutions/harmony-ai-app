/**
 * silentSignIn — unit tests (plan 7-14 V2).
 *
 * jest.setup mocks Platform.OS='ios' globally. The default suite asserts the
 * iOS wall-only behavior (no silent primitive on the current apple-auth
 * integration); the Android suite reloads the module with a Platform mock and
 * asserts the Google silent path plus every null fallback.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../googleSignIn', () => ({
  signInSilentlyWithGoogle: jest.fn(),
}));

import { attemptSilentSignIn } from '../silentSignIn';
import { signInSilentlyWithGoogle } from '../googleSignIn';

const mockSilentGoogle = signInSilentlyWithGoogle as jest.Mock;

describe('attemptSilentSignIn — iOS (jest.setup Platform.OS="ios")', () => {
  beforeEach(() => jest.clearAllMocks());

  it('makes NO silent attempt and resolves null (wall-only)', async () => {
    await expect(attemptSilentSignIn()).resolves.toBeNull();
    expect(mockSilentGoogle).not.toHaveBeenCalled();
  });
});

describe('attemptSilentSignIn — Android', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('react-native/Libraries/Utilities/Platform');
  });

  function loadForAndroid() {
    jest.resetModules();
    jest.doMock('react-native/Libraries/Utilities/Platform', () => ({
      __esModule: true,
      default: {
        OS: 'android',
        select: (obj: Record<string, unknown>) => obj.android ?? obj.default,
      },
    }));
    const silent = require('../silentSignIn') as typeof import('../silentSignIn');
    const google = require('../googleSignIn') as typeof import('../googleSignIn');
    return { silent, google: google.signInSilentlyWithGoogle as jest.Mock };
  }

  it('returns the id_token from the Google silent path', async () => {
    const { silent, google } = loadForAndroid();
    google.mockResolvedValueOnce('silent-id-token');

    await expect(silent.attemptSilentSignIn()).resolves.toBe('silent-id-token');
    expect(google).toHaveBeenCalledTimes(1);
  });

  it('resolves null when there is no saved credential', async () => {
    const { silent, google } = loadForAndroid();
    google.mockResolvedValueOnce(null);

    await expect(silent.attemptSilentSignIn()).resolves.toBeNull();
  });

  it('resolves null when the silent path throws (never rethrows)', async () => {
    const { silent, google } = loadForAndroid();
    google.mockRejectedValueOnce(new Error('signInSilently failed'));

    await expect(silent.attemptSilentSignIn()).resolves.toBeNull();
  });
});
