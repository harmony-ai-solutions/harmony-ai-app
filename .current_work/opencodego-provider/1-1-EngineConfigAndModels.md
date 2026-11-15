# Phase 1-1 — Engine config, models & account type

**Repo:** `harmony-link-private` · **Objective:** declare the `opencodego` provider type
and its config/model shapes.

## Steps

1. `config/config.go` — add constant next to the other provider constants:
   ```go
   ProviderOpenCodeGo = "opencodego"
   ```
   (Concatenated lowercase id, matching `openaicompatible` / `soulbitscloud`.)
2. `config/types.go` — add `OpenCodeGoProviderConfig`, mirroring
   `OpenAICompatibleProviderConfig` **minus** `Auth` / `Fingerprint` (fixed dialect —
   no fingerprinting, bearer-only). Keep the same `mapstructure`/`json` tag style
   (`baseurl`, `apikey`, `model`, `maxtokens`, `maxcompletiontokens`, `temperature`,
   `topp`, `frequencypenalty`, `presencepenalty`, `n`, `stoptokens`, `seed`,
   `responseformat`, `samplingpresetname`, `extraparams`). Document the account-half
   fields (`base_url`, `api_key`) like the §3.1 comment on the compatible struct.
3. `database/models/` — add the `OpenCodeGoProviderConfig` model with `ToSyncModel()`
   (snake_case wire shape; follow `OpenAICompatibleProviderConfig`'s model as the
   template). **No new SQL table** — provider_configs per-type tables were dropped in
   migration 000052; storage is `provider_accounts` + `capability_json` overlay.
4. `database/controllers/provider_account_validation.go` — add `"opencodego": true` to
   `ProviderAccountTypes` (13 → 14; update the doc comment "the 13 surviving provider
   types"), and add the `AccountRequirements` entry: `APIKeyRequired: true`,
   `BaseURLRequired: false`.
5. `database/controllers/provider_field_split.go`:
   - `newProviderModel`: `case "opencodego": return &models.OpenCodeGoProviderConfig{}`
     — prefer the `config.ProviderOpenCodeGo` constant where the switch allows.
   - `ProviderModelToSync`: add the `*models.OpenCodeGoProviderConfig` case.
   - No account-extras apply (no `auth`/`fingerprint` analogues).

## Files touched

- `config/config.go`, `config/types.go`
- `database/models/` (new model file or the provider models file, per repo layout)
- `database/controllers/provider_account_validation.go`
- `database/controllers/provider_field_split.go`

## Acceptance

- `go build ./...` green; `IsKnownProviderType("opencodego")` true.
- `SplitProviderConfig` / `MergeProviderConfig` round-trip an opencodego model
  (account fields stripped → capability overlay), covered by a test mirroring
  `TestMergeProviderConfig_OpenAICompatibleAccountExtra`.

## Checklist

- [ ] `ProviderOpenCodeGo` constant
- [ ] `OpenCodeGoProviderConfig` config struct (types.go)
- [ ] DB model + `ToSyncModel`
- [ ] `ProviderAccountTypes` + requirements entry
- [ ] field-split switch cases
- [ ] merge/split round-trip test
