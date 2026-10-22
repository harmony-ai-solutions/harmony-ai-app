# Phase 2-2 — Engine: Changeset Store & Epoch Manager

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.2, §12.7 decisions 1–3 (epochs, retention, conflict policy)
> **Depends on:** 2-1
> **Codebase mapping consulted:** `.planning/codebase/` (engine — harmony-link-private): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

The bookkeeping layer around changesets: authority epochs, changeset retention + baseline snapshots, and the per-table-class conflict policy — the replacements for watermark/tombstone/purge-floor semantics.

## Design

### Epochs (single-writer authority — recommended model, decision pending review)

- An **epoch** = a contiguous span where exactly one engine instance is the write authority for a dataset. Epochs are identified `(epoch_id, engine_instance_id, started_at)`; `epoch_id` = UUIDv7.
- Local table `sync_epochs` (+ `sync_epoch_state` current pointer): every recorded changeset is tagged with its epoch. A non-authority host records into a **pending epoch** (buffered locally); on acquiring authority (or on exchange), pending changesets are forwarded.
- Authority acquisition rules (v1, deliberately conservative):
  - Desktop/self-hosted: authority while running and reachable (existing per-source model)
  - Embedded engine: authority while the app session is active in local mode; **yields** on connect to a desktop peer — the only peer pairing (becomes client: writes route through the peer — see 2-4 client role) — this avoids concurrent multi-writer entirely in v1
  - Cloud session engine: **legacy infra** — unused by new clients per the 2026-10-11 ruling (no cloud engine peer); retired in 6-1. Listed for completeness only; no v1 interaction
- No rebase in v1 (SQLite marks it experimental). Concurrent-write conflicts are prevented structurally (yield-on-connect), not merged.

### Changeset store

- Local table `sync_changesets` (`id` UUIDv7, `epoch_id`, `seq` monotonic per epoch, `created_at`, `payload` BLOB (gzipped), `size_bytes`, `table_count`). Sessions flush changesets on: tx-commit batches (debounced), session end, authority handover.
- Retention: changesets retained **R days** (propose 14 — midpoint of decision 2's 7–30 window) after being acknowledged by all known peers; baseline snapshot (full DB copy — reuse existing backup/snapshot tooling) every **B days** (propose 7) or when unacked backlog > size cap.
- Rejoin rule (replaces purge-floor/rebuild): a peer whose `(epoch, seq)` continuity is broken (gap beyond retention) → **baseline snapshot transfer + fresh epoch** (simpler than today's wipe/rebuild: one compact standalone DB file — the same artifact mechanics 2-6's backup pipeline produces via `VACUUM INTO`; the cloud S3 snapshot flow it previously resembled is retired in 6-2).

### Conflict policy (per table class — the whole policy, no protocol)

| Table class | Examples | INSERT conflict | UPDATE conflict | DELETE conflict |
|---|---|---|---|---|
| Append-only, engine-minted PKs | `conversation_messages`, `memories`, `interactions` | OMIT (on a true PK collision OMIT simply keeps the local row and drops the incoming insert — "keep both" is not literally possible with a PK; with engine-minted UUIDv7s collisions are ~impossible, so the distinction is theoretical) | n/a (no updates) / LWW | OMIT (row already gone) |
| Config rows | `*_configs`, `provider_config_*` | REPLACE (LWW) | REPLACE (LWW) | native replay |
| Identity rows | `entities`, `character_profiles` | REPLACE via derived-id rule (ids immutable-for-life; same-id INSERT ⇒ same entity) | REPLACE (LWW by `updated_at` — keep column!) | native replay |
| Session/runtime | `emotion_state`, `lifecycle_state` | REPLACE | REPLACE | OMIT |
| Junction/mappings | `entity_module_mappings`, emoji actions | REPLACE | REPLACE | native replay |

Encoded as a Go table-driven `ConflictPolicy` consumed by 2-1's `Apply`.

## Implementation steps

1. Migrations: `sync_epochs`, `sync_epoch_state`, `sync_changesets` (+ indexes). Add to engine migration chain (mind the cross-repo numbering parity rules — coordinate app mirror only if app still mirrors at merge time; else engine-only).
2. `database/changesetstore/` package: epoch lifecycle (start/yield/acquire/close), session flush hooks (wrap the repository tx helpers used by sync writes — a single seam in `database/controllers` where all synced writes flow), retention sweeper, baseline snapshot helper.
3. Policy table + tests (driven through 2-1 Apply on real schemas).
4. Rejoin path: baseline transfer + epoch reset (used by 2-3 peer protocol).
5. Tests: epoch yield/acquire races (single-writer invariant under simulated reconnects), retention/compaction, gap-detection → rejoin.

## Files to create/modify

- NEW migrations (epoch/store tables)
- NEW `database/changesetstore/` (+ tests)
- `database/controllers` write-path seam for session recording
- Engine docs: NEW `docs/Changeset-Sync.md` (epoch model, policy table, rejoin rule)

## Verification gates

- `go build/vet/test ./...` green; epoch race tests green ( `-race`)
- Policy tests green on real schema
- Doc reviewed (the policy table is a user-facing behavioral contract now)

## Risks & rollback

- Single-writer strictness may feel restrictive (phone must yield to desktop) — accepted v1 trade-off; rebase later if needed
- Write-path seam must not add per-tx overhead when no session is recording — no-op fast path + bench

## Progress checklist

- [x] Migrations landed
- [x] Epoch lifecycle + single-writer invariant tests
- [x] Changeset store + retention + baseline
- [x] Conflict policy table + tests
- [x] Rejoin path implemented
- [x] Docs written
