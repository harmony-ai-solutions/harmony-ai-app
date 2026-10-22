/**
 * e2eEngineOverride — unit tests (plan 7-13).
 *
 * react-native-config is mocked globally in jest.setup.js; its `default` is a
 * plain mutable object, so the tests drive the injected peer endpoints by
 * assigning the (normally BuildConfig-injected) keys directly.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../EngineService', () => ({
  getEngineConnection: jest.fn(),
  onEngineConnectionChange: jest.fn(() => jest.fn()),
}));

jest.mock('../EngineApiClient', () => ({
  engineApiClient: { updateSyncClientConfig: jest.fn() },
}));

import Config from 'react-native-config';
import { getEngineConnection, onEngineConnectionChange } from '../EngineService';
import { engineApiClient } from '../EngineApiClient';
import {
  applyE2EEngineOverride,
  attachE2EEngineOverride,
  hasE2EEngineOverride,
  readE2EEnginePeerTarget,
  resetE2EEngineOverrideForTests,
} from '../e2eEngineOverride';

const mockedGetConnection = getEngineConnection as jest.Mock;
const mockedOnChange = onEngineConnectionChange as jest.Mock;
const mockedUpdate = engineApiClient.updateSyncClientConfig as jest.Mock;
const mockedConfig = Config as {
  E2E_ENGINE_PEER_WS_URL?: string;
  E2E_ENGINE_PEER_WSS_URL?: string;
};

const CONN = { adminBaseUrl: 'http://127.0.0.1:28081' };

function clearInjectedConfig() {
  mockedConfig.E2E_ENGINE_PEER_WS_URL = undefined;
  mockedConfig.E2E_ENGINE_PEER_WSS_URL = undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetE2EEngineOverrideForTests();
  clearInjectedConfig();
  mockedGetConnection.mockReturnValue(null);
  mockedUpdate.mockResolvedValue({});
  mockedOnChange.mockImplementation(() => jest.fn());
});

afterEach(() => {
  resetE2EEngineOverrideForTests();
  clearInjectedConfig();
});

describe('readE2EEnginePeerTarget / hasE2EEngineOverride', () => {
  it('is inert when the build injected nothing (normal dev/prod)', () => {
    expect(readE2EEnginePeerTarget()).toBeNull();
    expect(hasE2EEngineOverride()).toBe(false);
  });

  it('reads the injected peer endpoints', () => {
    mockedConfig.E2E_ENGINE_PEER_WS_URL = '10.0.2.2:28080';
    mockedConfig.E2E_ENGINE_PEER_WSS_URL = '10.0.2.2:28443';
    expect(readE2EEnginePeerTarget()).toEqual({
      peerAddress: '10.0.2.2:28080',
      peerWssAddress: '10.0.2.2:28443',
    });
    expect(hasE2EEngineOverride()).toBe(true);
  });

  it('requires the plaintext WS endpoint (the engine needs peer_address when enabled)', () => {
    mockedConfig.E2E_ENGINE_PEER_WSS_URL = '10.0.2.2:28443';
    expect(readE2EEnginePeerTarget()).toBeNull();
    expect(hasE2EEngineOverride()).toBe(false);
  });
});

describe('applyE2EEngineOverride', () => {
  it('does nothing when the override is absent', async () => {
    expect(await applyE2EEngineOverride()).toBe(false);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('does nothing until the engine is ready', async () => {
    mockedConfig.E2E_ENGINE_PEER_WS_URL = '10.0.2.2:28080';
    mockedGetConnection.mockReturnValue(null);
    expect(await applyE2EEngineOverride()).toBe(false);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('configures the embedded engine sync client over the LAN transport', async () => {
    mockedConfig.E2E_ENGINE_PEER_WS_URL = '10.0.2.2:28080';
    mockedConfig.E2E_ENGINE_PEER_WSS_URL = '10.0.2.2:28443';
    mockedGetConnection.mockReturnValue(CONN);
    expect(await applyE2EEngineOverride()).toBe(true);
    expect(mockedUpdate).toHaveBeenCalledWith({
      transport: 'lan',
      enabled: true,
      security_mode: 'insecure-ssl',
      peer_address: '10.0.2.2:28080',
      peer_wss_address: '10.0.2.2:28443',
    });
  });

  it('omits peer_wss_address when only the plaintext endpoint was injected', async () => {
    mockedConfig.E2E_ENGINE_PEER_WS_URL = '10.0.2.2:28080';
    mockedGetConnection.mockReturnValue(CONN);
    expect(await applyE2EEngineOverride()).toBe(true);
    expect(mockedUpdate).toHaveBeenCalledWith({
      transport: 'lan',
      enabled: true,
      security_mode: 'insecure-ssl',
      peer_address: '10.0.2.2:28080',
    });
  });

  it('is non-fatal when the engine rejects the config', async () => {
    mockedConfig.E2E_ENGINE_PEER_WS_URL = '10.0.2.2:28080';
    mockedGetConnection.mockReturnValue(CONN);
    mockedUpdate.mockRejectedValueOnce(new Error('boom'));
    expect(await applyE2EEngineOverride()).toBe(false);
  });
});

describe('attachE2EEngineOverride', () => {
  it('does not subscribe when the override is absent', () => {
    const off = attachE2EEngineOverride();
    expect(mockedOnChange).not.toHaveBeenCalled();
    expect(typeof off).toBe('function');
    off();
  });

  it('applies immediately when the engine is already ready', async () => {
    mockedConfig.E2E_ENGINE_PEER_WS_URL = '10.0.2.2:28080';
    mockedGetConnection.mockReturnValue(CONN);
    attachE2EEngineOverride();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });

  it('applies when the engine becomes ready later', async () => {
    mockedConfig.E2E_ENGINE_PEER_WS_URL = '10.0.2.2:28080';
    mockedGetConnection.mockReturnValue(null);
    let listener: ((conn: unknown) => void) | null = null;
    mockedOnChange.mockImplementation((cb: (conn: unknown) => void) => {
      listener = cb;
      return jest.fn();
    });

    attachE2EEngineOverride();
    expect(mockedUpdate).not.toHaveBeenCalled();

    mockedGetConnection.mockReturnValue(CONN);
    listener!(CONN);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });
});
