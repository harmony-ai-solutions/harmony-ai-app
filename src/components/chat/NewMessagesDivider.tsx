import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '../themed/ThemedText';
import { Theme } from '../../theme/types';

interface NewMessagesDividerProps {
  count: number;
  theme: Theme;
}

export const NewMessagesDivider: React.FC<NewMessagesDividerProps> = ({ count, theme }) => {
  return (
    <View style={[styles.container, { borderColor: theme.colors.accent.primary }]}>
      <View style={[styles.line, { backgroundColor: theme.colors.accent.primary }]} />
      <View style={[styles.textContainer, { backgroundColor: theme.colors.accent.primary }]}>
        <ThemedText style={[styles.text, { color: theme.colors.background.base }]}>
          {count} new message{count !== 1 ? 's' : ''}
        </ThemedText>
      </View>
      <View style={[styles.line, { backgroundColor: theme.colors.accent.primary }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginVertical: 8,
  },
  line: {
    flex: 1,
    height: 1,
  },
  textContainer: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginHorizontal: 8,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
