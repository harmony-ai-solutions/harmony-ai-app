import React, { memo, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Theme } from '../../theme/types';
import { EmojiSet } from '../../types/emoji';
import EmojiText from '../emoji/EmojiText';
import EmojiService from '../../services/EmojiService';

interface EmojiStyleCardProps {
  emojiSet: EmojiSet;
  label: string;
  description: string;
  sampleEmojis: string[];   // native emoji characters
  isActive: boolean;
  onPress: () => void;
  theme: Theme;
}

export const EmojiStyleCard: React.FC<EmojiStyleCardProps> = memo(({
  emojiSet,
  label,
  description,
  sampleEmojis,
  isActive,
  onPress,
  theme,
}) => {
  // Look up EmojiEntry for each sample emoji so sprite sheets can render
  const entries = useMemo(() => {
    return sampleEmojis.map(native => {
      const entry = EmojiService.getEmojiByNative(native);
      return { native, entry };
    });
  }, [sampleEmojis]);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.background.elevated,
          borderColor: isActive ? theme.colors.accent.primary : theme.colors.border.default,
        },
      ]}
      activeOpacity={0.7}
    >
      {isActive && (
        <View style={[styles.activeBadge, { backgroundColor: theme.colors.accent.primary }]}>
          <Icon name="check" size={14} color="#fff" />
        </View>
      )}

      <View style={styles.previewRow}>
        {entries.map(({ native, entry }, index) => (
          <EmojiText
            key={index}
            native={native}
            size={28}
            emojiEntry={entry}
            emojiSet={emojiSet}
          />
        ))}
      </View>

      <Text style={[styles.label, { color: theme.colors.text.primary }]}>{label}</Text>
      <Text style={[styles.description, { color: theme.colors.text.secondary }]}>{description}</Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 12, borderWidth: 2, position: 'relative', marginBottom: 12 },
  activeBadge: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  previewRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  label: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  description: { fontSize: 13 },
});
