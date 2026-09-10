/**
 * BiometricLockContext
 *
 * Manages app-lock state: listens to AppState for foreground/background
 * transitions, triggers lock screen on resume when biometric lock is enabled.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import BiometricLockService, { LockMode, UnlockOptions } from '../services/BiometricLockService';
import { createLogger } from '../utils/logger';

const log = createLogger('[BiometricLockContext]');

/**
 * Grace window applied to a transient `inactive` AppState. On Android/iOS
 * `inactive` is emitted for overlays (notification shade, Control Center, the
 * OS biometric prompt's own window-focus change) that are NOT a real app exit.
 * We only lock if the app stays `inactive` beyond this window without returning
 * to `active` or progressing to `background`. A real `background` transition
 * locks immediately (0 grace).
 */
const INACTIVE_LOCK_GRACE_MS = 5000;

/**
 * Grace window after an external flow concludes while the app is backgrounded.
 *
 * On Android the picker's `onActivityResult` (which settles the flow promise)
 * fires BEFORE `onResume` reports AppState 'active'. So when a flow's `finally`
 * runs, the app may still look backgrounded even on a NORMAL pick round-trip.
 * We can't decide "lock vs not" synchronously there — instead we arm this short
 * confirm timer, which the `background → active` transition cancels. If the app
 * never returns to the foreground (user pressed Home with the picker open and
 * the system dismissed the picker without resuming us), the timer fires and the
 * deferred lock commits.
 */
const FLOW_CONCLUDE_CONFIRM_MS = 2000;

interface BiometricLockContextType {
  /** Whether the biometric lock feature is enabled by user. */
  isEnabled: boolean;
  /** The current lock mode (biometric, pin, or none). */
  lockMode: LockMode;
  /** Whether the app is currently locked and showing the lock screen. */
  isLocked: boolean;
  /** Whether a PIN has been set (for pin-based locking). */
  isPinSet: boolean;
  /** Enable or disable biometric lock. */
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Set/unset the PIN. */
  setupPin: (pin: string) => Promise<void>;
  /** Unlock the app — triggers biometric prompt or verifies PIN. */
  unlock: (options?: UnlockOptions) => Promise<boolean>;
  /** Lock the app immediately (e.g., manual lock). */
  lock: () => void;
  /**
   * Run a self-launched external flow (system file/image picker, camera, etc.)
   * as a sub-state of the app: while the flow is in-flight, backgrounding does
   * NOT lock (the picker itself backgrounded us). The returned promise mirrors
   * `fn`'s result/rejection and the flow ends when it settles.
   */
  withExternalFlow: <T>(fn: () => Promise<T>) => Promise<T>;
}

const BiometricLockContext = createContext<BiometricLockContextType>({
  isEnabled: false,
  lockMode: 'none',
  isLocked: false,
  isPinSet: false,
  setEnabled: async () => {},
  setupPin: async () => {},
  unlock: async () => false,
  lock: () => {},
  withExternalFlow: async <T,>(fn: () => Promise<T>) => fn(),
});

export const useBiometricLock = (): BiometricLockContextType =>
  useContext(BiometricLockContext);

interface BiometricLockProviderProps {
  children: React.ReactNode;
}

