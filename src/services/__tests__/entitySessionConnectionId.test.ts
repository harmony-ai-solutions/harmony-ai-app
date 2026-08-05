/**
 * EntitySessionService.startInteractionSession — participant-set-scoped
 * connection IDs (Fix C).
 *
 * The engine keys interaction sessions by participant set (one canonical
 * interaction_id per distinct participant set). Previously every session built
 * its connection ids as `entity-${entityId}`, so a Marcella+user chat and a
 * claire+user chat BOTH created an `entity-user` socket — colliding on the
 * single ConnectionManager slot and the native per-URL socket key. Rapid
 * switching raced the previous teardown against the new setup → native
 * "Already Connected"/stale-socket failures → 15s init timeouts → the
 * "Scheduling retry 1/3…3/3" connection delay observed on device.
 *
 * The fix appends a sanitized participant-set suffix, so each chat gets its OWN
 * `entity-user-<participantKey>` socket. These tests pin that contract: the two
 * chats' `entity-user` ids must be DISTINCT and URL-safe.
 */
import { EntitySessionService } from '../EntitySessionService';

import { EventEmitter } from 'eventemitter3';

let mockConnectionManager: EventEmitter & {
  isConnected: jest.Mock;
  createConnection: jest.Mock;
  sendEvent: jest.Mock;
  disconnectConnection: jest.Mock;
};

jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn().mockResolvedValue('test-device'),
}));

jest.mock('react-native-track-player', () => ({
  default: { setupPlayer: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../AudioPlayer', () => ({
  __esModule: true,
  default: { stop: jest.fn().mockResolvedValue(undefined) },
  AudioPlayer: class {},
}));

jest.mock('../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  // EventEmitter base — the service constructor subscribes (cm.on) to entity
  // events during setupConnectionListeners().
  const cm = new EE();
  cm.isConnected = jest.fn().mockReturnValue(true);
  cm.createConnection = jest.fn().mockResolvedValue(undefined);
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.disconnectConnection = jest.fn();
  cm.getEntityConnection = jest.fn().mockReturnValue(null);
  mockConnectionManager = cm as any;
  return { __esModule: true, default: cm };
});

jest.mock('../ConnectionStateManager', () => ({
  __esModule: true,
  default: {
    getCurrentSource: jest.fn().mockResolvedValue('selfhosted'),
    getSecurityMode: jest.fn().mockResolvedValue('insecure-ssl'),
    getWSSUrl: jest.fn().mockResolvedValue('wss://10.0.2.2:28443/events'),
    getWSUrl: jest.fn().mockResolvedValue('ws://10.0.2.2:28080/events'),
  },
}));

jest.mock('../SyncService', () => ({
  __esModule: true,
  SyncService: { getInstance: () => ({ initiateSync: jest.fn().mockResolvedValue(undefined) }) },
}));

jest.mock('../../database/repositories/interactions', () => ({
  createInteraction: jest.fn().mockResolvedValue(undefined),
  deriveScopeFromParticipants: jest.fn()
    .mockImplementation((p: string[]) => (p.length <= 1 ? 'world' : p.length === 2 ? 'private' : 'group')),
  // Mirror the real derivation so the suffix is deterministic and matches prod.
  deriveParticipantKey: jest.fn()
    .mockImplementation((participants: string[], entityId: string) => {
      const partner = participants.find((id: string) => id !== entityId);
      if (!partner) return '';
      return entityId < partner ? `${entityId}+${partner}` : `${partner}+${entityId}`;
    }),
}));

jest.mock('../../database/repositories/conversation_messages', () => ({
  messageExists: jest.fn(),
  createConversationMessage: jest.fn(),
  updateConversationMessage: jest.fn(),
  getConversationMessage: jest.fn(),
}));

jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../cloud/CloudSessionService', () => ({
  cloudSessionService: { connect: jest.fn(), disconnect: jest.fn(), getStatus: jest.fn().mockReturnValue('idle') },
  default: {},
}));

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

/** Connection IDs passed to ConnectionManager.createConnection, in call order. */
function createdIds(): string[] {
  return mockConnectionManager.createConnection.mock.calls.map((c) => c[0] as string);
}

describe('EntitySessionService participant-set-scoped connection IDs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.createConnection.mockResolvedValue(undefined);
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    resetSingleton();
  });

  it('gives each chat its own entity-user socket (no collision across participant sets)', async () => {
    const svc = EntitySessionService.getInstance();

    await svc.startInteractionSession('user', ['claire', 'user'], 'realistic');
    await svc.startInteractionSession('user', ['marcella', 'user'], 'realistic');

    const ids = createdIds();

    // claire+user chat: participantKey 'claire+user' → suffix '-claire-user'
    expect(ids).toContain('entity-claire-claire-user');
    expect(ids).toContain('entity-user-claire-user');
    // marcella+user chat: participantKey 'marcella+user' → suffix '-marcella-user'
    expect(ids).toContain('entity-marcella-marcella-user');
    expect(ids).toContain('entity-user-marcella-user');

    // THE CORE FIX: the two entity-user sockets are DISTINCT (previously both
    // were the single colliding 'entity-user').
    const userIds = ids.filter((id) => id.startsWith('entity-user-'));
    expect(userIds).toEqual(['entity-user-claire-user', 'entity-user-marcella-user']);
    expect(new Set(userIds).size).toBe(userIds.length);
  });

  it('the participant-set suffix is URL-safe in the connection_id query param (no raw "+")', async () => {
    const svc = EntitySessionService.getInstance();
    await svc.startInteractionSession('user', ['claire', 'user'], 'realistic');

    // No connection id may contain the URL-unsafe '+' (would corrupt the native
    // per-URL socket key in ?connection_id=…).
    for (const id of createdIds()) {
      expect(id).not.toContain('+');
    }
  });
});
