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
 * personas (and character copies) — is NEVER rendered here, even when the
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
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hapticLightPress } from '../utils/haptics';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import { PostCard } from '../components/social/PostCard';
import { PostCommentModal } from '../components/social/PostCommentModal';
import {
  getUserPostsByAuthor,
  UserPost,
  isPostLiked,
  togglePostLike,
  getPostLikesCount,
  getPostCommentsCount,
  isFollowing,
  addFollow,
  removeFollow,
} from '../database/repositories/userSocial';
import UserProfileStore from '../services/profile/UserProfileStore';
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

  const { userId, displayName: paramName, avatarUrl: paramAvatar } = route.params;

  const [refreshing, setRefreshing] = useState(false);
  const [followingCreator, setFollowingCreator] = useState(false);

  // ── Target user resolution ─────────────────────────────────────────────
  const [displayName, setDisplayName] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [bio, setBio] = useState<string>('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  // User posts authored by this user (public content only)
  const [posts, setPosts] = useState<UserPost[]>([]);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [postState, setPostState] = useState<
    Record<string, { liked: boolean; likes: number; commentCount: number }>
  >({});

  const isSelf = !!currentUser && currentUser.id === userId;

  const loadProfile = useCallback(async () => {
    if (isSelf && currentUser) {
      try {
        const local = await UserProfileStore.getLocalProfile(currentUser.id);
        setDisplayName(local.displayName ?? currentUser.display_name ?? '');
        setUsername(local.username ?? '');
        setBio(local.bio ?? '');
        setAvatarUri(local.avatar_data_url ?? currentUser.avatar_url ?? null);
      } catch (err) {
        log.error('Failed to load local profile:', err);
      }
    } else {
      // For other users the app only has what it has recorded locally —
      // creator rows / post author rows / follow entries. The navigation
      // params carry the creator's recorded name/avatar when known.
      setDisplayName(paramName ?? '');
      setUsername('');
      setBio('');
      setAvatarUri(paramAvatar ?? null);
    }
  }, [isSelf, currentUser, paramName, paramAvatar]);

  const loadPosts = useCallback(async () => {
    try {
      const list = await getUserPostsByAuthor(userId);
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
      log.error('Failed to load user posts:', err);
    }
  }, [userId]);

  const loadFollowState = useCallback(async () => {
    if (!currentUser || isSelf) return;
    try {
      const following = await isFollowing(userId);
      setFollowingCreator(following);
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
      if (followingCreator) {
        await removeFollow(userId);
        setFollowingCreator(false);
        showToast(t('postUnfollowedToast', { name: resolvedDisplayName }));
      } else {
        await addFollow({
          targetUserId: userId,
          targetDisplayName: resolvedDisplayName,
          targetAvatarUrl: avatarUri,
        });
        setFollowingCreator(true);
        showToast(t('postFollowedToast', { name: resolvedDisplayName }));
      }
    } catch (err) {
      log.error('Failed to toggle follow:', err);
    }
  };

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

  const handleOpenPostComments = (postId: string) => {
    setCommentPostId(postId);
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

            {/* Follow / Following pill — shown only on another user's profile.
                Your own profile has no follow button (you can't follow yourself). */}
            {!isSelf && currentUser && (
              <View style={styles.followPillWrap}>
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
              0
            </ThemedText>
            <ThemedText variant="muted" size={12} hierarchy="caption">
              {t('following')}
            </ThemedText>
          </View>
          <View style={styles.statItem}>
            <ThemedText variant="primary" size={18} weight="bold" hierarchy="header">
              0
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