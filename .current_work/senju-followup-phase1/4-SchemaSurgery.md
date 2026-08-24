# Phase 4 — Schema Surgery: Consolidate 000041–000055 → one 000041; delete sidecar repos; O4 reply-strip

> Tracks B5 (with the user-approved **consolidation amendment**: all senju migrations merge into a single `000041`, skipping SQL made obsolete by the stubs), O4 (reply feature stripped), and the repo deletions prepared by Phases 2–3.
> Preconditions: Phases 1–3 merged — the doomed repos have ZERO non-test importers. If any importer remains, stop and fix the wiring first.

## Step 1 — Create the consolidated migration

Create `src/database/migrations/000041_consolidate_senju_features.ts` (name suggestion; keep `export const migration041`). Copy SQL **verbatim** from the source files before deleting them:

| Source file | What to copy | Modification |
|---|---|---|
| `000043_add_personas_table.ts` | `CREATE TABLE IF NOT EXISTS personas (...)` block | none |
| `000045_add_character_categories_and_favorites.ts` | `CREATE TABLE IF NOT EXISTS character_favorites (...)` block ONLY | categories tables + members dropped (O6: AsyncStorage + profile tags) |
| `000046_add_message_actions.ts` | `conversation_messages` ALTERs + pinned index | **strip `reply_to_message_id` column + `idx_conversation_messages_reply_to`** (O4 — reply feature dropped deliberately). Keep `reactions_json TEXT`, `is_pinned INTEGER NOT NULL DEFAULT 0`, `idx_conversation_messages_pinned` |
| `000050_add_chat_conversation_settings.ts` | `CREATE TABLE IF NOT EXISTS chat_conversation_settings (...)` | none (keep physical `blocked` column name — approved default #4; B2 rewrites the table in Phase 2) |

Dropped SQL (do NOT carry over): `character_profile_sources` + backfill + visibility rebuilds (000041/42/49/52 — A3), persona-row cleanup DELETE (000044 — moot per B3), categories tables (000045), character-social 5 tables (000047), user-social + notifications tables (000048), marketplace + wallet 3 tables (000051), blocked_users (000053), signup-bonus ALTER (000054), marketplace cache 3 tables (000055).

Header comment must document: consolidation rationale (pre-release sidecar removal, stub layer replaces persistence), that `000039` remains the reserved-number placeholder, and the dev-device wipe note (below).

## Step 2 — Delete old migration files + re-register

- `git rm` all fifteen `000041..000055_*.ts` files EXCEPT nothing — the new consolidated file replaces them (delete the old 000041 too; the new one takes its number).
- `src/database/migrations.ts`: remove the 15 old imports (`migration041`…`migration055`, lines ~44–66) and array entries (lines ~282–355); add the single new `migration041` import + entry after `migration040`. Final array: 1–40 unchanged, 41 = consolidated. Nothing above 41.

## Step 3 — Delete sidecar repositories + their tests

- `src/database/repositories/`: delete `marketplace.ts`, `soulWallet.ts`, `characterSocial.ts`, `userSocial.ts`, `contentLibrary.ts`, `blockedContent.ts`.
- Delete their test files under `src/database/__tests__/repositories/` (`marketplace.test.ts`, `characterSocial.test.ts`, `userSocial.test.ts`, etc. — locate via `ls`). Service-equivalent coverage lives in the Phase-1 suites.
- `src/database/repositories/characters.ts` cleanup — remove now-dead functions and their exports: source/visibility fns (`setCharacterProfileSource`, `getCharacterProfileSource`, `getCharacterProfileVisibility`, `setCharacterProfileVisibility`, `getPublicCharacterProfiles`, `getCommunityCharacterProfiles` — check exact names), category fns (`getCharacterCategories`, `createCharacterCategory`, `renameCharacterCategory`, `deleteCharacterCategory`, `getCharacterCategoryMembers`, `addCharacterToCategory`, `removeCharacterFromCategory`, `getCharacterProfileCategories`). **KEEP favorites fns** (`character_favorites` survives) and `getUserCharacterProfiles`/`getSiblingCharacterProfiles`/`getCharacterStats` (stats stays until its Phase-6 fix). Remove the favorites/categories test cases that target deleted fns; keep favorites tests.
- Update `src/database/README.md` if it lists sidecar tables (it was touched during the rebase docs commits).

## Step 4 — Categories UI off tables (O6)

`CharactersScreen.tsx` + `ManageCategoriesModal`/`AddToCategoryModal`/`CategoryFilterDropdown`:
- Custom categories persist in AsyncStorage (new `src/services/ChatPreferencesService`-style module: `src/services/CategoryPreferencesService.ts`, key e.g. `@harmony_character_categories` — array of `{id, name}`).
- "Add to category" on a character **writes a native tag on the profile** via existing `character_profiles.tags` (tags sync to the engine already). Filtering = profile tags ∪ AsyncStorage category list.
- Category filter chips derive from the union. Long-press "Add to category" toggles the tag.

## Step 5 — O4 reply-feature strip (code side)

- `src/services/EntitySessionService.ts`: remove the `replyToMessageId` param from `sendTextMessage` (+ any audio/combined variants that carry it); remove reply-payload construction.
- `src/components/chat/ChatBubble.tsx`: remove `repliedMessage` prop + reply-header rendering remnants.
- Grep `reply_to_message_id|replyToMessageId|repliedMessage` → zero src hits after this step.
- Her unread/open-conversation registry stays (B1 read-flags supersede it in Phase 2; `unread_count` column survives in `chat_conversation_settings` until then).

## Step 6 — Sync normalization check

`src/services/SyncService.ts` (normalization maps): confirm `is_pinned` has its boolean↔integer map (plan: "already half-done on her side"), `reactions_json` passes through as an opaque string, and **nothing reads `reply_to_message_id`** (column no longer exists). `conversation_messages` model in `src/database/models.ts`: drop `reply_to_message_id` field if present; keep `reactions_json`/`is_pinned` (they remain the D3-divergence set until Phase 2 mirrors them).

## Step 7 — `CLIENT_ONLY_TABLES` shrink (D6 interim state)

`scripts/dump-schema.ts` lines ~49–73: reduce the set to exactly:
```ts
const CLIENT_ONLY_TABLES = new Set<string>([
  'personas',                 // dies in Phase 2 / B3 (persona → user entities)
  'character_favorites',      // becomes synced in Phase 2 / B2 (Go mirror)
  'chat_conversation_settings',// synced redesign in Phase 2 / B2
]);
```
Keep `isClientOnlyEntry` + the D6 comment (mechanism dies with the last entry in Phase 2 — "app-only SQLite table" is not an allowed end-state category).

## Step 8 — Regenerate artifacts

1. Delete both migration `.snap` files; `npx jest --selectProjects unit --testPathPatterns migrations -u`; inspect the snapshot diff — expect: tables 1–40 unchanged, single 000041 block with ONLY the four surviving pieces.
2. `npm run schema:dump -- --output schema/rn-schema.json`.
3. Parity check (docs/schema-parity.md workflow): `go run . dump-schema` in `../harmony-link-private`, then `python scripts/compare-schemas.py <rn> <go>`.
   **Expected result:** RN-only 0 indexes; divergences = `conversation_messages` (D3-narrowed: `reactions_json` + `is_pinned` + `idx_conversation_messages_pinned`) + the 10 pre-existing cosmetic drifts + `device_push_tokens` Go-only. The 5 client-only index leaks are GONE. Anything else → investigate before committing.

## Dev-device migration note (approved default #2)

Devices that already ran builds recording 41–55 keep orphaned tables (harmless) and a lingering `reply_to_message_id` column (never read). Recommend a **one-time dev DB wipe** (Dev DB viewer wipe or reinstall) when picking this branch up. Only dev installs ever executed these migrations (her branch never shipped). Mention in the record doc + CHANGELOG note if user-facing.

## Verification

- [ ] `grep -rn "reply_to_message_id\|replyToMessageId\|repliedMessage" src/` → zero
- [ ] `grep -rln "repositories/marketplace\|repositories/soulWallet\|repositories/characterSocial\|repositories/userSocial\|repositories/contentLibrary\|repositories/blockedContent\|character_profile_sources\|character_categories" src/ --include="*.ts*"` → only the new migration file + summary docs
- [ ] `npx tsc --noEmit` 0 errors; `npm test` green (migration suites regenerated)
- [ ] Parity output matches Step 8 expectations exactly
- [ ] `gitnexus_detect_changes()`; commit: `refactor: consolidate senju migrations into 000041, drop marketplace/social sidecar tables and reply feature`
