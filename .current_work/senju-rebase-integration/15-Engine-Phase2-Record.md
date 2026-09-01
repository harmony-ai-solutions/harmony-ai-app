# 15 — Engine Phase 2 Record (Message Actions, Preferences Sync & Entity Typing)

> D5-convention execution record for the engine-track phase (`.current_work/senju-engine-phase2/`, phase docs
> 1-1 … 6-2). **Binding contract base:** `.current_work/senju-rebase-integration/21-Engine-Contract-Persona-Enums.md`
> (Q1–Q16 rulings, schema/sync/behavior contracts + §9 amendments A1–A19, rounds 2/3 of 2026-08-31 and the
> 2026-09-01 user ruling). Companion to the Phase-1 follow-up record `14-Followup-Phase1-Record.md`.
> **Two repos this phase:** `harmony-ai-app` (branch `senju-design-updates-rebase`) + `harmony-link-private`
> (new branch `feat/engine-track-phase2` off `main`). **No merges to `main` during Phase 2** (Q16).

## Status

| Phase | State | App commit(s) | Engine commit(s) |
|---|---|---|---|
| 1 — Schema lockstep + parity tooling | ✅ committed | `1c7d916` + `398bee4` + `40dde10` | `b31aad1` + `dccbd29` + `72aed94` + `7f906aa` |
| 2 — B1 engine (message actions) | ✅ committed | — (app side is Phase 1/3) | `1628357` + `9aca1a1` + `bff4311` |
| 3 — B1 app (derived unread) | ✅ committed | `1288630` | — |
| 4 — B2 sync (preferences) | ✅ committed | `4deb71b` + `156de56` + `6a8788a` | `e032869` + `e726f82` + `bd718c9` |
| 5 — B3 entities (typing/personas) | ✅ committed | `722e4b5` + `4db2ab7` | `bca92f3` + `138ea3f` + `982a1a3` + `b68eab2` |
| 6 — Verification, records & docs | ✅ committed | this record + docs | memory-bank note |

> **§9-A19 re-lay, noted for clarity:** the favorites↔sidecar rework (app `722e4b5`, engine `b68eab2`) landed
> after the B2 work that originally registered the sidecar — so the favorites registration from 4-1/4-2
> (`4deb71b`/`e726f82`) was **added then removed** (see Deviations §1). The engine commits named in the B2 row
> are listed in execution order; the favorites registration they contain was reverted by the A19 pair.

Docs commits during the phase: app `1c7d916` (dump-writer hardening), `40dde10` (parity tooling + `docs/schema-parity.md`
rewrite); this commit is the 6-2 wrap-up (record, CHANGELOG, memory bank, planning summaries). The engine
`AGENTS.md`/`CLAUDE.md` GitNexus stat refresh and the engine memory-bank note are the engine-side docs commit.

---

## Per-phase what changed & why

### Phase 1 — Schema lockstep + parity tooling (B1/B2/B3 schema)

**Engine (`feat/engine-track-phase2`)**
- `b31aad1` — dump-writer hardening (§9-A8/§9-A13/§9-A15): `normalizeSQL` in `cmd/dump_schema.go` gained a
  string-literal-aware SQL comment stripper + `CREATE TABLE` header table-name quote normalization, applied
  before whitespace collapse; `dump-schema` now emits **pure JSON on stdout** (config/banner lines to stderr;
  all fixed `tail -n +N` strips retired). Cross-impl fixtures green in Go.
- `dccbd29` — migration `000041`: canonical `conversation_messages` rebuild (column set/order identical,
  **engine keeps its `TIMESTAMP`/`DATETIME` labels** per §9-A9) + synced `character_favorites` (watermark triple,
  `favorited_at` dropped) + slimmed `chat_conversation_settings` (`unread_count`/`muted`/`blocked` gone,
  `reply_mode` added). Engine-only FK clause + `content`/`message_type` defaults + `BLOB`/`BOOLEAN` labels
  dropped (Q4 canonical; affinity-equivalent). `.down.sql` rebuilt the pre-000041 shape (no `DROP COLUMN`).
  **No registration file** — the runner `//go:embed`s `database/migrations/*.sql`.
- `72aed94` — migration `000042`: `entity_type TEXT NOT NULL DEFAULT 'ai'`, `is_muted`, `is_disabled` + the
  `UPDATE entities SET entity_type='user' WHERE character_profile_id IS NULL` backfill (Q9, §3.4). `.down.sql`
  rebuilds without the three columns.