export const BiometricLockProvider: React.FC<BiometricLockProviderProps> = ({
  children,
}) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [lockMode, setLockMode] = useState<LockMode>('none');
  const [isLocked, setIsLocked] = useState(false);
  const [isPinSet, setIsPinSet] = useState(false);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  // Grace timer for the transient `inactive` case (see INACTIVE_LOCK_GRACE_MS).
  const inactiveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Count of self-launched external flows (file/image pickers) currently in
  // flight. While > 0, the app's own backgrounding is a sub-state (the picker
  // is a separate Activity on Android), NOT a real leave — see FLOW_CONCLUDE_CONFIRM_MS.
  const externalFlowsRef = useRef(0);
  // Set when we backgrounded while a flow was in-flight and deferred the lock
  // decision. Cleared when the app returns to the foreground (normal round-trip)
  // or when the confirm timer fires (real leave).
  const deferredLockRef = useRef(false);
  // Confirm timer armed when a flow concludes while the app is still backgrounded.
  const flowConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Mirror isEnabled in a ref so the AppState listener can read the latest value
  // without re-subscribing. Re-subscribing on every enable toggle risks dropping a
  // foreground→background transition mid-flight (race). The listener is created once.
  const isEnabledRef = useRef(isEnabled);
  useEffect(() => {
    isEnabledRef.current = isEnabled;
  }, [isEnabled]);

  // Load initial state
  useEffect(() => {
    const loadState = async () => {
      const enabled = await BiometricLockService.isEnabled();
      const mode = await BiometricLockService.getLockMode();
      const pinSet = await BiometricLockService.isPinSet();
      setIsEnabled(enabled);
      setLockMode(mode);
      setIsPinSet(pinSet);
      log.info('Lock state loaded:', { enabled, mode, pinSet });
    };
    loadState();
  }, []);

  // Listen to app state changes — lock when leaving the foreground.
  // Subscribe exactly once; read the current `isEnabled` via the ref above.
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;

      // Any state change cancels a pending "sustained inactive" lock. A quick
      // active↔inactive blip (notification shade, Control Center, or — crucially —
      // the OS biometric prompt's own focus change while WE are showing it) must
      // NOT lock the app. Previously this fired on `inactive` too, which locked
      // the app on every overlay event and churned the lock/unlock UI.
      if (inactiveTimerRef.current) {
        clearTimeout(inactiveTimerRef.current);
        inactiveTimerRef.current = undefined;
      }

      if (prevState === 'active' && nextState === 'background') {
        // Hard background exit — lock immediately, UNLESS a self-launched
        // external flow (file/image picker) is in-flight. On Android the picker
        // is a separate Activity, so opening it backgrounds the app; that's a
        // sub-state of our own flow, not a real leave. Defer the decision and
        // resolve it when the flow concludes (see withExternalFlow).
        if (isEnabledRef.current && externalFlowsRef.current > 0) {
          deferredLockRef.current = true;
          log.info('App backgrounded with external flow in-flight — deferring lock');
        } else if (isEnabledRef.current) {
          log.info('App backgrounded — locking');
          setIsLocked(true);
        }
      } else if (nextState === 'active') {
        // Returned to the foreground — cancels a deferred lock from a picker
        // round-trip (the flow's confirm timer, if any, must not fire either).
        if (deferredLockRef.current) {
          deferredLockRef.current = false;
          if (flowConfirmTimerRef.current) {
            clearTimeout(flowConfirmTimerRef.current);
            flowConfirmTimerRef.current = undefined;
          }
          log.info('Returned to foreground — cancelled deferred lock');
        }
      } else if (prevState === 'active' && nextState === 'inactive') {
        // Transient overlay. Only lock if it sustains into a real leave without
        // returning to `active`. Real exits progress to `background` (handled
        // above) within a moment and cancel this timer; the timer is a fallback
        // for the rare device that reports `inactive` but never `background`.
        // While an external flow is in-flight, do NOT arm it at all: on iOS the
        // in-process picker itself can surface `inactive` overlays mid-flow and
        // the user is still inside the app's own flow.
        if (isEnabledRef.current && externalFlowsRef.current === 0) {
          inactiveTimerRef.current = setTimeout(() => {
            inactiveTimerRef.current = undefined;
            if (isEnabledRef.current) {
              log.info('App inactive-sustained — locking');
              setIsLocked(true);
            }
          }, INACTIVE_LOCK_GRACE_MS);
        }
      }

      appStateRef.current = nextState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
      if (inactiveTimerRef.current) {
        clearTimeout(inactiveTimerRef.current);
        inactiveTimerRef.current = undefined;
      }
      if (flowConfirmTimerRef.current) {
        clearTimeout(flowConfirmTimerRef.current);
        flowConfirmTimerRef.current = undefined;
      }
    };
  }, []);

  // Run a self-launched external flow (system file/image picker, etc.) as a
  // sub-state. While in-flight, AppState `background` is caused by the picker
  // being a separate Activity and must not lock. The flow's promise settles at
  // `onActivityResult`, which on Android fires BEFORE `onResume` — so when the
  // flow concludes the app may STILL report `background` on a normal round-trip.
  // Hence we can't decide synchronously: we arm a short confirm timer that the
  // `background → active` transition cancels. If the app never returns to the
  // foreground (user pressed Home with the picker open and the system dismissed
  // the picker without resuming us), the timer commits the deferred lock.
  const handleWithExternalFlow = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      externalFlowsRef.current += 1;
      try {
        return await fn();
      } finally {
        externalFlowsRef.current -= 1;
        if (externalFlowsRef.current === 0 && deferredLockRef.current) {
          if (flowConfirmTimerRef.current) {
            clearTimeout(flowConfirmTimerRef.current);
          }
          flowConfirmTimerRef.current = setTimeout(() => {
            flowConfirmTimerRef.current = undefined;
            if (deferredLockRef.current) {
              deferredLockRef.current = false;
              log.info('External flow concluded while still backgrounded — locking');
              setIsLocked(true);
            }
          }, FLOW_CONCLUDE_CONFIRM_MS);
        }
      }
    },
    [],
  );

  const handleSetEnabled = useCallback(async (enabled: boolean) => {
    await BiometricLockService.setEnabled(enabled);
    setIsEnabled(enabled);

    if (!enabled) {
      // Disabling — clear PIN and unlock. Also drop any deferred lock from an
      // in-flight external flow so a stale confirm timer can't lock later.
      await BiometricLockService.clearPin();
      setIsPinSet(false);
      setIsLocked(false);
      deferredLockRef.current = false;
      if (flowConfirmTimerRef.current) {
        clearTimeout(flowConfirmTimerRef.current);
        flowConfirmTimerRef.current = undefined;
      }
    }

    // Refresh lock mode
    const mode = await BiometricLockService.getLockMode();
    setLockMode(mode);
    const pinSet = await BiometricLockService.isPinSet();
    setIsPinSet(pinSet);
  }, []);

  const handleSetupPin = useCallback(async (pin: string) => {
    await BiometricLockService.setupLock(pin);
    setIsPinSet(true);
    const mode = await BiometricLockService.getLockMode();
    setLockMode(mode);
  }, []);

  const handleUnlock = useCallback(async (options?: UnlockOptions): Promise<boolean> => {
    const success = await BiometricLockService.unlock(options);
    if (success) {
      setIsLocked(false);
    }
    return success;
  }, []);

  const handleLock = useCallback(() => {
    if (isEnabled) {
      setIsLocked(true);
    }
  }, [isEnabled]);

  const value: BiometricLockContextType = {
    isEnabled,
    lockMode,
    isLocked,
    isPinSet,
    setEnabled: handleSetEnabled,
    setupPin: handleSetupPin,
    unlock: handleUnlock,
    lock: handleLock,
    withExternalFlow: handleWithExternalFlow,
  };

  return (
    <BiometricLockContext.Provider value={value}>
      {children}
    </BiometricLockContext.Provider>
  );
};

export default BiometricLockContext;
