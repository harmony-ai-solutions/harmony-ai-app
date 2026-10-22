# Phase 7-11 — App Engine-Log Viewer & Diagnostics Export

> **Repos:** engine (`../harmony-link-private`), app (`../harmony-ai-app`)
> **Origin:** review follow-up 2026-10-12. **Owner rulings:** FULL scope (viewer + filters + verbosity
> control + diagnostics export), and the **simplified auth design** — reuse the existing
> `mobileAuthMiddleware` loopback-token surface instead of new mirror routes (re-register the log handlers
> under the mobileAuth group, extend the WS handler to accept the loopback token; paths unchanged).
> **Sequencing:** independent of 7-6..7-10. **No contract-version bump** — the endpoints are long-existing,
> paths and shapes unchanged; record an auth-scope note in the engine's Management-API-Versioning doc
> instead. The export header reuses 7-10's `engineAppVersion()` when available (`GET /public/appversion`
> directly otherwise).

## Objective

Give app users the Wails Dev-Tools log viewer's capabilities against the embedded engine — live tail with
filters, ring-buffer history, runtime verbosity control — plus a share-sheet **diagnostics export** they can
forward to the devs, and fix the fact that embedded compositions currently capture **no logs at all**.

## Verified current state (anchors, 2026-10-12)

### Engine logging machinery (complete, desktop-only wiring)
- [`logging/ring_buffer.go`](../../../harmony-link-private/logging/ring_buffer.go) — `RingBufferHook`
  (in-memory ring, consecutive-duplicate collapsing, `maxDupes` 20, `Subscribe()` chan buffer 100,
  `StreamEvent{type: entry|remove, entry|removeId}` broadcast incl. dedup evictions); `GlobalRingBuffer`;
  `InitRingBuffer(capacity)`; `Query(LogFilter)` with component / entity / level / search / since /
  isPrompt / promptType filters + pagination; `GetComponents/GetEntities/GetPromptTypes/Count`.
- **Wired only on desktop**: `logging.InitRingBuffer(10000)` + `log.AddHook` exist solely at
  [`cmd/run.go:285-287`](../../../harmony-link-private/cmd/run.go:285). The shared embedded composition
  ([`enginehost/enginehost.go`](../../../harmony-link-private/enginehost/enginehost.go) — both the Android
  sidecar and the iOS facade) never initializes it → `GlobalRingBuffer == nil` → every log endpoint takes
  its nil-guard empty path ([`routes_logs.go:24-25`](../../../harmony-link-private/management/routes_logs.go:24))
  and the WS handler returns early ([`routes_logs_ws.go:82-83`](../../../harmony-link-private/management/routes_logs_ws.go:82)).
- REST endpoints ([`server.go:331-339`](../../../harmony-link-private/management/server.go:331)):
  `GET /api/development/logs` (+`/count`, `/components`, `/entities`, `/prompt-types`) and
  `GET/PUT /api/development/logs/level` (runtime verbosity reconfiguration via
  `logging.GetGlobalLogLevelConfig`/`SetLogLevelConfig`). Level order: Panic=0 … Trace=6
  ([`routes_logs_ws.go:221-222`](../../../harmony-link-private/management/routes_logs_ws.go:221)).
