/**
 * EntitySessionContext — retry policy unit tests.
 *
 * Regression test for the infinite-retry bug: `startInteractionSession` cleared
 * the per-participant retry state at the top of every attempt, so when a retry
 * re-entered it the attempt counter reset to 0. `scheduleRetry` therefore always
 * logged "Scheduling retry 1/3" and never hit the max-attempts cap — the app
 * hammered the engine with a connect/disconnect loop every ~1s forever.
 *
 * This verifies the retry actually escalates 1 → 2 → 3 and then gives up with a
 * `session:error` instead of looping indefinitely.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { EntitySessionProvider, useEntitySession } from '../EntitySessionContext';
import EntitySessionService from '../../services/EntitySessionService';

jest.mock('../../services/EntitySessionService', () => ({
  __esModule: true,
  default: {
    startInteractionSession: jest.fn(),
    stopInteractionSession: jest.fn(),
    closeAllSessions: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
  },
}));

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

describe('EntitySessionContext retry policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serviceMock.startInteractionSession.mockRejectedValue(
      new Error('Connection failed'),
    );
  });

  it('gives up after max retries (3) instead of retrying forever', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await renderHook(() => useEntitySession(), { wrapper });

      // Initial attempt fails → schedules retry #1 (delay 1000ms)
      await act(async () => {
        await expect(
          result.current.startInteractionSession('user', ['Marcella', 'user']),
        ).rejects.toThrow('Connection failed');
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(1);

      // Retry #1 (attempt 2) — delay 1000ms
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(2);

      // Retry #2 (attempt 3) — backoff 2000ms
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(3);

      // Retry #3 (attempt 4 → hits maxAttempts=3) — backoff 4000ms.
      // With the bug, the counter reset each retry so it would keep scheduling
      // "1/3" forever; here it must give up after exactly 3 retries.
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(4);

      // No further retries may fire (would indicate an infinite loop).
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(4);

      // The provider surfaces a permanent failure instead of looping.
      expect(serviceMock.emit).toHaveBeenCalledWith(
        'session:error',
        expect.any(String),
        expect.stringContaining('Failed to initialize session after 3 attempts'),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * Second half of the infinite-retry bug (observed on device 2026-08-05):
   * `retryInitialization` first STOPS the lingering half-open session, and the
   * context's `stopInteractionSession` unconditionally deletes the
   * participant-key retry state ("Cancelled pending fallback retry") — wiping
   * the attempt counter that `preserveRetryState` was supposed to protect.
   * Every retry then logged "Scheduling retry 1/3" again and the app looped a
   * connect/disconnect cycle against the engine every ~1s forever.
   *
   * This test reproduces that exact path: a session IS present in
   * activeSessions when the retry fires (from an earlier attempt that got far
   * enough to register one), so the cleanup stop runs and must NOT reset the
   * counter.
   */
  it('keeps escalating when the retry cleanup stops a lingering session', async () => {
    jest.useFakeTimers();
    try {
      // First attempt gets far enough to register a session (connections stay
      // 'connecting', so the 15s initialization timeout will fire).
      const lingeringSession = {
        interactionId: 'temp-1',
        interaction: null,
        ownEntityId: 'user',
        participantIds: ['claire', 'user'],
        connections: new Map([
          ['claire', { connectionId: 'entity-claire', status: 'connecting' }],
          ['user', { connectionId: 'entity-user', status: 'connecting' }],
        ]),
        pendingTranscriptions: new Map(),
      };
      serviceMock.startInteractionSession.mockResolvedValueOnce(lingeringSession);
      serviceMock.stopInteractionSession.mockResolvedValue(undefined);

      const { result } = await renderHook(() => useEntitySession(), { wrapper });

      // Attempt 1 "succeeds" (session registered, connections never activate)
      await act(async () => {
        await result.current.startInteractionSession('user', ['claire', 'user']);
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(1);

      // 15s initialization timeout → schedules retry 1/3 (1000ms)
      await act(async () => {
        jest.advanceTimersByTime(15000);
      });

      // Retry 1: cleanup finds the lingering session and stops it…
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(serviceMock.stopInteractionSession).toHaveBeenCalledWith('temp-1');
      // …then re-attempts (fails) — attempt counter must SURVIVE the stop.
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(2);

      // With the counter wiped (bug), the next retry would fire after 1000ms
      // again as "1/3"; with the fix it escalates: 2/3 after 2000ms.
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      // No early retry may have fired (would prove the delay reset to 1000ms).
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(2);

      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(3);

      // Retry 3/3 after 4000ms, then permanent give-up.
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(4);

      // No infinite loop…
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      expect(serviceMock.startInteractionSession).toHaveBeenCalledTimes(4);

      // …and a permanent failure is surfaced.
      expect(serviceMock.emit).toHaveBeenCalledWith(
        'session:error',
        expect.any(String),
        expect.stringContaining('Failed to initialize session after 3 attempts'),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
