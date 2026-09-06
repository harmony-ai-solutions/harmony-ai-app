# 2-3 — Engine FE: Derived-Only Creation & Alias-Based Persona Naming

## Objective

Align the engine management frontend (React SPA in `harmony-link-private/frontend/`, talks to the
management API via `fetch`, NOT Wails bindings) with D2/D23: stop deriving ids client-side entirely, use
the server-derived create contract for everything, move persona names to alias. **Review-3 fallout
(D22/D23):** the rename dialog is deleted (no runtime id-rename exists) and `validateEntityId` +
`generateUniqueEntityId` are deleted outright — there is no explicit-id surface left in this repo.

## Context (investigation 2026-09-05; corrected in plan review)

- Id derivation today: `src/utils/entityIdUtils.js` — `deriveEntityId` (live-only dedupe, `-2` suffixes),
  `deriveEntityAlias` (case-insensitive vs live aliases). **Callers (verified): only
  `CharacterProfilesView.jsx`** — both `handleCreatePersonaFromCard` (155/159; **already sends
  `dedupe_id_if_taken: true`** — third caller the original plan missed) and `handleCreateEntityFromCard`
  (207/211). `PersonasView.jsx` does **not** use the utils.
- `PersonasView.jsx:280-334` persona create: `createPersonaEntity(name, …)` (id=name, **no** dedupe flag)
  followed by `updateEntity(…, name)` which sets alias=name in a **second round-trip** (301/303) — alias is
  already first-class (not "pre-alias era"); the planned change collapses the two calls into one atomic
  create. Edit path is rename-then-profile-update, gated by `name !== editingPersona.id` (309-323) —
  **review-2 warning: this gate breaks under D2** (id ≠ name → rename fires on *every* save); D14 removes
  the rename trigger entirely (step 3).
- Explicit id inputs: `EntitySettingsView.jsx:360-396` `handleAdd` (add-entity dialog, `generateUniqueEntityId`
  client dedupe + `validateEntityId:347-358` — current regex `/^[a-zA-Z0-9_-]+$/` **rejects dots**, and there
  is **no ≤64 length check**; D3 *adds* `.` — both are behavior changes, not just new errors), rename dialog
  `handleRename:453-498` (target id typed client-side today).
- **Store gap (verified)**: `entityStore.createEntity` (`entityStore.js:23-37`) selects the **requested** id
  (`selectedEntityId = id`, line 29), not the server-echoed id, and its signature cannot carry
  `dedupeIdIfTaken` — must be fixed for "server-echoed ids everywhere".
- i18n copy: `entitySettings.json`, `personas.json`. **Only the `en` locale exists** (no other locales —
  "(+ other locales)" instructions are vacuous).
- **No test runner exists in this repo** — verification is `npm run build` + static traces (senju phase-2
  convention); behavioral locks come engine-side (2-1 tests).

## Implementation Steps

> **Review-2 rulings in force here: D14** (persona edits never rename the id), **D15** (create wire
> contract), **D21** items 9–13. **Review-3 rulings in force: D22** (rename deleted), **D23**
> (derived-only creation; 400 on `id`), **D30** (alias auto-suffix engine-side). **Review 6: D37 (restore
> feedback — 5-2) is deleted with Phase 5 (D75) — no restore UI or feedback exists.**

