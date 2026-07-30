/**
 * Unit tests for BiometricLockService.
 *
 * Focus: the race-condition / deadlock fixes.
 *  - `accessControl` is enforced at READ time (so the prompt always shows).
 *  - `authenticateBiometric` is bounded by a timeout so an interrupted prompt
 *    (screen-off / background / system cancel) can never hang the UI forever.
 */
import BiometricLockService from '../BiometricLockService';

// The react-native-keychain mock lives in jest.setup.js; grab the mocked fns.
// jest's module registry returns the SAME mock instance the service uses.
const Keychain = require('react-native-keychain');

describe('BiometricLockService', () => {
  beforeEach(() => {
    // Reset implementations and re-establish safe defaults per test.
    Keychain.getGenericPassword.mockReset();
    Keychain.getGenericPassword.mockResolvedValue(false);
    Keychain.setGenericPassword.mockReset();
    Keychain.setGenericPassword.mockResolvedValue(undefined);
    Keychain.getSupportedBiometryType.mockReset();
    Keychain.getSupportedBiometryType.mockResolvedValue(null);
  });

  describe('authenticateBiometric', () => {
    it('enforces the OS prompt by passing accessControl at read time', async () => {
      // Resolves with stored credentials => biometric succeeded.
      Keychain.getGenericPassword.mockResolvedValueOnce({
        username: 'biometric_check',
        password: '1234',
      });

      const ok = await BiometricLockService.authenticateBiometric();

      expect(ok).toBe(true);
      expect(Keychain.getGenericPassword).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'HarmonyAIChat_BiometricLock',
          accessControl: expect.any(String),
        }),
      );
    });

    it('returns false when no biometric credential is stored', async () => {
      Keychain.getGenericPassword.mockResolvedValueOnce(false);
      await expect(BiometricLockService.authenticateBiometric()).resolves.toBe(false);
    });

    it('returns false when the user cancels the prompt', async () => {
      Keychain.getGenericPassword.mockRejectedValueOnce(new Error('Error: Cancel'));
      await expect(BiometricLockService.authenticateBiometric()).resolves.toBe(false);
    });

    it('does NOT hang when the prompt is interrupted (timeout safety net)', async () => {
      // Reproduces the "stuck on Authenticating" bug: the OS kills the prompt
      // (screen-off / background) and keychain never calls back. The service
      // must give up after its timeout instead of leaving the UI stranded.
      jest.useFakeTimers();
      Keychain.getGenericPassword.mockReturnValueOnce(new Promise(() => {}));

      const pending = BiometricLockService.authenticateBiometric();
      // Advance well past the configured prompt timeout.
      jest.advanceTimersByTime(60000);

      const result = await pending;
      expect(result).toBe(false);
      jest.useRealTimers();
    });
  });

  describe('setupLock', () => {
    it('stores the biometric credential with accessControl so reads can enforce it', async () => {
      Keychain.getSupportedBiometryType.mockResolvedValueOnce('FaceID');
      Keychain.setGenericPassword.mockClear();

      await BiometricLockService.setupLock('1234');

      expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
        'biometric_check',
        '1234',
        expect.objectContaining({
          service: 'HarmonyAIChat_BiometricLock',
          accessControl: expect.any(String),
          accessible: expect.any(String),
        }),
      );
    });
  });
});
