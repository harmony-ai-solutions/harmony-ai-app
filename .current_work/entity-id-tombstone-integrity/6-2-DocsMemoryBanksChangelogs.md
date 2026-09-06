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

- [ ] Senju follow-up record written (ledger N1/N2/N3/N4/N6 statuses)
- [ ] Memory banks updated (`.toon` first) — both app + engine
- [ ] Engine docs + openapi; app docs
- [ ] Changelogs (both repos, user-facing language)
- [ ] READMEs verified/updated
