/**
 * Memories — management-API-backed repository adapter (task 3-2).
 *
 * Backed by `GET /api/entities/:id/memories` (oldest-first, paginated).
 * The app's `getMemoriesForEntity` returns the full list, so we walk pages until
 * exhausted. Write paths have no management endpoint yet (the engine owns
 * memories).
 */

import type { Memory } from '../../../database/models';
import { engineApiClient } from '../EngineApiClient';
import { EngineApiUnsupportedError } from '../EngineApiClient';
import { mapMemory } from '../engineApiMappers';

export async function getMemoriesForEntity(entityId: string): Promise<Memory[]> {
  const memories: Memory[] = [];
  const pageSize = 200;
  const maxPages = 50; // safety cap: 10 000 memories
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await engineApiClient.entityMemories(entityId, {
      limit: pageSize,
      offset,
    });
    for (const dto of res.memories ?? []) {
      memories.push(mapMemory(dto));
    }
    if (!res.has_more || res.next_offset == null) break;
    offset = res.next_offset;
  }
  return memories;
}

export async function insertMemory(_memory: Memory): Promise<void> {
  throw new EngineApiUnsupportedError('insertMemory');
}

export async function upsertMemory(_memory: Memory): Promise<void> {
  throw new EngineApiUnsupportedError('upsertMemory');
}
