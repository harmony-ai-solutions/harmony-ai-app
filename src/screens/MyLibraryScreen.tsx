/**
 * MyLibraryScreen — everything the user has acquired (purchases + free +
 * own). Loads from MarketplaceService.getLibrary() (in-memory stub) on focus.
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
import { getLibrary, type OwnedLibraryEntry } from '../services/marketplace/MarketplaceService';

export const MyLibraryScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation('market');
  const { theme } = useAppTheme();

  const [assets, setAssets] = useState<OwnedLibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setAssets(await getLibrary());
    } catch {
      setAssets([]);
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
            kind={item.asset.kind}
            acquiredKind={item.kind}
            acquiredLabel={new Date(item.acquiredAt).toLocaleDateString()}
            onPress={() => navigation.navigate('ContentAsset', { entryId: item.asset.id })}
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