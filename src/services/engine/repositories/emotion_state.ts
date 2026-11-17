/**
 * Emotion state — management-API-backed repository adapter (task 3-2).
 *
 * Backed by `GET /api/entities/:id/emotion`, which returns the raw vector AND
 * the engine-derived view (A2: the engine is the single source of truth) in one
 * response. `getEmotionState` is kept as a thin wrapper for callers that only
 * need the vector. Write paths have no management endpoint yet (the engine owns
 * emotion state).
 */

import type { EmotionState } from '../../../database/models';
import { engineApiClient } from '../EngineApiClient';
import { EngineApiUnsupportedError } from '../EngineApiClient';
import { mapEmotionDerived, mapEmotionState } from '../engineApiMappers';
import type { EmotionDerived } from '../engineApiMappers';

/** Both halves of one emotion read — one HTTP call. */
export interface EmotionSnapshot {
  state: EmotionState | null;
  derived: EmotionDerived | null;
}

export async function getEmotionSnapshot(entityId: string): Promise<EmotionSnapshot> {
  const res = await engineApiClient.entityEmotion(entityId);
  return {
    state: res.emotion_state ? mapEmotionState(res.emotion_state) : null,
    derived: mapEmotionDerived(res.emotion_derived),
  };
}

/** Vector-only view (non-breaking wrapper). */
export async function getEmotionState(entityId: string): Promise<EmotionState | null> {
  return (await getEmotionSnapshot(entityId)).state;
}

export async function upsertEmotionState(_state: EmotionState): Promise<void> {
  throw new EngineApiUnsupportedError('upsertEmotionState');
}

export async function softDeleteEmotionState(_entityId: string): Promise<void> {
  throw new EngineApiUnsupportedError('softDeleteEmotionState');
}
