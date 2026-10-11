# Phase 3-3 — App: Client-Only Data Audit & Relocation

> **Repo:** `harmony-ai-app` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.6 (what survives: client-only prefs), memory-bank history of client-only tables

## Objective

Decide the destination **schema** for every piece of app-local data that is NOT engine-managed, before the TS database is deleted in 3-4. Nothing may be silently dropped from the schema — but there is no data carry: fresh installs start empty on the new homes (pre-launch ruling; existing dev-device data is discarded).

## Audit scope (enumerate exhaustively at execution time)

Known candidates from memory bank history — verify current state on the branch:

| Data | Current home | History | Proposed destination |
|---|---|---|---|
| Themes, emoji style/set/skin tone, haptics, UI prefs | AsyncStorage | already local | unchanged |
| Reply-mode per partner, impersonated persona | AsyncStorage / flags | partially engine-synced now (`reply_mode` sync exists) | engine (already) — verify nothing app-local remains |
| `character_categories` + members | client-only tables (migration 000039-era) | favorites later moved to `character_profiles.is_favorite` | **engine tables** (new migration; they're entity data, belong in the one DB) or AsyncStorage if treated as pure UI grouping — decision point |
| Blocked users / social / marketplace stubs | client-only tables | stub-service backed | stub backends stay app-local (server features, not engine) — move to their own small app DB or keep TS SQLite **only for stub tables**? → preferred: AsyncStorage/simple stores until real backend lands |
| Chat bubble / floating window prefs | AsyncStorage | already local | unchanged |
| Sync estimate limit, connection prefs | AsyncStorage | already local | unchanged (keyed per source incl. `local`) |
| `chat_conversation_settings` (pin/mute/archive/disable/unread) | synced table (post-senju) | engine-managed now | stays engine (verify sync coverage) |
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

- [ ] Exhaustive enumeration + verdicts committed
- [ ] Engine migrations landed (if any)
- [ ] Relocation module + tests
- [ ] CI completeness check green
