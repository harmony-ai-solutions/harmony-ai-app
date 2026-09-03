# 1-3 — Engine: Profile Duplicate Endpoint (Full-Card Copy)

> Repo: `harmony-link-private`, branch `feat/engine-track-phase2`. TDD.
> File: `management/routes_character_profiles.go` (+ tests).

## Objective (decisions 4 + 5)

One atomic, reusable full-card copy used by BOTH frontends for create-persona-from-card (and available for future "duplicate card" UX).

## Endpoint

`POST /api/character-profiles/{id}/duplicate` → creates a new profile:

- **Copies ALL fields** from the source: full V3 spec (name, description, personality, scenario, first_mes, mes_example, alternate_greetings, post_history_instructions, creator_notes, creator, character_version, nickname, tags, group_only_greetings, extensions, assets, character_book) + Soulbits fields (voice_characteristics, base_prompt, typing_speed_wpm, audio_response_chance_percent, vision_config_id) — EXCEPT:
  - `id`: fresh id (existing id-generation convention).
  - `name`: append the existing duplicate-suffix convention (check how card import dedupes names — reuse exactly that, e.g. `name (2)`), caller may override via optional body `{ "name": "..." }`.
  - `is_favorite`: reset to 0.
  - `lifecycle_config`: reset to `{}` (personas never use it; harmless for card dupes).
  - `card_provenance`: **copy as-is** (decision 6).
- **Copies ALL images** with metadata (description, **primary flag preserved** — decision 9). Reuse the internal image copy path; do NOT round-trip through base64 HTTP if an internal helper exists.
- Returns the new profile (same shape as GET profile).
- Route registered alongside existing profile routes; follow their auth/middleware conventions.

## Tests (RED first)

- Duplicate profile → new id, all spec fields equal, name deduped, favorite/lifecycle reset.
- Images copied with primary flag preserved.
- Duplicate nonexistent id → 404.
- Source profile remains untouched.

## Gates

`go build ./...` && `go vet ./...` && `go test ./...` exit 0.
Commit: `feat(profiles): character profile duplicate endpoint - full card + images copy (persona cards 1-3)`

## Checklist

- [ ] Endpoint + field matrix implemented
- [ ] Image copy + primary flag
- [ ] RED→GREEN tests
- [ ] Gates green, committed
