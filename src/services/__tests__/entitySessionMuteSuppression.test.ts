/**
 * EntitySessionService incoming-message entity gate (Q8/A5).
 *
 * The unread-badge increment was REMOVED from the service (unread is now
 * DERIVED from conversation_messages.is_read — the badge seam lives in
 * ChatListScreen). What remains in `handleIncomingMessage` is the entity-level
 * DISABLED drop gate: an incoming message from a disabled partner entity is
 * dropped before it reaches the database (defense-in-depth). Mute no longer
 * suppresses anything at the service layer — muted conversations still store
 * their messages (the badge suppression is a UI concern now, O10).
 */

import { EntitySessionService } from '../EntitySessionService';
import { EventEmitter } from 'eventemitter3';
import { getEntity } from '../../database/repositories/entities';
import { createConversationMessage } from '../../database/repositories/conversation_messages';

let mockConnectionManager: EventEmitter;

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

jest.mock('../AudioPlayer', () => ({
  __esModule: true,
  default: { stop: jest.fn().mockResolvedValue(undefined) },
  AudioPlayer: class {},
}));

jest.mock('../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  const cm = new EE();
  cm.isConnected = jest.fn().mockReturnValue(true);
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.disconnectConnection = jest.fn();
  cm.createConnection = jest.fn().mockResolvedValue(undefined);
  cm.getEntityConnection = jest.fn().mockReturnValue(null);
  mockConnectionManager = cm;
  return { __esModule: true, default: cm };
});

jest.mock('../SyncService', () => ({
  __esModule: true,
  SyncService: {
    getInstance: () => ({ initiateSync: jest.fn().mockResolvedValue(undefined) }),
  },
}));

// derive* are mocked so the participant key is deterministic ('pk') and the
// test never touches the real interactions repo.
jest.mock('../../database/repositories/interactions', () => ({
  createInteraction: jest.fn().mockResolvedValue(undefined),
  deriveScopeFromParticipants: jest.fn().mockReturnValue('private'),
  deriveParticipantKey: jest.fn().mockReturnValue('pk'),
}));

jest.mock('../../database/repositories/conversation_messages', () => ({
  messageExists: jest.fn().mockResolvedValue(false),
  createConversationMessage: jest.fn().mockResolvedValue(undefined),
  updateConversationMessage: jest.fn().mockResolvedValue(undefined),
  getConversationMessage: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../database/repositories/entities', () => ({
  getEntity: jest.fn(),
  getAllEntities: jest.fn().mockResolvedValue([]),
  setEntityMuted: jest.fn().mockResolvedValue(undefined),
  setEntityDisabled: jest.fn().mockResolvedValue(undefined),
  getDisabledEntityIds: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../cloud/CloudSessionService', () => ({
  cloudSessionService: {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue('idle'),
    isPurging: jest.fn().mockReturnValue(false),
  },
  default: {},
}));

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

function seedSession(svc: any): void {
  svc.sessions.set('ix-1', {
    interactionId: 'ix-1',
    interaction: null,
    participantIds: ['user', 'claire'],
    ownEntityId: 'user',
    connections: new Map([
      ['claire', { connectionId: 'entity-claire', status: 'active' }],
      ['user', { connectionId: 'entity-user', status: 'active' }],
    ]),
    pendingTranscriptions: new Map(),
  });
}

const incomingUtteranceEvent = {
  event_type: 'ENTITY_UTTERANCE',
  status: 'NEW',
  event_id: 'evt-1',
  entity_id: 'claire',
  payload: {
    message_id: 'engine-m-1',
    entity_id: 'claire',
    content: 'Hello there',
    audio: null,
  },
};

describe('EntitySessionService incoming-message entity gate (Q8/A5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();
  });

  it('stores the incoming message for a NON-disabled partner (mute is UI-only)', async () => {
    (getEntity as jest.Mock).mockResolvedValue({
      id: 'claire',
      alias: 'Claire',
      character_profile_id: 'p1',
      is_muted: 1, // muted — must NOT drop the message
      is_disabled: 0,
    });

    const svc = EntitySessionService.getInstance();
    seedSession(svc as any);

    await (svc as any).handleEntityEvent('claire', incomingUtteranceEvent);

    // Muted partner: message is STILL stored (badge suppression moved to the
    // UI layer, O10 — the service no longer bumps or suppresses any counter).
    expect(createConversationMessage).toHaveBeenCalled();
  });

  it('drops the incoming message from a DISABLED partner entity', async () => {
    (getEntity as jest.Mock).mockResolvedValue({
      id: 'claire',
      alias: 'Claire',
      character_profile_id: 'p1',
      is_muted: 0,
      is_disabled: 1,
    });

    const svc = EntitySessionService.getInstance();
    seedSession(svc as any);

    await (svc as any).handleEntityEvent('claire', incomingUtteranceEvent);

    // Disabled partner (defense-in-depth): the message is DROPPED and never
    // reaches the database.
    expect(createConversationMessage).not.toHaveBeenCalled();
  });

  it('drops the incoming message when the partner entity cannot be resolved (unknown)', async () => {
    (getEntity as jest.Mock).mockResolvedValue(null);

    const svc = EntitySessionService.getInstance();
    seedSession(svc as any);

    await (svc as any).handleEntityEvent('claire', incomingUtteranceEvent);

    // No entity record → treat as not disabled, keep the message flowing (the
    // primary enforcement is engine-side INIT rejection).
    expect(createConversationMessage).toHaveBeenCalled();
  });
});