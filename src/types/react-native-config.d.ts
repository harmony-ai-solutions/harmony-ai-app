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
  }

  const Config: NativeConfig;
  export default Config;
}
