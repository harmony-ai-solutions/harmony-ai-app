/**
 * EntitySessionService — connection-exact event routing + session dedup
 * (entity-recreation hijack fix).
 *
 * Observed on device: an entity deleted + recreated while the chat screen
 * was open left the STALE session (old participant set) alive alongside the
 * new chat's session. Both contain the own entity ('user'), and
 * handleEntityEvent resolved sessions by a first-match scan on bare entity
 * id — so the stale session HIJACKED the new chat's INIT_ENTITY response
 * (canonical-id swap landed on the wrong session) while the live greeting
 * utterance was persisted under the new session's abandoned temp id. The
 * chat then showed the preparing bubble forever with no greeting and
 * connectivity never turned active (all-active gate starved → retry storm).
 *
 * The fix: ConnectionManager emits the delivering socket's connectionId
 * with 'event:entity'; handleEntityEvent resolves the session by that exact
 * connection id (connection ids embed the participant-set key). A stale
 * event whose session is gone is DROPPED instead of rerouted. And
 * startInteractionSession now reuses a live session for the same
 * own-entity + participant set instead of stacking a parallel one.
 */
import { EntitySessionService } from '../EntitySessionService';
import { createConversationMessage, messageExists } from '../../database/repositories/conversation_messages';

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
    getWSUrl: jest.fn().mockResolvedValue('ws://10.0.2.2:28080/events'),
    getWSSUrl: jest.fn().mockResolvedValue('wss://10.0.2.2:28443/events'),
  },
}));

jest.mock('../SyncService', () => ({
  __esModule: true,
  SyncService: { getInstance: () => ({ initiateSync: jest.fn().mockResolvedValue(undefined) }) },
}));