- `7f906aa` — regenerate the **truthful** committed `schema/go-schema.json` baseline (was stale — missing
  `lifecycle_state` + `device_push_tokens`). Pure-JSON stdout assert (`[` start) and committed.

**App (`senju-design-updates-rebase`)**
- `1c7d916` — dump-writer hardening mirrored in `normalizeSql` (`src/database/__test_utils__/dumpSchema.ts`) +
  `scripts/dump-schema.ts` (same comment stripper + header quote normalization; cross-impl fixture tests, TS).
- `398bee4` — **Phase-1 lockstep change set** (§9-A5/A9/A10/A16, the ONE big-green-commit ruling A18): canonical
  rebuild of the pre-mainline `000041` + new `000042` (entity flags), the derived-unread core, the entity-flag
  consumer rewiring (mute/disable → entity flags, DisabledAIsScreen kept+rewired), the `userEntities.ts` repo
  (`getUserEntities`/`createUserPersona`/`updateUserPersona`/`deleteUserPersona` with the `'user'`-delete guard /
  `resolvePersonaId`), and `personas.ts` reduced to a thin re-export shim (§9-A16 surface). Timestamp labels
  adopted engine-side per §9-A9; the §9-A9 reconciliation rebuilds (`emotion_state`, `entity_emoji_actions`,
  `interactions`, `entities` w/ `alias DEFAULT ''`) landed here as post-migration rebuilds; `sync_history`
  reconciliation **cancelled** by §9-A14 (the table is dropped in 4-2). `personas`/`character_favorites`/
  `chat_conversation_settings` removed from `CLIENT_ONLY_TABLES`. Migration snapshots + `schema/rn-schema.json`
  regenerated.
- `40dde10` — parity tooling remainder: `scripts/compare-schemas.py` gained a versioned
  `EXPECTED_DIVERGENCES` allowlist loaded from `scripts/parity-allowlist.json` (removal-only policy), the
  `CLIENT_ONLY_TABLES` mechanism **deleted** (D6 end state), and `docs/schema-parity.md` rewritten
  (§9-A17 heading + drift-count reconciliation note; §9-A9 timestamp-label policy; CI-red-by-design Q16 note).

**Why:** both sides had to reach the same final schema shape before any consumer code. The lockstep pairing
(`1c7d916`↔`b31aad1`, `398bee4`↔`dccbd29`+`72aed94`, `40dde10`↔`7f906aa`) kept local parity the authoritative
gate, with a single-sided pair only ever entered from the first commit of a pair (A11).

### Phase 2 — B1 engine: message actions, field-merge, reaction awareness (deliverable 1)

- `1628357` — message-action columns first-class in the Go data layer: `ConversationMessage`/`ConversationMessageSync`
  (`reactions_json`, `reply_to_message_id`, `is_pinned`, `is_read` + pointer twins), `ToSyncModel`/`ToDBModel`
  round-trip (JSON wire keys match the app), `queryGetChangedConversationMessages` + scan targets, repo INSERT
  list + new `UpdateConversationMessageActions` (field-scoped, content columns never touched), **stop stamping
  `time.Now()`** on insert (persist inbound `CreatedAt`/`UpdatedAt` verbatim; fall back to now only for
  engine-native creation). Engine-authored rows write coherent zero-values — `is_read` stays **0** by the column
  default (A2 retracts the "born read" decision).
- `9aca1a1` — the sync `"conversation_messages"` case becomes insert + field-merge (Q3): existing row → merge only
  `reactions_json`/`is_pinned`/`is_read`/`updated_at` when inbound is newer; insert persists `reply_to_message_id`;
  **inbound timestamps verbatim** (echo-safe). The merge is the read-receipt channel (app 0→1 read bumps
  `updated_at`); the engine never writes `is_read` (read-by-AI stays deferred, Q2).
- `bff4311` — reactions visible to cognition (deliverable 1 of 2-3): a compact `[reactions: 😂, ❤️]` annotation
  appended to the history context line for messages carrying non-empty `reactions_json` (`prompt_builder.go`
  context assembly), shared by beat/dream/outreach context. **AI-authored reactions deferred** (§9-A12 — the
  backend does not emit reaction effects yet); deliverable 2 remains a design sketch.

