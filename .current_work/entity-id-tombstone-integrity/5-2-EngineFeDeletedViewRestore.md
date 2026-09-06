# 5-2 — Engine FE: Deleted Entities View + Restore + Copy Fixes

## Objective

Give the management UI visibility into tombstoned entities with restore, and fix deletion copy/guards per the
new strategy. (~~App-side restore is intentionally out of scope~~ — **superseded by ruling D41 (2026-09-06
session 3):** the app ships its own deleted-entities view + restore in **5-3**; restore parity is now
two-directional — the FE restores via the management API, the app via local resurrect + sync propagation.)

## Context (from investigation, 2026-09-05)

- Deletion choke point is single: `entityService.deleteEntity` → `DELETE /api/entities/:id`
  (`EntitySettingsView.jsx:398-421`, `PersonasView.jsx:336-359`). No per-touchpoint rewiring needed for
  soft-delete; only new surfaces + copy.
- Zero soft-delete awareness today: no trash view, no restore, "cannot be undone" copy
  (`entitySettings.json:83`, `characters.json:76,81`; **note:** `personas.json:56` is NOT a
  "cannot be undone" string — actual copy: "This permanently removes the persona, its card, and card
  images."). Additional stale copy found in review: `entitySettings.json:79` (rename confirmation says
  "This action cannot be undone." and describes rename as create-new + copy + delete-old — wrong under D8's
  in-place rename and D1), `entitySettings.json:106` `invalidChars` and `personas.json:28/81` (charset copy
  lacks `.`, contradicts D3).
- Character-profile delete has **no reference guard** (badges only, `CharacterProfilesView.jsx:38-48`) — the
  RESTRICT FK failure surfaces as a raw alert; this is also the historical source of broken profile tombstones.
- Store pattern: `src/store/entityStore.js` (zustand + immer); service layer `src/services/management/`.

## Implementation Steps

1. **Service + store**: `listDeletedEntities()` (`GET /api/entities/deleted`) and `restoreEntity(id)`
   (`POST /api/entities/:id/restore`) in `entityService.js`; store actions + `deletedEntities` state.
    **Review-2 (D21-10):** build ONE shared `DeletedEntitiesSection({ type, onRestore })` component serving
    both tabs; `entityStore.deleteEntity` must refresh `deletedEntities` (today it only filters the live
    array, `entityStore.js:58-73`) so a delete moves the entity into the Deleted section.
    **Review-5:** also add a `loadDeletedEntities()` store action called in BOTH tabs' mount effects
    (alongside `loadEntities`/`loadProfiles`) — without it the section renders empty until the first
    delete/restore.
   **Review-4 shape:** the section is a **pure presentational component**
   (`{ title, entities, onRestore, emptyText }`) — type-filtering stays a one-liner at the call sites
   (the tabs already compute type-filtered lists: `aiEntities` `EntitySettingsView:126-129`,
   `entity_type === 'user'` `PersonasView:121-126`); store side is one `produce` mutation moving the
   row from the live array into `deletedEntities`.
   **Delete-409 surfacing (review 4 — D16/D27 fallout, previously unaddressed):**
   `baseService.handleResponse` (`:70-97`) **discards the HTTP status** and throws `new Error(body.error)`;
    attach `resp.status` to the thrown Error so delete can branch. When the engine 409s ("entity has
    active sessions"), the FE shows a distinct message (new key, below) — and the new confirm copy's
    "you can restore it later" promise must not mislead in that path.
    **Review-5 branch points (pinned):** exactly the two ENTITY-delete catches branch on
    `error.status === 409` (`EntitySettingsView.jsx:410-418`, `PersonasView.jsx:348-356`) — via one
    shared predicate helper; the PROFILE-delete catch (`CharacterProfilesView.jsx:116-118`) must NOT
    branch (different endpoint, never 409s).
2. **Deleted entities surface**:
   - Entities tab: "Deleted (N)" collapsible section via the shared component, **type-filtered to
     `ai`** (the live tab is AI-only, `EntitySettingsView.jsx:126-129`; `GET /deleted` returns both types).
   - Personas tab: same component, **type-filtered to `user`** (`PersonasView.jsx:121-126`). (The "`user`
     persona restore allowed like any other" guard is vacuous — `user` cannot be deleted in the first
     place, `PersonasView.jsx:337`; note it, don't build for it.)
   - On restore (**D37 — review 3**): refresh live + deleted lists, success toast, and select the
     restored entity — **Entities tab: refresh-then-select** (`loadEntities() → selectEntity(id)`, the
     `handleCopy` echoed-id precedent at `EntitySettingsView:438-440` — selecting before the refresh
     completes gets overridden by the stale-list effect at `:139-147`); **Personas tab: refresh + toast
     only** (no selection state exists there — don't build one).
3. **Copy updates** (en is the **only** locale — verified): delete confirmations change from "This action
    cannot be undone." to "This removes {{entityId}} from all lists. You can restore it later from 'Deleted'."
    **(Review-4: keep the `{{entityId}}` interpolation token — the code passes `entityId`,
    `EntitySettingsView:403`; a literal '{id}' would silently not interpolate.)**
    Persona copy: "…its card and card images are removed as well and restored together."
    **Review-4: new i18n keys enumerated (en only; previously implicit):** `entitySettings:deleted.*` +
    `personas:deleted.*` (section title/count/empty), `restore` action label, restore-success banner,
    restore-failure message, **delete-409 message** ("…has active sessions — close its chats and try
    again").
    **Review-3 corrections:** (a) `personas.json:28` is inside the dead `fields.*` block 2-3 deletes —
    **do not update it**; the only live persona name-validation copy is `:81 nameInvalid` (2-3 reworks it
    for reserved names); (b) the rename-confirmation copy (`entitySettings.json:79`) is not updated —
    **the rename dialog is deleted** (D22, 2-3) and the key dies with it; (c) charset strings
    (`entitySettings.json:106`) die with `validateEntityId` (D23).
    **D21-11:** only `characters.json:81` (`deleteDialog.message`) is live in the characters namespace —
    `characters.json:76` `deleteConfirm` is dead copy, delete it.
4. **Profile-delete guard**: disable delete on `CharacterProfileCard` while `referencingByProfile` shows live
   references (tooltip explaining); replaces raw FK-failure alerts. (Tombstoned referencing entities do not
   block — restore re-links.)
5. **Build verification**: `npm run build` exit 0; **`node --test` locks** for any pure logic this phase
   adds (D21-9 — precedent `dynamicBackgroundStore.test.js`); behavioral locks live engine-side (5-1 tests).

## Files to Modify

- `src/services/management/entityService.js`, `src/store/entityStore.js`
- `src/components/EntitySettingsView.jsx`, `src/components/personas/PersonasView.jsx`,
  `src/components/characters/CharacterProfilesView.jsx`, `src/components/characters/CharacterProfileCard.jsx`
- `src/i18n/locales/en/*.json` (en is the only locale — verified)

## Checklist

- [ ] Service + store additions (`deletedEntities` state; `deleteEntity` refreshes it — D21-10; status
      attached to service errors — review-4)
- [ ] Shared `DeletedEntitiesSection` (pure presentational), type-filtered, on both tabs
- [ ] Copy updated (en only; `{{entityId}}` interpolation kept; new keys enumerated incl. delete-409 —
      review-4; dead keys deleted — D21-11)
- [ ] Profile-delete reference guard
- [ ] `npm run build` green; phase doc updated
