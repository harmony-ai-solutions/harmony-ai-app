# 2-3 — Engine FE: Persona Editor = Full Card Editor (personaMode)

> Repo: `harmony-link-private/frontend`, branch `feat/engine-track-phase2`. Gate: build + self-review.

## Objective (decisions 2 + 3)

Replace the 3-field persona modal with `CharacterProfileEditor` in a persona mode: full spec editing (basic, images, greeting, lorebook, attribution), **lifecycle + advanced hidden**, rename wired, built-in locks.

## Implementation

1. **`CharacterProfileEditor` personaMode prop**: `personaMode` hides the `lifecycle` + `advanced` tabs (tabs array already supports `hidden:` — extend to honor a mode). Editor must load/keep the FULL profile object in state so hidden fields round-trip on save (verify current save path sends the complete profile — if it sends only rendered fields, fix state handling so untouched columns are preserved; this is critical for export fidelity).
2. **Save path** (PersonasView): editor save → `updateCharacterProfile(profileId, fullProfile)` + alias sync via `updateEntity` (existing pattern) — no lifecycle param for personas.
3. **Rename** (decision 3): name field editable in personaMode → on save with changed name: `renameEntity(oldId, newId)` FIRST (engine is type-preserving), then profile name/alias updates. Engine 400s (collisions) surface in the editor's error UI. Built-in `user`: name stays read-only (engine rejects anyway).
4. **Built-in `user` persona** (decision 8): opens the same editor; rename + delete disabled; badge already exists.
5. **Create persona**: the current 3-field create modal is replaced by "create empty card in editor" — persona create opens `CharacterProfileEditor` with a fresh blank profile (personaMode), on first save: `createCharacterProfile(full)` + `createPersonaEntity(name, profileId)` + alias sync (existing sequence, now full-field).
6. Styling: editor is a modal in Characters — reuse as-is inside the Personas tab (same modal shell as today's persona form). i18n: reuse editor keys; add persona-specific strings (locked-name tooltip, personaMode title).

## Gates

Build exit 0; self-review (TDZ class + unbalanced JSX); manual-test list for user.
Commit: `feat(frontend): full card editor for personas - personaMode, rename wiring, built-in locks (persona cards 2-3)`

## Checklist

- [ ] personaMode tabs (hide lifecycle+advanced)
- [ ] Full-field state round-trip verified
- [ ] Rename flow + collision errors
- [ ] Create-in-editor flow
- [ ] Built-in locks
- [ ] Build green, committed
