/**
 * moduleTestSessionService — eventserver debug session for module test blocks
 * (persona-modules 2-2 / 2-3 rework).
 *
 * The app must NOT call the engine's management server over HTTP (not
 * cloud-reachable). Instead the test blocks open a single transient WebSocket
 * connection with the engine's `debug` device type and drive the EXISTING STT /
 * TTS events over it. This service is built on top of the EXISTING connection
 * primitives (ConnectionManager) but opens its OWN connection id so a test
 * session can never read or consume a live chat session's state.
 *
 * Connection layer is MOCKED here with contract-shaped fixtures; NO live engine
 * is ever touched. The mock's `sendEvent` auto-emits the engine's pinned
 * responses on the socket so the full send → awaitEvent round-trip is exercised
 * through the real service logic.
 */

import { openTestSession, runTest, ModuleTestSessionError } from '../moduleTestSessionService';

import { EventEmitter } from 'eventemitter3';

// ── Mutable fixture knobs read by the ConnectionManager mock's sendEvent ──────
let mockSttTranscript = 'hello world';
let mockTtsAudio = 'QUJDRA==';
let mockTtsAudioType = 'audio/mpeg';
let mockSttErrorMessage: string | null = null;

const mockSockets = new Map<string, EventEmitter & {
  isConnected: jest.Mock;
  sendEvent: jest.Mock;
  disconnect: jest.Mock;
  removeAllListeners: jest.Mock;
}>();

let mockConnectionManager: any;

jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn().mockResolvedValue('test-device'),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../ConnectionStateManager', () => ({
  __esModule: true,
  default: {
    getCurrentSource: jest.fn().mockResolvedValue('selfhosted'),
    getSecurityMode: jest.fn().mockResolvedValue('secure'),
    getWSSUrl: jest.fn().mockResolvedValue('wss://engine.local:28443/events'),
    getWSUrl: jest.fn().mockResolvedValue('ws://engine.local:28080/events'),
  },
}));

jest.mock('../../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  const cm: any = {
    createConnection: jest.fn(async (id, type, url, mode, entityId) => {
      const socket: any = new EE();
      socket.isConnected = jest.fn(() => true);
      socket.sendEvent = jest.fn(async () => {});
      socket.disconnect = jest.fn();
      socket.removeAllListeners = jest.fn();
      mockSockets.set(id, socket);
    }),
    getConnection: jest.fn((id: string) => {
      const socket = mockSockets.get(id);
      return socket
        ? { id, type: 'entity', entityId: undefined, connection: socket, mode: 'secure', url: '', status: 'connected' }
        : null;
    }),
    isConnected: jest.fn((id: string) => mockSockets.has(id)),
    sendEvent: jest.fn(async (connectionId: string, event: any) => {
      const socket = mockSockets.get(connectionId);
      if (!socket) return;
      if (event.event_type === 'INIT_ENTITY') {
        if (mockSttErrorMessage) {
          socket.emit('event', {
            event_id: event.event_id,
            event_type: 'INIT_ENTITY',
            status: 'ERROR',
            payload: mockSttErrorMessage,
          });
        } else {
          socket.emit('event', {
            event_id: event.event_id,
            event_type: 'INIT_ENTITY',
            status: 'SUCCESS',
            payload: { session_id: 'sess-1', interaction_id: 'int-1', capabilities: ['chat'] },
          });
        }
      } else if (event.event_type === 'STT_INPUT_AUDIO') {
        const messageId = event.payload?.message_id;
        if (mockSttErrorMessage) {
          socket.emit('event', {
            event_id: `resp-${messageId}`,
            event_type: 'STT_OUTPUT_TEXT',
            status: 'ERROR',
            payload: mockSttErrorMessage,
          });
        } else {
          socket.emit('event', {
            event_id: `resp-${messageId}`,
            event_type: 'STT_OUTPUT_TEXT',
            status: 'NEW',
            payload: { message_id: messageId, entity_id: '', content: mockSttTranscript },
          });
        }
      } else if (event.event_type === 'TTS_GENERATE_SPEECH') {
        socket.emit('event', {
          event_id: 'tts-resp',
          event_type: 'ENTITY_UTTERANCE',
          status: 'NEW',
          payload: {
            message_id: 'tts-msg',
            entity_id: '',
            content: event.payload?.utterance?.content || '',
            audio: mockTtsAudio,
            audio_type: mockTtsAudioType,
          },
        });
      }
    }),
    disconnectConnection: jest.fn((id: string) => {
      mockSockets.delete(id);
    }),
  };
  mockConnectionManager = cm;
  return { __esModule: true, default: cm };
});

import ConnectionManager from '../../connection/ConnectionManager';
import ConnectionStateManager from '../../ConnectionStateManager';

