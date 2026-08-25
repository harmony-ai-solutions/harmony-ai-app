/**
 * EntitySessionService — scenario generation dispatch + response handlers (§2-4).
 *
 * Verifies:
 *  - generateGreeting sends GENERATE_GREETING with the exact payload shape
 *    (entity_id, target_entity_id, interaction_id, mode, guided).
 *  - random mode omits `guided`.
 *  - resolves { greeting, interactionId } on SUCCESS (matched by event_id).
 *  - rejects on ERROR.
 *  - startNewScenario sends START_NEW_SCENARIO (no interaction_id in payload).
 *  - startNewScenario SUCCESS re-keys the session to the brand-new interaction.
 */
import { EntitySessionService } from '../EntitySessionService';
import type { InteractionSession } from '../EntitySessionService';
import { EventEmitter } from 'eventemitter3';

let mockConnectionManager: any;
let mockInitiateSync: jest.Mock;

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

jest.mock('../SyncService', () => {
  mockInitiateSync = jest.fn().mockResolvedValue(undefined);
  return {
    __esModule: true,
    SyncService: {
      getInstance: () => ({ initiateSync: mockInitiateSync, syncAndWait: jest.fn().mockResolvedValue(undefined) }),
    },
  };
});

jest.mock('../../database/repositories/interactions', () => ({
  createInteraction: jest.fn().mockResolvedValue(undefined),
  deriveScopeFromParticipants: jest.fn().mockReturnValue('one_on_one'),
  deriveParticipantKey: jest.fn().mockReturnValue('pk'),
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

function makeSession(interactionId = 'ix-scenario'): InteractionSession {
  return {
    interactionId,
    interaction: null,
    participantIds: ['char-entity', 'user-entity'],
    ownEntityId: 'user-entity',
    connections: new Map([
      ['char-entity', { connectionId: 'entity-char-x', status: 'active' as const }],
      ['user-entity', { connectionId: 'entity-user-x', status: 'active' as const }],
    ]),
    pendingTranscriptions: new Map(),
    replyMode: 'realistic',
  };
}

const guidedInputs = {
  mood: ['Warm', 'Mysterious'],
  setting: 'Cafe at midnight',
  relationship: 'old-friends',
  timeOfDay: 'Night',
  whoFirst: 'user' as const,
  premise: 'We meet again',
};

function successResponse(eventId: string, eventType: string, payload: Record<string, unknown>) {
  return { event_type: eventType, status: 'SUCCESS', event_id: eventId, payload };
}

describe('EntitySessionService — generateGreeting (§2-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitiateSync.mockClear();
    resetSingleton();
  });

  it('sends GENERATE_GREETING with the directed payload shape', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const pending = svc.generateGreeting({
      entityId: 'char-entity',
      targetEntityId: 'user-entity',
      interactionId: session.interactionId,
      mode: 'directed',
      guided: guidedInputs,
    });

    // Flush the async dispatch (await sendEvent).
    await Promise.resolve();
    expect(mockConnectionManager.sendEvent).toHaveBeenCalledTimes(1);
    const [connectionId, event] = mockConnectionManager.sendEvent.mock.calls[0];
    expect(connectionId).toBe('entity-char-x');
    expect(event.event_type).toBe('GENERATE_GREETING');
    expect(event.status).toBe('NEW');
    expect(event.payload).toEqual({
      entity_id: 'char-entity',
      target_entity_id: 'user-entity',
      interaction_id: session.interactionId,
      mode: 'directed',
      guided: guidedInputs,
    });

    // Resolve via the response handler (matched by event_id).
    (svc as any).handleGenerationResponse(
      'char-entity',
      successResponse(event.event_id, 'GENERATE_GREETING', {
        greeting: 'Hello there!',
        interaction_id: session.interactionId,
      }),
      session,
      session.interactionId,
    );
    await expect(pending).resolves.toEqual({
      greeting: 'Hello there!',
      interactionId: session.interactionId,
    });
  });

  it('random mode omits guided', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const pending = svc.generateGreeting({
      entityId: 'char-entity',
      targetEntityId: 'user-entity',
      interactionId: session.interactionId,
      mode: 'random',
    });

    await Promise.resolve();
    const [, event] = mockConnectionManager.sendEvent.mock.calls[0];
    expect(event.payload.mode).toBe('random');
    expect(event.payload).not.toHaveProperty('guided');

    (svc as any).handleGenerationResponse(
      'char-entity',
      successResponse(event.event_id, 'GENERATE_GREETING', {
        greeting: 'Random hello',
        interaction_id: session.interactionId,
      }),
      session,
      session.interactionId,
    );
    await expect(pending).resolves.toEqual({
      greeting: 'Random hello',
      interactionId: session.interactionId,
    });
  });

  it('rejects on ERROR status', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const pending = svc.generateGreeting({
      entityId: 'char-entity',
      targetEntityId: 'user-entity',
      interactionId: session.interactionId,
      mode: 'random',
    });

    await Promise.resolve();
    const [, event] = mockConnectionManager.sendEvent.mock.calls[0];
    (svc as any).handleGenerationResponse(
      'char-entity',
      { event_type: 'GENERATE_GREETING', status: 'ERROR', event_id: event.event_id, payload: { error: 'greeting-not-only-message' } },
      session,
      session.interactionId,
    );
    await expect(pending).rejects.toThrow('greeting-not-only-message');
  });

  it('rejects when no active session exists', async () => {
    const svc = EntitySessionService.getInstance();
    await expect(
      svc.generateGreeting({
        entityId: 'char-entity',
        targetEntityId: 'user-entity',
        interactionId: 'missing-ix',
        mode: 'random',
      }),
    ).rejects.toThrow('No active session');
  });
});

