/**
 * UpdateAvailableService — fetches the two release manifests and tells the UI
 * when a newer engine or app exists (plan 7-10 §4).
 *
 * Manifests are STATIC JSON on the existing CloudFront download hosts
 * (`engine/latest.json`, `app/latest.json`; plan 7-10 §1) — no new service. The
 * service:
 *
 *   - fetches both manifests cache-busted (`?t=<now>`);
 *   - caches the result in AsyncStorage with a 6h TTL and serves the cache on a
 *     network failure (so an offline launch still knows what it knew before);
 *   - compares `app/latest.version` against `DeviceInfo.getVersion()`, using
 *     semver-with-prerelease precedence (`utils/semver`);
 *   - is env/flavor-aware: the app download link is picked from the manifest's
 *     `dev`/`prod` entry for the active {@link APP_ENVIRONMENT} and platform
 *     (dev-channel builds read the SAME files but surface only their entries).
 *
 * The embedded engine only updates WITH the app (Android 10+ SELinux blocks
 * exec from writable storage; iOS forbids downloaded native code), so there is
 * no runtime engine update to surface. The engine manifest is still fetched for
 * the ONE place an engine download IS actionable — the desktop peer
 * (DesktopSyncScreen), which reads {@link getEngineManifest}. The app↔engine
 * contract match is a BUILD-time gate (`scripts/check-engine-contract-build.cjs`),
 * never a runtime card.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';
import { createLogger } from '../../utils/logger';
import { RELEASES, APP_ENVIRONMENT } from '../../config/cloud';
import { isStoreVariant } from '../../config/appVariant';
import { isNewerVersion, normalizeVersion } from '../../utils/semver';

const log = createLogger('[Updates]');

/** AsyncStorage key holding the cached manifests + checkedAt. */
export const UPDATE_CACHE_KEY = '@soulbits_update_state';
/** AsyncStorage key holding the persisted dismissal set. */
export const UPDATE_DISMISS_KEY = '@soulbits_update_dismissed';
/** Cache freshness window (6h — plan 7-10 §4). */
export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** `engine/latest.json` (plan 7-10 §1). */
export interface EngineReleaseManifest {
  version: string;
  contractVersion: string;
  releasedAt: string;
  notesUrl: string;
  artifacts: {
    desktop: { windows_amd64: string; linux_amd64: string };
    android: { arm64: string; x86_64: string };
    ios: { xcframework: string };
  };
}

/** `app/latest.json` (plan 7-10 §1). */
export interface AppReleaseManifest {
  version: string;
  releasedAt: string;
  notesUrl: string;
  android: { dev: string; prod: string };
  ios: { dev: string; prod: string };
}

/** A newer app than the one installed. */
export interface AppUpdateInfo {
  version: string;
  notesUrl: string;
  /** Flavor/platform-aware download URL, or null when the manifest lacks it. */
  downloadUrl: string | null;
}

