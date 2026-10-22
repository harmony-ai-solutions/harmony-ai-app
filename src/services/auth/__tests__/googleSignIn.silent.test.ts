/**
 * googleSignIn — silent sign-in helper tests (plan 7-14 V2).
 *
 * Covers `signInSilentlyWithGoogle()`: the headless saved-credential restore
 * used by the store launch gate. The SDK is mocked; the assertions are on the
 * success / no-credential / missing-idToken / unexpected-error branches.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
    signInSilently: jest.fn(),
    hasPlayServices: jest.fn(() => Promise.resolve(true)),
  },
  isSuccessResponse: jest.fn((r: { type?: string } | null) => r?.type === 'success'),
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { signInSilentlyWithGoogle, GoogleSignInError } from '../googleSignIn';

const mockConfigure = GoogleSignin.configure as jest.Mock;
const mockSignInSilently = GoogleSignin.signInSilently as jest.Mock;

describe('signInSilentlyWithGoogle (7-14 V2)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('configures the SDK and returns the id_token on success', async () => {
    mockSignInSilently.mockResolvedValueOnce({
      type: 'success',
      data: { idToken: 'silent-token' },
    });

    await expect(signInSilentlyWithGoogle()).resolves.toBe('silent-token');
    expect(mockConfigure).toHaveBeenCalledTimes(1);
    // Silent restore must NOT erase the saved credential.
    expect(GoogleSignin.signOut).not.toHaveBeenCalled();
  });

  it('returns null when there is no saved credential', async () => {
    mockSignInSilently.mockResolvedValueOnce({ type: 'noSavedCredentialFound', data: null });

    await expect(signInSilentlyWithGoogle()).resolves.toBeNull();
  });

  it('returns null when the success response carries no idToken', async () => {
    mockSignInSilently.mockResolvedValueOnce({ type: 'success', data: { idToken: null } });

    await expect(signInSilentlyWithGoogle()).resolves.toBeNull();
  });

  it('throws a typed GoogleSignInError on an unexpected SDK failure', async () => {
    mockSignInSilently.mockRejectedValueOnce(new Error('native boom'));

    await expect(signInSilentlyWithGoogle()).rejects.toBeInstanceOf(GoogleSignInError);
  });
});
