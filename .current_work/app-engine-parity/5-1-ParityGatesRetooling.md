# Phase 5-1 — Parity Gates Retooling

> **Repos:** `harmony-ai-app` + `harmony-link-private` (CI)
> **Assessment basis:** §12.6 (the parity tax ends)
> **Codebase mapping consulted:** `.planning/codebase/` — app + engine repos (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md)

## Objective

Retire the cross-repo parity enforcement machinery that exists only because the app was a second schema implementation — after 3-4 confirms deletion — and replace with the (much smaller) gates the new architecture actually needs.

## Outgoing (delete/retire)

- App `scripts/dump-schema.ts` + schema-parity compare vs engine (the `CLIENT_ONLY_TABLES` registry is **already gone** from `dump-schema.ts` — removed in the D6-era cleanup; nothing to retire there, don't go looking for it)
- `syncGcTablesParity.test.ts` (35-table allowlist pin) and siblings
- Cross-repo migration-numbering coordination convention (placeholder migrations for numbering parity)
- Docs: `docs/schema-parity.md` → move to `docs/history/` with a retirement note

## Incoming (new gates)

1. **Facade contract tests:** engine `embed/` method/event JSON schemas covered by contract fixtures; app's `EngineApiClient` mappers validated against the SAME fixtures (shared fixtures file consumed by both repos' CI — pick hosting: engine repo, app CI fetches pinned path).
2. **Changeset protocol conformance:** golden changeset fixtures (epoch/batch/ack/handover) exercised by both server and client test suites.
3. **Embedding artifact pinning:** app builds fail if engine artifact version < facade contract version required by the app's TS layer (a single `ENGINE_CONTRACT_VERSION` constant mirrored in both repos' CI with a drift check).
4. **Loopback-transport smoke** in app CI (mock engine binary artifact where feasible).

## Implementation steps

1. Inventory every parity-flavored test/script in both repos (grep `parity`, allowlists, numbering placeholders) → retire per list.
2. Shared-fixture mechanism + the three new gates.
3. CI pipeline diffs reviewed; runtime/runner usage reduced where suites shrink (update `--maxWorkers` doc note in app TESTING.md).

## Verification gates

- Both repos' CI green with the new gate set; deliberate-drift canary (temporarily mismatch `ENGINE_CONTRACT_VERSION`) fails as intended
- No orphaned scripts/tests referencing deleted machinery

## Risks & rollback

- Losing a safety net that caught real bugs historically — mitigated by the incoming gates covering the actual new coupling surfaces (facade, protocol, artifacts); schema duplication itself is gone by construction

## Progress checklist

> **Status (2026-10-12, task 5-1 — app-side complete).** Reconciled the doc against
> reality: phase 3-4 had already deleted most of the outgoing parity machinery
> (the deletion is in the working tree, uncommitted), so 5-1 verified each item and
> only actioned what **survived** — the stale `schema/rn-schema.json` baseline, the
> orphaned `scripts/.package.json.additions.json`, and moving `docs/schema-parity.md`
> to `docs/history/`. The incoming gates are implemented app-side: contract-version
> pinning, shared wire fixtures + mapper conformance, the endpoint manifest and the
> loopback-transport smoke, plus the opt-in `contract-drift` CI job. The
> changeset-protocol conformance gate and the engine-side canonical fixture hosting
> are engine-repo work (read-only here) — recorded for the orchestrator below.
> Gates: `npx tsc --noEmit` = 0; `npm test` green. Full inventory + dispositions:
> `docs/engine-contract-gates.md`.

- [x] **Retirement inventory executed** — inventoried both repos; already-deleted-by-3-4 items confirmed (not re-done); survivors retired: `schema/rn-schema.json`, `scripts/.package.json.additions.json`; `docs/schema-parity.md` → `docs/history/`
- [x] **Shared fixtures + contract-version drift check live** — `src/services/engine/engineContract.ts` (`ENGINE_CONTRACT_VERSION`, `checkContractVersion`, `checkContractVersionExact`), `__fixtures__/managementContract.fixtures.ts` (DTO-typed), `engineContractConformance.test.ts` (drift canary + mapper conformance), `scripts/check-engine-contract.mjs` + the `contract-drift` CI job. *Engine-side canonical fixture hosting + app-CI pinned-path fetch: orchestrator follow-up (engine repo read-only here).*
- [x] **Conformance gates live (app-side)** — `engineLoopbackSmoke.test.ts` drives the real `EngineApiClient` over loopback against a mock server built from `REQUIRED_ENGINE_ENDPOINTS`. *Changeset-protocol conformance (golden epoch/batch/ack/handover fixtures exercised by server + client suites) is engine-side: the app no longer speaks the protocol (sync is engine↔engine, Phase 2). Recorded for the orchestrator.*
- [x] **CI docs updated** — `.github/workflows/test.yml` (retired `schema-parity` job → optional `contract-drift`; comments updated), `docs/TESTING.md` (CI table + run cadence + `--maxWorkers` note + schema-parity sections), `docs/CONTRIBUTING.md`, `docs/RELEASE.md`, new `docs/engine-contract-gates.md`.

### Carried v1 limitations (2-4, engine-side — NOT in 5-1 scope)

The doc's "Outgoing/Incoming" lists do **not** scope these, and the engine repo is
read-only in this task, so neither is implemented app-side. Both are recorded as
documented v1 limitations in `docs/engine-contract-gates.md`
§"Carried v1 limitations":

1. Baseline adoption is **staged, not hot-applied** (engine `syncclient`).
2. **Per-connect baseline** until the persisted `(epoch, seq)` delta-seed lands
   (engine `syncclient`).
