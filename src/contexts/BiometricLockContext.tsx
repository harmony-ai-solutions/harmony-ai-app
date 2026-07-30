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
import BiometricLockService, { LockMode } from '../services/BiometricLockService';
import { createLogger } from '../utils/logger';

const log = createLogger('[BiometricLockContext]');

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
  unlock: (pin?: string) => Promise<boolean>;
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

      // Exact equality checks: `prevState.match(/active/)` also matches
      // 'inactive' (it contains the substring "active"), causing redundant lock
      // churn. Use strict state comparisons instead.
      const wasActive = prevState === 'active';
      const leavingForeground = nextState === 'inactive' || nextState === 'background';

      if (wasActive && leavingForeground) {
        // App leaving the foreground — lock it
        if (isEnabledRef.current) {
          log.info('App entering background — locking');
          setIsLocked(true);
        }
      }

      appStateRef.current = nextState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
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

  const handleUnlock = useCallback(async (pin?: string): Promise<boolean> => {
    const success = await BiometricLockService.unlock(pin);
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
