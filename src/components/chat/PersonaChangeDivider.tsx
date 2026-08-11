import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '../themed/ThemedText';
import { Theme } from '../../theme/types';

interface PersonaChangeDividerProps {
  /** The persona the user is now chatting as */
  personaName: string;
  theme: Theme;
}

/**
 * PersonaChangeDivider — in-chat confirmation row shown when the user
 * switches persona. Mirrors the NewMessagesDivider anatomy (hairline line +
 * centered pill) so it reads as part of the chat's time/divider rhythm
 * rather than a system toast.
 */
export const PersonaChangeDivider: React.FC<PersonaChangeDividerProps> = ({
  personaName,
  theme,
}) => {
  return (
    <View style={styles.container}>
      <View style={[styles.line, { backgroundColor: theme.colors.border.default }]} />
      <View
        style={[
          styles.pill,
          { backgroundColor: theme.colors.background.surface, borderColor: theme.colors.border.default },
        ]}
      >
        <ThemedText size={12} variant="muted" weight="medium">
          Now chatting as {personaName}
        </ThemedText>
      </View>
      <View style={[styles.line, { backgroundColor: theme.colors.border.default }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 8,
  },
});

export default PersonaChangeDivider;
