# 3-1 — Engine Frontend: Personas Tab + AI-Entities Filter + Shared User Modules Card

> Repo: `harmony-link-private/frontend` (Wails + React 19 + Vite + Tailwind 4; branch `feat/engine-track-phase2`). **Consult `frontend/.planning/codebase/` docs FIRST** (they take precedence for this sub-folder). NO test harness exists in the frontend — verification = `npm.cmd run build` (vite) + tsc if configured. Protocol: impact/detect_changes still apply.

## Objective

Surface personas as first-class citizens of the desktop UI, matching the engine semantics landed in 1-1: personas are identity entities whose modules come from the canonical `user` mapping.

## Implementation steps

1. **i18n:** add `nav.tabs.personas` (+ all new strings) to every locale file present in `frontend/src/i18n` — find the pattern used by existing tabs.
2. **Entities tab → AI Entities:** in `EntitySettingsView.jsx`, filter the entity list to `entity_type === 'ai'` (client-side filter on the store list). Rename the tab label via i18n (`nav.tabs.entities` → "AI Entities" wording, all locales). No other behavior change.
3. **New `PersonasView`** (`frontend/src/components/personas/PersonasView.jsx`):
   - List `entity_type === 'user'` entities joined with their linked character profile (reuse the store/API clients `CharacterProfilesView` uses) — row: avatar (if available), name, description, type badges.
   - **Built-in row** (`id === 'user'`): "Built-in" badge; NO delete affordance (engine rejects it — show the guard reason in disabled state); profile fields editable.
   - **Create persona** flow: form (name, description, personality; avatar only if the existing profile components make it trivial) → create character profile via existing profile API → `POST` entity with `entity_type: 'user'` + `character_profile_id` (management `handleCreateEntity` already supports it). Validate: unique name (entity id = name convention; engine will error on collisions — surface the message).
   - **Edit** = profile update + entity alias sync (existing update endpoints). **Delete** = existing entity delete endpoint (guards `user` server-side; UI hides/disables for built-in anyway).
   - **"Shared user modules" card** (tab-level, above/below the list): copy "applies to every persona · personas never use generation, TTS, or RAG". Shows the canonical `user` mapping's **STT status** (provider name or Disabled) + Edit affordance → reuses the existing module-mapping editor components from `EntitySettingsView` **scoped to STT only**, editing entity `user` (API allows exactly this; all other module sections hidden).
4. **Register** the tab in `HarmonyLinkApp.jsx` (icon set consistent with existing tabs).

## Files

- `frontend/src/components/personas/PersonasView.jsx` (new) + any sub-components
- `frontend/src/components/EntitySettingsView.jsx` (filter), `frontend/src/HarmonyLinkApp.jsx` (tab), i18n locale files

## Gates

- `npm.cmd run build` in `frontend/` exits 0 (run from `frontend/` workdir; use `npm.cmd`)
- Commit: `feat(frontend): Personas tab, AI-entities filter, shared user modules card (persona modules 3-1)`

## Checklist

- [x] `.planning/codebase` docs consulted (note which)
- [x] Entities filter + tab rename (all locales)
- [x] PersonasView: list, built-in locked row, create/edit/delete flows
- [x] Shared user modules card (STT-scoped editor reuse)
- [x] Build green, committed, phase doc + summary.md updated

### Codebase-mapping docs consulted

`frontend/.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `INTEGRATIONS.md` (these are authoritative for the `frontend/` sub-folder and were read first).

### Deviations / notes

- **Avatar upload** in the create-persona form was **omitted** (plan: "avatar only if the existing profile components make it trivial"). Image upload to a character profile is non-trivial; rows still display the linked profile's primary image when available via `useCharacterProfileStore.getPrimaryImage(...)`.
- **Build gate** = `vite build` only — the frontend has **no tsc** configured (`package.json` `build` = `vite build`) and no test harness. Exit 0 confirmed after both 3-1 and the combined 3-1+3-2 tree.
- **i18n locales:** only `en` exists under `frontend/src/i18n/locales` (all other languages are commented placeholders in `SUPPORTED_LANGUAGES`). New strings were added to every present locale: `common.json` (`nav.tabs.entities` → "AI Entities", `nav.tabs.personas`), new `personas.json` namespace (registered in `i18n.js`).
- **Shared user modules card** reuses `ModuleConfigSelector` (now exported from `EntitySettingsView.jsx`) scoped to STT only, editing entity `user`. The backend 400 message ("user entities share the built-in user module mapping") surfaces verbatim via `error.message` if ever returned.
