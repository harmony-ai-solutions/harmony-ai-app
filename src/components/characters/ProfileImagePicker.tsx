/**
 * ProfileImagePicker
 *
 * Horizontal scrollable gallery of character profile images with:
 *  - Tap  → opens ImageViewerModal (full-screen view with zoom + description)
 *  - Long-press → action sheet modal: "Set as Primary" | "Delete"
 *  - Add button → calls onAddImage callback
 *  - Primary image is indicated by a star badge and accent border
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Modal,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { ThemedText } from '../themed/ThemedText';
import { ImageViewerModal } from '../modals/ImageViewerModal';
import { CharacterImage } from '../../database/models';

interface ProfileImagePickerProps {
  images: CharacterImage[];
  primaryImageId: number | null;
  onAddImage: () => void;
  onSetPrimary: (id: number) => void;
  onDeleteImage: (id: number) => void;
}

export const ProfileImagePicker: React.FC<ProfileImagePickerProps> = ({
  images,
  primaryImageId,
  onAddImage,
  onSetPrimary,
  onDeleteImage,
}) => {
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();

  // Image viewer state
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerDescription, setViewerDescription] = useState<string>('');

  // Action sheet state
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [actionTargetId, setActionTargetId] = useState<number | null>(null);
  const [actionTargetIsPrimary, setActionTargetIsPrimary] = useState(false);

  const openViewer = (img: CharacterImage) => {
    setViewerUri(`data:${img.mime_type};base64,${img.image_data}`);
    setViewerDescription(img.description ?? '');
    setViewerVisible(true);
  };

  const openActionSheet = (img: CharacterImage) => {
    setActionTargetId(img.id);
    setActionTargetIsPrimary(img.id === primaryImageId);
    setActionSheetVisible(true);
  };

  const handleSetPrimary = () => {
    if (actionTargetId !== null) {
      onSetPrimary(actionTargetId);
    }
    setActionSheetVisible(false);
  };

  const handleDelete = () => {
    setActionSheetVisible(false);
    if (actionTargetId === null) return;
    const id = actionTargetId;
    showAlert('Delete Image', 'Remove this image from the profile?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => onDeleteImage(id),
      },
    ]);
  };

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {images.map(img => {
          const isPrimary = img.id === primaryImageId;
          return (
            <TouchableOpacity
              key={img.id}
              onPress={() => openViewer(img)}
              onLongPress={() => openActionSheet(img)}
              delayLongPress={400}
              style={[
                styles.imageSlot,
                isPrimary && {
                  borderColor: theme?.colors.accent.primary,
                  borderWidth: 3,
                },
              ]}
              activeOpacity={0.85}
            >
              <Image
                source={{
                  uri: `data:${img.mime_type};base64,${img.image_data}`,
                }}
                style={styles.image}
                resizeMode="cover"
              />
              {isPrimary && (
                <View style={styles.starBadge}>
                  <Icon name="star" size={12} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {/* Add image button */}
        <TouchableOpacity
          style={[
            styles.addSlot,
            {
              borderColor: theme?.colors.border.default,
              backgroundColor: theme?.colors.background.elevated,
            },
          ]}
          onPress={onAddImage}
          activeOpacity={0.7}
        >
          <Icon name="plus" size={28} color={theme?.colors.accent.primary} />
        </TouchableOpacity>
      </ScrollView>

      {/* Full-screen image viewer */}
      <ImageViewerModal
        visible={viewerVisible}
        imageUri={viewerUri}
        description={viewerDescription || undefined}
        onClose={() => setViewerVisible(false)}
      />

      {/* Long-press action sheet modal */}
      <Modal
        visible={actionSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setActionSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetOverlay}
          activeOpacity={1}
          onPress={() => setActionSheetVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.sheetWrapper}>
            {/* Sheet gradient background */}
            <LinearGradient
              colors={[
                theme?.colors.background.elevated ?? '#1e1e2e',
                theme?.colors.background.surface ?? '#181825',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={[StyleSheet.absoluteFillObject, styles.sheetGradientRadius]}
            />

            {/* Drag handle */}
            <View style={styles.dragHandleContainer}>
              <View
                style={[
                  styles.dragHandle,
                  { backgroundColor: theme?.colors.border.default },
                ]}
              />
            </View>

            {/* Accent stripe */}
            <LinearGradient
              colors={[
                (theme?.colors.accent.primary ?? '#7c3aed') + 'CC',
                (theme?.colors.accent.secondary ?? theme?.colors.accent.primaryHover ?? '#9f67ff') + '66',
                'transparent',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.sheetTopStripe}
            />

            {/* Title */}
            <View style={styles.sheetTitleRow}>
              <ThemedText weight="bold" size={14} style={styles.sheetTitle}>
                Image Options
              </ThemedText>
            </View>

            {/* Hairline separator */}
            <View
              style={[
                styles.separator,
                { backgroundColor: (theme?.colors.border.default ?? '#333') + '66' },
              ]}
            />

            {/* Promote to primary — only if not already primary */}
            {!actionTargetIsPrimary && (
              <TouchableOpacity
                style={[
                  styles.sheetAction,
                  { borderBottomColor: (theme?.colors.border.default ?? '#333') + '55' },
                ]}
                onPress={handleSetPrimary}
                activeOpacity={0.65}
              >
                <View
                  style={[
                    styles.sheetActionIconBadge,
                    { backgroundColor: (theme?.colors.accent.primary ?? '#7c3aed') + '22' },
                  ]}
                >
                  <Icon
                    name="star-outline"
                    size={18}
                    color={theme?.colors.accent.primary}
                  />
                </View>
                <ThemedText size={15}>Set as Primary Image</ThemedText>
              </TouchableOpacity>
            )}

            {/* Delete */}
            <TouchableOpacity
              style={[
                styles.sheetAction,
                { borderBottomColor: (theme?.colors.border.default ?? '#333') + '55' },
              ]}
              onPress={handleDelete}
              activeOpacity={0.65}
            >
              <View
                style={[
                  styles.sheetActionIconBadge,
                  { backgroundColor: (theme?.colors.status?.error ?? '#f44336') + '22' },
                ]}
              >
                <Icon
                  name="trash-can-outline"
                  size={18}
                  color={theme?.colors.status?.error ?? '#f44336'}
                />
              </View>
              <ThemedText
                size={15}
                style={{ color: theme?.colors.status?.error ?? '#f44336' }}
              >
                Delete Image
              </ThemedText>
            </TouchableOpacity>

            {/* Cancel */}
            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={() => setActionSheetVisible(false)}
              activeOpacity={0.65}
            >
              <ThemedText size={15} variant="muted">
                Cancel
              </ThemedText>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const SLOT_SIZE = 80;

const styles = StyleSheet.create({
  scroll: {
    flexDirection: 'row',
  },
  scrollContent: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  imageSlot: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: 8,
    marginRight: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  starBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: 3,
  },
  addSlot: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: {
    marginTop: 6,
    marginBottom: 2,
  },
  // Action sheet
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetWrapper: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    overflow: 'hidden',
  },
  sheetGradientRadius: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },
  sheetTopStripe: {
    height: 2,
  },
  sheetTitleRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  sheetTitle: {
    letterSpacing: 0.3,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 14,
  },
  sheetActionIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetCancel: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
});
