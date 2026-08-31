# 21 — Engine Contract: Phase 2 Rulings (Message Actions, Preferences Sync, Entity Typing)

> Decision log for the engine track (Phase 2). Produced by the senior-dev Q&A round on 2026-08-29,
> grounded in six code-expert research reports across `harmony-ai-app` (branch `senju-design-updates-rebase`)
> and `harmony-link-private` (Go engine, `main` @ `3cd8131`). Supersedes the open questions O1/O2/O12/O13
> from `summary.md` and the `[Q]` markers in `02-Followup-Stub-Plan.md` Track B.
> Execution plan: `.current_work/senju-engine-phase2/` (binding; this doc is its contract base).

## 1. Verified findings (new facts this round)

1. **`reply_to_message_id` is RESTORED** (user FYI 2026-08-29): `000041` adds the column + `idx_conversation_messages_reply_to`
   ("dormant — UI gated off", `src/constants/chatFeatures.ts`); wired through `models.ts:513`, repo
   (`conversation_messages.ts:21-43,378-380`), send payload (`EntitySessionService.ts:991,1005-1006`), and
   ChatDetail rendering. The engine currently **silently drops** the field (no `DisallowUnknownFields`, fixed
   19-column INSERT). Phase 2 makes it first-class on both sides. Insert-time only — never in the update-merge set.
2. **BLOB/base64 asymmetry is documented**: `.current_work/test-framework-overhaul/schema-parity-findings.md:31-42`
   (audio_data/image_data TEXT vs BLOB, "serious", open triage) + `adapter-compat-findings.md` §2 (RN driver
   returns BLOB as base64). Ruling: canonical label = `TEXT` (base64) for binary columns; `BOOLEAN` → `INTEGER`
   for boolean-ish columns (affinity-equivalent, no data risk). Closes the old triage item.
3. **Parity ground truth (fresh compare, 2026-08-29)**: `conversation_messages` divergence is NOT just the D3
   columns — base texts differ deeply (engine `content DEFAULT ''`, `message_type DEFAULT 'text'`, `BLOB` blobs,
   `BOOLEAN` flags, `TIMESTAMP/DATETIME` labels with defaults, different `interaction_id` position, engine-only FK
   clause). Remaining baseline = 9 other cosmetic drifts (mostly inline comments) + `device_push_tokens` Go-only.
   The **committed Go baseline `schema/go-schema.json` is stale** (missing `lifecycle_state` + `device_push_tokens`)
   and must be regenerated. The comparator (`scripts/compare-schemas.py`) is exact-string, **no allowlist** — the
   CI gate cannot go green with the baseline present.
4. **Engine sync for `conversation_messages` is INSERT-ONLY** (`eventserver/synchronization.go:1364-1386`) and the
   repo stamps `time.Now()` on insert, discarding inbound timestamps (`database/repository/conversation/messages.go:80,99-100`).
5. **Default-persona mechanism is incomplete on both sides** (gap lists §6): engine seeds `user` with **no profile**
   (`config/db/init.go:284-291`); app has **no editor** for the built-in `user`; `{{user}}` macro substitutes the
   literal string `"user"` (`CreateAIScreen.tsx:668-670`); engine display-name resolvers fall back to raw entity IDs.
6. **Engine automations are activation-based, not enumeration-based**: lifecycle/emotion/proactivity start only at
   INIT_ENTITY. AI-only gating = 7 activation sites + 2 choke points + defense-in-depth (full checklist in §7).

## 2. Rulings (Q1–Q16, final)

