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
  TouchableOpacity,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useToast } from '../contexts/AppToastContext';
import { useAuth } from '../contexts/AuthContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { HeaderNotificationButton } from '../components/navigation/HeaderNotificationButton';
import { getMarketplaceListing } from '../database/repositories/marketplace';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';
import { hapticLightPress } from '../utils/haptics';
import { createLogger } from '../utils/logger';
import { CharacterProfileCard } from '../components/characters/CharacterProfileCard';
import {
  getPublicCharacterProfiles,
  getCharacterImages,
} from '../database/repositories/characters';
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
import syncService from '../services/SyncService';
import { isChatLocked } from '../services/MarketplacePurchaseService';
import { createDataURL } from '../database/base64';
import { CharacterProfile } from '../database/models';
import { PostCard } from '../components/social/PostCard';
import { PostCommentModal } from '../components/social/PostCommentModal';
import {
  getAllUserPosts,
  UserPost,
  isPostLiked,
  togglePostLike,
  getPostLikesCount,
  getPostCommentsCount,
  deleteUserPost,
} from '../database/repositories/userSocial';

const log = createLogger('[DiscoverScreen]');

export const DiscoverScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { showToast } = useToast();
  const { user } = useAuth();
  const { t } = useTranslation('discover');
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();

  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [primaryImages, setPrimaryImages] = useState<Record<string, string | null>>({});
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({});
  const [priceMap, setPriceMap] = useState<Record<string, number | null>>({});
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Active Discover tab: 'characters' (community AI characters) or 'posts'
  const [tab, setTab] = useState<'characters' | 'posts'>('characters');

  // Community posts (Discover feed)
  const [posts, setPosts] = useState<UserPost[]>([]);
  const [postState, setPostState] = useState<
    Record<string, { liked: boolean; likes: number; commentCount: number }>
  >({});
  const [commentPostId, setCommentPostId] = useState<string | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────
  const loadProfiles = useCallback(async () => {
    try {
      // Discover shows all PUBLICLY visible AI characters: community
      // characters (synced down from the engine) AND the current user's own
      // public AI characters. Characters tagged 'private' in the client-only
      // visibility sidecar are excluded entirely — they never appear here and
      // are never searchable.
      const data = await getPublicCharacterProfiles();
      setProfiles(data);

      // Load primary image + count + marketplace price for every profile in
      // parallel (a price means the chat is pay-gated — shown as a pill).
      const imageMap: Record<string, string | null> = {};
      const countMap: Record<string, number> = {};
      const prices: Record<string, number | null> = {};
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
          try {
            const listing = await getMarketplaceListing(profile.id);
            prices[profile.id] = listing ? listing.priceSouls : null;
          } catch {
            prices[profile.id] = null;
          }
        }),
      );
      setPrimaryImages(imageMap);
      setImageCounts(countMap);
      setPriceMap(prices);
    } catch (err) {
      log.error('Failed to load profiles:', err);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ── Community posts loader ────────────────────────────────────────────
  const loadPosts = useCallback(async () => {
    try {
      const list = await getAllUserPosts();
      setPosts(list);
      const stateMap: Record<string, { liked: boolean; likes: number; commentCount: number }> = {};
      await Promise.all(
        list.map(async post => {
          try {
            const [liked, likes, commentCount] = await Promise.all([
              isPostLiked(post.id),
              getPostLikesCount(post.id),
              getPostCommentsCount(post.id),
            ]);
            stateMap[post.id] = { liked, likes, commentCount };
          } catch {
            stateMap[post.id] = { liked: false, likes: 0, commentCount: 0 };
          }
        }),
      );
      setPostState(stateMap);
    } catch (err) {
      log.error('Failed to load posts:', err);
    }
  }, []);

  const handleTogglePostLike = async (postId: string) => {
    try {
      const nowLiked = await togglePostLike(postId);
      const likes = await getPostLikesCount(postId);
      setPostState(prev => ({
        ...prev,
        [postId]: {
          liked: nowLiked,
          likes,
          commentCount: prev[postId]?.commentCount ?? 0,
        },
      }));
    } catch (err) {
      log.error('Failed to toggle post like:', err);
    }
  };

  // Delete a post (owner only — all client-local posts belong to the current user).
  const handleDeletePost = (postId: string) => {
    try {
      deleteUserPost(postId)
        .then(() => {
          setPosts(prev => prev.filter(p => p.id !== postId));
          showToast(t('profile:postDeleteDone'));
        })
        .catch(err => {
          log.error('Failed to delete post:', err);
        });
    } catch (err) {
      log.error('Failed to delete post:', err);
    }
  };

  const handlePostCommentsClosed = () => {
    if (commentPostId != null) {
      const pid = commentPostId;
      getPostCommentsCount(pid)
        .then(count => {
          setPostState(prev => ({
            ...prev,
            [pid]: {
              liked: prev[pid]?.liked ?? false,
              likes: prev[pid]?.likes ?? 0,
              commentCount: count,
            },
          }));
        })
        .catch(() => {});
    }
    setCommentPostId(null);
  };

  // Reload on focus so edits made elsewhere are reflected
  useFocusEffect(
    useCallback(() => {
      loadProfiles();
      loadPosts();
    }, [loadProfiles, loadPosts]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadProfiles(), loadPosts()]);
    setRefreshing(false);
  }, [loadProfiles, loadPosts]);

  if (!theme) return null;

  // ── Search filtering ──────────────────────────────────────────────────
  // Prefix match on the character name ONLY (no description matching, no
  // mid/end-of-name matches) — typing "Ma" finds "Max" but not "Samara".
  const filteredProfiles = profiles.filter(p =>
    p.name.toLowerCase().startsWith(query.trim().toLowerCase()),
  );

  // ── Navigation handlers ───────────────────────────────────────────────
  const handleOpenProfile = (profile: CharacterProfile) => {
    // Tapping a Discover card opens the character's public AI profile page
    // (viewing an AI you don't own should never open the editor).
    navigation.navigate('AIProfile', { profileId: profile.id });
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
      // HARD GATE (payment not implemented yet): marketplace-listed characters
      // that the user has not purchased (and does not own) are locked — the
      // Chat tap is silently ignored so the chat screen can never be reached.
      if (await isChatLocked(profile.id, user?.id)) {
        return;
      }

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

  const accent = theme.colors.accent.primary;
  const accentSecondary = theme.colors.accent.secondary ?? theme.colors.accent.primaryHover ?? accent;
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
          right={
            <View style={styles.headerRightRow}>
              <HeaderNotificationButton />
              <HeaderMenuButton />
            </View>
          }
        >
          {/* ── Tab toggle: Characters | Posts — professional segmented control ── */}
          <View
            style={[
              styles.tabRow,
              { backgroundColor: hexToRgba(baseHex, 0.5), borderColor: hexToRgba(accent, 0.18) },
            ]}
          >
            {(
              [
                { key: 'characters' as const, icon: 'account-group-outline', label: t('tabCharacters') },
                { key: 'posts' as const, icon: 'post-outline', label: t('tabPosts') },
              ]
            ).map(tabDef => {
              const isActive = tab === tabDef.key;
              return (
                <TouchableOpacity
                  key={tabDef.key}
                  onPress={() => {
                    hapticLightPress();
                    setTab(tabDef.key);
                  }}
                  activeOpacity={0.85}
                  style={[styles.tabBtn, isActive && styles.tabBtnActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={tabDef.label}
                  testID={`discover-tab-${tabDef.key}`}
                >
                  {isActive && (
                    <LinearGradient
                      colors={[accent, accentSecondary]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                      pointerEvents="none"
                    />
                  )}
                  <MaterialCommunityIcons
                    name={tabDef.icon}
                    size={15}
                    color={isActive ? '#fff' : theme.colors.text.muted}
                  />
                  <ThemedText
                    size={13}
                    variant="primary"
                    weight={isActive ? 'bold' : 'normal'}
                    style={isActive ? styles.tabLabelActive : undefined}
                  >
                    {tabDef.label}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Search bar — only for the Characters tab */}
          {tab === 'characters' && (
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
                  onPress={() => {
                    hapticLightPress();
                    setQuery('');
                  }}
                  style={styles.clearIcon}
                />
              )}
            </View>
          )}
        </ScreenHeader>
      </View>

      {/* ── Tab content ── */}
      <View style={styles.contentArea}>
        {tab === 'characters' ? (
          <>
            {/* Character grid — the empty state is rendered via ListEmptyComponent
                (inside the FlatList) so it can never overlay populated content.
                key="characters-list" keeps this FlatList distinct from the posts
                FlatList below — without it React reconciles them as the same
                component and "Changing numColumns on the fly" crashes. */}
            <FlatList
              key="characters-list"
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
              ListEmptyComponent={
                isLoading ? (
                  <View style={styles.centered}>
                    <ActivityIndicator size="large" color={theme.colors.accent.primary} />
                  </View>
                ) : (
                  <ThemedEmptyState
                    icon={query ? 'file-search-outline' : 'compass-outline'}
                    title={query ? t('noResults', { query }) : t('noCharacters')}
                    subtitle={query ? t('noResultsHint') : t('noCharactersHint')}
                    style={styles.emptyOverlay}
                  />
                )
              }
              renderItem={({ item }) => (
                <CharacterProfileCard
                  profile={item}
                  imageUri={primaryImages[item.id] ?? null}
                  imageCount={imageCounts[item.id] ?? 0}
                  priceSouls={priceMap[item.id] ?? undefined}
                  onPress={() => handleOpenProfile(item)}
                  onLongPress={() => handleOpenProfile(item)}
                  onChatPress={() => handleChat(item)}
                />
              )}
            />
          </>
        ) : (
          <FlatList
            key="posts-list"
            style={{ flex: 1 }}
            data={posts}
            keyExtractor={item => item.id}
            contentContainerStyle={[
              styles.postsListContent,
              { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom },
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
            ListEmptyComponent={
              <ThemedEmptyState
                icon="post-outline"
                title={t('noPosts')}
                subtitle={t('noPostsHint')}
                style={styles.emptyOverlay}
              />
            }
            renderItem={({ item }) => {
              const state = postState[item.id] ?? { liked: false, likes: 0, commentCount: 0 };
              return (
                <View style={styles.postItemWrap}>
                  <PostCard
                    post={item}
                    liked={state.liked}
                    likes={state.likes}
                    commentCount={state.commentCount}
                    onToggleLike={() => handleTogglePostLike(item.id)}
                    onOpenComments={() => setCommentPostId(item.id)}
                    onOpenAuthor={() => navigation.navigate('MainTabs', { screen: 'MyProfile' })}
                    onDeletePost={() => handleDeletePost(item.id)}
                  />
                </View>
              );
            }}
          />
        )}
      </View>

      {/* Post comments modal */}
      <PostCommentModal
        visible={commentPostId != null}
        postId={commentPostId}
        onClose={handlePostCommentsClosed}
        // All local posts belong to the current user — they can moderate any comment.
        canModerateAll
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contentArea: { flex: 1 },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    borderRadius: 10,
    overflow: 'hidden',
  },
  tabBtnActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  tabLabelActive: {
    color: '#fff',
  },
  postsListContent: {
    padding: 16,
  },
  postItemWrap: {
    marginBottom: 16,
  },
  centered: {
    paddingTop: 80,
    alignItems: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  emptyOverlay: {
    width: '100%',
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
});

export default DiscoverScreen;
