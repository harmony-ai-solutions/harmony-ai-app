# 3-2-B — RN: Persona Full Editor UI + From-Card Flow + Export

> Repo: `harmony-ai-app`, branch `senju-design-updates-rebase`. **Agent: ui-ux-expert** (screens/components — data layer from 3-2-A).
> Decisions 2, 4, 7, 8, 11, 12, 13, 14 bind.

## Scope

1. **Full persona editor**: replace the 3-field `PersonaEditScreen` form by reusing `CreateAIScreen`'s editor machinery (`src/components/character-card/editor-sections/*`) in **personaMode**: hide **lifecycle + advanced** only (greeting/lorebook/images/tags/attribution stay); **greeting TEST disabled in personaMode** (decision 13); built-in `user` gets the editor with rename/delete locked + existing pre-seed empty state (decision 8); **reserved-name validation: block creating a persona named `user`** (trim/case-insensitive, clear message — decision 14).
2. **From-card full copy** (`CharactersScreen.handleCreatePersonaFromCard`): **immediate** full-copy create (3-2-A helper) → editor opens on the new persona (decision 7/12); retire the identity-only prefill path.
3. **Persona export** in the persona editor (JSON/PNG parity with engine-FE 2-4 / `CreateAIScreen` ExportSection).
4. Rename UX parity (name field → profile + alias via `updateUserPersona`; id frozen — RN semantics, no `RenameEntity` call).

## Gates

`npx.cmd tsc --noEmit` = 0 · targeted component tests (`PersonaEditScreen`, `CharactersScreen`) · full `npm.cmd test` · gitnexus protocol.
Commit: `feat(personas): full persona card editor, immediate from-card copy, export (persona cards 3-2-B)`

## Checklist

- [x] personaMode editor (sections reused, lifecycle+advanced hidden, greeting test off)
- [x] Built-in locks + pre-seed empty state
- [x] Reserved-name `user` block
- [x] From-card immediate copy → editor
- [x] Export (JSON/PNG)
- [x] Gates green, committed
