/**
 * DiscoverScreen — Explore & search AI characters
 *
 * The character grid is the stub marketplace feed (fixtures visible in all
 * builds — the real community query lands with 20-Backend-Concept); search is
 * local. The Posts tab keeps its local social feed until Phase 3 rewires it.
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
import { useToast } from '../contexts/AppToastContext';
import { useAuth } from '../contexts/AuthContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { HeaderNotificationButton } from '../components/navigation/HeaderNotificationButton';
import { getListings, getListing, type MarketplaceListingDetail } from '../services/marketplace/MarketplaceService';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';
import { hapticLightPress } from '../utils/haptics';
import { createLogger } from '../utils/logger';
import { CharacterProfileCard } from '../components/characters/CharacterProfileCard';
import { CharacterProfile } from '../database/models';
import { PostCard } from '../components/social/PostCard';
import { PostCommentModal } from '../components/social/PostCommentModal';
import * as SocialService from '../services/social/SocialService';
import type { StubPost } from '../services/social/SocialService';
import { filterBlockedUserPosts } from '../utils/blockedContentFilters';

const log = createLogger('[DiscoverScreen]');

export const DiscoverScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
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
  const [posts, setPosts] = useState<StubPost[]>([]);
  const [postState, setPostState] = useState<
    Record<string, { liked: boolean; likes: number; commentCount: number }>
  >({});
  const [commentPostId, setCommentPostId] = useState<string | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────
  const loadProfiles = useCallback(async () => {
    try {
      // The community-character backend query (doomed character_profile_sources
      // table) lands with 20-Backend-Concept. Until then the Discover grid is
      // the stub fixture feed — marketplace listing details ("created by other
      // users" fixture creators), visible in all builds (O5).
      const listings = await getListings();
      const details = (
        await Promise.all(
          listings.map(l => getListing(l.id).catch(() => null)),
        )
      ).filter((d): d is MarketplaceListingDetail => d !== null);
      setProfiles(details.map(listingDetailToDiscoverProfile));
      setPrimaryImages({});
      setImageCounts({});
      setPriceMap(
        Object.fromEntries(
          details
            .filter(d => d.priceSouls > 0)
            .map(d => [d.id, d.priceSouls]),
        ),
      );
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
      let list = await SocialService.getPosts();
      // Hide posts authored by blocked users.
      const blockedIds = await SocialService.getBlockedUserIds();
      list = filterBlockedUserPosts(list, blockedIds);
      setPosts(list);
      // The stub post carries like/comment counts at read time; the liked-by-
      // current-user flag is only returned by togglePostLike (no read API).
      const stateMap: Record<string, { liked: boolean; likes: number; commentCount: number }> = {};
      for (const post of list) {
        stateMap[post.id] = {
          liked: false,
          likes: post.likeCount,
          commentCount: post.commentCount,
        };
      }
      setPostState(stateMap);
    } catch (err) {
      log.error('Failed to load posts:', err);
    }
  }, []);

  const handleTogglePostLike = async (postId: string) => {
    try {
      const nowLiked = await SocialService.togglePostLike(postId);
      // Re-read the post for the updated like count.
      const post = (await SocialService.getPosts()).find(p => p.id === postId);
      setPostState(prev => ({
        ...prev,
        [postId]: {
          liked: nowLiked,
          likes: post?.likeCount ?? prev[postId]?.likes ?? 0,
          commentCount: prev[postId]?.commentCount ?? 0,
        },
      }));
    } catch (err) {
      log.error('Failed to toggle post like:', err);
    }
  };

  // Delete a post (owner only — all stub posts belong to the signed-in user).
  const handleDeletePost = (postId: string) => {
    try {
      SocialService.deletePost(postId)
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
      SocialService.getPostComments(pid)
        .then(comments => {
          setPostState(prev => ({
            ...prev,
            [pid]: {
              liked: prev[pid]?.liked ?? false,
              likes: prev[pid]?.likes ?? 0,
              commentCount: comments.length,
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
    // Stub feed listings have no local character profile — the honest target
    // is the listing detail (preview + acquire).
    navigation.navigate('MarketplaceItemDetail', { listingId: profile.id });
  };

  /**
   * Open a chat with the character that uses this profile.
   *
   * ChatDetail requires an ENTITY linked to a LOCAL character profile. Stub
   * feed listings have no local profile until acquired, so the chat action
   * opens the listing detail instead (paywall removed, A2).
   */
  const handleChat = async (profile: CharacterProfile) => {
    navigation.navigate('MarketplaceItemDetail', { listingId: profile.id });
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

        {/* Subtle preview hint — the character feed is stub fixture data while
            the community backend is in development (A3 consequence). */}
        {tab === 'characters' && (
          <View style={styles.previewHintWrap}>
            <ThemedText variant="muted" size={11} style={styles.previewHint}>
              {t('previewHint')}
            </ThemedText>
          </View>
        )}
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
                    onOpenAuthor={() =>
                      navigation.push('UserProfile', {
                        userId: item.authorUserId ?? user?.id ?? '',
                      })
                    }
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

/**
 * Map a stub marketplace listing detail to the CharacterProfileCard's shape
 * (the card reads id/name/description/creator). No local character exists for
 * fixture listings — this is a preview-feed projection.
 */
function listingDetailToDiscoverProfile(
  detail: MarketplaceListingDetail,
): CharacterProfile {
  return {
    id: detail.id,
    name: detail.title,
    description: detail.description,
    creator: detail.creatorName,
  } as unknown as CharacterProfile;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contentArea: { flex: 1 },
  previewHintWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  previewHint: {
    fontStyle: 'italic',
    opacity: 0.8,
  },
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