describe('EntitySessionService — startNewScenario (§2-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitiateSync.mockClear();
    resetSingleton();
  });

  it('sends START_NEW_SCENARIO without interaction_id and resolves with the brand-new id', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const pending = svc.startNewScenario({
      entityId: 'char-entity',
      targetEntityId: 'user-entity',
      mode: 'directed',
      guided: guidedInputs,
    });

    await Promise.resolve();
    expect(mockConnectionManager.sendEvent).toHaveBeenCalledTimes(1);
    const [, event] = mockConnectionManager.sendEvent.mock.calls[0];
    expect(event.event_type).toBe('START_NEW_SCENARIO');
    expect(event.payload).toEqual({
      entity_id: 'char-entity',
      target_entity_id: 'user-entity',
      mode: 'directed',
      guided: guidedInputs,
    });
    expect(event.payload).not.toHaveProperty('interaction_id');

    (svc as any).handleGenerationResponse(
      'char-entity',
      successResponse(event.event_id, 'START_NEW_SCENARIO', {
        greeting: 'A brand-new opening',
        interaction_id: 'ix-brand-new',
      }),
      session,
      session.interactionId,
    );

    await expect(pending).resolves.toEqual({
      greeting: 'A brand-new opening',
      interactionId: 'ix-brand-new',
    });
  });

  it('re-keys the session map to the brand-new interaction id on SUCCESS', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const pending = svc.startNewScenario({
      entityId: 'char-entity',
      targetEntityId: 'user-entity',
      mode: 'random',
    });
    await Promise.resolve();
    const [, event] = mockConnectionManager.sendEvent.mock.calls[0];

    (svc as any).handleGenerationResponse(
      'char-entity',
      successResponse(event.event_id, 'START_NEW_SCENARIO', {
        greeting: 'Restarted',
        interaction_id: 'ix-brand-new',
      }),
      session,
      session.interactionId,
    );
    await pending;

    expect(session.interactionId).toBe('ix-brand-new');
    expect((svc as any).sessions.has('ix-brand-new')).toBe(true);
    expect((svc as any).sessions.has('ix-scenario')).toBe(false);
  });

  it('random mode omits guided for startNewScenario', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const pending = svc.startNewScenario({
      entityId: 'char-entity',
      targetEntityId: 'user-entity',
      mode: 'random',
    });
    await Promise.resolve();
    const [, event] = mockConnectionManager.sendEvent.mock.calls[0];
    expect(event.payload).not.toHaveProperty('guided');

    (svc as any).handleGenerationResponse(
      'char-entity',
      successResponse(event.event_id, 'START_NEW_SCENARIO', {
        greeting: 'Random restart',
        interaction_id: 'ix-brand-new',
      }),
      session,
      session.interactionId,
    );
    await expect(pending).resolves.toEqual({
      greeting: 'Random restart',
      interactionId: 'ix-brand-new',
    });
  });

  it('rejects when no session exists for the entity', async () => {
    const svc = EntitySessionService.getInstance();
    await expect(
      svc.startNewScenario({
        entityId: 'char-entity',
        targetEntityId: 'user-entity',
        mode: 'random',
      }),
    ).rejects.toThrow('No active session');
  });
});