| # | Ruling |
|---|---|
| Q1 | Read-flag = **single column** `conversation_messages.is_read INTEGER NOT NULL DEFAULT 0`. Unread badges/dividers derived. No `read_at` (YAGNI; addable via paired ALTER). |
| Q2 | **Read-by-AI: no schema.** Semantics (AI noticing messages) live in engine lifecycle/reply-mode code. Deferred. |
| Q3 | Engine gets a **field-scoped merge** for existing message rows: only `reactions_json`, `is_pinned`, `is_read`, `updated_at` updatable via sync; content immutable. **Inbound timestamps preserved** (stop `time.Now()` re-stamping on sync-applied rows). No new WS events. **NEW engine behavior:** cognition/lifecycle may read reactions; the AI may author its own reaction on a message via the update path (`updateMessageAudio` precedent). |
| Q4 | **Joint canonical rebuild** of `conversation_messages` (byte-identical both sides — timestamp labels excepted, amended by A1; `_new`-table pattern). Canonical labels: app-flavored — `TEXT` for audio/image data (base64), `INTEGER` for boolean-ish, no engine defaults, no engine-only FK clause. Final column set incl. `reply_to_message_id` + `is_read` (§3). |
| Q5 | `character_favorites`: keep `profile_id TEXT PRIMARY KEY` + watermark triple; drop `favorited_at` (`created_at` subsumes). **Centralized PK registry** in the app: replace the ~6 scattered pkField sites (`sync.ts:364-375` + `SyncService.ts:792,903,1165,1252,1269,1286`) with one shared table→pk-column map. |
| Q6 | `chat_conversation_settings.entity_id` = **the POV entity** (the user-entity persona the conversation is chatted as; NULL for groups) — never the partner. Partner resolution happens via participant-key derivation where needed. |
| Q7 | **Per-table initial backfill** (NOT global full resync): engine tracks per-device exchanged-table set (`sync_devices.synced_tables` JSON); unlisted tables send with `since = 0` once (size estimate likewise); recorded at SYNC_FINALIZE. App mirror-image via a local per-table initial-upload set (AsyncStorage, keyed by sync source). LWW apply makes re-sends harmless. |
| Q8 | **AMENDED (final ruling 2026-08-29): `muted`/`disabled` move OFF the conversation settings onto the entity itself, global per entity.** `entities.is_disabled` = entity completely off: engine rejects INIT_ENTITY for sessions it participates in (new error `entity_disabled`), no outreach delivery, lifecycle/emotion automations skip it (shares the AI-only gating sites). `entities.is_muted` = chat/behavior normal, notifications (push) suppressed; app-side O10 badge suppression keys off the incoming `sender_entity_id`. `chat_conversation_settings` loses `muted` + `blocked` (the `'blocked'`-stores-`'disabled'` hack dies); final shape in §3. No data backfill (dev-only exposure; wipe note covers). |
| Q9 | `entities.entity_type TEXT NOT NULL DEFAULT 'ai'`, values `'ai' \| 'user'`, backfill `UPDATE entities SET entity_type='user' WHERE character_profile_id IS NULL` (000028 pattern). Validated in Go/TS code only — **no SQL CHECK** (no repo precedent). |
| Q10 | **User entities link a `character_profiles` row** (identity lives on the profile: name/description/personality; avatar = `character_image` row). From-scratch creates a minimal profile; from-card copies per P1. No new entity identity columns. Engine display-name resolvers consult the linked profile. **No handling of pre-existing entities** beyond the Q9 backfill; personas→entity conversion **skipped** (dev-only exposure; wipe note). |
| Q11 | **Engine seeder materializes the default profile** for `user` (name `"You"`, minimal fields), linked to the entity, seeded once (empty-DB gate), syncs down like any profile, editable app-side, never deletable/renamable (entity id `'user'` is load-bearing). Gap lists §6. |
| Q12 | **Parity allowlist**: `compare-schemas.py` gains a documented, versioned allowlist (the 9 remaining cosmetic drifts + `device_push_tokens` Go-only). Gate = green iff diff ⊆ allowlist. Never edit shipped migrations 1–40. Regenerate the stale committed Go baseline. `conversation_messages` leaves the drift list via Q4; reconcile others only opportunistically. |
| Q13 | **RAG is symmetric**: user entities get collections/lore indexing/`rag_reindex_required` exactly like AI entities **iff a RAG module is configured for that entity** (default `user` = STT-only = RAG-less until configured). No new app UI for this. |
| Q14 | O2/P4 legacy "chat as AI character" prefs: keep silent fallback (`resolvePersonaId` already sanitizes) + one-time sweep of dead `chat_entity_pref_*` AsyncStorage keys. **No convert-offer.** Persona-from-card ships as new UI (independent of O2). |
| Q15 | **Migration numbering (2 pairs)**: edited app `000041` (canonical rebuild + favorites + settings final, personas removed) ↔ engine `000041` (mirror; column set identical — timestamp-label exception A1); paired app+engine `000042` = `entities` ALTERs (`entity_type`, `is_muted`, `is_disabled`) + Q9 backfill. Engine `.down.sql` mandatory (guard bans DROP COLUMN — downs use rebuilds). App forward-only. |
| Q16 | Engine branch `feat/engine-track-phase2` off `main`; app continues on `senju-design-updates-rebase`; **no merges to main during Phase 2** → parity CI (pins engine `main`) stays red by design; **local parity compare is the authoritative gate**. Engine GitNexus re-index before work starts (currently 4 commits stale). |

