# 03 — Canonical Pattern Cheat-Sheet

> Reference for the follow-up work (stubs, engine parity, editor consolidation) and for onboarding. Every claim cites the file that establishes the pattern on `feat/cloud-lifecycle`. Companion to `docs/TESTING.md` and `docs/schema-parity.md`.

## 1. Cloud API client

**Pattern:** single factory over the first-party typed client; PASETO-only (no client-side refresh); hosts from one config module; app-local typed errors at service boundaries; bounded retries; EventEmitter status singletons.

- `src/services/cloud/soulbitsClient.ts` — the only `createClient(...)` call site for authed traffic; deliberately passes **no refreshToken** so `AuthService` stays the single credential authority; consumers rebuild the client with the freshest token per call (`CloudSessionService._runConnectLoop`).
- Client sub-APIs (auto-routed by host): `account`, `apiKeys`, `session`, `subscription`, `devices`, `models`, `inference`.
- `src/config/cloud.ts` — `CLOUD_HOSTS` single source of truth; `IS_BETA` build flavor; `USE_LOCAL_BACKEND` dev override → the precedent for stub env flags.
- Auth: PASETO+refresh in **Keychain** (`tokenStorage.ts`, service `com.harmonyai.cloud.auth`); `AuthService` EventEmitter (`auth:changed`/`auth:expired`) with single-flight refresh. Self-hosted JWT lives separately in AsyncStorage `harmony_jwt`.
- Errors: client `APIError` (+`DeviceAuthRequiredError`, `PurgeInProgressError`, …) mapped to app-local errors in the service (`DeviceAuthService.toDeviceAuthError`).
- Polling/retry: typed `session.connectPoll` with absolute budget (`CloudSessionService`, 180s); bounded named-constant retries (purge: 10×3s snapshot-busy, 40×3s in-progress).
- Never-throw catalog: `soulbitsModelsCatalog.ts` — 5-min TTL cache + in-flight promise map + static fallback lists.
- Deep links: pure dependency-free parser + unit tests (`deviceDeepLink.ts`).

## 2. Local DB

**Pattern:** forward-only numbered TS-string migrations registered in one array (engine-mirrored 1:1, reserved-number placeholders when one side is a no-op); models mirror Go structs; free-function repositories; soft-delete + timestamp triple.

- `src/database/migrations/000NNN_description.ts` → `export const migrationNNN = \`-- SQL\``; registered in `src/database/migrations.ts` (`MIGRATIONS[]`); runner splits on `;`, records into `schema_migrations`.
- Guard rails: `assertMigrationSqlSupported` rejects `DROP/RENAME COLUMN`; `_new`-table rebuild pattern for column changes (see 000040).
- `models.ts` = 1:1 Go struct mirror; snake_case; JSON blobs as `string`.
- Connection: module singletons `db` + `syncDb` (secondary connection for sync writes), WAL, `foreign_keys=ON`.
- Repositories: exported async functions, `getDatabase()` internal, `withTransaction` (single awaited statement) / callback `db.transaction` (multi-statement, insertId), `rowsAffected === 0 → throw`, soft delete default, `includeDeleted` opt-in, lazy TEXT-column chunking via `loadTextColumn`.
- Parity: `scripts/dump-schema.ts` → `schema/rn-schema.json`; CI diff vs Go dump (`docs/schema-parity.md`). New synced table = migration **both sides** + baseline regen.

## 3. Sync architecture

**Pattern:** table-driven bidirectional record sync over the engine WS protocol; hardcoded FK-ordered push list; watermark contract; LWW; buffered atomic apply on the secondary connection.

- Table list: `SyncService.sendLocalChangesSequentially` (provider configs → module configs → `character_profiles` → `character_image` → `entities` → `entity_module_mappings` → `interactions` → `conversation_messages` → `emotion_state` → `lifecycle_state` → `entity_emoji_actions` → `memories`). Onboarding a table = engine mirror migration + array entry + normalization maps + parity gate.
- Watermark: per-source unix timestamps in AsyncStorage (`last_sync_timestamp:selfhosted|cloud`); predicate `CAST(strftime('%s', ts) AS INTEGER) > watermark`; tables need TEXT `created_at/updated_at/deleted_at` (000040 is the reference rebuild).
- Apply: `applySyncRecord` insert-or-LWW (`incomingUpdated >= existingUpdated`) or soft-delete; `serverRecordIds` re-push exclusion; name-clash absorption for engine-seeded configs (`syncNameClash.ts`).
- There is **no runtime exclusion list** — parity CI is the exclusion mechanism; engine-only tables get reserved app-side no-op migrations (000039 pattern).

## 4. Client state & storage

**Pattern:** AsyncStorage for non-secret per-device state with module-level key constants; Keychain only for secrets; no MMKV/Redux/SecureStore.

