# Phase 2-2 — Management contract bump 1.11.0 → 1.12.0

**Repo:** `harmony-link-private` · **Objective:** contract-clean schema additions for
the new provider type.

## Steps

1. `docs/api/management/openapi.yaml`:
   - `info.version: 1.11.0` → `1.12.0` (minor — additive schemas, precedent: the
     accounts-API additions that produced earlier minor bumps).
   - Add `OpenCodeGo` provider-config objects wherever `OpenAICompatible` appears for
     the four chat-family modules (Backend ~L140, Cognition ~L181, Movement ~L222;
     Vision analogous) + the module-config write example (~L449) and the account-type
     enumeration surface used by provider accounts CRUD.
   - Do NOT add schemas for RAG/TTS/STT/VAD/Imagination — opencodego is not offered
     there (the engine rejecting it is existing behavior for unsupported types).
2. Run the contract drift CLI (the repo's openapi-vs-routes drift check referenced by
     past CHANGELOG entries) and keep it green.
3. Cross-repo note: the app pins `ENGINE_CONTRACT_VERSION` (phase 3-3) — the bump must
   land in the engine release the app update ships with. Engine and app release
   coupling follows the existing sidecar/facade versioning (engine manifests,
   `ENGINE_SIDECAR_VERSION`).

## Acceptance

- Drift CLI green; openapi validates; version is 1.12.0.

## Checklist

- [ ] Provider-config schema objects (4 modules + write example + accounts CRUD)
- [ ] `info.version` 1.12.0
- [ ] Drift CLI green
- [ ] Release-notes entry (engine `release_notes/` convention)
