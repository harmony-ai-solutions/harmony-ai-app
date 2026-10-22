# Provider Registry & Config UX — Design Plan

Status: **APPROVED — owner confirmed 2026-10-18; audit round (28 reviewer
agents) incorporated same day, decisions in §11.**
Created 2026-10-18 from the provider-topic audit + owner rulings.

Repos: `harmony-ai-app` (app UI/repos), `harmony-link-private` (engine: schema,
migration, management API, seeding). Engine ships inside the app as the sidecar,
so one engine migration runs identically on every device at first boot of the
new version — there is no separate app-side DB migration.

---

## 1. Problem (verified 2026-10-18)

1. **Provider configs are fused account+capability rows, minted per module
   config.** Every module config owns its provider row(s) (STT owns two:
   transcription + VAD). No path — UI or API — attaches an existing provider
   row to a second module config, even though the `provider_config_id` FK
   would allow it. One OpenAI key used by backend + cognition + movement +
   imagination + vision is stored 5+ times.
2. **Operational pain already exists:** cloud token rotation needs
   `RefreshAllActiveTokens` — a fan-out UPDATE across every `soulbitscloud`
   row — plus a historical fix for rows whose `base_url` drifted across
   flavors (duplication-induced drift).
3. **Seeding is engine-only and half-blind (corrected 2026-10-18):** the
   engine DOES seed empty DBs (`config/db/init.go createDefaultData`, live
   via `run.go setupDatabase → InitializeDatabase`): entity 'claire' + user
   STT across 7 module types on soulbitscloud — but with **empty api_key**
   (the token only arrives post-sign-in), per-module duplicated rows
   (problem 1), imagination skipped, and a backend default
   (`starfallen-24b`) that drifts from the app fallback (`qwen-35-9b`)
   and lacks its gateway `INSERT`. No app-side ensure/key-fill exists.
4. **Config UX is cumbersome:** provider values are edited embedded inside a
   module-config form; the `sampling_preset_name` field is a blind text input
   even though the engine ships a full preset system (YAML presets, cache,
   server-side application, `GET/POST/DELETE /api/presets`). Model selection
   is free text everywhere.
5. **Not redundant (no change needed):** the entity layer. Entities share
   module configs via `entity_module_mappings` FKs; new entities start
   all-null. Duplication stops at the module-config layer.

## 2. Rulings (locked, owner 2026-10-18)

