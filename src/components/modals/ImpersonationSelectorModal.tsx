import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Modal, Portal, ActivityIndicator } from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { getAllEntities } from '../../database/repositories/entities';
import {
  getCharacterProfile,
  getPrimaryImage,
  imageToDataURL,
} from '../../database/repositories/characters';
import { Entity } from '../../database/models';
import { createLogger } from '../../utils/logger';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const log = createLogger('[ImpersonationSelectorModal]');

interface ImpersonationSelectorModalProps {
  visible: boolean;
  onSelect: (entityId: string) => void;
  onCancel: () => void;
  preSelectedEntityId?: string;
}

interface EntityDisplayItem {
  entityId: string;
  characterName: string;
  avatarUri: string | null;
}

const determineDefaultEntity = (
  entities: Entity[],
  preSelectedEntityId?: string,
): string | null => {
  if (entities.length === 0) return null;

  if (preSelectedEntityId) {
    const isValid = entities.some(e => e.id === preSelectedEntityId);
    if (isValid) return preSelectedEntityId;
  }

  const userEntity = entities.find(e => e.id === 'user');
  if (userEntity) return userEntity.id;

  return entities[0].id;
};

export const ImpersonationSelectorModal: React.FC<
  ImpersonationSelectorModalProps
> = ({ visible, onSelect, onCancel, preSelectedEntityId }) => {
  const { theme } = useAppTheme();
  const [entities, setEntities] = useState<EntityDisplayItem[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      loadEntities();
    }
  }, [visible]);

  const loadEntities = async () => {
    setLoading(true);
    setError(null);

    try {
      const allEntities = await getAllEntities();

      if (allEntities.length === 0) {
        setError('No entities available. Please create a user entity first.');
        setLoading(false);
        return;
      }

      const displayItems: EntityDisplayItem[] = [];
      for (const entity of allEntities) {
        let characterName = entity.id;
        let avatarUri: string | null = null;

        if (entity.character_profile_id) {
          const profile = await getCharacterProfile(entity.character_profile_id);
          if (profile) {
            characterName = profile.name;
          }
          const image = await getPrimaryImage(entity.character_profile_id);
          if (image) {
            avatarUri = imageToDataURL(image);
          }
        }

        displayItems.push({ entityId: entity.id, characterName, avatarUri });
      }

      setEntities(displayItems);
      const defaultId = determineDefaultEntity(allEntities, preSelectedEntityId);
      setSelectedEntityId(defaultId);
    } catch (err) {
      log.error('Failed to load entities:', err);
      setError('Failed to load entities. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!theme) return null;

  const accentPrimary = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  const renderEntityItem = ({ item }: { item: EntityDisplayItem }) => {
    const isSelected = selectedEntityId === item.entityId;
    return (
      <TouchableOpacity
        onPress={() => setSelectedEntityId(item.entityId)}
        activeOpacity={0.65}
        style={[
          styles.entityRow,
          isSelected && { backgroundColor: accentPrimary + '18' },
        ]}
      >
        {/* Left accent pip for selected */}
        {isSelected && (
          <LinearGradient
            colors={[accentPrimary, accentSecondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.rowPip}
          />
        )}

        {/* Avatar */}
        <View
          style={[
            styles.avatarContainer,
            {
              borderColor: isSelected
                ? accentPrimary + '88'
                : theme.colors.border.default + '44',
            },
          ]}
        >
          {item.avatarUri ? (
            <Image
              source={{ uri: item.avatarUri }}
              style={styles.avatarImage}
              resizeMode="cover"
            />
          ) : (
            <LinearGradient
              colors={[accentPrimary + '44', theme.colors.background.elevated]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarFallback}
            >
              <ThemedText
                size={14}
                weight="bold"
                style={{ color: accentPrimary }}
              >
                {item.characterName.substring(0, 2).toUpperCase()}
              </ThemedText>
            </LinearGradient>
          )}
        </View>

        {/* Name + ID */}
        <View style={styles.entityInfo}>
          <ThemedText
            size={15}
            weight={isSelected ? 'bold' : 'medium'}
            variant={isSelected ? 'accent' : 'primary'}
            numberOfLines={1}
          >
            {item.characterName}
          </ThemedText>
          <ThemedText size={12} variant="muted" numberOfLines={1}>
            {item.entityId}
          </ThemedText>
        </View>

        {/* Check icon */}
        {isSelected && (
          <Icon name="check-circle" size={20} color={accentPrimary} />
        )}

        {/* Row separator */}
        <View
          style={[
            styles.rowSeparator,
            { backgroundColor: theme.colors.border.default + '44' },
          ]}
        />
      </TouchableOpacity>
    );
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onCancel}
        contentContainerStyle={styles.modalOuter}
      >
        <View style={styles.modalShell}>
          {/* Gradient background */}
          <LinearGradient
            colors={[
              theme.colors.background.elevated,
              theme.colors.background.surface,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[StyleSheet.absoluteFillObject, styles.modalRadius]}
          />

          {/* Prismatic tint */}
          <LinearGradient
            colors={[accentPrimary + '10', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.6 }}
            style={[StyleSheet.absoluteFillObject, styles.modalRadius]}
            pointerEvents="none"
          />

          {/* Top accent stripe */}
          <LinearGradient
            colors={[accentPrimary + 'CC', accentSecondary + '66', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.topStripe}
          />

          {/* Header */}
          <View style={styles.header}>
            <ThemedText size={18} weight="bold" style={styles.title}>
              Chatting As
            </ThemedText>
            <ThemedText variant="muted" size={13} style={styles.subtitle}>
              Select the persona you want to use across all chats
            </ThemedText>
          </View>

          {/* Hairline separator */}
          <View
            style={[
              styles.headerSeparator,
              { backgroundColor: theme.colors.border.default + '55' },
            ]}
          />

          {/* Content */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={accentPrimary} />
            </View>
          ) : error ? (
            <View style={styles.errorContainer}>
              <Icon
                name="alert-circle"
                size={48}
                color={theme.colors.status.error}
              />
              <ThemedText variant="muted" style={styles.errorText}>
                {error}
              </ThemedText>
              <ThemedButton variant="secondary" label="Close" onPress={onCancel} />
            </View>
          ) : (
            <>
              <FlatList
                data={entities}
                renderItem={renderEntityItem}
                keyExtractor={item => item.entityId}
                style={styles.list}
                ItemSeparatorComponent={null}
              />

              {/* Hairline before actions */}
              <View
                style={[
                  styles.actionsSeparator,
                  { backgroundColor: theme.colors.border.default + '55' },
                ]}
              />

              {/* Action buttons */}
              <View style={styles.actions}>
                <ThemedButton
                  variant="secondary"
                  label="Cancel"
                  onPress={onCancel}
                  style={styles.button}
                />
                <ThemedButton
                  variant="primary"
                  label="Confirm"
                  onPress={() => {
                    if (selectedEntityId) onSelect(selectedEntityId);
                  }}
                  disabled={!selectedEntityId}
                  style={styles.button}
                />
              </View>
            </>
          )}
        </View>
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  modalOuter: {
    margin: 20,
    borderRadius: 16,
    maxHeight: '80%',
  },
  modalShell: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalRadius: {
    borderRadius: 16,
  },
  topStripe: {
    height: 2,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    alignItems: 'center',
  },
  title: {
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 18,
  },
  headerSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 0,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  errorContainer: {
    padding: 32,
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    textAlign: 'center',
    lineHeight: 20,
  },
  list: {
    maxHeight: 300,
  },
  // ── Entity row ──
  entityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  rowPip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 3,
  },
  avatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarImage: {
    width: 44,
    height: 44,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  entityInfo: {
    flex: 1,
    gap: 2,
  },
  rowSeparator: {
    position: 'absolute',
    left: 76,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  // ── Actions ──
  actionsSeparator: {
    height: StyleSheet.hairlineWidth,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 16,
    gap: 12,
  },
  button: {
    minWidth: 100,
  },
});
