# External Integrations

**Analysis Date:** 2026-08-07

## APIs & External Services

**Soulbits Cloud Backend (first-party, primary cloud integration):**
- Backend repo: sibling `soulbits-cloud-backend` (Go, REST + WebSocket) in the same GOPATH org — NOT part of this repo
- REST client: `@harmony-ai-solutions/soulbits-api-client` (git dependency pinned to commit `518c9e8...`, built on `openapi-fetch`), factory at `src/services/cloud/soulbitsClient.ts`
- Host resolution: `src/config/cloud.ts` — `https://{beta.}cloud.soulbits.app` (API gateway routing `/v1/auth/*` → auth-service, `/v1/session/*` → session-broker), `https://{beta.}api.soulbits.app` (inference), `wss://{beta.}connect.soulbits.app` (conduct proxy)
- Endpoints (auth-service, `AUTH_ENDPOINTS` in `src/config/cloud.ts`): `POST /v1/auth/login`, `/register`, `/refresh`, `/logout`, `/google`, `/apple`, `/resend-verification`, `GET /v1/auth/me`
- Session broker: `POST /v1/session/connect`, `/disconnect` via `CloudSessionService` (`src/services/cloud/CloudSessionService.ts`) — async provisioning with 202 polling, max 95 attempts, 2s retry (`DEFAULT_CLOUD_RETRY_MS`, `MAX_PROVISIONING_ATTEMPTS` in `src/config/cloud.ts`)
- Inference: public `GET /v1/models` model catalog with 5-min cache + static fallback (`src/services/cloud/soulbitsModelsCatalog.ts`); inference URL passed to the soulbits client
- WebSocket conduct proxy: `/ws/sync`, `/ws/worker` paths (`WS_PATHS` in `src/config/cloud.ts`); classes in `src/services/websocket/CloudWebSocketConnection.ts`
- Auth: **PASETO v4.local** bearer tokens + rotating refresh tokens; the client is built PASETO-only (no auto-refresh — refresh is owned by `AuthService`, see `src/services/cloud/soulbitsClient.ts`)

**Harmony Link (self-hosted desktop bridge, Go/Wails):**
- Backend repo: sibling `harmony-link-private` (Go, `go.mod` present there) — a desktop app the mobile app pairs with over LAN
- WebSocket endpoints: WSS `/events` (secure) / WS (unencrypted) — URLs + JWT + server cert persisted in AsyncStorage (`src/services/ConnectionStateManager.ts`, storage keys `harmony_wss_url`, `harmony_jwt`, `harmony_server_cert`, `harmony_security_mode`)
- Security modes: `secure` (wss + pinned self-signed cert), `insecure-ssl`, `unencrypted`, `cloud` — implemented by `src/services/websocket/InsecureSSLWebSocketConnection.ts`, `SecureWebSocketConnection.ts`, `UnencryptedWebSocketConnection.ts`, factory in `src/services/websocket/WebSocketConnectionFactory.ts`
- Pairing flow: `ConnectionSetupScreen` (`src/screens/setup/ConnectionSetupScreen.tsx`), `InitialPairingModal` (`src/components/modals/InitialPairingModal.tsx`)
- Sync protocol: `src/services/SyncService.ts`, `src/services/websocket/BaseWebSocketConnection.ts`, `src/database/sync.ts`; schema parity between the RN app and the Go engine is enforced in CI (`.github/workflows/build-release.yml` job `schema-parity`, using `scripts/compare-schemas.py` + `scripts/dump-schema.ts`)
- E2E override: `HARMONY_LINK_WSS_URL`/`HARMONY_LINK_WS_URL` injected as Android buildConfigFields (dev flavor only) — `applyE2EOverride()` in `ConnectionStateManager`

## Data Storage

**Databases:**
- SQLite via `react-native-sqlite-storage` `^6.0.1` — local DB `harmony.db` at `RNFS.DocumentDirectoryPath` (`src/database/connection.ts`); WAL mode, foreign keys ON, synchronous NORMAL; secondary connection for sync write-transactions (`getSyncDatabase()`)
- 36 migration files in `src/database/migrations/0000XX_*.ts` (initial schema through `000036_backfill_character_profile_source`), applied by `src/database/migrations.ts`. Migrations 000035/000036 create a CLIENT-ONLY sidecar `character_profile_sources` (source tagging for the Discover community grid) — excluded from the schema-parity dump.
- Repository layer: `src/database/repositories/` (characters, conversation_messages, entities, interactions, memories, modules, sync, emotion_state, emoji_actions, providers)
- Node-side SQLite (`better-sqlite3`, devDependency) mirrors the schema for tests: `src/database/__test_utils__/nodeDatabase.ts`, `schema/rn-schema.json`

**File Storage:**
- Local filesystem only (`react-native-fs`): database files, audio recordings, imported images/character cards. No cloud object-storage client in the app

**Caching:**
- In-memory caches only: `soulbitsModelsCatalog` model cache (5-min TTL + single-flight, `src/services/cloud/soulbitsModelsCatalog.ts`); AuthService in-memory token cache (`src/services/auth/AuthService.ts`). No Redis/Memcached

**Secure Storage:**
- `react-native-keychain` — Keychain service `com.harmonyai.cloud.auth` for cloud PASETO/refresh tokens (`src/services/auth/tokenStorage.ts`); service `com.harmonyai.database` for the DB encryption key (SQLCipher not linked — key generated but unused for encryption, per comments in `src/database/connection.ts`)

## Authentication & Identity

