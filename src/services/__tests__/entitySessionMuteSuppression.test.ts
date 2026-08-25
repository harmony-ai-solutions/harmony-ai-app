/**
 * EntitySessionService mute suppression (F11/O10).
 *
 * Muted conversations stay visible in the chat list but must NEVER bump the
 * unread badge when a message arrives. This pins the guard in
 * `handleIncomingMessage`: the badge increment is skipped for muted keys while
 * the incoming message is still stored (conversation stays visible).
 */

import { EntitySessionService } from '../EntitySessionService';
import { EventEmitter } from 'eventemitter3';
import { getChatConversationSettings, incrementConversationUnread } from '../../database/repositories/chatConversationSettings';
import { createConversationMessage } from '../../database/repositories/conversation_messages';
import { SyncService } from '../SyncService';

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

jest.mock('../../database/repositories/chatConversationSettings', () => ({
  getChatConversationSettings: jest.fn(),
  incrementConversationUnread: jest.fn().mockResolvedValue(undefined),
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

describe('EntitySessionService mute suppression (F11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();
  });

  it('increments the unread badge for a NON-muted conversation', async () => {
    (getChatConversationSettings as jest.Mock).mockResolvedValue({
      participantKey: 'pk',
      entityId: 'claire',
      pinned: false,
      archived: false,
      muted: false,
      disabled: false,
      unreadCount: 0,
    });

    const svc = EntitySessionService.getInstance();
    seedSession(svc as any);

    await (svc as any).handleEntityEvent('claire', incomingUtteranceEvent);

    expect(incrementConversationUnread).toHaveBeenCalledWith('pk', 'claire');
    // The message is still stored — the conversation stays visible.
    expect(createConversationMessage).toHaveBeenCalled();
  });

  it('suppresses the unread-badge increment for a MUTED conversation', async () => {
    (getChatConversationSettings as jest.Mock).mockResolvedValue({
      participantKey: 'pk',
      entityId: 'claire',
      pinned: false,
      archived: false,
      muted: true,
      disabled: false,
      unreadCount: 0,
    });

    const svc = EntitySessionService.getInstance();
    seedSession(svc as any);

    await (svc as any).handleEntityEvent('claire', incomingUtteranceEvent);

    // Muted ⇒ no badge bump…
    expect(incrementConversationUnread).not.toHaveBeenCalled();
    // …but the conversation stays visible: the message is still stored and
    // the list preview can refresh.
    expect(createConversationMessage).toHaveBeenCalled();
  });

  it('still suppresses the increment when the conversation is open on screen', async () => {
    (getChatConversationSettings as jest.Mock).mockResolvedValue({
      participantKey: 'pk',
      entityId: 'claire',
      pinned: false,
      archived: false,
      muted: false,
      disabled: false,
      unreadCount: 0,
    });

    const svc = EntitySessionService.getInstance();
    seedSession(svc as any);
    svc.registerOpenConversation('pk');

    await (svc as any).handleEntityEvent('claire', incomingUtteranceEvent);

    expect(incrementConversationUnread).not.toHaveBeenCalled();
    expect(createConversationMessage).toHaveBeenCalled();
  });
});