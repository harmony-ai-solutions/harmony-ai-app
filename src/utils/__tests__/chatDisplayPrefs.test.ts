/**
 * chatDisplayPrefs — per-conversation display preference persistence.
 *
 * Covers the tts-voice-ux Phase 5 contract: opt-in default (off), per
 * participantKey AsyncStorage key, in-memory mirror so a toggle flips
 * immediately, and fail-safe behaviour when storage is unavailable.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SHOW_EMOTION_STATE_PREFIX,
  getCachedShowEmotionState,
  getShowEmotionState,
  resetChatDisplayPrefsForTests,
  setShowEmotionState,
} from '../chatDisplayPrefs';

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;

describe('chatDisplayPrefs — "Show emotional state"', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetChatDisplayPrefsForTests();
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue(undefined);
  });

  it('defaults to off when nothing is stored (opt-in)', async () => {
    await expect(getShowEmotionState('pk-1')).resolves.toBe(false);
    expect(getItem).toHaveBeenCalledWith(`${SHOW_EMOTION_STATE_PREFIX}pk-1`);
    expect(getCachedShowEmotionState('pk-1')).toBe(false);
  });

  it('reads a stored "true" as enabled and a stored "false" as disabled', async () => {
    getItem.mockResolvedValueOnce('true');
    await expect(getShowEmotionState('pk-1')).resolves.toBe(true);

    resetChatDisplayPrefsForTests();
    getItem.mockResolvedValueOnce('false');
    await expect(getShowEmotionState('pk-2')).resolves.toBe(false);
  });

  it('keys the preference per participantKey', async () => {
    await setShowEmotionState('pk-a', true);
    expect(setItem).toHaveBeenCalledWith(`${SHOW_EMOTION_STATE_PREFIX}pk-a`, 'true');
    await setShowEmotionState('pk-b', false);
    expect(setItem).toHaveBeenCalledWith(`${SHOW_EMOTION_STATE_PREFIX}pk-b`, 'false');
  });

  it('updates the in-memory mirror synchronously on write', async () => {
    await setShowEmotionState('pk-1', true);
    expect(getCachedShowEmotionState('pk-1')).toBe(true);
    // A subsequent read is served from the mirror (no extra storage read).
    await expect(getShowEmotionState('pk-1')).resolves.toBe(true);
    expect(getItem).not.toHaveBeenCalled();
  });

  it('degrades to off when the storage read fails', async () => {
    getItem.mockRejectedValueOnce(new Error('no storage'));
    await expect(getShowEmotionState('pk-1')).resolves.toBe(false);
  });

  it('keeps the mirror value when the storage write fails', async () => {
    setItem.mockRejectedValueOnce(new Error('disk full'));
    await setShowEmotionState('pk-1', true);
    expect(getCachedShowEmotionState('pk-1')).toBe(true);
  });

  it('never touches storage without a participantKey', async () => {
    await expect(getShowEmotionState(null)).resolves.toBe(false);
    await setShowEmotionState(undefined, true);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(getCachedShowEmotionState(null)).toBeNull();
  });

  it('reports "not read yet" (null) for an unknown conversation', () => {
    expect(getCachedShowEmotionState('pk-unknown')).toBeNull();
  });
});
