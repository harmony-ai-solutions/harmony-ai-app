# 6-1 — Cross-Repo Verification: Shared Vectors, Determinism & Incident Repro

> Created during the 2026-09-05 plan review (the original plan referenced this file without creating it).
> **Scope reduced by ruling D11 (plan review 2, 2026-09-06):** cross-repo id **determinism is dropped** —
> only the engine computes migrated ids (app wipes + re-syncs), so each id is derived exactly once by
> whichever side creates it. What remains binding: §2 (engine migration parser), §3 (participant-key rules,
> still computed on both sides at runtime), §4 (engine-only migration determinism), §5 (D11 sequencing),
> §6 (incident repro). §1 becomes **per-repo regression tests** (parity is no longer required, though both
> implementations should still pass the same vectors — they define the shared D2 schema).
> **Review 6 (D69–D78):** tombstone GC is retained and repaired (1-2 engine / 4-1 app) — §6's restore
> round-trip is replaced by a **GC round-trip**, and the **GC allowlist parity fixture** (D72) joins this
> phase. Phase 5 is deleted; nothing here references it.

## Objective

Guarantee correct, convergent behavior across `harmony-link-private` (Go + SQL) and `harmony-ai-app`
(TypeScript): the D2/D3 id schema implemented identically enough for both sides to *accept* each other's
ids, engine-migration correctness, runtime participant-key agreement, and the incident scenario locked
end-to-end.

## 1. Derivation Vectors (regression tests for 2-1 `DeriveEntityID` / 2-2 `deriveEntityId`)

> Post-D11: **per-repo regression tests**, not a binding parity contract (no id is ever derived
> independently on both sides). **Post-D40 (review 3): these vectors pin the RUNTIME derivation only —
> 3-1's SQL transform is decoupled and pinned by its own fixtures (§4).** Both implementations should
> still pass the same vectors — they define the shared D2 schema.

Fixed timestamp for all vectors: **2026-09-05T12:35:14Z** → suffix `-20260905123514`.

| Input name | Expected base slug | Expected id |
|---|---|---|
| `Isabella` | `Isabella` | `Isabella-20260905123514` |
| `Isabella 2` | `Isabella-2` | `Isabella-2-20260905123514` |
| `  Max  2 ` | `Max-2` | `Max-2-20260905123514` |
| `«Zoë»!!` | `Zo-` → trimmed `Zo` | `Zo-20260905123514` (non-ASCII runs collapse to `-`; trailing trimmed) |
| `--__--` | `` (empty) | `entity-20260905123514` |
| 60× `A` | `A`×48 (cap) | `A…A-20260905123514` (48 A's) |
| `a.b_c-d` | `a.b_c-d` (valid charset passthrough) | `a.b_c-d-20260905123514` |
| `user` | (valid slug, but reserved at validation seams — D10) | creation must 400, not derive |

Timezone rule: the derivation ALWAYS formats in UTC regardless of local clock — test with a
local-time-injected clock seam (e.g. input `2026-09-05T14:35:14+02:00` → same id as the Z instant).

Same-second collision backstop vectors (post-2-2 rewrite): existing ghost `Isabella-20260905123514` →
next id `Isabella-20260905123514-2` (then `-3`…) — **never** `Isabella 2` (space) and never stripping the
timestamp suffix.

## 2. Timestamp Parser Spec (binding for 3-1 engine migration; app applies the same UTC rule to the
D21-7 hygiene fix)

> Post-D11: **engine-migration-only** (the app no longer migrates). The app-side hazard remains real for
> the live outbound path — `normalizeTimestampForSync`/`toUnixTimestamp` (`sync.ts:24-26, 41-70`) parse the
> space format as LOCAL time today and must adopt rule 1 (D21-7).

Three formats coexist in the two DBs (verified):

