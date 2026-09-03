# 2-2 — Engine FE: AI Entity Screens Exclude Persona Cards from Profile Selector

> Repo: `harmony-link-private/frontend`, branch `feat/engine-track-phase2`. Gate: build + self-review.

## Objective (decision 1, UI side)

`EntitySettingsView` (AI Entities tab) must not offer persona-owned cards when linking a character profile to an AI entity.

## Implementation

- `EntitySettingsView.jsx`: the character-profile selector (dropdown sourcing `characterProfiles` from the store) excludes ids referenced by user entities (same derived-set logic as 2-1 — extract a small shared helper, e.g. `personaOwnedProfileIds(entities, profiles)`, colocated or in a utils module used by both views).
- **Stale-assignment hint**: if the currently edited AI entity already points at a persona-owned profile (pre-guard data), show a warning inline ("this card is owned by a persona — choose another") instead of silently showing a value missing from the dropdown; saving keeps working only if the user picks a different card (engine guard would 400 anyway — surface that error message cleanly).
- `SimulatorView`/other surfaces: audit for other profile pickers serving AI entities (grep `characterProfiles` / profile selectors); apply the same exclusion where an AI entity is the target. Document findings.

## Gates

Build exit 0; self-review; grep audit documented.
Commit: `feat(frontend): AI entity profile selector excludes persona-owned cards + stale hint (persona cards 2-2)`

## Checklist

- [x] Shared ownership helper
- [x] Selector exclusion + stale hint
- [x] Other-picker audit documented
- [x] Build green, committed
