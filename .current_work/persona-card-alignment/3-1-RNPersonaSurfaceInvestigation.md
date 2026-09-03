# 3-1 — RN: Persona Surface Investigation

> Repo: `harmony-ai-app`, branch `senju-design-updates-rebase`. Research only — NO production code changes, NO commits.
> Agent: general (research). Runs in parallel with Phase 1 (engine, code-expert).

## Objective (decision 5)

Map every RN surface that touches personas (list / switch / create / edit / delete / rename), the profile fields each touches, the API/sync path used, and every place persona-owned character cards could leak into AI-entity surfaces. Produce a findings report that drives the 3-2+ phase split (stores/services/sync → code-expert; screens/components → ui-ux-expert).

## Scope

1. Persona surface map (every read/write surface + profile fields touched).
2. Card surface leaks (places persona-owned cards could be listed/imported/linked for AI entities).
3. API surface used (management endpoints vs pure sync).
4. Sync propagation of entity/profile/image deletes (ghost risk of the engine 1-2 cascade).
5. Chat-target gates (persona-owned profiles never offered as AI targets).
6. Rename surfaces (any app-side persona/entity rename UI today).

## Deliverable

**Findings report: `3-1-RN-Findings.md`** (this folder) — surface map table, card-leak findings, API dependency list, sync behavior, chat-gate status, rename surfaces, and a concrete 3-2+ phase proposal (seam split) with scope + gates per phase.

## Open questions

- Does the engine 1-2 cascade soft-delete (tombstone) or hard-delete the persona's profile + images? (Tombstones are required for clean app-side propagation; the engine plan says tombstones — verify in Phase 1.)
- App-side `deleteUserPersona` does not soft-delete the persona's `character_image` rows nor trigger a sync — should 3-2 mirror the engine cascade locally? (Proposed: yes.)

## Checklist

- [x] Surface map (screens/services/repos)
- [x] Card-leak audit (all profile-listing surfaces)
- [x] API-vs-sync dependency list
- [x] Sync delete-propagation analysis
- [x] Chat-gate verification
- [x] Rename surface inventory
- [x] 3-2+ phase proposal (seam split, scope, gates)
- [x] **User sign-off** obtained (2026-09-03, with round-3 decisions 12-15)

## Gates

- Research-only: `git status` clean of production-code changes; findings file written to `.current_work/persona-card-alignment/`.