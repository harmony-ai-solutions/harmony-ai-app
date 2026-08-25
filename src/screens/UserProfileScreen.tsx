/**
 * UserProfileScreen — a public profile page for any cloud user (e.g. an AI
 * character's creator).
 *
 * The creator badge on AIProfileScreen opens THIS screen — the actual
 * creator's profile — instead of always pushing the current user's own
 * "My Profile" tab. This screen resolves the target user by id and renders
 * ONLY public information:
 *   - Header: display name + @handle + avatar (top-right)
 *   - Stats row: Following · Followers
 *   - Bio
 *   - A Follow / Following button (hidden when the target is the current user)
 *   - The user's published posts
 *
 * PRIVACY: private content — the user's AI characters, saved characters,
 * personas (and character forks) — is NEVER rendered here, even when the
 * target is the current user. That content lives only on the "My Profile"
 * tab. This screen is a read-only, public-facing view.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/AppToastContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hapticLightPress } from '../utils/haptics';
import { hexToRgba } from '../utils/colorUtils';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import { PostCard } from '../components/social/PostCard';
import { PostCommentModal } from '../components/social/PostCommentModal';
import * as SocialService from '../services/social/SocialService';
import type { StubPost } from '../services/social/SocialService';
import { filterBlockedUserPosts } from '../utils/blockedContentFilters';
import { RootStackParamList } from '../navigation/AppNavigator';
import { createLogger } from '../utils/logger';

const log = createLogger('[UserProfileScreen]');

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'UserProfile'>;

export const UserProfileScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { t } = useTranslation('profile');
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();
  const { showAlert } = useAppAlert();

  const { userId, displayName: paramName, avatarUrl: paramAvatar } = route.params;

  const [refreshing, setRefreshing] = useState(false);
  const [followingCreator, setFollowingCreator] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  // ── Target user resolution ─────────────────────────────────────────────
  const [displayName, setDisplayName] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [bio, setBio] = useState<string>('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  // Public profile stats (stub-backed for known fixture users; 0 otherwise).
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  // User posts authored by this user (public content only)
  const [posts, setPosts] = useState<StubPost[]>([]);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [postState, setPostState] = useState<
    Record<string, { liked: boolean; likes: number; commentCount: number }>
  >({});

  const isSelf = !!currentUser && currentUser.id === userId;

  const loadProfile = useCallback(async () => {
    if (isSelf && currentUser) {
      // Cloud-first: the signed-in user's own profile comes from auth.
      setDisplayName(currentUser.display_name ?? '');
      setUsername('');
      setBio('');
      setAvatarUri(currentUser.avatar_url ?? null);
      setFollowerCount(0);
      setFollowingCount(0);
    } else {
      // Resolve the target's PUBLIC profile from the stub service. Unknown
      // users (not in the fixture set) fall back to the navigation params.
      try {
        const profile = await SocialService.getPublicUserProfile(userId);
        setDisplayName(profile.displayName ?? paramName ?? '');
        setUsername('');
        setBio(profile.bio ?? '');
        setAvatarUri(profile.avatarUrl ?? paramAvatar ?? null);
        setFollowerCount(profile.followerCount);
        setFollowingCount(profile.followingCount);
      } catch (err) {
        log.warn(`Failed to load public profile for ${userId}:`, err);
        setDisplayName(paramName ?? '');
        setUsername('');
        setBio('');
        setAvatarUri(paramAvatar ?? null);
        setFollowerCount(0);
        setFollowingCount(0);
      }
    }
  }, [isSelf, currentUser, userId, paramName, paramAvatar]);

  const loadPosts = useCallback(async () => {
    try {
      // When viewing your own public profile, the stub authors your posts as
      // LOCAL_USER_ID (the cloud id has no authored posts in the stub).
      const authorId = isSelf ? SocialService.LOCAL_USER_ID : userId;
      let list = await SocialService.getPosts({ authorId });
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
      log.error('Failed to load user posts:', err);
    }
  }, [isSelf, userId]);

  const loadFollowState = useCallback(async () => {
    if (!currentUser || isSelf) return;
    try {
      const following = await SocialService.isFollowing(userId);
      setFollowingCreator(following);
      const blockedIds = await SocialService.getBlockedUserIds();
      setBlocked(blockedIds.has(userId));
    } catch (err) {
      log.error('Failed to load follow state:', err);
    }
  }, [currentUser, isSelf, userId]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
      loadPosts();
      loadFollowState();
    }, [loadProfile, loadPosts, loadFollowState]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadProfile(), loadPosts(), loadFollowState()]);
    setRefreshing(false);
  }, [loadProfile, loadPosts, loadFollowState]);

  const handleToggleFollow = async () => {
    if (!currentUser || isSelf) return;
    try {
      const nowFollowing = await SocialService.toggleFollow(userId);
      setFollowingCreator(nowFollowing);
      showToast(
        nowFollowing
          ? t('postFollowedToast', { name: resolvedDisplayName })
          : t('postUnfollowedToast', { name: resolvedDisplayName }),
      );
    } catch (err) {
      log.error('Failed to toggle follow:', err);
    }
  };

  const performBlock = async () => {
    if (!currentUser || isSelf) return;
    try {
      await SocialService.blockUser(userId);
      setBlocked(true);
      setFollowingCreator(false);
      setPosts([]);
      showToast(t('userBlockedToast', { name: resolvedDisplayName }));
    } catch (err) {
      log.error('Failed to block user:', err);
    }
  };

  const handleToggleBlock = () => {
    if (!currentUser || isSelf) return;
    setMenuVisible(false);
    hapticLightPress();
    if (blocked) {
      SocialService.unblockUser(userId)
        .then(() => {
          setBlocked(false);
          showToast(t('userUnblockedToast', { name: resolvedDisplayName }));
          loadFollowState();
        })
        .catch(err => log.error('Failed to unblock user:', err));
    } else {
      showAlert(
        t('blockUserConfirmTitle', { name: resolvedDisplayName }),
        t('blockUserConfirmMessage'),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('blockUserConfirmAction'),
            style: 'destructive',
            onPress: performBlock,
          },
        ],
        { icon: 'shield-off-outline' },
      );
    }
  };

  const handleTogglePostLike = async (postId: string) => {
    try {
      const nowLiked = await SocialService.togglePostLike(postId);
      // Re-read the post for the updated like count.
      const authorId = isSelf ? SocialService.LOCAL_USER_ID : userId;
      const post = (await SocialService.getPosts({ authorId })).find(
        p => p.id === postId,
      );
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

  const handleOpenPostComments = (postId: string) => {
    setCommentPostId(postId);
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

  if (!theme) return null;

  const resolvedDisplayName = (displayName || 'Creator').trim();
  const title = isSelf ? t('title') : resolvedDisplayName;
  const derivedUsername = username;

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScreenHeader title={title} onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.accent.primary]}
            tintColor={theme.colors.accent.primary}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
      >
        {/* ── Header: name + handle top-left, avatar top-right ── */}
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <ThemedText
              variant="primary"
              size={26}
              weight="bold"
              hierarchy="header"
              style={styles.displayName}
              numberOfLines={2}
            >
              {resolvedDisplayName}
            </ThemedText>

            {derivedUsername ? (
              <ThemedText
                variant="muted"
                size={14}
                hierarchy="subtext"
                style={styles.username}
                numberOfLines={1}
              >
                @{derivedUsername}
              </ThemedText>
            ) : (
              <ThemedText
                variant="muted"
                size={14}
                hierarchy="caption"
                style={styles.username}
              >
                {t('noUsername')}
              </ThemedText>
            )}

            {/* Follow / Following pill + ⋮ menu — shown only on another user's
                profile. Your own profile has no follow button (you can't follow
                yourself). The ⋮ dropdown holds the Block / Unblock action. */}
            {!isSelf && currentUser && (
              <View style={styles.followPillWrap}>
                <View style={styles.followRow}>
                  <TouchableOpacity
                    onPress={() => {
                      hapticLightPress();
                      handleToggleFollow();
                    }}
                    activeOpacity={0.7}
                    style={[
                      styles.followPill,
                      {
                        borderColor: theme.colors.accent.primary + '55',
                        backgroundColor: followingCreator
                          ? theme.colors.accent.primary + '78'
                          : theme.colors.accent.primary + '18',
                      },
                    ]}
                    testID="user-profile-follow-button"
                    accessibilityRole="button"
                    accessibilityLabel={
                      followingCreator ? t('postFollowing') : t('postFollow')
                    }
                  >
                    <Icon
                      name={followingCreator ? 'account-check-outline' : 'account-plus-outline'}
                      size={14}
                      color={theme.colors.accent.primary}
                    />
                    <ThemedText
                      size={12}
                      weight="medium"
                      style={{ color: theme.colors.accent.primary }}
                    >
                      {followingCreator ? t('postFollowing') : t('postFollow')}
                    </ThemedText>
                  </TouchableOpacity>

                  {/* ⋮ menu trigger */}
                  <TouchableOpacity
                    onPress={() => {
                      hapticLightPress();
                      setMenuVisible(v => !v);
                    }}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={[
                      styles.menuButton,
                      { backgroundColor: menuVisible ? theme.colors.accent.primary + '22' : hexToRgba(theme.colors.border.default, 0.25) },
                    ]}
                    testID="user-profile-more-button"
                    accessibilityRole="button"
                    accessibilityLabel={t('moreActions')}
                  >
                    <Icon
                      name="dots-horizontal"
                      size={18}
                      color={theme.colors.text.primary}
                    />
                  </TouchableOpacity>

                  {/* Dropdown menu */}
                  {menuVisible && (
                    <>
                      <TouchableOpacity
                        style={styles.menuBackdrop}
                        activeOpacity={1}
                        onPress={() => setMenuVisible(false)}
                      />
                      <View
                        style={[
                          styles.dropdown,
                          {
                            backgroundColor: theme.colors.background.surface,
                            borderColor: hexToRgba(theme.colors.border.default, 0.4),
                          },
                        ]}
                        testID="user-profile-dropdown"
                      >
                        <TouchableOpacity
                          onPress={handleToggleBlock}
                          activeOpacity={0.7}
                          style={styles.dropdownItem}
                          testID="user-profile-block-button"
                        >
                          <Icon
                            name={blocked ? 'shield-remove-outline' : 'shield-off-outline'}
                            size={16}
                            color={theme.colors.status.error}
                          />
                          <ThemedText
                            size={14}
                            weight="medium"
                            style={{ color: theme.colors.status.error }}
                          >
                            {blocked ? t('unblockUser') : t('blockUser')}
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              </View>
            )}

            {bio ? (
              <ThemedText
                variant="secondary"
                size={14}
                hierarchy="subtext"
                style={styles.bioText}
              >
                {bio}
              </ThemedText>
            ) : null}
          </View>

          <ProfileAvatar
            name={resolvedDisplayName}
            uri={avatarUri}
            size={96}
          />
        </View>

        {/* ── Stats row (raw floating text — no card) ── */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <ThemedText variant="primary" size={18} weight="bold" hierarchy="header">
              {followingCount}
            </ThemedText>
            <ThemedText variant="muted" size={12} hierarchy="caption">
              {t('following')}
            </ThemedText>
          </View>
          <View style={styles.statItem}>
            <ThemedText variant="primary" size={18} weight="bold" hierarchy="header">
              {followerCount}
            </ThemedText>
            <ThemedText variant="muted" size={12} hierarchy="caption">
              {t('followers')}
            </ThemedText>
          </View>
        </View>

        {/* ── Section label ── */}
        <View style={styles.sectionHeader}>
          <ThemedText variant="primary" size={16} weight="bold" hierarchy="header">
            {t('tabPosts')}
          </ThemedText>
        </View>

        {/* ── Public posts ── */}
        <View style={styles.gridContent}>
          {posts.length === 0 ? (
            <ThemedEmptyState
              icon="post-outline"
              title={t('tabPostsEmpty')}
              subtitle={t('tabPostsEmptyHint')}
              compact
              style={styles.gridEmpty}
            />
          ) : (
            <View style={styles.postsFeed}>
              {posts.map(post => {
                const state = postState[post.id] ?? { liked: false, likes: 0, commentCount: 0 };
                return (
                  <PostCard
                    key={post.id}
                    post={post}
                    liked={state.liked}
                    likes={state.likes}
                    commentCount={state.commentCount}
                    onToggleLike={() => handleTogglePostLike(post.id)}
                    onOpenComments={() => handleOpenPostComments(post.id)}
                    showAuthor={false}
                  />
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <PostCommentModal
        visible={commentPostId != null}
        postId={commentPostId}
        onClose={handlePostCommentsClosed}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingHorizontal: 16,
    gap: 16,
  },
  headerInfo: {
    flex: 1,
    gap: 4,
  },
  displayName: {
    textAlign: 'left',
  },
  username: {
    textAlign: 'left',
  },
  followPillWrap: {
    marginTop: 8,
  },
  followRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  followPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  menuButton: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  dropdown: {
    position: 'absolute',
    top: 34,
    left: 0,
    zIndex: 30,
    minWidth: 150,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 12,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  // ── Stats (floating text, no card) ──
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingHorizontal: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  // ── Bio ──
  bioText: {
    marginTop: 12,
    lineHeight: 20,
    textAlign: 'left',
  },
  // ── Section ──
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  gridContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  postsFeed: {
    gap: 16,
    paddingBottom: 24,
  },
  gridEmpty: {
    paddingTop: 24,
  },
});

export default UserProfileScreen;