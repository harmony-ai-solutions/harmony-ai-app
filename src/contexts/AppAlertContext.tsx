/**
 * AppAlertContext — Imperative API for themed alert dialogs.
 *
 * Replaces React Native's Alert.alert() with a branded obsidian-glass modal.
 * Usage:
 *
 *   const { showAlert } = useAppAlert();
 *   showAlert('Title', 'Message', [
 *     { text: 'Cancel', style: 'cancel' },
 *     { text: 'OK', onPress: () => { ... } },
 *   ]);
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from 'react';
import { AppAlertModal, AlertConfig, AlertButton, AlertCheckbox } from '../components/modals/AppAlertModal';

// ── Types ────────────────────────────────────────────────────────────────────

interface AppAlertContextValue {
  /**
   * Show a themed alert dialog.
   *
   * @param title   - Alert title (required)
   * @param message - Alert body text (optional)
   * @param buttons - Array of action buttons. Defaults to [{ text: 'OK' }].
   *                  Each button: { text, onPress?, style?: 'default' | 'cancel' | 'destructive' }.
   *                  When `options.checkbox` is set, onPress receives the
   *                  checkbox's current checked state.
   * @param options - Additional options:
   *   - icon: MaterialCommunityIcons name to display
   *   - blockBackdropDismiss: prevent tapping outside to dismiss
   *   - checkbox: optional checkbox row above the buttons (e.g. "Apply to all")
   */
  showAlert: (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: { icon?: string; blockBackdropDismiss?: boolean; checkbox?: AlertCheckbox },
  ) => void;
}

const AppAlertContext = createContext<AppAlertContextValue | undefined>(undefined);

// ── Provider ─────────────────────────────────────────────────────────────────

export const AppAlertProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<AlertConfig | null>(null);
  // Use a ref to track pending onDismiss callbacks that fire after rendering
  const pendingRef = useRef<AlertConfig | null>(null);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    // Capture the config being dismissed. The delayed cleanup (config cleared
    // after the fade animation) must NOT clobber a NEWER alert that was shown
    // before the timer fires — e.g. the sync name-clash popup is re-shown
    // synchronously for the next clash when the user resolves one without
    // "apply to all". Without this guard, the second popup vanished after the
    // 200ms timer and the sync hung waiting for a decision.
    const dismissedConfig = pendingRef.current;
    setTimeout(() => {
      if (pendingRef.current === dismissedConfig) {
        setConfig(null);
        pendingRef.current = null;
      }
    }, 200);
  }, []);

  const showAlert = useCallback<AppAlertContextValue['showAlert']>(
    (title, message, buttons, options) => {
      const newConfig: AlertConfig = {
        title,
        message,
        buttons: buttons ?? [{ text: 'OK' }],
        icon: options?.icon,
        blockBackdropDismiss: options?.blockBackdropDismiss,
        checkbox: options?.checkbox,
      };
      pendingRef.current = newConfig;
      setConfig(newConfig);
      setVisible(true);
    },
    [],
  );

  return (
    <AppAlertContext.Provider value={{ showAlert }}>
      {children}
      <AppAlertModal
        visible={visible}
        config={config}
        onDismiss={handleDismiss}
      />
    </AppAlertContext.Provider>
  );
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export const useAppAlert = (): AppAlertContextValue => {
  const context = useContext(AppAlertContext);
  if (!context) {
    throw new Error('useAppAlert must be used within AppAlertProvider');
  }
  return context;
};

export default AppAlertContext;
