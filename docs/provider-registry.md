# Provider Registry & Config UX

> **Workstream:** `provider-registry` (plan
> [`../.current_work/provider-registry/plan.md`](../.current_work/provider-registry/plan.md),
> summary [`../.current_work/provider-registry/summary.md`](../.current_work/provider-registry/summary.md)).
> Shipped as **one engine+app release on the dev channel** (owner ruling A4).
> This document is the app-side architecture note; the wire surface it depends
> on is pinned by the **engine-contract gates** at contract version **1.6.0**
> (see [`engine-contract-gates.md`](engine-contract-gates.md)).

The app is a thin client over the embedded engine's management API. Provider
configuration lives **entirely engine-side** — the app holds no schema and no
provider tables of its own. This note describes how the app models and edits
that configuration after the provider-registry workstream.

## The three layers: accounts vs overlays vs catalog

Provider configuration is split into three layers. Keeping them distinct is
the core of the redesign (plan §3.1/§3.2): a credential is entered **once** and
reused, while per-use tuning lives on the module config.

| Layer | What it is | Where it lives | Edited on |
|---|---|---|---|
| **Account** | A shared credential + endpoint for one provider *type* (`name`, `api_key`, `base_url`, typed `extra`). One row per real credential. | Engine `provider_accounts` table | **Providers** screen (`ProvidersScreen`) |
| **Overlay** | Per-module-config capability values: the `model` + sampling params + provider-specific params for *this* module's use of an account. | Module config's `capability_json` | **Module config editor** (`ModuleConfigEditScreen`) |
| **Catalog** | The tier-2 capability catalog — known models/voices with metadata (context, modalities, param support). Offline-first; the picker's default source. | `GET /api/providers/capabilities` | Read-only (picker + provenance chips) |

- **Accounts** are managed by `src/services/engine/repositories/providers.ts`
  (`listAccounts` / `getAccount` / `createAccount` / `updateAccount` /
  `deleteAccount` / `isAccountInUse`). The account-shaped API replaced the
  retired per-type `provider_config_*` surface.
- **Overlays** are the `capability_json` blob on each module config. Module
  configs reference their credential by `provider_account_id` (STT carries a
  pair: `transcription_provider_account_id` + `vad_provider_account_id`).
- **The catalog** is served by the engine and consumed through
  `useProviderCapabilityCatalog` — a failed/unreachable fetch degrades to the
  bundled fallback so the pickers still render.

### The 13 surviving provider types

Competitor removal (R9, plan §11) deleted three competitor providers entirely
— clients, configs, sync tables and every app-side trace — leaving **13**
provider types:

`openai`, `anthropic`, `google`, `xai`, `mistral`, `openrouter`,
`elevenlabs`, `openaicompatible`, `ollama`, `localai`, `comfyui`,
`soulvoice`, `soulbitscloud`.

`soulbitscloud` is **system-managed**: its account is written automatically
when you sign in (see *Seeding* below) and is never user-editable
(`accountFieldSchemas.isAccountManaged`).

## The verify state machine

"Test key" runs `POST /api/providers/verify` — a stateless credential probe —
and maps the result onto a **6-state** taxonomy held across all 13 providers
(`ProviderVerifyState`). Every verdict is HTTP 200; a non-`valid` state is a
legitimate result, not a transport error.

| State | Meaning | Chip colour |
|---|---|---|
| `valid` | Credential accepted. | success |
| `invalid` | Credential rejected (bad key). | error |
| `blocked` | Account blocked / banned by the provider. | error |
| `throttled` | Rate-limited / quota exhausted. | warning |
| `scope_limited` | Key valid but lacks the scope the module needs. | warning |
| `unreachable` | Transport failure — provider could not be reached. | muted |

The response may carry a provider-specific `payload` (ElevenLabs tier +
character quota, OpenRouter budgets, ComfyUI VRAM, versions) which the
Providers screen renders alongside the chip. Verify **auto-runs once after
save**; `unreachable` is also the client-side fallback when the request itself
throws.

## Discovery recipes (live model / voice lists)

