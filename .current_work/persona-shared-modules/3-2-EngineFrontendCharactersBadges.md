# 3-2 — Engine Frontend: Characters "Used-By" Badges + Create-Persona-From-Card

> Repo: `harmony-link-private/frontend` (branch `feat/engine-track-phase2`). Same constraints as 3-1 (`.planning/codebase` docs first; build = verification).

## Objective

Make the Characters tab honest about the entity↔profile **reference** semantics (entity links the profile live — profile edits change AI behavior immediately) and offer persona creation from a card with **copy** semantics (identity fields only, mirroring the app's `handleCreatePersonaFromCard`).

## Implementation steps

1. **"Used by" badges** in `CharacterProfilesView.jsx` (and/or the profile card component): cross-reference the entities store (already loaded by EntitySettingsView's store — verify the store shape) → per profile show badge(s): `AI · <entity id/name>` or `Persona · <name>`; nothing when unreferenced. Multiple referencing entities: render all (schema allows it, nothing creates it today — cheap to be correct).
2. **Editor hint** (small): on profiles that are referenced, show a muted hint "Linked to an entity — changes apply immediately" (i18n). Where exactly: profile editor header area — keep unobtrusive.
3. **"Create persona from this card"** action in the profile card menu:
   - Prefills the 3-1 persona-create form with **name, description, personality** ONLY (avatar if trivially available). NO lore, character_book, or module configs — the card is untouched (reference vs copy distinction).
   - Navigate to / open the PersonasView create flow prefilled (wire via existing navigation/state pattern between views — follow how other cross-tab flows work in `HarmonyLinkApp.jsx`; if none exists, lift prefill into a tiny shared store slice).
4. i18n keys in all locales.

## Files

- `frontend/src/components/characters/CharacterProfilesView.jsx` (+ card component if separate), personas create-flow wiring from 3-1
- i18n locale files

## Gates

- `npm.cmd run build` exits 0
- Commit: `feat(frontend): characters used-by badges, live-link hint, create-persona-from-card (persona modules 3-2)`

## Checklist

- [x] Used-by badges (AI/Persona, multi-entity correct, none-case clean)
- [x] Live-link hint on referenced profiles
- [x] Persona-from-card with copy semantics (identity fields only), card untouched
- [x] Build green, committed, phase doc + summary.md updated

### Codebase-mapping docs consulted

`frontend/.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `INTEGRATIONS.md` (authoritative for `frontend/`; read first, as mandated).

### Deviations / notes

- **Badges** are rendered in the card's info area (below name/description), not a nested menu — consistent with the existing card layout. Multi-entity referencing renders all badges; nothing renders when unreferenced.
- **Live-link hint** is shown in the profile **editor modal header** (under the profile name) only when the profile is referenced — muted, unobtrusive.
- **"Create persona from this card"** is a hover-revealed card action button. It copies **name, description, personality ONLY** (identity fields) into the Personas create form via a tiny shared `personaStore` prefill slice + tab navigation (`HarmonyLinkApp`). Source card is untouched (reference vs copy distinction maintained). No lore / character_book / module configs carried over.
- **Build gate** = `vite build` only (no tsc, no test harness). Exit 0 confirmed.
