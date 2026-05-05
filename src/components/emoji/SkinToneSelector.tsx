/**
 * SkinToneSelector - Popup for selecting skin tone
 */
import React, { memo, useCallback } from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Theme } from '../../theme/types';
import { EmojiEntry } from '../../types/emoji';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';

interface SkinToneSelectorProps {
  visible: boolean;
  emoji: EmojiEntry | null;
  onSelectSkin: (skinIndex: number) => void;
  onClose: () => void;
  theme: Theme;
}

// Skin tone colors (as fallback display)
const SKIN_TONE_COLORS = [
  '#FFDCB1', // Light
  '#E5B887', // Medium-Light
  '#D4A574', // Medium
  '#AD8A64', // Medium-Dark
  '#8B5A3C', // Dark
  '#5C3D2E', // Darker
];

// Skin tone labels
const SKIN_TONE_LABELS = [
  'Light',
  'Medium-Light',
  'Medium',
  'Medium-Dark',
  'Dark',
  'Darker',
];

export const SkinToneSelector: React.FC<SkinToneSelectorProps> = memo(({
  visible,
  emoji,
  onSelectSkin,
  onClose,
  theme,
}) => {
  const handleSelect = useCallback((skinIndex: number) => {
    onSelectSkin(skinIndex);
    onClose();
  }, [onSelectSkin, onClose]);

  if (!emoji) {
    return null;
  }

  // Get available skin options from emoji
  const skinOptions = emoji.skins && emoji.skins.length > 0
    ? emoji.skins
    : [{ native: emoji.native }];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <ThemedView
          style={[
            styles.container,
            {
              backgroundColor: theme.colors.background.elevated,
              shadowColor: '#000',
            },
          ]}
          variant="elevated"
        >
          <ThemedText
            variant="secondary"
            size={12}
            style={styles.label}
          >
            Skin Tone
          </ThemedText>

          <View style={styles.skinRow}>
            {skinOptions.map((skin, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.skinButton,
                  { backgroundColor: SKIN_TONE_COLORS[index] || '#FFDCB1' },
                ]}
                onPress={() => handleSelect(index)}
                activeOpacity={0.8}
              >
                <ThemedText
                  size={16}
                  style={styles.skinEmoji}
                >
                  {skin.native}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </ThemedView>
      </TouchableOpacity>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    borderRadius: 16,
    padding: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  label: {
    textAlign: 'center',
    marginBottom: 12,
  },
  skinRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  skinButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  skinEmoji: {
    textAlign: 'center',
  },
});

export default SkinToneSelector;