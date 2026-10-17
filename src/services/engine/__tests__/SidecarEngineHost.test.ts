/**
 * SidecarEngineHost — DB key defaulting tests (task 4-2 Android parity).
 *
 * The Android sidecar must receive the app-owned DB key (as `SE_DB_KEY`) the
 * same way the iOS `EmbeddedEngineHost` does: when the caller supplies none, the
 * host resolves it from the Keychain via `getOrCreateEngineDbKey()`. The native
 * side already forwards `dbKey` → `SE_DB_KEY`; this covers the JS defaulting.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// The sidecar module is mocked so no native module loads. The start call is the
// assertion surface.
jest.mock('../EngineSidecarModule', () => ({
  startEngineSidecar: jest.fn(async () => ({
    wsPort: 28080,
    wssPort: 0,
    adminPort: 28081,
    bind: '127.0.0.1',
    pid: 42,
    dataDir: '/data/engine',
    token: 'tok',
  })),
  stopEngineSidecar: jest.fn(async () => undefined),
  getEngineSidecarState: jest.fn(async () => 'ready'),
  isEngineSidecarAvailable: jest.fn(async () => true),
  onEngineSidecarEvent: jest.fn(() => () => undefined),
  onEngineExit: jest.fn(() => () => undefined),
}));

// The Keychain custodian is mocked so the defaulting is observable without a
// device keychain.
jest.mock('../EngineDbKey', () => ({
  getOrCreateEngineDbKey: jest.fn(async () => 'key-from-keychain'),
}));

import { startEngineSidecar } from '../EngineSidecarModule';
import { getOrCreateEngineDbKey } from '../EngineDbKey';
import { SidecarEngineHost } from '../SidecarEngineHost';

const mockStart = startEngineSidecar as jest.Mock;
const mockGetOrCreate = getOrCreateEngineDbKey as jest.Mock;

function lastStartOptions(): any {
  return mockStart.mock.calls[mockStart.mock.calls.length - 1][0];
}

describe('SidecarEngineHost — DB key defaulting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOrCreate.mockResolvedValue('key-from-keychain');
  });

  it('defaults the DB key from the Keychain when none is supplied', async () => {
    await new SidecarEngineHost().start();
    expect(mockGetOrCreate).toHaveBeenCalledTimes(1);
    expect(lastStartOptions().dbKey).toBe('key-from-keychain');
  });

  it('honours an explicitly supplied DB key without touching the Keychain', async () => {
    await new SidecarEngineHost().start({ dbKey: 'explicit-key' });
    expect(mockGetOrCreate).not.toHaveBeenCalled();
    expect(lastStartOptions().dbKey).toBe('explicit-key');
  });

  it('leaves dbKey undefined when the Keychain is unavailable (unencrypted default)', async () => {
    mockGetOrCreate.mockResolvedValue(null);
    await new SidecarEngineHost().start();
    expect(mockGetOrCreate).toHaveBeenCalledTimes(1);
    expect(lastStartOptions().dbKey).toBeUndefined();
  });

  it('passes other start options through alongside the resolved key', async () => {
    await new SidecarEngineHost().start({ dataDir: '/custom', logLevel: 'debug' });
    expect(lastStartOptions()).toEqual(
      expect.objectContaining({ dataDir: '/custom', logLevel: 'debug', dbKey: 'key-from-keychain' }),
    );
  });
});
