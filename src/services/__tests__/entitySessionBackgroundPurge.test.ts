/**
 * EntitySessionService — background WS policy during cloud purge (D1-5).
 *
 * Her commit 20c985a made the entity WebSockets stay connected when the app
 * backgrounds (only the entity sessions are torn down for battery; the cloud
 * session stays ready for the floating overlay). D1-5 keeps that behavior but
 * guards it against the cloud data-purge window: the background handler must
 * NOT disconnect/reconnect entity sessions while `cloudSessionService.isPurging()`
 * is true — the purge owns the WS lifecycle until it settles, and re-dialing
 * mid-purge would race the purge teardown / broker 409 (the same reasoning as
 * SyncConnectionContext.connect()'s `isPurging()` skip + PurgeInProgressError
 * catch).
 */

import { AppState, AppStateStatus } from 'react-native';
import { EntitySessionService } from '../EntitySessionService';
import { EventEmitter } from 'eventemitter3';

let mockConnectionManager: EventEmitter & {
  sendEvent: jest.Mock;
  isConnected: jest.Mock;
  disconnectConnection: jest.Mock;
};
let mockAudioPlayerStop: jest.Mock;
let mockCloudSession: {
  connect: jest.Mock;
  disconnect: jest.Mock;
  getStatus: jest.Mock;
  isPurging: jest.Mock;
};

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

jest.mock('../cloud/CloudSessionService', () => {
  mockCloudSession = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue('idle'),
    isPurging: jest.fn().mockReturnValue(false),
  };
  return { cloudSessionService: mockCloudSession, default: {} };
});

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

/** Grab the 'change' listener registered by the CURRENT instance's setupAppStateListener(). */
function getAppStateHandler(): (s: AppStateStatus) => void {
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  // reverse so the most recently registered handler (the current instance)
  // wins — stale handlers from prior tests' instances must not be fired.
  const changeCall = [...calls].reverse().find((c: any[]) => c[0] === 'change');
  if (!changeCall) {
    throw new Error('EntitySessionService did not register an AppState listener');
  }
  return changeCall[1] as (s: AppStateStatus) => void;
}

describe('EntitySessionService background WS policy (D1-5)', () => {
  beforeEach(() => {
    mockConnectionManager.removeAllListeners();
    mockConnectionManager.sendEvent.mockClear();
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    mockConnectionManager.isConnected.mockClear();
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.disconnectConnection.mockClear();
    mockAudioPlayerStop.mockClear();
    mockAudioPlayerStop.mockResolvedValue(undefined);
    mockCloudSession.isPurging.mockClear();
    mockCloudSession.isPurging.mockReturnValue(false);
    // Stale AppState registrations from prior tests' instances must not leak
    // into getAppStateHandler() (the fresh instance re-registers below).
    (AppState.addEventListener as jest.Mock).mockClear();
    resetSingleton();
  });

  it('keeps entity sessions connected when the app backgrounds during a purge', async () => {
    mockCloudSession.isPurging.mockReturnValue(true);

    const svc = EntitySessionService.getInstance();
    seedSession(svc as any, 'ix-1');

    getAppStateHandler()('background');
    await Promise.resolve();

    // The purge guard must skip closeAllSessions entirely — no
    // ENTITY_SESSION_END sends and no connection teardown.
    expect(mockConnectionManager.sendEvent).not.toHaveBeenCalled();
    expect(mockConnectionManager.disconnectConnection).not.toHaveBeenCalled();
    expect((svc as any).sessions.has('ix-1')).toBe(true);
  });

  it('still closes entity sessions on background when no purge is active', async () => {
    mockCloudSession.isPurging.mockReturnValue(false);

    const svc = EntitySessionService.getInstance();
    seedSession(svc as any, 'ix-2');

    getAppStateHandler()('background');
    // Let closeAllSessions → stopInteractionSession microtasks settle
    // (AudioPlayer.stop → ENTITY_SESSION_END send → disconnect, per conn).
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockConnectionManager.disconnectConnection).toHaveBeenCalledWith('entity-claire');
    expect(mockConnectionManager.disconnectConnection).toHaveBeenCalledWith('entity-user');
    expect((svc as any).sessions.has('ix-2')).toBe(false);
  });
});