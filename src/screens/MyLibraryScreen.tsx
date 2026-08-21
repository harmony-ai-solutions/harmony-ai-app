/**
 * MyLibraryScreen — everything the user has acquired (purchases + free +
 * own). Merges the local cache with the cloud account library so items follow
 * them across devices. Contains link text/browse content.
 */
import React, { useCallback, useState } from 'react';
import { FlatList, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { LibraryItemRow } from '../components/market/LibraryItemRow';
import { getOwnedAssets, type OwnedAsset } from '../database/repositories/marketplace';
import marketplaceApiService from '../services/marketplace/MarketplaceApiService';
import { ownedAssetDtoToCache } from '../services/marketplace/marketplaceTypes';

export const MyLibraryScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation('market');
  const { theme } = useAppTheme();

  const [assets, setAssets] = useState<OwnedAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      // Local-first: render cache immediately.
      const local = await getOwnedAssets();
      setAssets(local);
      // Cloud refresh (non-blocking) — merges account data from elsewhere.
      try {
        const dto = await marketplaceApiService.getLibrary();
        const cloud = dto.map(ownedAssetDtoToCache);
        setAssets(prev => {
          const seen = new Set(prev.map(p => p.id));
          const merged = [...prev];
          for (const item of cloud) {
            if (!seen.has(item.id)) {
              merged.push(item);
              seen.add(item.id);
            }
          }
          return merged;
        });
      } catch {
        // offline — keep cache
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!theme) return null;

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScreenHeader title={t('myLibrary')} onBack={() => navigation.goBack()} />
      <FlatList
        style={styles.list}
        data={assets}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={theme.colors.accent.primary} />
            </View>
          ) : (
            <ThemedEmptyState
              icon="bookmark-outline"
              title={t('libraryEmpty')}
              subtitle={t('libraryEmptyHint')}
            />
          )
        }
        renderItem={({ item }) => (
          <LibraryItemRow
            title={item.title}
            itemType={item.itemType}
            kind={item.kind}
            acquiredLabel={new Date(item.acquiredAt).toLocaleDateString()}
            onPress={() => {
              if (item.itemType === 'character') {
                // Character clones are separate profiles; open My Profile
                // characters via local lookup.
              }
              navigation.navigate('ContentAsset', { entryId: item.id });
            }}
          />
        )}
      />
    </ThemedView>
  );
};

export default MyLibraryScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { flex: 1 },
  listContent: { padding: 20 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
});