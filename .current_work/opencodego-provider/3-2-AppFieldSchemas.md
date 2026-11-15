# Phase 3-2 — App account & capability field schemas

**Repo:** `harmony-ai-app` · **Objective:** account form + capability fields for
opencodego.

## Steps

1. `src/constants/accountFieldSchemas.ts` — `ACCOUNT_SCHEMAS.opencodego`:
   ```ts
   opencodego: {
     fields: [
       nameField,
       { key: 'api_key', label: 'API Key', type: 'password', required: true,
         tooltip: 'OpenCode Console key (opencode.ai/console → Go).' },
       { key: 'base_url', label: 'Base URL', type: 'text',
         placeholder: 'https://opencode.ai/inference/go/openai/v1',
         tooltip: 'Leave empty for the default OpenCode Go endpoint.' },
     ],
   },
   ```
   No extras (no auth/fingerprint). §3.1 matrix doc-comment: api_key required,
   base_url optional — matches the engine's `AccountRequirements` (1-1).
2. `src/constants/providerFieldSchemas.ts` — `PROVIDER_FIELD_SCHEMAS.opencodego`:
   copy the openaicompatible capability fields **minus** auth-style/fingerprint fields
   (model, max tokens canonical alias handling, temperature, top_p, penalties, n,
   stop, seed, response_format, extra_params; scope per module like the other
   multi-capability providers — comment block at the top of the file explains the
   pattern).
3. `accountValuesToWriteDto` / `accountToFormValues` / `accountFieldKeys` /
   `capabilityOverlayOf` / `capabilityDefaultsOf` all key off the schema generically —
   no code changes, but add tests:
   - `src/constants/__tests__/accountFieldSchemas.test.ts`: required-ness groups
     (api_key required set; base_url optional set), round-trip, keysOf.
   - `src/constants/__tests__/providerFieldSchemas.test.ts`: include 'opencodego' in
     the canonical-completion-tokens `it.each` list + per-module scoping test.
4. Live model discovery ("Fetch from provider") is generic via
   `POST /api/providers/models` — confirm the request includes base_url resolution
   only if the engine expects it (engine defaults when empty; app may send empty).

## Checklist

- [ ] Account schema entry
- [ ] Capability schema entry
- [ ] accountFieldSchemas tests (groups + round-trip)
- [ ] providerFieldSchemas tests (token alias + scoping)
- [ ] Manual: Add account → masked key, in-use badge, Test key auto-run
