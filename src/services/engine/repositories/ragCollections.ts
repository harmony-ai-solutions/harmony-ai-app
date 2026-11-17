/**
 * RAG collections — management-API-backed repository adapter (tts-voice-ux
 * Phase 6).
 *
 * Backed by the engine's entity-scoped RAG routes (`management/server.go:648-678`):
 *   - `GET  /api/entities/:id/rag/collections`
 *   - `GET  /api/entities/:id/rag/collections/:name`
 *   - `GET  /api/entities/:id/rag/collections/:name/documents?archetype=&category=`
 *   - `GET  /api/entities/:id/rag/collections/:name/documents/:docId`
 *   - `GET  /api/entities/:id/rag/collections/:name/groups`
 *   - `POST /api/entities/:id/rag/collections/:name/test-query`
 *
 * Thin typed passthroughs (like `memories.ts` / `emotion_state.ts`): the wire
 * shapes are already camelCase and stable (`modules/rag/base.go:145-246`), so no
 * second mapping layer is introduced. Documents are NOT paginated — the engine
 * returns the collection's full list. Write paths (PUT/DELETE document, group
 * add/delete) are intentionally out of scope for v1; adding them here would
 * advertise an unsupported capability.
 */

import { engineApiClient } from '../EngineApiClient';
import type {
  CollectionInfoDto,
  CollectionStatsDto,
  DocumentDetailsDto,
  DocumentInfoDto,
  GroupedCollectionViewDto,
  QueryResultDto,
  TestQueryRequestDto,
} from '../EngineApiClient';

/** The entity's RAG collections (empty when the engine has no RAG module). */
export async function listRagCollections(entityId: string): Promise<CollectionInfoDto[]> {
  const res = await engineApiClient.entityRagCollections(entityId);
  return res.collections ?? [];
}

/** One collection's info + statistics. */
export async function getRagCollection(
  entityId: string,
  collectionName: string,
): Promise<{ info: CollectionInfoDto | null; stats: CollectionStatsDto | null }> {
  const res = await engineApiClient.entityRagCollection(entityId, collectionName);
  return { info: res.info ?? null, stats: res.stats ?? null };
}

/** Every document of a collection, optionally filtered engine-side. */
export async function getRagDocuments(
  entityId: string,
  collectionName: string,
  filters: { archetype?: string; category?: string } = {},
): Promise<DocumentInfoDto[]> {
  const res = await engineApiClient.entityRagDocuments(entityId, collectionName, {
    // An empty filter must mean "no filter", never `?archetype=`.
    archetype: filters.archetype || undefined,
    category: filters.category || undefined,
  });
  return res.documents ?? [];
}

/** One document including its embedding vector (diagnostics only). */
export async function getRagDocument(
  entityId: string,
  collectionName: string,
  documentId: string,
): Promise<DocumentDetailsDto> {
  return engineApiClient.entityRagDocument(entityId, collectionName, documentId);
}

/** The grouped archetype/name perspective of a collection. */
export async function getRagCollectionGroups(
  entityId: string,
  collectionName: string,
): Promise<GroupedCollectionViewDto> {
  return engineApiClient.entityRagGroups(entityId, collectionName);
}

/**
 * Similarity test query against a collection's live vector index. The engine
 * requires a non-empty query, so an empty/whitespace one is rejected here
 * instead of being sent (`limit` defaults to 5, matching the browser UI).
 */
export async function testRagQuery(
  entityId: string,
  collectionName: string,
  query: string,
  opts: { limit?: number; archetype?: string; category?: string } = {},
): Promise<QueryResultDto[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error('RAG test query must not be empty');
  }
  const body: TestQueryRequestDto = { query: trimmed, limit: opts.limit ?? 5 };
  if (opts.archetype) body.archetype = opts.archetype;
  if (opts.category) body.category = opts.category;
  const res = await engineApiClient.entityRagTestQuery(entityId, collectionName, body);
  return res.results ?? [];
}
