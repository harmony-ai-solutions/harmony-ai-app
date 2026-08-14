/**
 * InModalToast — themed toast that works INSIDE a React Native <Modal>.
 *
 * RN Modals render in a separate native window, so the root AppToastView
 * (rendered behind the modal) is invisible while a modal is open. This hook
 * provides a local showToast + renders its own AppToastView inside the modal
 * tree so toasts appear on top of the modal content.
 *
 * Usage:
 *
 *   const toast = useInModalToast();
 *   toast.show('Comment deleted');
 *   ...
 *   <View>
 *     ...modal content...
 *     {toast.view}
 *   </View>
 */

import React, { useCallback, useRef, useState } from 'react';
import { AppToastView } from './AppToastView';

export function useInModalToast() {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const queueRef = useRef<string[]>([]);
  const visibleRef = useRef(false);

  const dismiss = useCallback(() => {
    setVisible(false);
    visibleRef.current = false;
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
      <AppToastView
        message={message}
        visible={visible}
        onHide={dismiss}
      />
    ),
  };
}

export default useInModalToast;