## 3. Schema contracts (final shapes)

### 3.1 `conversation_messages` — canonical DDL (column set/order identical both sides; Q4, amended by A1)

```sql
CREATE TABLE "conversation_messages" ( id TEXT PRIMARY KEY NOT NULL, entity_id TEXT NOT NULL,
  sender_entity_id TEXT NOT NULL, interaction_id TEXT, content TEXT NOT NULL, audio_duration REAL,
  message_type TEXT NOT NULL, audio_data TEXT, audio_mime_type TEXT, image_data TEXT,
  image_mime_type TEXT, vl_model TEXT, vl_model_interpretation TEXT,
  emotional_state_bits INTEGER NOT NULL DEFAULT 0, is_recon_followup INTEGER NOT NULL DEFAULT 0,
  is_edited INTEGER NOT NULL DEFAULT 0, edit_of_message_id TEXT, reply_to_message_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, reactions_json TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0, is_read INTEGER NOT NULL DEFAULT 0 )
```
Indexes (both sides): `idx_conversation_messages_entity(entity_id)`, `idx_conversation_messages_interaction_id(interaction_id)`,
`idx_conversation_messages_pinned(is_pinned)`, `idx_conversation_messages_reply_to(reply_to_message_id)`.
Delivered via `_new`-table rebuild (data carried by INSERT SELECT; per-side source column lists). App column
order/NOT NULLs; engine loses its `content`/`message_type` defaults, FK clause, BLOB/BOOLEAN labels.
**AMENDED (A1, 2026-08-31): the engine KEEPS its `TIMESTAMP`/`DATETIME` labels on `created_at`/`updated_at`/
`deleted_at`; the app keeps `TEXT`.** Reason: the Go driver's Scan dispatch depends on the declared type
(TIMESTAMP/DATETIME → `time.Time`, TEXT → string — relabeling breaks every engine read with
`unsupported Scan … string into time.Time`), while RN reads by storage class (labels irrelevant); the app's TEXT
choice is the 000025 remediation (timestamp DEFAULTs once produced space-format values that iOS JSC and the sync
wire cannot parse). The DDL above defines the canonical COLUMN SET/ORDER only; the timestamp-label drift joins the
parity allowlist (see `docs/schema-parity.md` "Timestamp Column Labels"). App-side `is_read` joins the
booleanFields sync map (`sync.ts:193`).
**SUPERSEDED by §9-A9: the app rebuild adopts the ENGINE labels — this table goes byte-identical (after comment
normalization, §9-A8) and never enters the allowlist.**

### 3.2 `character_favorites` (Q5)

```sql
CREATE TABLE character_favorites ( profile_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, deleted_at TIMESTAMP )
```

### 3.3 `chat_conversation_settings` (Q6 + Q8 final)

```sql
CREATE TABLE chat_conversation_settings ( participant_key TEXT PRIMARY KEY, entity_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  reply_mode TEXT NOT NULL DEFAULT 'realistic',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, deleted_at TIMESTAMP )
```
`entity_id` = POV entity (Q6). `unread_count`, `muted`, `blocked` all gone (derived unread / entity-level flags).
App PK-registry entries: `chat_conversation_settings → participant_key`, `character_favorites → profile_id`.

### 3.4 `entities` — paired `000042` ALTERs (same order both sides, Q8/Q9)

```sql
ALTER TABLE entities ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'ai';
ALTER TABLE entities ADD COLUMN is_muted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entities ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0;
UPDATE entities SET entity_type = 'user' WHERE character_profile_id IS NULL;
```
(Backfill runs on both sides; engine `.down.sql` = rebuild without the three columns.)

## 4. Sync contracts

