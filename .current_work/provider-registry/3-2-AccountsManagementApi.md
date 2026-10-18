# Phase 3-2 — Engine: Accounts Management API

**Repo:** harmony-link-private · **Depends on:** 3-1 (serial engine chain) · **Blocks:** 6-1+
**Refs:** plan.md §3.4, §3.1 matrix, §11 audit decisions · SYNTHESIS §1

## Objective

Rework the management API: accounts CRUD (shared rows), module-config
create/update that reference accounts + carry overlays (no row minting),
read paths that keep the app's current consumption working until 6-3.

## Implementation steps

1. **`management/routes_providers.go` semantic rework** (on top of 3-1's
   mechanical retarget):
   - `GET /api/providers` → accounts grouped by type, same
     `{providers:{type:[…]}}` envelope, account-shaped rows
   - `POST /api/providers` `{type, account}` — engine mints id; validates
     per §3.1 matrix via the **account validator OWNED HERE** (single
     source: key/base_url required-ness; format checks cosmetic, never
     blocking; 3-3 consumes this validator for its account half)
   - `PUT /api/providers/:id` — partial merge
   - `DELETE /api/providers/:id` — soft delete; **409 body carries
     `referencing_configs: [{module, name, id}]`** so 6-2 can list them
     (extends today's bare `provider_in_use`)
   - `POST /api/providers/soulbitscloud/refresh-token` — updates the single
     account row + base_url (RefreshAllActiveTokens degenerates correctly)
2. **Module-config routes (`management/routes_modules.go` bodies +
   `module_controller.go` semantics):**
   - create: `{name, provider, provider_account_id, capability_json, …module
     fields}` — account exists + type matches provider; no minting; stt:
     two slots end-to-end
   - update: overlay + module columns only. **Two distinct operations:**
     account switch (within type) = FK repoint, overlay kept; provider TYPE
     switch = overlay schema reset required (validate/normalize)
   - read (list + get): inline merged provider object under `<provider>`
3. **App-compatibility guarantee (audit BLOCKER fix — verified: the app
   reads provider values via `GET /api/providers/:id` per config and keys
   its reference off the nested object's `id`, modules.ts:50; screen
   L375-383):** `GET /api/providers/:id` **keeps returning the merged
   object (account + overlay flattened, top-level `id` preserved)** when
   referenced by a module config, until 6-3 removes that consumption.
   The list endpoint returns account-shaped rows. STT nested shape spelled
   out: `transcription.<type>` and `vad.<type>` objects each carry the
   merged fields incl. `id` (modules.ts:82-88 parses these)
4. **`provider_mapper.go`:** overlay serialization/deserialization per
   type driven by 3-1's field-split file (no new source of truth)
5. **Tests:** update `routes_providers_crud_test.go` (pins old wire shape +
   409 — exists), `routes_providers_test.go`, `module_controller_test.go`;
   **add** a routes_modules body test (none exists today); golden merged-
   read JSON for openai + stt dual-slot

## Test gates

- Engine gate green
- Accounts CRUD + 409-with-references; module-config create-with-overlay;
  merged-read golden tests (incl. stt dual-slot)

## Checklist

- [ ] Accounts CRUD + §3.1 matrix validator (owned here, shared with 3-3)
- [ ] 409 body lists referencing configs
- [ ] Module-config create/update without minting; type-vs-account switch distinction
- [ ] Merged GET /api/providers/:id guarantee (incl. id + stt nested shapes)
- [ ] Overlay mapper on 3-1's field-split
- [ ] routes_modules body test added; existing suites updated
- [ ] Engine gate green
