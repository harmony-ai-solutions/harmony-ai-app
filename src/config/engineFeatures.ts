/**
 * Engine feature flags (task 3-2).
 *
 * The flag has a build-time default and a runtime override hydrated from
 * AsyncStorage during app boot (before any screen renders) via
 * {@link loadEngineFeatureFlags}. It is kept in memory so consumers can read
 * it synchronously at call time.
 *
 * ── `ENGINE_API_DATA_LAYER` (3-2) ─────────────────────────────────────────
 * Selects which implementation the repository seam
 * (`src/database/repositories/index.ts`) dispatches to per call:
 *
 *   - `false` (default) → the legacy TS SQLite repositories (unchanged).
 *   - `true`            → the management-API-backed repositories
 *                         (`src/services/engine/repositories/*`), which read
 *                         from the embedded engine's local management API.
 *
 * Rollout plan (3-2): the flag is flipped per screen group as each group's
 * adapters land and pass device verification. The default stays `false` until
 * the whole read surface is proven.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../utils/logger';

const log = createLogger('[EngineFeatures]');

// ── ENGINE_API_DATA_LAYER ────────────────────────────────────────────────

/** AsyncStorage key holding the persisted override ('true' | 'false'). */
export const ENGINE_API_DATA_LAYER_STORAGE_KEY = '@soulbits_engine_api_data_layer';

/**
 * Build-time default. Task 3-4 flipped this ON: the management-API data layer
 * is now the ONLY data layer — the repository seam is a pure re-export of the
 * engine adapters, so this constant is retained for compatibility but the
 * SQLite fallback no longer exists.
 */
export const ENGINE_API_DATA_LAYER_DEFAULT = true;

let dataLayerOverride: boolean | null = null;

/**
 * True when the management-API data layer is active. Synchronous — the
 * repository seam calls this on every dispatch.
 */
export function isEngineApiDataLayerEnabled(): boolean {
  return dataLayerOverride ?? ENGINE_API_DATA_LAYER_DEFAULT;
}

/**
 * Set the in-memory override. Pass `null` to restore the build-time default
 * (used by tests and by a "reset to default" settings action).
 */
export function setEngineApiDataLayerEnabled(enabled: boolean | null): void {
  dataLayerOverride = enabled;
}

/** True when a runtime override (not the default) is in effect. */
export function hasEngineApiDataLayerOverride(): boolean {
  return dataLayerOverride !== null;
}

// ── Hydration / persistence ──────────────────────────────────────────────

/** Read a 'true' | 'false' | absent storage value into a boolean | null override. */
function parseOverride(value: string | null): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/**
 * Hydrate the override from AsyncStorage. Call once during app boot. A
 * missing or unparseable value clears the override (default applies). Never
 * throws.
 */
export async function loadEngineFeatureFlags(): Promise<void> {
  try {
    const dataLayer = await AsyncStorage.getItem(ENGINE_API_DATA_LAYER_STORAGE_KEY);
    dataLayerOverride = parseOverride(dataLayer);
  } catch (e) {
    log.warn('Failed to load engine feature flags:', e);
    dataLayerOverride = null;
  }
}

/** Persist + apply an override for a flag; pass `null` to clear it. */
async function persistOverride(
  storageKey: string,
  enabled: boolean | null,
): Promise<void> {
  try {
    if (enabled === null) {
      await AsyncStorage.removeItem(storageKey);
    } else {
      await AsyncStorage.setItem(storageKey, enabled ? 'true' : 'false');
    }
  } catch (e) {
    log.warn('Failed to persist engine feature flags:', e);
  }
}

/**
 * Persist and apply the `ENGINE_API_DATA_LAYER` override. Pass `null` to clear
 * the persisted value and restore the build-time default.
 */
export async function setEngineApiDataLayerEnabledPersisted(
  enabled: boolean | null,
): Promise<void> {
  dataLayerOverride = enabled;
  await persistOverride(ENGINE_API_DATA_LAYER_STORAGE_KEY, enabled);
}