jest.mock('../../database/repositories/interactions', () => ({
  createInteraction: jest.fn().mockResolvedValue(undefined),
  getSyncedReplyMode: jest.fn().mockResolvedValue('realistic'),
  deriveScopeFromParticipants: jest.fn()
    .mockImplementation((p: string[]) => (p.length <= 1 ? 'world' : p.length === 2 ? 'private' : 'group')),
  // Mirror the real derivation (sorted pair) so connection ids are realistic.
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

jest.mock('../../database/repositories/entities', () => ({
  getEntity: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../cloud/CloudSessionService', () => ({
  cloudSessionService: { connect: jest.fn(), disconnect: jest.fn(), getStatus: jest.fn().mockReturnValue('idle'), isPurging: jest.fn().mockReturnValue(false) },
  default: {},
}));

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

describe('EntitySessionService — connection-exact routing (recreation hijack)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.createConnection.mockResolvedValue(undefined);
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    (messageExists as jest.Mock).mockResolvedValue(false);
    resetSingleton();
  });

  it("routes the new chat's INIT_ENTITY response to the NEW session — the stale session cannot hijack the canonical swap", async () => {
    const svc = EntitySessionService.getInstance();

    // Stale session for the DELETED partner's chat (still alive)…
    const stale = await svc.startInteractionSession('user', ['Isabella', 'user']);
    // …and the fresh session for the recreated entity's chat.
    const fresh = await svc.startInteractionSession('user', ['Isabella 2', 'user']);

    const freshUserConn = fresh.connections.get('user')!.connectionId;

    await (svc as any).handleEntityEvent(
      'user',
      {
        event_type: 'INIT_ENTITY',
        status: 'SUCCESS',
        payload: {
          session_id: 'sess-user-fresh',
          interaction_id: 'canonical-fresh',
          has_first_mes: false,
        },
      },
      freshUserConn,
    );

    // The NEW session adopted the canonical id…
    expect(fresh.interactionId).toBe('canonical-fresh');
    // …and the STALE session was untouched (previously it stole the swap).
    expect(stale.interactionId).not.toBe('canonical-fresh');
  });

  it('persists the live greeting under the CURRENT canonical interaction id — not the abandoned temp id', async () => {
    const svc = EntitySessionService.getInstance();

    const stale = await svc.startInteractionSession('user', ['Isabella', 'user']);
    void stale;
    const fresh = await svc.startInteractionSession('user', ['Isabella 2', 'user']);

    // Canonical swap lands on the fresh session (connection-exact INIT).
    await (svc as any).handleEntityEvent(
      'user',
      {
        event_type: 'INIT_ENTITY',
        status: 'SUCCESS',
        payload: { session_id: 'sess-user-fresh', interaction_id: 'canonical-fresh', has_first_mes: true },
      },
      fresh.connections.get('user')!.connectionId,
    );
    expect(fresh.interactionId).toBe('canonical-fresh');

    // Live authored greeting arrives on the fresh chat's PARTNER socket.
    await (svc as any).handleEntityEvent(
      'Isabella 2',
      {
        event_type: 'ENTITY_UTTERANCE',
        status: 'NEW',
        event_id: 'evt-greeting-1',
        payload: {
          entity_id: 'Isabella 2',
          message_id: 'msg-greeting-1',
          type: 'verbal',
          message_type: 'greeting',
          content: 'Welcome home hon~',
        },
      },
      fresh.connections.get('Isabella 2')!.connectionId,
    );

    expect(createConversationMessage).toHaveBeenCalledTimes(1);
    const stored = (createConversationMessage as jest.Mock).mock.calls[0][0];
    // The row the user-perspective view reads must be under the canonical id.
    expect(stored.interaction_id).toBe('canonical-fresh');
    expect(stored.message_type).toBe('greeting');
    expect(stored.sender_entity_id).toBe('Isabella 2');
  });

  it('keeps the legacy first-match fallback for events without a connection id', async () => {
    const svc = EntitySessionService.getInstance();

    const only = await svc.startInteractionSession('user', ['Marcella', 'user']);

    await (svc as any).handleEntityEvent('Marcella', {
      event_type: 'ENTITY_UTTERANCE',
      status: 'NEW',
      event_id: 'evt-legacy-1',
      payload: {
        entity_id: 'Marcella',
        message_id: 'msg-legacy-1',
        type: 'verbal',
        content: 'legacy path',
      },
    });

    expect(createConversationMessage).toHaveBeenCalledTimes(1);
    expect((createConversationMessage as jest.Mock).mock.calls[0][0].interaction_id).toBe(only.interactionId);
  });

  it('drops events whose delivering connection belongs to no live session (stale socket)', async () => {
    const svc = EntitySessionService.getInstance();

    await svc.startInteractionSession('user', ['Iris', 'user']);

    await (svc as any).handleEntityEvent(
      'user',
      {
        event_type: 'ENTITY_UTTERANCE',
        status: 'NEW',
        event_id: 'evt-ghost-1',
        payload: { entity_id: 'user', message_id: 'msg-ghost-1', type: 'verbal', content: 'ghost' },
      },
      'entity-user-ghost-key',
    );

    expect(createConversationMessage).not.toHaveBeenCalled();
  });
});

describe('EntitySessionService — startInteractionSession dedup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.createConnection.mockResolvedValue(undefined);
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    resetSingleton();
  });

  it('reuses the live session for the same own entity + participant set instead of stacking a parallel one', async () => {
    const svc = EntitySessionService.getInstance();

    const first = await svc.startInteractionSession('user', ['Isabella 2', 'user']);
    const second = await svc.startInteractionSession('user', ['user', 'Isabella 2']); // order-insensitive

    expect(second).toBe(first);
    // Only the FIRST start created sockets (N+1 for 2 participants).
    expect(mockConnectionManager.createConnection).toHaveBeenCalledTimes(2);
  });

  it('still creates a fresh session for a DIFFERENT participant set', async () => {
    const svc = EntitySessionService.getInstance();

    const a = await svc.startInteractionSession('user', ['Isabella 2', 'user']);
    const b = await svc.startInteractionSession('user', ['claire', 'user']);

    expect(b).not.toBe(a);
    expect(mockConnectionManager.createConnection).toHaveBeenCalledTimes(4);
  });
});