### Phase 3 — B1 app: derived unread completion (3-1 remainder)

- `1288630` — the rest of the derived-unread work (the core landed in Phase 1 per A5/A2): delete the
  `chat_last_read_*` family + `getKeyLastRead`, add `markConversationMessagesRead`/`markConversationMessagesUnread`/
  `getUnreadCountByParticipantKeys` (every query scoped `entity_id = own POV` per A2), `is_read` into the boolean
  sync map, `sync:messages-applied` recount event (fixes synced-in messages never badging), "new messages"
  divider derived from the first unread message at open, badge seams (`ChatListScreen` load/bubble/live),
  ArchivedChats clear-on-open. `EntitySessionService` unread-increment block deleted (Phase 1 marked it dead;
  zero remnants verified). 3-1's scope note: the derived-unread CORE moved forward to Phase 1 (A5) — this commit
  is the remainder.

### Phase 4 — B2 sync: PK registry, registration, muted/disabled gates, settings rewiring

**App**
- `4deb71b` — centralized `src/database/pkRegistry.ts` (`PK_FIELDS` map + `getPkField`) replacing the ~6
  scattered pkField sites (`sync.ts`/`SyncService.ts`). **A7 was not behavior-neutral** — the send path keyed
  `lifecycle_state` by `id` while the apply path keyed it by `entity_id`; the registry standardizes on
  `entity_id` (deliberate bugfix, tests updated). Registered `character_favorites` + `chat_conversation_settings`
  (upload list, `TABLE_ORDER`, cleanup list, FK diagnostics) + the per-table initial-upload set (AsyncStorage,
  `@harmony_sync_initial_upload_done:<source>`, Q7 app mirror).
- `156de56` — **app `000043`** (the §9-A14 pair): `DROP TABLE IF EXISTS sync_devices; DROP TABLE IF EXISTS
  sync_history;` + delete `src/database/repositories/sync.ts` (all six fns zero-caller) + remove the
  `SyncDevice`/`SyncHistory` model types + register version 43 + snapshot/baseline regen. Allowlist converted the
  interim `table:sync_history` different-SQL entry to **Go-only** and added `table:sync_devices` **Go-only** →
  **3 uniform Go-only infra entries**.
- `6a8788a` — 4-4 settings rewiring: `reply_mode` sync via `chat_conversation_settings` repo
  (`getReplyMode`/`setReplyMode` upsert-merge, legacy-key one-time migration), entity-level muted/disabled final
  UX (labels/i18n, AIProfile state chip + toggles, disabled-partner client-side gate + honest toast, INIT
  `entity_disabled` handled without retries), ChatList disabled rows filtered = social-blocked (`SocialService
  .getBlockedUserIds`, **unchanged — A4**) ∪ disabled entities.
- `722e4b5` — **§9-A19** (see Deviations §1).

**Engine**
- `e032869` — migration `000043`: `sync_devices.synced_tables TEXT NOT NULL DEFAULT '[]'` (per-table backfill
  registry, Q7). `.down.sql` rebuilds without the column.
- `e726f82` — register `character_favorites` + `chat_conversation_settings` (sync models with `time.Time`
  timestamps, query constants with `whereChangedSince` verbatim, `sendLocalChanges` slots after their FK parents,
  `countChanges` lockstep, `handleSyncData` cases with row-LWW by `updated_at` ties→incoming, soft-delete
  tombstone) + per-table initial backfill (unlisted table → `since=0` once, recorded at `handleSyncFinalize`,
  stale sets pruned).
- `bd718c9` — entity-level `is_muted`/`is_disabled` gates (Q8 final): INIT_ENTITY rejection **type-scoped** to
  `is_disabled && entity_type=='ai'` (A3 — `entity_disabled` constant), automation skip (`EnsureBeatRunnerStarted`/
  `EnsureEmotionEngine`), outreach/push delivery gates (muted → deliver WS no push; disabled → drop), `onTick`
  defense-in-depth, inline cache reload after sync apply.

### Phase 5 — B3 entities: typing, AI-only gating, user-entity support, persona rewiring

