/**
 * PersonaRow — obsidian-glass persona list row (My Profile screen, recreates the
 * 5-4-deleted component with the review fixes).
 *
 * Displays:
 *   - Persona avatar (shared ProfileAvatar, compact ring)
 *   - Name (medium) + description (muted, 1 line)
 *   - "Active" accent chip when this persona is the global "Chatting as"
 *     identity
 *   - Trailing pencil icon → edit (PersonaEditScreen)
 *
 * Interaction model: tapping the ROW sets this persona active (the settings-side
 * switch); the trailing pencil opens the editor. All colors come from
 * useAppTheme() — no hardcoded hex.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { ProfileAvatar } from './ProfileAvatar';

interface PersonaRowProps {
  name: string;
  description?: string | null;
  avatarUri?: string | null;
  isActive?: boolean;
  /** Tap the row = set this persona active. */
  onPress: () => void;
  /** Tap the trailing pencil = open the persona editor. */
  onEditPress: () => void;
}

export const PersonaRow: React.FC<PersonaRowProps> = ({
  name,
  description,
  avatarUri,
  isActive = false,
  onPress,
  onEditPress,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('profile');

  if (!theme) return null;

  const accent = theme.colors.accent.primary;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.row}
      testID="persona-row"
      accessibilityLabel={`${name}${isActive ? ' (active)' : ''}`}
      accessibilityRole="button"
    >
      <LinearGradient
        colors={[accent + '12', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Active accent pip */}
      {isActive && (
        <LinearGradient
          colors={[accent, theme.colors.accent.secondary]}
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
            <View
              style={[
                styles.activeChip,
                {
                  borderColor: accent + '55',
                  backgroundColor: accent + '22',
                },
              ]}
            >
              <ThemedText
                size={10}
                weight="bold"
                style={{ color: accent }}
              >
                {t('personaActiveChip')}
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

      {/* Trailing edit affordance (pencil) → PersonaEditScreen */}
      <TouchableOpacity
        onPress={() => {
          hapticLightPress();
          onEditPress();
        }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[styles.editButton, { backgroundColor: accent + '22' }]}
        testID="persona-row-edit"
        accessibilityLabel="Edit persona"
        accessibilityRole="button"
      >
        <Icon name="pencil-outline" size={18} color={accent} />
      </TouchableOpacity>
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
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default PersonaRow;
