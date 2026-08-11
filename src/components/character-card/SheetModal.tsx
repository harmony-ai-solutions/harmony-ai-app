/**
 * SheetModal (3-4/3-5) — shared bottom sheet shell built on react-native-paper
 * `Modal`+`Portal` (§A18 — no @gorhom/bottom-sheet installed).
 *
 * Mirrors the `ScenarioGeneratorSheet` presentation: default appearance slides
 * the sheet up; reduced-motion renders a static sheet (paper's Modal fade
 * provides the cross-fade). Used by the lorebook sheets, `ImportReviewSheet`
 * and the editor's preview surfaces.
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import { Modal, Portal } from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const SCREEN_HEIGHT = Dimensions.get('window').height;

export interface SheetModalProps {
  open: boolean;
  onClose: () => void;
  testID?: string;
  children: React.ReactNode;
}

export const SheetModal: React.FC<SheetModalProps> = ({
  open,
  onClose,
  testID,
  children,
}) => {
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const slideY = useRef(new Animated.Value(0)).current;

  // Slide the sheet up on open unless the OS wants reduced motion (paper's
  // Modal fade becomes the only animation).
  useEffect(() => {
    if (!open) return;
    if (reduceMotion) {
      slideY.setValue(0);
      return;
    }
    slideY.setValue(SCREEN_HEIGHT);
    Animated.timing(slideY, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, reduceMotion, slideY]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primary;

  const renderShell = () => (
    <>
      {/* Gradient background */}
      <LinearGradient
        colors={[
          theme.colors.background.elevated,
          theme.colors.background.surface,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[StyleSheet.absoluteFill, styles.sheetRadius]}
      />
      {/* Prismatic tint */}
      <LinearGradient
        colors={[accent + '10', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.6 }}
        style={[StyleSheet.absoluteFill, styles.sheetRadius]}
        pointerEvents="none"
      />
      {/* Top accent stripe */}
      <LinearGradient
        colors={[accent + 'CC', accentSecondary + '66', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.topStripe}
      />
      {/* Grabber */}
      <View style={styles.grabber} />
      {children}
    </>
  );

  return (
    <Portal>
      <Modal
        visible={open}
        onDismiss={onClose}
        style={styles.modalWrapper}
        contentContainerStyle={styles.sheet}
        testID={testID}
      >
        {reduceMotion ? (
          <View testID={`${testID}-content-static`} style={styles.sheetShell}>
            {renderShell()}
          </View>
        ) : (
          <Animated.View
            testID={`${testID}-content-slide`}
            style={[
              styles.sheetShell,
              { transform: [{ translateY: slideY }] },
            ]}
          >
            {renderShell()}
          </Animated.View>
        )}
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  modalWrapper: {
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: 'transparent',
    maxHeight: '88%',
  },
  sheetShell: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#151d30', // opaque fallback — prevents transparency
  },
  sheetRadius: {
    borderRadius: 20,
  },
  topStripe: {
    height: 2,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: 8,
  },
});
