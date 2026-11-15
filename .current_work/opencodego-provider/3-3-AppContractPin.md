# Phase 3-3 — App engine-contract pin & fixtures

**Repo:** `harmony-ai-app` · **Objective:** pin the app to management contract 1.12.0.

## Steps

1. `src/services/engine/engineContract.ts` — bump `ENGINE_CONTRACT_VERSION` to
   `1.12.0` (mirrors the engine openapi `info.version`, per the header comment).
2. Vendored shared-wire fixtures
   (`__fixtures__/managementContract.fixtures.ts`) — add opencodego shapes:
   provider account entry (type, api_key, base_url), merged provider object for a
   module config (capability overlay with model/sampling), and a models-probe
   response sample. These feed `engineContractConformance.test.ts` and the loopback
   smoke — update both if they enumerate types.
3. Repository adapters — `src/services/engine/repositories/` (provider accounts /
   module configs): only touch if a type-dispatch exists (most are generic over the
   engine DTOs). Grep `openaicompatible` for any per-type branch that needs a sibling.
4. `EngineApiClient` DTOs — extend provider type unions (`ProviderAccountWriteDto`
   etc.) only if they are typed as a literal union.

## Acceptance

- `npm test` green incl. conformance + loopback smoke; About screen shows
  "Management contract 1.12.0".

## Checklist

- [ ] ENGINE_CONTRACT_VERSION → 1.12.0
- [ ] Fixtures + conformance/smoke updates
- [ ] Repository/DTO type sweep (grep openaicompatible)
- [ ] `npm test` green