`POST /api/providers/models` executes the provider's **discovery recipe** and
returns `{models: ModelInfo[], voices?: VoiceInfo[]}`. The recipe is
provider-specific and owned by the engine:

- **ElevenLabs** returns its `voices` envelope (live-only, never catalogued).
- **ComfyUI** enumerates per-node `object_info`.
- **Soulvoice** fans out per capability.
- **SoulbitsCloud** returns the gateway catalog with `meta.model_type` /
  `meta.min_tier` (used by seeding's model selection).

The app wraps this in `src/services/providers/providerModelFetch.ts`, which
**caches** results keyed by `(type, module, base_url, api-key tail)` so
re-selecting an account reuses the last result instead of re-hitting the
provider. A provider-side listing failure comes back as HTTP 200 with an empty
list plus `error`, so a failed discovery degrades to `models: []` and the
picker keeps its free-text "Custom…" path. In the module form this is the
**"Fetch from provider"** action — the on-demand live refresh on top of the
offline-first catalog.

## The Providers screen

`ProvidersScreen` (Settings → **Providers**; `providers` i18n namespace) is the
central account-management surface (phase 6-2):

- Accounts **grouped by provider type** (variant-filtered), each row showing the
  name, a **masked key** (`sk-…1234`), the `base_url` when set, and an
  **in-use badge**.
- **Test key** → the verify chip + payload (above); auto-runs after save.
- **Delete** is guarded: a `409 provider_in_use` surfaces the engine's
  `referencing_configs` list ("Module configs referencing it must be updated
  first"), so an account that a live module config still points at cannot be
  removed by accident.

> The engine returns `api_key` **unmasked** to this single-user local client so
> a saved account can be re-verified without a second round-trip; the screen
> masks it in the UI.

The shared `AccountForm` (`src/components/providers/AccountForm.tsx`) renders
the per-type **account schema** (`src/constants/accountFieldSchemas.ts`) and is
reused by the module form's "Add account…" flow. The account/capability field
split is owned by two schema modules: `accountFieldSchemas.ts` (account fields)
and `providerFieldSchemas.ts` (capability-only fields).

## The module-config form

`ModuleConfigEditScreen` is the final 4-section shape (phases 2-2 + 6-3):

**Provider → Account → Capability → Module.**

- **Account picker** — existing accounts of the chosen type, with **"Add
  account…"** opening the shared `AccountForm`. It **auto-collapses to a
  caption** when only one account exists (`AccountPicker`).
- **Capability** — the **model picker is catalog-backed** (offline-first) with
  **"Fetch from provider"** as the on-demand live refresh (`CatalogModelSelect`),
  **provenance chips** (detected / known / assumed / overridden) and a retained
  **Custom…** escape. ElevenLabs voices come from the models-route `voices`
  envelope. The **preset dropdown** (`SamplingPresetSelect`) sits here too.
- **Param warnings** — unsupported parameters (from `ModelInfo.param_support` /
  capabilities) are hidden in Simple mode and shown as a warning chip in
  Advanced mode, but are **never hard-blocked** (R12). Sparse coverage ⇒
  undefined means no warning.
- **Account-switch revalidation** (plan §3.2) — switching account re-validates
  the overlay's model/voice refs against the new account's live list; stale refs
  are marked "re-fetch / choose replacement" and never silently dropped. Live
  fetches are debounced and cached.
- **STT dual-slot** — the STT module renders **two** full
  provider+account+capability sub-forms (transcription + VAD). The two slots no
  longer share one provider list: transcription offers every provider with a
  transcription client (incl. `soulvoice` and the experimental `ollama`),
  while **VAD offers only `soulbitscloud` + `soulvoice`** — the two providers
  with real VAD clients (`STT_SLOT_PROVIDER_OPTIONS`).

## Sampling presets

`sampling_preset_name` is a **dropdown** fed by the engine's
`GET /api/presets` (via `usePresets`), replacing the old free-text field.
Selecting a preset previews its values as chips.

> **Semantics (owner ruling A3):** a preset supplies **defaults**; explicit
> local values **override** it. The UI never claims the preset overrides local
> input, and local inputs stay enabled while a preset is selected.

## Seeding ensure-flow

Seeding is split (plan §5, ruling A9):

- **Engine = structural seeder** on an *empty* database: one `soulbitscloud`
  account with an empty `api_key`, plus one default config per seedable module
  type, **both** STT slots (transcription + VAD, VAD = `silero-vad`), the
  `qwen-35-9b` chat default, and imagination **skipped** (skip-when-no-model).
- **App = token + gap-fill** (`src/services/providers/seeding.ts`,
  `ensureSeededDefaults`). It runs on **every cloud authentication AND
  re-authentication / token renewal** (`auth:changed` + the bootstrap-signed-in
  path), and:
  1. **Token first — never flag-gated.** Ensure the `soulbitscloud` account
     exists and carries the *current* PASETO
     (`{api_key: <PASETO>, base_url: CLOUD_HOSTS.inference}`),
     update-if-exists (which subsumes rotation).
  2. **Gap-fill — guarded.** Per module type (×7) and per STT slot, if the user
     has **zero** live configs of that type/slot, create
     `Soulbits Cloud (default)` referencing the account, choosing the model from
     the gateway's `meta.model_type` / `meta.min_tier` with the static
     `SOULBITS_FALLBACK_MODELS` as the offline fallback. Existing configs are
     **never overwritten**; on fresh installs the engine already seeded
     everything, so this no-ops by design.

The gap-fill scan is gated by a persisted, **per-account** guard
(`seeding_done_v1:<accountId>`) so it runs once per account; failures log and
never block sign-in.

## Contract 1.6.0 — the wire surface

The provider surface re-targeted to `provider_accounts` and bumped the
management contract **1.5.0 → 1.6.0** (see
[`engine-contract-gates.md`](engine-contract-gates.md) for the gate mechanics).

| Endpoint | Purpose |
|---|---|
| `GET /api/providers` | Accounts grouped by type (account-shaped rows) |
| `GET /api/providers/:id` | Merged account+overlay object when referenced, else the account row |
| `POST /api/providers` | Create `{type, account}` (engine mints the id) |
| `PUT /api/providers/:id` | Partial merge `{account}` |
| `DELETE /api/providers/:id` | `409 provider_in_use` + `referencing_configs` |
| `POST /api/providers/verify` | Stateless credential check → `{state, detail?, payload?}` |
| `POST /api/providers/models` | Discovery recipe → `{models, voices?}` |
| `GET /api/providers/capabilities` | Tier-2 capability catalog |
| `GET /api/presets`, `GET /api/presets/:name` | Sampling presets (+ `params`) |

Module-config writes are **flat** (`{provider_account_id, capability_json, …}`)
— the engine resolves the account, so the app no longer mints provider-config
ids. The retired `POST /api/validate-provider` and `POST /api/models` routes are
gone.

## Where the code lives

| Concern | File |
|---|---|
| Accounts repository | `src/services/engine/repositories/providers.ts` |
| Verify / models / capabilities client | `src/services/engine/EngineApiClient.ts` |
| Live model/voice discovery + cache | `src/services/providers/providerModelFetch.ts` |
| Seeding ensure-flow | `src/services/providers/seeding.ts` |
| Account vs capability schemas | `src/constants/accountFieldSchemas.ts`, `providerFieldSchemas.ts` |
| Form section split | `src/constants/providerFieldSections.ts` |
| Providers screen | `src/screens/settings/ProvidersScreen.tsx` |
| Module config editor | `src/screens/config/ModuleConfigEditScreen.tsx` |
| Picker components | `src/components/config/{AccountPicker,CatalogModelSelect,SamplingPresetSelect,ProviderSlotSection}.tsx` |
| Shared account form | `src/components/providers/AccountForm.tsx` |
| Contract pin + endpoint manifest | `src/services/engine/engineContract.ts` |

## See also

- [`engine-contract-gates.md`](engine-contract-gates.md) — how the wire surface is pinned and gated.
- [`TESTING.md`](TESTING.md) — how the suites above are run.
- [`../.current_work/provider-registry/plan.md`](../.current_work/provider-registry/plan.md) — the approved design contract (R1–R12, A1–A11).