| Format | Where | Example |
|---|---|---|
| A. SQLite `CURRENT_TIMESTAMP` (space-separated, UTC, seconds) | engine `entities`/`entity_module_mappings`/`character_profiles` defaults; app legacy rows | `2026-09-05 11:12:44` |
| B. Go-driver time strings (space-separated, nanoseconds, ±offset) | engine `interactions`/`memories`/`conversation_messages`/`emotion_state`/`lifecycle_state`/`entity_emoji_actions`/`chat_conversation_settings`; **some written in local time** | `2026-09-05 11:12:44.123456789+02:00` |
| C. ISO-8601 (`T`, ms, `Z`) | app writes (`new Date().toISOString()`) | `2026-09-05T11:12:44.123Z` |

**Parsing rules (identical semantics in Go and TS):**

1. Format A is **UTC** by definition (SQLite `CURRENT_TIMESTAMP`); **never** parse it through a
   local-time-sensitive path — in JS, `new Date("2026-09-05 11:12:44")` yields LOCAL time (V8) — this is the
   #1 divergence hazard. Parse space-format by treating it as UTC explicitly
   (e.g. `Date.parse(str.replace(" ", "T") + "Z")` or an explicit parser).
2. Format B: honor the offset suffix; absence of an offset → treat as UTC (engine convention) and log a
   warning (legacy local-time writers exist, e.g. `emotion/ekman8.go:120` — their true zone is unrecoverable; UTC is
   the deterministic choice both sides must make identically).
3. Format C: native parse.
4. Truncate to seconds **after** normalizing to UTC; derive `YYYYMMDDHHMMSS`.

Vector table (all must yield `20260905091244`):

| Input | Notes |
|---|---|
| `2026-09-05 09:12:44` | format A |
| `2026-09-05 09:12:44.999999999+00:00` | format B, zero offset |
| `2026-09-05 11:12:44.123456789+02:00` | format B, +02:00 |
| `2026-09-05 02:12:44.5-07:00` | format B, negative offset (→ 09:12:44 UTC) |
| `2026-09-05T09:12:44.123Z` | format C |
| `2026-09-05T11:12:44.123+02:00` | format C with offset |

## 3. Participant-Key Vectors (binding for 3-1/3-2 recompute + 2-2 unit tests)

Canonical rules (`controllers.DeriveParticipantKey` `interaction_controller.go:56-84` ≡ app
`deriveParticipantKey` `interactions.ts:56-79`): private (2 ids) = sorted pair joined `+`; group (3+) =
full sorted set joined `+`; world (0/1) = empty.

| Participants | Scope | Key |
|---|---|---|
| `Isabella-20260905123514`, `user` | private | `Isabella-20260905123514+user` |
| `user`, `Isabella-20260905123514` (order flipped) | private | `Isabella-20260905123514+user` (sorted) |
| `A-…`, `B-…`, `C-…` | group | `A-…+B-…+C-…` (sorted full set) |
| `A-…` alone | world | `` (empty) |

**Legacy decision RULED (D60, review 4): RECOMPUTE.** Migration 000024's backfill always wrote both
participant ids into `participant_ids` (`000024:121-145`), so the canonical formula is well-defined for
every legacy row; single-id legacy keys disappear. Test vector: legacy row
`(entity_id=A_old, sender_entity_id=B_old, participant_key=B_old, participant_ids=[A_old,B_old])` →
post-migration `participant_key = A_new+B_new` (sorted pair — matches runtime derivation for both mirror
rows).

## 4. Migration Determinism Fixtures (binding for 3-1 engine tests — engine-only post-D11)

One fixture spec, materialized in the engine repo (SQLite, driven through the D62 Go migration),
containing:

- spaced id `Isabella 2` (live), tombstoned `Isabella` (with `alias` set, and a second tombstone without
  `alias` → name source falls back to old id / `character_profiles.name`),
