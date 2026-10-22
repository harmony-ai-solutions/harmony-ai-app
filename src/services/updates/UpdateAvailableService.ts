/**
 * UpdateAvailableService — fetches the two release manifests and tells the UI
 * when a newer engine or app exists (plan 7-10 §4).
 *
 * Manifests are STATIC JSON on the existing CloudFront download hosts
 * (`engine/latest.json`, `app/<env>/latest.json`; plan 7-10 §1) — no new service.
 * Each channel has its OWN app manifest (`app/dev/latest.json`,
 * `app/prod/latest.json`), so a dev dispatch is never visible to prod installs;
 * a build reads only its channel's file (see {@link RELEASES.appManifestUrl}).
 * The service:
 *
 *   - fetches both manifests cache-busted (`?t=<now>`) on EVERY call — there is
 *     no TTL (owner ruling 2026-10-17: the fast dev-release loop needs a fresh
 *     check on every cold start and app foreground);
 *   - caches the result in AsyncStorage and serves the cache on a network
 *     failure (so an offline launch still knows what it knew before);
 *   - compares the manifest `version` against `DeviceInfo.getVersion()`, using
 *     semver-with-prerelease precedence (`utils/semver`) — an exact channel match
 *     (installed `v1.3.0-dev` == manifest `v1.3.0-dev`) stays silent;
 *   - picks the app download link from the manifest's `android.url`/`ios.url`
 *     for the running platform (the manifest is already channel-scoped).
 *
 * The embedded engine only updates WITH the app (Android 10+ SELinux blocks
 * exec from writable storage; iOS forbids downloaded native code), so there is
 * no runtime engine update to surface. The engine manifest is still fetched for
 * the ONE place an engine download IS actionable — the desktop peer
 * (DesktopSyncScreen), which reads {@link getEngineManifest}. The app↔engine
 * contract match is a BUILD-time gate (`scripts/check-engine-contract-build.cjs`),
 * never a runtime card.
 */

