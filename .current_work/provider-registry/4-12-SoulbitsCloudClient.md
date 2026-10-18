# Phase 4-12 — Engine: SoulbitsCloud Client Rework

**Repo:** harmony-link-private · **Depends on:** 3-3 · Serial engine chain
**Refs:** research/soulbitscloud.md (§2 probe, §3 lineup, §4 filters/fields, §5-§7) · SYNTHESIS §5 item 9 · plan §11

## Objective

Real credential verification, tools passthrough, ModelInfo with tier/type
metadata (6-4's seeding depends on it).

## Implementation steps

1. **Verify fix (soulbitscloud.go:144-152 — today probes PUBLIC
   `GET /v1/models`):** switch to `POST /v1/chat/completions` with an
   empty body. **Gateway reality (handlers.go:270-334 — audit): Extract
   runs BEFORE the limiter/model-access, so from the {} probe: 400 = key
   valid; 401 = invalid EXCEPT the `authentication service unavailable`
   body → throttled (research §2.2 transient); 429/403 are UNREACHABLE
   via this probe — document, don't attempt.** Typed client can't emit a
   literal `{}` (Model/Messages lack omitempty) — use raw HTTP or rely on
   empty-model- semantics; pick raw
2. `ListModels()`: `GET /v1/models` → 3-3 ModelInfo with
   **`meta.min_tier` (gateway field is `min_tier`, NOT `model_tier`),
   `meta.model_type`, modalities** — 6-4 selects defaults by type/tier
   metadata, not hardcodes. Filters per research §4 (model_type/
   input_modalities/output_modalities — there is no tier filter; cite §4)
3. **Tools passthrough:** `tools`/`tool_choice` via the generated
   client's typed `Tools`/`ToolChoice` fields (gen/client.go:748-751 —
   direct fields, not the Set(...) pattern)
4. Param audit vs research §5-6: `max_completion_tokens`/`stop`/`n`/
   `response_format` via Set (existing pattern verified); emission routed
   through the 3-3 helper
5. Auth-mode switch (`v4.local.` PASETO) + `ensureDefaults` kept;
   base_url flavor-managed (config.SoulbitsCloudBaseURL(), config/
   soulbits.go:24); account row system-managed (6-4 owns writes)
6. Error taxonomy: 401/403/429 typed preservation; `blocked` has no
   gateway signal (out of scope, flagged to cloud backend)
7. Quirk validations (warn-level): `harrier-oss-v1-0-6b` casing, voice
   `claire/bella` casing, kitten-tts `language` requirement

## Test gates

- Engine gate green
- Tests: probe mapping (400=valid; 401 invalid; auth-unavailable→
  throttled), /v1/models→ModelInfo with meta.min_tier/model_type/
  modalities, tools emission, quirk validations

## Checklist

- [ ] Real PASETO probe (raw HTTP; corrected state mapping)
- [ ] Listing + meta.min_tier/model_type/modalities for 6-4
- [ ] tools/tool_choice via typed fields
- [ ] Emission-helper routing audited
- [ ] Typed errors; quirks warn-level
- [ ] Engine gate green
