/**
 * EntitySessionService — rapid-switch stress ("monkey") test.
 *
 * Drives alternating Marcella↔Claire session start/stop cycles with RANDOMIZED
 * artificial delays on BOTH sides:
 *  - client: varied flush windows between operations (mimics UI switching speed).
 *  - backend: the simulated INIT_ENTITY SUCCESS response is delivered after a
 *    randomized 0–40 ms delay — including 0 ms, which reproduces the on-device
 *    race where the partner's SUCCESS arrives BEFORE startInteractionSession
 *    finished registering the session (→ handleInitEntityResponse ran with
 *    interactionSession === null → connection never marked 'active' → the chat
 *    stalled in "connecting" until the 15s init retry).
 *
 * Deterministic via a seeded PRNG so any failure is reproducible. Invariants:
 *  (1) every start reaches EXACTLY ONE session:started — validates both the
 *      early-SUCCESS strand fix (every start completes) and the dedup guard
 *      (no start emits twice);
 *  (2) no connection leaks (every created connection id is disconnected);
 *  (3) no throw under churn;
 *  (4) connection ids stay participant-set-scoped.
 */
import { EventEmitter } from 'eventemitter3';
import { EntitySessionService } from '../EntitySessionService';
import { flushMicrotasks } from '../websocket/__tests__/helpers/MockWebSocket';

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
  cloudSessionService: { connect: jest.fn(), disconnect: jest.fn(), getStatus: jest.fn().mockReturnValue('idle'), isPurging: jest.fn().mockReturnValue(false) },
  default: {},
}));

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

// Seeded PRNG (mulberry32) — deterministic "monkey" timing for reproducibility.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canonicalFor = (pids: string[]) => 'canon-' + [...pids].sort().join('-');

describe('EntitySessionService rapid-switch stress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();
  });

  /**
   * Advance fake timers in small steps, draining microtasks between steps so
   * interleaved setTimeout-backed backend responses and async handlers settle.
   */
  async function flush(totalMs: number): Promise<void> {
    const step = 5;
    for (let elapsed = 0; elapsed < totalMs; elapsed += step) {
      jest.advanceTimersByTime(step);
      await flushMicrotasks();
    }
  }

  it('every start reaches exactly one session:started, with no leaks or throws, across 40 rapid switches', async () => {
    jest.useFakeTimers();
    try {
      const rng = makeRng(20260805);
      const svc = EntitySessionService.getInstance();

      const createdIds: string[] = [];
      const disconnectedIds: string[] = [];
      mockConnectionManager.createConnection.mockImplementation(async (id: string) => {
        createdIds.push(id);
      });
      // Simulated backend. ~50% of responses are delivered SYNCHRONOUSLY inside
      // sendEvent (i.e. during startInteractionSession's parallel connect/send
      // loop, BEFORE the old code registered the session in this.sessions) — this
      // is the real on-device race: the SUCCESS arrives with no session to update
      // → the connection is never marked 'active' → the chat stalls in
      // "connecting" until the 15s init retry. The rest use a randomized timer.
      mockConnectionManager.sendEvent.mockImplementation(async (connId: string, event: any) => {
        if (event.event_type === 'INIT_ENTITY') {
          const entityId = event.payload.entity_id;
          const pids: string[] = event.payload.participant_ids;
          const resp = () => {
            mockConnectionManager.emit('event:entity', entityId, {
              event_id: `r${Math.floor(rng() * 1e9)}`,
              event_type: 'INIT_ENTITY',
              status: 'SUCCESS',
              payload: {
                session_id: `sess-${entityId}`,
                interaction_id: canonicalFor(pids),
              },
            });
          };
          if (rng() < 0.5) {
            resp(); // synchronous — fires during the Promise.all (the race window)
          } else {
            setTimeout(resp, Math.floor(rng() * 40));
          }
        }
        return undefined;
      });
      mockConnectionManager.disconnectConnection.mockImplementation((id: string) => {
        disconnectedIds.push(id);
      });
      mockConnectionManager.isConnected.mockReturnValue(true);

      let startedEventCount = 0;
      svc.on('session:started', () => { startedEventCount += 1; });

      const chats = [['Marcella', 'user'], ['claire', 'user']];
      let handle: { session: any } | null = null;
      const startCount = 40;

      for (let i = 0; i < startCount; i++) {
        // Stop the previous session before starting a new one (mimics the app),
        // after a short randomized pause so backend responses interleave.
        if (handle) {
          await flush(5 + Math.floor(rng() * 15));
          await svc.stopInteractionSession(handle.session.interactionId);
          handle = null;
        }
        const chat = chats[i % 2];
        const session = await svc.startInteractionSession('user', chat as string[], 'realistic');
        handle = { session };
        // Long enough that both participants' SUCCESS (≤40 ms) land and the
        // session reaches all-active → session:started.
        await flush(50 + Math.floor(rng() * 30));
      }
      if (handle) {
        await svc.stopInteractionSession(handle.session.interactionId);
      }
      await flush(200);

      // (1) Exactly one session:started per start — proves no strand (every
      //     start completed despite 0 ms backend responses) AND no double-emit.
      expect(startedEventCount).toBe(startCount);

      // (2) No leaks: every created connection id was eventually disconnected
      //     (by an explicit stop or a same-slot supersede).
      for (const id of createdIds) {
        expect(disconnectedIds).toContain(id);
      }

      // (3) No leftover sessions.
      expect((svc as any).sessions.size).toBe(0);

      // (4) Connection ids stayed participant-set-scoped (no bare 'entity-user').
      for (const id of createdIds) {
        expect(id).not.toBe('entity-user');
        expect(id).toMatch(/^entity-(Marcella|claire|user)-/);
      }
    } finally {
      jest.useRealTimers();
    }
  });
});
