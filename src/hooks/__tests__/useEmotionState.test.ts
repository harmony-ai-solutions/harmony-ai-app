/**
 * useEmotionState — pull-based emotional-state reader (tts-voice-ux Phase 5).
 *
 * Covers: fetch gate (entity + enabled), refresh triggers (mount / token
 * bump / manual), dominant-emotion derivation (engine order tie-break), the
 * helper accessors, the engine-derived view (A2), and graceful degradation on a
 * failed read.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getEmotionSnapshot } from '../../services/engine/repositories/emotion_state';
import {
  deriveDominantEmotion,
  getEmotionBaseline,
  getEmotionIntensity,
  isEmotionCrystallized,
  useEmotionState,
} from '../useEmotionState';
import {
  buildEmotionSnapshot,
  buildEmotionState,
} from './emotionStateFixtures';

jest.mock('../../services/engine/repositories/emotion_state', () => ({
  getEmotionSnapshot: jest.fn(),
}));

const getEmotionSnapshotMock = getEmotionSnapshot as jest.Mock;


describe('useEmotionState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches the vector once when enabled with an entity', async () => {
    getEmotionSnapshotMock.mockResolvedValue(buildEmotionSnapshot());
    const { result } = await renderHook(() => useEmotionState('ent-1'));

    await waitFor(() => expect(result.current.emotion).not.toBeNull());
    expect(getEmotionSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getEmotionSnapshotMock).toHaveBeenCalledWith('ent-1');
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('exposes the engine-derived view from the same read', async () => {
    getEmotionSnapshotMock.mockResolvedValue(buildEmotionSnapshot());
    const { result } = await renderHook(() => useEmotionState('ent-1'));

    await waitFor(() => expect(result.current.derived).not.toBeNull());
    expect(result.current.derived?.dominantEmotion).toBe('joy');
    expect(result.current.derived?.intensityLabel).toBe('overwhelming');
    expect(result.current.derived?.activeDyads[0].keyword).toBe('affection');
    expect(result.current.derived?.topEmotions).toHaveLength(3);
  });

  it('keeps derived null when an older engine omits emotion_derived', async () => {
    getEmotionSnapshotMock.mockResolvedValue(buildEmotionSnapshot({ derived: null }));
    const { result } = await renderHook(() => useEmotionState('ent-1'));

    await waitFor(() => expect(result.current.emotion).not.toBeNull());
    expect(result.current.derived).toBeNull();
    expect(result.current.dominant?.emotion).toBe('joy');
  });

  it('does not fetch while the gate is closed (chip hidden, sheet closed)', async () => {
    const { result } = await renderHook(() =>
      useEmotionState('ent-1', { enabled: false }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(getEmotionSnapshotMock).not.toHaveBeenCalled();
    expect(result.current.emotion).toBeNull();
    expect(result.current.derived).toBeNull();
  });

  it('does not fetch without an entity id', async () => {
    await renderHook(() => useEmotionState(null));
    await act(async () => {
      await Promise.resolve();
    });
    expect(getEmotionSnapshotMock).not.toHaveBeenCalled();
  });

  it('re-reads when the refresh token changes (assistant turn)', async () => {
    getEmotionSnapshotMock.mockResolvedValue(buildEmotionSnapshot());
    const { result, rerender } = await renderHook(
      ({ token }: { token: number }) => useEmotionState('ent-1', { refreshToken: token }),
      { initialProps: { token: 0 } },
    );
    await waitFor(() => expect(getEmotionSnapshotMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await rerender({ token: 1 });
    });
    await waitFor(() => expect(getEmotionSnapshotMock).toHaveBeenCalledTimes(2));
    expect(result.current.emotion).not.toBeNull();
  });

  it('refresh() re-reads on demand', async () => {
    getEmotionSnapshotMock.mockResolvedValue(buildEmotionSnapshot());
    const { result } = await renderHook(() => useEmotionState('ent-1'));
    await waitFor(() => expect(getEmotionSnapshotMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.refresh();
    });
    expect(getEmotionSnapshotMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last vector and surfaces the error when a read fails', async () => {
    getEmotionSnapshotMock.mockResolvedValueOnce(buildEmotionSnapshot());
    const { result } = await renderHook(() => useEmotionState('ent-1'));
    await waitFor(() => expect(result.current.emotion).not.toBeNull());

    getEmotionSnapshotMock.mockRejectedValueOnce(new Error('engine down'));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe('engine down');
    expect(result.current.emotion).not.toBeNull();
    expect(result.current.derived).not.toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('exposes the dominant emotion (max intensity) and its baseline', async () => {
    getEmotionSnapshotMock.mockResolvedValue(buildEmotionSnapshot());
    const { result } = await renderHook(() => useEmotionState('ent-1'));
    await waitFor(() => expect(result.current.emotion).not.toBeNull());

    expect(result.current.dominant).toEqual({
      emotion: 'joy',
      intensity: 7.2,
      baseline: 3.1,
      crystallized: true,
    });
  });
});

describe('emotion helpers', () => {
  it('reads intensities / baselines / crystallization flags', () => {
    const state = buildEmotionState();
    expect(getEmotionIntensity(state, 'joy')).toBe(7.2);
    expect(getEmotionBaseline(state, 'joy')).toBe(3.1);
    expect(isEmotionCrystallized(state, 'joy')).toBe(true);
    expect(isEmotionCrystallized(state, 'anger')).toBe(false);
  });

  it('derives the dominant emotion with an engine-order tie-break', () => {
    const tie = buildEmotionState({
      joy_intensity: 5,
      sadness_intensity: 5,
      trust_intensity: 0,
      anticipation_intensity: 0,
      surprise_intensity: 0,
      fear_intensity: 0,
    });
    expect(deriveDominantEmotion(tie)?.emotion).toBe('joy');
  });

  it('returns null for a missing or all-zero vector', () => {
    expect(deriveDominantEmotion(null)).toBeNull();
    const zero = buildEmotionState({
      joy_intensity: 0,
      sadness_intensity: 0,
      trust_intensity: 0,
      disgust_intensity: 0,
      fear_intensity: 0,
      anger_intensity: 0,
      surprise_intensity: 0,
      anticipation_intensity: 0,
    });
    expect(deriveDominantEmotion(zero)).toBeNull();
  });
});
