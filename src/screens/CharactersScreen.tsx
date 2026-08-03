import React, { useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Animated,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { pick } from '@react-native-documents/picker';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
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
import { importCharacterCardFromFile, CharacterCardImportError } from '../services/CharacterCardImportService';

// Tab-screen navigation: routes are dispatched to the parent root stack.
// Using 'any' here avoids CompositeNavigationProp boilerplate while
// React Navigation v7 resolves routes across nested navigators at runtime.
type Nav = NativeStackNavigationProp<RootStackParamList>;

function importMessageKey(code?: string): string {
  switch (code) {
    case 'unsupported_type':
      return 'importUnsupportedType';
    case 'parse_failed':
      return 'importParseFailed';
    case 'name_required':
      return 'importNameRequired';
    case 'read_failed':
      return 'importReadFailed';
    default:
      return 'importParseFailed';
  }
}

export const CharactersScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { withExternalFlow } = useBiometricLock();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('characters');

  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [primaryImages, setPrimaryImages] = useState<
    Record<string, string | null>
  >({});
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const expandAnim = useRef(new Animated.Value(0)).current;

  // Reload on focus (handles return from edit screen)
  useFocusEffect(
    useCallback(() => {
      loadProfiles();
    }, []),
  );

  const loadProfiles = async () => {
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
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfiles();
    setRefreshing(false);
  }, []);

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

  const handleImportCard = async () => {
    let docs;
    try {
      // Opening the system file picker backgrounds the app (DocumentsUI is a
      // separate Activity). Run it as an external flow so the app-lock is
      // suspended for the picker round-trip instead of locking mid-import.
      docs = await withExternalFlow(() => pick({ type: ['image/png', 'application/json'] }));
    } catch {
      // User cancelled or picker error — silent.
      return;
    }
    const doc = docs[0];
    if (!doc) return;
    try {
      await importCharacterCardFromFile(doc.uri, doc.type ?? '');
      await loadProfiles();
    } catch (e) {
      const code = e instanceof CharacterCardImportError ? e.code : undefined;
      const messageKey = importMessageKey(code);
      showAlert(t('importFailed'), t(messageKey));
    }
  };

  // ── FAB speed dial (create / import) ───────────────────────────────────
  const openSheet = useCallback(() => {
    setExpanded(true);
    Animated.timing(expandAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [expandAnim]);

  const closeSheet = useCallback(() => {
    Animated.timing(expandAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) setExpanded(false);
      },
    );
  }, [expandAnim]);

  const toggleSheet = useCallback(() => {
    if (expanded) {
      closeSheet();
    } else {
      openSheet();
    }
  }, [expanded, openSheet, closeSheet]);

  const rotate = expandAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  const createOpacity = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const createTranslateY = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });
  const importOpacity = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const importTranslateY = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;
  const inputBg = hexToRgba(baseHex, 0.55);
  const speedActionBg = hexToRgba(theme.colors.background.elevated, 0.94);
  const speedActionBorder = hexToRgba(accent, 0.3);

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

      {/* FlatList ALWAYS renders so RefreshControl is always reachable.
          Use ListEmptyComponent for empty state, loading overlay for initial load. */}
      <FlatList style={{ flex: 1 }}
        data={filteredProfiles}
        keyExtractor={item => item.id}
        numColumns={2}
        columnWrapperStyle={filteredProfiles.length > 0 ? styles.columnWrapper : undefined}
        contentContainerStyle={[
          styles.listContent,
          { flexGrow: 1, paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom },
          filteredProfiles.length === 0 && styles.emptyListContent,
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
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons
                name={searchQuery ? 'file-search-outline' : 'account-outline'}
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
          )
        }
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

      {/* FAB speed dial — hide during initial load */}
      {!isLoading && (
        <>
          {expanded && (
            <TouchableOpacity
              style={[StyleSheet.absoluteFill, styles.backdrop]}
              activeOpacity={1}
              onPress={closeSheet}
              accessibilityLabel={t('common:cancel')}
            />
          )}

          <View style={[styles.fabGroup, { bottom: TAB_BAR_FAB_OFFSET + safeBottom }]}>
            {/* Import character card (PNG / JSON) */}
            <Animated.View
              style={[
                styles.speedAction,
                styles.speedActionImport,
                { opacity: importOpacity, transform: [{ translateY: importTranslateY }] },
              ]}
              pointerEvents={expanded ? 'auto' : 'none'}
            >
              <TouchableOpacity
                style={[styles.speedActionTouch, { backgroundColor: speedActionBg, borderColor: speedActionBorder }]}
                onPress={() => {
                  closeSheet();
                  handleImportCard();
                }}
                accessibilityRole="button"
                accessibilityLabel={t('importCardButton')}
                testID="import-character-card"
              >
                <MaterialCommunityIcons name="file-import-outline" size={18} color={accent} />
                <ThemedText size={13} weight="bold">
                  {t('importCardButton')}
                </ThemedText>
              </TouchableOpacity>
            </Animated.View>

            {/* Create new profile */}
            <Animated.View
              style={[
                styles.speedAction,
                styles.speedActionCreate,
                { opacity: createOpacity, transform: [{ translateY: createTranslateY }] },
              ]}
              pointerEvents={expanded ? 'auto' : 'none'}
            >
              <TouchableOpacity
                style={[styles.speedActionTouch, { backgroundColor: speedActionBg, borderColor: speedActionBorder }]}
                onPress={() => {
                  closeSheet();
                  handleCreateNew();
                }}
                accessibilityRole="button"
                accessibilityLabel={t('createProfile')}
                testID="create-profile-option"
              >
                <MaterialCommunityIcons name="account-plus-outline" size={18} color={accent} />
                <ThemedText size={13} weight="bold">
                  {t('createProfile')}
                </ThemedText>
              </TouchableOpacity>
            </Animated.View>

            {/* Main FAB — rotates into an ✕ when open */}
            <Animated.View style={{ transform: [{ rotate }] }}>
              <ThemedFab icon="plus" onPress={toggleSheet} style={styles.fabFab} />
            </Animated.View>
          </View>
        </>
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
  fabGroup: {
    position: 'absolute',
    right: 24,
    alignItems: 'flex-end',
    zIndex: 10,
    elevation: 10,
  },
  fabFab: {
    bottom: 0,
    right: 0,
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    zIndex: 5,
  },
  speedAction: {
    position: 'absolute',
    right: 0,
    zIndex: 10,
  },
  speedActionImport: {
    bottom: 120,
  },
  speedActionCreate: {
    bottom: 68,
  },
  speedActionTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  listContent: { padding: 12, paddingBottom: 80 },
  emptyListContent: { flex: 1, justifyContent: 'center' },
  columnWrapper: { gap: 12, marginBottom: 12 },
  centered: { paddingTop: 100, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: {
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
