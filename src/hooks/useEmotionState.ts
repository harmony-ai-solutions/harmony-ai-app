/**
 * useEmotionState — pull-based emotional-state reader (tts-voice-ux Phase 5).
 *
 * The engine owns the emotion vector and there is NO live emotion event in the
 * app, so v1 is pull-based: the hook fetches `GET /api/entities/:id/emotion`
 * and the caller decides when to re-read (`refresh()` on chat focus and on
 * sheet open, a `refreshToken` bump after each assistant turn). The same read
 * also returns the engine-DERIVED view (A2: dominant label, dyads, top
 * emotions) — the app never recomputes it. The state is always presented with
 * its `last_update` stamp — never as real-time.
 *
 * Failures degrade gracefully: the last successful vector is kept and `error`
 * is surfaced, so the UI shows an empty/last-known state instead of crashing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmotionState } from '../database/models';
import { getEmotionSnapshot } from '../services/engine/repositories/emotion_state';
import type { EmotionDerived } from '../services/engine/engineApiMappers';
import { EKMAN8_EMOTIONS, type Ekman8Emotion } from '../types/emoji';
import { createLogger } from '../utils/logger';

const log = createLogger('[useEmotionState]');

/** The strongest emotion of a vector, with its baseline + crystallization flag. */
export interface DominantEmotion {
  emotion: Ekman8Emotion;
  intensity: number;
  baseline: number;
  crystallized: boolean;
}

/** Intensity of one Ekman8 emotion (engine order preserved by the caller). */
export function getEmotionIntensity(
  state: EmotionState,
  emotion: Ekman8Emotion,
): number {
  const value = state[`${emotion}_intensity` as keyof EmotionState];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Baselines are the resting intensity an emotion decays back toward. */
export function getEmotionBaseline(
  state: EmotionState,
  emotion: Ekman8Emotion,
): number {
  const value = state[`${emotion}_baseline` as keyof EmotionState];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** A non-null `*_crystallize_start` means the emotion has crystallized. */
export function isEmotionCrystallized(
  state: EmotionState,
  emotion: Ekman8Emotion,
): boolean {
  const value = state[`${emotion}_crystallize_start` as keyof EmotionState];
  return value !== null && value !== undefined;
}

/**
 * Dominant emotion = the highest `*_intensity` (engine order breaks ties, so
 * the result is stable). `null` for a missing state or an all-zero vector.
 */
export function deriveDominantEmotion(
  state: EmotionState | null | undefined,
): DominantEmotion | null {
  if (!state) return null;
  let best: DominantEmotion | null = null;
  for (const emotion of EKMAN8_EMOTIONS) {
    const intensity = getEmotionIntensity(state, emotion);
    if (!best || intensity > best.intensity) {
      best = {
        emotion,
        intensity,
        baseline: getEmotionBaseline(state, emotion),
        crystallized: isEmotionCrystallized(state, emotion),
      };
    }
  }
  return best && best.intensity > 0 ? best : null;
}

export interface UseEmotionStateOptions {
  /** Fetch gate — when false nothing is requested (default true). */
  enabled?: boolean;
  /**
   * Any value change triggers a re-read. ChatDetailScreen bumps this after
   * each assistant turn (there is no live emotion event).
   */
  refreshToken?: number | string;
}

export interface UseEmotionStateResult {
  emotion: EmotionState | null;
  /**
   * The engine-derived view (dominant label, dyads, top emotions). `null` when
   * the engine has no state or predates `emotion_derived`.
   */
  derived: EmotionDerived | null;
  dominant: DominantEmotion | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Read the entity's emotion vector.
 *
 * @param entityId Partner entity id (null while the chat is still resolving).
 */
export function useEmotionState(
  entityId: string | null | undefined,
  options: UseEmotionStateOptions = {},
): UseEmotionStateResult {
  const { enabled = true, refreshToken } = options;

  const [emotion, setEmotion] = useState<EmotionState | null>(null);
  const [derived, setDerived] = useState<EmotionDerived | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Only the newest request may write state (a slow earlier read must never
  // overwrite a fresher one).
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  // Coalesce concurrent refreshes for the SAME entity (e.g. the sheet-open +
  // enabled-flip effects firing in the same commit into one request). A new
  // entity always issues its own read.
  const inflightRef = useRef<{ entityId: string; promise: Promise<void> } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!entityId || !enabled) return;
    if (inflightRef.current?.entityId === entityId) {
      return inflightRef.current.promise;
    }

    const requestId = ++requestIdRef.current;
    const run = (async () => {
      setLoading(true);
      try {
        const next = await getEmotionSnapshot(entityId);
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setEmotion(next.state);
        setDerived(next.derived);
        setError(null);
      } catch (err) {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Emotion state read failed for ${entityId}:`, err);
        setError(message);
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })().finally(() => {
      if (inflightRef.current?.entityId === entityId) {
        inflightRef.current = null;
      }
    });

    inflightRef.current = { entityId, promise: run };
    return run;
  }, [entityId, enabled]);

  // Fetch on entity change, when the gate opens, and on every refreshToken
  // bump (assistant turn).
  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  // Never show a previous conversation's vector while the new one loads (the
  // header chip must not display the old partner's mood).
  useEffect(() => {
    setEmotion(null);
    setDerived(null);
    setError(null);
  }, [entityId]);

  return {
    emotion,
    derived,
    dominant: deriveDominantEmotion(emotion),
    loading,
    error,
    refresh,
  };
}
