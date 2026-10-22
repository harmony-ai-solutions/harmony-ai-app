# Phase 3-1 — Engine: Mobile-Optimized Read Endpoints

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.4 (Wails frontend is the proof; add what mobile lists need)
> **Codebase mapping consulted:** `.planning/codebase/` (engine — harmony-link-private): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

Close the read-API gap between what the Wails frontend consumes and what the mobile app's TS repositories currently query locally, so the app can render every screen from the management API without performance regressions.

## Method

1. **Audit (table-driven):** enumerate every read/query in `src/database/repositories/*.ts` (app) and map to an existing management endpoint (engine `management/routes_*.go`) or mark MISSING. Include the JOIN-based chat-list preview query (last message per interaction + two-phase blob loading), paginated message windows, entity/profile listings with filters (favorites, categories), emoji actions, interactions by scope, memory/emotion reads for UI, module/provider config reads (schema-driven forms already mirror these — verify list endpoints suffice).
2. **Design mobile endpoints** for the MISSING rows under `/api/mobile/*` (separate group keeps Wails contract untouched): JSON shapes match the app's existing TS model interfaces **verbatim** (camelCase? — no: engine wire is snake_case per convention; the app adapter layer (3-2) maps, mirroring the established DTO/domain split).
3. Pagination + field projection on every list endpoint (mobile payload discipline); blob fields (audio/image) excluded from list payloads — dedicated `/api/mobile/…/{id}/audio|image` byte endpoints with range support, matching the app's two-phase loading pattern.
4. Auth: loopback token (sidecar issues a short-lived local token at readiness — simplest: bind + random token in the readiness line; management middleware accepts it for loopback peers) — keeps the management API unexposed.

## Implementation steps