**Engine**
- `bca92f3` — `entity_type` (+flags) through models/repo/sync/cache/discovery/management/seeder (5-1). `Entity`/
  `EntitySync` round-trip (empty `entity_type` → `'ai'` decode default); `CreateEntity`/`GetEntity`/`ListEntities`
  column lists in lockstep; sync query + apply round-trips them; `config.EntityConfig` carries
  `EntityType`/`IsMuted`/`IsDisabled`; `FETCH_CONFIGURED_ENTITIES` response includes the fields; management
  create accepts optional `entity_type` (default `ai`), update rejects type change (immutable); `claire`→`'ai'`,
  `user`→`'user'` seeded explicitly.
- `138ea3f` — AI-only automation gating (5-2): `shouldAutomate(cfg) = type=='ai' && !is_disabled`; INIT for a user
  entity stays **allowed but chat-only** (no emotion engine, no beat runner, no generation wiring); central
  `EnsureBeatRunnerStarted`/`EnsureEmotionEngine` gate; `onTick` defense-in-depth; user entity with a
  cognition/backend mapping → generation suppressed + warning. Cloud lifecycle-worker gate = **out-of-repo**, for
  the cloud track.
- `982a1a3` — user-entity support (5-3): seeder materializes the default `"You"` profile linked to `user`
  (E1); display-name resolvers (`GetEntityDisplayName`, `getSenderDisplayName`, `participantDisplayNameFor`,
  `primaryParticipantName`) consult the linked profile before falling back to alias/id (E2); `user` protected from
  delete/rename (E3); symmetric RAG (Q13 — a user entity *with* a RAG mapping gets collections/lore indexing like
  an AI; no type branch; RAG init not blocked by the 5-2 generation guard).
- `b68eab2` — **§9-A19** (see Deviations §1).

**App**
- `722e4b5` — §9-A19 favorites→`character_profiles.is_favorite` (paired 000044, sidecar dropped, in-place data
  carry).
- `4db2ab7` — persona identity surface (5-4): screens (PersonaEdit as user-entity editor incl. built-in `user`),
  persona-from-card, MyProfile personas tab, PersonaSwitcher default row renders the real profile name/avatar,
  `{{user}}` macro → profile name, **`personas.ts` shim deleted** (zero imports), orphaned
  `ImpersonationSelectorModal`/`PersonaRow` deleted, O2 `chat_entity_pref_*` sweep, A3 picker audit (user
  entities never offered as chat partners).

### Phase 6 — Verification, records & docs (6-1 / 6-2)

