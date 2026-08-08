/**
 * BiometricLockContext — unit tests for the external-flow lock suppression
 * (Option 3 / activity-result-aware locking).
 *
 * What we verify:
 *  - Lock still engages IMMEDIATELY on a genuine background (no flow in-flight).
 *  - Lock is DEFERRED (not engaged) when a self-launched external flow (file /
 *    image picker) is in-flight while the app backgrounds — the picker is a
 *    sub-state of the app's own flow, not a real leave.
 *  - A normal picker round-trip (background → flow concludes → return to
 *    'active') NEVER locks, even though on Android the promise settles before
 *    AppState reports 'active'.
 *  - A flow that concludes while the app STAYS backgrounded (user pressed Home
 *    with the picker open and the system dismissed it without resuming us)
 *    locks after a short confirm grace.
 *  - The counter is released on rejection/cancel too (finally semantics).
 *  - The iOS 'inactive' overlay timer is NOT armed while a flow is in-flight.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { AppState, AppStateStatus } from 'react-native';
import { BiometricLockProvider, useBiometricLock } from '../BiometricLockContext';

// ── Mock the lock service so the provider loads an enabled PIN lock ─────────
jest.mock('../../services/BiometricLockService', () => ({
  __esModule: true,
  default: {
    isEnabled: jest.fn().mockResolvedValue(true),
    getLockMode: jest.fn().mockResolvedValue('pin'),
    isPinSet: jest.fn().mockResolvedValue(true),
    setEnabled: jest.fn().mockResolvedValue(undefined),
    clearPin: jest.fn().mockResolvedValue(undefined),
    setupLock: jest.fn().mockResolvedValue(undefined),
    unlock: jest.fn().mockResolvedValue(true),
  },
}));

// ── AppState driver ─────────────────────────────────────────────────────────
// Capture the provider's 'change' listener (registered once at mount).
const getAppStateHandler = (): ((s: AppStateStatus) => void) => {
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  const changeCall = calls.find((c: unknown[]) => c[0] === 'change');
  if (!changeCall) {
    throw new Error('BiometricLockProvider did not register an AppState listener');
  }
  return changeCall[1] as (s: AppStateStatus) => void;
};

const fireAppState = async (state: AppStateStatus) => {
  await act(async () => {
    getAppStateHandler()(state);
  });
};

describe('BiometricLockContext — external flow (Option 3)', () => {
  // Re-mount the provider for every test with a fresh AppState subscription.
  const setup = async () => {
    jest.clearAllMocks();
    (AppState as any).currentState = 'active';
    const utils = await renderHook(() => useBiometricLock(), {
      wrapper: ({ children }) => <BiometricLockProvider>{children}</BiometricLockProvider>,
    });
    // Flush the async lock-state load (isEnabled → true) into the ref.
    await act(async () => {});
    return utils;
  };

  it('exposes a working withExternalFlow helper', async () => {
    const { result } = await setup();
    const value = await result.current.withExternalFlow(() => Promise.resolve(42));
    expect(value).toBe(42);
  });

  it('locks immediately on a genuine background with no flow in-flight', async () => {
    const { result } = await setup();
    await fireAppState('background');
    expect(result.current.isLocked).toBe(true);
  });

  it('does NOT lock when backgrounded while an external flow is in-flight', async () => {
    const { result } = await setup();
    let resolveFlow!: () => void;
    const gate = new Promise<void>(r => (resolveFlow = r));
    void result.current.withExternalFlow(() => gate);

    await fireAppState('background');
    expect(result.current.isLocked).toBe(false);
    resolveFlow();
    await act(async () => {}); // let the flow settle
  });

  it('never locks on a normal picker round-trip (background → flow ends → active)', async () => {
    const { result } = await setup();
    let resolveFlow!: () => void;
    const gate = new Promise<void>(r => (resolveFlow = r));
    const flowPromise = result.current.withExternalFlow(() => gate);

    await fireAppState('background'); // picker opens — backgrounded, but flow in-flight
    expect(result.current.isLocked).toBe(false);

    // User picks a file: the native promise settles (finally decrements the
    // counter) BEFORE AppState reports 'active' on Android.
    resolveFlow();
    await act(async () => {
      await flowPromise;
    });
    expect(result.current.isLocked).toBe(false);

    // App resumes to the foreground — still no lock.
    await fireAppState('active');
    expect(result.current.isLocked).toBe(false);
  });

  it('locks after the confirm grace if the flow concludes while the app stays backgrounded', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await setup();
      let resolveFlow!: () => void;
      const gate = new Promise<void>(r => (resolveFlow = r));
      const flowPromise = result.current.withExternalFlow(() => gate);

      await fireAppState('background'); // picker opens
      expect(result.current.isLocked).toBe(false);

      // The picker is dismissed by the system while the user has gone Home —
      // the flow concludes but the app never returns to the foreground.
      resolveFlow();
      await act(async () => {
        await flowPromise;
      });
      expect(result.current.isLocked).toBe(false); // deferred, not yet locked

      // After the confirm grace with no resume, the deferred lock commits.
      await act(async () => {
        jest.advanceTimersByTime(2100);
      });
      expect(result.current.isLocked).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases the flow counter on rejection/cancel so a later background locks', async () => {
    const { result } = await setup();
    await expect(
      result.current.withExternalFlow(() => Promise.reject(new Error('cancel'))),
    ).rejects.toThrow('cancel');

    await fireAppState('background');
    expect(result.current.isLocked).toBe(true);
  });

  it('does NOT arm the iOS inactive-sustain timer while a flow is in-flight', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await setup();
      let resolveFlow!: () => void;
      const gate = new Promise<void>(r => (resolveFlow = r));
      void result.current.withExternalFlow(() => gate);

      await fireAppState('inactive'); // notification shade / Control Center over a picker
      await act(async () => {
        jest.advanceTimersByTime(5100); // well past the 5s inactive grace
      });
      expect(result.current.isLocked).toBe(false);
      resolveFlow();
      await act(async () => {});
    } finally {
      jest.useRealTimers();
    }
  });

  it('still locks after the inactive-sustain grace when NO flow is in-flight', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await setup();
      await fireAppState('inactive');
      await act(async () => {
        jest.advanceTimersByTime(5100);
      });
      expect(result.current.isLocked).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not lock when the feature is disabled', async () => {
    const svc = jest.requireMock('../../services/BiometricLockService').default;
    svc.isEnabled.mockResolvedValueOnce(false);
    const { result } = await setup();

    await fireAppState('background');
    expect(result.current.isLocked).toBe(false);
  });
});
