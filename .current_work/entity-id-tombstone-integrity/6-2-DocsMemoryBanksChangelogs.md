# 6-2 — Docs, Memory Banks, Changelogs & Ledger Updates

## Objective

Keep the documentation ecosystem in sync per workspace rules (`.roo/rules/workspace-rules.md`): memory banks
(`.toon` files first, then markdown), docs, changelogs — across every touched repo.

## Steps

1. **Senju phase-2 follow-up ledger update** — extend
    `.current_work/senju-rebase-integration/` with a follow-up record (or amend `16-…Post-Alignment-Record.md`
    per its own conventions — add a new numbered record referencing this plan folder):
    - **N1 resolved** (1-1 ghost-aware sync apply), **N3 resolved** (charset — by construction post-D23),
      **N4 resolved by removal** (review 3: the rename endpoint no longer exists — 2-1b),
      **N2 mitigated** (timestamped ids shrink the cross-device window to same-second),
      **N6 partially** (the D15/D23 create-contract routes get documented — note entity routes were entirely
      undocumented, not partially; the deleted-list/restore endpoints that were to address this are gone
      with Phase 5 — review 6).
2. **Memory banks** (`.toon` files first, then markdown, per workspace rules):
   - `harmony-ai-app/memory-bank/`: tombstone-GC model (D1 amended by D69–D78: tombstone-then-GC, **no
      restore — deletion is final once propagated and GC'd**), id schema D2 + **derived-only creation,
      ids immutable for life (D22/D23 — review 3)**, sync version gate, **D11 convergence
      (engine-authoritative wipe + rebuild)**, D13 conflict surfacing (no auto-recovery), D14 persona
      edits never rename, D16 delete-only session guard + D27 disconnect release, D18 settings soft
      delete, D19 preference reset, stuck-session UX states (D36 failed marker); **review-4 topics
      (D51–D60): ephemeral-table carve-out (D53), critical-wait-on-dirty at chat open / sync fully executed
      before INIT_ENTITY (D55), creation-time alias dedupe (D56), sticky `serverUpdateRequired` + slow
      re-probe (D57), labeled wipe gate "Rebuilding from Soulbits Engine…" (D58)**; **review-5 topics
      (D61–D67): boot-window wipe (D61), Go-migration-hook mechanics (D62), decoupled display-name sources
      (D63), config-delete LWW split (D64), disconnect session retention (D65), final create contract incl.
      entity_type (D66), and the documented `DeleteMemory` hard-delete exception — app devices retain
      consolidated source memories (D67)**; **review-6 topics (D69–D78): local tombstone GC kept +
      allowlist unified to 35 (D73/D72), no explicit cleanup action (D74), no restore (D75 — recreation is
      the only path back), stale-watermark rebuild on purge floor (D76/4-5), orphan-memory sweep retained
      (D77), D26 8-child cascade + D17 one-`now` persona stamping as delete-path parity**; update
      `progress`, `activeContext`, `systemPatterns` as needed.
   - `harmony-link-private/memory-bank/`: same invariants engine-side; **no runtime id-rename (D22)**;
      **tombstone-GC model (D69–D78): repaired FK-safe finalize GC + unified 35-table allowlist + purge
      floor & rebuild signal (D71/D72/D76), no restore (D75), orphan-memory sweep retained (D77)**;
      unified cascade stamp incl. sync delete ops + profile/image deletes (**D17/D25 — delete-path
      hygiene, review 6**) + grown cascade (**entity + 8 children / 9 stamps — D26 count fixed
      review 4**); **unconditional sync-delete ops pinned as intended (D54)**; the recurring FK-cleanup
      error is dead; **one-time post-migration re-embed (D22; all 7 `WorkingDir/<entityId>/` module
       folders orphan — review 4)**; **migration = Go hook reusing `DeriveEntityID`/`DeriveParticipantKey`
       + legacy participant keys recomputed (D62/D60; D51's recursive-CTE spec superseded)**;
      **`DeleteMemory` documented as the known tombstone-protocol exception (D67 — consolidation
      hard-delete; no tombstone propagates, app devices retain consolidated source memories)**;
      **also document the orphan-sweep divergence (review 7): `DeleteOrphanedMemories` (kept per D77)
      hard-deletes LIVE orphaned memories with no tombstone — same accepted divergence class as D67;
      app devices converge via their own local orphan sweep once the referencing interaction tombstones
      propagate**.
   - `harmony-link-private/frontend/` has no memory bank — the senju record is its documentation (per phase-2
     note); cover FE changes in the new record instead.
3. **Docs**:
   - Engine `docs/`: entity lifecycle (create/delete diagram incl. tombstone → GC — **no restore,
     review 6**; note the purge-floor rebuild handshake), sync schema version policy (from 3-3),
     id-derivation spec (D2), **create contract (D15/D23 — derived-only; the rename endpoint is REMOVED,
     note the breaking change)**.
    - App `docs/`: `entity-interaction-model.md` gains the tombstone/GC lifecycle + id schema, including
      the rebuild-on-purge-floor flow (4-5); TESTING.md updated with new fixture/tests if structure changed.
    - Engine `docs/api/management/openapi.yaml` (**correct path — a root `docs/openapi.yaml` does not exist**;
      entity routes are currently entirely undocumented there): the D15/D23 create contract (2-1's routes).
4. **Changelogs** (user-facing, no implementation details per workspace rules):
   - `harmony-ai-app/CHANGELOG.md`: fixed — entities getting stuck "Connecting…" after delete+recreate;
      deleted data is cleaned up consistently across devices (deletion is final); entity IDs are always
      auto-generated (users name AIs, ids are internal); **changed — this update re-syncs all data from
      Harmony Link once after updating (a one-time local reset; sync before updating if you were
      offline)**.
   - `harmony-link-private/CHANGELOG.md`: fixed — sync failure after deleting and recreating an entity;
      recurring "clean up soft-deleted records" error resolved; deleted data is now cleaned up after
      sync (final deletion); new ID naming scheme; **removed — the entity ID rename action (rename your
      AI's *name* instead; IDs are permanent)**.
   - FE nested repo: **verified in plan review — no changelog and no docs dir exist** (README + commit
     messages only); cover FE changes in the senju follow-up record, skip a changelog file.
5. **READMEs**: sync-feature summaries updated where deletion/cleanup is described (verify each repo's
   README mentions — no restore language anywhere).

## Checklist

- [x] Senju follow-up record written (ledger N1/N2/N3/N4/N6 statuses) — *(app-repo item; not engine-owned)* — **✅ 2026-09-07**: `.current_work/senju-rebase-integration/17-EntityIdTombstoneIntegrity-Record.md` (incident→resolution, ledger table incl. carried N5/N7–N9, per-phase completion all three repos, FE deliverables section = the FE repo's documentation, deviations, verification evidence from 6-1, D-table linked not duplicated)
- [x] Memory banks updated (`.toon` first) — both app + engine — **engine ✅ 2026-09-07** (`harmony-link-private/memory-bank/` is toon-only — no markdown exists; updated `activeContext`, `progress`, `systemPatterns` (new `@Entity_Lifecycle_Invariants` section), `techContext`) — **app ✅ 2026-09-07** (`harmony-ai-app/memory-bank/` is also **toon-only** — no markdown exists; updated `activeContext` (new @Focus entry), `progress` (Session 2026-09-07 @Completed entry), `systemPatterns` (new `@EntityLifecycle` section: id schema D2/D22/D23 + D68 mint seam, tombstone→GC no-restore D69–D78/D75 + 8-child one-`now` cascade + D18 + permanent-param removal, D67 exception, version gate + sticky choke point, D11/D61/D58/D19 wipe, D76/D82 rebuild-on-purge-floor, D13/D34/D55 conflict surfacing, D36 failed-session UX); FE repo has no memory bank — covered by the record per phase-2 note)
- [x] Engine docs + openapi; app docs — **engine ✅ 2026-09-07** (new `docs/Entity-Lifecycle.md` + `docs/README.md` TOC entry + openapi `POST /api/entities` + `POST /api/entities/{id}/duplicate`) — **app ✅ 2026-09-07** (`docs/entity-interaction-model.md` gained §8 "Entity lifecycle: IDs, deletion, and rebuilds" (minted-never-chosen ids, tombstone→GC diagram incl. no-restore, one-time rebuilds/version gate) + a mint/cascade row in §7's where-to-look table; `docs/TESTING.md` gained a dated note that the baseline tables are non-exhaustive — 146 unit suites/~1300 + 13 integration, migrations to 000046 — with the new-suite list + a pointer to 6-1's coverage map)
- [x] Changelogs (both repos, user-facing language) — **engine ✅ 2026-09-07** (`harmony-link-private/CHANGELOG.md` v0.3.0: Changes/Removed/Bug Fixes) — **app ✅ 2026-09-07** (`CHANGELOG.md` new top section **"Data & Sync"**: Fixed — stuck-"Connecting…" after delete+recreate, deletion cleaned up consistently across devices (final, no undo), IDs always auto-generated; Changed — one-time re-sync from Harmony Link after updating + Harmony-Link-version requirement with auto-resume); FE nested repo has no changelog (verified in plan review) — covered in the record
- [x] READMEs verified/updated — **engine ✅ 2026-09-07** (engine README + docs swept — zero restore-language anywhere deletion/cleanup is described; only unrelated hits: DB-backup restore, git file revert) — **app ✅ 2026-09-07** (README swept: zero restore-language anywhere — the only repo "restore" hits are unrelated (ReactHost lifecycle restore, unblock/re-enable, backup-recovery advice in `.planning`); sync-feature descriptions ("Data Sync with Backend" etc.) remain accurate — nothing to change); FE repo not swept by the app half (out of its file scope per task rules — the record is its documentation)

## Engine docs note (2026-09-07, engine agent)

- Memory-bank convention found: `harmony-link-private/memory-bank/` contains **only `.toon` files** (no markdown) — toon-first rule satisfied trivially; noted per task instruction.
- `docs/Entity-Lifecycle.md` (new) hosts all four doc topics in one natural home: id-derivation spec (D2 slug vectors), derived-only create contract (D66 incl. the rename-REMOVED breaking change), delete/tombstone→GC lifecycle (no restore, D75), purge-floor rebuild handshake (D76), sync schema version policy (current 2 / min client 2 + bump policy), and the D67/orphan-sweep hard-delete exceptions. Added to `docs/README.md` TOC.
- openapi: entity routes were entirely undocumented; documented `POST /api/entities` (derived-only request shape, all 400 messages verbatim from `management/routes_entities.go`, 201 echo incl. resolved id/alias) + `POST /api/entities/{id}/duplicate` (fresh derivation from source display name, live-linked profile, alias `"<base> <N>"` series; 404/400-persona). Rename never documented — nothing removed. Route prefix verified against `management/server.go`: `/api` group (the "…/api/v1/entities…" comment inside `handleDuplicateEntity` is stale — the registered route is `/api/entities/:id/duplicate`; openapi documents the registered path).
- CHANGELOG (v0.3.0): new "Changes" (new ID naming scheme), "Removed" (entity ID rename action — rename the name instead; IDs permanent), "Bug Fixes" (delete+recreate sync failure; recurring "clean up soft-deleted records" error resolved — deleted data cleaned up after sync, deletion final). No implementation details.
- Inaccuracies corrected while documenting: (1) the in-code route comment above (`/api/v1/...`) — documented the real route instead; (2) phase-doc wording "delete ops unconditional D54" clarified in docs as "a stale delete always tombstones a newer live row" (matches `synchronization.go` semantics); (3) "7 WorkingDir module folders" documented as the one-time re-embed consequence of the 000045 id renames (folders keyed by old ids orphan once).

## App docs note (2026-09-07, app agent)

- Memory-bank convention found: `harmony-ai-app/memory-bank/` contains **only `.toon` files** (6 files — no markdown), same as the engine; toon-first rule satisfied trivially. Updated `activeContext` (new top @Focus entry), `progress` (new Session 2026-09-07 @Completed entry), `systemPatterns` (new `@EntityLifecycle` section, placed after `@Database`). `techContext` left untouched (tech-stack file; the invariants are patterns).
- `docs/entity-interaction-model.md`: verified to exist; appended §8 "Entity lifecycle: IDs, deletion, and rebuilds" in the doc's plain-English contributor voice (minted-never-chosen ids incl. the D68 seam + reserved names; tombstone→GC mermaid diagram + "no restore — recreation only" + 8-child one-stamp family + D18 settings soft-delete + the D67 consolidation exception; one-time wipe/rebuild incl. the D58 label + offline-loss caveat + D76 stale-device restart + 3-3 version-gate UX) and added one §7 where-to-look row (`entityIdUtils.ts` + `entities.ts`). Engine cross-link included.
- `docs/TESTING.md`: the pyramid/suite tables are the framework-overhaul baseline (154 tests/18 suites) and were already non-exhaustive before this plan — added a dated `> **Note:**` block (the doc's existing note format) stating the baseline is non-exhaustive (**146 unit suites/~1300 + 13 integration, migrations to 000046**), naming this plan's new suites (`syncVersionGating`, `syncRebuildRequired`, `wipeRebuild*`, `DatabaseContext.wipe`, `syncAndWaitCritical`, `syncGcTablesParity`, `entityIdUtils`, `timestampUtc`, `interactionsParticipantKey`, `chatDetailConnectionState`/`chatDetailSessionError`/`EntitySession*`, migration placeholders/roll-forward), and pointing to 6-1's Verification Report as the live coverage map. Full table maintenance deferred (counts drift per wave by design of those tables).
- CHANGELOG: new top section **"Data & Sync"** (Fixed ×3, Changed ×2) — exactly the ruled user-facing content, Keep-a-Changelog style of the file, no implementation details. The version-gate entry was added beyond the four mandated bullets because the changelog's audience would otherwise hit an unexplained "update required" state in the same release.
- README sweep: **clean — zero changes needed.** No deletion/cleanup/restore language exists in the app README (grep-verified; all repo "restore" hits are unrelated: ReactHost lifecycle, unblock/re-enable, `.planning` backup advice); the sync-feature mentions ("Data Sync with Backend", connection modes) remain accurate at their level of detail.
- Senju record: `17-EntityIdTombstoneIntegrity-Record.md` follows the folder's numbered-record convention (16 → 17), corrects 16's N6 wording ("partially undocumented" → entity routes were **entirely** undocumented), marks N1/N3/N4 resolved / N2 mitigated / N6 partial / N5+N7–N9 carried, and serves as the FE repo's documentation (2-3 deliverables enumerated).
- Inaccuracies found + handled/flagged: (1) the plan `summary.md` **Implementation Status checkboxes are all unticked** despite every phase being complete (per the ticked phase-doc checklists + 6-1) — left untouched per this task's file scope (only the record + this phase doc may be written); flagged for the orchestrator. (2) README "Tech Stack" still says "Storage: AsyncStorage (foundation for future SQLite)" — long stale (SQLite/SQLCipher is core) but outside the sync-feature sweep scope; left untouched, flagged here. (3) 16's ledger N2 wording implied a single accepted limitation; the record notes D2/D23 narrows it to same-second collisions (backstop still applies).
