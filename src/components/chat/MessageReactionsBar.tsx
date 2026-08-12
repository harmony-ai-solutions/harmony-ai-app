import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';

interface MessageReactionsBarProps {
  reactionsJson?: string | null;
  onReact?: (emoji: string) => void;
  /** Horizontal alignment of the floating chips row under the bubble. */
  align?: 'left' | 'right';
}

/**
 * MessageReactionsBar — renders the emoji reactions attached to a message as
 * small chips below the bubble. Tapping a chip toggles that reaction.
 */
export const MessageReactionsBar: React.FC<MessageReactionsBarProps> = ({
  reactionsJson,
  onReact,
  align = 'left',
}) => {
  const { theme } = useAppTheme();

  if (!theme) return null;

  let reactions: string[] = [];
  if (reactionsJson) {
    try {
      const parsed = JSON.parse(reactionsJson);
      if (Array.isArray(parsed)) {
        reactions = parsed.filter((r): r is string => typeof r === 'string');
      }
    } catch {
      reactions = [];
    }
  }

  if (reactions.length === 0) return null;

  return (
    <View
      style={[
        styles.container,
        align === 'right' ? styles.containerRight : styles.containerLeft,
      ]}
    >
      {reactions.map((emoji, index) => (
        <TouchableOpacity
          key={`${emoji}-${index}`}
          onPress={() => {
            if (!onReact) return;
            hapticLightPress();
            onReact(emoji);
          }}
          style={[
            styles.chip,
            { backgroundColor: theme.colors.accent.primary + '14' },
          ]}
          activeOpacity={0.7}
        >
          <ThemedText size={15}>{emoji}</ThemedText>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  containerLeft: {
    justifyContent: 'flex-start',
  },
  containerRight: {
    justifyContent: 'flex-end',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
