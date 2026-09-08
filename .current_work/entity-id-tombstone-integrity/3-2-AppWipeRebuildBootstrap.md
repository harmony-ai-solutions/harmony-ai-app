# 3-2 — App: Wipe & Rebuild Bootstrap (+ Placeholder Migration 000045)

> **Rewritten per ruling D11** (plan review 2, user-ruled 2026-09-06): the app no longer performs an id
> migration or a timestamp repair. Convergence is **engine-authoritative** — the app wipes local data once
> and re-syncs from the migrated engine. This replaces the previous content of this phase (app id-pattern
> migration + timestamp repair pass + `repair_completed` marker), which is **fully superseded**.

## Objective

One-time, guided local reset: on first launch after this update the app wipes its database and the
id-keyed AsyncStorage preferences (D19), then performs a **full pull** from the already-migrated engine.
Only the engine ever computes migrated ids; the app receives them verbatim.

## Binding Rules

- **Ordering (D11):** the engine deploy (3-1 migration 000045 + 3-3 gate v2) lands **before** this app
  release. A wiped app pointing at an un-migrated engine is covered by 3-3's app-side
  `serverUpdateRequired` — the wipe destroys nothing that isn't on the engine except the accepted loss
  below, and data re-pulls once the engine is updated.
- **Placeholder migration 000045:** `src/database/migrations/` gains a **comment-only no-op** to keep
  cross-repo numbering parity (both repos at 000044 → both at 000045). Runner-compatible: comments are
  stripped → zero executable statements → version still recorded (`migrations.ts:432-445`).
  **Format (review 7 correction): app migrations are TS modules exporting SQL template strings — 44
  precedents, registered via `migrations.ts:11-55` imports into the `MIGRATIONS` array (`:67-288`); a
  `.sql` file would never be discovered. The placeholder is
  `000045_engine_id_pattern_placeholder.ts` exporting a comment-only SQL string + its `migrations.ts`
  import/array entry.** Description
  text (binding): *"Placeholder — engine counterpart 000045 performs the entity id-pattern migration;
  app converges via full re-sync (no local data migration required)."* (4-1 later ships the same-pattern
  placeholder 000046 for 1-2's `sync_gc_state`.)
- **Reused by 4-5 (review 6, D76):** the one-time wipe flag + D61 boot-window machinery built here is the
  reaction path for the engine's purge-floor rebuild signal — build the flag flow **generic**
  (set → boot-window wipe + prefs sweep → clear), not single-purpose, so 4-5 only sets the flag.
- **Accepted loss (user-ruled):** app-local rows created while offline and never pushed. Auto-sync
  triggers bound the window: on connect, on explicit actions (create/edit/delete/save/duplicate —
  `CreateAIScreen.tsx:1054,1225`, `CharactersScreen.tsx:716`, `PersonaEditScreen.tsx:814`,
  `userEntities.ts:600`, `EntitySessionService.ts:1744,2085`), on session start, and manual
  (`SyncSettingsScreen.tsx:217,256`). Run a manual sync before updating if the window matters.

## Implementation Steps