- mirrored private interaction pair (`entity_id` both sides),
- group interaction (3 participants),
- same-second duplicate pair (deterministic `-2` tie-break by `(created_at, old_id)`, **codepoint/BINARY
  order — Go's native string comparison IS byte order; never `localeCompare`**),
- an already-conforming id `Zoe-20240101120000` (untouched) **plus a row whose derived new_id collides
  with it** (tie-break must treat untouched conforming ids as taken — review-2 finding),
- **a pre-existing dedupe-suffixed id `Max-20260905123514-2` (conforming/taken, untouched — review-5:
  the old end-anchored `\d{14}$` detector missed this shape)**,
- **a non-ASCII display-name row (`«Zoë»!!` → base `Zo`)** — under D62 this is simply a `DeriveEntityID`
  vector (§1 parity is automatic; the D40/D51 decoupling caveats are void),
- **an alias-collision pair (review 7): live entity with explicit alias `X` + live entity whose old
  id is `X` with empty alias → id migrated, alias backfill SKIPPED (stays empty, row logged)**,
- `user` entity + its mirrors (exempt, mirrors renamed), **plus a `claire` seed row (NOT exempt —
  migrated per the Core Rule, review 7)**,
- **format-B `entities`/`entity_module_mappings` rows** (post-verbatim-apply reality, D21-6) alongside
  format-A rows, and format-B local-time rows elsewhere (the `emotion/ekman8.go:120` shape — path fixed
  review-5).

**Pass criteria (engine):** checked-in JSON dump of old_id → new_id matched by the test, recomputed
participant keys on both mirrors (**asserted equal to `DeriveParticipantKey` output — the migration calls
it directly under D62**), charset + reserved-id invariants clean (Go-side checks — not SQL-expressible
without `regexp()`), counts unchanged (live + tombstoned), tombstones preserved, run-twice idempotence,
**orphan-referent list surfaced (`participant_ids`/`sender_entity_id` values absent from `entities`
post-rewrite — accept + log, review-5) + alias-collision skip list surfaced (review 7)**. **D62 (review 5): the expected old→new map is generated BY
`DeriveEntityID` itself — the migration and the expectation share one function (a strictly stronger pin
than the review-3 SQL-spec projection, which is void).**

## 5. D11 Sequencing Verification Checklist (release-window gates — replaces the D7 checklist)

1. Single engine deploy: verbatim-timestamp apply (1-1) + migration 000045 (3-1) + gate minimum 2 (3-3);
   engine tests green before deploy.
2. Old app (v1 / absent version field) against the new engine → rejected with `unsupported_schema_version`.
3. App release lands after the engine: one-time wipe runs (3-2, **in the boot window inside
   `DatabaseContext.initializeDb` per D61 — strictly before any sync trigger fires; no screen renders
   against a half-wiped DB**) →
   full pull (assert **first post-wipe `initiateSync` sends `force_full_sync: true`** — the
   watermark-escalation mechanism, `SyncService.ts:505-517`; the initial-upload flag never gates pulls) →
   engine `user` row inserts cleanly (no local seeder exists) → app advertises version 2.
4. New app against a stale (un-migrated) engine → `serverUpdateRequired`; **no reconnect/handshake
   loop while sticky; the slow re-probe (~10 min) recovers automatically once the engine is updated
   (D57 — review-4)**; after updating the engine, the app re-pulls and converges (no data stranded).
5. Post-rebuild convergence check: engine and app `entities.id` sets identical (live + tombstoned); no
   duplicate old-id/new-id row pairs on either side.
6. Preference reset verified (D19): impersonated persona = `user`, reply-mode keys cleared.
7. **Wipe gate verified (D58 as amended by D61):** the labeled rebuild screen ("Rebuilding from Soulbits
   Engine…", i18n) shows **for the duration of the wipe and clears when the WIPE completes** (D61);
   empty-DB rendering during the subsequent first pull is safe (`sync:data-applied` refreshes); no screen
   renders against a half-wiped DB.

## 6. Incident Repro Test (end-to-end)

Automated where possible (engine integration + app integration), manual otherwise:

1. Create entity "Isabella" from a card; verify greeting arrives.
2. Delete "Isabella" (tombstone both sides; the app's finalize GC purges the local family — 4-1 — and the
   engine's next finalize purges the engine family — 1-2; both under the D69–D78 GC model).
3. Recreate "Isabella" from the same card immediately.
4. Assert: app mints `Isabella-<ts>` (no raw-name reuse — 2-2); engine sync-apply succeeds (no
   `UNIQUE constraint failed` — 1-1); INIT_ENTITY succeeds (no `entity_not_defined`); session created;
   greeting arrives; ChatDetailScreen reaches `connected` (no stuck "Connecting…" — 4-3 regression lock).
5. Negative variant (pre-Phase-2 data shape): push an explicit-id insert colliding with an engine tombstone
   → resurrect path (D9): row live, children resurrected, no duplicate greeting over prior history.
6. **Wizard variant (D55 — review 4):** create a partner via CreateAIScreen (fire-and-forget sync +
   immediate back-out), then open it from the Characters list → the dirty-watermark predicate triggers
   the critical syncAndWait, the engine ingests the entity BEFORE INIT_ENTITY, and the session connects
   (this path had no guard pre-D55 — it is the incident's wizard-shaped twin).
6. **GC round-trip (review 6 — replaces the deleted restore round-trip):** delete an entity → next app
   finalize purges the local family (4-1) → next engine finalize purges the engine family incl.
   `character_image` blob reclaim and advances the purge floor (1-2) → recreate "Isabella" from the same
   card → mints a fresh timestamped id, full greeting (no stale history anywhere), no collisions on either
   side. Multi-device variant: a second device whose watermark lags the floor receives the rebuild signal
   at SYNC_REQUEST and re-pulls (4-5) — after the rebuild it holds no stale rows.
7. **GC allowlist parity fixture (D72):** app GC table list == `SYNC_TABLES` (`SyncService.ts:81-122` —
   review-7 location pin) == engine `registeredSyncTables`
   (35 on both sides; engine adds `memories`/`emotion_state`/`lifecycle_state`, app adds
   `emotion_state`/`lifecycle_state`).

## Checklist

- [x] Derivation vectors implemented as tests in 2-1 (Go) and 2-2 (TS) — both green (per-repo regression)
- [x] Timestamp parser spec implemented + vector tests in 3-1 (engine); app D21-7 hygiene fix adopts rule 1
- [x] Participant-key vectors green both sides; legacy-000024 decision recorded (D60: RECOMPUTE)
- [x] Engine fixture materialized (incl. format-B entities + conforming-collision cases); determinism pass criteria met
- [ ] D11 sequencing checklist executed in the release window (engine first, app second) — automatable items green; full window is a release-time gate (see §5 status table in Verification Report)
- [x] Incident repro test green (automated links; on-device steps logged as release-window manual items)
- [x] GC round-trip verified (delete → local GC → engine GC + floor advance → recreate mints fresh id;
      stale second device rebuilds via 4-5)
- [x] GC allowlist parity fixture green (D72: 35 == 35 == 35) — pinned 35-list fixture added in BOTH repos

## Verification Report

> Executed 2026-09-07 against the landed (uncommitted) work on `feat/engine-track-phase2`
> (engine) and `senju-design-updates-rebase` (app). Cross-repo parity spot-checked by
> execution during implementation; this report adds the missing cross-repo fixtures and
> the coverage audit. **Full suites re-run green AFTER the additions: engine `go test
> ./... -count=1 -timeout 90s` — 43 packages, 0 failures (incl. the touched
> `database/controllers` + `eventserver`); app `npm test` — 146 unit suites / 1300 tests +
> 13 integration suites (55 passed, 1 skipped) green.**

### Coverage table (doc section → covering tests → verdict)

| Doc section | Engine coverage (file · test) | App coverage (file · test) | Verdict |
|---|---|---|---|
| §1 derivation vectors | `database/controllers/entity_controller_test.go` · `TestDeriveEntityID_AllVectors` (all 7 vectors), `TestDeriveEntityID_AlwaysUTC` (UTC rule, +02:00 instant), `TestDeriveEntityID_NeverRejectsReserved` (user row), `TestSlugifyEntityName` (base column) | `src/utils/__tests__/entityIdUtils.test.ts` · all 7 vectors incl. `user`, +02:00/−07:00 timezone rule, slug base + 48-char cap | **PASS** — both pin the same 7 vectors + timezone rule; reserved-name rejection lives at the mint seam both sides |
| §2 parser vectors | `utils/timestampparse/parse_test.go` · `TestParseSixOneVectors` (all 6 → `20260905091244`), `TestParseFormatAIsNeverLocal` (rule 1), `TestParseOffsetlessFormatBTreatedAsUTC` (rule 2) | `src/database/__tests__/timestampUtc.test.ts` · all 6 vectors via `toUnixTimestamp` + `normalizeTimestampForSync`; explicit space-format-is-UTC test | **PASS** — rule-1 parity (space format = UTC) identical on both sides |
| §3 participant-key vectors | `database/controllers/interaction_controller_test.go` · `TestDeriveParticipantKey_Private/Group/GroupOverlapCollision/World/OwnEntityNotInSet` (structural) + **NEW `TestDeriveParticipantKey_SixOneVectors`** (§3 table with D2 timestamped ids); D60 legacy RECOMPUTE vector locked inside the §4 fixture (`wantMirrorKey` on both `int-1`/`int-2` mirrors) | `src/database/repositories/__tests__/interactionsParticipantKey.test.ts` · §3 vectors with timestamped ids (private pair, order-flipped, group dedupe-suffixed, world-empty) + engine-parity edges | **PASS after gap-fill** — engine lacked direct §3 vectors with timestamped ids; added |
| §4 migration fixture | `database/migration_entity_id_timestamp_test.go` · `TestEntityIDPatternMigrationFixture` — expected old→new map generated BY `DeriveEntityID` (`entityIDFixtureExpectations`, D62 pin); idempotence asserted (`snapshot1 == snapshot2`); format-B entities/mappings; conforming-collision (`Zoe`→`-2`), dedupe-suffixed-taken (`Max-…-2`), non-ASCII, alias-collision skip, `claire` non-exempt; `TestIsConformingEntityID` | n/a (engine-only post-D11) | **PASS** — D62 pin and idempotence both asserted |
| §5 D11 sequencing | version gate: `eventserver/synchronization_version_gate_test.go` · `TestSyncRequestAbsentVersionTreatedAsV1Rejected`, `TestSyncRequestLowerVersionRejected` | `wipeForceFullSync.test.ts`, `syncVersionGating.test.ts`, `syncRebuildRequired.test.ts` (sticky precedence over rebuild), `DatabaseContext.wipe.test.tsx` | **PASS for automatable items** — release-window gates itemized below; on-device items are [manual at release] |
| §6.1 create + greeting | `management/routes_entities_test.go` · `TestHandleCreateEntity_*`; `eventserver/greeting_test.go` · `TestInitEntity_Greeting_FiresOnTrulyNewChat` | `entities.test.ts` · `mintEntityId` (D68 seam) + ghost-aware backstop; `entitySessionGreeting.test.ts`; `userEntities.test.ts` | **PASS** |
| §6.2 delete + GC both sides | 1-2 trio in `eventserver/synchronization_gc_test.go` · `TestSyncFinalizePurgesWholeTombstonedFamily`, `TestSyncFinalizePoisonedTableStillSucceeds`, `TestSyncRequestRebuildSignal` | `sync.inboundResurrect.integration.test.ts` (pre-GC-window tombstone survives finalize), `wipeRebuild.integration.test.ts`, `delete_guard` coverage | **PASS** |
| §6.3/4 recreate → fresh id, no UNIQUE, INIT_ENTITY, session, connected | `TestSyncApply_FreshInsertPlainInsert`, `TestSyncApply_ResurrectThenInitEntityResolves` (INIT_ENTITY succeeds, session created, D9 no-greeting-over-prior-history), `TestSyncApply_VerbatimTimestamps` | `userEntities.test.ts` · recreate-after-delete → `-2` no residue; `entitySessionInitRecovery.test.ts` (entity_not_defined → re-sync + re-INIT); `chatDetailConnectionState.test.ts` (4-3 connected mapping) | **PASS** |
| §6.5 explicit-id collision resurrect | `TestSyncApply_FamilyOfRowsResurrects` — explicit-id live insert over tombstone resurrects profile+entity+mapping+interaction+message via record stream | `sync.inboundResurrect.integration.test.ts` (real `applyBufferedSyncData` path) | **PASS** — 1-1 family test already locks it; verified, NOT duplicated |
| §6.6 wizard variant (D55) | n/a (app flow) | `CharacterChatService.test.ts` · "D55: a dirty entity runs a CRITICAL wait before INIT_ENTITY, then navigates" + clean-entity skip; `syncAndWaitCritical.test.ts` (D34 shared-wait rejection) | **PASS** |
| §6.6b GC round-trip + multi-device rebuild | **NEW `TestSyncFinalizeGCThenRecreateMintsFreshID`** — chained finalize-GC purge (whole family + blob + floor) → recreate "Isabella" → fresh `Isabella-20260906120000` id applies with NO UNIQUE failure → INIT_ENTITY session + full greeting; `TestSyncRequestRebuildSignal` (stale device → typed rebuild signal, fresh exempt) | `wipeRebuildFlag.test.ts`, `syncRebuildRequired.test.ts` (rebuild + no stale rows post-rebuild + sticky precedence), `wipeRebuild.integration.test.ts` | **PASS after gap-fill** — the recreate-after-GC link was missing engine-side |
| §6.7 GC allowlist parity (D72) | `TestCleanupTablesMatchesRegisteredSyncTables` (GC == `registeredSyncTables`, 35) + `TestCleanupTablesIsFullRegisteredSet` + **NEW `TestRegisteredSyncTablesPinnedList`** (`registeredSyncTables` == hard-coded 35-list) | `syncGcTablesParity.test.ts` · GC==SYNC_TABLES (35) + exact-order GC pin + **NEW `SYNC_TABLES` == the SAME hard-coded 35-list** | **PASS after gap-fill** — the literal pinned 35-list fixture was missing in both repos |

### Pinned 35-table list (D72 — identical hard-coded fixture in both repos)

The engine pins this list against `registeredSyncTables`
(`eventserver/synchronization_gc_test.go` · `pinnedRegisteredSyncTables`); the app pins the
SAME list against `SYNC_TABLES` (`src/services/__tests__/syncGcTablesParity.test.ts` ·
`PINNED_REGISTERED_SYNC_TABLES`, set comparison — the app's intra-provider-group send order
differs from the engine's, the member set is identical). Drift on either side fails both tests.

```
provider_config_openai, provider_config_ollama, provider_config_openaicompatible,
provider_config_soulbitscloud, provider_config_openrouter, provider_config_harmonyspeech,
provider_config_elevenlabs, provider_config_kindroid, provider_config_kajiwoto,
provider_config_characterai, provider_config_comfyui, provider_config_localai,
provider_config_mistral, provider_config_google, provider_config_xai, provider_config_anthropic,
backend_configs, cognition_configs, movement_configs, rag_configs, stt_configs,
tts_configs, vision_configs, imagination_configs,
character_profiles, character_image,
entities, entity_module_mappings,
interactions, conversation_messages,
chat_conversation_settings,
emotion_state, lifecycle_state, entity_emoji_actions, memories
```

### Gaps found + filled (this phase)

1. **§3 engine vectors (missing).** Engine `DeriveParticipantKey` had structural unit tests
   (private/group/world/order-flip) but NOT the §3 vector table with D2 timestamped ids the
   app pins. **Filled:** `database/controllers/interaction_controller_test.go` ·
   `TestDeriveParticipantKey_SixOneVectors` (4 vectors mirroring the app test).
2. **§6.7 pinned 35-list, engine half (missing).** `TestCleanupTablesMatchesRegisteredSyncTables`
   pins GC == `registeredSyncTables` but nothing pinned `registeredSyncTables` itself against a
   literal list. **Filled:** `eventserver/synchronization_gc_test.go` ·
   `TestRegisteredSyncTablesPinnedList` + `pinnedRegisteredSyncTables` fixture.
3. **§6.7 pinned 35-list, app half (missing).** The app pinned GC_TABLES exactly but not
   `SYNC_TABLES` against a literal list. **Filled:** `src/services/__tests__/syncGcTablesParity.test.ts` ·
   `PINNED_REGISTERED_SYNC_TABLES` + "SYNC_TABLES is the SAME 35-table set as the engine-pinned list".
4. **§6.6b GC round-trip recreate link (missing).** Engine GC tests stopped at purge + floor +
   rebuild signal; create tests started from a clean DB; nothing chained finalize-GC → recreate
   with the same display name. **Filled:** `eventserver/synchronization_gc_test.go` ·
   `TestSyncFinalizeGCThenRecreateMintsFreshID` (purge → fresh derived id sync-applies with no
   UNIQUE failure → INIT_ENTITY session → full greeting). The explicit-id resurrect variant was
   already locked by `TestSyncApply_FamilyOfRowsResurrects` — verified, not duplicated.

### §5 D11 release-window checklist (status per item)

| # | Gate | Status |
|---|---|---|
| 1 | Single engine deploy (1-1 verbatim apply + 3-1 migration 000045 + 3-3 gate ≥2); engine tests green before deploy | **[automated: engine full suite 43 pkgs green]** — deploy itself [manual at release] |
| 2 | Old app (v1 / absent version field) against new engine → rejected `unsupported_schema_version` | **[automated: engine `TestSyncRequestAbsentVersionTreatedAsV1Rejected` / `TestSyncRequestLowerVersionRejected`; app `syncVersionGating.test.ts` "absent engine field is treated as version 1" + "reason=unsupported_schema_version → sticky"]** |
| 3 | App release lands after engine: one-time wipe runs in the boot window (D61, before any sync trigger) → first post-wipe `initiateSync` sends `force_full_sync: true` (watermark escalation; initial-upload flag never gates pulls) → engine `user` row inserts cleanly → app advertises version 2 | **[automated: app `wipeForceFullSync.test.ts` (force_full_sync + flag-does-not-gate + stored-watermark-no-escalation), `DatabaseContext.wipe.test.tsx` (boot-window gate), `syncVersionGating.test.ts` ("sends sync_schema_version: 2")]** — on-device wipe + first-pull sequence [manual at release] |
| 4 | New app against stale (un-migrated) engine → `serverUpdateRequired`; no reconnect/handshake loop while sticky; slow re-probe (~10 min) recovers after engine update; re-pull converges | **[automated: app `syncVersionGating.test.ts` "slow background re-probe … recovers once the engine is updated" + one-shot re-dial + sticky-suppresses; `SyncSettingsScreen.serverUpdateRequired.test.tsx`; engine gate tests]** — live engine-update drill [manual at release] |
| 5 | Post-rebuild convergence: engine and app `entities.id` sets identical (live + tombstoned); no duplicate old-id/new-id pairs on either side | **[automated in parts: engine `TestSyncRequestRebuildSignal` (stale device → rebuild signal), app `syncRebuildRequired.test.ts` + `wipeRebuild.integration.test.ts` (post-rebuild first pull works)]** — live both-side id-set inventory [manual at release] |
| 6 | Preference reset verified (D19): impersonated persona = `user`, reply-mode keys cleared | [manual at release] — no automated proxy found in either repo for the live reset |
| 7 | Wipe gate verified (D58/D61): labeled rebuild screen shows for the wipe duration, clears when the WIPE completes; no screen renders against a half-wiped DB | **[automated: app `DatabaseContext.wipe.test.tsx` "shows the rebuild gate while the wipe runs and clears it when the WIPE completes"]** — visual check [manual at release] |

### Honest non-verifiable list

- **Real-device flows** (no device/simulator in this environment): the physical wipe boot on a
  device, live ChatDetailScreen reaching `connected` over a real WS, greeting delivery over the
  wire, second-device rebuild on real hardware.
- **Live deploy sequencing** (§5 items 1, 3, 5, 6): engine-first deploy, app-store release,
  cross-repo `entities.id` inventory on real servers — all [manual at release].
- **D19 preference reset** (§5 item 6): no automated proxy; manual verification required.
- The app's 1299→1300 unit-test delta and the "worker failed to exit gracefully" jest warning
  (async teardown, pre-existing) are noted; neither affects pass/fail.
