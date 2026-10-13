/**
 * EngineHost — host selection tests (task 4-2).
 *
 * The RN jest preset sets Platform.OS = 'ios', so the platform default is the
 * EmbeddedEngineHost; the sidecar host is selected on Android. The override seam
 * lets tests pin a host explicitly.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { Platform } from 'react-native';
import { selectEngineHost, setEngineHostOverride } from '../EngineHost';
import type { EngineHost } from '../EngineHost';

afterEach(() => setEngineHostOverride(null));

describe('selectEngineHost', () => {
  it('returns the embedded host on iOS (foreground tier)', () => {
    const host = selectEngineHost();
    expect(host.kind).toBe('embedded');
    expect(host.foregroundTier).toBe(true);
  });

  it('is a stable singleton', () => {
    expect(selectEngineHost()).toBe(selectEngineHost());
  });

  it('honours an injected override and clears it', () => {
    const fake: EngineHost = {
      kind: 'sidecar',
      foregroundTier: false,
      isAvailable: async () => true,
      start: async () => ({
        wsPort: 1,
        wssPort: 0,
        adminPort: 2,
        bind: '127.0.0.1',
        pid: -1,
        dataDir: '',
        token: '',
      }),
      stop: async () => undefined,
      getState: async () => 'stopped',
      call: async () => '{}',
      onEvent: () => () => undefined,
      onExit: () => () => undefined,
    };
    setEngineHostOverride(fake);
    expect(selectEngineHost()).toBe(fake);
    setEngineHostOverride(null);
    expect(selectEngineHost().kind).toBe('embedded');
  });

  it('selects the sidecar host when the platform is Android', () => {
    // Simulate Android by overriding the mocked Platform object.
    const platform = Platform as unknown as { OS: string };
    const original = platform.OS;
    platform.OS = 'android';
    setEngineHostOverride(null);
    try {
      expect(selectEngineHost().kind).toBe('sidecar');
    } finally {
      platform.OS = original;
    }
  });
});
