# Phase 6-1 — App: Provider Repo Re-target (new API) + Contract Gates

**Repo:** harmony-ai-app · **Depends on:** 3-2 (API), 5-1 (verify/models), 5-2 (capabilities route) · **Blocks:** 6-2, 6-3, 6-4, 6-5 · Serial app chain
**Refs:** plan.md §3.4 · docs/TESTING.md (engine-contract gates) · plan §11

## Objective

Retarget the provider repo layer to the accounts model, add verify/models/
capabilities client methods, and update the engine-contract gates.

## Implementation steps

1. `providers.ts` rework (13 per-type blocks after 1-2 — the "16-repo"
   wording is stale): replace with one account-typed API:
   `listAccounts(type?)`, `getAccount`, `create`, `update`, `delete`
   (409 → in-use Error carrying `referencing_configs`), `isAccountInUse`
   (best-effort; DELETE 409 authoritative)
2. **Named legacy adapter `src/services/engine/repositories/
   legacyProviderAdapter.ts` (marked `// 6-3 removes this`):** covers ALL
   FOUR VERBS × 13 types (audit: the screen writes via them too —
   L462-503), not just reads:
   - Reads: account-shaped `GET /api/providers/:id` (3-2's merged-object
     guarantee feeds it) → old flat shape
   - Writes: **`src/services/engine/repositories/modules.ts`
     `compositeToFlat`/`flatToWriteBody` (L43-171) re-mapped** — flat
     `provider_config_id` reads and nested-provider composite writes
     become `provider_account_id` + `capability_json` bodies; keeps
     ModuleConfigEditScreen AND VoiceInputSettingsScreen (writes
     `transcription_provider_config_id: null` at L158 — mapped by the
     adapter) compiling and functioning
3. `EngineApiClient` (src/services/engine/EngineApiClient.ts):
   - `verifyProvider({type, api_key, base_url?, extra?})` →
     `{state, detail?, payload?}`
   - `listProviderModels(…, module?)` → `{models: ModelInfo[], voices?}`
   - `getProviderCapabilities()`
   - **Accounts-CRUD transport changes:** createProvider body
     `{provider,config}` → `{type,account}`; get/list account-shaped
     (today's transport: EngineApiClient.ts:1284-1302)
   - `ModelInfo` type mirrors 3-3's shape — declared in
     EngineApiClient.ts (wire-DTO convention; `src/services/engine/
     types.ts` does not exist)
4. **Contract gates:** `src/services/engine/engineContract.ts`
   `REQUIRED_ENGINE_ENDPOINTS` (L188) += accounts/verify/models/
   capabilities + module-config-create pins; loopback `DRIVERS` map
   (engineLoopbackSmoke.test.ts:50-89) gains one driver per manifest id
   (assert at :110-113); **bump `ENGINE_CONTRACT_VERSION` +
   `FIXTURE_CONTRACT_VERSION` '1.5.0' → '1.6.0'** incl. conformance
   expectations (:67-76); update `managementContract.fixtures.ts`
5. `src/database/models.ts`: `ProviderAccount` interface; module-config
   interfaces gain account FK + overlay fields (stt dual); `provider_config_id`
   fields REMAIN during the interim (adapter maps them); `ProviderConfig`/
   `ModuleConfig` unions updated
6. Tests: `engineRepositories.test.ts` (asserts old envelope + per-type
   exports — rewrite; plan §9 names it), mock-fetch tests for all new
   client methods

## Test gates

- `npx.cmd tsc --noEmit` + `npm.cmd run test` green (contract gates
  fail-then-pass against new fixtures; version canary bumped)

## Checklist

- [ ] Accounts API in providers.ts (409 with references)
- [ ] Named legacy adapter (4 verbs ×13) + modules.ts write mapping
- [ ] VoiceInputSettingsScreen kept working via adapter
- [ ] EngineApiClient methods + accounts transport + ModelInfo type
- [ ] REQUIRED_ENGINE_ENDPOINTS + DRIVERS + 1.6.0 bump + fixtures
- [ ] models.ts types (interim provider_config_id kept)
- [ ] tsc + jest gates green