/** The observable update state. */
export interface UpdateState {
  appUpdate: AppUpdateInfo | null;
  /** epoch ms of the last successful check (cached or live), or null. */
  checkedAt: number | null;
  /** Persisted dismissal keys, `${kind}:${version}`. */
  dismissed: string[];
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const EMPTY_STATE: UpdateState = { appUpdate: null, checkedAt: null, dismissed: [] };

interface CachedManifests {
  engine: EngineReleaseManifest | null;
  app: AppReleaseManifest | null;
  checkedAt: number;
}

let state: UpdateState = EMPTY_STATE;
const listeners = new Set<(state: UpdateState) => void>();

let fetchImpl: FetchLike =
  typeof fetch !== 'undefined' ? fetch : (undefined as unknown as FetchLike);
let appVersionProvider: () => string = () => {
  try {
    return DeviceInfo.getVersion();
  } catch {
    return '';
  }
};

let cached: CachedManifests | null = null;
let dismissed = new Set<string>();
let dismissedLoaded = false;
let inFlight: Promise<UpdateState> | null = null;

// ── Test seams ──────────────────────────────────────────────────────────

/** Replace the fetch implementation (test seam). */
export function setUpdatesFetchImpl(fetch: FetchLike): void {
  fetchImpl = fetch;
}

/** Replace the app-version provider (test seam). */
export function setAppVersionProvider(provider: () => string): void {
  appVersionProvider = provider;
}

/** Test-only: drop all state. */
export function resetUpdatesForTests(): void {
  state = EMPTY_STATE;
  listeners.clear();
  cached = null;
  dismissed = new Set<string>();
  dismissedLoaded = false;
  inFlight = null;
  fetchImpl = typeof fetch !== 'undefined' ? fetch : (undefined as unknown as FetchLike);
  appVersionProvider = () => {
    try {
      return DeviceInfo.getVersion();
    } catch {
      return '';
    }
  };
}

// ── Observability ───────────────────────────────────────────────────────

/** The current update state (synchronous snapshot). */
export function getUpdateState(): UpdateState {
  return state;
}

/** Subscribe to update-state changes. Returns an unsubscribe function. */
export function onUpdateStateChange(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(next: UpdateState): void {
  state = next;
  for (const listener of listeners) {
    try {
      listener(next);
    } catch (e) {
      log.warn('Update listener threw:', e);
    }
  }
}

/** The last-fetched engine manifest (cached or live), or null. Used by the
 *  DesktopSync desktop-engine deep-link. */
export function getEngineManifest(): EngineReleaseManifest | null {
  return cached?.engine ?? null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Append a cache-busting `?t=<now>` (plan 7-10 §1). */
function cacheBust(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Date.now()}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetchImpl(cacheBust(url), { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`manifest fetch failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
}

function dismissalKey(kind: 'engine' | 'app', version: string): string {
  return `${kind}:${version}`;
}

async function loadDismissed(): Promise<void> {
  if (dismissedLoaded) return;
  dismissedLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(UPDATE_DISMISS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(arr)) dismissed = new Set(arr.filter((v): v is string => typeof v === 'string'));
  } catch (e) {
    log.warn('Failed to load dismissed updates:', e);
  }
}

async function loadCache(): Promise<void> {
  if (cached) return;
  try {
    const raw = await AsyncStorage.getItem(UPDATE_CACHE_KEY);
    if (raw) cached = JSON.parse(raw) as CachedManifests;
  } catch (e) {
    log.warn('Failed to load update cache:', e);
  }
}

async function persistCache(next: CachedManifests): Promise<void> {
  cached = next;
  try {
    await AsyncStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify(next));
  } catch (e) {
    log.warn('Failed to persist update cache:', e);
  }
}

/** Recompute the observable state from the cached manifests + live versions. */
function computeState(): UpdateState {
  const appVersion = normalizeVersion(appVersionProvider());
  const env = APP_ENVIRONMENT.env; // 'dev' | 'prod'

  let appUpdate: AppUpdateInfo | null = null;
  if (cached?.app && appVersion && isNewerVersion(cached.app.version, appVersion)) {
    const entries = Platform.OS === 'ios' ? cached.app.ios : cached.app.android;
    appUpdate = {
      version: normalizeVersion(cached.app.version),
      notesUrl: cached.app.notesUrl,
      downloadUrl: entries?.[env] ?? null,
    };
  }

  return {
    appUpdate,
    checkedAt: cached?.checkedAt ?? null,
    dismissed: [...dismissed],
  };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Fetch (or reuse the cache for) both manifests and recompute the update state.
 * Pass `{ force: true }` for a user-initiated refresh (settings pull-to-refresh)
 * — it bypasses the 6h TTL. Never throws.
 */
export async function refreshUpdates(opts: { force?: boolean } = {}): Promise<UpdateState> {
  // Store variant (plan 7-14): the store listing owns updates — NEVER check.
  // `app/latest.json` has no store destination and an update-without-action is
  // noise (ruling: "no update checks at all in store builds"). Return the
  // current (empty) state without touching the network.
  if (isStoreVariant()) return state;

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      await Promise.all([loadDismissed(), loadCache()]);

      const fresh =
        cached !== null && Date.now() - cached.checkedAt < UPDATE_CACHE_TTL_MS;
      if (fresh && !opts.force) {
        emit(computeState());
        return state;
      }

      try {
        const [engine, app] = await Promise.all([
          fetchJson<EngineReleaseManifest>(RELEASES.engineManifestUrl),
          fetchJson<AppReleaseManifest>(RELEASES.appManifestUrl),
        ]);
        await persistCache({ engine, app, checkedAt: Date.now() });
      } catch (e) {
        // Network failure → serve whatever cache we have (an offline launch
        // still knows what it knew before). No cache → all-null state.
        log.warn('Update check failed:', e instanceof Error ? e.message : String(e));
      }

      emit(computeState());
      return state;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** True when the given update has been dismissed by the user. */
export function isUpdateDismissed(kind: 'engine' | 'app', version: string): boolean {
  return dismissed.has(dismissalKey(kind, version));
}

/** Persist a per-version dismissal (banner "dismiss" action). */
export async function dismissUpdate(kind: 'engine' | 'app', version: string): Promise<void> {
  await loadDismissed();
  dismissed.add(dismissalKey(kind, version));
  emit(computeState());
  try {
    await AsyncStorage.setItem(UPDATE_DISMISS_KEY, JSON.stringify([...dismissed]));
  } catch (e) {
    log.warn('Failed to persist dismissed updates:', e);
  }
}