- Legitimate keys: connection layer `harmony_*` (jwt/ws urls/device id/mode `connection_mode`/sync watermarks); UI contexts `@harmony_*` (theme, emoji set/recent, language `@harmony_language`); settings (`@harmony_setting_haptic_feedback`, biometric/PIN); per-chat prefs `chat_entity_pref_<id>`; device id `soulbits.device_id`.
- Secrets → Keychain only. **Currency/payment/social-graph state does not belong here either** (that's cloud data; AsyncStorage is not a loophole — see 00-Research §11).

## 5. Cloud-only state & mode logic

- Mode source of truth: AsyncStorage `connection_mode` (`selfhosted|cloud`), written by ConnectionSetupScreen, read via `ConnectionStateManager.getCurrentSource()`.
- Cloud session state: `cloudSessionService` in-memory EventEmitter (`idle|requesting|provisioning|ready|deviceAuthRequired|failed|purging`) — no persistence by design.
- Device authorization: derived per-call from backend (`DeviceAuthService.getStatus()`); local artifact only `soulbits.device_id`.
- Module-config cloud handling: **engine seeds default soulbitscloud rows; app mirrors token** (`soulbitsTokenSync.ts` bulk-injects on `auth:changed`); managed fields hidden in editor via `isManagedCloudField`; `ModuleConfigEditScreen` computes cloud context from `connectionStatus`.
- Mode-aware UI: pure helpers `computeConnectionStatus` / `canUseChatForMode` (unit-tested).

## 6. Feature gating & placeholders

- `ComingSoonScreen` + i18n-keyed params (route-registered) — the "coming soon" idiom (`AccountSettingsScreen`, `AppearanceSettingsScreen`, `HelpSupportSettingsScreen` use it).
- `__DEV__` gates for dev screens (DatabaseTableViewer, dev settings card).
- Build-flavor env via `react-native-config` (`IS_BETA`, `APP_ENV`, `USE_LOCAL_BACKEND`) — the precedent stub flags must follow. No formal FeatureFlag infra; runtime gating = `connection_mode`.

## 7. Navigation & i18n

- `AppNavigator.tsx`: typed `RootStackParamList`; screens registered explicitly, grouped; new screen = import + param-list entry + `<Stack.Screen>`.
- Tabs: `MainTabNavigator` + `GlassTabBar` with `tabBarButtonTestID` per tab. (Post-rebase tab set per her design: `Characters | Chat | Discover | Market | MyProfile`.)
- Screen anatomy: named-export function; `const { theme } = useAppTheme(); if (!theme) return null;`; `useTranslation('<ns>')`; themed primitives (`ThemedView/Text/Gradient`, `ScreenHeader`, `ThemedCard`, `ThemedButton`); `useSafeAreaInsets`; `testID` + `accessibilityLabel`.
- i18n: one JSON namespace per domain in `src/i18n/locales/en/`, **registered in `I18nContext.tsx`** (the real registry — `locales/index.ts` re-exports only a subset); `defaultNS: 'common'`; language persisted `@harmony_language`.

## 8. Testing

- Jest 30, two projects: `unit` (`src/**/*.test.ts(x)` + `__tests__` minus integration) and `integration` (`__tests__/integration/**`). `npm test` = both. Unit uses `--maxWorkers=45` (better-sqlite3 worker isolation — bump when file count grows).
- DB tests: `useFreshDatabase()` in-memory better-sqlite3 + `getDatabase` mock (`repositoryFixtures.ts`).
- Migration suites: full-schema snapshot + roll-forward (regenerate with `-u`, inspect, commit `.snap` with the migration change).
- Sync integration: `HarmonyLinkMockServer` EventEmitter protocol mock + `runFullSync`/`resetSyncService`/`fixtures` helpers; only for sync-protocol-touching code.
- Cloud services: mock `@harmony-ai-solutions/soulbits-api-client` via `jest.mock` with fns stashed on module exports (`deviceAuth.test.ts` pattern).
- CI per PR: typecheck + unit + integration + schema parity; nightly Maestro E2E; release-gated.

## Stub-layer rules (binding for Track A of 02-Followup)

1. UI screens stay; only the service layer swaps. **[O5 ruling]** stubs ship in ALL builds (no visibility flag — "let's not overcomplicate things"); the service interface is the swap seam for the future backend implementation.
2. Service = typed API + app-local errors; UI imports only the service.
3. Stub backend = in-memory fixtures + latency; types pre-match future wire shapes (`soulbits-api-client` subscription/quota types).
4. Persistence: AsyncStorage (lightweight, per-device) or nothing — **never** new parity-governed tables for cloud data.
5. No new state-management libraries.
6. Every new screen/service follows §7 conventions and adds tests per §8.
7. Honest stubs: errors surface as errors ("feature not yet available" states), never fake-success flows.
