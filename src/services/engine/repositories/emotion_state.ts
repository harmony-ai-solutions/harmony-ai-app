/**
 * Emotion state — management-API-backed repository adapter (task 3-2).
 *
 * Backed by `GET /api/entities/:id/emotion` (returns null when the entity has no
 * live emotion state — app `getEmotionState` parity). Write paths have no
 * management endpoint yet (the engine owns emotion state).
 */

import type { EmotionState } from '../../../database/models';
import { engineApiClient } from '../EngineApiClient';
import { EngineApiUnsupportedError } from '../EngineApiClient';
import { mapEmotionState } from '../engineApiMappers';

export async function getEmotionState(entityId: string): Promise<EmotionState | null> {
  const res = await engineApiClient.entityEmotion(entityId);
  return res.emotion_state ? mapEmotionState(res.emotion_state) : null;
}

export async function upsertEmotionState(_state: EmotionState): Promise<void> {
  throw new EngineApiUnsupportedError('upsertEmotionState');
}

export async function softDeleteEmotionState(_entityId: string): Promise<void> {
  throw new EngineApiUnsupportedError('softDeleteEmotionState');
}
