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
        // Hard background exit — lock immediately.
        if (isEnabledRef.current) {
          log.info('App backgrounded — locking');
          setIsLocked(true);
        }
      } else if (prevState === 'active' && nextState === 'inactive') {
        // Transient overlay. Only lock if it sustains into a real leave without
        // returning to `active`. Real exits progress to `background` (handled
        // above) within a moment and cancel this timer; the timer is a fallback
        // for the rare device that reports `inactive` but never `background`.
        inactiveTimerRef.current = setTimeout(() => {
          inactiveTimerRef.current = undefined;
          if (isEnabledRef.current) {
            log.info('App inactive-sustained — locking');
            setIsLocked(true);
          }
        }, INACTIVE_LOCK_GRACE_MS);
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
    };
  }, []);

  const handleSetEnabled = useCallback(async (enabled: boolean) => {
    await BiometricLockService.setEnabled(enabled);
    setIsEnabled(enabled);

    if (!enabled) {
      // Disabling — clear PIN and unlock
      await BiometricLockService.clearPin();
      setIsPinSet(false);
      setIsLocked(false);
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
  };

  return (
    <BiometricLockContext.Provider value={value}>
      {children}
    </BiometricLockContext.Provider>
  );
};

export default BiometricLockContext;
