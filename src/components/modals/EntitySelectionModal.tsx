import React, { useState, useEffect } from 'react';
import { StyleSheet, View, FlatList, TouchableOpacity } from 'react-native';
import { Modal, Portal, Avatar, List, Button, Divider, ActivityIndicator } from 'react-native-paper';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import { getAllEntities } from '../../database/repositories/entities';
import { getCharacterProfile, getPrimaryImage, imageToDataURL } from '../../database/repositories/characters';
import { Entity } from '../../database/models';
import { createLogger } from '../../utils/logger';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const log = createLogger('[EntitySelectionModal]');

interface EntitySelectionModalProps {
  visible: boolean;
  partnerEntityId: string;
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
  partnerEntityId: string,
  preSelectedEntityId?: string
): string | null => {
  // Filter out the partner entity
  const validEntities = entities.filter(e => e.id !== partnerEntityId);
  
  if (validEntities.length === 0) {
    return null; // No valid entities available
  }
  
  // If pre-selected, use it (if valid)
  if (preSelectedEntityId) {
    const isValid = validEntities.some(e => e.id === preSelectedEntityId);
    if (isValid) return preSelectedEntityId;
  }
  
  // Try to find "user" entity
  const userEntity = validEntities.find(e => e.id === 'user');
  if (userEntity) {
    return userEntity.id;
  }
  
  // Otherwise, return first valid entity
  return validEntities[0].id;
};

export const EntitySelectionModal: React.FC<EntitySelectionModalProps> = ({
  visible,
  partnerEntityId,
  onSelect,
  onCancel,
  preSelectedEntityId,
}) => {
  const theme = useAppTheme();
  const [entities, setEntities] = useState<EntityDisplayItem[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      loadEntities();
    }
  }, [visible, partnerEntityId]);

  const loadEntities = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const allEntities = await getAllEntities();
      const validEntities = allEntities.filter(e => e.id !== partnerEntityId);
      
      if (validEntities.length === 0) {
        setError('No entities available. Please create a user entity first.');
        setLoading(false);
        return;
      }
      
      // Load display information for each entity
      const displayItems: EntityDisplayItem[] = [];
      for (const entity of validEntities) {
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
        
        displayItems.push({
          entityId: entity.id,
          characterName,
          avatarUri,
        });
      }
      
      setEntities(displayItems);
      
      // Determine default selection
      const defaultId = determineDefaultEntity(
        allEntities,
        partnerEntityId,
        preSelectedEntityId
      );
      setSelectedEntityId(defaultId);
    } catch (err) {
      log.error('Failed to load entities:', err);
      setError('Failed to load entities. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderEntityItem = ({ item }: { item: EntityDisplayItem }) => (
    <TouchableOpacity onPress={() => setSelectedEntityId(item.entityId)}>
      <List.Item
        title={item.characterName}
        description={`Entity ID: ${item.entityId}`}
        left={() => (
          item.avatarUri ? (
            <Avatar.Image size={40} source={{ uri: item.avatarUri }} />
          ) : (
            <Avatar.Text 
              size={40} 
              label={item.characterName.substring(0, 2).toUpperCase()} 
            />
          )
        )}
        right={() => (
          selectedEntityId === item.entityId && (
            <Icon name="check-circle" size={24} color={theme?.theme?.colors.accent.primary} />
          )
        )}
        style={[
          styles.listItem,
          selectedEntityId === item.entityId && {
            backgroundColor: theme?.theme?.colors.background.elevated,
          },
        ]}
      />
      <Divider />
    </TouchableOpacity>
  );

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onCancel}
        contentContainerStyle={[
          styles.modalContainer,
          { backgroundColor: theme?.theme?.colors.background.surface },
        ]}
      >
        <ThemedView style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <ThemedText variant="primary" style={styles.title}>
              Chat As
            </ThemedText>
            <ThemedText variant="secondary" size={14}>
              Select which entity you want to impersonate
            </ThemedText>
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" />
            </View>
          ) : error ? (
            <View style={styles.errorContainer}>
              <Icon name="alert-circle" size={48} color={theme?.theme?.colors.status.error} />
              <ThemedText variant="secondary" style={styles.errorText}>
                {error}
              </ThemedText>
              <Button mode="contained" onPress={onCancel}>
                Close
              </Button>
            </View>
          ) : (
            <>
              <FlatList
                data={entities}
                renderItem={renderEntityItem}
                keyExtractor={(item) => item.entityId}
                style={styles.list}
              />

              {/* Actions */}
              <View style={styles.actions}>
                <Button mode="outlined" onPress={onCancel} style={styles.cancelButton}>
                  Cancel
                </Button>
                <Button
                  mode="contained"
                  onPress={() => selectedEntityId && onSelect(selectedEntityId)}
                  disabled={!selectedEntityId}
                  style={styles.confirmButton}
                >
                  Confirm
                </Button>
              </View>
            </>
          )}
        </ThemedView>
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    margin: 20,
    borderRadius: 12,
    maxHeight: '80%',
  },
  container: {
    padding: 20,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    marginBottom: 8,
  },
  list: {
    maxHeight: 400,
  },
  listItem: {
    paddingVertical: 8,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  errorContainer: {
    padding: 40,
    alignItems: 'center',
  },
  errorText: {
    marginTop: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
  },
  confirmButton: {
    flex: 1,
  },
});
