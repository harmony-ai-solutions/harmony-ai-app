import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedFab } from '../components/themed/ThemedFab';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD, TAB_BAR_FAB_OFFSET } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';
import { createLogger } from '../utils/logger';

const log = createLogger('[CharactersScreen]');
import { CharacterProfileCard } from '../components/characters/CharacterProfileCard';
import {
  getAllCharacterProfiles,
  getCharacterImages,
  deleteCharacterProfile,
} from '../database/repositories/characters';
import { createDataURL } from '../database/base64';
import { CharacterProfile } from '../database/models';

// Tab-screen navigation: routes are dispatched to the parent root stack.
// Using 'any' here avoids CompositeNavigationProp boilerplate while
// React Navigation v7 resolves routes across nested navigators at runtime.
type Nav = NativeStackNavigationProp<RootStackParamList>;

export const CharactersScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('characters');

  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [primaryImages, setPrimaryImages] = useState<
    Record<string, string | null>
  >({});
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Reload on focus (handles return from edit screen)
  useFocusEffect(
    useCallback(() => {
      loadProfiles();
    }, []),
  );

  const loadProfiles = async () => {
    setIsLoading(true);
    try {
      const data = await getAllCharacterProfiles();
      setProfiles(data);

      // Load primary images + image counts for all profiles in parallel
      const imageMap: Record<string, string | null> = {};
      const countMap: Record<string, number> = {};
      await Promise.all(
        data.map(async profile => {
          try {
            const images = await getCharacterImages(profile.id);
            const primary = images.find(img => img.is_primary === true);
            imageMap[profile.id] = primary
              ? createDataURL(primary.image_data, primary.mime_type)
              : null;
            countMap[profile.id] = images.length;
          } catch {
            imageMap[profile.id] = null;
            countMap[profile.id] = 0;
          }
        }),
      );
      setPrimaryImages(imageMap);
      setImageCounts(countMap);
    } catch (err) {
      log.error('Failed to load profiles:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredProfiles = profiles.filter(
    p =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.description?.toLowerCase().includes(searchQuery.toLowerCase()) ??
        false),
  );

  const handleEdit = (profile: CharacterProfile) => {
    navigation.navigate('CharacterProfileEdit', { profileId: profile.id });
  };

  const handleLongPress = (profile: CharacterProfile) => {
    showAlert(
      t('deleteConfirmTitle'),
      t('deleteConfirmMessage', { name: profile.name }),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('common:delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCharacterProfile(profile.id);
              setProfiles(prev => prev.filter(p => p.id !== profile.id));
              setPrimaryImages(prev => {
                const next = { ...prev };
                delete next[profile.id];
                return next;
              });
              setImageCounts(prev => {
                const next = { ...prev };
                delete next[profile.id];
                return next;
              });
            } catch {
              showAlert(t('common:error'), t('deleteFailed'));
            }
          },
        },
      ],
    );
  };

  const handleCreateNew = () => {
    navigation.navigate('CharacterProfileEdit', {}); // no profileId = create mode
  };

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;
  const inputBg = hexToRgba(baseHex, 0.55);

  return (
    <ThemedView style={styles.container}>
      {/* Header + search bar (child, like SearchScreen) */}
      <ScreenHeader title={t('title')}>
        <View
          style={[
            styles.searchContainer,
            { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25) },
          ]}
        >
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={theme.colors.text.muted}
            style={styles.searchIcon}
          />
          <TextInput
            style={[styles.searchInput, { color: theme.colors.text.primary }]}
            placeholder={t('searchPlaceholder')}
            placeholderTextColor={theme.colors.text.disabled}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <MaterialCommunityIcons
              name="close-circle"
              size={18}
              color={theme.colors.text.muted}
              onPress={() => setSearchQuery('')}
              style={styles.clearIcon}
            />
          )}
        </View>
      </ScreenHeader>

      {/* Content */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : filteredProfiles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="account-outline"
            size={72}
            color={theme.colors.text.muted}
          />
          <ThemedText weight="bold" size={18} style={styles.emptyTitle}>
            {searchQuery ? t('noResults') : t('noProfiles')}
          </ThemedText>
          <ThemedText variant="muted" size={14} style={styles.emptySubtext}>
            {searchQuery
              ? t('noResultsHint')
              : t('noProfilesHint')}
          </ThemedText>
          {!searchQuery && (
            <ThemedButton
              variant="primary"
              label={t('createFirst')}
              onPress={handleCreateNew}
              style={styles.emptyButton}
            />
          )}
        </View>
      ) : (
        <FlatList
          data={filteredProfiles}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[styles.listContent, { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom }]}
          renderItem={({ item }) => (
            <CharacterProfileCard
              profile={item}
              imageUri={primaryImages[item.id] ?? null}
              imageCount={imageCounts[item.id] ?? 0}
              onPress={() => handleEdit(item)}
              onLongPress={() => handleLongPress(item)}
            />
          )}
        />
      )}

      {/* FAB */}
      {!isLoading && (
        <ThemedFab icon="plus" onPress={handleCreateNew} style={{ bottom: TAB_BAR_FAB_OFFSET + safeBottom }} />
      )}

    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 48,
    marginTop: 12,
    marginBottom: 8,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  clearIcon: { marginLeft: 6 },
  listContent: { padding: 12, paddingBottom: 80 },
  columnWrapper: { gap: 12, marginBottom: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
});
