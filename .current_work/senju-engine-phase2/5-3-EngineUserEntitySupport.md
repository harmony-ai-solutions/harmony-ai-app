# 5-3 — Engine User-Entity Support: Seeder Profile, Display Names, Protection, RAG

> Phase 5 / repo: **harmony-link-private**. Contract: `21-Engine-Contract` Q10/Q11/Q13, §5.5, §6 E1-E3.

## 1. E1 — Default persona profile (seeder)

`config/db/init.go` `createDefaultData` (:114-337): beside the `user` entity creation (:284-291), create a
`character_profiles` row — `Name: "You"`, empty/minimal V3 fields, `Creator: ""` — and link it:
`CharacterProfileID` set on the `user` entity. Keep the STT-only mapping (:296-332) unchanged. Seeded once
(empty-DB gate — existing behavior). The profile syncs down to apps like any profile (favorites/pinned none).

## 2. E2 — Display-name resolution via profile (Q10)

All resolvers must consult the linked profile BEFORE falling back to raw entity id (today `user` renders as the
literal string "user" in prompts/history):
- `database/repository/entities/entities.go:390-404` `GetEntityDisplayName` → load profile name when
  `character_profile_id` valid (single query or JOIN; cache-friendly).
- `modules/cognition/prompt_builder.go:2026-2057` `getSenderDisplayName`/`getSenderDisplayNameTx` —
  via `GetEntityDisplayName` or the prefetched `ParticipantNames` map (preferred: `prefetch.go:62-88`
  `gatherParticipantNames` already resolves profile names — verify it covers profile-linked user entities and
  returns the profile name, not the id).
- `eventserver/eventprocessor.go:486-498` `participantDisplayNameFor` (greeting path) — same.
- `prompt_builder.go:2136-2155` `primaryParticipantName` ({{user}} macro) — inherits the fix via ParticipantNames.
- Alias column stays a fallback tier 2 (id tier 3).

## 3. E3 — `user` entity protection

`management/routes_entities.go`: `handleDeleteEntity` (:148-161) → 4xx "cannot delete built-in user entity" for
id `user`; `handleRenameEntity` (:183-202) → reject for `user` (entity id is load-bearing: stored prefs, seeding
convention). Optional: reject disabling/muting the `user` entity (flags are AI-partner semantics — Q8; cheap guard).

## 4. Q13 — Symmetric RAG

Verify + minimal fixes only (mechanics are already entity-agnostic):
- `modules/rag.go:54-168`: RAGModule init is driven by the entity's mapping — a user entity WITH a RAG mapping gets
  collections (`WorkingDir/<entityId>/rag`, `memories`/`messages`/`lore`) exactly like AI. No type branch added.
- Lore ingestion at INIT (`eventprocessor.go:320-338` `ingestLoreForInit`): runs for any entity with a profile
  character_book — confirm it does not assume AI; user-entity profiles carrying lore get indexed.
- `rag_reindex_required` (`rag.go:133-165`, repo `entities.go:318-335`): flag semantics unchanged; app can set it on
  user entities via sync like today.
- The 5-2 generation-suppression guard must NOT block RAG init for user entities (RAG = knowledge, not generation).

## Tests (TDD — red → green)

- **RED first**: seeder test — fresh DB has `user` entity WITH profile link (id stable, name "You"); repeated init
  does not duplicate (empty-DB gate) — fails today (no profile link).
- **RED first**: resolver tests — profile-linked entity (incl. `user`) resolves to profile name; profile-less
  entity falls back to alias/id — fails today (`user` renders as the literal id).
- RAG: user entity with RAG mapping initializes collections + indexes lore from its profile's character_book;
  without mapping → nothing (characterization — expected green, pins Q13 symmetry).
- **RED first**: protection tests — delete/rename of `user` rejected (management routes currently allow both).

## Verification

- [ ] `go build ./...`; `go test ./...` green
- [ ] `gitnexus_impact` on `GetEntityDisplayName`, `createDefaultData`, `gatherParticipantNames` before editing;
      `gitnexus_detect_changes()` before committing
