import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Theme } from '../../theme/types';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ThemeCardProps {
  theme: Theme;
  isActive: boolean;
  onPress: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const ThemeCard: React.FC<ThemeCardProps> = ({
  theme,
  isActive,
  onPress,
  onEdit,
  onDelete,
}) => {
  const { theme: currentTheme } = useAppTheme();

  if (!currentTheme) return null;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: currentTheme.colors.background.surface,
          borderColor: isActive
            ? currentTheme.colors.accent.primary
            : currentTheme.colors.border.default,
          borderWidth: isActive ? 2 : 1,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Color Preview */}
      <View style={styles.colorPreview}>
        <View style={[styles.colorSwatch, { backgroundColor: theme.colors.background.base }]} />
        <View style={[styles.colorSwatch, { backgroundColor: theme.colors.accent.primary }]} />
        <View style={[styles.colorSwatch, { backgroundColor: theme.colors.accent.secondary }]} />
        <View style={[styles.colorSwatch, { backgroundColor: theme.colors.status.success }]} />
      </View>

      {/* Theme Info */}
      <View style={styles.info}>
        <View style={styles.header}>
          <Text style={[styles.name, { color: currentTheme.colors.text.primary }]}>
            {theme.name}
          </Text>
          {isActive && (
            <Icon name="check-circle" size={20} color={currentTheme.colors.accent.primary} />
          )}
        </View>

        <Text style={[styles.description, { color: currentTheme.colors.text.secondary }]} numberOfLines={2}>
          {theme.description}
        </Text>

        {/* Badges */}
        <View style={styles.badges}>
          {theme.isCustom && (
            <View style={[styles.badge, { backgroundColor: currentTheme.colors.accent.primary + '20' }]}>
              <Text style={[styles.badgeText, { color: currentTheme.colors.accent.primary }]}>
                Custom
              </Text>
            </View>
          )}
          {theme.isSynced && (
            <Icon name="cloud-check" size={16} color={currentTheme.colors.accent.primary} />
          )}
        </View>
      </View>

      {/* Action Buttons */}
      {theme.isCustom && (
        <View style={styles.actionButtons}>
          {onEdit && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Icon name="pencil" size={20} color={currentTheme.colors.text.muted} />
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Icon name="trash-can" size={20} color={currentTheme.colors.status.error} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  colorPreview: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 12,
  },
  colorSwatch: {
    flex: 1,
    height: 32,
    borderRadius: 6,
  },
  info: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  description: {
    fontSize: 12,
    marginBottom: 8,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  actionButtons: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
  },
  actionButton: {
    padding: 8,
    marginLeft: 4,
  },
});
