/**
 * TopToastModal — themed toast rendered in its OWN top-level Modal window.
 *
 * RN Modals (and Android dialogs in general) live in separate native windows
 * stacked ABOVE the app's main window. Any toast rendered in the normal React
 * tree (the root `AppToastView`) is therefore INVISIBLE while a Modal window
 * is on screen — the main-window content simply isn't drawn behind the dialog.
 *
 * This component mounts an `AppToastView` inside its own transparent, topmost
 * Modal window. Because the window is created *after* a dismissing dialog, it
 * is guaranteed to render on top regardless of dismissal timing — no
 * `setTimeout` heuristics needed. It is used for toasts that must be visible
 * while / right after another modal, e.g. the delete-confirmation dialog on
 * the Characters screen.
 *
 * Usage (mirrors `useInModalToast`):
 *
 *   const toast = useTopToast();
 *   toast.show('Character deleted');
 *   ...
 *   {toast.view}
 */

import React, { useCallback, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { AppToastView } from './AppToastView';

interface TopToastModalProps {
  message: string | null;
  visible: boolean;
  onHide: () => void;
}

const TopToastModal: React.FC<TopToastModalProps> = ({
  message,
  visible,
  onHide,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onHide}
    >
      <View style={styles.window}>
        <AppToastView message={message} visible={visible} onHide={onHide} />
      </View>
    </Modal>
  );
};

export function useTopToast() {
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

  const show = useCallback((msg: string) => {
    if (visibleRef.current) {
      queueRef.current.push(msg);
      return;
    }
    visibleRef.current = true;
    setMessage(msg);
    setVisible(true);
  }, []);

  return {
    show,
    view: (
      <TopToastModal message={message} visible={visible} onHide={dismiss} />
    ),
  };
}

const styles = StyleSheet.create({
  window: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

export default useTopToast;
