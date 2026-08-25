/**
 * MyProfileScreen — My Profile tab
 *
 * Professional profile surface laid out per the user's spec:
 *   - Header: display name + @username top-left, circular avatar top-right
 *   - Stats row: Following · Followers · AI Characters (floating text)
 *   - Bio: clean, left-aligned floating text below the stats
 *   - Icon-only tab bar: Posts | Favorites | Personas with active underline
 *   - 3-column media grid rendering the content of the selected tab
 *
 * All profile text (name, handle, bio, stats) is raw floating text directly
 * on the screen background — no background cards / containers / boxes.
 *
 * All data is cloud-first: the UserProfile from useAuth() is the single source
 * for the display name (graceful "User" fallback), characters come from the
 * character_profiles repository (local), follower/following stats and the
 * Posts/Saved tabs come from the SocialService stub, and personas are entities
 * linked to user-tagged character profiles (see personas repo). Username / bio
 * / avatar are per-device extras merged in from the ProfileExtrasService stub
 * seam (the locally-picked avatar overrides the cloud avatar_url).
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
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useToast } from '../contexts/AppToastContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { HeaderNotificationButton } from '../components/navigation/HeaderNotificationButton';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hapticLightPress } from '../utils/haptics';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import { ProfileTabs, ProfileTabKey, ProfileTabDef } from '../components/profile/ProfileTabs';
import { getUserCharacterProfiles } from '../database/repositories/characters';
import * as SocialService from '../services/social/SocialService';
import type { StubPost } from '../services/social/SocialService';
import { getAllPersonas, Persona } from '../database/repositories/personas';
import { CharacterProfile } from '../database/models';
import ChatPreferencesService from '../services/ChatPreferencesService';
import ProfileExtrasService from '../services/profile/ProfileExtrasService';
import { createLogger } from '../utils/logger';
import { CreatePostModal } from '../components/social/CreatePostModal';
import { PostCommentModal } from '../components/social/PostCommentModal';
import { PostCard } from '../components/social/PostCard';

const log = createLogger('[MyProfileScreen]');

export const MyProfileScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { t } = useTranslation('profile');
  const { user, status } = useAuth();
  const { showAlert } = useAppAlert();
  const { showToast } = useToast();

  // ── Data state ─────────────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTabKey>('posts');

  // Cloud-first profile: the display name resolves from useAuth().user (the
  // backend PATCH /v1/auth/me keeps it in sync); username/bio/avatar are
  // per-device extras from the ProfileExtrasService stub seam.
  const [displayName, setDisplayName] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [bio, setBio] = useState<string>('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  // Social stub stats (Following = stub follow count; Followers has no stub
  // source yet — kept honest at 0).
  const [followingCount, setFollowingCount] = useState(0);

  // User-created characters (drives the AI Characters stat)
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);

  // Personas (entities linked to user-tagged profiles)
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);

  // Saved AI characters (My Profile > Saved tab) — stub entries are
  // self-contained {profileId, name, avatarText, savedAt} records.
  const [savedCharacters, setSavedCharacters] = useState<
    SocialService.SavedCharacterEntry[]
  >([]);

  // User posts (My Profile > Posts tab) + interaction state
  const [posts, setPosts] = useState<StubPost[]>([]);
  const [createPostVisible, setCreatePostVisible] = useState(false);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [postState, setPostState] = useState<
    Record<string, { liked: boolean; likes: number; commentCount: number }>
  >({});

  const isAuthed = status === 'authenticated' && !!user;

  // ── Loaders ────────────────────────────────────────────────────────────
  const loadProfile = useCallback(async () => {
    if (!user) return;
    try {
      // Cloud-first: display name from auth (the single source of truth after
      // PATCH /v1/auth/me). Username / bio / avatar are per-device extras from
      // the ProfileExtrasService stub — the locally-picked avatar overrides
      // the cloud avatar_url (mirroring the old shadow store's merge).
      const extras = await ProfileExtrasService.getExtras(user.id);
      setDisplayName(user.display_name ?? '');
      setUsername(extras.username);
      setBio(extras.bio);
      setAvatarUri(extras.avatarDataUrl ?? user.avatar_url ?? null);
    } catch (err) {
      log.error('Failed to load profile extras:', err);
    }
  }, [user]);

  const loadFollowStats = useCallback(async () => {
    try {
      const followed = await SocialService.getFollowedUsers();
      setFollowingCount(followed.length);
    } catch (err) {
      log.error('Failed to load follow stats:', err);
    }
  }, []);

  const loadCharacters = useCallback(async () => {
    try {
      const profiles = await getUserCharacterProfiles();
      setCharacters(profiles);
    } catch (err) {
      log.error('Failed to load profile characters:', err);
    }
  }, []);

  const loadPersonas = useCallback(async () => {
    try {
      const stored = await ChatPreferencesService.getGlobalImpersonatedEntity();
      const all = await getAllPersonas();
      const active = stored && all.some(p => p.id === stored) ? stored : null;
      setActivePersonaId(active);
      setPersonas(all.map(p => ({ ...p, isActive: p.id === active })));
    } catch (err) {
      log.error('Failed to load personas:', err);
    }
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const entries = await SocialService.getSavedCharacterEntries();
      setSavedCharacters(entries);
    } catch (err) {
      log.error('Failed to load saved characters:', err);
    }
  }, []);

  const loadPosts = useCallback(async () => {
    if (!user) return;
    try {
      // The stub authors the signed-in user's posts as LOCAL_USER_ID.
      const list = await SocialService.getPosts({
        authorId: SocialService.LOCAL_USER_ID,
      });
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
  }, [user]);

  // Reload on focus so edits (profile, persona, character) reflect immediately.
  // Also reset the tab back to Posts — the default — every time the screen is
  // focused, so returning to the profile never lands on a stale sub-tab.
  useFocusEffect(
    useCallback(() => {
      setActiveTab('posts');
      loadProfile();
      loadFollowStats();
      loadCharacters();
      loadPersonas();
      loadSaved();
      loadPosts();
    }, [loadProfile, loadFollowStats, loadCharacters, loadPersonas, loadSaved, loadPosts]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadProfile(),
      loadFollowStats(),
      loadCharacters(),
      loadPersonas(),
      loadSaved(),
      loadPosts(),
    ]);
    setRefreshing(false);
  }, [loadProfile, loadFollowStats, loadCharacters, loadPersonas, loadSaved, loadPosts]);

  // ── Persona actions ────────────────────────────────────────────────────
  const handleSetActivePersona = async (id: string) => {
    try {
      await ChatPreferencesService.setGlobalImpersonatedEntity(id);
      const persona = personas.find(p => p.id === id);
      setActivePersonaId(id);
      setPersonas(prev =>
        prev.map(p => ({ ...p, isActive: p.id === id })),
      );
      showAlert(t('personaSetActiveDone', { name: persona?.name ?? '' }));
    } catch (err) {
      log.error('Failed to set active persona:', err);
    }
  };

  const handleOpenPersonaEdit = (entityId?: string) => {
    navigation.navigate('PersonaEdit', entityId ? { entityId } : {});
  };

  const handleOpenEditProfile = () => {
    navigation.navigate('EditProfile');
  };

  const handleTogglePostLike = async (postId: string) => {
    try {
      const nowLiked = await SocialService.togglePostLike(postId);
      // Re-read the post for the updated like count.
      const post = (
        await SocialService.getPosts({ authorId: SocialService.LOCAL_USER_ID })
      ).find(p => p.id === postId);
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

  // Delete one of the user's own posts (owner only).
  const handleDeletePost = (postId: string) => {
    try {
      SocialService.deletePost(postId)
        .then(() => {
          setPosts(prev => prev.filter(p => p.id !== postId));
          showToast(t('postDeleteDone'));
        })
        .catch(err => {
          log.warn('Failed to delete post:', err);
          showAlert(t('common:error'), t('postDeleteFailed'));
        });
    } catch (err) {
      log.warn('Failed to delete post:', err);
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

  // ── Derived values ─────────────────────────────────────────────────────
  const resolvedDisplayName = (displayName || user?.display_name || 'User').trim();
  const emailPrefix = user?.email?.split('@')[0] ?? '';
  const derivedUsername = username || emailPrefix || '';
  const bioText = bio.trim();

  if (!theme) return null;

  // Icon-only tabs — Posts (grid) | Saved (bookmark) | Personas (user)
  const tabs: ProfileTabDef[] = [
    {
      key: 'posts',
      icon: 'view-grid-outline',
      iconFocused: 'view-grid',
      label: t('tabPosts'),
    },
    {
      key: 'saved',
      icon: 'bookmark-outline',
      iconFocused: 'bookmark',
      label: t('tabSaved'),
    },
    {
      key: 'personas',
      icon: 'account-outline',
      iconFocused: 'account',
      label: t('tabPersonas'),
    },
  ];

  // ── Unauthenticated state ──────────────────────────────────────────────
  if (!isAuthed) {
    return (
      <ThemedView variant="base" style={styles.container}>
        <ScreenHeader
          title={t('title')}
          right={
            <View style={styles.headerRightRow}>
              <HeaderNotificationButton />
              <HeaderMenuButton />
            </View>
          }
        />
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom },
          ]}
        >
          <ThemedEmptyState
            icon="account-circle-outline"
            title={t('signInTitle')}
            subtitle={t('signInHint')}
            style={styles.authEmpty}
            testID="profile-not-signed-in"
          />
          <View style={styles.authAction}>
            <ThemedButton
              label={t('signInButton')}
              onPress={() => navigation.navigate('Login')}
              icon="login"
              testID="profile-sign-in-button"
            />
          </View>
        </ScrollView>
      </ThemedView>
    );
  }

  // ── Authenticated profile ──────────────────────────────────────────────
  return (
    <ThemedView variant="base" style={styles.container}>
      {/* Header (title + bell + hamburger menu) */}
      <ScreenHeader
        title={t('title')}
        right={
          <View style={styles.headerRightRow}>
            <HeaderNotificationButton />
            <HeaderMenuButton />
          </View>
        }
      />

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

            {/* Username — small, NOT bold, directly under the display name */}
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
                {t('notSignedIn')}
              </ThemedText>
            )}

            {/* Compact Edit Profile pill */}
            <TouchableOpacity
              onPress={() => {
                hapticLightPress();
                handleOpenEditProfile();
              }}
              activeOpacity={0.7}
              style={styles.editPill}
              testID="profile-edit-button"
              accessibilityRole="button"
              accessibilityLabel={t('editProfile')}
            >
              <Icon
                name="account-edit-outline"
                size={14}
                color={theme.colors.accent.primary}
              />
              <ThemedText
                size={12}
                weight="medium"
                style={{ color: theme.colors.accent.primary }}
              >
                {t('editProfile')}
              </ThemedText>
            </TouchableOpacity>

            {/* Bio — clean left-aligned floating text, directly under the
                edit button. Rendered only when the user has written one. */}
            {bioText ? (
              <ThemedText
                variant="secondary"
                size={14}
                hierarchy="subtext"
                style={styles.bioText}
              >
                {bioText}
              </ThemedText>
            ) : null}
          </View>

          {/* Avatar — top-right corner */}
          <ProfileAvatar
            name={resolvedDisplayName}
            uri={avatarUri}
            size={96}
            testID="profile-avatar"
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
              0
            </ThemedText>
            <ThemedText variant="muted" size={12} hierarchy="caption">
              {t('followers')}
            </ThemedText>
          </View>
          <View style={styles.statItem}>
            <ThemedText variant="primary" size={18} weight="bold" hierarchy="header">
              {characters.length}
            </ThemedText>
            <ThemedText variant="muted" size={12} hierarchy="caption">
              {t('aiCharacters')}
            </ThemedText>
          </View>
        </View>

        {/* ── Tab bar — icon-only with active underline ── */}
        <ProfileTabs active={activeTab} onChange={setActiveTab} tabs={tabs} />

        {/* ── Content grid — 3-column media grid for the active tab ── */}
        <View style={styles.gridContent}>
          {activeTab === 'posts' && (
            <>
              {/* "New Post" button */}
              <TouchableOpacity
                onPress={() => {
                  hapticLightPress();
                  setCreatePostVisible(true);
                }}
                activeOpacity={0.7}
                style={styles.newPostPill}
                testID="new-post-button"
                accessibilityRole="button"
                accessibilityLabel={t('newPost')}
              >
                <Icon name="plus" size={16} color={theme.colors.accent.primary} />
                <ThemedText size={13} weight="medium" style={{ color: theme.colors.accent.primary }}>
                  {t('newPost')}
                </ThemedText>
              </TouchableOpacity>

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
                        onDeletePost={() => handleDeletePost(post.id)}
                      />
                    );
                  })}
                </View>
              )}
            </>
          )}

          {activeTab === 'saved' &&
            (savedCharacters.length === 0 ? (
              <ThemedEmptyState
                icon="bookmark-outline"
                title={t('tabFavoritesEmpty')}
                subtitle={t('tabFavoritesEmptyHint')}
                compact
                style={styles.gridEmpty}
              />
            ) : (
              <View style={styles.grid}>
                {savedCharacters.map(entry => (
                  <TouchableOpacity
                    key={entry.profileId}
                    onPress={() => {
                      hapticLightPress();
                      navigation.navigate('AIProfile', {
                        profileId: entry.profileId,
                      });
                    }}
                    activeOpacity={0.75}
                    style={styles.gridItem}
                    testID="profile-saved-ai-cell"
                    accessibilityRole="button"
                    accessibilityLabel={entry.name}
                  >
                    <View style={styles.gridAvatarWrap}>
                      <ProfileAvatar
                        name={entry.name}
                        uri={null}
                        size={72}
                        showRing={false}
                      />
                    </View>
                    <ThemedText
                      size={12}
                      weight="medium"
                      numberOfLines={1}
                      style={styles.gridItemName}
                    >
                      {entry.name}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            ))}

          {activeTab === 'personas' &&
            (personas.length === 0 ? (
              <ThemedEmptyState
                icon="account-outline"
                title={t('tabPersonasEmpty')}
                subtitle={t('tabPersonasEmptyHint')}
                compact
                style={styles.gridEmpty}
                action={
                  <ThemedButton
                    label={t('newPersona')}
                    onPress={() => handleOpenPersonaEdit()}
                    variant="ghost"
                    icon="plus"
                    testID="new-persona-button"
                  />
                }
              />
            ) : (
              <>
                <View style={styles.grid}>
                  {personas.map(p => {
                    const isActive = p.id === activePersonaId;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => {
                          hapticLightPress();
                          handleOpenPersonaEdit(p.id);
                        }}
                        onLongPress={() => handleSetActivePersona(p.id)}
                        activeOpacity={0.75}
                        style={styles.gridItem}
                        testID="profile-persona-cell"
                        accessibilityLabel={`${p.name}${isActive ? ' (active)' : ''}`}
                        accessibilityRole="button"
                      >
                        <View style={styles.gridAvatarWrap}>
                          <ProfileAvatar
                            name={p.name}
                            uri={p.avatarUri}
                            size={72}
                            showRing={false}
                          />
                          {isActive && (
                            <View
                              style={[
                                styles.activeBadge,
                                { backgroundColor: theme.colors.accent.primary },
                              ]}
                            >
                              <Icon name="check" size={12} color="#fff" />
                            </View>
                          )}
                        </View>
                        <ThemedText
                          size={12}
                          weight="medium"
                          numberOfLines={1}
                          style={styles.gridItemName}
                        >
                          {p.name}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  onPress={() => {
                    hapticLightPress();
                    handleOpenPersonaEdit();
                  }}
                  activeOpacity={0.7}
                  style={styles.newPersonaPill}
                  testID="new-persona-button"
                  accessibilityRole="button"
                  accessibilityLabel={t('newPersona')}
                >
                  <Icon
                    name="plus"
                    size={16}
                    color={theme.colors.accent.primary}
                  />
                  <ThemedText
                    size={12}
                    weight="medium"
                    style={{ color: theme.colors.accent.primary }}
                  >
                    {t('newPersona')}
                  </ThemedText>
                </TouchableOpacity>
              </>
            ))}
        </View>
      </ScrollView>

      {/* ── Post composer + comments ── */}
      <CreatePostModal
        visible={createPostVisible}
        onClose={() => setCreatePostVisible(false)}
        onPublished={() => loadPosts()}
      />
      <PostCommentModal
        visible={commentPostId != null}
        postId={commentPostId}
        onClose={handlePostCommentsClosed}
        // All posts here are the current user's own — they can moderate any comment.
        canModerateAll
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#7c3aed' + '55',
    backgroundColor: '#7c3aed' + '18',
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
  // ── Grid ──
  gridContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  newPostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  postsFeed: {
    gap: 16,
    paddingBottom: 24,
  },
  gridEmpty: {
    paddingTop: 40,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: {
    width: '30%',
    alignItems: 'center',
    gap: 6,
  },
  gridAvatarWrap: {
    position: 'relative',
  },
  gridItemName: {
    textAlign: 'center',
  },
  activeBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.6)',
  },
  newPersonaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 4,
    marginTop: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#7c3aed' + '55',
    backgroundColor: '#7c3aed' + '18',
  },
  // ── Unauthenticated ──
  authEmpty: {
    paddingTop: 80,
  },
  authAction: {
    marginTop: 16,
    marginHorizontal: 48,
  },
});

export default MyProfileScreen;
