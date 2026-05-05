/**
 * EmojiPickerModal - Modal wrapper around EmojiPickerInline
 *
 * Used by screens that need a standalone modal emoji picker (e.g., EmojiActionEditModal).
 * For inline chat use, use EmojiPickerInline directly.
 */
import React, { memo } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { EmojiEntry } from '../../types/emoji';
import { EmojiPickerInline } from './EmojiPickerInline';

interface EmojiPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onEmojiSelected: (emoji: EmojiEntry) => void;
  entityId?: string | null;
  onOpenActionEditor?: () => void;
}

export const EmojiPickerModal: React.FC<EmojiPickerModalProps> = memo(({
  visible,
  onClose,
  onEmojiSelected,
  entityId,
  onOpenActionEditor,
}) => {
  const { theme } = useAppTheme();

  if (!theme) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.container,
                { backgroundColor: theme.colors.background.elevated },
              ]}
            >
              <EmojiPickerInline
                onEmojiSelected={onEmojiSelected}
                entityId={entityId}
                onOpenActionEditor={onOpenActionEditor}
                theme={theme}
              />
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  container: {
    maxHeight: 320,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
});

export default EmojiPickerModal;
