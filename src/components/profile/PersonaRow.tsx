/**
 * PersonaRow — obsidian-glass persona list row for the My Profile screen.
 *
 * Displays:
 *   - Persona avatar (shared ProfileAvatar, compact ring)
 *   - Name (medium) + description (muted, 1 line)
 *   - "Active" accent chip when this persona is the global "Chatting as"
 *     identity
 *   - Chevron / edit affordance
 *
 * Tapping the row opens persona editing; long-press (or a secondary affordance)
 * can be wired to "chat as this persona".
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ProfileAvatar } from './ProfileAvatar';

interface PersonaRowProps {
  name: string;
  description?: string | null;
  avatarUri?: string | null;
  isActive?: boolean;
  onPress: () => void;
  /** When provided, renders a trailing "chat" icon button */
  onChatPress?: () => void;
}

export const PersonaRow: React.FC<PersonaRowProps> = ({
  name,
  description,
  avatarUri,
  isActive = false,
  onPress,
  onChatPress,
}) => {
  const { theme } = useAppTheme();

  if (!theme) return null;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.row}
      testID="persona-row"
      accessibilityLabel={`Persona: ${name}`}
    >
      <LinearGradient
        colors={[
          (theme.colors.accent.primary ?? '#7c3aed') + '12',
          'transparent',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Active accent pip */}
      {isActive && (
        <LinearGradient
          colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.activePip}
        />
      )}

      {/* Avatar */}
      <ProfileAvatar name={name} uri={avatarUri} size={44} />

      {/* Name + description */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <ThemedText size={15} weight="medium" numberOfLines={1} style={styles.name}>
            {name}
          </ThemedText>
          {isActive && (
            <View style={styles.activeChip}>
              <ThemedText
                size={10}
                weight="bold"
                style={{ color: theme.colors.accent.primary }}
              >
                ACTIVE
              </ThemedText>
            </View>
          )}
        </View>
        {description ? (
          <ThemedText size={12} variant="muted" numberOfLines={1}>
            {description}
          </ThemedText>
        ) : (
          <ThemedText size={12} variant="muted" numberOfLines={1}>
            —
          </ThemedText>
        )}
      </View>

      {/* Trailing actions */}
      <View style={styles.actions}>
        {onChatPress && (
          <TouchableOpacity
            onPress={onChatPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.chatButton}
            testID="persona-chat-button"
          >
            <Icon
              name="chat-processing-outline"
              size={18}
              color={theme.colors.accent.primary}
            />
          </TouchableOpacity>
        )}
        <Icon
          name="chevron-right"
          size={20}
          color={theme.colors.text.muted}
        />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    overflow: 'hidden',
    gap: 12,
  },
  activePip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flexShrink: 1,
  },
  activeChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#7c3aed' + '55',
    backgroundColor: '#7c3aed' + '22',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7c3aed' + '22',
  },
});

export default PersonaRow;