1. Produce the audit table (commit it in this phase file's folder as `3-1-endpoint-audit.md`).
2. Implement missing endpoints + tests (management suite pattern).
3. Loopback auth for the sidecar profile (flag from 1-1).
4. Bench: chat-list endpoint vs. app-local JOIN timings on a populated DB (device-class hardware) — record.

## Files to create/modify

- `management/routes_mobile.go` (NEW group) + handlers
- Loopback-token middleware option
- `.current_work/app-engine-parity/3-1-endpoint-audit.md` (audit table, this repo, committed here for cross-repo visibility)
- Engine CHANGELOG.md

## Verification gates

- `go build/vet/test ./...` green; endpoint tests per route
- Audit table shows zero MISSING rows at completion
- Bench numbers recorded

## Risks & rollback

- Scope creep into "new features" — strictly read-only listings; writes continue via existing endpoints/facade
- Payload bloat — projection + pagination enforced by test (max-bytes assertion on fixtures)

## Progress checklist

- [x] Audit table complete (all TS repo reads mapped) — `3-1-endpoint-audit.md` (EXISTS/NEW/DERIVED/INTERNAL/WRITE; **0 MISSING**)
- [x] Missing endpoints implemented + tested — 8 `/api/mobile/*` read routes + `management/routes_mobile_test.go`
- [x] Loopback auth wired — per-process token in the sidecar readiness line (`token`), accepted via `X-Loopback-Token` for loopback peers only
- [x] Blob byte endpoints + pagination/projection tests — audio/image `Range` endpoints; chat-list/messages/interactions/memories pagination tests
- [x] Benchmarks recorded — `BenchmarkMobileChatListEndpoint_500Conversations` ≈ 7.4 ms/op on the host; the app-local JOIN half is deferred to 3-2's on-device verification (recorded in audit §4)

### 3-1b additions (owner-signed scope; see implementation notes below)

- [x] `/api/mobile` group **dissolved** — reads re-homed under `/api/entities/*`, blob bytes + message writes under `/api/messages/*`; old registrations removed (`routes_mobile.go` deleted)
- [x] Message writes — `PATCH /api/messages/:id` (edit/pin/react), `DELETE /api/messages/:id`
- [x] Conversation writes — `DELETE /api/entities/:id/conversations/:participantKey/messages` (clear), `POST .../read` (read/unread), `PUT /api/entities/:id/chat-settings/:participantKey` (pin/archive)
- [x] Emoji action CRUD — POST/PUT/DELETE + delete-all / `?scope=default` delete-defaults
- [x] Entity read additive fields — `created_at`/`updated_at`/`deleted_at`/`rag_reindex_required`/top-level `character_profile_id`
- [x] Character profile additive fields — `is_favorite` + timestamps; dedicated `PUT /api/character-profiles/:id/favorite`
- [x] `GET /api/providers` + `GET /api/providers/:id` — standalone provider-config list/read
- [x] Memories audit — no user-facing manual-memory-add exists (`insertMemory` is test-only, `upsertMemory` has no caller; the 3-2 adapter already throws `EngineApiUnsupportedError`) → **`POST /api/entities/:id/memories` deliberately NOT added**
- [x] Tests migrated — `routes_mobile_test.go` split into `routes_messages_test.go` + `routes_entities_conversations_test.go`; bench re-homed (`routes_entities_bench_test.go`); all prior coverage kept + new write coverage
- [x] Docs updated — `docs/api/management/openapi.yaml` (Mobile paths replaced; Messages/Configuration paths added), `docs/Sidecar-Deployment.md` (app-facing API table), CHANGELOG
- [x] Gates green — `go build/vet/test ./...` with the canonical CGO_CFLAGS

## Implementation notes — 3-1b consolidation ruling (2026-10-11)

**Ruling: the `/api/mobile` group DISSOLVES.** The separate group existed only to
keep the Wails contract untouched while giving the app a read surface. 3-1b
re-homes its routes into the existing `/api/entities` (+ new `/api/messages`)
surface and adds the write path 3-2 needs, so there is one app-facing contract
instead of two.

**Auth.** `management/mobile_auth.go` (`mobileAuthMiddleware`) is unchanged and is
now applied to the whole `/api` group and the `entities` / `character-profiles`
sub-groups (previously `apiKeyAuthMiddleware`). It accepts EITHER the admin API
key (Wails/desktop parity — unchanged) OR, for **loopback peers only**, the
sidecar's per-process `X-Loopback-Token`. Rationale: the app's `EngineApiClient`
sends only `X-Loopback-Token` in sidecar mode (it never embeds the fixed admin
key), so every app-facing route — including the existing `/api/entities`,
`/api/character-profiles`, `/api/module-configs/*` reads and the new
`/api/providers` — must accept it. The token is empty on desktop/cloud, so the
Wails contract is unchanged. CORS gained `PATCH` + `X-Loopback-Token`.

**Endpoint map (old → new).**

| Old (`/api/mobile/*`) | New |
|---|---|
| `GET /entities/:id/chat-list` | `GET /api/entities/:id/chat-list` |
| `GET /entities/:id/messages?participant_key=` | `GET /api/entities/:id/conversations/:participantKey/messages` |
| `GET /entities/:id/interactions` | `GET /api/entities/:id/interactions` |
| `GET /entities/:id/emoji-actions` | `GET /api/entities/:id/emoji-actions` |
| `GET /entities/:id/emotion` | `GET /api/entities/:id/emotion` |
| `GET /entities/:id/memories` | `GET /api/entities/:id/memories` |
| `GET /messages/:messageId/audio` | `GET /api/messages/:id/audio` |
| `GET /messages/:messageId/image` | `GET /api/messages/:id/image` |

Response shapes for the moved reads are **byte-identical** (same DTOs, same
snake_case). The message window's participant key moved from a query param to a
path segment (URL-encode `+` as `%2B`).

**Writes added (app parity).** Message PATCH/DELETE; conversation clear
(`deleteConversationByParticipantKey`), read/unread
(`markConversationMessagesRead`/`Unread`), chat-settings upsert (`upsertSettings`,
`reply_mode` excluded — flows via WS `SET_REPLY_MODE`); emoji CRUD incl.
delete-all / delete-defaults; character favorite toggle. Repository functions
mirror the app's TS SQL exactly (`database/repository/conversation/writes.go`,
`entities.DeleteAll/DeleteDefaultEmojiActionsByEntity`,
`characters.SetCharacterProfileFavorite`).

**Memories audit (scope D).** Searched the app repo for callers of
`insertMemory`/`upsertMemory`: `insertMemory` appears only in tests;
`upsertMemory` has no caller at all (only a definition + barrel export), and the
3-2 engine adapter already stubs both with `EngineApiUnsupportedError`. There is
**no user-facing manual-memory-add feature**, so `POST /api/entities/:id/memories`
was deliberately NOT added.

**Notes for 5-1 (parity gates).** Management-route enumerations must now include
the `/api/entities/*`, `/api/messages/*`, `/api/providers*` and
`/api/character-profiles/:id/favorite` paths instead of the 8 `/api/mobile/*`
paths; `management/routes_mobile_test.go` / `_bench_test.go` no longer exist
(replaced by `routes_messages_test.go`, `routes_entities_conversations_test.go`,
`routes_entities_bench_test.go`).
