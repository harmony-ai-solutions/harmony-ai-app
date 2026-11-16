# Phase 6: Memory & RAG Collection Browser

## Objective

Fill the `Memories` and `Knowledge` tabs of the `CharacterStateSheet` (Phase 5):
a browsable timeline of the AI's memories and a browser over its RAG vector
collections / documents. Read-only in v1 (plus the engine's existing similarity
test-query); editing/deleting deferred.

Depends on: Phase 5 (sheet + tabs). No engine changes — all routes exist.

## Context (verified)

### Memories (app client already exists)

- `GET /api/entities/:id/memories?limit=&offset=` →
  `MemoriesResponseDto { memories: MemoryDto[]; has_more; next_offset }`
  (`EngineApiClient.ts:247-251`, `entityMemories()` at `:1398`).
- `MemoryDto`: `id, entity_id, compaction_level, content,
  emotional_state_bits, start_date, end_date, created_at, updated_at,
  deleted_at`.
- Repository `src/services/engine/repositories/memories.ts`:
  `getMemoriesForEntity(entityId)` walks pages (200/page, 10 000 cap) →
  `Memory[]` (`database/models.ts:667-678`). Write paths intentionally throw
  `EngineApiUnsupportedError` — engine owns memories.

### RAG collections (engine routes exist, app client MISSING)

`management/server.go:648-678`:

| Route | Response |
|---|---|
| `GET /api/entities/:id/rag/collections` | `{ collections: CollectionInfo[] }` |
| `GET .../:name` | `{ info: CollectionInfo, stats: CollectionStats }` |
| `GET .../:name/documents?archetype=&category=` | `{ documents: DocumentInfo[], total }` |
| `GET .../:name/documents/:docId` | `DocumentDetails` (incl. `embedding`, `metadata`) |
| `POST .../:name/test-query` | `{ query, results: QueryResult[] }` |
| `GET .../:name/groups` | `GroupedCollectionView` |
| `GET .../:name/groups/:archetype/:groupName` | `GroupedDocuments` |
| `PUT / DELETE .../documents/:docId`, group add/delete | write paths (DEFERRED) |

Wire shapes (`harmony-link-private/modules/rag/base.go:145-246`):
- `CollectionInfo { name, documentCount, lastUpdated, embeddingDim }`
- `CollectionStats { name, totalDocuments, archetypeBreakdown, categoryBreakdown,
  nameBreakdown, embeddingDimension, lastUpdated }`
- `DocumentInfo { id, content, metadata, archetype, category, name, createdAt }`
- `DocumentDetails` = DocumentInfo + `embedding: number[]`
- `QueryResult { documentId, content, metadata, similarity, archetype, category, name }`
- `GroupedCollectionView { collectionName, groups: {archetype: ArchetypeGroup[]},
  totalDocuments, supported }`, `ArchetypeGroup { archetype, name,
  documentCount, categories, lastUpdated }`
- `TestQueryRequest { query, limit, archetype?, category? }`

Note: JSON keys are camelCase (`documentCount`, `lastUpdated`, `createdAt`) —
the app's DTOs must match exactly (no snake_case conversion; recall the
EngineApiClient header note about Go dropping unknown keys).

## Design

### `Memories` tab

```
[ Search memories… ]            [ L0 | L1 | L2 | All ]   ← compaction filter
┌───────────────────────────────────────────────────┐
│ L2 · Core        Nov 12 – now        [😊 trust ▲]   │
│ "Mira prefers tea over coffee; keeps old maps…"    │
├───────────────────────────────────────────────────┤
│ L1 · Summary     Nov 10 – Nov 12                    │
│ "We talked about the harbor and the lighthouse…"   │
├───────────────────────────────────────────────────┤
│ L0 · Raw         Nov 10, 14:02                      │
│ "…" (collapsed, tap to expand)                     │
└───────────────────────────────────────────────────┘
```

