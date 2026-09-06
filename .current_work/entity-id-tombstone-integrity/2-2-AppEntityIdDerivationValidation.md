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
- participant_key derivation with timestamped ids.

## Codebase Mapping Consulted

`harmony-ai-app/.planning/codebase/`, `docs/TESTING.md`, senju record app-parity wave (app parity fix `4622210`
introduced the ghost-aware create compensation this builds on).

## Checklist

- [ ] Shared `deriveEntityId` + regression vectors (per-repo, post-D11)
- [ ] All derived seams switched (5 call sites incl. `duplicateAIPartner`) **via the one `mintEntityId`
      helper (D68)**; backstop **replaced** with `nextFreeDerivedId` (no space ids)
- [ ] Reserved-name checks (`user`, `deleted`) at all three name seams (D33 — no explicit-id UX exists)
- [ ] Persona alias/id split (create only; edits stable) + alias dedupe `getNextEntityAliasCopy` (D56) +
      `createUserPersonaFromCard` names the profile `baseName`, never the derived id (review-4)
- [ ] ChatDetail partner header alias fallback added — `charName` AND `headerName` (D21-8)
- [ ] `tsc` + jest suites green; phase doc updated
