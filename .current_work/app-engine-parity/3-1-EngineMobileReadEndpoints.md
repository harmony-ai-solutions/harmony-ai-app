# Phase 3-1 — Engine: Mobile-Optimized Read Endpoints

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.4 (Wails frontend is the proof; add what mobile lists need)
> **Codebase mapping consulted:** `.planning/codebase/` (engine — harmony-link-private): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

Close the read-API gap between what the Wails frontend consumes and what the mobile app's TS repositories currently query locally, so the app can render every screen from the management API without performance regressions.

## Method

1. **Audit (table-driven):** enumerate every read/query in `src/database/repositories/*.ts` (app) and map to an existing management endpoint (engine `management/routes_*.go`) or mark MISSING. Include the JOIN-based chat-list preview query (last message per interaction + two-phase blob loading), paginated message windows, entity/profile listings with filters (favorites, categories), emoji actions, interactions by scope, memory/emotion reads for UI, module/provider config reads (schema-driven forms already mirror these — verify list endpoints suffice).
2. **Design mobile endpoints** for the MISSING rows under `/api/mobile/*` (separate group keeps Wails contract untouched): JSON shapes match the app's existing TS model interfaces **verbatim** (camelCase? — no: engine wire is snake_case per convention; the app adapter layer (3-2) maps, mirroring the established DTO/domain split).
3. Pagination + field projection on every list endpoint (mobile payload discipline); blob fields (audio/image) excluded from list payloads — dedicated `/api/mobile/…/{id}/audio|image` byte endpoints with range support, matching the app's two-phase loading pattern.
4. Auth: loopback token (sidecar issues a short-lived local token at readiness — simplest: bind + random token in the readiness line; management middleware accepts it for loopback peers) — keeps the management API unexposed.

## Implementation steps

1. Produce the audit table (commit it in this phase file's folder as `3-1-endpoint-audit.md`).
2. Implement missing endpoints + tests (management suite pattern).
3. Loopback auth for the sidecar profile (flag from 1-1).
4. Bench: chat-list endpoint vs. app-local JOIN timings on a populated DB (device-class hardware) — record.

## Files to create/modify

- `management/routes_mobile.go` (NEW group) + handlers
- Loopback-token middleware option
- `.current_work/app-engine-parity/3-1-endpoint-audit.md` (audit table, this repo, committed here for cross-repo visibility)
- Engine CHANGELOG.md

## Verification gates

- `go build/vet/test ./...` green; endpoint tests per route
- Audit table shows zero MISSING rows at completion
- Bench numbers recorded

## Risks & rollback

- Scope creep into "new features" — strictly read-only listings; writes continue via existing endpoints/facade
- Payload bloat — projection + pagination enforced by test (max-bytes assertion on fixtures)

## Progress checklist

- [ ] Audit table complete (all TS repo reads mapped)
- [ ] Missing endpoints implemented + tested
- [ ] Loopback auth wired
- [ ] Blob byte endpoints + pagination/projection tests
- [ ] Benchmarks recorded
