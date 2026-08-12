/**
 * AppToastContext — Themed toast notifications.
 *
 * Replaces the OS-native `ToastAndroid`/`Alert` with a branded glass pill that
 * matches the app's design language (accent gradient, elevated surface).
 *
 * Usage:
 *
 *   const { showToast } = useToast();
 *   showToast('Message copied');
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from 'react';
import { AppToastView } from '../components/modals/AppToastView';

interface AppToastContextValue {
  /** Show a themed toast. Queues if one is already visible. */
  showToast: (message: string) => void;
}

const AppToastContext = createContext<AppToastContextValue | undefined>(
  undefined,
);

export const AppToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const queueRef = useRef<string[]>([]);
  const visibleRef = useRef(false);

  const dismiss = useCallback(() => {
    setVisible(false);
    visibleRef.current = false;
    // Show the next queued toast (if any) after the hide animation.
    setTimeout(() => {
      if (queueRef.current.length > 0) {
        const next = queueRef.current.shift()!;
        visibleRef.current = true;
        setMessage(next);
        setVisible(true);
      }
    }, 250);
  }, []);

  const showToast = useCallback(
    (msg: string) => {
      if (visibleRef.current) {
        queueRef.current.push(msg);
        return;
      }
      visibleRef.current = true;
      setMessage(msg);
      setVisible(true);
    },
    [],
  );

  return (
    <AppToastContext.Provider value={{ showToast }}>
      {children}
      <AppToastView message={message} visible={visible} onHide={dismiss} />
    </AppToastContext.Provider>
  );
};

export const useToast = (): AppToastContextValue => {
  const context = useContext(AppToastContext);
  if (!context) {
    throw new Error('useToast must be used within AppToastProvider');
  }
  return context;
};

export default AppToastContext;
