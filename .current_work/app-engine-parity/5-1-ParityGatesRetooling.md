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

- [ ] Retirement inventory executed
- [ ] Shared fixtures + contract-version drift check live
- [ ] Protocol conformance gates live
- [ ] CI docs updated
