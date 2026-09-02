# 4-1 — Docs, Memory Bank & Final Verification

> Orchestrator-run after waves 1-3. Both repos.

## Documentation (per `.roo/rules/workspace-rules.md`)

1. **Memory bank** (both repos; `.toon` files FIRST if present, then `.md`): app — Voice input feature, test panels, LWW-safe canonical-mapping semantics; engine — canonical inheritance, test endpoints, frontend Personas tab.
2. **App `CHANGELOG.md`**: user-facing entries only (no identifiers/file names): shared Voice input setting for personas; record-to-test STT/VAD; listen-to-test TTS; desktop: persona management tab.
3. **Docs/**: app `docs/` + engine `docs/` — update only pages that describe module config/entities/personas (grep for stale statements); README sync only if capabilities lists exist.

## Final gates

| Gate | Expected |
|---|---|
| Engine `go build` / `go vet` / `go test ./...` | 0 / 0 / all green |
| Engine `cmd /c "go run . dump-schema > NUL"` | exit 0 |
| Frontend `npm.cmd run build` (in `frontend/`) | exit 0 |
| App `npx.cmd tsc --noEmit` | 0 |
| App full `npm.cmd test` | green (nodeSide isolated 23/23 if the parallel flake trips) |
| **Parity sanity** (no migrations expected): fresh `rn-final2.json` + `go-final2.json` dumps → `python scripts\compare-schemas.py` | exit 0, exactly 3 allowlisted Go-only, 0 different-SQL |
| `gitnexus_detect_changes` both repos | only expected symbols; indexes refreshed (`npx.cmd gitnexus analyze`) |
| Grep sweeps | `createUserPersona` still creates NO mapping row (by design — comment present); no app-side ensure-create of the canonical mapping; no RAG UI on user-entity views |

## Gate results (orchestrator-verified)

All gates were run fresh by the orchestrator (2026-09-02) against the final tree; results cited as-is:

| Gate | Result |
|---|---|
| Engine `go build` / `go vet` / `go test ./...` | 0 / 0 / all green (incl. eventserver suite) |
| Engine `dump-schema` | exit 0 |
| Frontend `npm.cmd run build` (in `frontend/`) | exit 0 |
| App `npx.cmd tsc --noEmit` | 0 |
| App full `npm.cmd test` | 120 suites / 1016 unit + 10 suites / 50 integration pass (+1 skip) |
| Parity sanity (`compare-schemas.py`) | exit 0 — 0 RN-only, 3/3 allowlisted Go-only, 0 different-SQL |
| `gitnexus_detect_changes` (both repos) | expected symbols only; indexes refreshed |
| Grep sweeps | `/api/modules/test` = 0 in source/docs; `createUserPersona` still creates NO mapping row; no app-side ensure-create of the canonical mapping; no RAG UI on user-entity views |

## Deviations

- **Architecture changed mid-plan:** the HTTP module test API (1-2) was **REMOVED** — the management server is not cloud-reachable. The app's test panels now run over **eventserver** `debug` sessions using existing STT/TTS events; the HTTP client was deleted. The engine HTTP test endpoints were removed. No doc/README references them (only retained plan-history docs in `.current_work/` mention them, deliberately kept).
- **Personas DO have shared modules:** user entities resolve modules from the canonical `user` entity's mapping (not "all modules disabled"). Docs reflect this final state.
- **`debug` device/session type exists** and is the transport for the test panels; not a documented user-facing HTTP API.
- **Known app gaps (documented, not blocking):** live VAD streaming is a follow-up; the **TTS test panel is currently runtime-disabled** (no config-editor entry path carries an entity binding — `entityId` prop reserved for future wiring).

## Checklist

- [x] Memory banks updated (.toon first) — app `activeContext`/`progress`, engine `activeContext`/`progress`
- [x] CHANGELOG + docs synced — app `CHANGELOG.md`; docs sweep: no stale statements found
- [x] All gates green, outputs recorded in this file's deviations section
- [x] `summary.md` all boxes ticked