| # | Ruling |
|---|--------|
| R1 | Shared provider configs **for the account/credential part** (keys, tokens, base URLs). Endpoints & capabilities stay **module-level** — a provider may offer different endpoints/capabilities per module. |
| R2 | Registry shape: **Option B — one unified `provider_accounts` table**; the 16 `provider_config_*` tables are retired. Sync surface changes 35 → 20 tables. |
| R3 | Capability fields move onto module configs as a **capability overlay**. |
| R4 | Migration **auto-merges identical rows** (group by type + api_key + base_url → one account). |
| R5 | Pre-seeding scope: **full default set** — soulbitscloud account + default config for every applicable module type. soulbitscloud serves all seedable modules incl. STT transcription **and VAD** (audit correction 2026-10-18: the gateway offers `silero-vad` and the engine seeds it today; the original "VAD stays unset — no cloud VAD" premise was wrong). |
| R6 | UX backbone: **presets for all providers and models**. Sampling presets reuse the engine's existing (unpolished, app-side) system; model presets are a curated catalog. |
| R7 | **App UX first**, then engine data model. The engine's own UI is undergoing a separate rework — out of scope here. |
| R8 | Plan-first engineering; owner confirms before implementation starts. |
| R9 | **Remove Kajiwoto, Character.AI, and Kindroid completely** (owner feedback 2026-10-18): all three are direct competitors of the upcoming Soulbits platform; keeping them in the product is a legal risk. Removal covers provider clients, repos, models, config, management routes, sync tables, app constants/screens/repo adapters, and a data migration that **hard-deletes** existing user configs of the removed providers (owner ruling 2026-10-18). Ships in the single big release. |
| R10 | **Key validation + live model fetch in the UI:** every provider config gets an immediate "is this API key valid?" check; module configs get model fetching from the provider's API. Both run engine-side (`POST /api/providers/verify`, `POST /api/providers/models`) reusing the engine's provider clients — no JS-side client duplication. |
| R11 | **Research preface (Phase R):** one code-expert subagent session per remaining provider (13), researching API mechanics, key verification, model listing, and model capabilities — the foundation for R10 + R12. Read-only; outputs to `.current_work/provider-registry/research/`. |
| R12 | **Model capability catalog as engine-embedded data** (not DB): `go:embed` JSON in the engine, boot-parsed like the preset cache; carries model→capability rows AND per-provider parameter-name mapping. Consumed via management API. Merge order: live API discovery > static catalog > user override (warn, don't block). |

## 3. Target data model (scoped against research, 2026-10-18)

### 3.1 `provider_accounts` (new, synced) — 13 types after Phase 0

```sql
CREATE TABLE provider_accounts (
  id         TEXT PRIMARY KEY,          -- engine-minted
  type       TEXT NOT NULL,             -- one of the 13 surviving provider types
  name       TEXT NOT NULL,             -- user label ("Personal OpenAI key")
  api_key    TEXT NOT NULL DEFAULT '',  -- empty = keyless self-hosted
  base_url   TEXT,                      -- NULL → provider's canonical default
  extra      TEXT NOT NULL DEFAULT '{}',-- typed account-level extras (below)
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME                   -- soft delete (in-use → 409, as today)
);
CREATE INDEX idx_provider_accounts_type ON provider_accounts(type);
```

Per-type account semantics (research-derived — SYNTHESIS §1/§2 and the
per-provider docs are authoritative):

| type | api_key | base_url | `extra` contents |
|---|---|---|---|
| openai | required; format check cosmetic (no checksum — never block on shape) | NULL (rare proxies) | `org`, `project` → `OpenAI-Organization` / `OpenAI-Project` headers |
| anthropic | required | NULL | — (`anthropic-version` is client-managed) |
| google | required (`AQ.` new / `AIzaSy…` legacy) | NULL (fixed default) | — |
| xai | required | optional | `team` scoping if exposed |
| mistral | required | optional **regional**: `api.` / `api.eu.` / `us.mistral.ai` (feature/price differences) | — |
| openrouter | required | optional | attribution (`HTTP-Referer`/`X-Title` — already set engine-side) |
| elevenlabs | required | optional | — |
| openaicompatible | optional (bearer/basic per server) | **required** | auth style hint (else fingerprinted at verify) |
| ollama | optional (**proxy auth only** — server itself is keyless; field absent in app today) | **required** | — |
| localai | optional (`LOCALAI_API_KEY`) | **required** | — |
| comfyui | optional (proxy token; stock has no auth) | **required** | auth style basic/bearer (research: client only sends bearer today); `comfyui_mode` (engine-persisted wrapper-vs-native detection, 4-10) |
| soulvoice | optional (`HARMONYSPEECH_API_KEY`) | **required** | — |
| soulbitscloud | **system-managed PASETO** (rotation writes it) | **managed** — flavor inference host, never user-edited | auth-mode switch (v4.local) |

Precedent: `soulvoice` already splits account (`endpoint`/`api_key`) from
per-use voice config today — this table formalizes that shape for all types.

### 3.2 Module configs (8 tables, additive columns)

```sql
-- every module config table gains:
provider_account_id TEXT,               -- FK → provider_accounts.id, shared
capability_json     TEXT NOT NULL DEFAULT '{}',

-- stt_configs (two provider slots) gains:
transcription_provider_account_id TEXT,
vad_provider_account_id           TEXT,
transcription_capability_json     TEXT NOT NULL DEFAULT '{}',
vad_capability_json               TEXT NOT NULL DEFAULT '{}',
```

- Old `provider_config_id` / `*_provider_config_id` columns are dropped in the
  same migration.
- Module-specific behavioral knobs (`max_cognition_events`, `output_type`,
  `startup_sync_timeout`, …) stay as typed columns — unchanged.
- The overlay JSON is validated per (provider type × module) by the split
  validation (see 3.5). App-side the schema source stays
  `providerFieldSchemas.ts`, split into account vs capability sections.
- **Overlay contents are research-scoped per type** (SYNTHESIS §2/§3):
  `model` everywhere; `voice`/`voice_id` for speech-capable types
  (elevenlabs/openai-tts/soulvoice); reasoning/thinking config only where
  model-gated (anthropic thinking, gemini `thinkingLevel`/`thinkingBudget`
  — never both, xai/mistral `reasoning_effort` with per-model value enums);
  sampling params present but **capability-gated at emission** (§3.5 —
  deprecation wave); `sampling_preset_name` (engine-applied);
  `stop_tokens`/`response_format`/format fields per type.
- **Account-scoped references:** model/voice ids inside the overlay are
  meaningful *relative to the linked account* (ElevenLabs voices are
  per-account; local servers expose only installed models; xAI retired slugs
  silently redirect). Switching an account therefore triggers availability
  revalidation of the overlay's refs — the UI marks stale refs and offers a
  live re-fetch (`POST /api/providers/models`), it never silently drops them.

### 3.3 Sync surface (breaking, deliberate)

- Remove the remaining 13 × `provider_config_*` (Phase 0 already dropped the
  3 competitor tables: 35 → 32), add `provider_accounts` → **32 → 20** tables.
- Update both pinned lists + their parity tests:
  `eventserver/sync_handshake.go registeredSyncTables`,
  `database/changesetstore SyncTables()` + `policy_test.go` coverage list and
  the `assert.Equal(t, 35, …)` count.
- Mixed-version window: an old-engine device emits changesets for tables the
  new engine no longer has (and vice versa). Single-user fleet → mitigation is
  sequencing: **upgrade all devices in quick succession** (dev channel first,
  owner confirms before prod). No compat shim planned; revisit if a multi-user
  fleet ever materializes.

### 3.4 Management API

| Area | Change |
|---|---|
| `GET /api/providers` | Returns accounts grouped by type (same `{providers:{type:[…]}}` envelope; rows are account-shaped). |
| `POST /api/providers` | `{type, account:{name, api_key, base_url, …}}` — creates a **shared account**; no module binding. |
| `PUT /api/providers/:id` | Partial account update. |
| `DELETE /api/providers/:id` | 409 `provider_in_use` when any live module config references it. |
| Module-config create | Body carries `{provider, provider_account_id, capability_json, …}` — **no row minting**. |
| Module-config update | Updates overlay + module columns only; account switch = repoint FK. |
| Module-config read | Continues inlining the **merged** provider object (account fields + overlay) under the `<provider>` key — app read path stays shape-compatible. |
| `POST /api/providers/soulbitscloud/refresh-token` | Keeps working; with one account row it degenerates to a one-row update (also corrects `base_url`). |
| `POST /api/providers/verify` | `{type, api_key, base_url?, extra?}` → `{state, detail?, payload?}` where `state ∈ valid \| invalid \| throttled \| blocked \| scope_limited \| unreachable` (SYNTHESIS §1 — the taxonomy held on all 13 providers; e.g. Google: *only* 400 `API_KEY_INVALID` is invalid; OpenAI 403/429 are valid-but). `payload` carries provider extras for the UI: ElevenLabs tier + character quota + reset, OpenRouter budgets/usage, ComfyUI version + VRAM, Ollama/soulvoice version. Per-provider verify calls are pinned in SYNTHESIS §1 (OpenRouter `GET /api/v1/key` — **not** `/models`, which is unauthenticated; soulbitscloud `POST /v1/chat/completions {}` — its `/v1/models` is public). No DB writes; never blocks save. |
| `POST /api/providers/models` | `{type, api_key, base_url?, extra?}` → `{models: [ModelInfo]}` — executes the provider's **discovery recipe** (SYNTHESIS §2): xAI merges `/v1/models` + `/v1/language-models` by id; soulvoice fans out per-capability endpoints; comfyui enumerates per-node `object_info`; openaicompatible runs the fingerprint tree first. `ModelInfo = {id, label?, context?, modalities?, capabilities?, param_support?, source: live\|catalog, provenance: detected\|known\|assumed}`. For elevenlabs this also returns account voices (live-only, never catalogued). |
| `GET /api/providers/capabilities` | Static catalog + per-provider param-name mapping (§6.3) for offline pickers and param filtering. |
| Presets (unchanged) | `GET/POST/DELETE /api/presets` already exist; the app starts consuming them. |

### 3.5 Validation + runtime resolution (research-scoped)

- `ValidateProviderConfig(module, provider, cfg)` splits into account
  validation (per type: key/base_url required per the §3.1 matrix — **key
  format checks are cosmetic** (OpenAI has no checksum) and never block) and
  capability validation (per type × module: overlay JSON against the
  capability schema + the §6.3 merged capability set — warn, don't block).
- Each module's `ProviderConfig()` resolution merges account + overlay into
  the same struct shape `p.FromConfig(...)` consumes today — the integration
  layer's contract is unchanged.
- **Capability-gated param emission** (the deprecation-wave fix, SYNTHESIS
  §4): sampling params are only emitted when the resolved model's capability
  set includes them (Anthropic 4.7+/Gemini 3.6+/xAI reasoning models reject
  or ignore them), and Go zero values must be treated as *unset* — never emit
  `temperature: 0`-style defaults (today's 400-bug, fix #1).
- **Wire-name mapping from the catalog** (§6.3) at emission time: `seed` →
  `random_seed` (mistral); `max_tokens` vs `max_completion_tokens` (openai;
  mistral accepts neither in the OpenAI sense); `repeat_penalty` native names
  on ollama/localai; `top_k` travels via `extra_params` on generic
  openaicompatible; `num_predict` ↔ `max_tokens`; `think` ↔
  `reasoning_effort`.
- **Strict-passthrough rules:** mistral `additionalProperties:false` → any
  unknown param is a 422 — the emitter must filter, not pass through;
  soulbitscloud gains `tools`/`tool_choice` passthrough (fix #9).
- `isProviderConfigInUse` (app-side best-effort derivation) re-targets
  `provider_account_id`.

## 4. Migration (single engine migration, runs on every device)

1. Create `provider_accounts`.
2. Per old `provider_config_<type>` table (13 remain after Phase 0), read
   non-deleted rows; group by
   `(type, api_key, base_url)`; insert **one account per group** (keep the
   first row's id, prefer the longest name / earliest created).
3. Per module config (incl. STT ×2 slots): serialize the referenced provider
   row's **capability fields** into `capability_json`; set
   `provider_account_id` to the merged account; drop old FK columns.
4. Drop the 13 old tables (Phase 0 already removed 3 of the original 16).
5. Change-set tables untouched; sync-surface lists updated in code (3.3).

Post-migration invariant: exactly one account row per real credential.

## 5. Seeding (full set, R5 — division per §11 A9)

**Engine = structural seeder; app = token + gap-fill.** The engine's
reworked `createDefaultData` (3-1) seeds every EMPTY database: one
soulbitscloud account (empty `api_key`) + default configs for the 7
seedable module types (imagination skipped — skip-when-no-model), STT
transcription AND VAD slots (`silero-vad`, A8), backend default aligned
to `qwen-35-9b` (A10). The app-side ensure-flow (6-4) then:

1. **Token, on every cloud authentication AND re-authentication/token
   renewal (A9):** ensure the soulbitscloud account carries the current
   PASETO (`{api_key, base_url: CLOUD_HOSTS.inference}`; update-if-exists
   — subsumes token rotation). Engine-side refresh surfaces
   (refresh-token route, cloud-mode refresh) stay authoritative for their
   paths and converge on the same single account row.
2. **Gap-fill (idempotent, never overwrite):** per module type (7) and
   per STT slot (transcription, VAD), if the user has zero configs of
   that type/slot → create `Soulbits Cloud (default)` referencing the
   account. Default selection reads the gateway's model metadata
   (`model_type`/`min_tier` via ModelInfo.meta — §3.4); fallback = the
   app's existing `SOULBITS_FALLBACK_MODELS` constants (ids documented in
   research/soulbitscloud.md §8.3; aligned with the engine seeder, A10).
   On fresh installs the engine seeder already created everything — the
   app flow no-ops by design.

## 6. Presets (R6)

### 6.1 Sampling presets — reuse the engine system

- Engine already: YAML presets (TextGen WebUI-compatible) in `presets/`,
  boot-time cache, server-side application via `sampling_preset_name`, full
  `GET/POST/DELETE /api/presets` CRUD.
- App: replace the blind text input with a **dropdown fed by
  `GET /api/presets`**, with a param-preview (fetch `:name`, show which
  values it overrides) and "Manual" option. Preset name stays a capability
  field (lives in the overlay).

### 6.2 Model presets — catalog-backed pickers

- The capability form's model field becomes a **picker** backed by the
  capability registry (§6.3), with "Custom…" falling back to free text and
  "Fetch from provider" doing a live `POST /api/providers/models` (R10).
- Catalog/registry lives engine-side (§6.3); Phase 1 interim may use an
  app-side constant distilled from the research docs, replaced when the
  engine registry lands.

### 6.3 Capability registry (R12) — discover → augment → override

- **Tier 1 — live discovery:** prefer what the provider API reports at runtime
  (OpenRouter `supported_parameters` per model; Google
  `supportedGenerationMethods`; Mistral/xAI capability dicts). Always current,
  zero maintenance.
- **Tier 2 — static catalog:** engine-embedded `go:embed` JSON (boot-parsed,
  preset-cache-style; **not** in the DB). **Upstream source: models.dev**
  (owner suggestion, verified 2026-10-18: MIT-licensed, actively maintained,
  canonical model DB with context/output limits, reasoning/tool/structured/
  temperature flags, open-weights links, ~100 serving providers incl. local
  families). A **release-time codegen script** fetches the JSON snapshot,
  filters to our 13 provider types, and maps it onto our catalog schema
  (ModelInfo) — the same vendoring pattern as the engine sidecar refresh.
  **Our overlays stay ours** (models.dev is provider-agnostic): param-name
  mapping, reasoning_effort enums, wire quirks, verify recipes. MIT
  attribution preserved in the generated file header + About credit.
  **Not a runtime dependency** (privacy/offline/availability); catalog
  freshness rides release cadence, live tier 1 covers in-between changes.
  Cross-validation bonus: models.dev's temperature flags independently
  confirm the research deprecation-wave findings (Claude temp=No,
  Gemini 4 temp=No).
- **Tier 3 — user override:** `capability_json` may set anything; the UI
  *warns* on unsupported params, never hard-blocks.
- **OpenAI-compatible auto-detect:** server fingerprinting (Ollama `/api/tags`
  → model families + quantization; LM Studio `/api/v0/models` → max context;
  vLLM `/version`) + model-id family signatures (`qwen…`, `deepseek…`,
  `llama…`, …) → best-effort capability set, labeled `detected` / `known` /
  `assumed` in the UI. **Family-signature tables are generated from
  models.dev's open-weights canonical models** at release time (same codegen
  as Tier 2) — near-zero maintenance, wide coverage.
- Merge order at read time: live > catalog > user; provenance surfaced in the
  picker (chip per source).

### 6.4 Research phase (R11) — **COMPLETE (13/13 + synthesis)**

Per-provider docs: `.current_work/provider-registry/research/<provider>.md`.
Cross-provider decisions consolidated in
`.current_work/provider-registry/research/SYNTHESIS.md` (verify-state
matrix, discovery recipes, catalog scope, engine-fix list, seeding
defaults). Headline outcomes: the `valid|invalid|throttled|blocked|scope_limited|unreachable`
verify taxonomy held on all 13; discovery is recipe-based per provider
(xAI merges two endpoints; Ollama/LocalAI/LM Studio expose local
capability metadata; ElevenLabs voices are live-only); catalog needed
most for OpenAI/Google/Mistral + the param-name mapping table
(load-bearing); a sampling-param deprecation wave (Anthropic 4.7+,
Gemini 3.6+/4, xAI reasoning) makes capability-gated param emission the
top correctness fix; 11 pre-workstream engine bugs catalogued
(SYNTHESIS §5). SoulbitsCloud research resolves §10.1 with a proposed
seeding table (SYNTHESIS §6) — seeding code should read defaults from
gateway model metadata, not hardcode.

## 7. App UI plan

### Concept: provider (type) vs account (instance)

The two-step header mirrors the data model's FKs exactly. The **provider** is
a *type* — it selects the protocol, the capability field schema, the param
mapping, and the catalog slice (and is module- and variant-filtered as
today). The **account** is a *credential instance* of that type — the shared
row from `provider_accounts` that many module configs reference. Switching
provider re-renders the capability form; switching account changes only
which key/endpoint serves this config, keeping capability values (with
account-scoped model/voice refs revalidated, §3.2). This is the direct UI
consequence of R1: keys entered once, rotated once, referenced everywhere —
and it generalizes what soulvoice already does informally
(endpoint/api_key vs per-voice config). Flows it unlocks: personal vs work
keys of the same provider side by side; desktop vs home-server Ollama
endpoints; rotating one key everywhere at once. UX guard: when only one
account of the chosen type exists, the step auto-collapses to a caption
("Using: Personal key — add another"), so simple setups never see a
two-picker wall.

### New: Providers settings screen

- List of accounts grouped by provider type (variant-filtered via
  `providerAvailability`): name, masked key, base_url, in-use badge
  (referencing module configs).
- Add / edit (name, api_key, base_url) / delete (409 → explain usage).
- **"Test key" button** (R10): `POST /api/providers/verify` → inline
  valid/invalid + provider detail (e.g. plan/tier when the API returns it).
  Also runs automatically once after account save.
- Later hook: sampling-preset management (list/upload/delete YAML).

### ModuleConfigEditScreen rework (flow, not one giant form)

```
1. Provider      — module-filtered picker (variant-aware, unchanged source)
2. Account       — picker over existing accounts of that type (+ "Add account…")
3. Capability    — capability-only fields w/ model picker (§6.2) +
                   **"Fetch from provider" (live model list via
                   POST /api/providers/models)** + sampling preset dropdown
                   (§6.1) + advanced params collapsed by default; params the
                   selected model doesn't support are hidden/downgraded to
                   warnings via the capability registry (§6.3)
4. Module        — module-specific knobs (unchanged fields)
```

- Same flow drives creation and edit; switching provider keeps the account
  picker honest (accounts are per type).
- `moduleDefaults` splits accordingly; STT's dual-slot form maps 1:1 to the
  two overlay columns.

## 8. Phasing (research first; Phase 0 removal runs alongside R — disjoint surfaces)

| Phase | Repo | Content | Depends on |
|---|---|---|---|
| **R — Provider research (R11)** | docs only | **COMPLETE 2026-10-18** — 13 provider docs + SYNTHESIS.md (§6.4). | — |
| **0 — Competitor removal (R9)** | engine + app | Delete Kindroid / Character.AI / Kajiwoto entirely: engine API clients (`providers/{kindroid,characterai,kajiwoto}.go`), registry entries, config structs/constants, models + repos + tests, module wiring (`modules/backend.go`, `modules/tts.go` refs), controller/mapper branches, management routes, sync tables (3 of 35 → **32**); app constants (moduleConfiguration, moduleDefaults, providerFieldSchemas, moduleConfigVisibility), `models.ts` interfaces, `ModuleConfigEditScreen` repo-map entries, `providers.ts` adapters, fixtures/tests. Engine migration: drop the 3 `provider_config_*` tables AND **hard-delete** module configs referencing the removed providers (owner ruling — no disabled-sentinel preservation). Branch-local; ships with the big release. | nothing — legal priority |
| **1 — Preset UX** | app | Model catalog + model pickers; sampling-preset dropdown via existing engine API; form restructure (sections, collapsed advanced). **No schema/API change.** Catalog covers the remaining 13 provider types. | phase 0 merge |
| **2 — Engine data model + client rework** | engine | (a) `provider_accounts`, overlays, migration (§4; iterates the remaining 13 old tables; sync surface 32 → 20), API (§3.4 incl. verify/models/capabilities), split validation, sync-surface parity tests. (b) **All 11 pre-workstream fixes** (SYNTHESIS §5 — owner ruling: folded here, no hotfix release). (c) **Activate dormant providers**: Ollama native `/api/chat` client, Mistral chat client, LocalAI via openaicompatible + capability endpoints. (d) **ComfyUI re-target** to native + wrapper auto-detect. (e) Capability-gated param emission (deprecation wave fix). | phase 1 merge |
| **3 — Account UX + seeding** | app | Providers screen; account picker; capability-only forms; seeding driver (§5); `providers.ts` repo re-target; picker entries for reactivated providers; management-contract fixtures + engine repo tests update. | phase 2 API |
| **4 — Ship (the single big release)** | both | Everything lands as ONE engine+app release (owner ruling): new `ENGINE_SIDECAR_VERSION`, app version bump, full gate suite; devices upgraded in quick succession (§3.3). | 0–3 |

## 9. Testing & gates

- Engine: `go build/vet/test` with
  `$env:CGO_CFLAGS='-DSQLITE_ENABLE_PREUPDATE_HOOK -DSQLITE_ENABLE_SESSION'`;
  migration round-trip test (old-schema fixture DB → migrate → invariants:
  one account per credential, overlays populated, module configs intact);
  parity-test count updates.
- App: `npx.cmd tsc --noEmit`, `npm.cmd run test`;
  `managementContract.fixtures.ts` + `engineRepositories.test.ts` rewrites;
  ModuleConfigEditScreen/ProvidersScreen component tests.
- Known gap (pre-existing): 4 flaky suites under `jest --randomize` — not in
  scope.

## 10. Open questions for the owner

-1. ~~**ComfyUI client re-target**~~ **RESOLVED (owner 2026-10-18): native
  ComfyUI + auto-detect wrapper-vs-native** (probe recipe in
  `research/comfyui.md`) — folded into Phase 2 scope.
-0.5. ~~**Dormant providers**~~ **RESOLVED (owner 2026-10-18): ACTIVATE all
  three.** Ollama gets a native `/api/chat` client (capabilities enum, native
  params); Mistral gets a chat client (14-boolean live capabilities,
  `random_seed`, `additionalProperties:false`); LocalAI rides the
  openaicompatible client with its capability endpoints in the discovery
  recipe. Picker entries + defaults re-enabled — engine in Phase 2 (docs
   4-7/4-8/4-9), app side in doc 6-5.
0. ~~**Phase 0 data handling**~~ **RESOLVED (owner 2026-10-18):
  HARD-DELETE.** Module configs referencing Kindroid/Character.AI/Kajiwoto
  are deleted together with the credential rows (no disabled-sentinel
  preservation).
1. Soulbitscloud default model lineup for the 8 module overlays — **proposal
   ready** (SYNTHESIS §6): seeding reads defaults from gateway model metadata
   (tier/type-filtered), doc table as fallback. Owner approves during plan
   review.
2. Providers screen placement: top-level Settings section (recommended) vs
   nested under an existing group. Default applies unless objected in review.
3. ~~**Release cadence**~~ **RESOLVED (owner 2026-10-18): ONE BIG RELEASE.**
   All phases (0+1+2+3) incubate on the branch and ship together as a single
   engine+app release. No interim dev releases for this workstream.

## 11. Audit-round decisions (owner, 2026-10-18)

28 reviewer agents audited plan.md + all phase docs against the code;
validated findings were resolved by owner ruling (amendments applied to
the phase docs same day):

| # | Decision |
|---|---|
| A1 | **Serial execution per repo.** Engine chain (1-1→3-1→3-2→3-3→4-1…4-13→5-1→5-2) and app chain (1-2→2-1→2-2→6-1→6-3→6-4→6-5) each run one implementation subagent at a time; the two chains run in parallel (disjoint repos). Resolves shared-file contention (registry.go/config.go/dispatch) and the single-working-tree constraint. |
| A2 | **Ollama audio gated on research:** the R-AUDIO pre-task (Ollama TTS/STT wire protocol) must complete before any ollama tts/stt registration or picker entries; chat/cognition/movement/vision/rag proceed regardless. |
| A3 | **Preset semantics:** presets supply DEFAULTS; explicit local values override (engine truth, providers/openai.go:129-193). UI labels accordingly. |
| A4 | **Release channel: dev only.** Dispatch-only (engine android_only + AppVersion constant bump — never a tag), app publish_latest; no prod release in this workstream. |
| A5 | **Soulvoice voice configs stay file/URL-based** (SoulvoiceVoiceConfig mechanism unchanged); the overlay covers non-voice capability fields only. |
| A6 | **Kajiwoto legacy URL shim removed fully** (providers/soulvoice.go:114-115) — accepted breakage of any kajiwoto.ai voice-config URLs. |
| A7 | **All audit amendments applied** to the phase docs, incl.: new doc 4-13 (openaicompatible fingerprint-tree owner); 3-1 scope += config/db/init.go seeder rework + routes_providers.go + repository/modules/*.go + Go-hook migration (DROP COLUMN forbidden → table rebuilds); ModelInfo/VerifyResult shared types defined in 3-3; wire-name mapping single source = catalog (3-3's in-code table becomes the loader); merged `GET /api/providers/:id` keeps the config-referenced merged object until 6-3; 409 body lists referencing configs; 6-4 seeds 7 configs (imagination skip-when-no-model); 2-1 covers only providers with research seed tables; emission suppression applies to unset/default values only (user-explicit unsupported params emit with a warning). |
| A8 | **Cloud VAD seeded:** both seeders set the STT VAD slot to soulbitscloud/`silero-vad` (gateway supports vad — silero-vad, free tier; engine already seeds it today). R5/§5/SYNTHESIS §6/6-4 corrected. |
| A9 | **Seeding division:** engine `createDefaultData` (reworked in 3-1) stays the structural seeder on empty DBs; 6-4 is the app-side ensure-flow — fill the account PASETO **on cloud authentication AND re-authentication/token renewal** (app `auth:changed` + bootstrap; engine refresh-token route + cloud-mode refresh stay authoritative for their surfaces), plus gap-fill for deleted configs; never overwrite. plan §1.3 corrected accordingly (engine seeding exists today). |
| A10 | **Chat default aligned to `qwen-35-9b`** everywhere: engine init's backend default switches from `starfallen-24b` (matches the app fallback constants; sidesteps the missing gateway INSERT flagged in SYNTHESIS §7). |
| A11 | **soulvoice added to the STT transcription + VAD picker lists** in 6-5's per-slot split (the engine's soulvoice client already implements STT + VAD; the app never offered them — pre-existing gap closed). Note: soulvoice = local harmony-speech-engine; cloud speech workloads (tts/stt/vad) remain soulbitscloud — the two are distinct provider types by design. |

Pre-tasks (research, docs-only — may run while chains are idle):
**R-AUDIO** (Ollama audio protocol — gates 4-8 audio + 6-5 ollama tts/stt)
and **R-MD** (models.dev schema/license addendum — gates 5-2 codegen).

**Status: APPROVED 2026-10-18 (incl. §11 audit-round decisions).
Implementation may proceed per the phase docs in this folder.**
