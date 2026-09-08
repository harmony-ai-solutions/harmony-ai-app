# 2-2 — App: Entity ID Derivation & Charset Validation

## Objective

Mirror decision **D2/D3** app-side: timestamped default ids, space prohibition at all creation seams, persona
names move to alias. Keeps the app's ghost-aware guard (`resolveNextEntityIdCopy`) as the local backstop.

## Context (from investigation, 2026-09-05)

Creation seams that mint ids today:

- `src/services/CharacterChatService.ts:99-101` — `openCharacterChat`: `entityId = (await entityIdExists(rawId)) ? await resolveNextEntityIdCopy(rawId) : rawId` (raw card name as id!).
- `src/screens/CreateAIScreen.tsx:1066` — `createPartner()`: `resolveNextEntityIdCopy(trimmedName)`.
- `src/screens/PersonaEditScreen.tsx` — persona create (RN persona convention uses spaced names like
  `"Max 2"` → ids with spaces — ledger N3). Actual minting seams (verified): `createUserPersona`
  (`src/database/repositories/userEntities.ts:322`) and `createUserPersonaFromCard` (`:504`) via
  `resolveNextEntityIdCopy(name)` with `alias = entityId`; edits freeze the id (`updateUserPersona:388-415`).
- Helpers: `resolveNextEntityIdCopy` (`src/database/repositories/entities.ts:405`), `entityIdExists`
  (`entities.ts:375`, ghost-aware), `deriveParticipantKey` (`interactions.ts:56-79`).
- **Verified defect (plan review)**: `resolveNextEntityIdCopy` does **not** `-N`-suffix its input —
  `stripCopySuffix` (`entities.ts:291-296`, regex `/^(.*?)[\s-_]+(\d+)$/`) strips the trailing `-<digits>`
  (so `Isabella-20260905123514` degrades to base `Isabella`) and then walks **space-joined**
  `Isabella 2`, `Isabella 3`… — i.e. the current backstop mints space-containing ids (a direct D3/N3
  violation). Same pattern in `duplicateAIPartner` (`entities.ts:460`).
## Implementation Steps

1. **Shared derivation helper** (e.g. `src/utils/entityIdUtils.ts` app-side, mirroring 2-1 exactly):
   `deriveEntityId(name: string, date: Date = new Date()): string` — identical slug + UTC timestamp rules.
   Cross-check against the engine implementation with a shared test-vector list (see 6-1 — post-D11 these
   are per-repo regression tests, not binding cross-repo contracts, since each id is derived exactly once
   by whichever side creates it). *D20: no length validation on minted ids — the 64-cap validates
   human-typed input only.*
