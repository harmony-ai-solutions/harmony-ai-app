# Phase 6-3 — App: Account Picker + Capability-Only Forms in Module Configs

**Repo:** harmony-ai-app · **Depends on:** 6-1, 6-2 (AccountForm), 2-2 (structure), 5-1/5-2 · Serial app chain
**Refs:** plan.md §7, §6.2, §3.2, R12, §11

## Objective

The final ModuleConfigEditScreen shape: Provider → Account (auto-collapsed
when single) → Capability (catalog-backed pickers, live fetch on demand,
preset dropdown, param warnings) → Module.

## Implementation steps

1. **Remove the 6-1 adapter** (`legacyProviderAdapter.ts` + the
   modules.ts mappings) — the form reads/writes `provider_account_id` +
   `capability_json` directly; **VoiceInputSettingsScreen cleaned up too**
   (drops `transcription/vad_provider_config_id` writes + sentinel test —
   audit)
2. **Account picker step:** existing accounts of the chosen type +
   "Add account…" opening 6-2's shared AccountForm (inline/modal);
   auto-collapse to a caption when only one account exists
3. Capability section:
   - **Model picker is catalog-backed** (engine capabilities endpoint —
     offline-first per plan §6.2) with **"Fetch from provider" as the
     on-demand live refresh** (`listProviderModels` with `module` filter —
     engine-side filtering per 5-1; replaces app-side tag filtering);
     provenance chips (detected/known/assumed); Custom… retained
   - ElevenLabs voice picker from the models-route `voices` envelope
     (6-1/5-1 contract)
   - preset dropdown from 2-2 unchanged (locals-override semantics)
   - param warnings: unsupported params (ModelInfo.param_support /
     capabilities) hidden in simple mode, warning chip in expert mode,
     **never hard-blocked** (R12; note: sparse coverage pre-5-2 — only
     openrouter live + catalog providers; undefined ⇒ no warning)
4. **Account-switch revalidation (plan §3.2):** on account switch, overlay
   model/voice refs validated against the new account's live list;
   **credentials come back with the account (unmasked key — 6-2 note);
   debounce + cache live fetches** (comfyui per-node, soulvoice fan-out);
   stale refs marked "re-fetch / choose replacement", never dropped
5. STT dual-slot: two full provider+account+capability sub-forms
   (transcription, VAD; VAD picker list per 6-5's per-slot split)
6. **Delete `src/constants/providerModelCatalog.ts` + its test** (2-1's
   interim; engine endpoint replaces it — module filtering now via the
   route param). Mistral/ollama/localai pickers arrive via 6-5 + live/
   catalog data, not via this constant (2-1 scope note)
7. Component tests: NET-NEW suite (no ModuleConfigEditScreen tests exist
   today — audit): picker flows, collapse, revalidation marking, param
   warnings, stt dual-slot round-trip

## Test gates

- `npx.cmd tsc --noEmit` + `npm.cmd run test` green incl. the new
  ModuleConfigEditScreen suite

## Checklist

- [ ] Adapter + modules.ts mappings + VoiceInputSettingsScreen legacy writes removed
- [ ] Account picker + collapse + inline AccountForm
- [ ] Catalog-backed pickers + on-demand live fetch + provenance + Custom
- [ ] ElevenLabs voice picker (voices envelope)
- [ ] Param warnings (never blocking; coverage note)
- [ ] Account-switch revalidation (debounced, cached)
- [ ] STT dual-slot
- [ ] Interim catalog constant + test deleted
- [ ] New component suite + gates green
