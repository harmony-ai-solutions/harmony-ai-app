# Engine-Contract Gates

> **Task 5-1 — Parity Gates Retooling.** The replacement for the retired
> RN↔Go **schema-parity** gate (see
> [`docs/history/schema-parity.md`](history/schema-parity.md)). The app no longer
> keeps a schema, so there is nothing to keep "in parity" — but the app is now
> *more* coupled to the engine: every read and write goes over the embedded
> engine's management REST API. These gates cover the coupling that actually
> remains.

## What replaced what

| Retired (parity tax) | New gate (contract surface) |
|---|---|
| `scripts/dump-schema.ts` + `scripts/compare-schemas.py` + `scripts/parity-allowlist.json` | Shared management-API wire fixtures + mapper conformance |
| `schema/rn-schema.json` baseline | `ENGINE_CONTRACT_VERSION` pin + `REQUIRED_ENGINE_ENDPOINTS` manifest |
| `.github/workflows/schema-parity.yml` | Loopback-transport smoke (app CI) + optional engine-artifact drift job |
| `syncGcTablesParity.test.ts` + schema-parity suites | `engineContractConformance.test.ts` + `engineLoopbackSmoke.test.ts` |
| Cross-repo migration-numbering coordination | (none needed — the engine owns migrations) |

## The gates

### 1. Contract-version pinning (`ENGINE_CONTRACT_VERSION`)

`src/services/engine/engineContract.ts` exports `ENGINE_CONTRACT_VERSION`,
mirroring `info.version` in the engine repo's
`docs/api/management/openapi.yaml` (today `1.0.0`). `checkContractVersion(artifact)`
fails the build when the engine artifact advertises a contract **older** than the
one the TS layer is written against. `checkContractVersionExact` backs the
fixture drift canary.

**Drift canary:** the vendored fixtures advertise the version they were captured
against (`FIXTURE_CONTRACT_VERSION`); `engineContractConformance.test.ts` asserts
it equals `ENGINE_CONTRACT_VERSION`. Bumping one side without the other fails.

### 2. Shared wire fixtures + mapper conformance

`src/services/engine/__fixtures__/managementContract.fixtures.ts` holds golden
wire payloads **typed as the wire DTOs** — so `npx tsc --noEmit` already fails if
a fixture drifts from a declared DTO shape. `engineContractConformance.test.ts`
round-trips each fixture through `engineApiMappers` and asserts the coercions
(RFC3339 → `Date`, `*bool` → boolean, snake → camel projection).

**Hosting:** the canonical copy lives in the engine repo at the pinned path
`docs/api/management/fixtures/management-contract.fixtures.json` (the plan's
"engine hosts, app CI fetches a pinned path" choice). The app **vendors** a
typed TypeScript copy (`__fixtures__/managementContract.fixtures.ts`) — typed as
the wire DTOs so `tsc` catches fixture↔DTO drift — and its `contract-drift` CI
job fetches the engine-side canonical file and compares the contract version,
the endpoint manifest (ids/methods/paths) and the fixture key set. Keep the two
copies in sync.

### 3. Endpoint manifest

`REQUIRED_ENGINE_ENDPOINTS` is the machine-checkable list of management endpoints
the TS layer depends on (method + `/api/.../:param` template + fixture key).
`engineLoopbackSmoke.test.ts` builds the mock server **from this list**, so a
client whose request path/verb drifts without a manifest update gets a 404 and
fails the suite — the "no orphaned paths" half of the gate.

### 4. Loopback-transport smoke

`engineLoopbackSmoke.test.ts` drives the real `EngineApiClient` over a loopback
base URL (`http://127.0.0.1:<adminPort>`) against the in-memory mock management
server, asserting the per-process `X-Loopback-Token` is carried and that a 404
byte fetch degrades to `null`. This stands in for the plan's "mock engine binary
artifact where feasible" — no engine process, no network.

## Running the gates

```bash
npx tsc --noEmit                       # fixture ↔ DTO shape (compile-time half)
npx jest --selectProjects unit --testPathPatterns engineContract
npx jest --selectProjects unit --testPathPatterns engineLoopbackSmoke
```

