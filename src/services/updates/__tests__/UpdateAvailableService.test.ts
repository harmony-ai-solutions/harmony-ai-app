/**
 * UpdateAvailableService — manifest compare + cache + dismissal (plan 7-10 §4).
 *
 * The global jest setup mocks Platform.OS='ios', APP_ENV='dev' and
 * DeviceInfo.getVersion()='1.0.0'; this suite pins the env/platform-aware APP
 * download pick (ios.dev), the semver compare against the running app, the
 * engine-manifest passthrough for the desktop deep-link, the 6h cache TTL and
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

import {
  dismissUpdate,
  getEngineManifest,
  getUpdateState,
  isUpdateDismissed,
  refreshUpdates,
  resetUpdatesForTests,
  setUpdatesFetchImpl,
  UPDATE_CACHE_KEY,
  UPDATE_DISMISS_KEY,
} from '../UpdateAvailableService';

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

const appManifest = {
  version: 'v1.4.0',
  releasedAt: '2026-10-12T12:00:00Z',
  notesUrl: 'https://github.com/harmony-ai-solutions/harmony-ai-app/releases/tag/v1.4.0',
  android: {
    dev: 'https://download.soulbits.app/app/v1.4.0/dev/harmony-ai-app-v1.4.0-android.apk',
    prod: 'https://download.soulbits.app/app/v1.4.0/prod/harmony-ai-app-v1.4.0-android.apk',
  },
  ios: {
    dev: 'https://download.soulbits.app/app/v1.4.0/dev/harmony-ai-app-v1.4.0-ios.ipa',
    prod: 'https://download.soulbits.app/app/v1.4.0/prod/harmony-ai-app-v1.4.0-ios.ipa',
  },
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

let fetchMock: jest.Mock;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  resetUpdatesForTests();
  fetchMock = jest.fn(async (url: string) =>
    jsonResponse(url.includes('/engine/') ? engineManifest : appManifest),
  );
  setUpdatesFetchImpl(fetchMock as unknown as (u: string) => Promise<Response>);
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

  it('picks the env/platform-aware download URL (ios + dev channel)', async () => {
    const state = await refreshUpdates();
    expect(state.appUpdate?.downloadUrl).toBe(appManifest.ios.dev);
  });

  it('exposes the engine manifest for the desktop deep-link', async () => {
    await refreshUpdates();
    expect(getEngineManifest()?.artifacts.desktop.windows_amd64).toContain('windows_amd64.zip');
  });

  it('serves the 6h cache without re-fetching, then re-fetches on force', async () => {
    await refreshUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await refreshUpdates(); // within TTL → cache
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await refreshUpdates({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('falls back to the cache when the network fails', async () => {
    await refreshUpdates();
    expect(store[UPDATE_CACHE_KEY]).toBeTruthy();
    // Second run: force a network failure but keep the cache.
    setUpdatesFetchImpl(
      (async () => {
        throw new Error('offline');
      }) as unknown as (u: string) => Promise<Response>,
    );
    const state = await refreshUpdates({ force: true });
    expect(state.appUpdate?.version).toBe('1.4.0');
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
