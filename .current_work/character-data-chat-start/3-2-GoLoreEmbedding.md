# 3-2 — Go Lore Embedding (import / edit / `INIT_ENTITY`)

> **Phase 3.** Depends on [3-1](3-1-GoLoreRagCollection.md), [1-6](1-6-CharacterCardMapperRedesign.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/`.

## Objective

Embed each **enabled** lorebook entry's `content` into the per-entity `lore` collection at three points: **import**, **edit** (any lorebook edit), and **`INIT_ENTITY`** (so lore is indexed + ready before the first greeting/generation). Keep the collection and the `character_book` JSON column in lockstep: enable → upsert, disable → delete. `enabled` is honored by construction (disabled entries are not embedded → excluded from retrieval).

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md), [§A2](00-VerificationAndGroundTruth.md))

- `LoreService` from [3-1](3-1-GoLoreRagCollection.md) (`IndexLoreEntry`/`RemoveLoreEntry`/`DropLoreCollection`).
- Import call site `management/routes_character_profiles.go:140` (`ExtractCharacterCardFromPNG`) → `:153` (`MapToCharacterProfile`). Edit path = profile update.
- `handleInitEntity` `eventprocessor.go:145`; RAG service available via the processor/handler context (wired in [3-1](3-1-GoLoreRagCollection.md)).
- The `character_book` JSON column holds the source-of-truth; the vector store is an **index** over it (content + metadata pointing back).
- **Nil-store tolerance** ([00 §A2](00-VerificationAndGroundTruth.md)): if RAG is disabled for the entity, embedding is a silent no-op (the lore still round-trips via the JSON column).

## Design

A single ingestion function that (re)builds the `lore` index from a profile's `character_book` JSON:

```go
// IngestLore(profile *models.CharacterProfile, svc rag.LoreService) error
//  1. Unmarshal profile.CharacterBook (JSON) → CharacterBook{ Entries[] }.
//  2. svc.DropLoreCollection() (clean slate — simplest correctness).
//  3. For each entry where entry.Enabled (bool, or *bool non-false):
//       metadata := {"entry_id": id, "profile_id": profile.ID, "constant": ..., "name": ...}
//       svc.IndexLoreEntry(entryID, entry.Content, metadata)
//  4. (Disabled entries are simply not indexed — honored by construction.)
```

> **Enable/disable toggle (live edit):** when the editor flips an entry's `enabled`, call `IndexLoreEntry` (enable) or `RemoveLoreEntry` (disable) for that single entry + update the JSON flag — no full re-drop needed. (Full re-ingest on import/init for simplicity; incremental on edit.)

Call sites:
1. **Import** (`routes_character_profiles.go:~153`, after `MapToCharacterProfile` + persist): `IngestLore(profile, loreService)`.
2. **Edit** (profile update handler — wherever `character_book` may change): `IngestLore` (full) or incremental enable/disable.
3. **`INIT_ENTITY`** (`eventprocessor.go:145`, in/after the greeting hook region from [1-9](1-9-GoInitEntityGreetingHook.md)): `IngestLore(profile, loreService)` so lore is indexed before the first greeting/generation. **Nil-store → no-op.**

`entryID`: use the spec entry `id` (number-or-string) if present; else synthesize a stable id (e.g. `profileID:index`). Keep it stable across re-ingest so enable/disable/remove target the right vector.

## Files to modify — Go

### `modules/rag.go` (or a new `modules/rag/lore.go`)

- Add `IngestLore(profile, svc)` (+ helpers to unmarshal `character_book` JSON → entries). The `CharacterBook`/`CharacterBookEntry` types are from `utils/charactercard/types.go` ([1-5](1-5-CharacterCardV3TypesAndPngParser.md)) — reuse them for the JSON unmarshal (or define a minimal mirror to avoid importing the card package into RAG; pick the cleaner dependency direction).

### `management/routes_character_profiles.go`

- After import + persist: call `IngestLore`.

### Profile update handler (edit path)

- After a profile update where `character_book` changed: call `IngestLore` (or incremental enable/disable).

### `eventserver/eventprocessor.go`

- In `handleInitEntity` (`:145`), near the greeting hook ([1-9](1-9-GoInitEntityGreetingHook.md)): `IngestLore(profile, loreService)`. Tolerate nil `loreService`.

## Implementation steps

1. Run `gitnexus_impact` on the import + profile-update + `handleInitEntity` call sites.
2. TDD: `IngestLore` (enabled entries indexed, disabled skipped, nil-svc no-op, re-ingest idempotent).
3. Wire the 3 call sites.
4. Tests: import → entries indexed; edit enable/disable → single-entry upsert/remove; INIT_ENTITY → indexed; RAG disabled → silent no-op.

## Verification

- [ ] `gitnexus_impact` run on import/update/init call sites.
- [ ] `IngestLore` added; enabled-only indexing; nil-svc no-op.
- [ ] Wired at import + edit + `INIT_ENTITY`.
- [ ] Enable/disable toggle is synchronous (embed/unembed) + JSON flag in lockstep.
- [ ] `go test` passes (incl. nil-store + re-ingest idempotency).

## Notes / deviations

- **[00 §A2](00-VerificationAndGroundTruth.md):** nil-store no-op is mandatory.
- Retrieval (consuming the index at prompt-build) is [3-3](3-3-GoLoreRetrievalInPromptBuild.md).
- The `character_book` JSON column is the source-of-truth; the vector store is only an index — never query SQL for lore.