- WS stream ([`server.go:572-575`](../../../harmony-link-private/management/server.go:572),
  [`routes_logs_ws.go:68+`](../../../harmony-link-private/management/routes_logs_ws.go:68)):
  `GET /api/development/logs/stream` — outside header-based auth (browsers can't send headers on WS);
  the handler validates an `apiKey` query param; clients push in-band JSON filter updates; server streams
  entry + dedup-remove events.
- Auth ([`mobile_auth.go`](../../../harmony-link-private/management/mobile_auth.go)): the fixed build-time
  `X-Admin-API-Key` must never live in the app binary (:16-17); instead the sidecar/facade mints a random
  **per-boot loopback token** (`SetLoopbackToken` before the `ENGINE_READY` line, :35-38), accepted only
  for loopback peers (`isLoopbackPeer` reads `RemoteAddr` directly, :51-52);
  `mobileAuthMiddleware` accepts admin key OR loopback token (:68-83); empty token = disabled
  (desktop/cloud contract unchanged); cloud mode skips validation (D-05).
- **Why logs are admin-key-only today**: the handlers sit in `dev := api.Group("/development",
  apiKeyAuthMiddleware(...))` ([`server.go:319`](../../../harmony-link-private/management/server.go:319)) —
  a Gin subgroup stacks its middleware on the parent `api` group's `mobileAuthMiddleware`, so the
  intersection is effectively admin-key-only.

### App side (nothing exists)
- No client methods for any log endpoint; no viewer screen; `react-native-fs` present,
  **no share library** ([`package.json`](../../../harmony-ai-app/package.json)); the loopback token is
  already plumbed from the readiness handshake into `EngineApiClient`'s auth headers.
- Desktop parity reference (feature set to mirror): Wails Dev-Tools Log Viewer — live WS stream with
  buffered batch render updates, REST ring-buffer history fallback on load, level filtering, grouped
  request/response view, dedup counts.

## Design

### 1. Engine: capture logs in embedded compositions
`enginehost` calls `logging.InitRingBuffer(...)` + `log.AddHook(...)` — one place, inherited by both the
Android sidecar and the iOS facade. Capacity: default 10 000 (desktop parity), overridable via
`SE_LOG_RING_BUFFER` (clamped 1 000–50 000) for constrained devices. Leave `cmd/run.go` as-is (working);
note a future cleanup could share one helper. Bounded memory (~ a few MB at 10k entries) is acceptable.

### 2. Engine: auth re-scoping (owner-directed simplification)
- **REST:** move the seven log-handler registrations from the admin-keyed `dev` subgroup to the
  `mobileAuth` `api` group — **paths unchanged** (`/api/development/logs*`). Desktop unaffected (admin key
  remains accepted by `mobileAuthMiddleware`); the app reaches them with the loopback token at the same
  trust level as the chat/provider/backup/sync-key routes. The remaining dev routes (entity
  test-actiongraphs, simulator, integrations) stay admin-keyed — control surfaces vs. diagnostics.
- **WS:** extend `handleLogStream` to accept `token=<LoopbackToken()>` for `isLoopbackPeer` connections
  alongside the existing `apiKey` query param — the same accept-either pattern the REST middleware
  implements. Query-param auth for WS is the route's established design; the loopback token is
  loopback-scoped, so query-string exposure adds no new reachable trust boundary.
- **Tests:** the established auth matrix (`routes_messages_test.go:253+` pattern) for the moved routes +
  WS handshake: loopback peer + token → OK; non-loopback peer + token → 401/close; wrong token → 401/close;
  admin key → still OK; no credential → 401/close.
- **Versioning:** auth-scope note in `docs/Management-API-Versioning.md`; **no version bump** (long-existing
  paths/shapes; desktop behavior identical). App-side: add the endpoints to
  `REQUIRED_ENGINE_ENDPOINTS` + fixtures (manifest additions pass against any engine bearing these routes).

### 3. App: client surface
- `EngineApiClient`: `engineLogs(params)` (GET `/api/development/logs` with the filter set), `engineLogCount`,
  `engineLogComponents/Entities/PromptTypes`, `engineLogLevels` GET/PUT. DTOs mirror the engine's
  `LogEntry`/`LogFilter` (id, timestamp, level, component, entity_id, message, data, dedup count,
  is_prompt, prompt_type).
- `EngineLogStream`: WS client to `ws(s)://127.0.0.1:<port>/api/development/logs/stream?token=<loopback>`
  (token from the same readiness payload `EngineApiClient` uses); handles entry/remove events, in-band
  filter updates, reconnect/backoff following the app's existing engine-WS patterns.

### 4. App: `EngineLogScreen`
- Entry point: Settings → Help & Support → "Engine logs" row.
- View: virtualized reverse-chron list; live tail with follow/pause; dedup-count badges updated by remove
  events; filters — level chips, component picker (`/components`), entity picker (`/entities`), free-text
  search, prompt-only toggle + prompt-type picker; initial backfill via REST query then WS follow (the
  Wails pattern), "load older" pagination via REST; in-memory cap (~2 000 rows).
- Verbosity (advanced section, collapsed by default): current level config display + PUT to change, labels
  matching desktop semantics exactly; copy warns about battery/log-volume at verbose levels.
- Render batching: coalesce WS frames into ~250 ms render updates (Wails-style buffered batches).

### 5. Export / diagnostics
- New dependency: `react-native-share` (owner gate: pod install + gradle, ABI watch — 7-3 precedent).
- "Share diagnostics" action: builds a report — header (app version `DeviceInfo.getVersion()`, engine
  version via 7-10's `engineAppVersion()` or `/public/appversion`, management-contract version, platform/OS,
  device model) + log dump (choice: current filter window or full buffer; entry format mirrors the desktop
  viewer's shape) → `react-native-fs` write to cacheDir → OS share sheet.
- Privacy: prompt-type entries contain conversation text — the dump is the user's own data and sharing is
  an explicit action through the OS sheet; screen copy states what's included. **No automatic upload
  anywhere** (cloud stays data-blind).
- Long-press "copy entry" for single-line error snippets.

## Implementation steps

1. Engine: `enginehost` ring-buffer init (+ `SE_LOG_RING_BUFFER`, clamp) + composition test (log → query
   via management API on an enginehost instance).
2. Engine: re-register the 7 log routes under the `mobileAuth` group (paths unchanged) + WS `token` param
   + auth-matrix tests.
3. Engine: Management-API-Versioning auth-scope note + CHANGELOG.
4. App: `EngineApiClient` methods + DTOs + fixtures + `REQUIRED_ENGINE_ENDPOINTS` additions.
5. App: `EngineLogStream` WS client (+ fake-engine tests, existing sync-service test patterns).
6. App: `EngineLogScreen` + `engineLogs.json` i18n (en) + Help & Support entry row.
7. App: export flow + `react-native-share` dep + diagnostics header.
8. Docs + changelogs + memory banks (both repos).

## Files to create/modify

- **Engine:** `enginehost/enginehost.go` (+ ring-buffer init, env), `management/server.go` (route
  re-registration), `management/routes_logs_ws.go` (token auth), `management/routes_logs_test.go` or new
  auth-matrix test file, `docs/Management-API-Versioning.md`, `CHANGELOG.md`.
- **App:** `src/services/engine/EngineApiClient.ts` (+ methods/DTOs), new
  `src/services/engine/EngineLogStream.ts` (+ tests), new
  `src/screens/settings/EngineLogScreen.tsx` (+ tests), `src/services/engine/engineContract.ts`
  (manifest), fixtures in `src/services/engine/__fixtures__/`, `src/i18n/locales/en/engineLogs.json` (+
  registration), `src/screens/settings/HelpSupportSettingsScreen.tsx` (entry row), new
  `src/services/diagnostics/buildDiagnosticsReport.ts` (+ tests), `package.json` (+react-native-share),
  `CHANGELOG.md`.

## Verification gates (owner-run, repo conventions)

- Engine: `CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK'` build/vet/test green;
  new auth matrix green; enginehost ring-buffer test green (captures + queries + streams).
- App: `tsc` 0; jest green (client methods, stream client, screen filter logic, report builder, manifest
  conformance); `pod install` + gradle sync after the share dep.
- Owner device drills (Android + iOS): live tail shows entries while chatting; filters + verbosity change
  behave; export lands in the share sheet with the correct diagnostics header; non-loopback access with
  the token rejected (e.g. via port-forward attempt).

## Owner gates

- `react-native-share` native dependency addition (pods + gradle impact).
- Diagnostics-report header contents sign-off.
- Verbosity control exposure in the app UI confirmed in-scope (per ruling).

## Progress checklist

- [x] 1. enginehost ring-buffer init + env + test
- [x] 2. Route re-registration + WS token auth + auth matrix
- [x] 3. Versioning note + engine CHANGELOG
- [x] 4. EngineApiClient methods + manifest/fixtures
- [x] 5. EngineLogStream WS client
- [x] 6. EngineLogScreen + i18n + entry row
- [x] 7. Diagnostics export + share dep
- [x] 8. Docs, changelogs, memory banks
- [ ] Owner: share-dep sign-off · header sign-off · device drills (both platforms)
