# 2-0 — Engine FE: Duplicate-Profile Service Wrapper

> Repo: `harmony-link-private/frontend`, branch `feat/engine-track-phase2`. **Agent: code-expert** (service code — no UI).
> Gate: `npm.cmd run build` exit 0.

## Objective

Thin client for the 1-3 endpoint, following the existing service conventions.

## Implementation

- `characterService.js`: add `export async function duplicateCharacterProfile(profileId, overrides = {})` → `POST /character-profiles/{id}/duplicate` with optional body `{ name }`; returns the new full profile. Mirror the fetch/error conventions of neighboring functions exactly.
- No other files touched.

## Commit

`feat(frontend): duplicateCharacterProfile service wrapper (persona cards 2-0)`

## Checklist

- [x] Wrapper + conventions match
- [x] Build green, committed
