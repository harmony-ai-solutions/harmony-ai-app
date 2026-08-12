import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Animated,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { pick } from '@react-native-documents/picker';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedFab } from '../components/themed/ThemedFab';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { TAB_BAR_CONTENT_PAD, TAB_BAR_FAB_OFFSET } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';
import { createLogger } from '../utils/logger';
import { TagChips } from '../components/character-card/TagChips';
import { parseJsonColumn } from '../components/character-card/lorebook';
import { useReducedMotion } from '../hooks/useReducedMotion';

const log = createLogger('[CharactersScreen]');
import { CharacterProfileCard } from '../components/characters/CharacterProfileCard';
import { ManageCategoriesModal } from '../components/characters/ManageCategoriesModal';
import { CharacterCardMenuModal } from '../components/characters/CharacterCardMenuModal';
import { AddToCategoryModal } from '../components/characters/AddToCategoryModal';
import {
  getAllCharacterProfiles,
  getCharacterImages,
  getDistinctTags,
  deleteCharacterProfile,
  createCharacterProfile,
  createCharacterImage,
  getFavoriteCharacterProfileIds,
  toggleCharacterFavorite,
  getCharacterCategories,
  createCharacterCategory,
  renameCharacterCategory,
  deleteCharacterCategory,
  getCharacterCategoryMembers,
  addCharacterToCategory,
  removeCharacterFromCategory,
  CharacterCategory,
} from '../database/repositories/characters';
import { createDataURL, base64ToUint8Array } from '../database/base64';
import RNFS from 'react-native-fs';
import {
  extractCharacterCardFromPNG,
  parseCharacterCard,
  mapCardToProfile,
  base64DecodeToUtf8,
} from '../utils/charactercard';
import type { TavernCardV2 } from '../utils/charactercard/types';
import {
  ImportReviewSheet,
  buildImportDetectionSummary,
} from '../components/character-card/ImportReviewSheet';
import type { ImportDetectionSummary } from '../components/character-card/ImportReviewSheet';
import {
  createEntity,
  createEntityModuleMapping,
  getEntityByCharacterProfileId,
} from '../database/repositories/entities';
import {
  deriveParticipantKey,
  deriveScopeFromParticipants,
} from '../database/repositories/interactions';
import { v7 as uuidv7 } from 'uuid';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { resolvePersonaId } from '../database/repositories/personas';
import { CharacterProfile } from '../database/models';
import { CharacterCardImportError } from '../services/CharacterCardImportService';
import syncService from '../services/SyncService';

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

/**
 * Read + parse a picked character card WITHOUT persisting (3-5). The parsed
 * card + optional embedded image are shown in the `ImportReviewSheet` first;
 * persistence happens only on an explicit sheet action. Mirrors the first four
 * steps of `CharacterCardImportService.importCharacterCardFromFile`.
 */
async function parseCardFile(
  uri: string,
  mime: string,
): Promise<{ card: TavernCardV2; imageBytes?: Uint8Array }> {
  if (!uri) {
    throw new CharacterCardImportError('no_file');
  }

  let b64: string;
  try {
    b64 = await RNFS.readFile(uri, 'base64');
  } catch {
    throw new CharacterCardImportError('read_failed');
  }

  const lowerMime = (mime || '').toLowerCase();
  const lowerUri = uri.toLowerCase();

  const isPNG = lowerMime === 'image/png' || lowerUri.endsWith('.png');
  const isJSON = lowerMime === 'application/json' || lowerUri.endsWith('.json');

  if (isPNG) {
    const bytes = base64ToUint8Array(b64);
    try {
      const result = extractCharacterCardFromPNG(bytes);
      return { card: result.card, imageBytes: result.imageBytes };
    } catch {
      throw new CharacterCardImportError('parse_failed');
    }
  } else if (isJSON) {
    const text = base64DecodeToUtf8(b64);
    if (text == null) {
      throw new CharacterCardImportError('parse_failed');
    }
    try {
      return { card: parseCharacterCard(text) };
    } catch {
      throw new CharacterCardImportError('parse_failed');
    }
  }

  throw new CharacterCardImportError('unsupported_type');
}

