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
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
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
    Alert.alert('Delete Image', 'Remove this image from the profile?', [
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

      {/* Hint text */}
      <ThemedText size={11} variant="muted" style={styles.hint}>
        Tap to view full-size · Hold for options
      </ThemedText>

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
          <View
            style={[
              styles.actionSheet,
              { backgroundColor: theme?.colors.background.elevated },
            ]}
          >
            <ThemedText weight="bold" size={14} style={styles.sheetTitle}>
              Image Options
            </ThemedText>

            {/* Promote to primary — only if not already primary */}
            {!actionTargetIsPrimary && (
              <TouchableOpacity
                style={[
                  styles.sheetAction,
                  { borderBottomColor: theme?.colors.border.default },
                ]}
                onPress={handleSetPrimary}
              >
                <Icon
                  name="star-outline"
                  size={20}
                  color={theme?.colors.accent.primary}
                  style={styles.sheetActionIcon}
                />
                <ThemedText size={15}>Set as Primary Image</ThemedText>
              </TouchableOpacity>
            )}

            {/* Delete */}
            <TouchableOpacity
              style={[
                styles.sheetAction,
                { borderBottomColor: theme?.colors.border.default },
              ]}
              onPress={handleDelete}
            >
              <Icon
                name="trash-can-outline"
                size={20}
                color="#f44336"
                style={styles.sheetActionIcon}
              />
              <ThemedText size={15} style={{ color: '#f44336' }}>
                Delete Image
              </ThemedText>
            </TouchableOpacity>

            {/* Cancel */}
            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={() => setActionSheetVisible(false)}
            >
              <ThemedText size={15} variant="muted">
                Cancel
              </ThemedText>
            </TouchableOpacity>
          </View>
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
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  sheetTitle: {
    textAlign: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    letterSpacing: 0.3,
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetActionIcon: {
    marginRight: 14,
  },
  sheetCancel: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
});
