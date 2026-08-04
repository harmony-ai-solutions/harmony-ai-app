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
});
