# 17 — Entity ID & Tombstone Integrity Record (Delete/Recreate Incident, Derived-Only IDs, Tombstone GC & Rebuild)

> Continuation of the record chain (companion to [`16-Engine-Phase2-PostAlignment-Record.md`](16-Engine-Phase2-PostAlignment-Record.md)),
> covering 2026-09-05 → 2026-09-07 across all three repos (engine + nested `frontend/` on
> `feat/engine-track-phase2`, app on `senju-design-updates-rebase`). Full plan folder with per-phase docs,
> ticked checklists and implementation notes: [`.current_work/entity-id-tombstone-integrity/`](../entity-id-tombstone-integrity/)
> — its `summary.md` holds the **binding ruling table D1–D87** (7 review sessions + 1 amendment); this record
> does NOT duplicate it. **All plan work landed UNCOMMITTED on the respective branches. No merges to `main`
> anywhere (Q16 unchanged).**

## Incident → resolution (the plan's reason to exist)

**Symptom (2026-09-05, adb logcat + engine log):** delete an entity ("Isabella") and recreate it from the same
card → the new entity sticks on "waiting for connection"; the greeting never arrives.

**Root-cause chain (3-agent investigation + live DB inspection — summary.md §Incident):**

1. App hard-purges its local tombstones on `SYNC_FINALIZE` → loses the ghost-id reservation.
2. Engine's own purge is permanently broken (deletes `character_profiles` before `entities` → RESTRICT FK
   aborts the whole loop — the recurring `Failed to clean up soft-deleted records` error) → engine tombstones
   persist forever.
3. App recreates "Isabella" → ghost-guard false → **reuses the raw id** → engine sync-apply does a raw INSERT
   → `UNIQUE constraint failed: entities.id` (ledger **N1**) → silent rollback.
4. App proceeds to INIT_ENTITY with the failure swallowed as "non-critical" → `entity_not_defined` → no
   session, no greeting.
5. Recovery re-sends the same failing insert, exhausts retries, deletes the session → amber "Connecting…"
   forever; splash never reveals.

**Every link now has an owner:** N1 → ghost-aware apply (1-1); broken engine GC → repaired finalize purge with
purge floor (1-2); raw-id reuse → timestamped derived-only ids + one app mint seam (2-1/2-2, D2/D23/D68);
swallowed failure → typed `SyncConflictError` + critical syncAndWait + sync-before-INIT_ENTITY (4-2, D13/D55);
stuck UX → failed-session marker + error banner + retry (4-3, D36); cross-device safety → sync version gate v2
+ stale-watermark rebuild (3-3/4-5, D6/D76); legacy-data convergence → one-time engine-authoritative wipe +
re-sync (3-2, D11/D61).

## Follow-up ledger resolution (extends 16's N1–N9)

