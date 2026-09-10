/**
 * EntitySessionContext — terminal-failure retention + retry-scheduler fix
 * (4-3 / D36 + review-4 wiring fix).
 *
 * Three behaviors are pinned here:
 *
 * 1. `handleSessionError` KEEPS flagged entries (the old code deleted them —
 *    the second silent-drop site), so `isSessionActive` can distinguish
 *    "absent" from "failed" and the UI can observe the terminal state.
 *
 * 2. The 15s initialization timer, on a GONE or FAILED session, schedules one
 *    context retry (existing 3-attempt budget) instead of silently stopping —
 *    the dead-end behind the eternal "Connecting…" dot.
 *
 * 3. Retry EXHAUSTION emits `session:error` with the REAL interactionId (and
 *    flags that entry `failed`). The legacy code emitted with the
 *    participant-key retry-map key, which ChatDetail's interactionId-matching
 *    listener never matched — the terminal error never surfaced.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { EntitySessionProvider, useEntitySession } from '../EntitySessionContext';
import EntitySessionService from '../../services/EntitySessionService';

jest.mock('../../services/EntitySessionService', () => {
  const { EventEmitter } = require('eventemitter3');
  const svc: any = new EventEmitter();
  // Delegating spy: assertions can inspect emissions while listeners still
  // receive them (the real service is an EventEmitter).
  const realEmit = svc.emit.bind(svc);
  svc.emit = jest.fn((...args: any[]) => realEmit(...args));
  svc.startInteractionSession = jest.fn();
  // Faithful stop: the real service emits session:stopped, which is what
  // removes the entry from the context's activeSessions.
  svc.stopInteractionSession = jest.fn(async (id: string) => {
    realEmit('session:stopped', id);
  });
  svc.closeAllSessions = jest.fn(async () => undefined);
  svc.sendTextMessage = jest.fn();
  return { __esModule: true, default: svc, EntitySessionService: svc };
});

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../SyncConnectionContext', () => ({
  useSyncConnection: () => ({ isConnected: true }),
}));

const serviceMock = EntitySessionService as any;

const wrapper = ({ children }: any) => (
  <EntitySessionProvider>{children}</EntitySessionProvider>
);

let sessionCounter = 0;
function makeNeverActiveSession(): any {
  sessionCounter += 1;
  return {
    interactionId: `temp-${sessionCounter}`,
    interaction: null,
    ownEntityId: 'user',
    participantIds: ['claire', 'user'],
    connections: new Map([
      ['claire', { connectionId: `entity-claire-pk`, status: 'connecting' }],
      ['user', { connectionId: `entity-user-pk`, status: 'connecting' }],
    ]),
    pendingTranscriptions: new Map(),
    initRetryCount: 0,
  };
}

describe('EntitySessionContext — terminal failure retention (4-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionCounter = 0;
    serviceMock.startInteractionSession.mockReset();
    serviceMock.stopInteractionSession.mockClear();
    serviceMock.emit.mockClear();
    serviceMock.removeAllListeners();
  });

  it('handleSessionError KEEPS the entry and flags it failed (site b of D36)', async () => {
    serviceMock.startInteractionSession.mockResolvedValueOnce(makeNeverActiveSession());

    const { result } = await renderHook(() => useEntitySession(), { wrapper });

    await act(async () => {
      await result.current.startInteractionSession('user', ['claire', 'user']);
    });
    expect(result.current.getInteractionSession('temp-1')).not.toBeNull();

    await act(async () => {
      serviceMock.emit('session:error', 'temp-1', 'entity_not_defined');
    });

    // Retained (old code deleted it) + flagged — one source of truth with the
    // service's failed marker.
    const flagged = result.current.getInteractionSession('temp-1');
    expect(flagged).not.toBeNull();
    expect(flagged?.failed).toMatchObject({ error: 'entity_not_defined' });
    // Verified safe-to-retain precondition: a flagged session is never active.
    expect(result.current.isSessionActive('temp-1')).toBe(false);
  });

  it('init timer on a GONE session schedules a context retry instead of silently stopping', async () => {
    jest.useFakeTimers();
    try {
      const session = makeNeverActiveSession();
      serviceMock.startInteractionSession.mockResolvedValue(session);

      const { result } = await renderHook(() => useEntitySession(), { wrapper });

      await act(async () => {
        await result.current.startInteractionSession('user', ['claire', 'user']);
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(1);

      // Simulate the service-side silent teardown that used to dead-end the
      // timer ("session no longer exists" → give up).
      await act(async () => {
        serviceMock.emit('session:stopped', session.interactionId);
      });

      // 15s init timer fires → schedules retry 1/3 (1000ms)…
      await act(async () => {
        jest.advanceTimersByTime(15000);
      });
      // …and the retry re-invokes start (old code stopped silently here).
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('init timer on a FAILED session schedules a context retry too (D36)', async () => {
    jest.useFakeTimers();
    try {
      const session = makeNeverActiveSession();
      serviceMock.startInteractionSession.mockResolvedValue(session);

      const { result } = await renderHook(() => useEntitySession(), { wrapper });

      await act(async () => {
        await result.current.startInteractionSession('user', ['claire', 'user']);
      });

      // The service flags the shared session object (INIT_ENTITY exhausted).
      session.failed = { error: 'entity_not_defined', at: Date.now() };
      await act(async () => {
        serviceMock.emit('session:error', session.interactionId, 'entity_not_defined');
      });

      await act(async () => {
        jest.advanceTimersByTime(15000);
      });
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      // The flagged session got its bounded context retry.
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('exhaustion emits session:error with the REAL interactionId and flags that entry (review-4 wiring fix)', async () => {
    jest.useFakeTimers();
    try {
      // Every (re)start "succeeds" but the connections never activate — the
      // 15s init timer keeps firing until the 3-attempt budget is exhausted.
      serviceMock.startInteractionSession.mockImplementation(async () => makeNeverActiveSession());

      const { result } = await renderHook(() => useEntitySession(), { wrapper });

      await act(async () => {
        await result.current.startInteractionSession('user', ['claire', 'user']);
      });

      // start #1 → timer → retry1 (1s) → start #2 → timer → retry2 (2s)
      // → start #3 → timer → retry3 (4s) → start #4 → timer → EXHAUSTION.
      await act(async () => { jest.advanceTimersByTime(15000); });
      await act(async () => { jest.advanceTimersByTime(1000); });
      await act(async () => { jest.advanceTimersByTime(15000); });
      await act(async () => { jest.advanceTimersByTime(2000); });
      await act(async () => { jest.advanceTimersByTime(15000); });
      await act(async () => { jest.advanceTimersByTime(4000); });
      await act(async () => { jest.advanceTimersByTime(15000); });

      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(4);

      // Emission keyed by the CURRENT session's interactionId…
      expect(serviceMock.emit).toHaveBeenCalledWith(
        'session:error',
        `temp-${sessionCounter}`,
        expect.stringContaining('Failed to initialize session after 3 attempts'),
      );
      // …and NEVER by the participant retry key (the wiring bug).
      expect(serviceMock.emit).not.toHaveBeenCalledWith(
        'session:error',
        'claire+user',
        expect.anything(),
      );

      // The interactionId-keyed entry carries the terminal failed marker.
      const flagged = result.current.getInteractionSession(`temp-${sessionCounter}`);
      expect(flagged?.failed).toMatchObject({
        error: expect.stringContaining('after 3 attempts'),
      });
      expect(result.current.isSessionActive(`temp-${sessionCounter}`)).toBe(false);

      // No infinite loop beyond the budget.
      await act(async () => { jest.advanceTimersByTime(30000); });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clearFailedSession stops and clears flagged entries for the participant set (bounded retention)', async () => {
    serviceMock.startInteractionSession.mockResolvedValueOnce(makeNeverActiveSession());

    const { result } = await renderHook(() => useEntitySession(), { wrapper });

    await act(async () => {
      await result.current.startInteractionSession('user', ['claire', 'user']);
    });
    await act(async () => {
      serviceMock.emit('session:error', 'temp-1', 'boom');
    });
    expect(result.current.getInteractionSession('temp-1')).not.toBeNull();

    await act(async () => {
      await result.current.clearFailedSession('user', ['claire', 'user']);
    });

    // The flagged entry (keyed by a service-temp id the screen never saw) was
    // stopped through the real teardown path and removed from state.
    expect(serviceMock.stopInteractionSession).toHaveBeenCalledWith('temp-1');
    expect(result.current.getInteractionSession('temp-1')).toBeNull();
  });

  it('a later session:started purges superseded flagged entries for the same participant set', async () => {
    serviceMock.startInteractionSession
      .mockResolvedValueOnce(makeNeverActiveSession()) // temp-1 → fails
      .mockResolvedValueOnce(makeNeverActiveSession()); // temp-2 → succeeds

    const { result } = await renderHook(() => useEntitySession(), { wrapper });

    await act(async () => {
      await result.current.startInteractionSession('user', ['claire', 'user']);
    });
    await act(async () => {
      serviceMock.emit('session:error', 'temp-1', 'boom');
    });
    expect(result.current.getInteractionSession('temp-1')).not.toBeNull();

    // The replacement session reaches all-active → session:started.
    await act(async () => {
      serviceMock.emit('session:started', 'temp-2', {
        interactionId: 'temp-2',
        interaction: null,
        ownEntityId: 'user',
        participantIds: ['claire', 'user'],
        connections: new Map(),
        pendingTranscriptions: new Map(),
      });
    });

    // Bounded retention: the superseded flagged entry is gone, the live one stays.
    expect(result.current.getInteractionSession('temp-1')).toBeNull();
    expect(result.current.getInteractionSession('temp-2')).not.toBeNull();
  });
});
