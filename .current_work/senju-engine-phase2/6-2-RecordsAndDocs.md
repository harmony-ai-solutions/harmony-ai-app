# 6-2 — Records, Docs & Hand-off

> Phase 6 / repos: BOTH (docs live in the app repo). D5-convention wrap-up.

## 1. Record doc — `.current_work/senju-rebase-integration/15-Engine-Phase2-Record.md`

Per-phase what-changed/why (both repos, commit hashes per phase doc), deviations from the phase docs with
reasoning, what was intentionally NOT fixed, gate outputs (parity excerpt incl. allowlist listing), the extended
dev-DB-wipe note, standing decisions consumed (Q1–Q16), and the cross-repo commit pairing table (app ↔ engine
lockstep commits). Note the **engine GitNexus index refresh** and any impact-analysis surprises.

## 2. Repo documentation updates

- `docs/schema-parity.md`: final state section (rewritten in 1-4; verify accuracy against final output; add the
  `000043` reserved-placeholder pairing note).
- `CHANGELOG.md` (app): user-relevant waves — message reactions/pins/replies sync across devices; read-state sync
  (unread derived); reply-mode synced; mute/disable now global per AI; personas become user identities ("You"
  default persona, create from card); **dev-build DB wipe hint** (extended scope).
- `docs/TESTING.md`: fix the known stale bits if touched by this phase (migration count/register file name) — only
  the sections we verified; no drive-by edits.
- Memory bank (workspace rules): `.toon` files FIRST (`activeContext` @Focus entry for Phase 2; `progress`), then
  `.md` counterparts; **engine repo memory bank: note Phase 2 explicitly** (first engine-side phase — branch,
  migration numbers 41-43, gate sites touched).

## 3. Planning docs

- `senju-rebase-integration/summary.md`: Phase-2 execution status row + pointer to the record.
- `senju-engine-phase2/summary.md`: tick all Implementation Status boxes.
- Deferred-items ledger (into the record doc): read-by-AI design (Q2), cloud-worker entity gate (D-track flag),
  Postgres cloud-path check, 9 allowlisted drifts (opportunistic reconciliation), backend-concept items.

## 4. Hand-off note to user

- On-device smoke list executed (6-1 §smoke) with results.
- **Pending coordination items**: senju origin force-push window (unchanged); coordinated mainline merge order —
  engine `feat/engine-track-phase2` → engine `main` FIRST, then the app branch (parity CI pins engine main);
  cloud-track ticket for the lifecycle-worker entity gate.
- Final `gitnexus_detect_changes()` on the docs commits (both repos).

## Verification

- [ ] Record doc + outlines written; CHANGELOG/README/docs/memory bank updated (both repos)
- [ ] Summary checkboxes ticked; hand-off delivered
