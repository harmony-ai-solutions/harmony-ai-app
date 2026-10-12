# Phase 3-2 — App: Management-API Client & Repository Adapter Swap

> **Repo:** `harmony-ai-app` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.4, §12.8 step 3 (per-screen swap)
> **Codebase mapping consulted:** `.planning/codebase/` (app — harmony-ai-app): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

Replace the app's TS SQLite repositories with management-API-backed implementations, screen group by screen group, behind a feature flag — with the repository interfaces unchanged so screens and services don't know the difference.

## Design

- NEW `src/services/engine/EngineApiClient.ts`: axios instance against `http://127.0.0.1:<adminPort>` + loopback token (1-2/3-1); DTO→domain mappers mirroring the established snake_case-wire/camelCase-domain convention (regression lesson from memory bank: Go silently drops unknown camelCase keys).
- NEW `src/services/engine/repositories/*`: API implementations of the existing repository interfaces (`characters`, `entities`, `interactions`, `conversation_messages`, `emoji_actions`, providers/modules read paths…). Write operations go through the same API where endpoints exist; anything lacking a write endpoint routes through the entity-session/facade events as today (audit in 3-1 covers reads; writes audit here — add missing write endpoints to 3-1 scope if gaps found).
- Feature flag `ENGINE_API_DATA_LAYER` (AsyncStorage + build-time default): per repo module, API or SQLite implementation. **Seam correction (2026-10-11 review): there is no repositories barrel/index today** — screens do named imports from individual repo modules (`export default` count in `src/database/repositories/`: 0; no `index.ts`). The seam must be **created**: add `src/database/repositories/index.ts` re-exporting each function from a flag-selected implementation (API vs SQLite), then swap the ~import sites per screen group as each lands. Budget the import-site sweep explicitly — it is the real cost of this phase, not the client itself.
- Swap order (dependency-lean, each shippable): ① read-only lists (characters, emoji, config views) → ② chat list + message windows (exercises byte endpoints) → ③ interactions + emotion/memory reads → ④ writes (config CRUD, persona/entity CRUD via API/facade).
- Cache discipline: NO local re-cache of engine data (the engine is local); only in-memory request-level memoization. AsyncStorage remains for UI prefs only.

## Implementation steps

1. `EngineApiClient` + mappers + loopback token plumbing from sidecar readiness.
2. Repository API impls per swap order; unit tests against a mock API server (extend the existing `MockWebSocket`-style harness with a mock management server).
3. Screen-group verification per step on device (flag on): chat list scroll perf, message window pagination, image/audio lazy loading parity.
4. Keep TS SQLite repos compiled but unused when flag on (deletion happens in 3-4).

## Files to create/modify

- `src/services/engine/EngineApiClient.ts` + `src/services/engine/repositories/*` (NEW)
- NEW `src/database/repositories/index.ts` barrel (flag-selected re-exports) + per-screen-group import-site swaps
- `src/config/engineFeatures.ts` (flag)
- Mock management server for jest
- CHANGELOG.md at completion

## Verification gates

- `npx tsc --noEmit` 0; jest green incl. new API-repo suites
- Device: each screen group verified with flag on AND off (parity of behavior)
- No screen imports repositories directly bypassing the seam (lint/scan check)

## Risks & rollback

- Latency on hot paths (message windows) — mitigation: pagination discipline from 3-1; measure before/after
- Behavioral drift between SQLite query semantics and API semantics — the 3-1 audit table is the contract; mismatches are bugs filed against 3-1 endpoints, not worked around app-side

## Progress checklist

> **Status (3-2, 2026-10-11 — resumed after 3-1b):** the engine write path landed (3-1b consolidated the read group under `/api/entities/:id/*` + `/api/messages/*`, added the message/emoji/chat-settings writes, provider reads, favorites, and the entity/profile additive read fields). The client is re-pointed at the consolidated surface, the adapters are extended to the full read surface plus the write endpoints, and the repository seam dispatches them. Unit-tested against the mock management server. Device verification remains an owner gate.

- [x] Client + mappers + token plumbing — re-pointed to the consolidated 3-1b paths (`/api/entities/:id/*`, `/api/messages/*`), participant key as an encoded path segment, plus all new write methods + provider reads + favorite toggle. Mappers consume the 3-1b additive entity/profile fields.
- [x] Swap ① read-only lists — ADAPTERS LANDED + unit-tested: characters (profiles + favorites + images), entities, user-entities, module-configs, providers (all 16 types), plus emoji reads. Device verification = owner gate
- [x] Swap ② chat list + windows — ADAPTERS LANDED + unit-tested (opaque `next_cursor`); device verification = owner gate
- [x] Swap ③ interactions/emotion/memory — ADAPTERS LANDED + unit-tested; device verification = owner gate
- [x] Swap ④ writes — LANDED for the endpoints 3-1b added: message update (PATCH) / delete / clear / mark-read-unread, emoji create/upsert/delete-all/delete-defaults, chat-settings pin/archive, character favorites. STILL SQLITE-ONLY (documented, engine has no route or the app signature cannot address it): entity/profile/module/provider CRUD writes, interaction/emotion/memory writes, message create, `getConversationMessage`/`messageExists`, `deleteEmojiAction` (id-only), `getEntityModuleMapping`, derived stats/picker reads. Device verification = owner gate
- [x] Flag default decision recorded — `ENGINE_API_DATA_LAYER_DEFAULT = false` (SQLite stays authoritative until the full read surface is verified on device; flip on for local mode first)