1. **Registration (both new tables)**: watermark triple + soft deletes; engine 7-step recipe (query constant with
   `whereChangedSince` verbatim, FK-ordered `sendLocalChanges` slot, `countChanges` estimate lockstep,
   `handleSyncData` case, Sync model + `convertToSyncModel`, cleanup scope); app = upload list (`SyncService.ts:1113-1153`),
   `TABLE_ORDER` (:851-886), cleanup list (:1492-1525), PK registry, boolean map (none needed — all INTEGER columns
   already 0/1-safe; add only if a BOOLEAN label sneaks in).
2. **LWW policy**: row-level by `updated_at`, ties → incoming (provider-config precedent) for both new tables;
   delete = soft-delete tombstone via the shared predicate.
3. **Per-table initial backfill** (Q7): as specced in the ruling; the exchanged-table set is an optimization —
   LWW makes duplicates harmless.
4. **Message field-merge** (Q3): engine apply switch gains an update branch for existing message rows restricted
   to `reactions_json`, `is_pinned`, `is_read`, `updated_at`; insert path persists `reply_to_message_id`;
   inbound timestamps preserved verbatim (echo-safe: equal-timestamp re-apply is a no-op).

## 5. Engine behavior contracts

1. **entity_type plumbing**: `models.Entity`/`EntitySync` + `queryGetChangedEntities` + `CreateEntity`/`GetEntity`/
   `ListEntities` column lists in lockstep; `config.EntityConfig` + `LoadAllEntities` carry type + flags;
   `FETCH_CONFIGURED_ENTITIES` response includes `entity_type`, `is_muted`, `is_disabled`.
2. **AI-only gating** (Q9): sites = INIT_ENTITY handler fresh+resume (`eventprocessor.go:196-199,726-728` area),
   `EnsureEmotionEngine` (central + call sites :207/:739), `EnsureBeatRunnerStarted` (central :108 + call sites
   :251/:782), defense-in-depth `onTick` (`runner.go:255-258`). Enumeration/review sites carry the column but stay
   type-agnostic (cache rebuilds, `cmd/run.go:254-261`, post-sync refresh `synchronization.go:1514-1524`).
   **OUT-OF-REPO flag**: the cloud lifecycle-worker consumes `NewEntityBeatRunner` and needs the same gate (cloud track).
3. **Disabled/muted gates** (Q8): INIT_ENTITY rejects `is_disabled` entities with `entity_disabled`; outreach
   delivery (`session.go:366-451`) skips disabled targets; push path (:417-449) skips muted; beat/emotion activation
   skips disabled. App treats `entity_disabled` as a distinct session error (UI shows enable-path messaging).
4. **Reaction awareness** (Q3): reactions exposed to the cognition pipeline (prompt/beat context); AI-authored
   reactions update `reactions_json` via the field-merge path (pattern: `updateMessageAudio`, `cognition.go:521-557`).
5. **User-entity support** (Q10/Q11/Q13): seeder default profile "You"; display-name resolvers
   (`getSenderDisplayName`/`participantDisplayNameFor`/`GetEntityDisplayName`) consult the linked profile;
   `user` protected from delete/rename in management routes; RAG module init symmetric when configured
   (`modules/rag.go:54-168` needs no entity-type branch — only the mapping decides).

## 6. Default-persona gap lists (verified)

**Engine:** E1 seeder creates default profile + links `user` (`config/db/init.go:284-332` region);
E2 display-name resolution via profile; E3 management guards (no delete/rename of `user`).

**App:** A1 `PersonaEditScreen` becomes user-entity editor incl. built-in `user` (delete disabled for `user`;
rename = profile name, entity id frozen); A2 MyProfile personas tab lists `entity_type='user'` entities;
A3 `PersonaSwitcherModal` default row shows real profile name/avatar; A4 `{{user}}` macro resolves profile name;
A5 persona avatar → `character_image` on the linked profile; A6 delete orphaned `ImpersonationSelectorModal` +
`PersonaRow.tsx`; A7 impersonation prefs validate against user entities.

## 7. Logistics (Q16)

Branches as ruled; per-commit gates: app = `npx tsc --noEmit` + `npm test` (+ migration snapshots when schema
touched) ; engine = `go build ./...` + `go test ./...` (incl. migration roll-forward/rollback suite); local parity
compare after any schema change (`npm run schema:dump` + `go run . dump-schema | tail -n +3` + `python
scripts/compare-schemas.py` — the engine dump emits 2 header lines on this machine; assert the stripped output
starts with `[` before piping onward). GitNexus protocol both repos. Engine index refresh before start. Dev-DB-wipe note
(extended: old-000041 devices also lack the canonical rebuild + entity columns until wiped).

