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

- [ ] Derivation vectors implemented as tests in 2-1 (Go) and 2-2 (TS) — both green (per-repo regression)
- [ ] Timestamp parser spec implemented + vector tests in 3-1 (engine); app D21-7 hygiene fix adopts rule 1
- [ ] Participant-key vectors green both sides; legacy-000024 decision recorded
- [ ] Engine fixture materialized (incl. format-B entities + conforming-collision cases); determinism pass criteria met
- [ ] D11 sequencing checklist executed in the release window (engine first, app second)
- [ ] Incident repro test green (or manually executed + logged)
- [ ] GC round-trip verified (delete → local GC → engine GC + floor advance → recreate mints fresh id;
      stale second device rebuilds via 4-5)
- [ ] GC allowlist parity fixture green (D72: 35 == 35 == 35)
