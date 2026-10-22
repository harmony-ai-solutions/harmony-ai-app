/**
 * QrScannerModal — full-screen QR pairing-code scanner (7-3 follow-up, 2026-10-12).
 *
 * Wraps `react-native-camera-kit`'s `<Camera>` in barcode mode: a live preview
 * with a centred scan frame. On the first successful read it fires
 * `onScanned(code)` exactly once — a local single-shot guard debounces the
 * native callback (camera-kit keeps emitting while a code stays in frame) before
 * the parent closes the modal.
 *
 * Camera permission is requested by the CALLER before opening this modal (see
 * `DesktopSyncScreen.handleScanQr`), so the preview is never the "blank / black"
 * frame the library warns about when permission is missing.
 *
 * The camera is only mounted while `visible`: React Native's `<Modal>` keeps its
 * children mounted when hidden, and leaving the capture session running in the
 * background would drain battery and hold the camera resource.
 *
 * The `<Camera>` export is `React.lazy`-wrapped by the library, so it is wrapped
 * here in a `<Suspense>` boundary (the fallback is the black backdrop).
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Camera, CameraType } from 'react-native-camera-kit';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

interface QrScannerModalProps {
  visible: boolean;
  /** User dismissed the scanner (close button / Android back). */
  onClose: () => void;
  /** First QR/barcode read — the raw scanned string. Fired once per open. */
  onScanned: (code: string) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  visible,
  onClose,
  onScanned,
}) => {
  const { t } = useTranslation('desktopSync');
  const { theme } = useAppTheme();
  const handledRef = useRef(false);

  // Re-arm the single-shot guard each time the scanner is opened so a second
  // scan after a failed pairing still fires.
  useEffect(() => {
    if (visible) handledRef.current = false;
  }, [visible]);

  const handleReadCode = useCallback(
    (event: { nativeEvent: { codeStringValue: string } }) => {
      if (handledRef.current) return;
      const code = event?.nativeEvent?.codeStringValue ?? '';
      if (!code) return;
      handledRef.current = true;
      onScanned(code);
    },
    [onScanned],
  );

  const accent = theme?.colors.accent.primary ?? '#7c3aed';
  const topInset =
    Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {visible ? (
          <React.Suspense fallback={<View style={styles.cameraFallback} />}>
            <Camera
              style={StyleSheet.absoluteFill}
              cameraType={CameraType.Back}
              scanBarcode
              showFrame
              frameColor={accent}
              laserColor={accent}
              onReadCode={handleReadCode}
              testID="qr-scanner-camera"
            />
          </React.Suspense>
        ) : null}

        {/* Top bar: close button + title (over the preview). */}
        <View style={[styles.topBar, { paddingTop: topInset + 12 }]}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onClose}
            testID="qr-scanner-close"
            accessibilityRole="button"
            accessibilityLabel={t('scanClose')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <View style={styles.iconButtonBg}>
              <Icon name="close" size={22} color="#fff" />
            </View>
          </TouchableOpacity>

          <ThemedText weight="medium" size={16} style={styles.title}>
            {t('scanTitle')}
          </ThemedText>

          {/* Spacer keeps the title centred against the close button. */}
          <View style={styles.iconButton} />
        </View>

        {/* Bottom hint. */}
        <View style={styles.hintBar}>
          <ThemedText size={13} style={styles.hint} testID="qr-scanner-hint">
            {t('scanInstruction')}
          </ThemedText>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  cameraFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  iconButton: { width: 34, height: 34, justifyContent: 'center', alignItems: 'center' },
  iconButtonBg: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 6,
  },
  title: { color: '#fff', flex: 1, textAlign: 'center' },
  hintBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingVertical: 18,
    paddingBottom: Platform.OS === 'ios' ? 34 : 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hint: { color: 'rgba(255,255,255,0.9)', textAlign: 'center', lineHeight: 19 },
});
