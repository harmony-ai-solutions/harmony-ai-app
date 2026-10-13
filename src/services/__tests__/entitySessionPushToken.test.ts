/**
 * EntitySessionService — INIT_ENTITY `push_token` wiring (plan 7-12 §5, step 6).
 *
 * The push token rides INIT_ENTITY for DIRECT engine sessions only (the engine
 * registers it in `device_push_tokens`). Sessions routed through the cloud
 * conduct proxy MUST NOT receive it — the token goes only to the engine the app
 * holds a direct session with (fence).
 */

import { EntitySessionService, isEngineTargetedSession } from '../EntitySessionService';
import { pushTokenStore } from '../notifications/PushTokenStore';
import { EventEmitter } from 'eventemitter3';

let mockConnectionManager: EventEmitter & {
  isConnected: jest.Mock;
  createConnection: jest.Mock;
  sendEvent: jest.Mock;
  disconnectConnection: jest.Mock;
  getConnection: jest.Mock;
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
  cm.getConnection = jest.fn().mockReturnValue(null);
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

jest.mock('../../services/engine/repositories/interactions', () => ({
  createInteraction: jest.fn().mockResolvedValue(undefined),
  getSyncedReplyMode: jest.fn().mockResolvedValue('realistic'),
  deriveScopeFromParticipants: jest.fn().mockImplementation((p: string[]) => (p.length <= 1 ? 'world' : 'private')),
  deriveParticipantKey: jest.fn().mockImplementation((participants: string[], entityId: string) => {
    const partner = participants.find((id: string) => id !== entityId);
    if (!partner) return '';
    return entityId < partner ? `${entityId}+${partner}` : `${partner}+${entityId}`;
  }),
}));

jest.mock('../../services/engine/repositories/conversation_messages', () => ({
  messageExists: jest.fn(),
  createConversationMessage: jest.fn(),
  updateConversationMessage: jest.fn(),
  getConversationMessage: jest.fn(),
}));

jest.mock('../../services/engine/repositories/entities', () => ({
  getEntity: jest.fn().mockResolvedValue(null),
}));

import ConnectionStateManager from '../ConnectionStateManager';

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

/** The INIT_ENTITY payload of the most recent sendEvent call. */
function lastInitEntityPayload(): any {
  const calls = (mockConnectionManager.sendEvent as jest.Mock).mock.calls;
  const init = [...calls].reverse().find(c => c[1]?.event_type === 'INIT_ENTITY');
  return init?.[1]?.payload;
}

describe('isEngineTargetedSession', () => {
  it('accepts local/LAN engine connections', () => {
    expect(isEngineTargetedSession({ mode: 'insecure-ssl', url: 'wss://10.0.2.2:28443/events' })).toBe(true);
    expect(isEngineTargetedSession({ mode: 'unencrypted', url: 'ws://127.0.0.1:28080/events' })).toBe(true);
  });

  it('rejects the cloud conduct-proxy path', () => {
    expect(isEngineTargetedSession({ mode: 'cloud', url: 'wss://beta.connect.soulbits.app/ws/worker' })).toBe(false);
    // Belt: mode is not 'cloud' but the URL is the proxy prefix.
    expect(
      isEngineTargetedSession({ mode: 'secure', url: 'wss://beta.connect.soulbits.app/ws/worker' }),
    ).toBe(false);
  });

  it('rejects a null/undefined connection', () => {
    expect(isEngineTargetedSession(null)).toBe(false);
    expect(isEngineTargetedSession(undefined)).toBe(false);
  });
});

describe('EntitySessionService INIT_ENTITY push_token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ConnectionStateManager.getCurrentSource as jest.Mock).mockResolvedValue('selfhosted');
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.createConnection.mockResolvedValue(undefined);
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    mockConnectionManager.getConnection.mockReturnValue({ mode: 'insecure-ssl', url: 'wss://10.0.2.2:28443/events' });
    pushTokenStore.reset();
    resetSingleton();
  });

  afterEach(() => pushTokenStore.reset());

  it('includes push_token for a direct engine session', async () => {
    pushTokenStore.setPushToken('apns-token-123');
    const svc = EntitySessionService.getInstance();

    await svc.startInteractionSession('user', ['claire', 'user']);

    const payload = lastInitEntityPayload();
    expect(payload.push_token).toBe('apns-token-123');
    expect(payload.device_platform).toBeDefined();
  });

  it('omits push_token when no token is available', async () => {
    const svc = EntitySessionService.getInstance();
    await svc.startInteractionSession('user', ['claire', 'user']);
    expect(lastInitEntityPayload()).not.toHaveProperty('push_token');
  });

  it('omits push_token for a cloud conduct-proxy session', async () => {
    pushTokenStore.setPushToken('apns-token-123');
    (ConnectionStateManager.getCurrentSource as jest.Mock).mockResolvedValue('cloud');
    const svc = EntitySessionService.getInstance();

    await svc.startInteractionSession('user', ['claire', 'user']);

    const payload = lastInitEntityPayload();
    expect(payload).toBeDefined();
    expect(payload).not.toHaveProperty('push_token');
  });

  it('includes push_token on the reconnect (sendInitEntityForEntity) path for a direct engine', async () => {
    pushTokenStore.setPushToken('rotated-token');
    const svc = EntitySessionService.getInstance() as any;
    mockConnectionManager.getConnection.mockReturnValue({ mode: 'insecure-ssl', url: 'wss://10.0.2.2:28443/events' });

    const session = {
      participantIds: ['claire', 'user'],
      ownEntityId: 'user',
      replyMode: 'realistic',
      connections: new Map([['claire', { connectionId: 'entity-claire', status: 'active' }]]),
    };
    await svc.sendInitEntityForEntity('claire', session);

    expect(lastInitEntityPayload().push_token).toBe('rotated-token');
  });

  it('omits push_token on the reconnect path for a cloud-proxy connection', async () => {
    pushTokenStore.setPushToken('rotated-token');
    const svc = EntitySessionService.getInstance() as any;
    mockConnectionManager.getConnection.mockReturnValue({ mode: 'cloud', url: 'wss://beta.connect.soulbits.app/ws/worker' });

    const session = {
      participantIds: ['claire', 'user'],
      ownEntityId: 'user',
      replyMode: 'realistic',
      connections: new Map([['claire', { connectionId: 'entity-claire', status: 'active' }]]),
    };
    await svc.sendInitEntityForEntity('claire', session);

    expect(lastInitEntityPayload()).not.toHaveProperty('push_token');
  });
});