All four are part of the single `unit` jest project, so `npm test` runs them in
CI with no extra wiring.

### Optional engine-artifact drift job

`scripts/check-engine-contract.mjs` compares the app's `ENGINE_CONTRACT_VERSION`
with the engine repo's `docs/api/management/openapi.yaml` `info.version`, and
(with `--engine-fixtures`) the app's endpoint manifest + fixture keys with the
engine-side canonical shared wire fixtures at the pinned path. It runs in the
`contract-drift` job in `.github/workflows/test.yml` **only when the
`HARMONY_LINK_REPO_PAT` secret is present** (the engine repo is private); without
it the job is a no-op skip. Run locally:

```bash
node scripts/check-engine-contract.mjs \
  --engine-repo ../harmony-link-private \
  --engine-fixtures ../harmony-link-private/docs/api/management/fixtures/management-contract.fixtures.json
```

## Retirement inventory (reconciled with reality)

Phase 3-4 already removed most of the outgoing parity machinery (its deletion is
in the working tree, uncommitted). Task 5-1 verified each item against the repo
and only actioned what **survived**:

| Item | State | Owner |
|---|---|---|
| `scripts/dump-schema.ts`, `scripts/compare-schemas.py`, `scripts/parity-allowlist.json`, `scripts/tsconfig.json` | **already deleted by 3-4** (unstaged) | 3-4 |
| Schema-parity test suites (`syncGcTablesParity.test.ts` + siblings) | **already deleted by 3-4** | 3-4 |
| `.github/workflows/schema-parity.yml` | **already deleted by 3-4** | 3-4 |
| `build-release.yml` `schema-parity` job | **already removed by 3-4** | 3-4 |
| `test.yml` integration/migration jobs | **already removed by 3-4** (single `unit` project) | 3-4 |
| `docs/schema-parity.md` | retirement note added by 3-4; **moved to `docs/history/` by 5-1** | 5-1 |
| `schema/rn-schema.json` (stale RN baseline) | **retired by 5-1** (survived 3-4) | 5-1 |
| `scripts/.package.json.additions.json` (orphan helper referencing deleted `dump-schema.ts`) | **retired by 5-1** | 5-1 |
| Cross-repo migration-numbering convention | dead by construction; doc refs retired in 5-1 | 5-1 |

## Carried v1 limitations (engine-side, NOT 5-1 scope)

Phase 2-4 flagged two engine-side limitations "for 2-5 / 5-1". Task 5-1 is a
gates-retooling task and the engine repo is read-only here, so neither is
implemented app-side; both are recorded here as **documented v1 limitations**:

1. **Baseline adoption is staged, not hot-applied.** The sync client receives and
   stages the rejoin baseline (`Client.BaselinePath()`) but v1 does not swap/merge
   the live SQLite handle mid-session (adoption is a host-boundary operation).
2. **Per-connect baseline until delta-seed lands.** The client's per-connection
   handler starts with no peer position, so its first `EPOCH_STATE` sets
   `need_rejoin` and the authority serves a baseline **on every connect**; the
   delta path needs a persisted `(epoch, seq)` tracked across connections.

Both live in the engine's `syncclient` package; see the engine repo's
`.current_work/app-engine-parity/2-4-GoSyncClientRole.md` §"Implementation notes".
Seeding the persisted tracking position is the follow-up.

## Notes for 5-2 (docs affected by the retool)

- This document is the new canonical description of the app's engine-coupling
  gates; `docs/TESTING.md` and `CONTRIBUTING.md` now point here instead of
  `schema-parity`.
- The engine repo's `docs/api/management/openapi.yaml` `info.version` is the
  contract-version source of truth; its bump procedure is documented engine-side
  in `docs/Management-API-Versioning.md`.
- The engine-side canonical shared wire fixtures now live at
  `docs/api/management/fixtures/management-contract.fixtures.json`; the app's
  `contract-drift` job fetches that pinned path (5-2 landed the engine hosting
  half).
- `docs/history/` is the retirement home for superseded gate docs.
