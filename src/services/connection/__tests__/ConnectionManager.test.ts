/**
 * ConnectionManager — regression tests for connection cleanup on failure.
 *
 * When `createConnection` fails (e.g. the native module rejects with
 * "Already Connected"), the errored `ConnectionInfo` used to stay in the
 * `connections` map. The next `createConnection` for the same id then found a
 * stale entry, called `disconnectConnection` (a no-op when the wrapper never
 * wired its socket), and kept the deadlock alive.
 *
 * This verifies a failed connection is fully torn down and removed from the map.
 */
import { ConnectionManager } from '../ConnectionManager';
import { WebSocketConnectionFactory } from '../../websocket/WebSocketConnectionFactory';

jest.mock('../../websocket/WebSocketConnectionFactory', () => ({
  WebSocketConnectionFactory: { createConnection: jest.fn() },
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

function makeFakeConnection() {
  return {
    on: jest.fn(),
    off: jest.fn(),
    removeAllListeners: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
    isConnected: jest.fn(() => false),
    sendEvent: jest.fn(),
    startHeartbeat: jest.fn(),
  };
}

describe('ConnectionManager', () => {
  let cm: ConnectionManager;

  beforeEach(() => {
    cm = ConnectionManager.getInstance();
    (cm as any).connections.clear();
    jest.clearAllMocks();
  });

  it('removes a failed connection from its map so a retry starts clean', async () => {
    const fakeConn = makeFakeConnection();
    fakeConn.connect.mockRejectedValue(new Error('Already Connected'));
    (WebSocketConnectionFactory.createConnection as jest.Mock).mockReturnValue(
      fakeConn,
    );

    await expect(
      cm.createConnection(
        'entity-Marcella',
        'entity',
        'wss://10.0.2.2:28443/events',
        'insecure-ssl',
        'Marcella',
      ),
    ).rejects.toThrow('Already Connected');

    // The failed connection must not linger in the map.
    expect(cm.getConnection('entity-Marcella')).toBeNull();
    // And its native socket must be closed (listeners removed + disconnect).
    expect(fakeConn.removeAllListeners).toHaveBeenCalled();
    expect(fakeConn.disconnect).toHaveBeenCalled();
  });
});
