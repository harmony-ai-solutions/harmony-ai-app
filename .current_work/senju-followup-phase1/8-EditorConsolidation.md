# Phase 8 — Track C: Editor Consolidation & UI Refactor (D4 step 2)

> Port the V3/RP editor suite (currently living in the comparison-only `CharacterProfileEditScreen`) into her `CreateAIScreen` edit mode; split the bloated editor into reusable section components; then delete the comparison-only screen + route (Q-D4a scaffolding).
> Key fact (00-Research §7): her form exposes none of the V3 fields today, but the data model is unchanged and her `{...current}` spread preserves V3 columns → clean additive port.

## Step 1 — Extract editor sections (new `src/components/character-card/editor-sections/`)

Split `src/screens/CharacterProfileEditScreen.tsx` into self-contained section components (props-in/onChange-out, no screen coupling):
- `GreetingEditorSection` (+ test-scenario generator integration)
- `AlternateGreetingsSection` (from `AlternateGreetingsManager`)
- `LorebookSection` (viewer + `LorebookEntryEditor`)
- `TagsSection` (`TagChips`)
- `LifecycleSection` (`LifecycleConfigEditor`)
- `AttributionSection` (creator/creator_notes/card_provenance)
- `ExportSection` (JSON + PNG export via existing `utils/charactercard/exporter`)
- `MacroHighlighter` stays a shared util import
- `ImportReviewSheet` moves here too (the Characters-screen import flow depends on it — it must survive the screen deletion)

Each section: theme-aware, i18n'd (reuse the existing `characters.json` keys — no new strings unless a label is genuinely new), `testID`s preserved.

## Step 2 — Integrate into `CreateAIScreen` edit mode

- Edit mode (existing `editProfileId` route param) gains the section components in her collapsible-sections layout (General → Identity sections → the new RP sections → Advanced). Create mode shows the lightweight subset she has today (identity/voice/module pickers) — full RP editing stays edit-mode-first; do not bloat create.
- V3 columns flow through her existing save path (her spread preserves unknown columns; the editors set them explicitly): `first_mes`, `alternate_greetings`, `character_book`, `tags`, `creator`, `creator_notes`, `card_provenance`, `lifecycle_config`, `scenario`, etc.
- Numeric fields (lifecycle editor): **validation alerts instead of silent clamping** (D1 track item "Restore small lost capabilities").

## Step 3 — Restore small lost capabilities

- Full-screen zoom viewer: `ImageViewerModal` (restored during rebase, `src/components/modals/ImageViewerModal.tsx`) wired into CreateAI's image section.
- Per-image **"Set as primary"** action + image captions in the image section.
- Pull-to-refresh on edit mode (reload profile).

## Step 4 — Fix image churn

Her save path hard-deletes + recreates all image rows on every save → engine-synced rows churn (ids change every edit). Replace with **diff-based reconcile**: load current image rows, compute create/update/remove deltas from the editor state, apply only deltas — ids of untouched images stay stable. (Repo primitives `createCharacterImage`/`deleteCharacterImage`/update caption already exist — verify an update-caption fn; add if missing.)

## Step 5 — Delete the comparison-only editor

- Delete `src/screens/CharacterProfileEditScreen.tsx` + its route registration + the `// D4: comparison-only` comment + Q-D4a scaffolding in `AppNavigator.tsx`.
- Keep `ProfileImagePicker` (now consumed by the new image section) and `ImageViewerModal` (Step 3) — they move to shared component homes if not already.
- Resolve `EntityConfigEdit` cross-link state per playbook §2.6: if any survivor navigates to `EntityConfigEdit`, either the screen survived the rebase (verify) or drop the link with a TODO.
- The import flow (`CharactersScreen` → `parseCardFile` → `ImportReviewSheet` → persist/deep-link) must keep working — it now imports the section component.
- Update tests that reference the deleted screen (e.g. `ProfileEditorSections.test.tsx` — retarget to the section components).

## Verification

- [ ] `grep -rn "CharacterProfileEdit" src/` → zero route/navigator references (historical docs excluded)
- [ ] Round-trip test: import a V3 card fixture (`src/utils/charactercard/__tests__/fixtures/v3-card.json`), edit every section, export → field-by-field parity
- [ ] Image churn: unit test asserting unchanged images keep ids across save
- [ ] `npx tsc --noEmit` 0 errors; `npm test` green
- [ ] `gitnexus_detect_changes()`; commits: `refactor: extract editor sections` → `feat: V3 RP editor suite in CreateAI edit mode` → `chore: remove comparison-only CharacterProfileEdit screen`