## 8. Deferred (not Phase 2)

- Read-by-AI semantics design (engine-internal; Q2).
- Backend-concept items (creator ids, notification write side, marketplace/wallet) → `20-Backend-Concept`.
- Cloud lifecycle-worker entity gate + Postgres cloud-path verification (flagged to cloud track).
- Reconciliation of the 9 allowlisted cosmetic drifts (opportunistic only).

## 9. Amendments (2026-08-31, senju-engine-phase2 plan review)

Senior-dev rulings from the plan-review round (evidence: code-expert reports in both repos; findings embedded in
the phase docs). These amend — not replace — the Q1–Q16 rulings above. Note: the ids A1–A7 below are DISTINCT from
the §6 default-persona gap-list ids (also A1–A7, cited in doc 5-4); phase docs write `§9-A#` where ambiguity is
possible.
**Round 3 (A13–A18, 2026-08-31):** rulings from the second validation pass — the plan was checked line-by-line
against both codebases (live engine dump via `go run . dump-schema` + live comparator run against the committed
baselines). ~40 spot-checked line references held; the items below fix what did not.

| # | Amendment |
|---|---|
| A1 | **Timestamp labels stay per-side (engine `TIMESTAMP`/`DATETIME`, app `TEXT`).** Q4's byte-identical bar applies to the column set/order/names — NOT the timestamp labels. Go's go-sqlite3 Scan dispatches on the declared type (TIMESTAMP/DATETIME → `time.Time`; TEXT → string → runtime scan errors), RN is label-agnostic; the app's TEXT labels are the 000025/`c62c7ca` remediation (timestamp DEFAULTs produced space-format values breaking iOS `new Date` + the sync wire). `conversation_messages` joins the parity allowlist for exactly this drift. Documented in `docs/schema-parity.md` ("Timestamp Column Labels"). Invariant: no `DEFAULT CURRENT_TIMESTAMP`-reliance on app date columns, ever. **SUPERSEDED by A9 below (2026-08-31 plan-review round 2): the app adopts the ENGINE labels in the Phase-1 rebuilds; `conversation_messages` never enters the allowlist.** |
| A2 | **`is_read` is per-record and born 0.** Verified copy model: each entity keeps its own record — app rows carry `entity_id` = POV persona (app mints its own uuidv7 even for WS-received partner messages, `EntitySessionService.ts:1965-1995`); engine rows carry `entity_id` = engine entity; user messages share one id across sides, AI messages have per-side ids. `is_read` on a record = "the counterpart has read it" — own messages stay 0, only the app's read action writes 1, the engine NEVER stamps 1 (2-1 §4's "born read" is retracted). App unread derivation MUST scope `cm.entity_id = own POV` (engine-perspective copies sync in under different ids and join the same `interaction_id`; unscoped queries double-count/double-render). |
| A3 | **Disabled-INIT gate is type-scoped.** `entity_disabled` INIT rejection applies only when the INIT'd session entity `is_disabled && entity_type == 'ai'`. User entities are valid INIT targets (persona chat; resume integration tests INIT `"user"`) and 5-2 keeps their INIT allowed-but-chat-only. App-side guard: user entities can never be muted/disabled targets nor visible as chat-partner options. |
| A4 | **Social blocking and entity disable stay separate.** `SocialService.getBlockedUserIds` (cloud-user social graph; ChatList/Discover/Characters filters) is untouched by Phase 2; ChatList filtering becomes social-blocked ∪ disabled-entities, never a replacement. All `blocked` greps are scoped to the `chat_conversation_settings` concept only. |
| A5 | **Consumer rewiring moves into Phase 1.** Mute/disable→entity-flag and the derived-unread core land with the 1-2/1-3 app change set (one commit) so no UI goes dark mid-phase. `DisabledAIsScreen` is KEPT and rewired to disabled AI entities (it is the real disabled management UI — `AccountSettingsScreen.tsx:72` → `AppNavigator.tsx:206`; the earlier "ArchivedChats disabled filter" reference was wrong). **AMENDED by A10 below: the Phase-1 change set additionally lands the `userEntities` repo + `personas.ts` re-export shim, so persona UI stays live through all phases (no dead window).** |
| A6 | **`chat_conversation_settings.entity_id` = POV (Q6) requires call-site rewiring** — today every setter receives the PARTNER id (`ChatListScreen.tsx:713-714`, `ChatDetailScreen.tsx:1375`, `EntitySessionService.ts:1899`). All writers pass the POV entity id from Phase 1 on. |
| A7 | **PK registry fixes a pre-existing lifecycle_state asymmetry** (send path keyed `id`, apply path `entity_id` — `SyncService.ts:792/903/1165` vs `:1252/1269/1286`): the registry standardizes on `entity_id`; the send-path change is a deliberate bugfix, affected tests updated — not "behavior-neutral". |
| A8 | **Comparator becomes comment-insensitive (dump-writer hardening).** Both dump writers strip SQL comments BEFORE whitespace collapse: engine `normalizeSQL` (`cmd/dump_schema.go`) + app `normalizeSql` (`src/database/__test_utils__/dumpSchema.ts`) — string-literal-aware (`--` line + `/* */` block; a `'` quoting state machine must protect string bodies containing `--`). Rationale (verified 2026-08-31): sqlite_master text reaches the comparator already whitespace-collapsed, so inline comments have NO recoverable terminator there — a comparator-side stripper truncates the engine's `lifecycle_state` DDL at the first comment. Cross-impl fixture tests in both repos assert identical outputs for identical inputs (incl. quotes containing `--`, block comments, no-trailing-newline cases). Comment-only drifts cease to exist as a category; the allowlist tracks real divergences only. |
| A9 | **A1 SUPERSEDED — full label reconciliation sweep.** The Phase-1 canonical rebuilds are the one chance to make `conversation_messages` truly byte-identical: the app adopts the ENGINE timestamp labels (`TIMESTAMP`/`DATETIME`) on `created_at`/`updated_at`/`deleted_at`. Safe because the rebuild drops ALL timestamp defaults (the actual 000025 hazard), RN reads by storage class (ISO strings remain TEXT storage under NUMERIC affinity), and the app already runs TIMESTAMP-labeled tables today (`entities`, `emotion_state`). The same sweep reconciles the remaining real-substance drifts APP-SIDE ONLY (engine untouched; Q12 intact — no shipped migration edited, everything folds into the pre-mainline 000041 edit + the not-yet-written 000042): `emotion_state` (`deleted_at` → DATETIME), `entity_emoji_actions` (3 timestamp labels → DATETIME + dormant defaults), `sync_history` (add engine's `updated_at` column in engine position), `interactions` (6 timestamp labels → DATETIME, explicit `NULL` keywords, engine's `entity_id` FK clause), and `entities` via the app-000042 REBUILD carrying `alias TEXT NOT NULL DEFAULT ''` (engine's `CreateEntity` INSERT always supplies alias — verified dormant). Rebuilds dropping referenced tables toggle `PRAGMA foreign_keys` per the 000037 pattern. End-state allowlist = `device_push_tokens` + `sync_devices` (post-4-2 `synced_tables`) ONLY. Invariant kept: no `DEFAULT CURRENT_TIMESTAMP`-reliance app-side, ever (defaults stay dormant; writers always explicit). |
| A10 | **userEntities repo pulled into Phase 1 (extends A5; no stub debt).** Instead of stubbing `personas.ts`, the Phase-1 app change set creates `src/database/repositories/userEntities.ts` (the 5-4 §1 spec) and reduces `personas.ts` to a thin re-export shim (deleted in 5-4) — screens keep compiling, `resolvePersonaId` stays functional (entities-backed; consumes `entity_type` from the same change set's 000042), and NO persona UI goes dark. Interim (documented in 1-2): the built-in `user` entity has no linked profile until 5-3's engine seeder lands, so the persona switcher's default row shows the raw `'user'` id until Phase 5. |
| A11 | **Lockstep authoring workflow.** Both sides of a schema pair (1-1↔1-2, both 000042s, 4-2's 000043 pair) are authored in ONE session; build/test/parity gates run only once both sides exist locally. A single-sided commit is never parity-gated (the first commit of a pair is EXPECTED to diverge until its counterpart exists — not a failure). |
| A12 | **2-3 scope reduced: AI-authored reactions DEFERRED.** The backend deliberately does not emit reaction effects yet (user ruling 2026-08-31). 2-3 keeps only cognition-side reaction awareness (prompt/history annotations + tests). The AI-authored-reaction mechanism — producer site (backend response → reaction parsing) AND consumption path (AdditionalEffects sibling vs engine-internal `updateMessageAudio`-style update) — is decided when the backend gains the capability; 2-3 carries this deferral note. |
| A13 | **Identifier-quote normalization joins §9-A8.** Both dump writers additionally normalize the `CREATE TABLE` header's table-name quoting — strip surrounding double quotes on the HEADER name only (string-literal bodies elsewhere in the DDL untouched) — applied before whitespace collapse, cross-impl fixture-tested exactly like the comment stripper. Evidence (validated 2026-08-31): the `_new`-rebuild + RENAME pattern stores QUOTED names in sqlite_master (engine `entities` was created unquoted in 000002 yet stores `"entities"` today), while the engine's never-rebuilt `emotion_state`/`entity_emoji_actions`/`interactions` are UNQUOTED — without this normalization the §9-A9 app-side rebuilds of exactly those three tables would leave quote-only "different SQL" drift and the MATCH-everything end state would fail (comparator is exact-string; neither writer touched quotes today). |
| A14 | **Dead sync-infra tables dropped app-side; 000043 pair re-scoped.** Verified: every function in `src/database/repositories/sync.ts` (`createSyncDevice`/`getSyncDevice`/`updateSyncDevice`/`createSyncHistory`/`getSyncHistory`/`getSyncHistoryList`) has ZERO callers — `sync_devices` + `sync_history` were mistakenly ported engine mirrors the app never needed. App `000043` therefore becomes a REAL migration (DROP TABLE both + delete `repositories/sync.ts` + their `SyncDevice`/`SyncHistory` model types + snapshot regen), authored in lockstep (§9-A11) with engine `000043` (`synced_tables`). The §9-A9 `sync_history` reconciliation rebuild is CANCELLED (moot). 4-2's old "engine-LOCAL infra table (not in the app schema)" rationale is corrected: the tables DID exist app-side (000005/000006) and are now deliberately removed. Allowlist end state = **3 uniform Go-only infra entries**: `device_push_tokens`, `sync_devices`, `sync_history`. Interim: between Phase 1 and 4-2, `sync_history` remains a real different-SQL drift (app lacks `updated_at`) and occupies an allowlist entry. |
| A15 | **Engine dump stdout purity.** `cmd/dump_schema.go` must emit pure JSON on stdout — config/banner lines go to stderr (or are suppressed for this command). Evidence: the stdout header line count is NON-DETERMINISTIC (1 and 2 lines observed across runs on this machine); every fixed `tail -n +N` strip is brittle (the parity doc's `+4`, the plan's `+3` — both retired). Gates assert mechanically that stdout starts with `[`. Folds into 1-4 §0 (same writer-hardening change set). |
| A16 | **personas.ts shim surface completed.** The 1-2/5-4 shim spec must also re-export `getPersona` and `PersonaRecord` (verified exports at `personas.ts:21-206`, alongside `Persona`/`getAllPersonas`/`createPersona`/`updatePersona`/`deletePersona`/`resolvePersonaId`) — missing entries break consumer compiles at the Phase-1 green gate. |
| A17 | **1-4's parity-doc references corrected.** `docs/schema-parity.md` DOES have a "Current Divergence State" heading (line ~90) — 1-4's "(the doc has no such heading)" claim is wrong — and it records **10** cosmetic drifts (post-reply-restore state; the contract's "9" predates it). The 1-4 rewrite targets the real headings (including that one) and carries a drift-count reconciliation note. |
| A18 | **Residual findings accepted as-is (explicit sign-off, 2026-08-31).** (1) The Phase-1 app change set stays ONE green commit (A5/A10): the no-dead-window guarantee outweighs the reviewability cost of the large blast radius. (2) Engine 000041's dropped `FOREIGN KEY (entity_id) … CASCADE` clause and timestamp DEFAULTs get NO extra audit gate beyond the every-commit-green `go test ./...` rule — the repo fn is the sole engine writer (stamps `time.Now()`, `messages.go:80`) and engine deletes are soft, so a regression surfaces in the test suite. |