import { AppState, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';
import { createLogger } from '../../utils/logger';
import { RELEASES } from '../../config/cloud';
import { isStoreVariant } from '../../config/appVariant';
import { isNewerVersion, normalizeVersion } from '../../utils/semver';

const log = createLogger('[Updates]');

/** AsyncStorage key holding the cached manifests + checkedAt. */
export const UPDATE_CACHE_KEY = '@soulbits_update_state';
/** AsyncStorage key holding the persisted dismissal set. */
export const UPDATE_DISMISS_KEY = '@soulbits_update_dismissed';
/** Minimum gap between foreground-triggered fetches (ms; owner ruling 2026-10-17). */
export const UPDATE_FOREGROUND_THROTTLE_MS = 60 * 1000;

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

/**
 * `app/<env>/latest.json` (plan 7-10 §1; per-channel since 2026-10-17).
 * One file per channel; the URLs are absolute and channel-scoped.
 */
export interface AppReleaseManifest {
  version: string;
  releasedAt?: string;
  notesUrl?: string;
  android: { url: string };
  ios: { url: string };
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

// ── Foreground re-check state (owner ruling 2026-10-17) ─────────────────
// `lastFetchedAt` is the epoch ms of the last COMPLETED manifest fetch (cold
// start or foreground); the foreground handler throttles off it. `nowImpl` is a
// test seam so the ≥60s decision is exercised without real time.
let lastFetchedAt: number | null = null;
let nowImpl: () => number = () => Date.now();
let appStateAttached = false;

// ── Test seams ──────────────────────────────────────────────────────────

/** Replace the fetch implementation (test seam). */
export function setUpdatesFetchImpl(fetch: FetchLike): void {
  fetchImpl = fetch;
}

/** Replace the app-version provider (test seam). */
export function setAppVersionProvider(provider: () => string): void {
  appVersionProvider = provider;
}

/** Replace the clock used for the foreground throttle decision (test seam). */
export function setUpdatesNowForTests(now: () => number): void {
  nowImpl = now;
}

/** Test-only: drop all state. */
export function resetUpdatesForTests(): void {
  state = EMPTY_STATE;
  listeners.clear();
  cached = null;
  dismissed = new Set<string>();
  dismissedLoaded = false;
  inFlight = null;
  lastFetchedAt = null;
  nowImpl = () => Date.now();
  appStateAttached = false;
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

  let appUpdate: AppUpdateInfo | null = null;
  if (cached?.app && appVersion && isNewerVersion(cached.app.version, appVersion)) {
    // The manifest is already channel-scoped, so pick by platform only.
    const entry = Platform.OS === 'ios' ? cached.app.ios : cached.app.android;
    appUpdate = {
      version: normalizeVersion(cached.app.version),
      notesUrl: cached.app.notesUrl ?? '',
      downloadUrl: entry?.url ?? null,
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
 * Fetch both manifests and recompute the update state. There is no TTL: every
 * call hits the network (in-flight dedup still collapses concurrent calls, and a
 * fetch failure serves the cache). Never throws.
 *
 * `opts` is retained for API stability (callers pass `{ force: true }`); with the
 * TTL removed it no longer changes behavior.
 */
export async function refreshUpdates(_opts: { force?: boolean } = {}): Promise<UpdateState> {
  // Store variant (plan 7-14): the store listing owns updates — NEVER check.
  // `app/<env>/latest.json` has no store destination and an update-without-action
  // is noise (ruling: "no update checks at all in store builds"). Return the
  // current (empty) state without touching the network.
  if (isStoreVariant()) return state;

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      await Promise.all([loadDismissed(), loadCache()]);

      try {
        // Each manifest is INDIVIDUALLY optional (regression, owner report
        // 2026-10-18): engine/latest.json does not exist until the first
        // tagged engine release (the dev-loop sidecar publishes never write
        // it), and its 404 used to reject this Promise.all — killing the app
        // banner too. Only when BOTH fetches fail is the check treated as a
        // network failure (the offline-cache path below).
        const [engineRes, appRes] = await Promise.allSettled([
          fetchJson<EngineReleaseManifest>(RELEASES.engineManifestUrl),
          fetchJson<AppReleaseManifest>(RELEASES.appManifestUrl),
        ]);
        const engine = engineRes.status === 'fulfilled' ? engineRes.value : null;
        const app = appRes.status === 'fulfilled' ? appRes.value : null;
        if (engineRes.status === 'rejected') {
          log.debug('Engine manifest unavailable (non-fatal):', String(engineRes.reason));
        }
        if (appRes.status === 'rejected') {
          log.debug('App manifest unavailable (non-fatal):', String(appRes.reason));
        }
        if (!engine && !app) {
          throw new Error('all manifest fetches failed');
        }
        await persistCache({ engine, app, checkedAt: Date.now() });
      } catch (e) {
        // Network failure → serve whatever cache we have (an offline launch
        // still knows what it knew before). No cache → all-null state.
        log.warn('Update check failed:', e instanceof Error ? e.message : String(e));
      } finally {
        // Record the completed-fetch time for the foreground throttle.
        lastFetchedAt = nowImpl();
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

// ── Foreground re-check (owner ruling 2026-10-17) ───────────────────────
// No TTL: the update check runs on every cold start (DatabaseContext) AND on
// every app foreground (AppState → 'active'), throttled so rapid foreground/
// background churn can't hammer the manifest hosts. In-flight dedup + the
// offline cache fallback live inside {@link refreshUpdates}.

/** The AppState surface the foreground checker needs (injectable for tests). */
export interface UpdateAppStateSource {
  currentState: AppStateStatus;
  addEventListener(type: 'change', handler: (state: AppStateStatus) => void): { remove(): void };
}

/**
 * The pure throttle decision: allow a foreground re-check when nothing has been
 * fetched yet, or ≥ {@link UPDATE_FOREGROUND_THROTTLE_MS} has elapsed since the
 * last completed fetch.
 */
export function shouldCheckOnForeground(
  lastFetchedAtMs: number | null,
  now: number,
): boolean {
  return lastFetchedAtMs === null || now - lastFetchedAtMs >= UPDATE_FOREGROUND_THROTTLE_MS;
}

export interface UpdateForegroundDeps {
  /** AppState source (defaults to RN `AppState`). */
  appState?: UpdateAppStateSource;
}

/**
 * Attach the app-wide foreground update check (idempotent). Boot code calls this
 * once (see `DatabaseContext`); the process keeps it for its lifetime. Mirrors
 * the singleton-guard pattern of `attachEngineLifecycle` /
 * `attachOutreachNotifications`.
 */
export function attachUpdateForegroundChecks(deps: UpdateForegroundDeps = {}): void {
  if (appStateAttached) return;
  appStateAttached = true;

  const appState = deps.appState ?? (AppState as unknown as UpdateAppStateSource);
  appState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    if (!shouldCheckOnForeground(lastFetchedAt, nowImpl())) return;
    void refreshUpdates().catch(() => {});
  });
}

/** Test-only: forget that the foreground checker was attached (allows re-attach). */
export function detachUpdateForegroundChecksForTests(): void {
  appStateAttached = false;
}
