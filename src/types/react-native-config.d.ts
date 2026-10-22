/**
 * Module declaration for react-native-config.
 *
 * Override the bundled types (NativeConfig { [name: string]: string | undefined })
 * because Android's BuildConfig reflection preserves Java boolean types across the
 * bridge, making IS_BETA a JS boolean at runtime — not a string.
 *
 * Type-pinning contract (5-1/8-1):
 *   IS_BETA is typed `string | boolean` so the `=== true` check in cloud.ts is
 *   valid TS and handles both Android (real boolean) and iOS (string from xcconfig).
 *
 * NOTE: If the iOS subtask (8-1c) wires IS_BETA as an Info.plist Boolean key,
 *       react-native-config may surface it as a JS boolean via the bridge.
 *       Until then, iOS returns the string "true"/"false".
 */
declare module 'react-native-config' {
  interface NativeConfig {
    /**
     * Active build environment: 'dev' | 'prod'.
     * Injected per-flavour by scripts/oauth-secrets.cjs (`npm run
     * oauth:dev|prod`) which writes APP_ENV into the generated .env
     * (iOS/Metro) and the gradle-secrets.<flavor>.properties files
     * (Android). Falls back to 'dev' when absent (__DEV__).
     */
    APP_ENV?: string;
    /**
     * Distribution variant: 'store' | 'full' (plan 7-14). Injected per build
     * by the Android flavour `buildConfigField` (`android/app/build.gradle`)
     * and written into the generated iOS/Metro `.env` by
     * `scripts/oauth-secrets.cjs`. Absent / any non-'store' value → 'full'
     * (see `src/config/appVariant.ts`).
     */
    APP_VARIANT?: string;
    IS_BETA?: string | boolean;
    GOOGLE_WEB_CLIENT_ID?: string;
    APPLE_SERVICES_ID?: string;
    /**
     * E2E-only engine-peer override (plan 7-13): the container engine's LAN
     * endpoints (`host:port`), declared as BuildConfig fields ONLY for E2E
     * builds (`gradle -PE2E_DEBUG_SIGNING=true -PE2E_ENGINE_PEER_WS_URL=...
     * -PE2E_ENGINE_PEER_WSS_URL=...`; see `android/app/build.gradle`). They are
     * `undefined` in every normal dev/prod build, which leaves the override in
     * `src/services/engine/e2eEngineOverride.ts` inert.
     */
    E2E_ENGINE_PEER_WS_URL?: string;
    E2E_ENGINE_PEER_WSS_URL?: string;
  }

  const Config: NativeConfig;
  export default Config;
}
