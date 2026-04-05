import React, { useState } from 'react';
import {
  View,
  TouchableOpacity,
  Image,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

// The EntityListItem type (matches definition in EntityConfigScreen)
export interface EntityListItem {
  entity: {
    id: string;
    alias: string | null;
    character_profile_id: string | null;
  };
  characterProfileName: string | null;
  characterProfileImageUri: string | null;
  moduleMapping: any | null;
  activeModuleNames: string[];
}

interface EntityCardProps {
  item: EntityListItem;
  onPress: () => void;
  onDelete: () => void;
}

export const EntityCard: React.FC<EntityCardProps> = ({
  item,
  onPress,
  onDelete,
}) => {
  const { theme } = useAppTheme();
  const [menuVisible, setMenuVisible] = useState(false);

  const displayName = item.entity.alias ?? item.entity.id.substring(0, 8) + '…';

  if (!theme) return null;

  return (
    <TouchableOpacity
      style={styles.cardOuter}
      onPress={onPress}
      activeOpacity={0.82}
    >
      <LinearGradient
        colors={[theme.colors.background.elevated, theme.colors.background.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* Prismatic tint overlay — top-left bleed */}
        <LinearGradient
          colors={[theme.colors.accent.primary + '14', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* Left accent stripe */}
        <LinearGradient
          colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.accentStripe}
          pointerEvents="none"
        />

        {/* Avatar */}
        <LinearGradient
          colors={[theme.colors.background.surface, theme.colors.background.base]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.avatar}
        >
          {item.characterProfileImageUri ? (
            <Image
              source={{ uri: item.characterProfileImageUri }}
              style={styles.avatarImage}
              resizeMode="cover"
            />
          ) : (
            <Icon
              name="robot-outline"
              size={28}
              color={theme.colors.text.muted}
            />
          )}
        </LinearGradient>

        {/* Main content */}
        <View style={styles.content}>
          {/* Entity alias */}
          <ThemedText weight="bold" size={15} numberOfLines={1}>
            {displayName}
          </ThemedText>

          {/* Character profile name */}
          <ThemedText
            variant="secondary"
            size={12}
            numberOfLines={1}
            style={styles.profileName}
          >
            {item.characterProfileName
              ? `Character: ${item.characterProfileName}`
              : 'No character profile'}
          </ThemedText>

          {/* Module chips */}
          {item.activeModuleNames.length > 0 ? (
            <View style={styles.chipsRow}>
              {item.activeModuleNames.map(name => (
                <View
                  key={name}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: theme.colors.accent.primary + '22',
                      borderColor: theme.colors.accent.primary + '44',
                    },
                  ]}
                >
                  <ThemedText
                    size={10}
                    style={{ color: theme.colors.accent.primary }}
                  >
                    {name}
                  </ThemedText>
                </View>
              ))}
            </View>
          ) : (
            <ThemedText variant="muted" size={11} style={styles.noModules}>
              No modules configured
            </ThemedText>
          )}
        </View>

        {/* Context menu button */}
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => setMenuVisible(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="dots-vertical" size={20} color={theme.colors.text.muted} />
        </TouchableOpacity>
      </LinearGradient>

      {/* Context menu modal */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setMenuVisible(false)}>
          <View style={styles.menuOverlay}>
            <TouchableWithoutFeedback>
              <LinearGradient
                colors={[theme.colors.background.elevated, theme.colors.background.surface]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.contextMenu}
              >
                <TouchableOpacity
                  style={styles.contextMenuItem}
                  onPress={() => {
                    setMenuVisible(false);
                    onPress();
                  }}
                >
                  <Icon
                    name="pencil"
                    size={18}
                    color={theme.colors.text.primary}
                    style={styles.contextMenuIcon}
                  />
                  <ThemedText size={15}>Edit Settings</ThemedText>
                </TouchableOpacity>
                <View
                  style={[
                    styles.menuDivider,
                    { backgroundColor: 'rgba(255,255,255,0.07)' },
                  ]}
                />
                <TouchableOpacity
                  style={styles.contextMenuItem}
                  onPress={() => {
                    setMenuVisible(false);
                    onDelete();
                  }}
                >
                  <Icon
                    name="delete-outline"
                    size={18}
                    color={theme.colors.status.error}
                    style={styles.contextMenuIcon}
                  />
                  <ThemedText
                    size={15}
                    style={{ color: theme.colors.status.error }}
                  >
                    Delete Entity
                  </ThemedText>
                </TouchableOpacity>
              </LinearGradient>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  cardOuter: {
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 5,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 12,
    gap: 12,
    overflow: 'hidden',
  },
  accentStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarImage: { width: '100%', height: '100%' },
  content: { flex: 1, gap: 3 },
  profileName: { opacity: 0.8 },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1,
  },
  noModules: { marginTop: 2 },
  menuButton: {
    padding: 4,
    alignSelf: 'flex-start',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contextMenu: {
    borderRadius: 12,
    minWidth: 200,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  contextMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  contextMenuIcon: { marginRight: 12 },
  menuDivider: { height: StyleSheet.hairlineWidth },
});