- Group/sort by `compaction_level` (L2 core first) then `created_at` desc.
- `emotional_state_bits` is opaque (compact Ekman8 bitfield) — do NOT decode;
  show a neutral "emotional context" dot at most. Never invent emotion labels
  from it.
- Tap a row → expand full `content` + date range in-place (no separate screen).

### `Knowledge` tab

```
Collections                                    [refresh]
┌ lore               128 docs · dim 1536 · Nov 16 ┐
└ chat_history        64 docs · dim 1536 · Nov 17 ┘
        ↓ select "lore"
Filter: [All archetypes ▾] [All categories ▾]   [Search…]
Documents (128)
  • "The lighthouse keeper"   [character · bio]   Nov 16   →
Test this knowledge
[ "who keeps the lighthouse?"        ] [Run query]
  1. 0.91  "The lighthouse keeper"  …
```

- Collection cards from `CollectionInfo` + `stats.archetypeBreakdown` as chips.
- Document rows from `DocumentInfo`: `name || id`, `content` snippet,
  `archetype`/`category` badges, `createdAt`; tap → details sheet with full
  content + metadata (embedding vector NOT displayed, just "dim 1536").
- "Test this knowledge" uses `POST /:name/test-query` with `limit: 5`, showing
  similarity scores — a genuinely useful debugging tool for RAG relevance.
- Grouped view (`/groups`) is optional for v1; use the flat documents + filter
  chips first. Never send an empty query.
- Empty/error states: no RAG module configured → "No knowledge collections for
  this character yet"; a failed collection (registry nil → 404/503) degrades
  to that state, never a crash.

## Steps

1. `EngineApiClient.ts` — add DTOs above (camelCase keys) + methods:
   `entityRagCollections`, `entityRagCollection`, `entityRagDocuments`,
   `entityRagDocument`, `entityRagGroups`, `entityRagTestQuery`. All use the
   existing `getJson` / `sendJson` helpers; additive only.
2. `src/services/engine/repositories/ragCollections.ts` (new) — thin typed
   wrappers (mirrors `memories.ts` / `emotion_state.ts`), no pagination needed
   for documents (engine returns all).
3. `src/components/chat/MemoriesTab.tsx`, `KnowledgeTab.tsx`,
   `DocumentDetailsSheet.tsx` (new) — mounted by `CharacterStateSheet` (Phase 5).
4. `CharacterStateSheet.tsx` — replace placeholders; lazy-load each tab's data
   on first activation (avoid 3 network calls on chat open); refresh on tab
   re-focus + pull-to-refresh.
5. i18n keys (Phase 7): `tabMemories`, `tabKnowledge`, `memoryLevelCore`,
   `memoryLevelSummary`, `memoryLevelRaw`, `memoryEmpty`, `knowledgeEmpty`,
   `collections`, `documentsCount`, `filterArchetype`, `filterCategory`,
   `testKnowledge`, `runQuery`, `similarity`, `documentDetails`.
6. Tests: DTO conformance against engine shapes (fixtures), client method URLs,
   repositories, tab rendering (empty + populated), filters, test-query results,
   detail sheet never exposes the raw embedding vector, graceful 404/503.

## Files

- `src/services/engine/EngineApiClient.ts`
- `src/services/engine/repositories/ragCollections.ts` (new)
- `src/components/chat/{MemoriesTab,KnowledgeTab,DocumentDetailsSheet}.tsx` (new)
- `src/components/chat/CharacterStateSheet.tsx`
- `src/services/engine/__fixtures__/managementContract.fixtures.ts` (additive)
- tests alongside each

## Checklist

- [ ] Typed RAG DTOs (camelCase) + client methods added
- [ ] Memories timeline (compaction levels, dates, expand, no emotion decoding)
- [ ] Collection + document browser with filters and details sheet
- [ ] Test-query box with similarity results
- [ ] Lazy loading + graceful empty/error states
- [ ] Write paths deferred (documented in summary open items)
- [ ] Tests pass; nothing committed
