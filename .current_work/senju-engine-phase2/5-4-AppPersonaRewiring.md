# 5-4 — App Persona Rewiring (Personas → User Entities)

> Phase 5 / repo: **harmony-ai-app**. Contract: `21-Engine-Contract` Q10/Q11/Q14, §6 A1-A7.
> Prerequisites: 1-2/1-3 (schema), 5-1…5-3 (engine side).

## Objective

The `personas` table is gone and the identity layer ALREADY lives on user entities: `userEntities.ts` + the
`personas.ts` re-export shim landed in the Phase-1 change set (§9-A10 — no stub, no dead window). This phase
finishes the surface: screen rewiring polish, persona-from-card, orphan deletions, the O2 sweep, i18n, and
DELETION of the shim. All persona UI works against `entity_type='user'`.

## 1. Identity layer — LANDED IN PHASE 1 (§9-A10); kept here as the authoritative spec

`src/database/repositories/userEntities.ts` exists since Phase 1; `personas.ts` is its re-export shim (deleted in
this phase). Spec (implemented + tested in Phase 1 unless noted):
- `getUserEntities()` — entities WHERE `entity_type='user'` AND not deleted, JOIN profile (name/description/
  personality) + primary avatar (first `character_image` is_primary), returns `Persona`-shaped rows (id = entity id).
- `createUserPersona({name, description, personality, avatar?})` — tx: minimal `character_profiles` row (name +
  fields, `tags:'[]'`, V3 defaults — mirror CreateAIScreen's `createCharacterProfile` usage) + primary image row
  (avatar → `character_image` `image_data` base64, A5) + `createEntity({id: name-derived? NO — entity id = name
  convention?})`. **Entity id decision**: AI entities use name-as-id; for personas keep the SAME convention (id =
  name, unique-check via `getNextEntityAliasCopy` `entities.ts:199-239`) so engine resolution stays uniform.
  `entity_type:'user'`, `character_profile_id` set. Then `syncAndWait` fire-and-forget (PersonaEdit pattern :183).
- `updateUserPersona(id, fields)` — profile fields via `updateCharacterProfile`, entity alias sync (rename = profile
  name + alias, entity id FROZEN), image reconcile (diff-based, Phase-8 `computeImageDeltas` pattern).
- `deleteUserPersona(id)` — FK-safe: `deleteEntity` soft path (fn starts `entities.ts:328`, soft-delete branch
  within `:328-389`) + profile soft-delete; **guard: id `'user'` → throw** (A1).
- `resolvePersonaId(stored)` — stored id → valid (non-deleted) user entity else `'user'` (A7; keeps AI ids out).

## 2. Screens (A1-A4, A6)

- **PersonaEditScreen** (A1): loads/saves via the new repo; handles route param `entityId='user'` (built-in: name/
  description/personality/avatar editable, DELETE hidden, id frozen); create mode = `createUserPersona`; delete =
  `deleteUserPersona` + if the deleted persona was the global impersonated id → reset pref to `'user'`.
- **MyProfileScreen** personas tab (A2): `getUserEntities()` (includes built-in `user`); grid/badging unchanged.
- **PersonaSwitcherModal** (A3): default row renders the `user` entity's profile name + avatar (from
  `getUserEntities`); persona list = same source; onSelect unchanged ('user' literal id preserved).
- **CreateAIScreen** (A4): `{{user}}` macro resolution `:663-677` — resolve the `user` entity's profile name
  (fallback 'user'); the entity-match check `:666` tightened to `entity_type==='user'` entities only (A7).
- **A6**: delete `src/components/modals/ImpersonationSelectorModal.tsx` + `src/components/profile/PersonaRow.tsx`
  (both orphaned; grep-verify zero imports first).
- **O2 sweep** (Q14): `ChatPreferencesService.sweepLegacyEntityPrefs()` — enumerate AsyncStorage keys with prefix
  `chat_entity_pref_` → remove; call once lazily (first ChatList mount or App bootstrap). Plus keep the existing
  silent-fallback in `resolvePersonaId`.

## 3. Persona-from-card (new feature, P1 copy semantics)

Entry points: CharactersScreen long-press menu + AIProfileScreen action row → "Create persona from this card".
Flow: prefilled PersonaEdit in create mode with `{name: profile.name + suffix? — NO, persona name editable,
prefill = profile.name}`, description/personality copied, avatar = profile's primary image data; on save =
`createUserPersona` with the COPY (source card untouched — P1). Reuse `duplicateProfileId` fork machinery only if it
fits; a fresh minimal-profile copy is simpler (the persona profile is intentionally minimal: no lore/book copy —
identity fields only; document this).

## 4. Consumers audit (perspective plumbing — verify, mostly unchanged)

`CharacterChatService` (:82-83, 127-141), `ChatListScreen` (:501-512),
`src/screens/settings/ArchivedChatsScreen.tsx` (:124-137),
`ChatDetailScreen` persona switch (:1453-1481) — all already consume `resolvePersonaId`/entity ids (via the shim
since Phase 1); swap imports to `userEntities` directly and semantics stay identical.
`EntitiesScreen`/CreateAI lists: filter OUT user entities from AI-partner
pickers (`entity_type` filter — verify CreateAI's entity-reuse paths don't offer personas). **§9-A3 ruling: user
entities are NEVER visible as chat options — audit EVERY partner-picking surface, not just these two.**

## 5. i18n

`persona.json` namespace: keys for built-in persona name/desc ("You"), `createPersonaFromCard`, delete-protection
error, editor field labels reuse.

## Tests (TDD — red → green)

- Repo suite: landed with Phase 1 (§9-A10) — create (profile+entity+avatar tx), update (rename keeps id), delete
  guards ('user'), resolvePersonaId sanitization (AI id → 'user').
- **RED first** (this phase): sweep removes legacy keys; screens editor create/edit/built-in modes; switcher
  default row content; from-card prefill; MyProfile list; shim deletion breaks zero imports.
- `src/database/__tests__/repositories/personas.test.ts` was already retargeted in Phase 1 (defense cases became
  entity_type cases) — verify, extend for from-card.

## Verification

- [ ] tsc 0; `npm test` green; grep: `from '../database/repositories/personas'` → **zero (the shim is DELETED in
      this phase)**; `ImpersonationSelectorModal|PersonaRow` → zero
- [ ] `gitnexus_impact` on `resolvePersonaId` consumers before editing; `gitnexus_detect_changes()` before committing
