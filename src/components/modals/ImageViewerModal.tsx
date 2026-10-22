/**
 * ImageViewerModal
 *
 * Full-screen image viewer with pinch-to-zoom and pan gesture support.
 * Reusable from both the CreateAI edit-mode image section and ChatDetailScreen.
 *
 * Props:
 *  - visible: boolean
 *  - imageUri: data URL or remote URL
 *  - loading?: bytes still in flight — shows a spinner instead of the
 *    "no image" icon while a caller resolves an image asynchronously
 *  - description?: optional caption shown below the image
 *  - backgroundAction?: chat-background action pill (label + onPress); the
 *    caller owns the label so it can render the "✓ Current background" state
 *  - accentColor?: accent used by the ACTIVE background action. The modal is
 *    intentionally theme-agnostic dark chrome (overlay, caption and close
 *    button are fixed dark rgba values), so it does not consume `useAppTheme`:
 *    the caller passes its live accent token instead, and callers without a
 *    theme fall back to the shared `DEFAULT_IMAGE_VIEWER_ACCENT` constant.
 *  - onClose: () => void
 */

import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  StatusBar,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * Active-pill accent when the caller does not pass one. Matches the app's
 * default `accent.primary` (hauteGoth) — callers that own a theme should pass
 * their live token so a re-themed build keeps the viewer in sync.
 */
export const DEFAULT_IMAGE_VIEWER_ACCENT = '#b84fd0';

interface ImageViewerModalProps {
  visible: boolean;
  /** Data URL / remote URI (legacy callers). Ignored when `imageSource` is set. */
  imageUri?: string | null;
  /**
   * Full RN image source, for callers that must pass one through.
   *
   * Prefer `imageUri` with a `data:` URL: under RN New Architecture the Fabric
   * image loader drops `source.headers`, so an authenticated URL (e.g. a
   * character image behind `X-Loopback-Token`) 401s at the engine and renders
   * blank with no JS error (owner device, Android 15, 2026-10-21).
   */
  imageSource?: ImageSourcePropType | null;
  /** Bytes still in flight: spinner instead of the "no image" icon. */
  loading?: boolean;
  description?: string;
  /**
   * "Set as background" action. The caller supplies the label (and `active`
   * styling) so the same modal serves profile images: when the viewed image
   * already IS the background the caller passes the "✓ Current background"
   * label and tapping removes it.
   */
  backgroundAction?: {
    label: string;
    active?: boolean;
    onPress: () => void;
  };
  /** Active-pill accent (defaults to {@link DEFAULT_IMAGE_VIEWER_ACCENT}). */
  accentColor?: string;
  onClose: () => void;
}

export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  visible,
  imageUri,
  imageSource,
  loading = false,
  description,
  backgroundAction,
  accentColor = DEFAULT_IMAGE_VIEWER_ACCENT,
  onClose,
}) => {
  const resolvedSource: ImageSourcePropType | null =
    imageSource ?? (imageUri ? { uri: imageUri } : null);
  const accent = accentColor || DEFAULT_IMAGE_VIEWER_ACCENT;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Close button */}
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.closeButtonBg}>
            <Icon name="close" size={22} color="#fff" />
          </View>
        </TouchableOpacity>

        {/* Zoomable image via ScrollView with maximumZoomScale */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          maximumZoomScale={4}
          minimumZoomScale={1}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          centerContent
          bouncesZoom
        >
          {resolvedSource ? (
            <Image
              source={resolvedSource}
              style={styles.image}
              resizeMode="contain"
            />
          ) : loading ? (
            <View style={styles.noImagePlaceholder} testID="image-viewer-loading">
              <ActivityIndicator size="large" color="rgba(255,255,255,0.7)" />
            </View>
          ) : (
            <View style={styles.noImagePlaceholder}>
              <Icon name="image-off" size={64} color="rgba(255,255,255,0.4)" />
            </View>
          )}
        </ScrollView>

        {/* Chat-background action (profile image viewer) */}
        {backgroundAction && (
          <View style={styles.actionBar}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                backgroundAction.active && {
                  borderColor: hexToRgba(accent, 0.65),
                  backgroundColor: hexToRgba(accent, 0.18),
                },
              ]}
              onPress={backgroundAction.onPress}
              activeOpacity={0.75}
              testID="image-viewer-background-action"
              accessibilityRole="button"
            >
              <Icon
                name={backgroundAction.active ? 'check' : 'wallpaper'}
                size={16}
                color={backgroundAction.active ? accent : 'rgba(255,255,255,0.9)'}
              />
              <ThemedText size={13} weight="medium" style={styles.actionText}>
                {backgroundAction.label}
              </ThemedText>
            </TouchableOpacity>
          </View>
        )}

        {/* Description caption */}
        {!!description && (
          <View style={styles.captionBar}>
            <ThemedText size={13} style={styles.captionText} numberOfLines={3}>
              {description}
            </ThemedText>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0,
  },
  closeButton: {
    position: 'absolute',
    top: (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0) + 12,
    right: 16,
    zIndex: 10,
  },
  closeButtonBg: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 6,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: SCREEN_HEIGHT * 0.7,
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.78,
  },
  noImagePlaceholder: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.78,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBar: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(15,21,37,0.72)',
  },
  actionText: {
    color: 'rgba(255,255,255,0.92)',
  },
  captionBar: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  captionText: {
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 18,
  },
});