1. **Delete ALL client-side id machinery:** `deriveEntityId` util deleted (reserved-name/empty throws
    move to engine-400 surfacing; ~~`deriveEntityAlias` stays~~ — **deleted per D59, review 4**: the
    D15/D23 contract sends no `alias`, so the util would have zero callers; the engine default + D30
    auto-suffix is the ONLY alias authority — server suffices instead of 400ing, and client-side alias
    computation disappears entirely), **`validateEntityId` and `generateUniqueEntityId` deleted entirely**
    (review 3: they only survived for the rename dialog and the Add-dialog's explicit mode — both gone),
    and the **rename dialog + `entityService.renameEntity` + store plumbing deleted** (D22 — the engine
    endpoint is removed by 2-1b). Every create sends the **D15/D23 contract**:
    `{ name, character_profile_id?, dedupe_id_if_taken: true }` — the raw (space-containing) name rides
    in `name`, **never** in `id` — and uses the server-echoed id from the 201 (already the pattern in
    `CharacterProfilesView` — keep it). `entityService.js` signatures change accordingly. (Duplicate /
    `handleCopy` is mechanically unchanged — echoed id already used; the engine now derives a timestamped
    id per D52.)
2. **Add-entity dialog = auto-derived only (review 3, merged into D23):** the dialog asks for a
   **name** (+ optional profile) and posts the derived contract; **delete the
   `generateUniqueEntityId('new-entity')` default-name crutch** in `handleAdd`. Zero create-path id
   validation remains (minted ids are governed by construction). The rename dialog is deleted, so
   `validateEntityId` has no caller at all — delete it rather than update it; the `invalidChars`
   i18n key (`entitySettings.json:106`) and the rename-confirmation key (`:79`) become dead — **delete
   both** (D21-11 extension).
 3. **Persona naming switch (D14 + D15 + D23):**
    - **Create** collapses today's two round-trips into **one** derived create:
      `{ name: displayName, character_profile_id: newProfile.id, entity_type: 'user', dedupe_id_if_taken: true }`
      (**D66: `entity_type` stays in the contract** — `createPersonaEntity` already sends it,
      `entityService.js:94`) — id
      server-derived (timestamped), alias defaults to name engine-side (auto-suffixed on live collision,
      D30); no `updateEntity` follow-up. **Review-5 precision:** "one create" = one ENTITY request; the
      profile POST (`createProfile`) necessarily precedes it — two network calls remain.
      **Review-5 gap fix:** add the orphan-profile compensation on create failure (best-effort
      `deleteCharacterProfile(newProfile.id)`, mirroring `CharacterProfilesView.jsx:178-184`) —
      PersonasView lacks it today and an orphaned profile resurfaces in the Characters grid.
      **Review-4 rationale upgrade:** the collapse also fixes a latent
      bug — today's follow-up `updateEntity` at `PersonasView.jsx:303` sets the alias back to the raw
      name, which under D30 would *clobber* the engine-suffixed alias back into a colliding value →
      partial-unique 400 on a request that should have succeeded.
    - **Edit NEVER renames the id** (D14 — now the only meaning of "rename" is an alias edit): delete the
      `name !== editingPersona.id` rename trigger (`PersonasView.jsx:291-292`) **and the whole edit-rename
      block (`:309-318`)** — with the endpoint gone this code 404s. Edit = alias update (`updateEntity`)
      + profile update, only when the display name changed.
    - **`validatePersonaName` rework**: non-empty + reserved (`user`, `deleted` — D33 parity; spaces are
       the point, the id is derived, so **no charset regex on display names**). Uniqueness predicate moves
       from id-equality (`e.id === trimmed`, `:218` — dead under D2) to **case-insensitive
       alias-equality** (live-rows-only, mirroring the engine's alias partial-unique index — D59 deletes
       `deriveEntityAlias`, so the comparison rule is stated directly, not by reference).
       **Review-4 (D21-9 shape):** extract it to a pure util (`src/utils/`, signature
       `(name, { entities, excludeId }) → errorKey | null`) covered by `node --test`.
4. **Store fixes**: `entityStore.createEntity` must (a) accept and pass `dedupeIdIfTaken` + `name` (plain
   passthrough — `entityService.createEntity` already supports the flag at `entityService.js:56-63`) and
   (b) select the **server-echoed** id from the 201 response (not the requested one). Single caller
   (`EntitySettingsView:383`) does no follow-up keyed by the requested id — low breakage risk.
5. **i18n copy updates** (`entitySettings.json`, `personas.json`; en only): **dead keys deleted rather
    than updated** (D21-11 + review-3 extensions + **review-4 completions**): `personas.json` `fields.*`
    (`:25-34` — nothing renders them), `personas.json:83 nameReservedUser` stays THE reserved-name key
    (live at `PersonasView.jsx:216`) — rework its copy to cover BOTH reserved names ("'user' and 'deleted'
    are reserved"); `personas.json:81 nameInvalid` keeps its generic role unchanged (review-5: the
    earlier "rework nameInvalid" instruction contradicted the live `nameReservedUser` key),
    `entitySettings.json:79` (rename confirm — dialog
    deleted) and `:106` (`invalidChars`) deleted, `characters.json:76 deleteConfirm` deleted, **plus
    `characters.json` `createPersonaReservedUser` (`:44`), `createEntityReservedUser` (`:46`),
    `entityIdInvalidName` (`:47`)** — only referenced by the deleted `deriveEntityId` (orphaned by this
    phase). **Review-4 dead-key additions** (all verifiably orphaned by this phase's deletions):
    `entitySettings.json` `dialogs.rename.*` (`:73-76`), `dialogs.confirmRename.*` (`:77-80`),
    `dialogs.renameFailed.*` (`:94-96`), `messages.renamedFrom` (`:115`),
    `messages.renameFailedDetail` (`:122`), `buttons.rename` (`:13`), `validation.empty` (`:105`),
    `validation.alreadyExists` (`:107`), `dialogs.invalidEntityId.title` (`:85-87`), `personas.json`
    `dialogs.invalidName` (`:57` — already dead today), **and `entitySettings.json` `dialogs.copy.*`
    (`:69-72`) which is already dead now** (orphaned when `fae83b8` made duplicate one-click).
    **Review-4 live keys to REWRITE (not delete):** `entitySettings.json` `dialogs.add.message` (`:67`,
    "Enter a unique ID for the new entity:") becomes name-only copy for the name-only dialog;
    `personas.json` `editor.nameLocked` wording updated (it references "renamed" — a concept D22
    deletes; the lock now means the built-in's name source is fixed).
6. **Verify each id-consuming surface** renders alias where present (entity list shows `id + alias` today;
   persona cards use profile names). **Dev-tool surfaces are won't-fix** (D21-13): long timestamped ids
   are the point there. **Entity-list truncation check (review 3):** rows render raw id + alias with
   `truncate` classes but the flex chain lacks `min-w-0` — add it (+ `title` tooltip) so long timestamped
    ids don't break the fixed-width panel. Also re-lay the 2×2 action grid (`:568-574`) once the Rename
    button dies (three buttons remain — an empty cell otherwise). **Update tutorial copy** (D21-12, path corrected):
   `src/components/tutorial/tutorialSteps.jsx:129-140` becomes name-only ("give it a name" — no id
   mention remains).

## Files to Modify

- `src/utils/entityIdUtils.js` (**deleted entirely** — `deriveEntityId` per D23, `deriveEntityAlias`
  per D59),
  `src/components/EntitySettingsView.jsx` (Add dialog → name-only; **rename dialog + `handleRename` +
  `validateEntityId` + `generateUniqueEntityId` deleted**),
  `src/components/personas/PersonasView.jsx` (rename block `:309-318` deleted with D22),
  `src/components/characters/CharacterProfilesView.jsx`
- `src/store/entityStore.js` (echoed-id selection + name/dedupe passthrough — verified gap; rename plumbing deleted)
- `src/i18n/locales/en/entitySettings.json`, `personas.json`, `characters.json` (dead keys deleted incl.
  review-3 additions; en is the only locale)
- `src/services/management/entityService.js` (D15/D23 contract; **`renameEntity` deleted**)
- `src/components/tutorial/tutorialSteps.jsx` (name-only copy, D21-12)

## Verification

- `npm run build` exit 0.
- **`node --test` behavioral locks (D21-9)** for the pure validation utils that remain
  (`validatePersonaName`, extracted to `src/utils/` — review-4) — precedent:
  `src/store/dynamicBackgroundStore.test.js` runs green under `node --test` with zero config.
  (~~`validateEntityId` locks~~ moot — deleted; ~~alias-deriver locks~~ dropped with D59.)
- Static trace: create-AI-from-card, add-entity (name-only), persona create/edit — each request shape
  matches 2-1's D15/D23 contract; server-echoed ids are used for selection/state; **no rename call
  remains anywhere**; persona edit sends NO rename.
- Cross-check with engine 2-1 tests as the behavioral lock.

## Codebase Mapping Consulted

`harmony-link-private/frontend/.planning/codebase/` (ARCHITECTURE, STRUCTURE, CONVENTIONS — React 18/19 + Vite,
service layer via management API), senju record decision 2 (explicit-id vs derived seam).

## Checklist

- [ ] Client-side id generation + validation + rename machinery deleted (`deriveEntityId`,
      `validateEntityId`, `generateUniqueEntityId`, **`deriveEntityAlias` (D59)**, rename dialog +
      `entityService.renameEntity`);
      server-echoed ids everywhere (incl. `entityStore.createEntity` fix)
- [ ] D15/D23 wire contract: `name` field on all creates; `id`-carrying requests impossible client-side
- [ ] Add-dialog name-only (auto-derived); persona create → single atomic derived call; edit = alias only (D14);
      uniqueness = alias-equality; reserved names `user`/`deleted` (D33)
- [ ] Store selects echoed id + passes name/dedupe options
- [ ] i18n: dead keys deleted (incl. review-3 additions); tutorial copy name-only; entity-list `min-w-0`
- [ ] `node --test` validation locks + `npm run build` green; phase doc updated
