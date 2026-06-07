/**
 * EmojiItem - Touchable button for emoji picker grid
 */
import React, { memo, useState } from 'react';
import { TouchableOpacity, StyleSheet, View, Modal, Text } from 'react-native';
import { useEmoji } from '../../contexts/EmojiContext';
import { EmojiEntry } from '../../types/emoji';
import { EmojiAction } from '../../database/models';
import { Theme } from '../../theme/types';
import EmojiText from './EmojiText';

// ActionPreviewPopup sub-component
interface ActionPreviewPopupProps {
  emoji: EmojiEntry;
  action: EmojiAction;
  theme: Theme;
  visible: boolean;
  onDismiss: () => void;
}

const ActionPreviewPopup: React.FC<ActionPreviewPopupProps> = ({
  emoji,
  action,
  theme,
  visible,
  onDismiss,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <TouchableOpacity
        style={styles.popupOverlay}
        activeOpacity={1}
        onPress={onDismiss}
      >
        <View style={[styles.popupCard, { backgroundColor: theme.colors.background.elevated }]}>
          <Text style={styles.popupEmoji}>{emoji.native}</Text>
          <Text style={[styles.popupTitle, { color: theme.colors.text.primary }]}>
            Emoji Action
          </Text>

          {action.emotionEffect && (
            <View style={styles.popupRow}>
              <Text style={[styles.popupLabel, { color: theme.colors.text.secondary }]}>
                Emotion:
              </Text>
              <View style={[styles.popupBadge, { backgroundColor: theme.colors.accent.primary }]}>
                <Text style={styles.popupBadgeText}>
                  {action.emotionEffect.emotion} {action.emotionEffect.delta > 0 ? '+' : ''}{action.emotionEffect.delta.toFixed(1)}
                </Text>
              </View>
            </View>
          )}

          {action.metabolismVector && (
            <View style={styles.popupRow}>
              <Text style={[styles.popupLabel, { color: theme.colors.text.secondary }]}>
                Metabolism:
              </Text>
              <View style={[styles.popupBadge, { backgroundColor: theme.colors.accent.secondary }]}>
                <Text style={styles.popupBadgeText}>
                  {action.metabolismVector.type} · {action.metabolismVector.item}
                </Text>
              </View>
            </View>
          )}

          {action.substitutionText && (
            <Text style={[styles.popupSubstitution, { color: theme.colors.text.muted }]}>
              {action.substitutionText}
            </Text>
          )}

          <Text style={[styles.popupFooter, { color: theme.colors.text.muted }]}>
            Tap anywhere to dismiss
          </Text>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

interface EmojiItemProps {
  emoji: EmojiEntry;
  size: number;
  onPress: (emoji: EmojiEntry) => void;
  onLongPress?: (emoji: EmojiEntry) => void;
  action?: EmojiAction | null;
  theme?: Theme;
}

export const EmojiItem: React.FC<EmojiItemProps> = memo(({ emoji, size, onPress, onLongPress, action, theme }) => {
  const { skinTone } = useEmoji();
  const [popupVisible, setPopupVisible] = useState(false);

  const hasAction = action !== null && action !== undefined;
  const showDot = hasAction && theme !== undefined;

  // Get skin tone variant (skinTone is 1-6, but we need to find matching skin)
  const getSkinToneNative = (): string => {
    // Default to first skin (usually light skin)
    if (skinTone <= 1 || !emoji.skins || emoji.skins.length === 0) {
      return emoji.native;
    }

    // Find matching skin tone (emoji-mart skin tones are 1-6)
    const skinIndex = skinTone - 1;
    if (skinIndex < emoji.skins.length) {
      return emoji.skins[skinIndex].native;
    }

    return emoji.native;
  };

  const handlePress = () => {
    onPress(emoji);
  };

  const handleLongPress = () => {
    if (hasAction && theme) {
      setPopupVisible(true);
    } else if (onLongPress) {
      onLongPress(emoji);
    }
  };

  const handlePopupDismiss = () => {
    setPopupVisible(false);
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.container, { width: size, height: size }]}
        onPress={handlePress}
        onLongPress={handleLongPress}
        activeOpacity={0.7}
        delayLongPress={300}
      >
        <EmojiText
          native={getSkinToneNative()}
          size={size * 0.8}
          emojiEntry={emoji}
        />
        {showDot && (
          <View
            style={[
              styles.actionDot,
              { backgroundColor: theme.colors.accent.primary },
            ]}
          />
        )}
      </TouchableOpacity>
      {hasAction && theme && (
        <ActionPreviewPopup
          emoji={emoji}
          action={action!}
          theme={theme}
          visible={popupVisible}
          onDismiss={handlePopupDismiss}
        />
      )}
    </>
  );
});

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  actionDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  popupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupCard: {
    width: '80%',
    maxWidth: 300,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  popupEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  popupTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  popupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  popupLabel: {
    fontSize: 14,
    marginRight: 8,
  },
  popupBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  popupBadgeText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
  },
  popupSubstitution: {
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 8,
    textAlign: 'center',
  },
  popupFooter: {
    fontSize: 12,
    marginTop: 16,
  },
});

export default EmojiItem;