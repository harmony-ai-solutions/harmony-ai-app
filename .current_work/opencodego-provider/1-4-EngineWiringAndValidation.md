# Phase 1-4 — Engine wiring & account validation

**Repo:** `harmony-link-private` · **Objective:** register the provider and wire it
through the module-config extract/load switches and management routes.

## Steps

1. `providers/registry.go` — `init()`:
   ```go
   GlobalRegistry.Register(config.ProviderOpenCodeGo, func() Provider { return &OpenCodeGoProvider{} })
   ```
2. `database/controllers/module_controller.go` — add `config.ProviderOpenCodeGo`
   cases (extract **and** load paths) for the four chat-family modules only:
   - Backend, Cognition, Movement, Vision (follow the `OpenAICompatible` cases).
   - **Not** TTS / STT (transcription + VAD) / RAG / Imagination — Go exposes no
     speech or embeddings API. Unsupported → existing `unsupported … provider` error.
3. Config structs on the module configs (`config.BackendConfig` etc.) gain the
   `OpenCodeGo *OpenCodeGoProviderConfig` field + `ProviderConfig()` dispatch, exactly
   as the other providers (find the per-module config union in `config/types.go`).
4. `management/routes_providers.go` — no per-type code expected (generic over
   `controllers.ProviderAccountTypes`); verify account create/update/verify and
   `routes_provider_probe.go` (`POST /api/providers/models`) work for the new type
   end-to-end via the management API tests (`routes_providers_crud_test.go` pattern —
   add an opencodego case).
5. `integration/validation.go` — the split validation consumes
   `ProviderAccountTypes` + `AccountRequirements` (1-1) generically; confirm no
   hardcoded type list remains (grep `openaicompatible` for stragglers).

## Files

- `providers/registry.go`, `config/types.go` (module config unions),
  `database/controllers/module_controller.go`, management tests.

## Acceptance

- Module-config create → entity init → chat turn works end-to-end against a stub
  server (engine-side integration test).
- Non-chat modules reject `opencodego` with the existing unsupported-provider error.

## Checklist

- [ ] Registry factory
- [ ] 4 module config unions + `ProviderConfig()` dispatch
- [ ] module_controller extract + load cases (×2 paths ×4 modules)
- [ ] Management CRUD/probe test coverage for the new type
- [ ] No stray hardcoded type lists
