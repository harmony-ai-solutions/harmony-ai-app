import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { pick } from '@react-native-documents/picker';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useToast } from '../contexts/AppToastContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedFab } from '../components/themed/ThemedFab';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { HeaderNotificationButton } from '../components/navigation/HeaderNotificationButton';
import { TAB_BAR_CONTENT_PAD, TAB_BAR_FAB_OFFSET } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';
import { hapticLightPress } from '../utils/haptics';
import { createLogger } from '../utils/logger';
import { TagChips } from '../components/character-card/TagChips';
import { parseJsonColumn } from '../components/character-card/lorebook';
import { useReducedMotion } from '../hooks/useReducedMotion';

const log = createLogger('[CharactersScreen]');
import { CharacterProfileCard } from '../components/characters/CharacterProfileCard';
import { ManageCategoriesModal } from '../components/characters/ManageCategoriesModal';
import { CategoryFilterDropdown } from '../components/characters/CategoryFilterDropdown';
import { CharacterCardMenuModal } from '../components/characters/CharacterCardMenuModal';
import { AddToCategoryModal } from '../components/characters/AddToCategoryModal';
import { CreatePartnerModal } from '../components/characters/CreatePartnerModal';
import { AICardPickerModal } from '../components/characters/AICardPickerModal';
import {
  getAllCharacterProfiles,
  getCharacterImages,
  getDistinctTags,
  deleteCharacterProfile,
  deleteCharacterProfileCascade,
  createCharacterProfile,
  createCharacterImage,
  updateCharacterProfile,
  getFavoriteCharacterProfileIds,
  toggleCharacterFavorite,
} from '../database/repositories/characters';
import CategoryPreferencesService, {
  CharacterCategory,
} from '../services/CategoryPreferencesService';
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
} from '../components/character-card/editor-sections/ImportReviewSheet';
import type { ImportDetectionSummary } from '../components/character-card/editor-sections/ImportReviewSheet';
import {
  createEntity,
  createEntityModuleMapping,
  getEntityByCharacterProfileId,
  ReservedEntityNameError,
} from '../database/repositories/entities';
import {
  deriveParticipantKey,
  deriveScopeFromParticipants,
} from '../database/repositories/interactions';
import { v7 as uuidv7 } from 'uuid';
import ChatPreferencesService from '../services/ChatPreferencesService';
import {
  resolvePersonaId,
  createUserPersonaFromCard,
} from '../database/repositories/userEntities';
import { filterBlockedCharacterProfiles } from '../utils/blockedContentFilters';
import * as SocialService from '../services/social/SocialService';
import { CharacterProfile } from '../database/models';
import { CharacterCardImportError } from '../services/CharacterCardImportService';
import { openCharacterChat } from '../services/CharacterChatService';
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
  const { showToast } = useToast();
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

  // Sort mode: 'alpha' (A→Z), 'newest' (newest first), 'oldest' (oldest first)
  const [sortMode, setSortMode] = useState<'alpha' | 'newest' | 'oldest'>(
    'alpha',
  );
  // Whether the "new AI partner?" bottom sheet is open (opened via ＋ FAB)
  const [createVisible, setCreateVisible] = useState(false);
  // Whether the "From an Existing One" card picker is open
  const [pickerVisible, setPickerVisible] = useState(false);

  // ── Favorites + categories ─────────────────────────────────────────────
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  // Custom categories persisted in AsyncStorage (O6 — the old DB sidecar is
  // gone). Membership is tag-based: a profile "belongs" to a category when its
  // `character_profiles.tags` contains the category name.
  const [customCategories, setCustomCategories] = useState<CharacterCategory[]>(
    [],
  );
  // activeFilter: 'all' | 'favorites' | category id
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [manageVisible, setManageVisible] = useState(false);
  // Which profile the long-press context menu is open for (null = closed)
  const [menuProfile, setMenuProfile] = useState<CharacterProfile | null>(null);
  // Which profile the "Add to category" picker is open for (null = closed)
  const [categoryPickProfile, setCategoryPickProfile] = useState<CharacterProfile | null>(null);

  /** Parse a profile's tags JSON column (defensive). */
  const profileTags = useCallback(
    (profile: CharacterProfile): string[] => {
      return parseJsonColumn<string[]>(profile.tags) ?? [];
    },
    [],
  );

  /** Does a profile carry a given category name as a tag? (case-insensitive) */
  const profileHasCategory = useCallback(
    (profile: CharacterProfile, categoryName: string): boolean => {
      const target = categoryName.toLowerCase();
      return profileTags(profile).some(tag => tag.toLowerCase() === target);
    },
    [profileTags],
  );

  /**
   * The filterable category list = custom AsyncStorage categories ∪ distinct
   * profile tags (each tag that is not already a custom category surfaces as a
   * tag-derived category option). Tag-derived ids are `tag:<lowercased name>`
   * so they never collide with custom category ids.
   */
  const categories: CharacterCategory[] = useMemo(() => {
    const seen = new Set<string>();
    const union: CharacterCategory[] = [];
    for (const cat of customCategories) {
      seen.add(cat.name.toLowerCase());
      union.push(cat);
    }
    for (const tag of allTags) {
      if (!seen.has(tag.toLowerCase())) {
        union.push({ id: `tag:${tag.toLowerCase()}`, name: tag });
      }
    }
    return union;
  }, [customCategories, allTags]);

  /**
   * Load favorites + custom categories (membership needs no loading — it is
   * derived from profile tags, which loadProfiles already has).
   */
  const loadFavoritesAndCategories = useCallback(async () => {
    try {
      const [favIds, cats] = await Promise.all([
        getFavoriteCharacterProfileIds(),
        CategoryPreferencesService.getCategories(),
      ]);
      setFavoriteIds(new Set(favIds));
      setCustomCategories(cats);
    } catch (err) {
      log.error('Failed to load favorites/categories:', err);
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      let data = await getAllCharacterProfiles();
      // Hide AI characters created by blocked users app-wide. The stub block
      // list is user-id-based; the pure filter drops profiles whose id is in
      // the blocked set (the future backend resolves creator→profile ids).
      const blockedIds = await SocialService.getBlockedUserIds();
      data = filterBlockedCharacterProfiles(data, blockedIds);
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
  }, []);

  // 4-1 / 000044: live favorites refresh. SyncService emits `sync:data-applied`
  // after an inbound apply commits; when it touched `character_profiles`, reload
  // the favorite ids so the favorites filter reflects engine-side changes even if
  // this screen stays focused (the focus reload above only fires on re-focus).
  // Favorites now ride inside the profile row as `is_favorite`, so the profile
  // table filter covers them (the old favorites sidecar table is gone).
  // 3-4: persona-cascade tombstones (`entities`) and avatar churn
  // (`character_image`) can also go stale while focused — reload the profile
  // list so freed persona-owned cards and changed avatars surface immediately.
  useEffect(() => {
    const handleSyncApplied = (payload: { tables: string[] }) => {
      if (payload.tables.includes('character_profiles')) {
        loadFavoritesAndCategories();
      }
      if (
        payload.tables.includes('entities') ||
        payload.tables.includes('character_image')
      ) {
        loadProfiles();
      }
    };
    syncService.on('sync:data-applied', handleSyncApplied);
    return () => {
      syncService.off('sync:data-applied', handleSyncApplied);
    };
  }, [loadFavoritesAndCategories, loadProfiles]);

  // Reload on focus (handles return from edit screen)
  useFocusEffect(
    useCallback(() => {
      loadProfiles();
      loadFavoritesAndCategories();
    }, [loadFavoritesAndCategories]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfiles();
    setRefreshing(false);
  }, []);

/** Search + activeFilter (all/favorites/category) + tag (multi-OR) + creator filter. */
  const filteredProfiles = profiles.filter(p => {
    // Search query — prefix match on the character name ONLY (no description
    // matching, no mid/end-of-name matches).
    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      q.length === 0 || p.name.toLowerCase().startsWith(q);
    if (!matchesQuery) return false;

    // Active filter: all / favorites / category (AND-composed with the
    // filters below). Category membership is tag-based (O6): a profile matches
    // when its tags contain the active category's name.
    if (activeFilter === 'favorites' && !favoriteIds.has(p.id)) return false;
    if (activeFilter !== 'all' && activeFilter !== 'favorites') {
      const activeCategory = categories.find(c => c.id === activeFilter);
      if (!activeCategory || !profileHasCategory(p, activeCategory.name)) {
        return false;
      }
    }

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

  // ── Sort ──────────────────────────────────────────────────────────────
  // 'alpha'  — alphabetical by name (case-insensitive)
  // 'newest' — newest created first (created_at desc)
  // 'oldest' — oldest created first (created_at asc)
  const sortedProfiles = [...filteredProfiles].sort((a, b) => {
    if (sortMode === 'newest') {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortMode === 'oldest') {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  /**
   * Filter chips: "All" and "Favorites" are always shown as quick chips.
   * User categories are collapsed into the category dropdown (next to the
   * manage chip) so a large category list stays manageable.
   */
  interface FilterChipItem {
    key: string;
    label: string;
    icon?: string;
  }
  const filterChips: FilterChipItem[] = [
    { key: 'all', label: t('filterAll'), icon: 'view-grid-outline' },
    { key: 'favorites', label: t('filterFavorites'), icon: 'heart-outline' },
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

  const handleCategoriesChanged = useCallback(() => {
    loadFavoritesAndCategories();
    // Rename/delete rewrite profile tags — reload so filters + chips reflect.
    loadProfiles();
  }, [loadFavoritesAndCategories]);

  const handleEdit = (profile: CharacterProfile) => {
    navigation.navigate('CreateAI', { editProfileId: profile.id });
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
      await openCharacterChat(
        profile,
        {
          navigateToChat: params => navigation.navigate('ChatDetail', params),
        },
      );
    } catch (err) {
      log.error('Failed to open chat:', err);
      // D33 (review-5 UX pin): a card whose NAME is reserved (`user` /
      // `deleted`) can never mint an entity id — dedicated guidance, never
      // the bare generic failure.
      if (err instanceof ReservedEntityNameError) {
        showAlert(t('common:error'), t('chatOpenReservedName'));
        return;
      }
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
              await deleteCharacterProfileCascade(profile.id);
              setProfiles(prev => prev.filter(p => p.id !== profile.id));
              showToast(t('deletedToast', { name: profile.name }));
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

  /**
   * "Create persona from this card" (decision 4/7/12). IMMEDIATE full-copy
   * create: `createUserPersonaFromCard` copies the FULL card (all V3 +
   * Soulbits fields, all images with the primary flag preserved, provenance
   * as-is, name deduped) into a fresh `user` entity, then the persona editor
   * opens on the new persona. The old identity-only prefill path is retired.
   */
  const handleCreatePersonaFromCard = async (profile: CharacterProfile) => {
    closeMenu();
    try {
      const persona = await createUserPersonaFromCard(profile.id);
      navigation.navigate('PersonaEdit', { entityId: persona.id });
    } catch (err) {
      log.error('Failed to create persona from card:', err);
      showAlert(t('common:error'), t('persona:personaCreateFromCardFailed'));
    }
  };

  const closeCategoryPick = () => setCategoryPickProfile(null);

  /**
   * Toggle a profile's membership in a category (from the "Add to category"
   * picker). Membership is tag-based (O6): toggling writes/removes the
   * category NAME as a native tag on `character_profiles.tags` (which syncs to
   * the engine), then updates local state so filters/counts reflect instantly.
   */
  const handleCategoryPickToggle = async (categoryId: string, assign: boolean) => {
    const profile = categoryPickProfile;
    if (!profile) return;
    const category = categories.find(c => c.id === categoryId);
    if (!category) return;
    try {
      const current = profileTags(profile);
      const target = category.name.toLowerCase();
      const without = current.filter(tag => tag.toLowerCase() !== target);
      const nextTags = assign ? [...without, category.name] : without;
      await updateCharacterProfile({
        ...profile,
        tags: JSON.stringify(nextTags),
      });
      // Reflect the tag change locally (filters + counts derive from tags).
      setProfiles(prev =>
        prev.map(p =>
          p.id === profile.id ? { ...p, tags: JSON.stringify(nextTags) } : p,
        ),
      );
    } catch (err) {
      log.error('Failed to update category membership:', err);
    }
  };

  /** Assigned categories for the profile in the "Add to category" picker. */
  const categoryPickState: Record<string, boolean> = {};
  if (categoryPickProfile) {
    for (const cat of categories) {
      categoryPickState[cat.id] = profileHasCategory(categoryPickProfile, cat.name);
    }
  }

  /** categoryId → member count, shown next to each category in the dropdown. */
  const categoryMemberCounts: Record<string, number> = {};
  for (const cat of categories) {
    categoryMemberCounts[cat.id] = profiles.filter(p =>
      profileHasCategory(p, cat.name),
    ).length;
  }

  /**
   * Rewrite a category-name tag on every profile that carries it — used on
   * category rename (old tag → new tag, preserving membership, which is the
   * tag-based equivalent of the old id-based rename) and delete (tag stripped,
   * mirroring the old FK-cascade that removed member rows). The modal fires
   * `onChange` after each mutation, which reloads profiles + chips.
   */
  const rewriteCategoryTag = async (oldName: string, newName: string | null) => {
    const target = oldName.toLowerCase();
    const all = await getAllCharacterProfiles();
    const affected = all.filter(p =>
      profileTags(p).some(tag => tag.toLowerCase() === target),
    );
    for (const p of affected) {
      const without = profileTags(p).filter(
        tag => tag.toLowerCase() !== target,
      );
      const nextTags = newName ? [...without, newName] : without;
      await updateCharacterProfile({ ...p, tags: JSON.stringify(nextTags) });
    }
  };

  /**
   * "New AI Partner" — opens the Create AI Partner wizard (fresh profile
   * mode, the "Create new profile" card is selected by default).
   */
  const handleCreateNew = () => {
    navigation.navigate('CreateAI', {});
  };

  /**
   * "From an Existing One" — open the card picker sheet (live-link mode). The
   * picked card is SHARED: the new AI entity references the SAME character
   * profile (engine parity) instead of forking it.
   */
  const handleFromExisting = () => {
    setPickerVisible(true);
  };

  /** A profile was picked in the card picker. */
  const handlePickerSelect = (profile: CharacterProfile) => {
    setPickerVisible(false);
    // LIVE LINK (engine parity): the new AI entity references the SAME
    // character profile — no card fork. CreateAIScreen prefills from the
    // shared card; the picked profile's id rides `prefillProfileId` and the
    // entity alias comes from the name the user types there.
    navigation.navigate('CreateAI', { prefillProfileId: profile.id });
  };

  /**
   * Card tap → AI profile screen (the AI's own profile view, mirroring the
   * user's My Profile screen: avatar, name, description, images / likes /
   * chats tabs + other forks of the same AI).
   */
  const handleOpenAIProfile = (profile: CharacterProfile) => {
    navigation.navigate('AIProfile', { profileId: profile.id });
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
      navigation.navigate('CreateAI', { editProfileId: profileId });
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
      navigation.navigate('CreateAI', { editProfileId: profileId });
    } catch (e) {
      handleImportError(e);
    }
  };

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;
  const inputBg = hexToRgba(baseHex, 0.55);

  return (
    <ThemedView style={styles.container}>
      {/* Header + search bar (child) */}
      <ScreenHeader
        title={t('title')}
        titleRight={
          <>
          {/* ── Sort button — cycles Alpha / Newest / Oldest ── */}
          <TouchableOpacity
            onPress={() => {
              hapticLightPress();
              setSortMode(prev =>
                prev === 'alpha' ? 'newest' : prev === 'newest' ? 'oldest' : 'alpha',
              );
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[
              styles.sortChip,
              { backgroundColor: hexToRgba(baseHex, 0.55), borderColor: hexToRgba(accent, 0.25) },
            ]}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('sortLabel', { mode: sortMode })}
            testID="sort-button"
          >
            <MaterialCommunityIcons
              name={
                sortMode === 'alpha'
                  ? 'sort-alphabetical-ascending'
                  : sortMode === 'newest'
                    ? 'sort-clock-descending-outline'
                    : 'sort-clock-ascending-outline'
              }
              size={15}
              color={accent}
            />
            <ThemedText size={12} weight="medium" variant="accent">
              {t(`sortMode.${sortMode}`)}
            </ThemedText>
          </TouchableOpacity>
          </>
        }
        right={
          <View style={styles.headerRightRow}>
            <HeaderNotificationButton />
            <HeaderMenuButton />
          </View>
        }
      >
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

        {/* Filter chips — All / Favorites + category dropdown + manage */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {filterChips.map(chip => {
            const isActive = activeFilter === chip.key;
            return (
              <TouchableOpacity
                key={chip.key}
                onPress={() => {
                  hapticLightPress();
                  setActiveFilter(chip.key);
                }}
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

          {/* Category dropdown — collapses all user categories into one trigger
              so a large category list stays manageable. Includes the
              "Manage categories" action inside the sheet. */}
          <CategoryFilterDropdown
            selected={activeFilter}
            categories={categories}
            counts={categoryMemberCounts}
            placeholder={t('categoryFilterPlaceholder')}
            title={t('categoryFilterTitle')}
            manageLabel={t('manageCategories')}
            emptyLabel={t('categoryFilterEmpty')}
            onSelect={setActiveFilter}
            onManagePress={() => setManageVisible(true)}
          />
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
        data={sortedProfiles}
        keyExtractor={item => item.id}
        numColumns={2}
        columnWrapperStyle={sortedProfiles.length > 0 ? styles.columnWrapper : undefined}
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
            onPress={() => handleOpenAIProfile(item)}
            onLongPress={() => handleLongPress(item)}
            onChatPress={() => handleChatPress(item)}
            onCreatorPress={handleCreatorPress}
          />
        )}
      />

      {/* FAB — opens the "new AI partner?" sheet (hidden during initial load) */}
      {!isLoading && (
        <View style={[styles.fabGroup, { bottom: TAB_BAR_FAB_OFFSET + safeBottom }]}>
          <ThemedFab
            icon="plus"
            onPress={() => setCreateVisible(true)}
            style={styles.fabFab}
            testID="add-ai-partner"
          />
        </View>
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

      {/* "New AI partner?" bottom sheet (create / from existing / import) */}
      <CreatePartnerModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onNewPartner={handleCreateNew}
        onFromExisting={handleFromExisting}
        onImport={handleImportCard}
        hasExistingProfiles={profiles.length > 0}
      />

      {/* Card picker — live-links a card to a NEW AI entity ("From an
          Existing One" flow: the entity references the shared profile) */}
      <AICardPickerModal
        visible={pickerVisible}
        mode="fromExisting"
        onClose={() => setPickerVisible(false)}
        onSelect={handlePickerSelect}
      />

      {/* Manage categories bottom sheet — manages the AsyncStorage custom list
          (O6). Rename/delete also rewrite the corresponding profile tags so
          membership stays coherent. */}
      <ManageCategoriesModal
        visible={manageVisible}
        categories={customCategories}
        onClose={() => setManageVisible(false)}
        onChange={handleCategoriesChanged}
        onCreate={async name => {
          await CategoryPreferencesService.createCategory(name);
        }}
        onRename={async (categoryId, name) => {
          const old = customCategories.find(c => c.id === categoryId);
          await CategoryPreferencesService.renameCategory(categoryId, name);
          if (old) await rewriteCategoryTag(old.name, name);
        }}
        onDelete={async categoryId => {
          const target = customCategories.find(c => c.id === categoryId);
          await CategoryPreferencesService.deleteCategory(categoryId);
          if (target) await rewriteCategoryTag(target.name, null);
        }}
      />

      {/* Long-press context menu */}
      <CharacterCardMenuModal
        visible={!!menuProfile}
        characterName={menuProfile?.name ?? ''}
        onClose={closeMenu}
        onEdit={() => menuProfile && handleEdit(menuProfile)}
        onDelete={() => menuProfile && handleDeleteProfile(menuProfile)}
        onAddToCategory={() => menuProfile && handleMenuAddToCategory(menuProfile)}
        onCreatePersonaFromCard={() => menuProfile && handleCreatePersonaFromCard(menuProfile)}
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
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    marginRight: 8,
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
  listContent: { padding: 12, paddingBottom: 80 },
  emptyListContent: { flex: 1 },
  columnWrapper: { gap: 12, marginBottom: 12 },
  centered: { paddingTop: 100, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: {
    width: '100%',
  },
  emptyButton: { width: '100%' },
});