**Auth Provider:**
- First-party Soulbits auth-service (JWT-alternative: PASETO v4.local + rotating refresh tokens), flows in `src/services/auth/AuthService.ts`
- **Google Sign-In**: `@react-native-google-signin/google-signin` `^16.1.2` (`src/services/auth/googleSignIn.ts`) — native id_token flow; Android auto-discovers OAuth client from `android/app/google-services.json`; iOS uses `GOOGLE_WEB_CLIENT_ID` (webClientId) + `GoogleService-Info.plist` (`ios/HarmonyAIChat/GoogleService-Info.plist`, `-Dev.plist`); backend endpoint `POST /v1/auth/google`
- **Apple Sign-In**: `@invertase/react-native-apple-authentication` `^2.5.1` (`src/services/auth/appleSignIn.ts`) — identity_token flow, `POST /v1/auth/apple`; needs `APPLE_SERVICES_ID` (injected per-flavor)
- OAuth identifiers injected at build time by `scripts/oauth-secrets.cjs` from gitignored GCP `client_secret_*.json` — never hardcoded (`OAUTH` object in `src/config/cloud.ts`)
- Local/Harmony-Link auth is a separate self-hosted JWT (`harmony_jwt` in AsyncStorage), independent of cloud credentials

## Third-Party AI Providers (user-configured)

- Provider configs stored in SQLite and synced to the engine; repos in `src/database/repositories/providers/`:
  - Anthropic, OpenAI, OpenRouter, Mistral, XAI, Google, Ollama (local), LocalAI, OpenAI-compatible, CharacterAI, Kindroid, Kajiwoto, ElevenLabs (TTS), ComfyUI (image), HarmonySpeech (speech engine), SoulbitsCloud (cloud inference)
- The SoulbitsCloud provider stores the current cloud PASETO as its `api_key` and is bulk-refreshed on token rotation (`updateAllSoulbitsCloudApiKeys` in `src/database/repositories/providers/SoulbitsCloudProviderConfigRepository.ts`)
- The app does not call these providers directly — it passes their configs to Harmony Link / Soulbits engine over sync (`src/services/SyncService.ts`)

## Monitoring & Observability

**Error Tracking:**
- None external. `src/components/ErrorBoundary.tsx` catches render errors in-app; no Sentry/Bugsnag/Crashlytics SDK detected

**Logs:**
- `react-native-logs` `^5.5.0` with console transport (`src/utils/logger.ts`) — namespace loggers via `createLogger('[Namespace]')`, `[SOULBITS]` tag for ADB logcat filtering, severity `error` in production. No remote log shipping

## CI/CD & Deployment

**Hosting:**
- Artifact distribution: AWS S3 bucket `soulbits-releases` (region `eu-central-1`) served via `download.soulbits.app`; APK/IPA uploaded per version and per environment (`dev`/`prod`) by `.github/workflows/build-release.yml`; GitHub Releases created with download links

**CI Pipeline:**
- GitHub Actions (`.github/workflows/`):
  - `test.yml` — PR/push gate: typecheck (`tsc --noEmit`) + lint, unit tests w/ coverage, integration tests, migration tests (Node 20, ubuntu-latest)
  - `build-release.yml` — tag/`workflow_dispatch` builds: schema-parity gate (vs `harmony-link-private` Go schema, requires `HARMONY_LINK_REPO_PAT`), test gate, Android APK matrix (dev/prod, JDK 17, release keystore from secrets), iOS IPA matrix (macos-15, unsigned `xcodebuild archive`), S3 upload, GitHub Release
  - `e2e-android.yml` — Maestro E2E in Docker (KVM, Android 14 emulator, `soulbits/harmony-link:latest` image)
  - `e2e-ios.yml` — Maestro E2E against iOS Simulator on macos-15 with native Go Harmony Link binary
  - `schema-parity.yml` — dedicated schema drift check
- Secrets used: `HARMONY_LINK_REPO_PAT`, `ANDROID_RELEASE_KEYSTORE_BASE64`/`_PASSWORD`/`_ALIAS`/`KEY_PASSWORD`, `AWS_S3_UPLOAD_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`; vars `GOOGLE_WEB_CLIENT_ID`, `APPLE_SERVICES_ID`

## Environment Configuration

**Required env vars** (per `src/config/cloud.ts`, injected natively, exposed via `react-native-config`):
- `APP_ENV` — `'dev' | 'prod'` (defaults to `__DEV__ ? 'dev' : 'prod'`)
- `IS_BETA` — boolean build flavor switch (Android: real boolean; iOS: string from xcconfig — handled with `=== true || === 'true'`)
- `GOOGLE_WEB_CLIENT_ID` — iOS Google OAuth web client ID
- `APPLE_SERVICES_ID` — Apple Sign-In services ID
- `HARMONY_LINK_WSS_URL` / `HARMONY_LINK_WS_URL` — E2E-only Android buildConfigFields (dev flavor; empty in prod)

**Secrets location:**
- Build-time OAuth secrets sourced from gitignored GCP `client_secret_*.json` files via `npm run oauth:dev|prod` (`scripts/oauth-secrets.cjs`), writing `.env` (iOS/Metro) and `android/gradle-secrets.<flavor>.properties` (Android)
- Runtime secrets: Keychain (cloud tokens, DB key), AsyncStorage (Harmony Link JWT + server cert)
- `.env.example` present (repo root) — template; actual `.env` is gitignored

## Webhooks & Callbacks

**Incoming:**
- None (mobile client — no public webhook endpoints)

**Outgoing:**
- No outgoing webhooks; all push-style traffic is over WebSocket: `wss://connect.soulbits.app/ws/sync` + `/ws/worker` (cloud, `src/config/cloud.ts`) and the Harmony Link WSS `/events` endpoint (`src/services/ConnectionStateManager.ts`)

---

*Integration audit: 2026-08-07*
