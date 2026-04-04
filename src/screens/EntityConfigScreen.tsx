import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Appbar, FAB } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { SettingsMenu } from '../components/navigation/SettingsMenu';
import { EntityCard, EntityListItem } from '../components/entities/EntityCard';
import {
  getAllEntities,
  getEntityModuleMapping,
  deleteEntity,
} from '../database/repositories/entities';
import {
  getCharacterProfile,
  getCharacterImages,
} from '../database/repositories/characters';
import { createDataURL } from '../database/base64';
import { Entity } from '../database/models';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const EntityConfigScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { theme } = useAppTheme();
  const [menuVisible, setMenuVisible] = useState(false);
  const [entityItems, setEntityItems] = useState<EntityListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadEntities = async () => {
    setIsLoading(true);
    try {
      const entities = await getAllEntities();
      const items: EntityListItem[] = await Promise.all(
        entities.map(async (entity: Entity) => {
          // Load character profile name + image
          let profileName: string | null = null;
          let profileImageUri: string | null = null;
          if (entity.character_profile_id) {
            const profile = await getCharacterProfile(
              entity.character_profile_id,
            );
            profileName = profile?.name ?? null;
            if (profile) {
              const images = await getCharacterImages(profile.id);
              const primary = images.find(img => img.is_primary === true);
              profileImageUri = primary
                ? createDataURL(primary.image_data, primary.mime_type)
                : null;
            }
          }

          // Load module mapping
          const mapping = await getEntityModuleMapping(entity.id);

          // Determine active module names
          const activeModules: string[] = [];
          if (mapping) {
            if (mapping.backend_config_id) activeModules.push('Backend');
            if (mapping.cognition_config_id) activeModules.push('Cognition');
            if (mapping.tts_config_id) activeModules.push('TTS');
            if (mapping.stt_config_id) activeModules.push('STT');
            if (mapping.vision_config_id) activeModules.push('Vision');
            if (mapping.rag_config_id) activeModules.push('Memory');
            if (mapping.imagination_config_id)activeModules.push('Imagination');
            if (mapping.movement_config_id)activeModules.push('Movement');
          }

          return {
            entity,
            characterProfileName: profileName,
            characterProfileImageUri: profileImageUri,
            moduleMapping: mapping,
            activeModuleNames: activeModules,
          };
        }),
      );
      setEntityItems(items);
    } catch (err) {
      console.error('Failed to load entities:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Reload on focus (handles return from EntityConfigEdit)
  useFocusEffect(
    useCallback(() => {
      loadEntities();
    }, []),
  );

  const handleDelete = (item: EntityListItem) => {
    Alert.alert(
      'Delete Entity',
      `Delete "${item.entity.alias ?? item.entity.id.substring(0, 8)}"? ` +
        'Chat history will be preserved but the entity will no longer be accessible.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteEntity(item.entity.id);
              setEntityItems(prev =>
                prev.filter(e => e.entity.id !== item.entity.id),
              );
            } catch {
              Alert.alert('Error', 'Failed to delete entity.');
            }
          },
        },
      ],
    );
  };

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      <Appbar.Header
        style={[
          styles.header,
          { backgroundColor: theme.colors.background.surface },
        ]}
      >
        <Appbar.BackAction
          color={theme.colors.text.primary}
          onPress={() => navigation.goBack()}
        />
        <Appbar.Content
          title="Entity Config"
          titleStyle={{ color: theme.colors.text.primary, fontWeight: 'bold' }}
        />
        <Appbar.Action
          icon="menu"
          color={theme.colors.text.primary}
          onPress={() => setMenuVisible(true)}
        />
      </Appbar.Header>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : entityItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon
            name="robot-outline"
            size={72}
            color={theme.colors.text.muted}
          />
          <ThemedText weight="bold" size={18} style={styles.emptyTitle}>
            No AI entities configured
          </ThemedText>
          <ThemedText variant="muted" size={14} style={styles.emptySubtext}>
            Tap + to create your first AI chat partner.
          </ThemedText>
          <ThemedButton
            variant="primary"
            label="+ Create First AI"
            onPress={() => navigation.navigate('CreateAI', {})}
            style={styles.emptyButton}
          />
        </View>
      ) : (
        <FlatList
          data={entityItems}
          keyExtractor={item => item.entity.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <EntityCard
              item={item}
              onPress={() =>
                navigation.navigate('EntityConfigEdit', {
                  entityId: item.entity.id,
                })
              }
              onDelete={() => handleDelete(item)}
            />
          )}
        />
      )}

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.accent.primary }]}
        onPress={() => navigation.navigate('CreateAI', {})}
        color="#fff"
      />

      <SettingsMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onNavigate={screen => navigation.navigate(screen as any)}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { elevation: 4 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 12, paddingBottom: 80 },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: { textAlign: 'center', marginTop: 12 },
  emptySubtext: { textAlign: 'center' },
  emptyButton: { marginTop: 8, width: '100%' },
  fab: { position: 'absolute', bottom: 24, right: 24 },
});
