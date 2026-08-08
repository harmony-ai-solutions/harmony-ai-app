/**
 * Module config visibility helpers.
 *
 * Pure, UI-agnostic rules shared by the ModuleConfigEditScreen and unit tests:
 *
 *  1. `isSimpleFieldKey` — which provider fields belong to the "Simple" view
 *     (essentials only) vs the "Advanced" view (full schema).
 *  2. `isManagedCloudField` — fields that are auto-synced by the backend for
 *     managed Soulbits Cloud providers and therefore hidden (endpoint + tokens).
 *
 * Keeping these in a pure module means the screen stays thin and the rules are
 * directly unit-testable without rendering React components.
 */

/**
 * Provider field keys considered "essential" — the only ones shown in Simple
 * mode. Everything else (sampling params, token limits, penalties, seeds, …)
 * is tucked behind the Advanced toggle so the screen doesn't read like an
 * infrastructure configuration page.
 */
export const SIMPLE_FIELD_KEYS: ReadonlySet<string> = new Set([
  'name',
  'api_key',
  'api_token',
  'username',
  'password',
  'base_url',
  'endpoint',
  'model',
  'model_id',
  'voice_id',
  'voice',
  'speed',
  'format',
  'kindroid_id',
  'chatroom_url',
  'room_url',
  'workflow_profiles',
  'voice_config_file',
]);

/** True when the field belongs to the Simple (essential) view. */
export function isSimpleFieldKey(key: string): boolean {
  return SIMPLE_FIELD_KEYS.has(key);
}

/**
 * Fields that are auto-synced by the backend for managed Soulbits Cloud
 * providers — hiding them avoids implying they are user-configurable.
 * Covers both the endpoint field names (`base_url` / `endpoint`) and the
 * credential field names used across provider schemas (`api_key` / `api_token`).
 */
export function isManagedCloudField(key: string): boolean {
  return key === 'base_url' || key === 'endpoint' || key === 'api_key' || key === 'api_token';
}
