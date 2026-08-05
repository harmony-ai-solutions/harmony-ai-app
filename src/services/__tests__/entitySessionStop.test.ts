/**
 * EntitySessionService.stopInteractionSession — teardown robustness tests.
 *
 * Regression test for the connection-leak bug found via on-device logs
 * (2026-08-05): `AudioPlayer.stop()` was the FIRST statement in the teardown
 * try-block and throws 'player_not_initialized' when TrackPlayer was never set
 * up (the chat had no audio playback). The throw jumped to the outer catch,
 * so the connection-teardown loop NEVER ran — every chat exit leaked its
 * entity WebSockets (live heartbeats, "Connection entity-X already exists,
 * disconnecting first" on the next session, orphaned engine-side sessions).
 *
 * These tests pin the fix: audio errors (and per-connection teardown errors)
 * must never skip the remaining disconnects.
 */

import { EntitySessionService } from '../EntitySessionService';
import { EventEmitter } from 'eventemitter3';

let mockConnectionManager: EventEmitter & {
  sendEvent: jest.Mock;
  isConnected: jest.Mock;
  disconnectConnection: jest.Mock;
};
let mockAudioPlayerStop: jest.Mock;

jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn().mockResolvedValue('test-device'),
}));

jest.mock('react-native-track-player', () => ({
  default: {
    setupPlayer: jest.fn().mockResolvedValue(undefined),
    add: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../AudioPlayer', () => {
  mockAudioPlayerStop = jest.fn().mockResolvedValue(undefined);
  return {
    __esModule: true,
    default: { stop: mockAudioPlayerStop },
    AudioPlayer: class {},
  };
});

jest.mock('../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  const cm: EventEmitter & {
    sendEvent: jest.Mock;
    isConnected: jest.Mock;
    disconnectConnection: jest.Mock;
  } = new EE();
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.isConnected = jest.fn().mockReturnValue(true);
  cm.disconnectConnection = jest.fn();
  mockConnectionManager = cm;
  return { __esModule: true, default: cm };
});

jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../cloud/CloudSessionService', () => ({
  cloudSessionService: {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue('idle'),
  },
  default: {},
}));

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

function seedSession(svc: any, interactionId: string): void {
  svc.sessions.set(interactionId, {
    interactionId,
    interaction: null,
    participantIds: ['claire', 'user'],
    ownEntityId: 'user',
    connections: new Map([
      ['claire', { connectionId: 'entity-claire', status: 'active' }],
      ['user', { connectionId: 'entity-user', status: 'active' }],
    ]),
    pendingTranscriptions: new Map(),
  });
}

describe('EntitySessionService.stopInteractionSession teardown', () => {
  beforeEach(() => {
    mockConnectionManager.removeAllListeners();
    mockConnectionManager.sendEvent.mockClear();
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    mockConnectionManager.isConnected.mockClear();
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.disconnectConnection.mockClear();
    mockAudioPlayerStop.mockClear();
    mockAudioPlayerStop.mockResolvedValue(undefined);
    resetSingleton();
  });

  it('still disconnects ALL connections when AudioPlayer.stop() throws player_not_initialized', async () => {
    // TrackPlayer was never set up → stop() rejects, exactly like on device.
    mockAudioPlayerStop.mockRejectedValue(
      Object.assign(new Error('Stop failed'), { code: 'player_not_initialized' }),
    );

    const svc = EntitySessionService.getInstance();
    seedSession(svc as any, 'ix-1');

    const stoppedEvents: string[] = [];
    svc.on('session:stopped', (id: string) => stoppedEvents.push(id));

    await svc.stopInteractionSession('ix-1');

    // The audio error must not skip connection teardown (the on-device bug).
    expect(mockConnectionManager.disconnectConnection).toHaveBeenCalledWith('entity-claire');
    expect(mockConnectionManager.disconnectConnection).toHaveBeenCalledWith('entity-user');
    // Session is still cleaned up and the stopped event still fires.
    expect(stoppedEvents).toEqual(['ix-1']);
    expect((svc as any).sessions.has('ix-1')).toBe(false);
  });

  it('continues tearing down remaining connections when one disconnect fails', async () => {
    // First connection's ENTITY_SESSION_END send fails — the second connection
    // must still be disconnected (per-connection fault isolation).
    mockConnectionManager.sendEvent
      .mockRejectedValueOnce(new Error('socket dead'))
      .mockResolvedValue(undefined);

    const svc = EntitySessionService.getInstance();
    seedSession(svc as any, 'ix-2');

    const stoppedEvents: string[] = [];
    svc.on('session:stopped', (id: string) => stoppedEvents.push(id));

    await svc.stopInteractionSession('ix-2');

    expect(mockConnectionManager.disconnectConnection).toHaveBeenCalledWith('entity-user');
    expect(stoppedEvents).toEqual(['ix-2']);
    expect((svc as any).sessions.has('ix-2')).toBe(false);
  });
});
