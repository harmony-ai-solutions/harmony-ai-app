/**
 * Unit tests for BiometricLockService.
 *
 * Focus: the race-condition / deadlock fixes.
 *  - Biometric unlock uses react-native-biometrics `simplePrompt` (CryptoObject-free
 *    → ALWAYS prompts; no auth-validity reuse window like react-native-keychain had).
 *  - `authenticateBiometric` is bounded by a timeout so an interrupted prompt
 *    (screen-off / background / system cancel) can never hang the UI forever.
 */
import BiometricLockService from '../BiometricLockService';

// Mocks live in jest.setup.js. The react-native-biometrics mock returns the SAME
// shared instance for every `new` call, so this handle drives the service's fns.
const AsyncStorage = require('@react-native-async-storage/async-storage');
const rnb = new (require('react-native-biometrics').default)();

describe('BiometricLockService', () => {
  beforeEach(() => {
    rnb.isSensorAvailable.mockReset();
    rnb.isSensorAvailable.mockResolvedValue({ available: false });
    rnb.simplePrompt.mockReset();
    rnb.simplePrompt.mockResolvedValue({ success: false });
    AsyncStorage.getItem.mockReset();
    AsyncStorage.getItem.mockResolvedValue(null);
    AsyncStorage.setItem.mockReset();
    AsyncStorage.setItem.mockResolvedValue();
    AsyncStorage.removeItem.mockReset();
    AsyncStorage.removeItem.mockResolvedValue();
  });

  describe('authenticateBiometric', () => {
    it('shows the localized prompt and returns true on success', async () => {
      rnb.simplePrompt.mockResolvedValueOnce({ success: true });

      const ok = await BiometricLockService.authenticateBiometric({
        promptMessage: 'Unlock Soulbits',
      });

      expect(ok).toBe(true);
      expect(rnb.simplePrompt).toHaveBeenCalledWith(
        expect.objectContaining({ promptMessage: 'Unlock Soulbits' }),
      );
    });

    it('returns false when the user cancels (success:false, no reject)', async () => {
      rnb.simplePrompt.mockResolvedValueOnce({ success: false });
      await expect(BiometricLockService.authenticateBiometric()).resolves.toBe(false);
    });

    it('returns false when the prompt errors (rejects)', async () => {
      rnb.simplePrompt.mockRejectedValueOnce(new Error('biometric hardware error'));
      await expect(BiometricLockService.authenticateBiometric()).resolves.toBe(false);
    });

    it('does NOT hang when the prompt is interrupted (timeout safety net)', async () => {
      // Reproduces the "stuck on Authenticating" bug: the OS kills the prompt
      // (screen-off / background) and the native call never settles. The service
      // must give up after its timeout instead of leaving the UI stranded.
      jest.useFakeTimers();
      rnb.simplePrompt.mockReturnValueOnce(new Promise(() => {}));

      const pending = BiometricLockService.authenticateBiometric();
      jest.advanceTimersByTime(60000); // well past the configured prompt timeout

      const result = await pending;
      expect(result).toBe(false);
      jest.useRealTimers();
    });
  });

  describe('unlock', () => {
    it('uses the biometric prompt (not PIN comparison) when no PIN is given', async () => {
      AsyncStorage.getItem.mockResolvedValueOnce('1234'); // stored PIN present
      rnb.isSensorAvailable.mockResolvedValueOnce({ available: true });
      rnb.simplePrompt.mockResolvedValueOnce({ success: true });

      const ok = await BiometricLockService.unlock({
        prompt: { promptMessage: 'Unlock Soulbits' },
      });

      expect(ok).toBe(true);
      expect(rnb.simplePrompt).toHaveBeenCalledWith(
        expect.objectContaining({ promptMessage: 'Unlock Soulbits' }),
      );
    });

    it('returns false without prompting when biometrics are unavailable', async () => {
      AsyncStorage.getItem.mockResolvedValueOnce('1234');
      rnb.isSensorAvailable.mockResolvedValueOnce({ available: false });

      await expect(BiometricLockService.unlock()).resolves.toBe(false);
      expect(rnb.simplePrompt).not.toHaveBeenCalled();
    });

    it('verifies a provided PIN without triggering any biometric prompt', async () => {
      // Persistent stored PIN across both checks.
      AsyncStorage.getItem.mockResolvedValue('1234');

      await expect(BiometricLockService.unlock({ pin: '1234' })).resolves.toBe(true);
      await expect(BiometricLockService.unlock({ pin: '0000' })).resolves.toBe(false);
      expect(rnb.simplePrompt).not.toHaveBeenCalled();
    });
  });

  describe('setupLock', () => {
    it('stores the PIN in AsyncStorage (no native biometric key generation)', async () => {
      await BiometricLockService.setupLock('1234');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@harmony_setting_lock_pin',
        '1234',
      );
      expect(rnb.createKeys).not.toHaveBeenCalled();
    });
  });
});
