# Phase 7-3 — App: Sync UI — Transport Picker, Cloud Pairing, QR

> **Repo:** `harmony-ai-app`
> **Created:** 2026-10-12 (Phase 7)
> **Depends on:** 3-5 (DesktopSyncScreen + engine REST control — the base this extends), 7-1 (relay live for E2E), 7-2 (engine relay transport + group-key contract)

## Objective

Extend the 3-5 DesktopSyncScreen into the full sync settings surface: choose **LAN direct** or **Soulbits Cloud relay**, pair cloud devices with a **QR code** (manual code fallback), see per-transport status, and manage the account-side bits the app owns (relay token injection, escrow wrap delivery).

## Design

### 1. Transport picker

Section on the sync screen: `LAN (direct)` | `Soulbits Cloud` — maps to `PUT /api/sync/client {transport, peer_address | relay_url}`. LAN fields exactly as 3-5. Cloud fields: relay URL (default from build config), account status (signed-in check via existing auth context), sync-group state (`uninitialized | member | key_pending` from engine status).

### 2. Cloud pairing flow (QR first, manual fallback)

- **QR scan:** scan a code shown by the portal (7-4) or desktop — payload `{relay_url, pairing_token, account_hint}`. The app: verifies signed-in account matches `account_hint` → PUTs relay config to the engine → engine consumes the pairing token on first connect (7-2) → status card shows `pairing → syncing`.
- **Manual fallback:** paste pairing code (same payload as string). Identical flow.
- QR library: `react-native-camera-kit` or `react-native-vision-camera` + a QR decoder — pick per repo conventions/what's already in the dependency tree (check first; if neither is present, `react-native-qrcode-scanner`-class minimal dep, justified in the report).
- App-side relay credential: obtain relay token via the signed-in session (auth-service issuance per 7-1), inject via `PUT /api/sync/client {relay_token}`; refresh on 401-policy-close from engine status (app listens for the engine's state → `token_expired`).

### 3. Group-key / escrow UX

- First cloud-device (engine reports `uninitialized`): "Start cloud sync" → engine `POST /api/sync/group/init` returns the escrow wrap blob → app PUTs it to the account escrow (2-5 endpoint, second slot) → engine status flips to `member`. Progress + failure states surfaced.
- Joining device (engine `key_pending`): sign-in → app GETs wrapped key from escrow → injects to engine (unwrap route from 7-2) → `member`.
- "Reset sync key" (danger zone, confirm dialog): engine rotate → re-wraps → other devices re-baseline on next connect (copy explains this).

### 4. Status card extension

3-5's card gains: transport badge (LAN/Cloud), relay round-trip indicator (last frame seq + age), sync-group membership list (device names from the relay status/group state — read-only; management is portal-side 7-4).

## Implementation steps

1. EngineApiClient extensions (transport/relay/group-key/escrow-blob methods — contract from 7-2's report).
2. Transport picker + cloud fields + credential injection/refresh.
3. QR scan + manual pairing flows.
4. Group-key/escrow UX (init/join/rotate).
5. Status card extension + tests (mock engine + mock escrow per 3-2/2-5 patterns); screen tests.

## Verification gates

- `npx.cmd tsc --noEmit` → 0; `npm.cmd run test` green.

## Owner device gates

- QR pairing against staging portal; two devices syncing through the relay; rotation drill on device.

## Progress checklist

- [x] EngineApiClient extensions + tests
- [x] Transport picker + relay credential flow
- [x] QR + manual pairing — manual entry + **QR camera scan landed** (owner-approved `react-native-camera-kit`, 2026-10-12; see notes)
- [x] Group-key/escrow UX (init/join/rotate; cloud slot mocked pending 7-4)
- [x] Status card extension
- [ ] Owner device gates

## Implementation notes (2026-10-12, `feat/app-engine-parity`)

App (`harmony-ai-app`) — landed.

- **Contract bump 1.0.0 → 1.1.0 (complete).** `ENGINE_CONTRACT_VERSION`
  (`src/services/engine/engineContract.ts`), the vendored typed fixtures
  (`__fixtures__/managementContract.fixtures.ts`) and the manifest moved in
  lockstep with the engine openapi 1.1.0: 5 new `syncGroup.*` endpoints,
  `syncClientStatus` extended (`sync_group`/`rotation_required`/`relay` + the new
  `config` fields), new `syncGroupKeyStatus` fixture. Verified against the engine
  repo's canonical `docs/api/management/fixtures/management-contract.fixtures.json`
  with `node scripts/check-engine-contract.mjs --engine-repo … --engine-fixtures …`
  → versions match, 26 endpoints, 28 fixtures.
- **EngineApiClient** — `getSyncGroupKeyStatus`/`initSyncGroup`/`importSyncGroup`/
  `rotateSyncGroup`/`setSyncGroupRotationRequired` + the extended sync DTOs
  (`SyncClientTransport`, `RelayStatusDto`, `SyncGroupState`, `SyncGroupKeyStatusDto`;
  `SyncClientState` gained `auth_needed`/`quota_exceeded`).
- **`src/services/sync/`** — `syncCloudTypes` (pairing payload parse + account-hint
  match), `SyncKeyEscrow` (`/v1/account/sync-key` — the sibling of the 2-6
  `BackupKeyEscrow`; the wrap is server-side KMS/W1, so the app PUTs the raw
  base64), `SyncRotationClient` (`/v1/account/sync-rotation-required`),
  `SyncGroupOrchestrator` (init/join/rotate + escrow + flag; deps injected for tests).
- **DesktopSyncScreen** — transport picker (LAN ↔ Soulbits Cloud) + cloud fields +
  relay status block + pairing card + sync-group key card + rotation banner;
  auth_needed auto-recovery (refresh PASETO → re-PUT `relay_token`, loop-guarded);
  `quota_exceeded` copy. i18n: `desktopSync.json` extended.
- **Scanner decision (RESOLVED — owner ruling 2026-10-12).** The owner approved
  **`react-native-camera-kit`** (option b) for QR scanning. It is now a dependency
  (`react-native-camera-kit@^18.0.1`, installed as 18.0.1) and the QR button is
  **wired**: `handleScanQr` requests camera permission then opens a full-screen
  `QrScannerModal` (`src/components/modals/QrScannerModal.tsx`) built on the
  library's `<Camera scanBarcode onReadCode …/>`; the scanned string is passed to
  the existing `parseSyncPairingPayload` → `accountHintMatches` → relay-config PUT
  path (shared with manual paste via `handlePairFromCode(rawCode)`). The manual
  paste fallback is unchanged. See the "QR camera scanning wiring" note below.

- **7-4 dependencies.** The `/v1/account/sync-key` and
  `/v1/account/sync-rotation-required` cloud endpoints are coded against the pinned
  shapes and **mocked in tests** (7-4 lands them in parallel). The mint response
  the app never calls (the portal mints; the app scans) — note the 7-4 doc sketch
  (`{pairing_token, relay_url, expires_at}`) differs from the task's pinned
  `201 {token, dataset_id, device_id, expires_at}`; flagged for 7-4 reconciliation.
- **Relay URL default.** `SYNC_RELAY.defaultRelayUrl` (`config/cloud.ts`) is a
  build-flavour default (`wss://[beta.]sync.soulbits.app/v1/sync/ws`, local
  `ws://…:8093`) used only by the manual-entry fallback; the QR payload is
  authoritative. Flagged for 7-4 to confirm the production hostname.

### QR camera scanning wiring (2026-10-12, follow-up)

App (`harmony-ai-app`) — landed. Owner ruling: **`react-native-camera-kit`**.

- **Dependency.** `react-native-camera-kit@^18.0.1` (installed **18.0.1**), added via
  `npm.cmd install react-native-camera-kit`. It is a bare-RN autolinked native view
  manager (`codegenConfig` native component `CKCamera`) — **no config plugin / Expo
  requirement** (Expo Managed would need the third-party `expo-react-native-camera-kit`
  plugin; this is a bare app). Its own `android/src/main/AndroidManifest.xml`
  already declares `android.permission.CAMERA` (+ READ/WRITE_EXTERNAL_STORAGE), so
  the **app manifest needs no change** (the merger pulls it in; CAMERA is not
  duplicated in `android/app/src/main/AndroidManifest.xml`).
- **Scanner surface.** New `src/components/modals/QrScannerModal.tsx` — a
  full-screen `<Modal>` (matches `ImageViewerModal`'s full-screen language) wrapping
  the library's `<Camera scanBarcode showFrame frameColor laserColor onReadCode/>`
  in a `<Suspense>` boundary (the library's `Camera` export is `React.lazy`). The
  camera mounts only while `visible` (RN keeps modal children mounted when hidden —
  a live capture session in the background would drain battery / hold the camera).
  A single-shot ref guards against duplicate `onReadCode` emits (camera-kit keeps
  emitting while a code stays in frame); the parent also debounces with
  `scanProcessingRef`.
- **Flow reuse (no new pairing logic).** `DesktopSyncScreen.handlePairFromCode` was
  refactored to take the raw code string; both manual paste and scan call it, so the
  scanned string goes through the SAME `parseSyncPairingPayload` → `accountHintMatches`
  → relay-config PUT path. The manual paste fallback is unchanged.
- **Permissions.** `handleScanQr` calls the existing
  `checkAndRequestPermission(PERMISSIONS.CAMERA)` (`src/utils/permissions.ts`)
  BEFORE opening the scanner (so the preview is never the "blank/black" frame the
  library warns about). Denied → a themed alert with friendly copy + **Open
  settings** (`openAppSettings()` → `Linking.openSettings()`) pointing at manual
  paste; the scanner never opens. iOS `NSCameraUsageDescription` added to
  `ios/HarmonyAIChat/Info.plist` (none existed; image-picker had not added one) —
  iOS relies on the OS prompt on first camera access (the app's permission helper is
  an iOS no-op by design).
- **i18n.** New `desktopSync` keys (`scanTitle`, `scanInstruction`, `scanClose`,
  `scanPermissionTitle`, `scanPermissionMessage`, `scanOpenSettings`); the two stub
  keys (`scanUnavailableTitle`/`scanUnavailableMessage`) removed. Only the `en`
  bundle exists — **de/ar fall back to en** (i18next `fallbackLng`), the established
  convention.
- **Tests.** `react-native-camera-kit` is mocked globally in `jest.setup.js` (the
  native view manager can't load under Jest — its codegen component throws
  "Could not find component config for native component"), exposed as a host view
  carrying `onReadCode` so a scan is fired with
  `fireEvent(camera, 'readCode', { nativeEvent: { codeStringValue } })`.
  `DesktopSyncScreen.test.tsx` covers: button opens the scanner (permission granted),
  a valid scanned payload configures with parsed values, garbage shows the existing
  `pairingFailed` parse-error copy, and permission-denied shows the fallback copy.
- **Gates.** `npx.cmd tsc --noEmit` → 0; `npm.cmd run test` → 129 suites / 1067
  tests green. `npm.cmd ls react-native-camera-kit` → 18.0.1.

### Owner device gates (unchecked — require a deployed staging relay + devices)

1. **QR pairing against staging portal:** portal mints a code → phone scans →
   app PUTs the pairing token → engine `pairing → syncing`; write on one device,
   confirm it lands on the other through the relay (not the LAN). *Scanner now
   wired (camera-kit) — this gate is the on-device camera drill; manual entry still
   works as a fallback.*
2. **Two devices syncing through the relay** (phone + desktop) after 7-1 deploy.
3. **Rotation drill:** trigger "Reset sync key" on a surviving device → the other
   device re-imports via escrow and re-baselines on its next connect.
4. **Native builds:** `cd ios && pod install` (new pod `react-native-camera-kit`);
   Android Gradle sync/`assembleDevDebug` (autolinked module + the Kotlin plugin the
   library needs — see its `docs/kotlin.md`; the app's `android/build.gradle` already
   defines `kotlinVersion`).
