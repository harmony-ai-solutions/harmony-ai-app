# 3-3 — App Client-Only Data: Verdict Table

> **Repo:** `harmony-ai-app` (branch `feat/app-engine-parity`)
> **Produced by:** phase 3-3 (`3-3-AppClientOnlyDataAudit.md`)
> **Enumeration basis:** the *current* app TS migration chain — `src/database/migrations/000001…000047` as registered in `src/database/migrations.ts`. The set of tables is taken from a live `runMigrations` + `dumpSchema` run (the same source as `schema/rn-schema.json` and `migrations.snapshot.test.ts.snap`), not from memory-bank history.
> **Cross-checked against:** engine `schema/go-schema.json` + engine `database/migrations/` (read-only), and `docs/schema-parity.md`.

## How to read this

Every table in the app TS migration chain gets exactly one verdict:

- **`engine`** — the table is engine-managed today (it mirrors an engine table byte-for-byte per the parity gate) and survives into the engine schema. The app keeps no independent copy after the 3-4 TS-stack deletion; reads/writes go through the engine management API (3-1/3-2).
- **`app-local`** — the data is device/UI-specific, lives outside SQLite entirely (AsyncStorage) after 3-4, and is not engine-synced.
- **`deleted`** — the table is app-side infrastructure that dies with the TS migration chain; no engine equivalent is needed for app operation.

The CI completeness gate (`src/database/__tests__/dataVerdictsCoverage.test.ts`) parses this file and asserts **100% coverage**: every table produced by the app migration chain appears exactly once with a valid verdict. Adding/removing a migration table without updating this file fails the test.

## Verdicts — app TS migration-chain tables (36)

| Table | Verdict | Rationale |
|---|---|---|
| `backend_configs` | `engine` | Engine-managed module config (parity-matched; `go-schema.json`). Rides engine sync. |
| `character_image` | `engine` | Character avatar/gallery images, engine-managed (parity-matched). |
| `character_profiles` | `engine` | Canonical character records; engine-managed. Carries the engine-synced `is_favorite` column (000044) — favorites follow the user across devices. |
| `chat_conversation_settings` | `engine` | Per-conversation `pinned` / `archived` / `reply_mode`; registered in the sync PK registry (`pkRegistry.ts` PK `participant_key`) and parity-matched. `muted`/`disabled` moved to `entities.is_muted`/`is_disabled` and `unread` to derived `conversation_messages.is_read` (senju consolidation 000041/000042); the parenthetical in the plan table is historical. **Sync coverage verified.** |
| `cognition_configs` | `engine` | Engine-managed module config (parity-matched). |
| `conversation_messages` | `engine` | Chat history; engine-managed and byte-identical per §9-A9. |
| `emotion_state` | `engine` | Per-entity emotion state; engine-managed (§9-A9 rebuild). |
| `entities` | `engine` | Core entity records (alias, `entity_type`, `is_muted`, `is_disabled`); engine-managed. |
| `entity_emoji_actions` | `engine` | Engine-managed emoji action definitions. |
| `entity_module_mappings` | `engine` | Per-entity → config wiring; engine-managed (`entity_id` PK in sync registry). |
| `imagination_configs` | `engine` | Engine-managed module config. |
| `interactions` | `engine` | Conversation/session records (incl. `presence_type`, `continued_interaction_id`); engine-managed. |
| `lifecycle_state` | `engine` | Per-entity lifecycle (exhaustion/sleep/beat/outreach/inner-monologue); engine-managed (`entity_id` PK, 000040 watermark columns). |
| `memories` | `engine` | Entity memories; engine-managed. |
| `movement_configs` | `engine` | Engine-managed module config. |
| `provider_config_anthropic` | `engine` | Engine-managed provider config. |
| `provider_config_characterai` | `engine` | Engine-managed provider config. |
| `provider_config_comfyui` | `engine` | Engine-managed provider config. |
| `provider_config_elevenlabs` | `engine` | Engine-managed provider config. |
| `provider_config_google` | `engine` | Engine-managed provider config. |
| `provider_config_harmonyspeech` | `engine` | Engine-managed provider config. |
| `provider_config_kajiwoto` | `engine` | Engine-managed provider config. |
| `provider_config_kindroid` | `engine` | Engine-managed provider config. |
| `provider_config_localai` | `engine` | Engine-managed provider config. |
| `provider_config_mistral` | `engine` | Engine-managed provider config. |
| `provider_config_ollama` | `engine` | Engine-managed provider config. |
| `provider_config_openai` | `engine` | Engine-managed provider config. |
| `provider_config_openaicompatible` | `engine` | Engine-managed provider config. |
| `provider_config_openrouter` | `engine` | Engine-managed provider config. |
| `provider_config_soulbitscloud` | `engine` | Engine-managed provider config (incl. `language`, 000047). |
| `provider_config_xai` | `engine` | Engine-managed provider config. |
| `rag_configs` | `engine` | Engine-managed module config. |
| `stt_configs` | `engine` | Engine-managed module config. |
| `tts_configs` | `engine` | Engine-managed module config. |
| `vision_configs` | `engine` | Engine-managed module config. |
| `schema_migrations` | `deleted` | App-side migration bookkeeping (`src/database/migrations.ts` `createMigrationsTable`). Dies with the TS migration chain in 3-4; the engine keeps its own `schema_migrations` for its own migrations. Not user data — nothing to carry. |

