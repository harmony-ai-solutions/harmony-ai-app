# Senju Engine Track — Phase 2: Message Actions, Preferences Sync & Entity Typing

> Execution plan for the engine track (Track B1/B2/B3 of
> `.current_work/senju-rebase-integration/02-Followup-Stub-Plan.md`, Phase-2 items 7–10).
> **Binding contract base:** `.current_work/senju-rebase-integration/21-Engine-Contract-Persona-Enums.md`
> (all Q1–Q16 rulings, schema/sync/behavior contracts **+ §9 amendments A1–A19, 2026-08-31/09-01 — rounds 2 and 3:
> A8 comment-insensitive comparator, A9 label-reconciliation sweep (supersedes A1), A10 userEntities
> pull-forward, A11 lockstep authoring workflow, A12 AI-authored-reactions deferral; A13 identifier-quote
> normalization, A14 dead sync-infra tables dropped app-side + 000043 pair re-scope, A15 engine dump stdout
> purity, A16 shim surface completion, A17 parity-doc heading fixes, A18 residual sign-offs**). Where a
> phase doc and the contract disagree, the contract wins.
> Two repos: `harmony-ai-app` (branch `senju-design-updates-rebase`) + `harmony-link-private`
> (new branch `feat/engine-track-phase2` off `main`). **No merges to main during Phase 2.**

## What this phase delivers

1. **B1 message-layer parity**: `conversation_messages` rebuilt to one canonical column set/order on both sides
   (incl. `reactions_json`, `reply_to_message_id`, `is_pinned`, new `is_read`); **byte-identical both sides per
   amendment §9-A9 (supersedes A1): the app adopts the engine `TIMESTAMP`/`DATETIME` labels, no timestamp
   defaults either side — the table never enters the allowlist**; engine ingests/persists all of it
   (field-scoped merge, inbound timestamps preserved, reaction awareness); unread becomes derived app-side.
   **D3 closes for real; §9-A9 additionally reconciles `emotion_state`/`entity_emoji_actions`/`interactions`/
   `entities` app-side (§9-A13 quote normalization makes the rebuilds byte-stick; `sync_history` reconciliation
   cancelled by §9-A14) — end-state parity diff = 3 deliberate Go-only infra entries.**
2. **B2 preferences sync**: ~~`character_favorites` +~~ slimmed `chat_conversation_settings` (POV `entity_id`, pinned,
   archived, `reply_mode`) become engine-synced tables with watermark contract, per-table initial backfill, and a
   centralized app PK registry. **§9-A19 (user ruling 2026-09-01) supersedes Q5: favorites moved to
   `character_profiles.is_favorite` (paired 000044, sidecar dropped both sides, LWW coupling accepted) — only
   `chat_conversation_settings` remains a synced table from B2.**
3. **B3 entity typing**: `entities.entity_type` + global `is_muted`/`is_disabled`; personas become user entities
   (linked profiles, default persona "You" engine-seeded and editable); AI-only automation gating; symmetric RAG.
