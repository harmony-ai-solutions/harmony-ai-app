/**
 * EmojiActionCard - Compact row displaying a single emoji action mapping
 */
import React from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ThemedText } from '../themed/ThemedText';
import { EmojiText } from '../emoji/EmojiText';
import { EmojiAction } from '../../database/models';
import { Theme } from '../../theme/types';

interface EmojiActionCardProps {
  action: EmojiAction;
  onPress: () => void;
  onDelete: () => void;
  theme: Theme;
}

export const EmojiActionCard: React.FC<EmojiActionCardProps> = ({
  action,
  onPress,
  onDelete,
  theme,
}) => {
  const { colors } = theme;

  // Build effect summary text
  const effectParts: string[] = [];
  if (action.emotionEffect) {
    const sign = action.emotionEffect.delta >= 0 ? '+' : '';
    effectParts.push(`${action.emotionEffect.emotion} ${sign}${action.emotionEffect.delta}`);
  }
  if (action.metabolismVector) {
    effectParts.push(`${action.metabolismVector.type}: ${action.metabolismVector.item}`);
  }
  const effectSummary = effectParts.join(' · ');

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.6}
    >
      {/* Emoji */}
      <View style={styles.emojiCol}>
        <EmojiText native={action.emojiNative} size={24} />
      </View>

      {/* Text content */}
      <View style={styles.textCol}>
        {action.substitutionText ? (
          <ThemedText variant="primary" size={13} numberOfLines={1} style={styles.substitution}>
            {action.substitutionText}
          </ThemedText>
        ) : (
          <ThemedText variant="secondary" size={13} style={styles.substitution}>
            No substitution text
          </ThemedText>
        )}
        {effectSummary ? (
          <ThemedText variant="secondary" size={11} numberOfLines={1}>
            {effectSummary}
            {action.isDefault ? ' · default' : ''}
          </ThemedText>
        ) : action.isDefault ? (
          <ThemedText variant="secondary" size={11}>default</ThemedText>
        ) : null}
      </View>

      {/* Delete button */}
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={(e) => { e.stopPropagation(); onDelete(); }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name="close-circle" size={16} color={colors.text.muted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  emojiCol: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  substitution: {
    fontStyle: 'italic',
  },
  deleteBtn: {
    padding: 4,
  },
});

export default EmojiActionCard;
