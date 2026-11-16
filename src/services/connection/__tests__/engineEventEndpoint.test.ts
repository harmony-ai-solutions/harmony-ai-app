/**
 * resolveEngineEventEndpoint — the SHARED engine-event endpoint resolver.
 *
 * Pins the three deployment worlds the app must dial correctly:
 *  - cloud  → conduct-proxy worker WS ('cloud');
 *  - embedded (engine ships with the app, NO pairing keys) → loopback WS +
 *    loopback token ('unencrypted'), else WSS + token ('insecure-ssl');
 *  - paired self-hosted (legacy/E2E) → the persisted URL for the persisted
 *    security mode ('secure' default).
 *
 * Regression guard: the STT test panel used to know only cloud + paired keys,
 * so a pure embedded install threw "Not connected to Soulbits Engine" while the
 * engine was up (v0.4.53-dev). Mirrors the pinned shapes in
 * entitySessionResolveLocalWs.test.ts — same implementation serves both.
 */
import {
  EngineConnectionUnavailableError,
  resolveEngineEventEndpoint,
} from '../engineEventEndpoint';
import { CLOUD_HOSTS, WS_PATHS } from '../../../config/cloud';

const mockGetEngineConnection = jest.fn();

jest.mock('../../engine/EngineService', () => ({
  __esModule: true,
  getEngineConnection: (...args: any[]) => mockGetEngineConnection(...args),
}));

jest.mock('../../ConnectionStateManager', () => ({
  __esModule: true,
  default: {
    getCurrentSource: jest.fn(),
    getSecurityMode: jest.fn(),
    getWSUrl: jest.fn(),
    getWSSUrl: jest.fn(),
  },
}));

const mockCsm = jest.requireMock('../../ConnectionStateManager').default;

describe('resolveEngineEventEndpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEngineConnection.mockReturnValue(null);
    mockCsm.getCurrentSource.mockResolvedValue('selfhosted');
    mockCsm.getSecurityMode.mockResolvedValue('secure');
    mockCsm.getWSUrl.mockResolvedValue('ws://legacy:28080/events');
    mockCsm.getWSSUrl.mockResolvedValue('wss://legacy:28443/events');
  });

  it('embedded engine → plain loopback WS + token, mode "unencrypted"', async () => {
    mockGetEngineConnection.mockReturnValue({
      wsBaseUrl: 'ws://127.0.0.1:42377',
      wssBaseUrl: 'wss://127.0.0.1:42443',
      token: 'loopback-token',
    });

    await expect(resolveEngineEventEndpoint()).resolves.toEqual({
      url: 'ws://127.0.0.1:42377?token=loopback-token',
      mode: 'unencrypted',
    });
    // The embedded path must never read the (empty) pairing keys.
    expect(mockCsm.getSecurityMode).not.toHaveBeenCalled();
    expect(mockCsm.getWSSUrl).not.toHaveBeenCalled();
  });

  it('embedded engine without a plain WS port → loopback WSS + token, mode "insecure-ssl"', async () => {
    mockGetEngineConnection.mockReturnValue({
      wsBaseUrl: '',
      wssBaseUrl: 'wss://127.0.0.1:42443',
      token: 'loopback-token',
    });

    await expect(resolveEngineEventEndpoint()).resolves.toEqual({
      url: 'wss://127.0.0.1:42443?token=loopback-token',
      mode: 'insecure-ssl',
    });
  });

  it('no engine, paired keys with mode "unencrypted" → persisted WS URL', async () => {
    mockCsm.getSecurityMode.mockResolvedValue('unencrypted');

    await expect(resolveEngineEventEndpoint()).resolves.toEqual({
      url: 'ws://legacy:28080/events',
      mode: 'unencrypted',
    });
    expect(mockCsm.getWSUrl).toHaveBeenCalled();
    expect(mockCsm.getWSSUrl).not.toHaveBeenCalled();
  });

  it('no engine, paired keys with mode "insecure-ssl" → persisted WSS URL', async () => {
    mockCsm.getSecurityMode.mockResolvedValue('insecure-ssl');

    await expect(resolveEngineEventEndpoint()).resolves.toEqual({
      url: 'wss://legacy:28443/events',
      mode: 'insecure-ssl',
    });
  });

  it('no engine, no stored mode → defaults to "secure" and the persisted WSS URL', async () => {
    mockCsm.getSecurityMode.mockResolvedValue(null);

    await expect(resolveEngineEventEndpoint()).resolves.toEqual({
      url: 'wss://legacy:28443/events',
      mode: 'secure',
    });
  });

  it('nothing available → throws EngineConnectionUnavailableError with the exact message', async () => {
    mockCsm.getSecurityMode.mockResolvedValue(null);
    mockCsm.getWSSUrl.mockResolvedValue(null);
    mockCsm.getWSUrl.mockResolvedValue(null);

    await expect(resolveEngineEventEndpoint()).rejects.toBeInstanceOf(
      EngineConnectionUnavailableError,
    );
    await expect(resolveEngineEventEndpoint()).rejects.toThrow(
      'Not connected to Soulbits Engine',
    );
  });

  it('cloud source → conduct-proxy worker URL + mode "cloud" (checked before the engine)', async () => {
    mockCsm.getCurrentSource.mockResolvedValue('cloud');
    // A live embedded engine must NOT win over the cloud source.
    mockGetEngineConnection.mockReturnValue({
      wsBaseUrl: 'ws://127.0.0.1:42377',
      wssBaseUrl: '',
      token: 'loopback-token',
    });

    await expect(resolveEngineEventEndpoint()).resolves.toEqual({
      url: `${CLOUD_HOSTS.conductProxyWs}${WS_PATHS.worker}`,
      mode: 'cloud',
    });
    expect(mockCsm.getSecurityMode).not.toHaveBeenCalled();
  });
});
