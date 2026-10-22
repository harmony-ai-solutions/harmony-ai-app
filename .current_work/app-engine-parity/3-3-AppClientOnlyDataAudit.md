# Phase 3-3 — App: Client-Only Data Audit & Relocation

> **Repo:** `harmony-ai-app` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.6 (what survives: client-only prefs), memory-bank history of client-only tables
> **Codebase mapping consulted:** `.planning/codebase/` (app — harmony-ai-app): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

Decide the destination **schema** for every piece of app-local data that is NOT engine-managed, before the TS database is deleted in 3-4. Nothing may be silently dropped from the schema — but there is no data carry: fresh installs start empty on the new homes (pre-launch ruling; existing dev-device data is discarded).

## Audit scope (enumerate exhaustively at execution time)

Known candidates from memory bank history — verify current state on the branch:

| Data | Current home | History | Proposed destination |
|---|---|---|---|
| Themes, emoji style/set/skin tone, haptics, UI prefs | AsyncStorage | already local | unchanged |
| Reply-mode per partner, impersonated persona | AsyncStorage / flags | partially engine-synced now (`reply_mode` sync exists) | engine (already) — verify nothing app-local remains |
| `character_categories` + members | **already AsyncStorage** (`CategoryPreferencesService` — verified on branch; the old 000039-era client-only tables no longer exist in the consolidated migration chain) | favorites separately resolved → `character_profiles.is_favorite` (created 000041, dropped to column 000044) | unchanged (already app-local) — engine-ward move remains a decision point **only if** grouping should roam across devices |
| Favorites flag | `character_profiles.is_favorite` (engine-synced column) | `character_favorites` table created (000041) → dropped, column added (000044) | stays engine |
| Blocked users / social / marketplace | **in-memory stub services** (`MarketplaceService`/`SocialService`/etc. — no tables behind them today) | stub-service backed since the follow-up phase | stay app-local stubs until the real backend lands (no store migration needed — nothing persists) |
| Chat bubble / floating window prefs | AsyncStorage | already local | unchanged |
| Sync estimate limit, connection prefs | AsyncStorage | already local | unchanged (keyed per source incl. `local`) |
| `chat_conversation_settings` (pin/mute/archive/disable/unread) | synced table (post-senju) | engine-managed now | stays engine (verify sync coverage) |
| App migration `000039` | reserved no-op (`000039_device_push_tokens_reserved.ts` — numbering-parity placeholder) | engine owns the real `device_push_tokens` table (engine 000039) | dies with the TS migration chain (3-4) |
| Dev/test fixtures, migration snapshots | repo files | n/a | n/a |

## Rules

1. Every table in the app's migration chain gets an explicit verdict: `engine` (stays via engine schema), `app-local` (AsyncStorage or a minimal app-side store), or `deleted` (dead feature).
2. Data that follows the user across devices → engine. Data that is device/UI-specific → app-local.
3. Anything moved to the engine needs an engine migration + endpoint/facade access (coordinate with 3-1 if reads are needed).
4. No data carry: fresh installs start empty on the new homes. Verdicts fix schema destinations only; anything engine-ward gets its engine migration so new installs create the tables (rule 3).

## Implementation steps

1. Enumerate actual tables/migrations on the branch → fill/extend the verdict table (commit as `3-3-data-verdicts.md`).
2. Engine-side migrations for anything moving engine-ward (+ endpoints if listed).
3. Verdict table completeness check in CI (every TS migration's tables have a verdict).

## Files to create/modify

- `.current_work/app-engine-parity/3-3-data-verdicts.md` (committed audit)
- Engine migrations if any
- CHANGELOG.md (both repos if engine changes)

## Verification gates

- Verdict table covers 100% of app TS tables (CI check green)
- Fresh-install smoke: every verdict destination exists and is readable on a new install

## Risks & rollback

- Misclassification (UI grouping that users expect to roam) — flag: defaults lean engine-ward for anything entity-adjacent
- Stub-backed social tables churning — keep them out of scope (stub backend will be replaced by real services later)

## Progress checklist

- [x] Exhaustive enumeration + verdicts committed — 36 TS-chain tables, all verdicts in `3-3-data-verdicts.md` (35 `engine`, 1 `deleted`; RN-only 0)
- [x] Engine migrations landed (if any) — **none required**: no app table moves engine-ward (every `engine` verdict already exists engine-side; parity 55/55 matching). Rule 3 is a no-op here.
- [ ] Relocation module + tests — **not needed**: zero app-local tables remain in SQLite (all app-local data is AsyncStorage / in-memory stubs), so there is nothing to relocate. Left unchecked deliberately.
- [x] CI completeness check green — `src/database/__tests__/dataVerdictsCoverage.test.ts` (8 tests) parses the verdict table and asserts 100% coverage of the chain.