interface PendingImport {
  card: TavernCardV2;
  mapped: ReturnType<typeof mapCardToProfile>;
  summary: ImportDetectionSummary;
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
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  // ── 4-3: tag / creator filtering ──────────────────────────────────────────
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const filterBannerAnim = useRef(new Animated.Value(0)).current;
  const hasActiveFilters = selectedTags.length > 0 || creatorFilter !== null;

  // Fade/slide the active-filter banner in unless the OS wants reduced motion.
  useEffect(() => {
    if (!hasActiveFilters) return;
    if (reduceMotion) {
      filterBannerAnim.setValue(1);
      return;
    }
    filterBannerAnim.setValue(0);
    Animated.timing(filterBannerAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [hasActiveFilters, reduceMotion, filterBannerAnim]);

  // ── Favorites + categories ─────────────────────────────────────────────
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<CharacterCategory[]>([]);
  // activeFilter: 'all' | 'favorites' | category id
  const [activeFilter, setActiveFilter] = useState<string>('all');
  // Which profile is currently being assigned to categories (null = none)
  // Per-category membership cache: categoryId → Set<profileId>
  const [categoryMembers, setCategoryMembers] = useState<
    Record<string, Set<string>>
  >({});
  const [manageVisible, setManageVisible] = useState(false);
  // Which profile the long-press context menu is open for (null = closed)
  const [menuProfile, setMenuProfile] = useState<CharacterProfile | null>(null);
  // Which profile the "Add to category" picker is open for (null = closed)
  const [categoryPickProfile, setCategoryPickProfile] = useState<CharacterProfile | null>(null);

  /**
   * Load favorites + categories + per-category membership in parallel.
   * Membership is lazy — only the active category's member set is needed for
   * filtering, but we load all members so the category-assign modal can show
   * every profile's current assignment instantly.
   */
  const loadFavoritesAndCategories = useCallback(async () => {
    try {
      const [favIds, cats] = await Promise.all([
        getFavoriteCharacterProfileIds(),
        getCharacterCategories(),
      ]);
      setFavoriteIds(new Set(favIds));
      setCategories(cats);

      // Load membership for every category in parallel.
      const memberMap: Record<string, Set<string>> = {};
      await Promise.all(
        cats.map(async cat => {
          try {
            const ids = await getCharacterCategoryMembers(cat.id);
            memberMap[cat.id] = new Set(ids);
          } catch {
            memberMap[cat.id] = new Set();
          }
        }),
      );
      setCategoryMembers(memberMap);
    } catch (err) {
      log.error('Failed to load favorites/categories:', err);
    }
  }, []);

  // Reload on focus (handles return from edit screen)
  useFocusEffect(
    useCallback(() => {
      loadProfiles();
      loadFavoritesAndCategories();
    }, [loadFavoritesAndCategories]),
  );

  const loadProfiles = async () => {
    try {
      const data = await getAllCharacterProfiles();
      setProfiles(data);

      // Distinct library tags for the filter chip row (4-3) — isolated so a
      // tag-load failure never aborts the profile/image load below.
      try {
        const tags = await getDistinctTags();
        setAllTags(tags);
      } catch (tagErr) {
        log.warn('Failed to load distinct tags:', tagErr);
      }

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

/** Search + activeFilter (all/favorites/category) + tag (multi-OR) + creator filter. */
  const filteredProfiles = profiles.filter(p => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.description?.toLowerCase().includes(q) ?? false);
    if (!matchesSearch) return false;

    // Active filter: all / favorites / category id (AND-composed with the filters below)
    if (activeFilter === 'favorites' && !favoriteIds.has(p.id)) return false;
    if (activeFilter !== 'all' && !(categoryMembers[activeFilter]?.has(p.id) ?? false)) return false;

    if (selectedTags.length > 0) {
      const tags = parseJsonColumn<string[]>(p.tags) ?? [];
      const matchesAnyTag = tags.some(tag =>
        selectedTags.some(sel => sel.toLowerCase() === tag.toLowerCase()),
      );
      if (!matchesAnyTag) return false;
    }

    if (creatorFilter) {
      const creator = (p.creator ?? '').trim();
      if (creator.toLowerCase() !== creatorFilter.toLowerCase()) return false;
    }

    return true;
  });

  const handleCreatorPress = useCallback((creator: string) => {
    setCreatorFilter(creator);
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTags([]);
    setCreatorFilter(null);
  }, []);

  /**
   * Filter chips: first two are "All" and "Favorites", then each user
   * category, then a gear button to manage categories.
   */
  interface FilterChipItem {
    key: string;
    label: string;
    icon?: string;
    isManage?: boolean;
  }
  const filterChips: FilterChipItem[] = [
    { key: 'all', label: t('filterAll'), icon: 'view-grid-outline' },
    { key: 'favorites', label: t('filterFavorites'), icon: 'heart-outline' },
    ...categories.map(cat => ({ key: cat.id, label: cat.name, icon: 'shape-outline' })),
    { key: 'manage', label: '', isManage: true },
  ];

  const handleToggleFavorite = async (profile: CharacterProfile) => {
    try {
      const nowFav = await toggleCharacterFavorite(profile.id);
      setFavoriteIds(prev => {
        const next = new Set(prev);
        if (nowFav) next.add(profile.id);
        else next.delete(profile.id);
        return next;
      });
    } catch (err) {
      log.error('Failed to toggle favorite:', err);
    }
  };

  /**
   * Toggle a profile's membership in a category (used by the manage-categories
   * sheet's member editor).
   */
  const handleAssignToggle = async (profileId: string, categoryId: string, assign: boolean) => {
    try {
      if (assign) {
        await addCharacterToCategory(profileId, categoryId);
      } else {
        await removeCharacterFromCategory(profileId, categoryId);
      }
      // Update membership cache
      setCategoryMembers(prev => {
        const next = { ...prev };
        const current = new Set(next[categoryId] ?? []);
        if (assign) current.add(profileId);
        else current.delete(profileId);
        next[categoryId] = current;
        return next;
      });
    } catch (err) {
      log.error('Failed to update category membership:', err);
    }
  };

  const handleCategoriesChanged = useCallback(() => {
    loadFavoritesAndCategories();
  }, [loadFavoritesAndCategories]);

  const handleEdit = (profile: CharacterProfile) => {
    navigation.navigate('CharacterProfileEdit', { profileId: profile.id });
  };

  /**
   * Open a chat with the character that uses this profile.
   *
   * ChatDetail requires an ENTITY linked to the character profile (plus the
   * impersonated "user" entity). If no entity uses this profile yet, one is
   * created on the fly (mirroring the CreateAI flow), synced to the engine so
   * INIT_ENTITY succeeds, and the user is dropped straight into the chat.
   */
  const handleChatPress = async (profile: CharacterProfile) => {
    try {
      // 1. Resolve the persona we chat as (only personas — never AI
      //    characters — are valid identities; falls back to 'user').
      const storedId =
        await ChatPreferencesService.getGlobalImpersonatedEntity();
      const impersonatedEntityId = await resolvePersonaId(storedId);

      // 2. Reuse an entity linked to this profile, or create one
      let entity = await getEntityByCharacterProfileId(profile.id);
      let createdNewEntity = false;
      if (!entity) {
        createdNewEntity = true;
        const entityId = profile.name.trim();
        entity = await createEntity({
          id: entityId,
          alias: profile.name.trim(),
          character_profile_id: profile.id,
          lifecycle_config: '{}',
          rag_reindex_required: 1,
        });
        await createEntityModuleMapping({
          entity_id: entityId,
          backend_config_id: null,
          cognition_config_id: null,
          tts_config_id: null,
          stt_config_id: null,
          vision_config_id: null,
          rag_config_id: null,
          imagination_config_id: null,
          movement_config_id: null,
          deleted_at: null,
        });
      }

      // 3. Push a NEWLY created entity to the engine BEFORE navigating.
      //    ChatDetail sends INIT_ENTITY on mount; if the engine has not yet
      //    ingested the entity it rejects with entity_not_defined and the chat
      //    is stuck on "Connecting..." (same constraint documented in
      //    CreateAIScreen). Existing entities are already known — no wait.
      if (createdNewEntity) {
        await syncService.syncAndWait({ timeoutMs: 15_000 }).catch(syncErr => {
          log.warn('Auto-sync before chat failed (non-critical):', syncErr);
        });
      }

      // 4. Derive chat params and navigate
      const participantIds = [impersonatedEntityId ?? 'user', entity.id];
      const scope = deriveScopeFromParticipants(participantIds);
      const participantKey = deriveParticipantKey(
        participantIds,
        impersonatedEntityId ?? 'user',
        scope,
      );
      const tempInteractionId = uuidv7();
      navigation.navigate('ChatDetail', {
        interactionId: tempInteractionId,
        participantKey,
        participantIds,
        entityId: impersonatedEntityId ?? 'user',
        entityName: profile.name,
      });
    } catch (err) {
      log.error('Failed to open chat:', err);
      showAlert(t('common:error'), t('chatOpenFailed'));
    }
  };

  const handleLongPress = (profile: CharacterProfile) => {
    setMenuProfile(profile);
  };

  const closeMenu = () => setMenuProfile(null);

  /**
   * Delete a profile (from the long-press context menu). Keeps the delete
   * confirmation dialog so the destructive action is never accidental.
   */
  const handleDeleteProfile = (profile: CharacterProfile) => {
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

  const handleMenuAddToCategory = (profile: CharacterProfile) => {
    setCategoryPickProfile(profile);
  };

  const closeCategoryPick = () => setCategoryPickProfile(null);

  /**
   * Toggle a profile's membership in a category (from the "Add to category"
   * picker). Persists and updates the membership cache.
   */
  const handleCategoryPickToggle = async (categoryId: string, assign: boolean) => {
    const profile = categoryPickProfile;
    if (!profile) return;
    try {
      if (assign) {
        await addCharacterToCategory(profile.id, categoryId);
      } else {
        await removeCharacterFromCategory(profile.id, categoryId);
      }
      setCategoryMembers(prev => {
        const next = { ...prev };
        const current = new Set(next[categoryId] ?? []);
        if (assign) current.add(profile.id);
        else current.delete(profile.id);
        next[categoryId] = current;
        return next;
      });
    } catch (err) {
      log.error('Failed to update category membership:', err);
    }
  };

  /** Assigned categories for the profile in the "Add to category" picker. */
  const categoryPickState: Record<string, boolean> = {};
  if (categoryPickProfile) {
    for (const cat of categories) {
      categoryPickState[cat.id] =
        categoryMembers[cat.id]?.has(categoryPickProfile.id) ?? false;
    }
  }

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
      // Parse + map BEFORE persisting so ImportReviewSheet can review what was
      // detected (greeting / alternates / lorebook / tags / provenance). The
      // profile is persisted only on an explicit sheet action (3-5, §A16).
      const { card, imageBytes } = await parseCardFile(doc.uri, doc.type ?? '');
      const mapped = mapCardToProfile(card, imageBytes);
      setPendingImport({
        card,
        mapped,
        summary: buildImportDetectionSummary(card),
      });
    } catch (e) {
      const code = e instanceof CharacterCardImportError ? e.code : undefined;
      const messageKey = importMessageKey(code);
      showAlert(t('importFailed'), t(messageKey));
    }
  };

  /** Persist the already-mapped profile + optional embedded image (3-5). */
  const persistImported = async (mapped: ReturnType<typeof mapCardToProfile>) => {
    await createCharacterProfile(mapped.profile);
    if (mapped.image) {
      await createCharacterImage(mapped.image);
    }
  };

  const closeReviewAndRefresh = async () => {
    setPendingImport(null);
    await loadProfiles();

    // Push the imported profile (+ image) to the engine so it can be used in
    // chat sessions. Without an explicit sync, the engine never learns about
    // the imported profile until some unrelated sync happens.
    syncService.initiateSync().catch(syncErr => {
      log.warn('Auto-sync after character import failed (non-critical):', syncErr);
    });
  };

  const handleImportError = (err: unknown) => {
    log.error('Failed to persist imported card:', err);
    showAlert(t('importFailed'), t('importParseFailed'));
    setPendingImport(null);
  };

  /** Sheet Save — persist + reload + sync. */
  const handleImportSave = async () => {
    if (!pendingImport) return;
    try {
      await persistImported(pendingImport.mapped);
      await closeReviewAndRefresh();
    } catch (e) {
      handleImportError(e);
    }
  };

  /** "Review & edit fields" — persist, then deep-link the profile editor. */
  const handleImportReviewAndEdit = async () => {
    if (!pendingImport) return;
    try {
      await persistImported(pendingImport.mapped);
      const profileId = pendingImport.mapped.profile.id;
      await closeReviewAndRefresh();
      navigation.navigate('CharacterProfileEdit', { profileId });
    } catch (e) {
      handleImportError(e);
    }
  };

  /** No-greeting CTA — persist, then open the editor to author/generate one. */
  const handleImportGenerateGreeting = async () => {
    if (!pendingImport) return;
    try {
      await persistImported(pendingImport.mapped);
      const profileId = pendingImport.mapped.profile.id;
      await closeReviewAndRefresh();
      navigation.navigate('CharacterProfileEdit', { profileId });
    } catch (e) {
      handleImportError(e);
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
      {/* Header + search bar (child) */}
      <ScreenHeader title={t('title')} right={<HeaderMenuButton />}>
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

        {/* Filter chips — All / Favorites / categories + manage */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {filterChips.map(chip => {
            if (chip.isManage) {
              return (
                <TouchableOpacity
                  key="manage"
                  onPress={() => setManageVisible(true)}
                  style={[
                    styles.chip,
                    styles.manageChip,
                    {
                      backgroundColor: hexToRgba(theme.colors.background.base, 0.55),
                      borderColor: hexToRgba(accent, 0.25),
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('manageCategories')}
                  testID="manage-categories-button"
                >
                  <MaterialCommunityIcons
                    name="plus-box-outline"
                    size={15}
                    color={accent}
                  />
                  <ThemedText size={13} weight="medium" variant="accent">
                    {t('manageCategories')}
                  </ThemedText>
                </TouchableOpacity>
              );
            }
            const isActive = activeFilter === chip.key;
            return (
              <TouchableOpacity
                key={chip.key}
                onPress={() => setActiveFilter(chip.key)}
                style={[
                  styles.chip,
                  isActive && styles.chipActive,
                  {
                    backgroundColor: isActive
                      ? hexToRgba(accent, 0.22)
                      : hexToRgba(theme.colors.background.base, 0.55),
                    borderColor: isActive ? accent : hexToRgba(accent, 0.25),
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={chip.label}
                testID={`filter-chip-${chip.key}`}
              >
                {chip.icon && (
                  <MaterialCommunityIcons
                    name={chip.icon}
                    size={14}
                    color={isActive ? accent : theme.colors.text.muted}
                  />
                )}
                <ThemedText
                  size={13}
                  variant={isActive ? 'accent' : 'primary'}
                  weight={isActive ? 'bold' : 'normal'}
                >
                  {chip.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </ScreenHeader>

      {/* 4-3: tag filter row (multi-select OR) — TagChips in filter mode, fed
          by the distinct library tags. Hidden until the library has tags. */}
      {allTags.length > 0 && (
        <View style={styles.filterRow} testID="tag-filter-row">
          <ThemedText variant="muted" size={12} style={styles.filterLabel}>
            {t('filterByTag')}
          </ThemedText>
          <TagChips
            tags={selectedTags}
            onChange={setSelectedTags}
            suggestions={allTags}
            testID="filter-tag-chips"
          />
        </View>
      )}

      {/* Active-filter banner (creator filter + clear) — animated entrance
          unless the OS requests reduced motion. */}
      {hasActiveFilters && (
        <Animated.View
          testID={
            reduceMotion
              ? 'active-filter-banner-static'
              : 'active-filter-banner-animated'
          }
          style={[
            styles.filterBanner,
            { opacity: filterBannerAnim },
          ]}
        >
          {creatorFilter && (
            <View style={[styles.filterChip, { borderColor: hexToRgba(accent, 0.45), backgroundColor: accent + '1A' }]}>
              <MaterialCommunityIcons
                name="account-filter-outline"
                size={14}
                color={accent}
              />
              <ThemedText size={13} variant="accent">
                {t('filterByCreator', { creator: creatorFilter })}
              </ThemedText>
              <TouchableOpacity
                onPress={() => setCreatorFilter(null)}
                accessibilityRole="button"
                accessibilityLabel={t('clearFilters')}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <MaterialCommunityIcons name="close-circle" size={16} color={accent} />
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity
            onPress={clearFilters}
            accessibilityRole="button"
            style={styles.clearFiltersButton}
            testID="clear-filters"
          >
            <ThemedText size={13} variant="accent" weight="bold">
              {t('clearFilters')}
            </ThemedText>
          </TouchableOpacity>
        </Animated.View>
      )}

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
) : hasActiveFilters ? (
            // Active tag/creator filters produced no results
            <ThemedEmptyState
              icon="filter-remove-outline"
              title={t('noResults')}
              subtitle={t('noResultsHint')}
              style={styles.emptyContainer}
              action={
                <ThemedButton
                  variant="outline"
                  label={t('clearFilters')}
                  onPress={clearFilters}
                  style={styles.emptyButton}
                  testID="empty-clear-filters"
                />
              }
            />
          ) : searchQuery ? (
            // Search produced no results
            <ThemedEmptyState
              icon="file-search-outline"
              title={t('noResults')}
              subtitle={t('noResultsHint')}
              style={styles.emptyContainer}
            />
          ) : activeFilter === 'favorites' ? (
            // No favorites yet
            <ThemedEmptyState
              icon="heart-outline"
              title={t('noFavoritesTitle')}
              subtitle={t('noFavoritesHint')}
              style={styles.emptyContainer}
            />
          ) : activeFilter !== 'all' ? (
            // A category has no characters
            <ThemedEmptyState
              icon="shape-outline"
              title={t('categoryEmptyTitle')}
              subtitle={t('categoryEmptyHint')}
              style={styles.emptyContainer}
            />
          ) : (
            // No profiles at all
            <ThemedEmptyState
              icon="account-group-outline"
              title={t('noProfiles')}
              subtitle={t('noProfilesHint')}
              style={styles.emptyContainer}
              action={
                <ThemedButton
                  variant="primary"
                  label={t('createFirst')}
                  onPress={handleCreateNew}
                  style={styles.emptyButton}
                />
              }
            />
          )
        }
        renderItem={({ item }) => (
          <CharacterProfileCard
            profile={item}
            imageUri={primaryImages[item.id] ?? null}
            imageCount={imageCounts[item.id] ?? 0}
            isFavorite={favoriteIds.has(item.id)}
            onFavoriteToggle={() => handleToggleFavorite(item)}
            onPress={() => handleEdit(item)}
            onLongPress={() => handleLongPress(item)}
            onChatPress={() => handleChatPress(item)}
            onCreatorPress={handleCreatorPress}
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

{/* Post-import review (3-5) — opens after the card parses, before persist. */}
      <ImportReviewSheet
        open={pendingImport !== null}
        summary={pendingImport?.summary ?? null}
        onCancel={() => setPendingImport(null)}
        onSave={handleImportSave}
        onReviewAndEdit={handleImportReviewAndEdit}
        onGenerateGreeting={handleImportGenerateGreeting}
      />

      {/* Manage categories bottom sheet */}
      <ManageCategoriesModal
        visible={manageVisible}
        categories={categories}
        profiles={profiles}
        categoryMembers={categoryMembers}
        onClose={() => setManageVisible(false)}
        onChange={handleCategoriesChanged}
        onCreate={async name => {
          await createCharacterCategory(name);
        }}
        onRename={async (categoryId, name) => {
          await renameCharacterCategory(categoryId, name);
        }}
        onDelete={async categoryId => {
          await deleteCharacterCategory(categoryId);
        }}
        onToggleMember={handleAssignToggle}
      />

      {/* Long-press context menu */}
      <CharacterCardMenuModal
        visible={!!menuProfile}
        characterName={menuProfile?.name ?? ''}
        onClose={closeMenu}
        onDelete={() => menuProfile && handleDeleteProfile(menuProfile)}
        onAddToCategory={() => menuProfile && handleMenuAddToCategory(menuProfile)}
      />

      {/* Add-to-category picker (from long-press menu) */}
      <AddToCategoryModal
        visible={!!categoryPickProfile}
        characterName={categoryPickProfile?.name ?? ''}
        categories={categories}
        assigned={categoryPickState}
        onToggle={handleCategoryPickToggle}
        onClose={closeCategoryPick}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  // ── 4-3 filter row / banner ──
  filterRow: {
    paddingHorizontal: 20,
    paddingBottom: 4,
    gap: 4,
  },
  filterLabel: {
    letterSpacing: 0.3,
  },
  filterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  clearFiltersButton: {
    paddingVertical: 4,
  },
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
  // ── Filter chips ──
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipActive: {
    borderWidth: 1.5,
  },
  manageChip: {
    borderStyle: 'dashed',
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
  emptyListContent: { flex: 1 },
  columnWrapper: { gap: 12, marginBottom: 12 },
  centered: { paddingTop: 100, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: {
    width: '100%',
  },
  emptyButton: { width: '100%' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
});