| # | Status | Resolution |
|---|---|---|
| N1 | ✅ **resolved** | Ghost-aware sync apply (1-1): generic row-level strategy over the ghost-risk tables — incoming live row over a tombstone resurrects when newer (LWW, inclusive `>=` per D29); children resurrect individually through the same mechanism (D39; the D9 family matcher is gone with Phase 5). Locked by `TestSyncApply_FreshInsertPlainInsert`, `TestSyncApply_ResurrectThenInitEntityResolves`, `TestSyncApply_FamilyOfRowsResurrects` + app `sync.inboundResurrect.integration.test.ts`. |
| N2 | ⚠️ **mitigated** (accepted limitation stands) | Timestamped ids (D2/D23) shrink the cross-device derived-id LWW window to same-second collisions; two devices deriving the same name in the same second still LWW-merge (backstop dedupe `-2` applies per-side). Structural fixes (UUID ids / namespacing) remain deferred per the 2026-09-04 user ruling. |
| N3 | ✅ **resolved** (by construction) | Post-D23 no human-typed id exists in any of the three codebases — every id is a built-in, a one-time-migrated legacy id, or minted by the derivation, which cannot emit invalid charset (space-format ids impossible). Both repos pass the 6-1 §1 vector suite (incl. `«Zoë»!!` → `Zo`). |
| N4 | ✅ **resolved by removal** | The rename endpoint, `RenameEntity` and every FE/management rename surface are deleted (2-1b, D22) — nothing can rename onto a ghost id because nothing can rename at all. "Rename" = alias edit everywhere. |
| N6 | ◐ **partial** (as planned) | `docs/api/management/openapi.yaml` now documents `POST /api/entities` (D66 derived-only contract, verbatim 400s) + `POST /api/entities/{id}/duplicate`. Entity routes were **entirely** undocumented before (16's "partial" was the wrong word). The planned deleted-list/restore endpoints that were to round out entity-route coverage are **gone with Phase 5/D75** — restore does not exist. |
| N5, N7, N8, N9 | unchanged | Carried from 16 (FE editor-variant menu clipping; app full-render harness gaps; GitNexus query FTS breakage; legacy sweeps). |

## Per-phase completion (all three repos)

| Phase | Repo(s) | State |
|---|---|---|
| 1-1 ghost-aware sync apply | engine | ✅ (detail in engine phase doc + engine memory bank) |
| 1-2 tombstone-GC repair (FK-safe order, 35-table allowlist, purge floor + rebuild signal; `sync_gc_state` = engine 000046) | engine | ✅ |
| 1-3 sync observability + structured `error_code`s (confirm payloads + INIT_ENTITY; D35) | engine | ✅ |
| 2-1 `DeriveEntityID` + derived-only create contract (D66; `id`/`alias`-carrying requests → 400; D30 alias auto-suffix) | engine | ✅ |
| 2-1b rename removed + delete-side guards (D22 removal, D27 disconnect release, D24 zombie teardown, D26/D17 8-child one-`now` cascade as step 6 per D79) | engine | ✅ |
| 2-2 id derivation + one mint seam (app) | app | ✅ core + UI phase (see below) |
| 2-3 FE id-machinery removal + name-only UX (the FE repo has no docs — **this record is its documentation**) | engine FE | ✅ (see below) |
| 3-1 id-pattern migration 000045 (Go migration via D62 runner hook; reuses `DeriveEntityID`/`DeriveParticipantKey`; D60 recompute; D80 alias-collision skip-and-log; D81 `claire` migrates) | engine | ✅ |
| 3-2 app wipe/rebuild bootstrap | app | ✅ |
| 3-3 sync version gating v2 | engine + app | ✅ (both halves + app UI task) |
| 4-1 app local GC kept + aligned (D72/D73; placeholder 000046 shipped inside 3-2's wave for numbering parity) | app | ✅ |
| 4-2 sync failure surfacing | app | ✅ |
| 4-3 stuck-"Connecting…" UX fix | app | ✅ |
| 4-4 hard-delete gating (soft-delete only everywhere) | app | ✅ (+ 2026-09-06 user follow-up ruling, below) |
| 4-5 stale-watermark rebuild (purge-floor reaction) | app | ✅ |
| 6-1 cross-repo verification | all | ✅ (Verification Report; coverage table all PASS) |
| 6-2 docs/memory banks/changelogs | all | ✅ engine half 2026-09-07; app half (this record, app memory bank, app docs, app changelog, README sweep) 2026-09-07 |

### App-side detail worth the record

- **2-2:** shared `deriveEntityId` in `entityIdUtils.ts` (6-1 §1 vectors + UTC rule); all five creation seams
  route through one DB-backed **`mintEntityId(name)`** (D68: derive → reserved-name typed throw (`user`/
  `deleted`, D33) → ghost-aware `nextFreeDerivedId` backstop); `mintPersonaIdentity(displayName)` folds D56
  alias dedupe (alias = name **verbatim when free**, auto-suffix only on a live twin — engine D30 semantics);
  persona alias/id split; typed `PersonaAliasConflictError` + `ReservedEntityNameError`. UI phase: friendly
  inline reserved-name errors (CreateAIScreen create-mode, PersonaEditScreen), dedicated card-flow messages
  at all three `openCharacterChat` callers, D86 alias-collision pre-check, ChatDetail partner-header alias
  fallback (`nickname || profile name || alias`, D21-8).
- **3-2:** wipe flag consumed in the **boot window** (`DatabaseContext.initializeDb`, D61 — supersedes D38);
  `WipeRebuildFlag` module (`runWipeRebuildIfPending` + `onStateChange`); "Rebuilding from Soulbits Engine…"
  label (D58) ON for the wipe duration; D19 AsyncStorage preference sweep (3 key families); first post-wipe
  sync escalates to `force_full_sync: true` via the existing watermark mechanism; D21-7 UTC timestamp fix
  (`toUnixTimestamp`/`normalizeTimestampForSync` — space format parsed as UTC, never local); placeholder
  migrations **000045 + 000046** (comment-only TS modules, D85) + snapshot re-baseline v44→v46.
- **3-3 app:** `SYNC_SCHEMA_VERSION = 2` always sent; sticky **`serverUpdateRequired`** entered by
  accept-compare (engine `sync_schema_version` < 2) **and** `SYNC_REJECT reason=unsupported_schema_version`
  (D83); **one choke point** — `initiateSync()` short-circuits at its top while sticky (covers all 10 direct
  callers: on-connect, token refresh, session start, manual pulls); `scheduleReconnect` no-op while sticky;
  ~10-min slow re-probe auto-recovers after an engine update; read-only floating-chat provider mirrors the
  gate. UI: badge required `serverUpdateRequired` prop (testID `connection-status-dot-server-update-required`),
  SyncSettings warning card, manual sync buttons disabled while sticky, i18n keys.
- **4-1:** `GC_TABLES` const (35 tables, engine child-first dependency order); `applySyncRecord` dead code
  deleted; orphan-memory sweep retained (D77); `syncGcTablesParity.test.ts` (GC == `SYNC_TABLES` == the
  engine-pinned 35 list); `sync.inboundResurrect.integration.test.ts`; `sync.personaCascade` kept as the GC
  regression lock.
- **4-2:**   `SyncConflictError` typed from structured `error_code` (**`sync_conflict` / `apply_failed`** both
  classify; old engines fall back to plain `Error`); `syncAndWait({critical:true})` rejects on the whole
  failure class (`sync:error`/`sync:rejected`/`sync:aborted` — D34 shared-wait upgrade); **D55**: chat open runs
  a critical wait whenever `entity.updated_at > last full-sync watermark`, resolving only on a COMPLETE round
  incl. bounded ≤2 re-check rounds (the wizard-variant hole); failure alert + no navigation into a doomed chat;
  PersonaEdit failure keeps the user on-screen to retry.
- **4-3:** `failed` marker on `InteractionSession` retained in both maps (D36; own-entity disconnect **flags +
  emits** instead of silently deleting, D65); ChatDetail error banner + red `error` connection dot + splash
  reveal + Retry/Back; retry-scheduler fix (exhaustion marks the interactionId-keyed entry — the review-4
  wiring hole); D35 `error_code` classification (`entity_not_defined` → recovery + "Sync now" hint;
  `entity_disabled`/`entity_exists_deleted` terminal — deletion is final, a sync hint would be dishonest);
  string fallback for old engines; `closeAllSessions` keeps its deliberate full teardown (documented at both
  call sites).
- **4-4:** soft-delete only everywhere; D18 settings full soft delete (5 read predicates + `deleted_at = NULL`
  resurrect in `upsertSettings`' ON CONFLICT); D26 cascade grown to entity + 8 children in the one-`now` block
  (`chat_conversation_settings` + `lifecycle_state` join); in-use guards unconditional.
- **4-5:** `rebuild_required` reject → abort sync → **persist wipe flag → `react-native-restart` process
  restart** (D82); flag persisted BEFORE the restart call (crash-safe); in-process loop guard
  (`hasRebuildCompletedInProcess` — a re-flag after a completed rebuild logs + surfaces, never restart-loops);
  version-gate precedence verified (no rebuild signal can arrive while sticky).

### FE deliverables (2-3 — no docs repo exists; this section IS its documentation)

- **Client id-machinery deleted:** `src/utils/entityIdUtils.js` (`deriveEntityId`, `validateEntityId`,
  `generateUniqueEntityId`, `deriveEntityAlias` — D59), the rename dialog + `handleRename` in
  `EntitySettingsView.jsx`, the PersonasView rename block, and `entityService.renameEntity`. Zero rename calls
  remain (grep-clean, deliberately avoiding the literal tokens in comments).
- **Name-only dialogs:** the Add-entity dialog asks for a name only (auto-derived id); persona create = profile
  POST → ONE derived entity create with **orphan-profile compensation** (best-effort
  `deleteCharacterProfile` mirror); persona edit = alias + profile update only (D14), validated via new pure
  `personaNameUtils.js` (`validatePersonaName` → `nameRequired`/`nameReservedUser`/`nameExists`, case-
  insensitive, live rows, self-excluded).
- **Store echoed-id fix:** `entityStore.createEntity` selects the **server-echoed** `newEntity.id` (was the
  requested id) and passes `name` + `dedupeIdIfTaken` through.
- **Wire contract (D66):** creates send `{ name, character_profile_id?, entity_type?, dedupe_id_if_taken }` —
  `id`/`alias` never sent client-side.
- **i18n dead-key sweep:** rename/id-validation keys deleted across `entitySettings.json` / `personas.json` /
  `characters.json` (incl. review-3/4 additions: `dialogs.rename.*`, `dialogs.confirmRename.*`,
  `dialogs.renameFailed.*`, `messages.renamedFrom`, `buttons.rename`, `dialogs.invalidEntityId.*`,
  `createPersonaReservedUser`, `createEntityReservedUser`, `entityIdInvalidName`, `invalidChars`, dead
  `dialogs.copy.*`); `dialogs.add.message` rewritten name-only; `personas.json editor.nameLocked` reworded.
- **Tutorial copy** (`tutorialSteps.jsx`) name-only — zero `ID` mentions remain (grep-verified).
- **Entity-list hardening:** `min-w-0` flex chain + `title` tooltips so long timestamped ids don't break the
  fixed-width panel; action grid re-laid to 3 buttons.
- **`node --test` locks:** new `personaNameUtils.test.js` (8 tests; D21-9 precedent style) — 15/15 green
  together with `dynamicBackgroundStore.test.js`; `npm run build` exit 0.

## Binding-ruling digest

The full D1–D87 table lives in the
[plan summary](../entity-id-tombstone-integrity/summary.md) (each ruling linked from its phase doc). Structural
headlines only: **D22/D23** (no runtime id-rename ever; ids server-derived-only and locked from birth),
**D69–D78** (D1's never-purge invariant superseded — tombstones are the delete-propagation protocol, GC'd after
propagation; **no restore, D75** — recreation is the only path back; ids never reused by construction, not by
retention), **D11/D61** (engine-authoritative one-time wipe + re-sync, boot-window placement), **D76/D82**
(purge floor + stale-watermark rebuild as a process restart), **D34/D55** (critical shared-wait gating +
sync-fully-executed-before-INIT_ENTITY), **D68** (one app mint seam), **D26/D17/D79** (8-child one-`now`
cascade as delete-path hygiene).

## Deviations worth recording (from the phase docs' implementation notes)

1. **Slug-rule vector resolution (2-2).** D2's prose ("every run outside `[A-Za-z0-9]` collapses to `-`")
   contradicted the binding 6-1 §1 vectors (`a.b_c-d` passthrough; `--__--` → `entity`). Implemented the
   vector-satisfying rule: valid-charset chars (`[A-Za-z0-9._-]`) pass through verbatim, runs of invalid chars
   collapse, edges trimmed, cap 48, empty → `entity`. Engine 2-1 adopted the same rule — both pass all seven
   vectors.
2. **`permanent` delete parameter fully removed (4-4, user ruling 2026-09-06).** After 4-4 shipped
   ignore+warn-once neutralization, the user ruled the dead flag "purposeless lines": it was dropped from all
   28 repository delete signatures + 44 test call sites; `permanentDeleteGuard.ts` deleted. Production never
   passed it (grep-verified zero). Hard deletes no longer exist app-side, full stop.
3. **Restart dependency `react-native-restart` v0.0.29 (4-5).** New runtime dependency (bare RN, New Arch —
   verified TurboModule/codegen support; Android = true process rebirth via ProcessPhoenix). npm 7+ ERESOLVE
   on its `react-native-windows` peerOptional required `npm install --force` (NOT `--legacy-peer-deps`, which
   broke 37 test suites by reclassifying the peer tree). **Native rebuild (`gradlew`/`pod install`) still
   pending — no device build in this environment** (documented in `src/services/AppRestart.ts`).
4. **`error_code` enums (4-2).** The confirm-payload `error_code` classification covers **both**
   `sync_conflict` and `apply_failed` as `SyncConflictError` (the alert copy distinguishes; old engines fall
   back to string errors) — the phase doc had sketched conflict-only.

## Verification state (6-1 Verification Report, 2026-09-07)

- **Coverage table: all PASS** — every 6-1 doc section → named test files/tests per repo; four gaps found and
  filled (engine §3 timestamped participant-key vectors; the pinned 35-table literal list in BOTH repos;
  engine GC→recreate chain `TestSyncFinalizeGCThenRecreateMintsFreshID`), full suites re-run green after.
- **Engine:** `go test ./... -count=1 -timeout 90s` — 43 packages, 0 failures.
- **App:** `npm test` — **146 unit suites / 1300 tests + 13 integration suites (55 passed, 1 skipped)** green.
- **Engine FE:** `npm run build` exit 0; `node --test` 15/15.
- **D11 release-window checklist (§5):** every automatable item automated (gate tests, wipe/escalation,
  sticky/re-probe, rebuild, wipe-gate label); the on-device/deploy items — engine-first deploy, live wipe +
  first-pull, both-side id-set inventory, **D19 preference reset**, visual label check — are **[manual at
  release]**. Honest non-verifiables (real-device flows, live sequencing) listed in 6-1.

## Pending (unchanged from 16 + new)

- Coordinated **engine-first** mainline merge order (now a hard D11 gate: the engine deploy with migration
  000045 + gate v2 must precede the app release); on-device smoke list; senju origin force-push window.
- 4-5's native rebuild for `react-native-restart` rides the next device build.