6-1 gates run by the orchestrator are cited verbatim under [Gate outputs](#gate-outputs-verified-by-the-orchestrators-final-6-1-run).
6-2 produces this record, the CHANGELOG wave, `docs/schema-parity.md` 000043/000044 notes, the `docs/TESTING.md`
migration-count correction, the memory-bank entries (both repos), and the planning-summary ticks.

---

## Cross-repo lockstep pairing table (§9-A11)

Each row was authored as one session; local parity was gated only once both sides existed locally (a single-sided
state is expected to diverge until its counterpart lands).

| App commit | Engine commit(s) | Pair content |
|---|---|---|
| `1c7d916` | `b31aad1` | Dump-writer hardening — comment-insensitive + quote-normalized (`§9-A8`/`§9-A13`); engine adds stdout purity (`§9-A15`) |
| `398bee4` | `dccbd29` + `72aed94` | Schema pair — canonical `conversation_messages` + new tables (`000041`) and `entities` flags (`000042`) + §9-A9 label adoption |
| `40dde10` | `7f906aa` | Parity tooling — allowlist registry + comparator semantics (`app`) / truthful committed `go-schema.json` baseline (`engine`) |
| `156de56` | `e032869` | `000043` pair — app drops dead `sync_devices`/`sync_history` mirrors (+ deletes `repositories/sync.ts`, §9-A14) ↔ engine adds `sync_devices.synced_tables` registry |
| `722e4b5` | `b68eab2` | `000044` pair — `character_profiles.is_favorite` column + drop `character_favorites` sidecar both sides (§9-A19) |

> Note the two `000043` migrations are a **numbered pair with deliberately different content** (app = DROP
> dead mirrors; engine = `synced_tables` column) — sanctioned by §9-A14, and so are not "mismatched".

---

## Deviations from the phase docs (with reasoning)

1. **§9-A19 favorites→column rework (mid-phase, user ruling 2026-09-01).** The phase plan (and the B2 commits
   `4deb71b`/`e726f82`) registered `character_favorites` as a synced sidecar table with a watermark triple. The
   user then ruled favorites become **`character_profiles.is_favorite`** and the sidecar is **dropped both sides**
   (paired `000044`). Consequences recorded: row-LWW coupling accepted (a favorite toggle bumps the profile row's
   `updated_at` and rides full-row profile sync; a concurrent profile edit on another device can lose LWW against a
   favorite toggle and vice versa — acceptable because the two rarely race); every toggle re-syncs the full profile
   row; sidecar `created_at DESC` recency ordering is lost (no consumer needed it — the Characters screen builds a
   membership `Set`). **Supersedes Q5.** The favorites registration added in 4-1/4-2 was **removed again** by
   `722e4b5`/`b68eab2` (upload list, `TABLE_ORDER`, PK-registry entry, backfill registry, FK-diagnostics, apply
   cases, models/repos both sides). Allowlist unchanged (favorites was a matched table, never allowlisted; the
   identical-ALTER pair keeps `character_profiles` byte-identical).
2. **Engine backfill scoped to the newly-registered tables only** — not "all fetchable tables". Q7's wording
   ("unlisted tables send with `since = 0` once") could be read as a full re-upload of every syncable table for a
   new device; the implementation scopes the initial backfill to the tables the phase actually **registers**
   (originally `character_favorites` + `chat_conversation_settings`, now only `chat_conversation_settings` after
   A19). **Reasoning:** a global first-sync re-upload would pull `character_image` BLOBs (and every other table)
   even for devices that already synced that data — a large, slow, unnecessary transfer. LWW makes re-sends
   harmless, so the set exists purely to *avoid* redundant full re-uploads.
3. **`assertNotDisabled` kept-but-rewritten, not retired.** 1-2's change-set list said to retire
   `setDisabledOverride`/`isSessionDisabled` in favor of entity-flag checks. In implementation the
   `assertNotDisabled` guard was **kept** but rewritten to consult the entity-level `is_disabled` flag (rather than
   the old conversation-settings `'blocked'`/override map). **Reasoning:** the outbound-send assert is defense-in-
   depth the send path still wants; rewriting it to read the entity flag preserves the guard while removing the
   stale source-of-truth. (The override map/`setDisabledOverride`/`isSessionDisabled` themselves were retired.)
4. **ChatListScreen full-render test env limitation (RN 0.86 node-env crash — predicate tests instead).** The 3-1
   badge-seam/sync-applied recount tests could not be written as full `ChatListScreen` renders in the Jest node
   environment (RN 0.86 throws under the node test env for this screen tree). They were written as **predicate /
   seam-level** unit tests on the derived-unread helpers and handlers instead. **Reasoning:** honest limitation,
   not a scope cut; the on-device smoke list carries the real render verification (see [On-device smoke](#on-device-smoke--hand-off-not-executed)).
5. **`nodeSide.test.ts` parallelism flake (pre-existing, verified at baseline).** This suite is the known
   better-sqlite3 cross-worker contamination trigger; when run under the full parallel unit sweep it can flake, but
   it passes **23/23 in isolation**. Verified at baseline and again in the final run; documented here so it is not
   mistaken for a Phase-2 regression (see [Gate outputs](#gate-outputs-verified-by-the-orchestrators-final-6-1-run)).
6. **2-2's (a)/(c)/(d) tests landed as regression guards, not red-first.** The four-engine-test TDD order
   predicted all four were red. In practice only **(b)** (the update-merge changes only the four fields) was
   genuinely red — because 2-1 had **already fixed** the insert path (it persisted `reply_to_message_id` +
   reactions and stopped re-stamping timestamps), so (a) insert-carries-reply/reactions, (c) older `updated_at`
   loses, and (d) timestamp-preserved were green the moment the rows carried the columns. They were kept as
   regression guards (correct, they pin the contract) — recorded so the "TDD-red-first" claim for that task is
   understood precisely.
7. **Grep-gate interpretation.** The grep sweeps are scalar-zero for the exact strings named in the doc, but a few
   are *literal/marker-only* matches by design: `unread_count` + `chat_entity_pref_` + `sync_devices|sync_history`
   resolve only to historical migration/doc comments, the Q14 sweeper's own prefix literal (by design), and
   engine-registry prose. `createSyncDevice|createSyncHistory` → zero. `SocialService.getBlockedUserIds` **intact**
   (A4 — social blocking is a separate feature from entity disable). Engine models carry
   `reply_to_message_id`/`reactions_json`/`is_pinned`/`is_read` wire keys (spot-check).
8. **Engine GitNexus index was 4 commits stale → refreshed first, per plan.** `npx gitnexus analyze` ran in the
   engine repo **before** any Phase-2 work (the plan's Q16/1-1 prerequisite), so the engine index refresh was done
   FIRST as directed; both indexes were then re-refreshed post-work (app 7113→7188 symbols / 14425→14524
   relationships; engine 12510→12861 symbols / 36386→37603 relationships).

---

## The extended dev-DB-wipe note

Devices that ran **any pre-Phase-2 build of the `senju-design-updates-rebase` branch** — i.e. one carrying the old
`000041` revision, the old `chat_conversation_settings` shape (`unread_count`/`muted`/`blocked`), the old `personas`
table, or pre-`000042` shim entities — need a **one-time dev DB wipe**. The edited `000041`/`000042` never re-run on
a device that already applied their earlier revisions (applied migrations are immutable on-device), and the Phase-1
app `000043` drops `sync_devices`/`sync_history` while the engine `000043` adds `synced_tables` — devices that
**already synced** under any pre-Phase-2 build keep orphaned empty `sync_devices`/`sync_history` tables (and, for
pre-A19 builds, a `character_favorites` sidecar) until wiped; they are harmless but linger.

**`000044` additionally carries favorites in-place for devices on the 41–43 state:** for devices already at the
`000041`–`000043` post-rebase state (i.e. the new consolidated schema but pre-`000044`), migration `000044` is an
`ALTER TABLE character_profiles ADD COLUMN is_favorite …` + sidecar table drop + `INSERT … SELECT` in-place data
carry (no wipe required for these — they were never exposed to a pre-Phase-2 branch). Only devices from a
**pre-Phase-2** build (old `000041`/old settings/personas) need the full wipe. Dev-only exposure; documented in the
migration headers and the `CHANGELOG.md` dev-build hint.

---

## Standing decisions consumed

**Q1–Q16 (contract §2, final rulings):**
- Q1 — read flag = single `is_read` column; unread derived.
- Q2 — read-by-AI: no schema; deferred.
- Q3 — engine field-scoped merge (action/read fields only); inbound timestamps preserved; no new WS events.
- Q4 — joint canonical `conversation_messages` rebuild (`_new`-table; labels per A1→A9).
- Q5 — sidecar `character_favorites` (watermark triple, `favorited_at` dropped) + centralized PK registry. **Superseded by A19.**
- Q6 — `chat_conversation_settings.entity_id` = the POV entity.
- Q7 — per-table initial backfill (per-device exchanged-table set), not a global full resync.
- Q8 — muted/disabled move onto the entity, global per entity (final ruling 2026-08-29).
- Q9 — `entity_type TEXT ... DEFAULT 'ai'` + backfill; validated in code, no SQL CHECK.
- Q10 — user entities link a `character_profiles` row; no new identity columns; personas↔entity conversion skipped.
- Q11 — engine seeder materializes the default `"You"` profile for `user`.
- Q12 — parity allowlist (versioned, removal-only); never edit shipped migrations 1–40.
- Q13 — RAG symmetric iff a RAG module is configured for the entity.
- Q14 — legacy "chat as AI character" prefs: silent fallback + one-time sweep; no convert-offer.
- Q15 — migration numbering (edited app `000041` ↔ engine `000041`; paired `000042`).
- Q16 — engine branch `feat/engine-track-phase2` off `main`; no merges during Phase 2; local parity = authoritative.

**§9 amendments A1–A19 (2026-08-31 rounds 2 + 3, plus A19 on 2026-09-01):**
- A1 — timestamp labels stay per-side. **Superseded by A9.**
- A2 — `is_read` per-record and born 0; app unread derivation scoped `entity_id = own POV`.
- A3 — disabled-INIT gate type-scoped (`is_disabled && entity_type=='ai'`).
- A4 — social blocking and entity disable stay separate (`SocialService.getBlockedUserIds` untouched).
- A5 — consumer rewiring moves into Phase 1 (no dead UI window).
- A6 — `chat_conversation_settings.entity_id` = POV requires call-site rewiring (all writers pass POV id).
- A7 — PK registry fixes a pre-existing `lifecycle_state` asymmetry (send path `id` → standardize on `entity_id`); deliberate bugfix.
- A8 — comparator/dump writers become comment-insensitive (string-literal-aware comment stripper).
- A9 — full label reconciliation sweep: app adopts engine `TIMESTAMP`/`DATETIME` labels; `conversation_messages` never allowlisted; other real drifts reconciled app-side.
- A10 — `userEntities` repo + `personas.ts` shim pulled into Phase 1 (no stub debt, no dead window).
- A11 — lockstep authoring workflow (both sides of a schema pair in one session).
- A12 — 2-3 scope reduced: AI-authored reactions deferred; keep cognition-side awareness only.
- A13 — identifier-quote normalization joins A8 (strip header-name quotes).
- A14 — dead sync-infra tables dropped app-side; `000043` pair re-scoped (app DROP vs engine `synced_tables`); allowlist end state = 3 Go-only infra entries.
- A15 — engine dump stdout purity (pure JSON on stdout).
- A16 — `personas.ts` shim surface completed (adds `getPersona`/`PersonaRecord`).
- A17 — 1-4 parity-doc references corrected (the doc DOES have a "Current Divergence State" heading; records 10 cosmetic drifts).
- A18 — residual findings accepted as-is (Phase-1 change set stays ONE green commit; 000041's dropped FK/defaults get no extra audit gate).
- A19 — **favorites become `character_profiles.is_favorite`; the `character_favorites` sidecar is dropped both sides (paired 000044); Q5 superseded.** Row-LWW coupling accepted (see Deviations §1).

---

## What was intentionally NOT fixed / deferred ledger

- **Read-by-AI design (Q2)** — semantics (AI noticing messages) live in engine lifecycle/reply-mode code; no schema.
- **AI-authored reactions (§9-A12)** — backend does not emit reaction effects yet; producer + consumption mechanism
  decided when the backend gains the capability. 2-3 kept cognition-side awareness + a design sketch.
- **Cloud lifecycle-worker entity gate (5-2 §D)** — `NewEntityBeatRunner`/`PersistOutreachMessage` consumers in the
  cloud lifecycle worker need the same `shouldAutomate` gate; flagged to the **cloud track** (own ticket).
- **Postgres cloud path check** — the cloud-track Postgres path is not re-verified here; flagged to cloud track.
- **Backend-concept items** — creator ids on listings, notification write side, marketplace/wallet real backend,
  per-item liked-state/count reads, follower graph, UPGRADE url → `20-Backend-Concept-Marketplace-Profile.md`.
- **Cosmetic drifts (now reconciled)** — the §9-A8/A9/A13 sweep reconciled the former cosmetic-drift category;
  nothing remains pending. (Reconciliation was opportunistic per Q12. Count note: the contract §8 said "9"; the
  parity doc recorded "10" post-reply-restore per §9-A17 — both reconciled, no longer in the divergence set.)
- **Personas↔entity conversion of pre-existing rows (Q10)** — skipped; dev-only exposure, wipe note covers.
- **Known test/env gaps** — `nodeSide.test.ts` parallelism flake (pre-existing, isolation-clean); ChatListScreen
  full-render env limitation (predicate tests instead, on-device smoke carries verification); the `e2e/.maestro`
  stale artifact (pre-existing, outside jest gates, flagged not fixed in Phase 1).
- **`is_read` read-receipts for AI-authored/synced engine rows** — read-by-AI deferred (A2/Q2), so no engine→app
  read state exists by design.
- **2026-09-07 — remove transitional legacy sweeps** — `sweepLegacyEntityPrefs` (ChatPreferencesService) +
  `LEGACY_REPLY_MODE_PREFIX` fallback in `getReplyMode` + their tests (Q14/A17 migration window closes once the
  team is on the new build).

---

## Gate outputs

### Verified by the orchestrator's final 6-1 run

| Gate | Result |
|---|---|
| Engine `go build ./...` / `go vet ./...` / `go test ./...` | **ALL green** (incl. the migration roll-forward/rollback suite for `000041`/`000042`/`000043`) |
| Engine `go run . dump-schema` stdout | **pure JSON, starts with `[`** (§9-A15) |
| App `npx tsc --noEmit` | **0 errors** |
| App unit (`npx jest --selectProjects unit`) | **112 suites / 961 tests** — `nodeSide.test.ts` has a **pre-existing** better-sqlite3 parallelism flake; passes **23/23 in isolation**, verified at baseline |
| App integration (`npx jest --selectProjects integration`) | **10 suites / 50 passed + 1 skipped** — the skip is the pre-existing integration skip, NOT `entitySessionInitRecovery` (that suite is green) |
| App `entitySessionInitRecovery` | **green** |
| **PARITY (authoritative local compare)** | **55/55 matching · RN-only 0 · different-SQL 0 · Go-only 3 (all allowlisted: `device_push_tokens`, `sync_devices`, `sync_history`) · un-allowlisted 0 · stale 0 · exit 0** |
| GitNexus (both repos) | refreshed post-work; engine index refresh done **first** per plan (Q16/1-1); no stale warnings |

### Grep sweeps (app `src/`, from 6-1)

- `CLIENT_ONLY` / `chat_last_read_` / `getKeyLastRead` / `personas` repo imports / `ImpersonationSelectorModal` /
  `PersonaRow` → **zero**.
- `createSyncDevice | createSyncHistory` → **zero**.
- `unread_count` + `chat_entity_pref_` + `sync_devices | sync_history` → only historical migration/doc comments,
  the Q14 sweeper's own prefix literal (by design), and engine-registry prose — **zero behavioral references**.
- `SocialService.getBlockedUserIds` → **INTACT** (A4).
- Engine models carry `reply_to_message_id` / `reactions_json` / `is_pinned` / `is_read` wire keys (spot-check).

---

## On-device smoke (hand-off, NOT EXECUTED)

> Reproduced verbatim from 6-1 §"Cross-repo integration smoke" as the hand-off checklist. **NOT EXECUTED** — this
> phase was code/CI-gated only; a device build + the checklist are the on-device verification.

1. Fresh install (or wiped dev DB) + engine branch build: seeder delivers `user` entity + "You" profile.
2. Chat round-trip: create AI partner → chat → react/pin a message → second device (or wipe+resync) sees
   reactions/pin/read-state via sync.
3. Unread derivation: partner message while app closed → badge appears after sync (the old bug); open → clears;
   "mark unread" → exactly 1.
4. Copy-model integrity (A2): after a sync round-trip, an engine-authored partner message appears **exactly once** in
   ChatDetail and counts **exactly once** in unread (entity-scoped queries; catches the per-side-uuid duplication
   vector — WS copy + synced engine copy).
5. Reply-mode toggle in conversation menu → survives reinstall via sync.
6. Mute partner → outreach arrives in-chat, no push. Disable partner → chat blocked (engine `entity_disabled`),
   AIProfile can re-enable.
7. Personas: create from scratch + from card; switch "chatting as"; conversations per-persona; edit built-in "You"
   persona; delete custom persona (built-in delete refused).
8. Favorites + settings survive device re-pair (per-table backfill: second device receives full tables on first
   post-upgrade sync).

---

## CI parity red-by-design (Q16) + coordinated mainline merge order

The parity CI workflow pins the engine checkout to **`main`**. During Phase 2 the engine lived on
`feat/engine-track-phase2` and was **not** merged to `main`, so the engine `main` schema differed from the pairing
schema — the CI parity check was **red by design** throughout. **Do not "fix" it**; **local parity compare is the
authoritative gate** (and confirmed 55/55 + 3 Go-only, exit 0).

**Coordinated merge order (once the user opens the window):**
1. **Engine first:** merge `feat/engine-track-phase2` → engine `main`.
2. **App second:** merge `senju-design-updates-rebase` (onto the now-updated engine `main`).

Merging the engine first means the parity CI pins an engine `main` that already carries the Phase-2 schema, so CI
turns green for the app mainline merge. The app branch must not land before the engine branch.

---

## Pending coordination

- **Senju origin force-push window (unchanged):** the coordinated force-push of HER `senju-design-updates` origin
  branch (local at the replayed tip, origin still `5204fb5`) remains pending the agreed window — **do not push**.
- **Cloud-track ticket:** lifecycle-worker entity gate + Postgres cloud-path check.
- **On-device smoke list** (above) needs a device build + manual pass.

---

## Verification (6-2 checklist)

- [x] Record doc + outlines written; CHANGELOG/README/docs/memory bank updated (both repos)
- [x] Summary checkboxes ticked; hand-off delivered
- [ ] Final `gitnexus_detect_changes()` on the docs commits (both repos)
- [ ] On-device smoke list executed (needs a device build)