2. **Switch all derived seams** to `deriveEntityId(name)`:
   - `CharacterChatService.openCharacterChat`, `CreateAIScreen.createPartner`, and the persona seams
     (`createUserPersona`, `createUserPersonaFromCard`) use the derived id.
     **Review-4 fix:** `createUserPersonaFromCard` must stop naming the PROFILE after the id —
     `userEntities.ts:505` sets `personaName = entityId` today (harmless while id = name;
     post-derivation the persona's display name becomes `Isabella-20260905123514`, since
     `getUserEntities` renders `profile_name || alias || id` at `userEntities.ts:119`) — set
     `personaName = baseName`.
   - **Rewrite the same-second backstop first — prefer replacing over patching (review-2, S7):**
     `resolveNextEntityIdCopy`/`stripCopySuffix` walk space-joined ids (a direct D3/N3 violation — see
     Context). Replace with a narrow `nextFreeDerivedId(fullDerivedId)` (ghost-aware `-N` append to the
     **full derived id**: `Isabella-20260905123514` → `…-2`) instead of retrofitting the old walker;
     **five** production call sites exist (review-3 count fix: CharacterChatService:100,
     CreateAIScreen:1066, userEntities:322, userEntities:504, and `duplicateAIPartner` `entities.ts:460`
     — the plan's "4" missed the last, which must switch too or it mints space ids). Keep
     `stripCopySuffix` — space-based naming stays for **alias** copies, and it is also load-bearing for
     profile-name duplicate detection (`getSiblingCharacterProfiles`, `characters.ts:927-930` —
      review-4 rationale fix). `nextFreeDerivedId` lives in `entities.ts` next to `entityIdExists`
      (DB-backed, reuses it as-is — the ghost-aware probe is exactly right; pure `deriveEntityId` lives
      in `entityIdUtils.ts`).
   - **D68 (review 5 — one mint seam, five callers):** all five call sites route through a single
     DB-backed **`mintEntityId(name): Promise<string>`** in `entities.ts` (compose:
     `deriveEntityId(name)` → reserved-name throw (`user`/`deleted`, D33 — the typed error the
     `openCharacterChat` UX pin surfaces) → ghost-aware `nextFreeDerivedId`). Seams never wire
     derive + backstop + reserved separately again — seam drift is exactly how N3 happened (a seam
     minting raw/space ids), and future seams get correctness by construction. Optional companion
     **`mintPersonaIdentity(displayName): { id, alias }`** (= `mintEntityId` +
     `getNextEntityAliasCopy`, D56) for the alias-minting seams (both persona creates +
     `openCharacterChat`'s card alias; `duplicateAIPartner` keeps its already-complying copy-suffix
     alias). The pure `deriveEntityId` stays in `entityIdUtils.ts` (6-1 §1 vectors) — the mint helper
     can't live there (DB probe); `CharacterChatService` already depends on the repo layer, so no new
     dependency direction.
3. **Reserved-name validation at the name→id seams (D33 — replaces the old explicit-id step, which had no
   target: no app UI lets users type entity ids)**: post-D23, derivations always get timestamp suffixes
   so names can't collide with reserved *ids* — the checks are a UX guard against confusing names.
   Reject names `user` and `deleted` with a friendly inline error at all three seams:
   - `CreateAIScreen` partner-name field (no check exists today),
   - `PersonaEditScreen` persona name (`isReservedPersonaName` `:135-137` covers only `user` — add
     `deleted`),
   - `CharacterChatService.openCharacterChat` card-name seam (no check today). **Review-5 UX pin:** this is
     an automatic card flow — there is no form field for an inline error; callers surface generic alerts
     (`CharactersScreen:492-495`, `AIProfileScreen:419-421`, `ChatListScreen:716-721`). Throw a typed
     reserved-name error and give those alerts a dedicated message key ("This character's name is
     reserved — rename the card and retry"), never a bare generic failure.
4. **Persona naming switch (D3 + D56)**: persona create/edit sets `alias = displayName` (spaces allowed there) and
   `id = deriveEntityId(displayName)`; the display layer already prefers alias/profile name — verified:
   ChatList/ArchivedChats use alias → profile name → id; DisabledAIs uses alias → id (no profile step);
   **ChatDetailScreen's partner header reads only profile nickname/name** (`ChatDetailScreen.tsx:2094`),
   never `entities.alias` — **review-2 ruling (D21-8): add alias as final fallback**
   (`nickname || name || alias`). **Review-3 extension: the visible header is `headerName`** (set from
   `routeEntityName` `:447` or `profile.name` `:536`, rendered `:2263`) — it reads *neither* nickname nor
   alias today and stays `'Chat''` for profile-less partners; extend the fallback chain into the
   `headerName` derivation too, not just `charName:2094`. Persona **edits must NOT re-derive the id**
   (id is stable for life; `updateUserPersona` already freezes it); only creation derives.
   **D56 (review 4):** moving alias from `entityId` (collision-free today) to `displayName` means
   duplicate display names now throw on the live-only partial unique index `idx_entities_alias_unique`
   (000018/000042) — persona create seams dedupe via the existing **`getNextEntityAliasCopy(displayName)`**
   (`entities.ts:299+`, live-only — exact mirror of D30): live twin `Max` → alias `Max 2`. Same treatment
   on the duplicate seam (`duplicateAIPartner` already complies — D52 tie-in) and `openCharacterChat`'s
   same-name-card latent collision (it sets `alias = profile.name` undeduped today,
   `CharacterChatService.ts:104`). Engine sync-apply does NOT mutate incoming aliases (verbatim-apply
   preserved — server-side D30 covers management creates only).
   **Edit-path parity (review 7):** D56 covers creates only — `updateUserPersona`
   (`userEntities.ts:388-454`) sets `alias = displayName` with no dedupe/pre-check, so an edit renaming
   onto a taken alias surfaces as a raw SQLite UNIQUE error. Mirror the engine's update semantics
   (create auto-suffixes, update rejects): (1) `PersonaEditScreen` validation gains a
   case-insensitive alias-equality pre-check (live rows, excluding the edited entity) → friendly inline
   error — mirror of 2-3's edit predicate and the engine's update-400 (`enforceAliasUniqueness` on
   update, `routes_entities.go:315-331`); (2) `updateUserPersona` catches the residual
   unique-constraint race → typed friendly error instead of raw SQLite (belt-and-braces, same as the
   engine's `isEntityUniqueConstraintConflict` mapping).
5. **`user` persona** stays `user` (exempt); typing an id `user` at creation is still rejected (existing rule).
6. **participant_key compatibility**: `deriveParticipantKey` consumes entity ids — new ids contain `-` and the
   key format `{ids joined by "+"}` is unaffected; add a unit test asserting keys like
   `Isabella-20260905123514+user` round-trip.

## Files to Modify

- `src/utils/entityIdUtils.ts` (new shared helper — file does not exist yet, verified)
- `src/services/CharacterChatService.ts`, `src/screens/CreateAIScreen.tsx`,
  `src/database/repositories/userEntities.ts` (persona seams), `src/database/repositories/entities.ts`
  (backstop suffix rewrite: `resolveNextEntityIdCopy`/`stripCopySuffix`/`duplicateAIPartner`)
- Display seams that fall back to entity id where an alias exists (see step 4 — ChatDetail partner header)

## Tests (jest, unit + integration)

- Derivation parity vectors vs engine (see 6-1 shared fixture).
- `openCharacterChat` on a card named "Isabella 2" → id `Isabella-2-<ts>` (not raw name, no space).
- Same-second recreate → `-2` suffix on the **full derived id**, ghost-aware (pre-migration fixtures with
  tombstones) — regression-locks the rewritten backstop (no space ids ever); **also rewrite
  `entities.test.ts:877-939`, which pins today's space-joined behavior** (review 3).
- Reserved names (`user`, `deleted`) rejected at all three name seams with inline errors (D33); persona
  create leaves spaces in alias only.
- **`mintEntityId` helper: derives from name, throws on `user`/`deleted`, ghost-aware `-2` suffix on
  same-second collision, `entity` base fallback — the ONE seam all five creation paths route through
  (D68); `mintPersonaIdentity` returns deduped `{ id, alias }` (D56).**
- **Persona duplicate display name → alias `Max 2` via `getNextEntityAliasCopy` (D56); from-card persona
  `profile.name === baseName` (never the derived id — review-4 fix); same-name cards in
  `openCharacterChat` alias-deduped (D56).**
- **Persona EDIT onto a taken alias → friendly inline error (case-insensitive, self-excluded); residual
  race → typed error, never raw SQLite (review 7).**
- participant_key derivation with timestamped ids.

## Codebase Mapping Consulted

`harmony-ai-app/.planning/codebase/`, `docs/TESTING.md`, senju record app-parity wave (app parity fix `4622210`
introduced the ghost-aware create compensation this builds on).

## Checklist

- [x] Shared `deriveEntityId` + regression vectors (per-repo, post-D11) — `src/utils/entityIdUtils.ts` +
      `src/utils/__tests__/entityIdUtils.test.ts` (all 6-1 §1 vectors + timezone rule)
- [x] All derived seams switched (5 call sites incl. `duplicateAIPartner`) **via the one `mintEntityId`
      helper (D68)**; backstop **replaced** with `nextFreeDerivedId` (no space ids) — `resolveNextEntityIdCopy`
      removed; `stripCopySuffix` kept (alias copies + `getSiblingCharacterProfiles`)
- [x] Reserved-name checks (`user`, `deleted`) at all three name seams (D33 — no explicit-id UX exists) —
      typed `ReservedEntityNameError` thrown from the mint seam (all five callers); the screen-side dedicated
      message-key mapping is owned by the follow-up UI phase
- [x] Persona alias/id split (create only; edits stable) + alias dedupe `getNextEntityAliasCopy` (D56) +
      `createUserPersonaFromCard` names the profile `baseName`, never the derived id (review-4) +
      edit-path alias-collision friendly error (review 7) — typed `PersonaAliasConflictError` in
      `updateUserPersona` (residual race); the PersonaEditScreen case-insensitive pre-check is a UI-phase item
- [x] ChatDetail partner header alias fallback added — `charName` AND `headerName` (D21-8) — **owned by the
      follow-up UI phase (screens are out of scope for 2-2 CORE)** — **DONE in the UI phase** (see
      "Implementation Notes (deviations) → UI phase"): `resolveHeaderName` resolves
      `nickname || profile name || alias` for private chats; profile-less partners surface the alias in
      both `headerName` and the `charName` chain; 4-3 suites stay green
- [x] `tsc` + jest suites green; phase doc updated — `npx tsc --noEmit` clean; `npm test` 133/133 unit suites
      (1184 tests) + 12/12 integration suites green (only the known pre-existing parallel-load flakes
      `nodeDatabase.smoke` / `compat/nodeSide` ever fail intermittently, and pass in isolation)

## Implementation Notes (deviations)

1. **Slug rule — D2 prose vs 6-1 §1 vectors (resolved contradiction).** The prose rule "every run of chars
   outside `[A-Za-z0-9]` → single `-`" contradicts the binding vector `a.b_c-d → a.b_c-d-…` ("valid charset
   passthrough") and the `--__-- → entity-…` vector (which forces `_` to be trimmed at the edges, not
   preserved). Implemented the vector-satisfying rule: characters inside the VALID ID CHARSET
   `[A-Za-z0-9._-]` pass through verbatim; every run of `[^A-Za-z0-9._-]` collapses to a single `-`;
   leading/trailing non-alphanumerics are trimmed; cap 48; empty → `entity`. All seven §1 vectors pass.
   The engine's 2-1 `DeriveEntityID` (not yet implemented in `harmony-link-private` at write time) must
   adopt the same rule to stay vector-consistent.
2. **D56 create-alias semantics — `getNextEntityAliasCopy` alone would mint "Name 2" for a brand-new
   name.** That helper treats the base as slot 1 (duplicate semantics: the source always exists). Creates
   need the engine D30 create default: alias = name VERBATIM when free, auto-suffix only on a LIVE twin.
   Added `entityAliasExists` (live-only, case-insensitive) + `resolveCreateAlias`; used by
   `mintPersonaIdentity` and `openCharacterChat`. `duplicateAIPartner` keeps `getNextEntityAliasCopy`
   (its base always exists).
3. **`duplicateAIPartner` display-name source — D63's `alias → linked profile name → id` middle step
   skipped.** entities.ts cannot import characters.ts (circular import — characters.ts already imports
   from entities.ts), and the app always populates `alias` at every create seam, so `alias || id` is the
   operative base. The duplicate id now derives from the display name (`New-Name-<ts>`), the D52
   timestamped-derivation switch; the copy-suffix alias convention is unchanged (D56).
4. **Create-side compensation tests rewritten.** The old alias-collision compensation trigger (alias was
   the id → two same-name personas collided on `idx_entities_alias_unique`) can no longer fire because
   D56 dedupes the alias BEFORE the INSERT. The `compensateOrphanedPersona` code stays as belt-and-braces
   for genuine residual races (PK/alias), but the tests now pin the dedupe behavior (creates never 400 on a
   name collision).
5. **CreateAIScreen alias stays undeduped.** Only the id call was switched to `mintEntityId` (the task's
   minimal call-site swap rule). `alias: trimmedName` is unchanged — a duplicate AI-partner name still
   surfaces the screen's existing alias-conflict alert + profile rollback. D56 alias dedupe for the
   CreateAIScreen partner seam is a UI-phase decision.
6. **PersonaEditScreen / ChatDetailScreen items deferred.** `isReservedPersonaName` (`deleted` addition),
   the alias-equality pre-check, the reserved-name dedicated message keys, and the ChatDetail partner
   header alias fallback (`charName` + `headerName`, D21-8) are UI-phase items per the task's screen
   scope; the service/repo layer behind each is in place (typed `ReservedEntityNameError`,
   `PersonaAliasConflictError`, `mintEntityId`).

## Implementation Notes (deviations) — UI phase (phase 2-2 screens, 2026-09-07)

Wired the screen/UI half of D33/D21-8/D86 on top of the in-tree service layer. All verification green:
`npx tsc --noEmit` clean; unit 141/141 suites (1235 tests), integration 13/13 suites (55 passed,
1 skipped) — including the 4-3 ChatDetail/session suites (`chatDetail*` 8 suites, `EntitySession*`
14 suites).

### What shipped

1. **Reserved-name friendly errors (D33) — form seams.**
   - `CreateAIScreen`: module-level `isReservedPartnerName` (trim + case-insensitive `user`/`deleted`,
     same predicate the mint seam enforces); LIVE inline error under the partner-name field
     (testID `create-ai-name-error`, key `createAI:nameReserved`) in CREATE mode; submit blocked before
     `setIsSaving`; belt-and-braces `catch (ReservedEntityNameError)` around `mintEntityId` maps to the
     same inline error (never the generic `createFailed` alert).
   - `PersonaEditScreen`: `isReservedPersonaName` extended to `deleted`, trim + case-insensitive; inline
     error under the persona-name field (testID `persona-name-error`, key `profile:personaNameReserved`)
     renders live; `handleSave` blocks silently (the inline error is the message); belt-and-braces
     `instanceof ReservedEntityNameError` catch (the persona CREATE seam mints via `mintPersonaIdentity`).
2. **Card-flow seam (D33 review-5 UX pin).** All three `openCharacterChat` callers catch the typed error
   and surface the DEDICATED message ("This character's name is reserved — rename the card and retry"),
   never the bare generic failure: `CharactersScreen.handleChatPress` (alert, `characters:chatOpenReservedName`),
   `AIProfileScreen.handleChat` (toast, `profile:aiChatReservedName`), `ChatListScreen.handleNewChat`
   (alert, `characters:chatOpenReservedName`).
3. **Persona edit alias-collision UX (D86).** `handleSave` (edit mode) pre-checks case-insensitive
   alias-equality over LIVE rows (`getAllEntities()`, live-only) excluding the edited entity id → friendly
   inline error (`profile:personaAliasConflict`), `updateUserPersona` never called; probe failure is
   best-effort (logs + falls through to the typed save guard). `catch (PersonaAliasConflictError)` maps
   the residual unique-index race to the SAME inline error — never raw SQLite text. The legacy
   raw-UNIQUE→alert branch remains only as the last-resort mapping for non-typed errors.
4. **ChatDetail partner header alias fallback (D21-8).** `resolveHeaderName` (private-chat branch)
   resolves `nickname || profile name || alias` into BOTH `headerName` and `partnerName`; a profile-less
   partner (or a profile-less-linkage entity) with an alias now shows the alias instead of the `'Chat'`
   placeholder / bare id. The `charName` chain (`nickname || name || partnerName`) picks the alias up
   transitively via `partnerName`. Group chats and the `routeEntityName` fast path unchanged. 4-3's
   failed-session/error-banner machinery untouched; all its tests green.

### Deviations / notes

1. **"Reuse the screen's existing inline-error pattern" — none existed (drift, adapted).** Both editor
   screens surfaced validation via `showAlert` only; the app's established inline-error idiom lives in
   the auth screens (error-colored `ThemedText` under the field). Introduced exactly that minimal pattern
   (no new visual system) in both screens; the previous reserved-name ALERT in PersonaEditScreen was
   replaced by the inline error per D33's "friendly inline error" wording.
2. **`profile:personaNameReserved` is a NEW key in `profile.json`.** The old `t('personaNameReserved')`
   lookup resolved only against the screen's namespace list (`profile`/`characters`/`createAI`), where
   the key did not exist (it exists only in `persona.json`, which is NOT in that list) — so the old alert
   rendered the raw key in production (latent pre-existing bug, now fixed by the profile-ns key). The
   `persona.json` key was left untouched (nothing deleted). Copy covers both reserved names.
3. **CreateAIScreen reserved-name block is CREATE-mode only** (matches D33's seam definition: edit mode
   renames the alias via `updateEntityFields`; no name→id mint exists there — the alias-conflict alert
   still guards edit renames). The live inline error is gated the same way.
4. **headerName for profile-bearing partners now includes `nickname`** (`nickname || name || alias`) —
   per the D21-8 review-3 extension wording ("extend the fallback chain into the `headerName`
   derivation"); previously headerName read only `profile.name`. Profile-less partner WITHOUT an alias
   keeps the `'Chat'` placeholder (no regression; the ruling only adds the alias fallback).
5. **Tests.** New: `CreateAIScreen.test.tsx` (4 — inline error + blocked submit for `deleted`/`USER`,
   typed-error path, happy-path control), `chatDetailHeaderAlias.test.tsx` (4 — alias in headerName AND
   charName; no-alias placeholder regression; profile-name-beats-alias; nickname-wins chain order),
   `CharactersScreen.test.tsx` +1 (typed error → dedicated alert, never `chatOpenFailed`),
   `PersonaEditScreen.test.tsx` +5 net (`deleted` case, D86 pre-check / self-exclusion / typed residual
   race, and the two reserved-name tests rewritten from alert-assertions to inline-error assertions).
   New i18n keys (en only): `createAI:nameReserved`, `characters:chatOpenReservedName`,
   `profile:aiChatReservedName`, `profile:personaNameReserved`.
