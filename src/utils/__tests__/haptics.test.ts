/**
 * Unit tests for the haptics utility — verifies the Settings "Haptic
 * feedback" toggle actually gates Vibration calls.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const { Vibration } = require('react-native') as {
  Vibration?: { vibrate: jest.Mock; cancel: jest.Mock };
};

import {
  HAPTIC_FEEDBACK_STORAGE_KEY,
  hapticCancel,
  hapticLightPress,
  hapticPulse,
  isHapticFeedbackEnabled,
  loadHapticPreference,
  setHapticFeedbackEnabled,
} from '../haptics';

describe('haptics preference gating', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Default state for each test: enabled (no stored preference).
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await loadHapticPreference();
  });

  it('defaults to enabled when no stored preference exists', async () => {
    await loadHapticPreference();
    expect(isHapticFeedbackEnabled()).toBe(true);
    hapticLightPress();
    expect(Vibration!.vibrate).toHaveBeenCalledTimes(1);
  });

  it('loads a stored "false" preference as disabled', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('false');
    await loadHapticPreference();
    expect(isHapticFeedbackEnabled()).toBe(false);
    hapticLightPress();
    expect(Vibration!.vibrate).not.toHaveBeenCalled();
  });

  it('loads a stored "true" preference as enabled', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('true');
    await loadHapticPreference();
    expect(isHapticFeedbackEnabled()).toBe(true);
    hapticLightPress();
    expect(Vibration!.vibrate).toHaveBeenCalledTimes(1);
  });

  it('keeps the default (enabled) when storage read fails', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('no storage'));
    await loadHapticPreference();
    expect(isHapticFeedbackEnabled()).toBe(true);
  });

  it('persists the preference and disables haptics immediately', async () => {
    await setHapticFeedbackEnabled(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(HAPTIC_FEEDBACK_STORAGE_KEY, 'false');
    expect(isHapticFeedbackEnabled()).toBe(false);
    hapticLightPress();
    hapticPulse(50);
    expect(Vibration!.vibrate).not.toHaveBeenCalled();
  });

  it('re-enables haptics when the preference is turned back on', async () => {
    await setHapticFeedbackEnabled(false);
    await setHapticFeedbackEnabled(true);
    expect(isHapticFeedbackEnabled()).toBe(true);
    hapticLightPress();
    expect(Vibration!.vibrate).toHaveBeenCalledTimes(1);
  });

  it('still cancels a running vibration while haptics are disabled', async () => {
    await setHapticFeedbackEnabled(false);
    hapticCancel();
    expect(Vibration!.cancel).toHaveBeenCalledTimes(1);
  });

  it('no-ops on native Vibration errors', async () => {
    (Vibration!.vibrate as jest.Mock).mockImplementation(() => {
      throw new Error('VIBRATE permission not granted');
    });
    hapticLightPress();
    // Should not throw and should be a silent no-op.
    expect(isHapticFeedbackEnabled()).toBe(true);
  });
});
