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
    IS_BETA?: string | boolean;
    GOOGLE_WEB_CLIENT_ID?: string;
    APPLE_SERVICES_ID?: string;
    /**
     * Optional WSS URL for E2E testing (build-time env var).
     *
     * When set via .env.e2e (see e2e/.env.e2e), ConnectionStateManager
     * pre-seeds AsyncStorage so the app boots already paired against the
     * harmony-link Docker container. Unset in production builds.
     *
     * Example: HARMONY_LINK_WSS_URL=wss://10.0.2.2:28443
     * (10.0.2.2 is the Android emulator's alias for the host loopback.)
     */
    HARMONY_LINK_WSS_URL?: string;
    /**
     * Optional plain-WS URL for E2E testing (build-time env var).
     *
     * The harmony-link handshake protocol runs over plain WS first
     * (different port from WSS), then upgrades. This URL points at the
     * plain-WS port. Required when HARMONY_LINK_WSS_URL is set.
     *
     * Example: HARMONY_LINK_WS_URL=ws://10.0.2.2:28080
     */
    HARMONY_LINK_WS_URL?: string;
  }

  const Config: NativeConfig;
  export default Config;
}
