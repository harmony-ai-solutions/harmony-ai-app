# 5-3 — App: Deleted Entities View + Restore (Parity with 5-2)

> **Created by plan amendment (ruling D41, 2026-09-06 session 3):** 5-2 originally recorded app-side restore as
> a deliberate non-goal ("the app recreates from cards"); the user overruled — restore/deleted-entities UI ships
> in the app too. This phase is the app-side mirror of 5-1/5-2.

## Objective

Give the RN app the same deletion-strategy visibility as the management FE: a settings sub-screen listing
tombstoned entities (AI partners **and** personas) with one-tap restore. Restore is a **local resurrect**
(`deleted_at = NULL`, `updated_at` bump, children resurrected) that propagates via the **normal sync upload** —
decision **D4** already defines restore this way ("resurrect: `deleted_at = NULL`, `updated_at` bump, propagates
via sync"). The engine's 1-1 ghost-aware apply (resurrect branch: children + D24 teardown + cache refresh) makes
the row live engine-side; the FE and other devices converge via sync-out. **No new sync protocol message, no
management-API access from the app** (the app talks to the engine exclusively through the sync channel).

## Dependencies (binding)

- **1-1** must be implemented first — the engine resurrect branch is what turns the app's pushed live row into
  an engine-side resurrect. Without it, the app's restore stays local-only and is silently dropped by the
  engine's deleted-filtered apply (the N1 failure shape, inverted).
- **4-1** must be implemented first — tombstones must persist locally forever or there is nothing to list/restore.
- **4-4/D18** (settings soft delete + 5 read filters) keeps settings tombstones invisible while tombstoned;
  5-3's cascade growth (step 2) depends on those filters existing.
- Mirrors **D9** (resurrect ≡ restore, shared child-resurrection semantics), **D17** (instant-equality matcher),
  **D26** (8-child cascade), **D29** (skew-safe `updated_at` bump).

## Context (verified against the app working tree, 2026-09-06)

- **App delete cascade** (`deleteEntity` soft path, `src/database/repositories/entities.ts:705-729`): stamps the
  entity row + **6** children (`entity_module_mappings`, `memories`, `emotion_state`, `entity_emoji_actions`,
  `interactions`, `conversation_messages`) with **one shared `now`** (ISO-ms, one `new Date().toISOString()`).
  **Gap vs D26:** `chat_conversation_settings` and `lifecycle_state` are NOT tombstoned by the app cascade — the
  same asymmetry engine D26 fixed. Both columns exist app-side (`chat_conversation_settings.deleted_at`
  000041:159-160; `lifecycle_state` rebuilt with sync columns + `deleted_at` in 000040).
- **Persona delete** (`deleteUserPersona`, `src/database/repositories/userEntities.ts:621-644`): tombstones the
  card images, the entity (via `deleteEntity`), then the linked profile — but each call captures its **own**
  `now` (D17 asymmetry): the image/profile stamps differ from the entity cascade stamp by arbitrary ms.
- **Ghost-aware fetch exists**: `getEntity(id, true)` includes tombstones (`entities.ts:171-176`);
  `getAllEntities` (`:211`) and every list/read predicate are live-only — a new tombstone list query is net-new.
- **Outbound change detection picks resurrects up by construction** (`getChangedRecords`,
  `src/database/sync.ts:340-348`): subsequent syncs select rows where `created_at > since OR updated_at > since
  OR deleted_at > since` — a resurrected row (live, bumped `updated_at`) matches the `updated_at` arm. Payloads
  are full-row `SELECT *` objects → the `deleted_at: null` **key is present** in the JSON payload (JS keeps
  null-valued keys), and Go unmarshal treats absent/null identically (live) — both directions safe.
- **UI precedent (template for this screen)**: `DisabledAIsScreen` (`src/screens/settings/DisabledAIsScreen.tsx`)
  — settings sub-screen, `useFocusEffect` reload, `ProfileAvatar` + name rows, one-tap action + toast +
  `ThemedEmptyState`, i18n namespace `settings` (`settings.json:88-92` `disabledAIs*` keys). Registered in
  `AppNavigator.tsx:121` (type) + `:214` (Stack.Screen); entry row in `AccountSettingsScreen.tsx:72`.
- **Delete entry points** (for the copy tweak in step 5): partner delete `ChatDetailScreen.tsx:1621`
  (`deleteEntity(partnerEntityId)`), persona delete `PersonaEditScreen.tsx:911` (`deleteUserPersona`).
  (`ChatListScreen.tsx:951` deletes a conversation's settings row, not an entity — not an entry point here.)
- **No teardown needed app-side**: nothing in the app attaches to a tombstoned id (sessions die with the delete);
  engine-side teardown on resurrect is owned by 1-1's resurrect branch (D24).
- **Transaction constraint** (same as `deleteEntity`): react-native-sqlite multi-statement writes must use
  `runStatementsInTransaction` — never sequential `await tx.executeSql()` (see the CRITICAL comments at
  `entities.ts:683-689` and `src/database/README.md`).

## Implementation Steps

1. **Repository — list + restore helpers** (`src/database/repositories/entities.ts`):
   - `listDeletedEntities(): Promise<DeletedEntitySummary[]>` —
     `SELECT id, alias, entity_type, deleted_at, character_profile_id FROM entities WHERE deleted_at IS NOT NULL AND id != 'user' ORDER BY deleted_at DESC`
     (belt-and-braces `user` exclusion; it cannot be deleted, but the list is not the place to assume that).
     Slim shape mirrors 5-1's `GET /api/entities/deleted` (no profile/image joins — the profile is usually
     tombstoned too and profile reads are live-filtered, `characters.ts:113`; `alias || id` is the display name,
     `ProfileAvatar` falls back to the letter avatar).
   - `restoreEntity(id: string): Promise<void>` — the app-side mirror of 5-1's shared helper (D9):
     - Fetch the tombstone via `getEntity(id, true)`; throw `entity is not deleted` if live / not found
       (mirrors 5-1's 404/409).
     - Capture the tombstone's `deleted_at` **before** overwriting (matcher input).
     - **Alias-collision guard**: if a **live** entity holds the same `alias`, re-suffix via the alias-copy
       helper (`getNextEntityAliasCopy` — 2-2 keeps `stripCopySuffix` alive for exactly this) before
       resurrecting; the engine's partial unique index (`WHERE deleted_at IS NULL`) would otherwise abort the
       engine-side apply of the resurrect (cross-ref: same guard added to 5-1 step 2).
     - Resurrect the entity + equality-matched children in ONE `runStatementsInTransaction`:
       `deleted_at = NULL, updated_at = ?` with one captured resurrect `now` for all rows. Child set =
       **D26 parity (8)**: `entity_module_mappings`, `entity_emoji_actions`, `memories`, `emotion_state`,
       `interactions`, `conversation_messages`, `chat_conversation_settings`, `lifecycle_state` — predicates
       `WHERE entity_id = ?` + instant-match on `deleted_at` (partner-side mirror rows are naturally excluded
       by the `entity_id` scope, mirroring 5-1's documented exclusion).
     - **Matcher (D17 mirror):** parsed-instant equality, second-truncated — app-native families share the
       exact same ISO-ms string (string-equal trivially), sync-arrived families carry the engine's captured
       stamp (formats A/B per 6-1 §2); parse both to UTC instants before comparing. **Never** string-compare
       across origins. Legacy pre-fix families (pre-step-2 persona deletes, pre-D25 sync arrivals) restore
       best-effort — document, do not add tolerance (mirrors 5-1's legacy caveat).
     - **Persona extras:** if `character_profile_id` is set and the profile + its images are tombstoned with
       matching instants, resurrect them in the same transaction (completes the `deleteUserPersona` mirror).
     - **`updated_at` bump (D29 mirror):** `max(now, tombstone.updated_at + 1ms)` — strictly newer than every
       stamp in the family, so the engine's LWW gate (inclusive `>=` post-D29) accepts it regardless of clock
       skew between the devices.
2. **Delete-path parity fixes (prerequisites for complete restore, mirrored from engine rulings):**
   - `deleteEntity` cascade grows to **8 children** (+ `chat_conversation_settings` by `entity_id`, +
     `lifecycle_state`) with the same single shared `now` — D26 parity; this also closes the app-side
     settings-staleness class (a deleted entity's conversation ghost-rendering in pinned/archived lists) that
     D18's filters then keep invisible.
   - `deleteUserPersona` threads **one captured `now`** through the image → entity → profile deletes (optional
     `now` parameter or shared-cascade variants of `deleteCharacterImage`/`deleteCharacterProfile`) — D17
     parity, so the instant-equality matcher is sound for app-native persona families.
3. **Screen — `DeletedEntitiesScreen`** (`src/screens/settings/DeletedEntitiesScreen.tsx`, the
   `DisabledAIsScreen` template): rows = `ProfileAvatar` (letter fallback) + display name (`alias || id`) +
   type label (AI partner / persona) + deleted date; one-tap **Restore** (haptic + `restoreEntity` + success
   toast + list reload via the `useFocusEffect`/`loadDisabled` pattern — mirrors D37's refresh-then-toast
   guidance; no navigation into a chat). Both entity types in ONE list (the app has no Entities/Personas tab
   split — a type label per row replaces 5-2's per-tab type filtering).
4. **Propagation trigger:** after a successful restore, fire a **non-blocking best-effort**
   `syncService.initiateSync()` (precedent: `firePersonaDeleteSync` `userEntities.ts:594-607`,
   `CharactersScreen.tsx:716`). Do **not** gate the restore UI on `syncAndWait({critical:true})` — offline
   restore is allowed and correct; the bumped `updated_at` makes propagation idempotent whenever the next sync
   succeeds (any order, any delay; `getChangedRecords` re-selects it until synced). Concurrent restores on two
   devices converge by LWW (both write live + bump — idempotent union).
5. **Deletion-copy parity (5-2 step 3 mirror):** the partner-delete confirmation (`ChatDetailScreen.tsx:1621`
   area) and persona-delete confirmation (`PersonaEditScreen.tsx:911` area) gain a "You can restore it later in
   Settings → Deleted entities" sentence (locate the existing confirmation i18n keys in their namespaces at
   implementation time; en is the only locale).
6. **Navigation + i18n:** `AppNavigator.tsx` type entry + `Stack.Screen` (`DeletedEntities`), entry row in
   `AccountSettingsScreen` beside Disabled AIs; `settings.json` (en only) gains `deletedEntities*` keys
   (title, empty, emptyHint, restore, restoredToast, typeAIPartner, typePersona) modeled on `disabledAIs*`
   (`settings.json:88-92`).

## Files to Modify

- `src/database/repositories/entities.ts` (`listDeletedEntities`, `restoreEntity`, 8-child cascade)
- `src/database/repositories/userEntities.ts` (one-`now` threading in `deleteUserPersona`)
- `src/database/repositories/characters.ts` (optional-`now` variants for profile/image soft deletes, if needed
  by step 2)
- `src/screens/settings/DeletedEntitiesScreen.tsx` (new)
- `src/navigation/AppNavigator.tsx`, `src/screens/settings/AccountSettingsScreen.tsx` (registration + entry)
- `src/screens/ChatDetailScreen.tsx`, `src/screens/PersonaEditScreen.tsx` (restorable copy, step 5)
- `src/i18n/locales/en/settings.json` (+ the two confirmation-copy namespaces touched in step 5)

## Tests (jest, unit + integration — see docs/TESTING.md)

- **Restore transitions:** tombstoned entity + 8 children + persona profile/images → `restoreEntity` → all
  live (`deleted_at IS NULL`), one shared resurrect `updated_at`, strictly newer than the family's stamps;
  live/unknown id → throws `entity is not deleted`; partner-side mirror rows untouched.
- **Matcher vectors:** app-native family (identical ISO-ms strings) and sync-arrived family (engine format A/B
  stamps per 6-1 §2) both match; second-truncation bridging (`.123Z` vs `…44`).
- **Cascade growth (D26 parity):** `deleteEntity` tombstones settings + lifecycle_state; while tombstoned, the
  five D18 read predicates hide them (cross-ref 4-4).
- **Persona one-now (D17 parity):** `deleteUserPersona` stamps images/entity/profile with the same instant →
  restore resurrects the full persona family.
- **Sync round-trip:** after restore, `getChangedRecords` returns the entity (+ children) with
  `deleted_at: null` present as a key and bumped `updated_at` (pin the payload shape — it is the 1-1 resurrect
  trigger); inbound engine-origin resurrect (5-1's sync-out) applies over a local tombstone (extends 4-1's
  inbound-resurrect test with the persona profile/images family).
- **Greeting (D9):** restored entity with prior history → INIT_ENTITY → no duplicate greeting (restore
  completeness, live-only guard unchanged).
- **Screen:** renders entries (name/type/date), Restore action → toast + list refresh + row gone; empty state.

## Codebase Mapping Consulted

`harmony-ai-app/.planning/codebase/`, `docs/TESTING.md`, `src/database/README.md` (tx semantics), phase docs
1-1/4-1/4-4/5-1/5-2 (shared semantics), live verification of `entities.ts` / `userEntities.ts` / `sync.ts` /
`DisabledAIsScreen.tsx` / `AppNavigator.tsx` (2026-09-06, this amendment).

## Checklist

- [ ] `listDeletedEntities` + `restoreEntity` (instant-equality matcher, one tx, D29-style bump, alias guard)
- [ ] Delete-path parity: 8-child cascade (D26) + one-`now` persona delete (D17)
- [ ] `DeletedEntitiesScreen` + navigation + AccountSettings entry + i18n (en only)
- [ ] Best-effort post-restore `initiateSync` (no critical gating); offline restore verified
- [ ] Restorable-copy notes on both delete confirmations (step 5)
- [ ] Tests green (`tsc` + jest); phase doc updated with deviations