**Tally:** `engine` 35 · `app-local` 0 · `deleted` 1 · total 36. No TS-chain table is app-only: the parity gate reports **RN-only 0** (55 RN entries all match; the only divergences are the 3 Go-only engine-infra tables `device_push_tokens`, `sync_devices`, `sync_history` — none of which exist in the app chain). This is the D6 end state: "app-only SQLite table" is not an allowed category.

## App-local data (not in the TS chain — AsyncStorage)

For completeness (the plan's audit table) — none of these are SQLite tables, so they carry no verdict row, but they are the surviving app-local homes:

| Data | Home | Verdict |
|---|---|---|
| Themes, emoji style/set/skin tone, haptics, UI prefs | AsyncStorage | `app-local` (unchanged) |
| Chat bubble / floating-window prefs | AsyncStorage | `app-local` (unchanged) |
| Sync estimate limit, connection prefs (keyed per source incl. `local`) | AsyncStorage (`ConnectionStateManager`) | `app-local` (unchanged) |
| Character category grouping (custom categories) | AsyncStorage (`CategoryPreferencesService`, key `@harmony_character_categories`) | `app-local` (DECISION POINT, see below) |
| Biometric lock toggle + PIN | AsyncStorage (`BiometricLockService`) | `app-local` |
| Profile extras (per-profile local extras) | AsyncStorage (`ProfileExtrasService`) | `app-local` |
| Reply-mode legacy key `@harmony_chat_reply_mode_<participantKey>` | AsyncStorage (`ChatPreferencesService`) | `app-local` — **legacy read-only fallback**; the live value is the engine-synced `chat_conversation_settings.reply_mode` column. No app-local *source of truth* remains. |
| Blocked users / social / marketplace | in-memory stub services (`MarketplaceService`/`SocialService`/etc.) | `app-local` stubs (no persistence — nothing to migrate; real backend later) |
| Dev/test fixtures, migration snapshots | repo files | n/a |

## DECISION POINTS (roaming-judgment calls — not silently decided)

1. **Character-category grouping roaming.** Custom character categories are currently **app-local** (`CategoryPreferencesService` → AsyncStorage `@harmony_character_categories`, an array of `{id, name}`; membership is derived from per-character tags). The plan's risk note says "defaults lean engine-ward for anything entity-adjacent", and categories *are* entity-adjacent.
   - **Recommendation (as-is verdict):** keep **app-local**. Categories are pure UI organization; the product is pre-launch (fresh installs start empty), so a later engine-ward move costs nothing now. Moving them engine-ward requires a new engine table + endpoints (rule 3) for a low-value, pre-launch feature.
   - **Decision needed:** confirm category grouping should *not* roam across devices. If it must roam, this becomes an engine migration + facade work item (coordinate with 3-1).

2. **Engine-side migrations required?** None identified. Every `engine` verdict targets a table that already exists in the engine schema (parity 55/55 matching). No app table moves engine-ward in this audit, so **no engine migration is required** (rule 3 is a no-op here).

## Notes for subsequent tasks

- **3-4 deletion list:** `schema_migrations` (created by `src/database/migrations.ts`) is part of the deleted TS stack. All other chain tables are engine-owned — the app must delete its repository/migration mirror copies, not the engine tables. There are **no client-only sidecar tables left** to drop (the old `character_categories`/`character_category_members`/`character_favorites`/`character_creators`/`blocked_users`/marketplace-social tables are already gone from the chain — categories moved to AsyncStorage, social/marketplace to in-memory stubs, favorites to `character_profiles.is_favorite`).
- **3-4 SQLCipher/RN-SQLite dependency:** per 3-4 step 2, keep the dependency **only if 3-3 verdicts left app-local tables in SQLite**. This audit leaves **zero** app-local tables in SQLite (AsyncStorage only) → 3-4 may drop `react-native-sqlite-storage`/SQLCipher.
- **3-1/3-2:** no new engine read endpoints are required by this audit beyond the already-planned management API (all engine tables are already readable via the engine's own repositories/facade).
- **Device gate deferred:** the plan's "fresh-install smoke: every verdict destination exists and is readable on a new install" is an on-device item — see 3-4's post-deletion verification (it depends on the TS stack being gone).
