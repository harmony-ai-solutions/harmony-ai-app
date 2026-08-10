import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ThemedFab } from '../components/themed/ThemedFab';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { createLogger } from '../utils/logger';

const log = createLogger('[EntityConfigScreen]');
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
  const { showAlert } = useAppAlert();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('entityConfig');
  const [entityItems, setEntityItems] = useState<EntityListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadEntities = async () => {
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
      log.error('Failed to load entities:', err);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEntities();
  }, []);

  // Reload on focus (handles return from EntityConfigEdit)
  useFocusEffect(
    useCallback(() => {
      loadEntities();
    }, []),
  );

  const handleDelete = (item: EntityListItem) => {
    const entityName = item.characterProfileName || item.entity.alias || item.entity.id.substring(0, 8);
    showAlert(
      t('deleteEntity'),
      t('deleteConfirm', { name: entityName }),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('common:delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteEntity(item.entity.id);
              setEntityItems(prev =>
                prev.filter(e => e.entity.id !== item.entity.id),
              );
            } catch {
              showAlert(t('common:error'), t('deleteFailed') || 'Failed to delete entity.');
            }
          },
        },
      ],
    );
  };

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('title')}
        onBack={() => navigation.goBack()}
      />

      {/* FlatList ALWAYS renders so RefreshControl is always reachable */}
      <FlatList style={{ flex: 1 }}
        data={entityItems}
        keyExtractor={item => item.entity.id}
        contentContainerStyle={[
          styles.listContent,
          { flexGrow: 1, paddingBottom: 80 + safeBottom },
          entityItems.length === 0 && styles.emptyListContent,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.accent.primary]}
            tintColor={theme.colors.accent.primary}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={theme.colors.accent.primary} />
            </View>
          ) : (
            <ThemedEmptyState
              icon="robot-outline"
              title="No AI entities configured"
              subtitle="Tap + to create your first AI chat partner."
              style={styles.emptyContainer}
              action={
                <ThemedButton
                  variant="primary"
                  label="+ Create First AI"
                  onPress={() => navigation.navigate('CreateAI', {})}
                  style={styles.emptyButton}
                />
              }
            />
          )
        }
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

      {/* FAB — hide during initial load */}
      {!isLoading && (
        <ThemedFab icon="plus" onPress={() => navigation.navigate('CreateAI', {})} style={{ bottom: 24 + safeBottom }} />
      )}
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { elevation: 4 },
  centered: { paddingTop: 100, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 12, paddingBottom: 80 },
  emptyListContent: { flex: 1 },
  emptyContainer: {
    width: '100%',
  },
  emptyButton: { width: '100%' },
  fab: { position: 'absolute', bottom: 24, right: 24 },
});
