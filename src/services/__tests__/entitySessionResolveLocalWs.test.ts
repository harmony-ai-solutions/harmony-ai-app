/**
 * EntitySessionService.resolveLocalWs — embedded-engine endpoint (app-engine
 * parity). The SAME 7-11 loopback posture SyncConnectionContext uses: prefer
 * the plain loopback WS (ws://) with the per-process loopback token appended,
 * falling back to WSS + insecure-ssl. Without this the per-participant entity
 * sockets still demanded a producerless `soulbits_jwt` and never connected —
 * chat stayed stuck even after the sync socket was fixed.
 *
 * `resolveLocalWs` is private; the singleton is built via Object.create to skip
 * the constructor's ConnectionManager listener wiring (irrelevant here).
 */
import { EntitySessionService } from '../EntitySessionService';

const mockGetEngineConnection = jest.fn();
jest.mock('../engine/EngineService', () => ({
  __esModule: true,
  getEngineConnection: (...args: any[]) => mockGetEngineConnection(...args),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn().mockResolvedValue('test-device'),
}));

jest.mock('react-native-track-player', () => ({
  default: { setupPlayer: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../AudioPlayer', () => ({
  __esModule: true,
  default: { stop: jest.fn().mockResolvedValue(undefined) },
  AudioPlayer: class {},
}));

jest.mock('../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  return { __esModule: true, default: new EE() };
});

jest.mock('../ConnectionStateManager', () => ({
  __esModule: true,
  default: {
    getCurrentSource: jest.fn().mockResolvedValue('selfhosted'),
    getSecurityMode: jest.fn().mockResolvedValue('insecure-ssl'),
    getWSUrl: jest.fn().mockResolvedValue('ws://legacy:28080/events'),
    getWSSUrl: jest.fn().mockResolvedValue('wss://legacy:28443/events'),
  },
}));
const mockCsm = jest.requireMock('../ConnectionStateManager').default;

function makeService(): EntitySessionService {
  return Object.create(EntitySessionService.prototype) as EntitySessionService;
}

describe('EntitySessionService.resolveLocalWs — embedded engine (app-engine parity)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefers the plain loopback WS with the token query param', async () => {
    mockGetEngineConnection.mockReturnValue({
      wsBaseUrl: 'ws://127.0.0.1:28080',
      wssBaseUrl: 'wss://127.0.0.1:28443',
      token: 'tok-1',
    });

    const resolved = await (makeService() as any).resolveLocalWs();

    expect(resolved).toEqual({ url: 'ws://127.0.0.1:28080?token=tok-1', mode: 'unencrypted' });
  });

  it('falls back to loopback WSS + insecure-ssl when no plain WS port is advertised', async () => {
    mockGetEngineConnection.mockReturnValue({
      wsBaseUrl: '',
      wssBaseUrl: 'wss://127.0.0.1:28443',
      token: 'tok-1',
    });

    const resolved = await (makeService() as any).resolveLocalWs();

    expect(resolved).toEqual({ url: 'wss://127.0.0.1:28443?token=tok-1', mode: 'insecure-ssl' });
  });

  it('falls back to ConnectionStateManager when no engine is connected', async () => {
    mockGetEngineConnection.mockReturnValue(null);
    mockCsm.getSecurityMode.mockResolvedValue('unencrypted');

    const resolved = await (makeService() as any).resolveLocalWs();

    expect(resolved).toEqual({ url: 'ws://legacy:28080/events', mode: 'unencrypted' });
  });
});
