/**
 * UpdateAvailableService — manifest compare + always-fetch + cache + dismissal
 * (plan 7-10 §4; per-channel + no-TTL since owner ruling 2026-10-17).
 *
 * The global jest setup mocks Platform.OS='ios', APP_ENV='dev' and
 * DeviceInfo.getVersion()='1.0.0'. This suite pins the channel-derived manifest
 * URL, the platform-aware download pick, the semver compare against the running
 * app (including the dev-release loop regression), the no-TTL always-fetch
 * behavior with offline cache fallback, the foreground throttle, and
 * per-version dismissal persistence.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete store[k];
    }),
    clear: jest.fn(async () => {
      for (const k of Object.keys(store)) delete store[k];
    }),
  },
}));

import type { AppStateStatus } from 'react-native';
import {
  attachUpdateForegroundChecks,
  detachUpdateForegroundChecksForTests,
  dismissUpdate,
  getEngineManifest,
  getUpdateState,
  isUpdateDismissed,
  refreshUpdates,
  resetUpdatesForTests,
  setAppVersionProvider,
  setUpdatesFetchImpl,
  setUpdatesNowForTests,
  shouldCheckOnForeground,
  UPDATE_CACHE_KEY,
  UPDATE_DISMISS_KEY,
  UPDATE_FOREGROUND_THROTTLE_MS,
} from '../UpdateAvailableService';
import { RELEASES } from '../../../config/cloud';

const engineManifest = {
  version: 'v0.3.2',
  contractVersion: '1.3.0',
  releasedAt: '2026-10-12T12:00:00Z',
  notesUrl: 'https://download.soulbits.app/engine/v0.3.2/NOTES.md',
  artifacts: {
    desktop: {
      windows_amd64: 'https://download.soulbits.app/engine/v0.3.2/soulbits-engine-v0.3.2_windows_amd64.zip',
      linux_amd64: 'https://download.soulbits.app/engine/v0.3.2/soulbits-engine-v0.3.2_linux_amd64.zip',
    },
    android: {
      arm64: 'https://download.soulbits.app/engine/v0.3.2/arm64/libengine.so',
      x86_64: 'https://download.soulbits.app/engine/v0.3.2/x86_64/libengine.so',
    },
    ios: { xcframework: 'https://download.soulbits.app/engine/v0.3.2/SoulbitsEngine.xcframework.zip' },
  },
};

// Per-channel manifest shape (owner ruling 2026-10-17): flat `android.url` /
// `ios.url` — no nested dev/prod entries.
const appManifest = {
  version: 'v1.4.0',
  releasedAt: '2026-10-12T12:00:00Z',
  notesUrl: 'https://github.com/harmony-ai-solutions/harmony-ai-app/releases/tag/v1.4.0',
  android: { url: 'https://download.soulbits.app/app/v1.4.0/dev/harmony-ai-app-v1.4.0-android.apk' },
  ios: { url: 'https://download.soulbits.app/app/v1.4.0/dev/harmony-ai-app-v1.4.0-ios.ipa' },
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

let fetchMock: jest.Mock;

function installFetch(engine: unknown = engineManifest, app: unknown = appManifest): void {
  fetchMock = jest.fn(async (url: string) => jsonResponse(url.includes('/engine/') ? engine : app));
  setUpdatesFetchImpl(fetchMock as unknown as (u: string) => Promise<Response>);
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  resetUpdatesForTests();
  installFetch();
});

describe('refreshUpdates — manifest compare', () => {
  it('surfaces a newer app, cache-busted', async () => {
    const state = await refreshUpdates();
    expect(state.appUpdate?.version).toBe('1.4.0');
    expect(state.checkedAt).not.toBeNull();
    // Cache-busting `?t=` on both manifest fetches.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toMatch(/[?&]t=\d+/);
    }
  });

  it('fetches the channel-derived app manifest (dev build → app/dev/latest.json)', async () => {
    // APP_ENV='dev' in the jest config mock → the dev channel file.
    expect(RELEASES.appManifestUrl).toBe('https://download.soulbits.app/app/dev/latest.json');
    await refreshUpdates();
    expect(fetchMock.mock.calls.some((c) => c[0].startsWith(RELEASES.appManifestUrl))).toBe(true);
    expect(fetchMock.mock.calls.some((c) => c[0].startsWith(RELEASES.engineManifestUrl))).toBe(true);
  });

  it('picks the platform download URL (ios)', async () => {
    const state = await refreshUpdates();
    expect(state.appUpdate?.downloadUrl).toBe(appManifest.ios.url);
  });

  it('exposes the engine manifest for the desktop deep-link', async () => {
    await refreshUpdates();
    expect(getEngineManifest()?.artifacts.desktop.windows_amd64).toContain('windows_amd64.zip');
  });
});

describe('refreshUpdates — no TTL (always fetch)', () => {
  it('re-fetches on every call (consecutive calls hit the network)', async () => {
    await refreshUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await refreshUpdates(); // no TTL → fetches again
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await refreshUpdates({ force: true }); // `force` retained for API stability
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('falls back to the cache when the network fails', async () => {
    await refreshUpdates();
    expect(store[UPDATE_CACHE_KEY]).toBeTruthy();
    // Next run: force a network failure but keep the cache.
    setUpdatesFetchImpl(
      (async () => {
        throw new Error('offline');
      }) as unknown as (u: string) => Promise<Response>,
    );
    const state = await refreshUpdates();
    expect(state.appUpdate?.version).toBe('1.4.0');
  });
});

describe('refreshUpdates — dev-release loop regression', () => {
  it('stays silent when the manifest matches the installed dev version', async () => {
    // Installed v1.3.0-dev == manifest v1.3.0-dev → no banner.
    setAppVersionProvider(() => 'v1.3.0-dev');
    installFetch(engineManifest, { ...appManifest, version: 'v1.3.0-dev' });
    const state = await refreshUpdates();
    expect(state.appUpdate).toBeNull();
  });

  it('surfaces a newer dev version with the manifest download URL', async () => {
    setAppVersionProvider(() => 'v1.3.0-dev');
    const devManifest = {
      ...appManifest,
      version: 'v1.3.1-dev',
      android: { url: 'https://download.soulbits.app/app/v1.3.1/dev/harmony-ai-app-v1.3.1-android.apk' },
      ios: { url: 'https://download.soulbits.app/app/v1.3.1/dev/harmony-ai-app-v1.3.1-ios.ipa' },
    };
    installFetch(engineManifest, devManifest);
    const state = await refreshUpdates();
    expect(state.appUpdate?.version).toBe('1.3.1-dev');
    expect(state.appUpdate?.downloadUrl).toBe(devManifest.ios.url);
  });
});

describe('refreshUpdates — Android download URL', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('react-native/Libraries/Utilities/Platform');
  });

  it('derives downloadUrl from android.url on Android', async () => {
    jest.resetModules();
    jest.doMock('react-native/Libraries/Utilities/Platform', () => ({
      __esModule: true,
      default: {
        OS: 'android',
        select: (obj: Record<string, unknown>) => obj.android ?? obj.default,
      },
    }));
    const mod = require('../UpdateAvailableService') as typeof import('../UpdateAvailableService');

    const manifest = {
      ...appManifest,
      version: 'v1.3.1-dev',
      android: { url: 'https://download.soulbits.app/app/v1.3.1/dev/harmony-ai-app-v1.3.1-android.apk' },
      ios: { url: 'https://download.soulbits.app/app/v1.3.1/dev/harmony-ai-app-v1.3.1-ios.ipa' },
    };
    const fetchImpl = jest.fn(async (url: string) =>
      jsonResponse(url.includes('/engine/') ? engineManifest : manifest),
    );
    mod.resetUpdatesForTests();
    mod.setAppVersionProvider(() => 'v1.3.0-dev');
    mod.setUpdatesFetchImpl(fetchImpl as unknown as (u: string) => Promise<Response>);

    const state = await mod.refreshUpdates();
    expect(state.appUpdate?.version).toBe('1.3.1-dev');
    expect(state.appUpdate?.downloadUrl).toBe(manifest.android.url);
  });
});

describe('foreground re-check throttle (owner ruling 2026-10-17)', () => {
  function fakeAppState() {
    const handlers: Array<(s: AppStateStatus) => void> = [];
    return {
      currentState: 'active' as AppStateStatus,
      addEventListener: (_t: 'change', h: (s: AppStateStatus) => void) => {
        handlers.push(h);
        return { remove: () => {} };
      },
      fire: (s: AppStateStatus) => handlers.forEach((h) => h(s)),
      handlerCount: () => handlers.length,
    };
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 25; i += 1) await Promise.resolve();
  }

  it('shouldCheckOnForeground: allows the first check and one after the window', () => {
    expect(shouldCheckOnForeground(null, 1_000)).toBe(true);
    expect(shouldCheckOnForeground(1_000, 1_000 + UPDATE_FOREGROUND_THROTTLE_MS - 1)).toBe(false);
    expect(shouldCheckOnForeground(1_000, 1_000 + UPDATE_FOREGROUND_THROTTLE_MS)).toBe(true);
  });

  it('checks on foreground, throttles within 60s, re-checks after', async () => {
    const appState = fakeAppState();
    let clock = 10_000;
    setUpdatesNowForTests(() => clock);

    attachUpdateForegroundChecks({ appState });

    // First foreground: nothing fetched yet → fetch.
    appState.fire('active');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Background does nothing.
    appState.fire('background');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second foreground within the window → throttled.
    clock += UPDATE_FOREGROUND_THROTTLE_MS - 1;
    appState.fire('active');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Past the window → fetch again.
    clock += 2;
    appState.fire('active');
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('attaches at most once (idempotent guard)', () => {
    const appState = fakeAppState();
    attachUpdateForegroundChecks({ appState });
    attachUpdateForegroundChecks({ appState });
    expect(appState.handlerCount()).toBe(1);
    detachUpdateForegroundChecksForTests();
  });
});

describe('dismissal persistence', () => {
  it('persists a per-version dismissal and reports it', async () => {
    await refreshUpdates();
    expect(isUpdateDismissed('app', '1.4.0')).toBe(false);
    await dismissUpdate('app', '1.4.0');
    expect(isUpdateDismissed('app', '1.4.0')).toBe(true);
    expect(getUpdateState().dismissed).toContain('app:1.4.0');
    expect(JSON.parse(store[UPDATE_DISMISS_KEY])).toEqual(['app:1.4.0']);
  });

  it('scopes dismissal to the exact version', async () => {
    await dismissUpdate('app', '1.4.0');
    expect(isUpdateDismissed('app', '1.4.0')).toBe(true);
    expect(isUpdateDismissed('app', '1.5.0')).toBe(false);
  });
});