4. **Parity tooling**: **comment-insensitive + quote-normalized comparator (§9-A8/§9-A13 — both dump writers
   strip SQL comments and canonicalize `CREATE TABLE` header quoting before whitespace collapse,
   string-literal-aware, cross-impl tested; §9-A15 makes the engine dump pure-JSON stdout)**, allowlist
   (end state = 3 uniform Go-only infra entries: `device_push_tokens` + `sync_devices` + `sync_history` — the
   latter two's dead app copies DROPPED by the paired app `000043`, §9-A14), regenerated baselines,
   `CLIENT_ONLY_TABLES` mechanism deleted.

## Working agreements (binding)

- **Branches** (Q16): app = continue on `senju-design-updates-rebase`; engine = `feat/engine-track-phase2` off main.
  Never merge to main, never force-push `senju-design-updates` (coordination with senju still pending).
- **Every commit green** — app: `npx tsc --noEmit` = 0, `npm test` green; engine: `go build ./...`, `go test ./...`.
  Schema-touching commits additionally regenerate migration snapshots (app) and pass the roll-forward/rollback suite (engine).
- **Schema changes land in cross-repo lockstep (§9-A11 workflow)**: BOTH sides of a pair (1-1↔1-2, both 000042s,
  4-2's 000043 pair) are authored in ONE session; build/test/parity gates run only once both sides exist locally —
  a single-sided state is never parity-gated (expected to diverge). The paired migrations in Phase 1 are committed
  to both repos before any consumer code (A5/A10: the app 1-2+1-3 change set bundles schema + direct consumer
  rewiring + the `userEntities` repo + `personas.ts` shim in one commit — parity is still verified against the
  schema state); local parity compare must show `diff ⊆ allowlist` after every COMPLETE pair.
  **CI parity stays red by design** (it pins engine `main`) — local compare is the authoritative gate.
- **TDD (full, 2026-08-31 ruling)**: every code-bearing task writes its tests RED first, then implements to
  green (per-doc "TDD order" sections). Migration/SQL tasks stay snapshot-based (snapshot regeneration +
  roll-forward/rollback suites).
- **GitNexus protocol** (AGENTS.md) in BOTH repos: `gitnexus_impact` before editing existing symbols;
  `gitnexus_detect_changes()` before each commit; refresh stale indexes (`npx gitnexus analyze` — the engine repo
  index is 4 commits stale, refresh FIRST).
- **Migration guards**: no `DROP COLUMN`/`RENAME COLUMN` in either repo (app `migrations.ts:329-382`, engine
  `migrations.go:287-358`); removals/reshapes use the `_new`-table rebuild; app rebuilds that drop referenced
  tables toggle `PRAGMA foreign_keys` themselves (000037 pattern); engine downs are mandatory.
- **i18n**: every user-visible app string through `src/i18n/locales/en/<ns>.json` + registration in `I18nContext.tsx`.
- **Honest errors** (no fake success) and **no new state-management libraries**.
- **Docs**: after each phase, tick the phase doc checklist + this summary; final phase writes the record doc
  (`15-Engine-Phase2-Record.md` in `senju-rebase-integration/`), CHANGELOG, memory bank.

## Phase overview

| Phase | Docs | Track | Output |
|---|---|---|---|
| 1 — Schema lockstep | 1-1…1-4 | B1/B2/B3 schema | Engine `000041` + edited app `000041` (canonical rebuild incl. §9-A9 label adoption, favorites, settings, personas removed + 3 reconciliation rebuilds — `sync_history` cancelled by §9-A14); paired `000042` (`entity_type`, `is_muted`, `is_disabled`; app side = `entities` rebuild w/ `alias DEFAULT ''`); **A5/A10: mute/disable→entity-flag + derived-unread core + `userEntities` repo + personas shim land here too (no dead UI window)**; §9-A8/§9-A13/§9-A15 dump-writer hardening, snapshots, baselines, allowlist, `CLIENT_ONLY_TABLES` deletion |
| 2 — B1 engine | 2-1…2-3 | B1 | Message models/query columns; field-merge sync apply + inbound timestamps + `reply_to` persistence; reaction awareness |
| 3 — B1 app | 3-1 | B1 | Remainder after A5 pull-forward: `chat_last_read_*` deletion, sync-applied recount event, divider derivation, full tests |
| 4 — B2 sync | 4-1…4-4 | B2 | PK registry; sync registration both repos (7-step recipe ×2); per-table backfill + paired `000043` (engine `synced_tables` ↔ app DROPS dead `sync_devices`/`sync_history` + deletes their repo, §9-A14); engine muted/disabled gates; app settings rewiring |
| 5 — B3 entities | 5-1…5-4 | B3 | Engine entity plumbing + AI-only gating + user-entity support (seeder, resolvers, protection, symmetric RAG); app persona rewiring (contract §6 gap list A1–A7, persona-from-card) |
| 6 — Verification | 6-1…6-2 | wrap-up | Full gates both repos, parity = allowlist-only, record doc, CHANGELOG, memory bank, smoke list |

Sequencing rationale: schema first (everything compiles against the final shape), then B1 (read-flags must exist
before B2's derived-unread consumers and before settings rows are written without `unread_count`), then B2, then B3
(orthogonal; shares the Phase-1 `000042` schema), verification last.

## Implementation Status

- [x] **Phase 1: Schema Lockstep** — 1-1 ([Engine 000041](1-1-EngineMigration000041.md)) · 1-2 ([App 000041 edit](1-2-AppMigration000041Edit.md)) · 1-3 ([Paired 000042](1-3-PairedMigration000042.md)) · 1-4 ([Parity tooling](1-4-ParityToolingAndBaselines.md))
- [x] **Phase 2: B1 Engine** — 2-1 ([Models & queries](2-1-EngineMessageActionModels.md)) · 2-2 ([Sync field-merge](2-2-EngineSyncFieldMerge.md)) · 2-3 ([Reaction awareness](2-3-EngineReactionAwareness.md))
- [x] **Phase 3: B1 App** — 3-1 ([Read flags & derived unread](3-1-AppReadFlagsDerivedUnread.md))
- [x] **Phase 4: B2 Sync** — 4-1 ([App registration & PK registry](4-1-AppSyncRegistration.md)) · 4-2 ([Engine registration & backfill](4-2-EngineSyncRegistration.md)) · 4-3 ([Engine muted/disabled gates](4-3-EngineMutedDisabledGates.md)) · 4-4 ([App settings rewiring](4-4-AppSettingsRewiring.md))
- [x] **Phase 5: B3 Entities** — 5-1 ([Engine entity_type plumbing](5-1-EngineEntityTypePlumbing.md)) · 5-2 ([Engine AI-only gating](5-2-EngineAIOnlyGating.md)) · 5-3 ([Engine user-entity support](5-3-EngineUserEntitySupport.md)) · 5-4 ([App persona rewiring](5-4-AppPersonaRewiring.md))
- [x] **Phase 6: Verification** — 6-1 ([Gates](6-1-VerificationGates.md)) · 6-2 ([Records & docs](6-2-RecordsAndDocs.md))

## Codebase-mapping documents consulted

App: `.planning/codebase/` (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, INTEGRATIONS.md, TESTING.md) +
`.current_work/senju-rebase-integration/00-Research-Findings.md`, `03-Pattern-Cheat-Sheet.md`,
`04-Preference-Alignment-Inventory.md`, `14-Followup-Phase1-Record.md`. Engine: direct file reconnaissance
(2026-08-29, six code-expert reports; line references embedded in the phase docs and the `21-Engine-Contract`).

## Standing notes

- Dev-DB-wipe note (extended): devices that ran ANY pre-Phase-2 build of the rebase branch (old `000041`, old
  settings shape, personas table) need the one-time wipe — the edited `000041` never re-runs for them. Documented in
  the migration header + CHANGELOG.
- Parity expected output: after Phase 1 = exactly 2 allowlist entries (`device_push_tokens` Go-only + `sync_history`
  interim different-SQL — the §9-A8/§9-A13/§9-A9 sweep eliminates every accidental drift; `sync_history` drifts
  deliberately until 4-2 drops it); after 4-2 = **3 uniform Go-only infra entries** (+ `sync_devices`, whose dead
  app copy the paired app `000043` removes — §9-A14); anything else → investigate, never paper over.
- App parity CI remains red-by-design until the coordinated mainline merge (Q16) — do not "fix" it.
