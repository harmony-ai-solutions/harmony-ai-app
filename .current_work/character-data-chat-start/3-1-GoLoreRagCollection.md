# 3-1 — Go `lore` RAG Collection + Service Wiring

> **Phase 3.** Depends on P1 `character_book` JSON column ([1-1](1-1-GoMigration000037.md)). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/`.

## Objective

Add a per-entity `lore` chromem collection to the existing RAG module — the semantic index over the `character_book` JSON source-of-truth. Reuse the exact `MovementService`/memory pattern. Wire it through the RAG service-refresh path. Tolerate a **nil** vector store (provider not guaranteed at `INIT_ENTITY`, [00 §A2](00-VerificationAndGroundTruth.md)). Fix the stale collection-naming comment.

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md), [§A2](00-VerificationAndGroundTruth.md), [§A8](00-VerificationAndGroundTruth.md))

- `VectorStore` `modules/rag/vector_store.go:17-22`; lazy `GetOrCreateCollection:107-140`; `NewVectorStoreFromRAGConfig:38-54` returns **(nil,nil)** when disabled. **Stale comment `:14-16`** claims suffixed names — code is flat; fix it.
- `RAGModule` `modules/rag.go`: per-entity folder `:76-79`; flat names `memories:47`,`messages:48`,`cached-actions:34`,`cached-animations:35`; add-pattern `GetOrCreateCollection:656`+`AddConcurrently:610`+`Query:692`; metadata `:226-233`, returned `:269-275`; **nil-store degrade `:222-224`**.
- Hard-coded name lists to update: `ListCollections:1074-1079`, `DropEntityCollections:153-167`, `ListCollectionGroups:1117`.
- `MovementService` interface `modules/rag/base.go:76-88`; `QueryTextResultSet`/`Metadata map[string]string` `base.go:145-153`.
- Provider NOT guaranteed at INIT_ENTITY: `rag_config_id` NULL/missing → `ProviderDisabled` → `NewVectorStoreFromRAGConfig` nil ([00 §A2](00-VerificationAndGroundTruth.md)).
- Wiring: `RefreshRAGServices`/`RefreshMovementService` `eventserver/eventprocessor.go:686-700`.

## Design

- New flat collection name `lore` (free — [00 §B.1 RAG claim 5](00-VerificationAndGroundTruth.md)).
- A `LoreService` interface (in `modules/rag/base.go` near `MovementService:76`) implemented by `RAGModule`:
  ```go
  type LoreService interface {
      // IndexLoreEntry embeds one entry's content (id/metadata point back to the JSON source).
      IndexLoreEntry(entryID string, content string, metadata map[string]string) error
      // RemoveLoreEntry deletes one entry's embedding (disable/un-embed).
      RemoveLoreEntry(entryID string) error
      // QueryLore returns top-N entries semantically matching queryText (nil-store → empty, no error).
      QueryLore(ctx context.Context, queryText string, n int) ([]QueryTextResultElement, error)
      // DropLoreCollection clears the whole lore index (re-ingest).
      DropLoreCollection() error
  }
  ```
- Metadata per entry: `{ "entry_id": <id>, "profile_id": <profileId>, "constant": "true"|"false", "name": <entry name> }` (map[string]string — chromem requirement). `content` = the entry's `content` (the embedded text).
- **Nil-store tolerance:** every method returns empty/no-op (not error) when `r.vectorStore == nil` — do NOT mirror `rag.go:222-224` (that is the nil-**collection** degrade; the nil-**store** path returns `errDBNotInitialized` at `rag.go:215-217`/`:245-247`). Explicitly nil-check the store pointer and short-circuit to empty/no-op. This honors [00 §A2](00-VerificationAndGroundTruth.md).

## Files to modify — Go

### `modules/rag/vector_store.go`

- **Fix the stale comment `:14-16`** to reflect flat names (memories/messages/cached-actions/cached-animations/lore).

### `modules/rag/base.go`

- Add the `LoreService` interface near `MovementService:76`.

### `modules/rag.go`

- Add `loreCollectionName = "lore"` near `:34-48`.
- Implement the `LoreService` methods on `RAGModule` following the movement pattern (`:607-692`): `GetOrCreateCollection(loreCollectionName)` → `AddConcurrently` / `collection.Delete` (or filter+delete by metadata) / `Query(ctx, queryText, n, nil, nil)` with count-cap (`:688-691`).
- Update `ListCollections` (`:1074-1079`) to include `lore`.
- Update `DropEntityCollections` (`:153-167`) to also drop `lore` (entity-delete cleanup).
- Be aware of `ListCollectionGroups` (`:1117`) — lore does not need grouped-view support; skip or add a neutral branch.

### `eventserver/eventprocessor.go`

- Wire `LoreService` through `RefreshRAGServices`/`RefreshMovementService` (`:686-700`) — add a `RefreshLoreService` (or fold into the existing refresh) so the service is re-wired on RAG re-init. The cognition processor and the lore-embedding path (import/edit/init) consume it.

## Implementation steps

1. Run `gitnexus_impact({target:"RAGModule",direction:"upstream"})` + `MovementService` — report blast radius.
2. Fix the stale `vector_store.go:14-16` comment.
3. Add `LoreService` interface + `RAGModule` impl (TDD: index/query/remove; nil-store → empty).
4. Update the 3 hard-coded name lists.
5. Wire `RefreshLoreService`.

## Verification

- [ ] `gitnexus_impact` run on `RAGModule`/`MovementService`.
- [ ] Stale `vector_store.go:14-16` comment fixed.
- [ ] `LoreService` interface + `RAGModule` impl; nil-store tolerated (empty/no-op).
- [ ] `ListCollections` + `DropEntityCollections` updated.
- [ ] `RefreshLoreService` wired.
- [ ] `go test ./modules/rag/...` passes (incl. nil-store test).

## Notes / deviations

- **[00 §A2](00-VerificationAndGroundTruth.md):** provider not guaranteed — nil-store tolerance is mandatory, not optional.
- **[00 §A8](00-VerificationAndGroundTruth.md):** the hard-coded name lists + stale comment.
- Embedding (when/how entries get indexed) is [3-2](3-2-GoLoreEmbedding.md); retrieval in the prompt is [3-3](3-3-GoLoreRetrievalInPromptBuild.md).