const mockCreateConnection = (ConnectionManager.createConnection as unknown) as jest.Mock;
const mockSendEvent = (ConnectionManager.sendEvent as unknown) as jest.Mock;
const mockDisconnect = (ConnectionManager.disconnectConnection as unknown) as jest.Mock;

function initEvents() {
  // Note the service attaches the socket listener BEFORE sending INIT, so the
  // mock sendEvent auto-emit lands in the service's pending queue and the INIT
  // await resolves without an explicit socket handle in the test.
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSockets.clear();
  mockSttTranscript = 'hello world';
  mockTtsAudio = 'QUJDRA==';
  mockTtsAudioType = 'audio/mpeg';
  mockSttErrorMessage = null;
});

describe('openTestSession — connection + INIT_ENTITY device_type debug', () => {
  it('opens a unique entity connection and INITs with device_type "debug"', async () => {
    const session = await openTestSession('claire');

    // A connection is created with a unique debug-test id (never collides with
    // a live `entity-...` chat connection).
    expect(mockCreateConnection).toHaveBeenCalledTimes(1);
    const [connectionId, type] = mockCreateConnection.mock.calls[0];
    expect(type).toBe('entity');
    expect(connectionId).toMatch(/^debug-module-test-.*-/);

    // The INIT_ENTITY payload carries the pinned `debug` device type.
    const initCall = mockSendEvent.mock.calls.find(([, ev]: [string, any]) => ev.event_type === 'INIT_ENTITY');
    expect(initCall).toBeTruthy();
    const initEvent = initCall[1];
    expect(initEvent.payload.entity_id).toBe('claire');
    expect(initEvent.payload.participant_ids).toEqual(['claire']);
    expect(initEvent.payload.device_type).toBe('debug');
    expect(initEvent.payload.capabilities).toEqual(['chat']);
    expect(initEvent.payload.tts_output_type).toBe('binary');

    // The INIT SUCCESS response was awaited and the session is usable.
    expect(session.connectionId).toBe(connectionId);

    await session.disconnect();
    expect(mockDisconnect).toHaveBeenCalledWith(connectionId);
  });

  it('derives the standalone (wss secure) connection url + mode', async () => {
    await openTestSession('claire');
    const [, , url, mode] = mockCreateConnection.mock.calls[0];
    expect(url).toBe('wss://engine.local:28443/events');
    expect(mode).toBe('secure');
  });

  it('throws a ModuleTestSessionError when the engine INIT_ENTITY is rejected', async () => {
    mockSttErrorMessage = 'entity_disabled';
    await expect(openTestSession('disabled-ai')).rejects.toBeInstanceOf(ModuleTestSessionError);
  });
});

describe('runTest — event round-trip + guaranteed teardown', () => {
  it('resolves the STT_OUTPUT_TEXT transcript for a sent STT_INPUT_AUDIO event', async () => {
    const result = await runTest('claire', async ({ sendEvent, awaitEvent }) => {
      const messageId = 'msg-123';
      await sendEvent({
        event_type: 'STT_INPUT_AUDIO',
        payload: {
          message_id: messageId,
          audio_data: { audio_bytes: 'QUJDRA==', channels: 1, bit_depth: 16, sample_rate: 16000 },
          result_mode: 'return',
        },
      });
      const resp = await awaitEvent('STT_OUTPUT_TEXT', {
        predicate: (e: any) => e.payload?.message_id === messageId,
      });
      return resp.payload.content;
    });

    expect(result).toBe('hello world');

    // The STT_INPUT_AUDIO event shape matches the pinned contract.
    const sttCall = mockSendEvent.mock.calls.find(([, ev]: [string, any]) => ev.event_type === 'STT_INPUT_AUDIO');
    expect(sttCall[1].payload).toEqual({
      message_id: 'msg-123',
      audio_data: { audio_bytes: 'QUJDRA==', channels: 1, bit_depth: 16, sample_rate: 16000 },
      result_mode: 'return',
    });
  });

  it('resolves the ENTITY_UTTERANCE inline audio for a sent TTS_GENERATE_SPEECH binary request', async () => {
    const result = await runTest('ai-entity-1', async ({ sendEvent, awaitEvent }) => {
      await sendEvent({
        event_type: 'TTS_GENERATE_SPEECH',
        payload: {
          utterance: { type: 'UTTERANCE_COMBINED', content: 'Hello there', entity_id: 'ai-entity-1' },
          tts_output_type: 'binary',
        },
      });
      const resp = await awaitEvent('ENTITY_UTTERANCE', {
        predicate: (e: any) => e.payload?.audio,
      });
      return resp.payload;
    });

    expect(result.audio).toBe('QUJDRA==');
    expect(result.audio_type).toBe('audio/mpeg');
  });

  it('guarantees a disconnect even when fn throws', async () => {
    await expect(
      runTest('claire', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('guarantees a disconnect on the happy path too', async () => {
    await runTest('claire', async () => undefined);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
