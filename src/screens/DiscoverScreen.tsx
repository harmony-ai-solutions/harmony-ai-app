/**
 * DiscoverScreen — Explore & search AI characters
 *
 * Browse the user's AI character library in a two-column grid while
 * searching for a specific character from the same screen. Uses the
 * same character repository + card component as the Characters tab,
 * with a glass search bar injected into the header.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';
import { createLogger } from '../utils/logger';
import { CharacterProfileCard } from '../components/characters/CharacterProfileCard';
import {
  getCommunityCharacterProfiles,
  getCharacterImages,
} from '../database/repositories/characters';
import {
  getAllEntities,
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
import syncService from '../services/SyncService';
import { createDataURL } from '../database/base64';
import { CharacterProfile } from '../database/models';

const log = createLogger('[DiscoverScreen]');

// Tab-screen navigation: routes are dispatched to the parent root stack.
// Using 'any' here avoids CompositeNavigationProp boilerplate while
// React Navigation v7 resolves routes across nested navigators at runtime.
type Nav = import('@react-navigation/native-stack').NativeStackNavigationProp<RootStackParamList>;

export const DiscoverScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { t } = useTranslation('discover');
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();

  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [primaryImages, setPrimaryImages] = useState<Record<string, string | null>>({});
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────
  const loadProfiles = useCallback(async () => {
    try {
      // Only characters created by OTHER users (synced down from the engine)
      // are shown in Discover. The current user's own characters — created via
      // Create AI, the profile editor, or imported cards — are tagged 'user'
      // in the client-only source sidecar and excluded from this grid. They
      // still sync up to the engine and appear on other users' Discover grids.
      const data = await getCommunityCharacterProfiles();
      setProfiles(data);

      // Load primary image + count for every profile in parallel
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

  // Reload on focus so edits made elsewhere are reflected
  useFocusEffect(
    useCallback(() => {
      loadProfiles();
    }, [loadProfiles]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfiles();
    setRefreshing(false);
  }, [loadProfiles]);

  if (!theme) return null;

  // ── Search filtering ──────────────────────────────────────────────────
  // Name-only matching: the search bar targets AI characters by NAME. This
  // avoids matching inside long character descriptions (which contain almost
  // every common letter and would delay / hide the 0-results state).
  const filteredProfiles = profiles.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );

  // ── Navigation handlers ───────────────────────────────────────────────
  const handleOpenProfile = (profile: CharacterProfile) => {
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
  const handleChat = async (profile: CharacterProfile) => {
    try {
      // 1. Resolve the impersonated entity (the "user" identity we chat as)
      const allEntities = await getAllEntities();
      const storedId =
        await ChatPreferencesService.getGlobalImpersonatedEntity();
      let impersonatedEntityId = storedId;
      if (
        !impersonatedEntityId ||
        !allEntities.some(e => e.id === impersonatedEntityId)
      ) {
        const userEntity = allEntities.find(e => e.id === 'user');
        impersonatedEntityId = userEntity
          ? userEntity.id
          : (allEntities[0]?.id ?? 'user');
      }

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

  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;
  const inputBg = hexToRgba(baseHex, 0.55);

  return (
    <ThemedView variant="base" style={styles.container}>
      {/* ── Header (outside the list so RefreshControl never covers it) ── */}
      <View style={{ paddingTop: safeTop + 12 }}>
        <ScreenHeader
          title={t('title')}
          subtitle={t('subtitle')}
          style={{ paddingTop: 0 }}
        >
          {/* Search bar */}
          <View
            style={[
              styles.searchBar,
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
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <MaterialCommunityIcons
                name="close-circle"
                size={18}
                color={theme.colors.text.muted}
                onPress={() => setQuery('')}
                style={styles.clearIcon}
              />
            )}
          </View>
        </ScreenHeader>
      </View>

      {/* ── Character grid + empty-state overlay ──
          The overlay is a plain sibling View (NOT ListEmptyComponent) because
          FlatList with numColumns > 1 does not reliably render the empty
          component — a guaranteed-visible overlay guarantees the "0 results"
          state always appears when a search matches nothing. */}
      <View style={styles.contentArea}>
        <FlatList
          style={{ flex: 1 }}
          data={filteredProfiles}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={
            filteredProfiles.length > 0 ? styles.columnWrapper : undefined
          }
          contentContainerStyle={[
            styles.listContent,
            { flexGrow: 1, paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.colors.accent.primary]}
              tintColor={theme.colors.accent.primary}
              progressBackgroundColor={theme.colors.background.surface}
            />
          }
          renderItem={({ item }) => (
            <CharacterProfileCard
              profile={item}
              imageUri={primaryImages[item.id] ?? null}
              imageCount={imageCounts[item.id] ?? 0}
              onPress={() => handleOpenProfile(item)}
              onLongPress={() => handleOpenProfile(item)}
              onChatPress={() => handleChat(item)}
            />
          )}
        />

        {/* Loading overlay */}
        {isLoading && (
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator size="large" color={theme.colors.accent.primary} />
          </View>
        )}

        {/* Empty / 0-results overlay */}
        {!isLoading && filteredProfiles.length === 0 && (
          <View style={styles.overlay} pointerEvents="none">
            <MaterialCommunityIcons
              name={query ? 'file-search-outline' : 'compass-outline'}
              size={72}
              color={theme.colors.text.muted}
            />
            <ThemedText weight="bold" size={18} style={styles.emptyTitle}>
              {query ? t('noResults', { query }) : t('noCharacters')}
            </ThemedText>
            <ThemedText variant="muted" size={14} style={styles.emptySubtext}>
              {query ? t('noResultsHint') : t('noCharactersHint')}
            </ThemedText>
          </View>
        )}
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentArea: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  searchBar: {
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
  emptyTitle: { textAlign: 'center', marginTop: 12 },
  emptySubtext: { textAlign: 'center' },
});

export default DiscoverScreen;