1. **Wipe trigger (D61 — review 5; supersedes D38's `initiateSync` placement):** one-time persisted flag,
     checked as the first step of **`DatabaseContext.initializeDb`** (`DatabaseContext.tsx:41-66`) — the
     pre-render boot window already gated by `isLoading`, rendering `DatabaseLoadingScreen` (which already
     imports and calls `wipeDatabaseCompletely`, `DatabaseLoadingScreen.tsx:20/:38`). React mounts screens
     child-first, BEFORE the on-connect sync effect (`SyncConnectionContext.tsx:295`) — an
     `initiateSync`-anchored wipe ran under already-rendered, querying screens; boot is strictly before
     every sync trigger, preserving D38's "before any sync starts" rationale with none of the race.
     Sequence: read flag → wipe (**`wipeDatabaseCompletely`** — NOT test-only `clearDatabaseData`,
     `connection.ts:209`; `clearDatabaseData` also drops `schema_migrations` and re-runs all migrations
     on the empty DB, `connection.ts:228-231, 254`) + **D19 prefs sweep** → clear flag →
     `initializeDatabase()`. The review-4 addenda shrink at boot: the lazy `syncDb` handle
     (`connection.ts:406-433`) is not yet opened and no SyncService in-memory state exists yet (keep the
     wipe-path resets as belt-and-braces); the Keychain concern is moot — SQLCipher is not linked and
     `getOrCreateEncryptionKey` never stores a key (`connection.ts:60-67`), so the reset is a no-op.
     Dev-context: auto-wipe with the visible notice; a confirm prompt is fine too.
     **D58 (as amended by D61):** the "**Rebuilding from Soulbits Engine…**" label (proper i18n keys, en
     only per app convention; label: "Soulbits Engine") rides the existing loading screen during the wipe
     and **clears when the wipe completes** — not when the first pull finalizes (empty-DB rendering
     during the subsequent on-connect pull is safe: `sync:data-applied` refreshes the lists).
     No screen renders against a half-wiped database.
2. **Preference reset (D19):** clear `chat_global_impersonated_entity`, `@harmony_chat_reply_mode_*`,
   and legacy `chat_entity_pref_*` keys in the same flow (sweep pattern precedent:
   `ChatPreferencesService.ts:100-113`). Preferences reset once — no remap machinery.
3. **Pull-not-push verification (rewritten per review-3 finding — the real mechanism is the watermark,
   not the initial-upload flag):** the guarantee is the **cleared-watermark → `force_full_sync`
   escalation** (`SyncService.ts:505-517`): `storedLastSync === 0` escalates to
   `effectiveForceFullSync`, and the engine re-sends everything only on that flag. The
   `@harmony_sync_initial_upload_done:{source}` flag (`ConnectionStateManager.ts:470-508`) is **not
   cleared** by either wipe helper and **never gates pulls** — it only shapes upload `since`-values,
   which `forceFullSync` zeroes anyway; an empty DB uploads zero SYNC_DATA events regardless (no
   engine-destruction hazard exists). Tests assert: **first post-wipe `initiateSync` sends
   `force_full_sync: true`** (mock `getLastSyncTimestamp`); the surviving flag's inconsistency is
   harmless and noted.
4. **`user` persona merge (premise corrected in review 3 — there is NO local seeder):** production code
   never creates the `user` entity row (only `createUserPersona`/`createUserPersonaFromCard` from UI
   flows; `userEntities.test.ts:203` notes "raw id until the Phase-5 seeder lands" — it never landed).
   The engine's `user` row arrives via pull and simply INSERTs into the empty DB. Test: "engine `user`
   row inserts cleanly on first sync" — no LWW merge/flip-flop test is possible or needed.
5. **Version advertisement:** after the first successful full sync, the app advertises sync schema
   version 2 (3-3). Until then the engine-side gate (min 2) already refuses the pre-rebuild state.
6. **Placeholder migration** as specced above; no functional content.
7. **D21-7 rides this release (D32):** the `normalizeTimestampForSync`/`toUnixTimestamp` UTC fix ships
   here — landing it earlier would cause one-time LWW churn on legacy format-A rows; post-wipe all
   local rows are engine-origin (format B/C) and the churn window vanishes.

## Files to Create/Modify

- `src/database/migrations/000045_engine_id_pattern_placeholder.ts` (comment-only SQL template string —
  review 7 format fix) + `src/database/migrations.ts` import + array entry
- Wipe bootstrap (SyncService bootstrap or a small module colocated with sync state)
- `src/services/ChatPreferencesService.ts` (key sweep)

## Tests (app, migrations + integration projects)

- Wipe runs exactly once (persisted flag, checked inside `DatabaseContext.initializeDb`) — BEFORE any
  screen renders (no query hits a half-wiped DB); DB empty; prefs + watermarks cleared.
- **Wipe shows the labeled rebuild gate (D58/D61 — "Rebuilding from Soulbits Engine…", i18n) and clears
  it when the wipe completes; the first on-connect pull then repopulates (empty-DB render safe); `syncDb`
  not yet open at boot (review-4 addenda retained as belt-and-braces).**
- **First post-wipe sync sends `force_full_sync: true`** (watermark-escalation mechanism, D38 framing).
- Engine `user` row inserts cleanly into the empty DB on first sync (no local seeder exists).
- 000045 placeholder records its version and executes nothing.
- Preference sweep clears all three key families (D19).

## Checklist

- [x] One-time wipe + prefs sweep + watermark clearing
- [x] Pull-not-push verified (initial-upload flag interplay)
- [x] `user` merge verified on first sync
- [x] Placeholder 000045 with the binding description text
- [ ] v2 advertised post-rebuild (3-3); phase doc updated — **NOT SHIPPED HERE by design (task item 8 / D61 sequencing): phase 3-3 owns the v2 constant + plumbing. Nothing half-wired was left in this phase's territory.**

## Implementation Notes (deviations)

- **000046 placeholder shipped here on 4-1's behalf** (orchestrator instruction, task item 6): `src/database/migrations/000046_sync_gc_state_placeholder.ts` is a comment-only no-op with the binding 000046 description text; it belongs to phase 4-1's checklist (D73) but was created + registered in `migrations.ts` in this phase to keep both repos at 000046 parity in one pass.
- **SyncService.ts change is comment-only.** The cleared-watermark → `force_full_sync` escalation already existed (`initiateSync`, `storedLastSync === 0`); the only edit was a NOTE documenting the D11 wipe guarantee and the harmless post-wipe inconsistency of the surviving `@harmony_sync_initial_upload_done:{source}` flag. No logic change, GC function, or syncAndWait semantics touched.
- **`connection.ts` needed no fix** (read-only per territory). `wipeDatabaseCompletely` already closes the main connection, clears the per-source watermarks, deletes the DB file, and re-initializes; the Keychain reset is a no-op (SQLCipher not linked). `closeSyncDatabase()` is called from the wipe bootstrap (`WipeRebuildFlag`) rather than patched into the helper.
- **Rebuild-gate label timing:** the "Rebuilding from Soulbits Engine…" label is driven by `DatabaseContext.isRebuilding`, fed by `runWipeRebuildIfPending`'s `onStateChange` callback — ON when the wipe starts, OFF when the wipe completes (D61; the wipe helper's internal re-init finishes before the flag clears, so no screen renders against a half-wiped DB). Empty-DB rendering during the subsequent on-connect pull is safe (`sync:data-applied` refreshes the lists) — asserted in `DatabaseContext.wipe.test.tsx` (gate ON while `wipeDatabaseCompletely` is held open; `initializeDatabase` not yet called).
- **Timestamp warn scope (6-1 §2 rule 2):** the "treating as UTC (legacy local-time writer?)" warning fires only for space-format strings WITH a fractional component and NO offset suffix (the `emotion/ekman8.go:120` Go-driver shape). Seconds-only space-format (SQLite `CURRENT_TIMESTAMP`, format A) is UTC by definition and parses silently — warning on every format-A row would be log noise. All six 6-1 §2 vectors pass (`20260905091244`).
- **Flag module placement:** `src/services/WipeRebuildFlag.ts` (colocated with sync state) exposing `getWipeRebuildFlag` / `setWipeRebuildFlag` (phase 4-5's set-only hook) / `clearWipeRebuildFlag` / `runWipeRebuildIfPending(onStateChange?)`. No single-purpose hardcoding.
- **Test-suite state:** full `npm test` shows only (a) the documented pre-existing `compat/nodeSide.test.ts` contamination flake (≤3, passes in isolation, documented in `docs/TESTING.md`) and (b) intermittent failures in `PersonaEditScreen.test.tsx` etc. — files under active parallel edit. All phase-3-2 suites pass in isolation; one full unit run was 139/139 suites / 1222 tests green.
- **Snapshot re-baseline:** adding migrations 45/46 moved the roll-forward "final version" boundary from v44 to v46; the `migrations.rollforward.test.ts.snap` v44 entry was removed and v45/v46 entries added (identical schema — no-op migrations).
