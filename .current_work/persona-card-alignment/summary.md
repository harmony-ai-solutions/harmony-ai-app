# Persona ↔ Character Card Alignment

> Status: PLANNED — awaiting user GO. Do not implement before explicit approval.
> Created 2026-09-03 from user alignment round (5 decisions).

## Objective

Personas currently reuse the shared `character_profiles` table with copy-on-create semantics, but the UI treats persona-owned cards inconsistently: they pollute the Characters tab, AI-entity screens can link them, the persona editor only exposes 3 fields, personas can't be renamed/exported, and deleting a persona orphans its card. Align data ownership + UI so personas are first-class rich cards managed exclusively through persona management, in BOTH the engine frontend (Wails) and the RN app.

## Background (verified facts)

- **No persona table exists.** A persona = `entities` row with `entity_type='user'` (id = name; built-in `user` is canonical, engine-seeded) + a full `character_profiles` row (Character Card V3 spec + Soulbits fields) linked via `character_profile_id` FK (`ON DELETE RESTRICT`).
- Persona edit modal (3 fields) reads/writes the persona's own profile row — the other ~22 columns exist but are untouched.
- `importCharacterCard(file)` / `exportCharacterCard(profileId, format)` are **profile-level** (entity-type agnostic) → work for personas as-is.
- `CharacterProfileEditor` tabs: basic / images / greeting / lorebook / lifecycle / advanced / attribution.
- Engine handlers: `management/routes_entities.go` (`handleCreateEntity`, `handleUpdateEntity`, `handleDeleteEntity`, `handleRenameEntity`); profile routes in `routes_character_profiles.go`. Built-in `user` delete/rename rejections are test-proven (`routes_entities_test.go`).
- Engine-FE services already expose `renameEntity(oldId, newId)`, `createPersonaEntity`, `updateEntity(id, characterProfileId, lifecycleConfig, alias)`.
- Today's persona delete = `deleteEntity` only → profile (and images) orphaned.

## Decisions (user, 2026-09-03 — round 1)

1. **Persona↔profile is 1:1 and owned**: personas are managed through persona management; deleting a persona cleans up entity + card. AI management screens must NOT be able to assign a persona-linked card to an AI entity.
2. **Editor tab split**: lorebook + greetings stay (card-spec elements, full editing). Only **lifecycle + advanced** hidden for personas.
3. **Rename wired** via existing `RenameEntity` (type-preserving; built-in protected).
4. **Create-persona-from-card copies the FULL card** (all spec fields, rich personas) — not just identity fields.
5. **RN app persona surfaces get the same treatment** (separate agent; investigation phase first).

## Decisions (user, 2026-09-03 — round 2, open questions resolved)

6. Duplicate `card_provenance`: **copy as-is**.
7. From-card flow: **immediate full-copy create → editor opens**; prefill-form flow retired.
8. Built-in `user` persona: **gets the full editor** (rename/delete locked).
9. From-card image copy: **all images, primary flag preserved**.
10. **No dual-referenced profiles exist today** (user-verified) → no stale-data treatment/migration needed; 1-1 guards make the state impossible going forward. Persona delete cascade is unconditional.
11. Persona create UX: 3-field modal **fully replaced** by the full editor.

## Phases & agent assignment

Standing rule (user, 2026-09-03): **UI component work → `ui-ux-expert`; backend + raw service code → `code-expert`**. Mixed tasks get split along that seam.

- **Phase 1 — Engine (Go + tests)** — branch `feat/engine-track-phase2` — **code-expert**
  - 1-1 Profile-assignment guards (AI entity cannot take user-referenced profile; user-entity profile 1:1)
  - 1-2 Persona delete cascade (user-entity delete removes owned profile + images)
  - 1-3 Profile duplicate endpoint (full-card copy incl. images) — foundation for from-card + reusable
- **Phase 2 — Engine frontend (Wails, nested repo)** — branch `feat/engine-track-phase2`
  - 2-0 Duplicate-profile service wrapper — **code-expert** (service code)
  - 2-1 Characters tab: hide persona-owned profiles — **ui-ux-expert**
  - 2-2 AI entity screens: exclude persona cards from profile selector (+ stale hint) — **ui-ux-expert**
  - 2-3 Persona editor: full `CharacterProfileEditor` in personaMode — **ui-ux-expert**
  - 2-4 Persona export + full-copy from-card flow + delete copy — **ui-ux-expert**
- **Phase 3 — RN app** — branch `senju-design-updates-rebase`
  - 3-1 Persona surface investigation — **general** (research only; no code)
  - 3-2+ Defined after 3-1 findings + user sign-off; expected seam: stores/services/sync → **code-expert**, screens/components → **ui-ux-expert**

## Dispatch waves

- **Wave 1 (parallel, different repos)**: Phase 1 agent (code-expert, engine) ∥ 3-1 research agent (general, app repo).
- **Wave 2 (sequential within the FE repo — single working tree)**: 2-0 (code-expert) → 2-1…2-4 (ui-ux-expert, one agent, sequential commits).
- **Wave 3 (after 3-1 sign-off)**: RN implementation agents per the 3-2+ seam split.

## Open questions

None — all resolved (decisions 6–11). Awaiting explicit user GO to start dispatching.

## Gates (per phase)

- Engine: `go build ./...`, `go vet ./...`, `go test ./...` all exit 0; TDD (guards RED first).
- Engine FE: `npm.cmd run build` exit 0 + TDZ self-review pass (no test runner in that repo).
- RN: `npx.cmd tsc --noEmit` = 0; targeted jest + full `npm.cmd test` green; `gitnexus_impact` before edits, `gitnexus_detect_changes` before commits.
- Parity: no schema changes in any phase → `compare-schemas.py` must stay exit 0 (verification only).
- No merges/pushes anywhere.
