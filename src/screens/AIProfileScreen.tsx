/**
 * AIProfileScreen — profile page for an AI character.
 *
 * Mirrors the user's My Profile screen but for the AI partner itself:
 *   - Header: AI name + description + avatar (top-right)
 *   - Creator badge (creator avatar + name) under the AI name → opens the
 *     creator's profile page (My Profile tab) when tapped
 *   - Creator-only "Edit AI Profile and Settings" pill (above the action row,
 *     hidden from other users — they are forbidden from editing characters
 *     they don't own)
 *   - Primary Chat button + small rounded Like / Save buttons
 *   - Stats row: Likes · Chats (Likes counts profile likes + image likes)
 *   - Icon-only tab bar: Images | Forks
 *   - Images tab: every gallery image (including the avatar) rendered as a
 *     POST with like + comment buttons — any user can interact, read the
 *     others' comments, and see the like count
 *   - Forks tab: the other forks of the same AI character (same base name),
 *     tappable to open their own profile
 *
 * Reached from the Characters screen by tapping an AI character card.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Image,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
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
import { hexToRgba } from '../utils/colorUtils';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import { ProfileTabs } from '../components/profile/ProfileTabs';
import { ImageCommentModal } from '../components/characters/ImageCommentModal';
import {
  getCharacterProfile,
  getCharacterImages,
  getSiblingCharacterProfiles,
  getCharacterStats,
  CharacterStats,
} from '../database/repositories/characters';
import {
  getEntityByCharacterProfileId,
  setEntityDisabled,
  setEntityMuted,
} from '../database/repositories/entities';
import * as SocialService from '../services/social/SocialService';
import type { StubCharacterCreator } from '../services/social/SocialService';
import { openCharacterChat } from '../services/CharacterChatService';
import {
  getListingForProfile,
  isChatLocked,
} from '../services/marketplace/MarketplaceService';
import type { MarketplaceListingDetail } from '../services/marketplace/MarketplaceService';
import { createDataURL } from '../database/base64';
import { CharacterProfile, CharacterImage } from '../database/models';
import { RootStackParamList } from '../navigation/AppNavigator';
import { createLogger } from '../utils/logger';
import { formatPostDate } from '../utils/dateFormat';

const log = createLogger('[AIProfileScreen]');

/** Purple brand gradient — neon magenta → violet (design palette). */
const PURPLE_GRADIENT: [string, string] = ['#8f3ba7', '#7c3aed'];

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'AIProfile'>;

type AITabKey = 'images' | 'copies';

/** Per-image interaction state for the Images posts tab. */
interface ImagePostState {
  liked: boolean;
  likes: number;
  commentCount: number;
}

export const AIProfileScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const { showToast } = useToast();

  const { profileId } = route.params;

  // ── Data state ─────────────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<AITabKey>('images');
  const [profile, setProfile] = useState<CharacterProfile | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [images, setImages] = useState<CharacterImage[]>([]);
  const [copies, setCopies] = useState<CharacterProfile[]>([]);
  const [copiesAvatars, setCopiesAvatars] = useState<Record<string, string | null>>({});
  const [stats, setStats] = useState<CharacterStats>({ likes: 0, chats: 0 });
  const [loaded, setLoaded] = useState(false);

  // ── Entity flags (Q8) ──────────────────────────────────────────────────
  // The profile's linked AI entity — muted/disabled are GLOBAL per entity.
  const [aiEntityId, setAiEntityId] = useState<string | null>(null);
  const [entityDisabled, setEntityDisabledState] = useState(false);
  const [entityMuted, setEntityMutedState] = useState(false);

  // ── Social state ───────────────────────────────────────────────────────
  const [profileLiked, setProfileLiked] = useState(false);
  const [profileLikes, setProfileLikes] = useState(0);
  const [profileSaved, setProfileSaved] = useState(false);
  const [creator, setCreator] = useState<StubCharacterCreator | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [imagePosts, setImagePosts] = useState<Record<string, ImagePostState>>({});
  // Follow state for the character's creator
  const [followingCreator, setFollowingCreator] = useState(false);

  // ── Marketplace state (stub listing → price pill + chat lock) ──────────
  // Wave 1 stub links a local profile → ACTIVE listing via `sourceProfileId`
  // (getListingForProfile), so this resolves during profile load. The chat
  // button shows the SOUL price pill + lock icon while a live listing is set,
  // and handleChat routes locked profiles to the listing detail to acquire.
  // Marketplace preview lock — viewable free, chat locked until acquired; own
  // library (never published) is never locked.
  const [listing, setListing] = useState<MarketplaceListingDetail | null>(null);

  // ── Comment modal state ────────────────────────────────────────────────
  const [commentImageId, setCommentImageId] = useState<string | null>(null);
  const [commentVisible, setCommentVisible] = useState(false);
  const [chatting, setChatting] = useState(false);

  // ── Loaders ────────────────────────────────────────────────────────────
  const loadProfile = useCallback(async () => {
    try {
      const data = await getCharacterProfile(profileId);
      setProfile(data);
      if (!data) return;

      // Partner AI entity flags (Q8) — muted/disabled are GLOBAL per entity.
      try {
        const ent = await getEntityByCharacterProfileId(profileId);
        if (ent) {
          setAiEntityId(ent.id);
          setEntityDisabledState(ent.is_disabled === 1);
          setEntityMutedState(ent.is_muted === 1);
        }
      } catch (entErr) {
        log.warn('Failed to load entity flags:', entErr);
      }

      // Primary avatar + full gallery
      const imgs = await getCharacterImages(profileId);
      setImages(imgs);
      const primary = imgs.find(img => img.is_primary === true);
      setAvatarUri(
        primary ? createDataURL(primary.image_data, primary.mime_type) : null,
      );

      // Other forks of the same AI (same base name, e.g. Max 2 / Max 3)
      const siblings = await getSiblingCharacterProfiles(data.name);
      const siblingCopies = siblings.filter(s => s.id !== profileId);
      setCopies(siblingCopies);

      // Load each fork's primary avatar for the Forks rows
      try {
        const avatarMap: Record<string, string | null> = {};
        await Promise.all(
          siblingCopies.map(async copy => {
            try {
              const copyImgs = await getCharacterImages(copy.id);
              const copyPrimary = copyImgs.find(img => img.is_primary === true);
              avatarMap[copy.id] = copyPrimary
                ? createDataURL(copyPrimary.image_data, copyPrimary.mime_type)
                : null;
            } catch {
              avatarMap[copy.id] = null;
            }
          }),
        );
        setCopiesAvatars(avatarMap);
      } catch (err) {
        log.warn('Failed to load fork avatars:', err);
      }

      // Likes + Chats stats via this character's entity
      try {
        const entity = await getEntityByCharacterProfileId(profileId);
        if (entity) {
          const s = await getCharacterStats(entity.id);
          setStats(s);
        }
      } catch (err) {
        log.warn('Failed to load character stats:', err);
      }

      // ── Social layer ────────────────────────────────────────────────────
      try {
        const savedEntries = await SocialService.getSavedCharacterEntries();
        const [liked, likes, saved, characterCreator, owner] =
          await Promise.all([
            SocialService.isCharacterLiked(profileId),
            SocialService.getCharacterLikesCount(profileId),
            Promise.resolve(
              savedEntries.some(e => e.profileId === profileId),
            ),
            SocialService.getCharacterCreator(profileId),
            SocialService.isCharacterCreator(profileId, user?.id),
          ]);
        setProfileLiked(liked);
        setProfileLikes(likes);
        setProfileSaved(saved);

        // Ownership: the recorded cloud creator matches the current user. The
        // client-side source tag that used to back this signal was removed
        // with the stub layer (A3) — ownership now resolves from the cloud
        // creator only.
        setIsOwner(!!owner);

        // Creator badge: prefer the recorded creator; otherwise synthesize
        // one from the current user so owned characters always show
        // "Created by …" (cloud profile — the locally-picked avatar shadow
        // store is gone, so the badge falls back to the cloud avatar_url).
        if (characterCreator) {
          if (user?.id && characterCreator.creatorUserId === user.id) {
            setCreator({
              ...characterCreator,
              creatorDisplayName:
                user.display_name ||
                user.email?.split('@')[0] ||
                characterCreator.creatorDisplayName ||
                'Creator',
              creatorAvatarUrl:
                characterCreator.creatorAvatarUrl ?? user.avatar_url ?? null,
            });
          } else {
            setCreator(characterCreator);
          }
        }

        // Follow state — whether the local user follows the character's creator.
        const resolvedCreator =
          (await SocialService.getCharacterCreator(profileId)) ?? null;
        if (resolvedCreator && user?.id && resolvedCreator.creatorUserId !== user.id) {
          try {
            const following = await SocialService.isFollowing(
              resolvedCreator.creatorUserId,
            );
            setFollowingCreator(following);
          } catch (followErr) {
            log.warn('Failed to load follow state:', followErr);
          }
        } else {
          setFollowingCreator(false);
        }
      } catch (err) {
        log.warn('Failed to load character social state:', err);
      }

      // Per-image post state (likes + comments). The stub has no read API for
      // "liked by me" on images — the flag is only returned by toggleImageLike,
      // so the initial render shows un-liked with the seeded like baseline.
      try {
        const postMap: Record<string, ImagePostState> = {};
        await Promise.all(
          imgs.map(async img => {
            try {
              const [likes, comments] = await Promise.all([
                SocialService.getImageLikesCount(img.id),
                SocialService.getImageComments(img.id),
              ]);
              postMap[img.id] = { liked: false, likes, commentCount: comments.length };
            } catch {
              postMap[img.id] = { liked: false, likes: 0, commentCount: 0 };
            }
          }),
        );
        setImagePosts(postMap);
      } catch (err) {
        log.warn('Failed to load image post state:', err);
      }

      // ── Marketplace listing (drives the price pill + chat lock) ──────
      // Wave 1 stub resolves an ACTIVE listing published from this profile
      // (sourceProfileId linkage). When set, the chat button shows the SOUL
      // price + lock icon and handleChat routes locked profiles to the
      // listing detail to acquire (marketplace preview lock — viewable free,
      // chat locked until acquired; own library never locked).
      try {
        const listing = await getListingForProfile(profileId);
        setListing(listing);
      } catch (err) {
        log.warn('Failed to load marketplace listing:', err);
      }
    } catch (err) {
      log.error('Failed to load AI profile:', err);
    } finally {
      setLoaded(true);
    }
  }, [profileId, user?.id]);

  // Reload on focus (edits to the profile reflect immediately)
  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }, [loadProfile]);

  // ── Actions ────────────────────────────────────────────────────────────
  // "Edit AI Profile and Settings" opens the single edit surface:
  // the Create AI Partner screen in edit mode (profile fields + prompt/
  // scenario + gallery + module configs all in one place).
  const handleOpenEditProfile = () => {
    navigation.navigate('CreateAI', { editProfileId: profileId });
  };

  const handleChat = async () => {
    if (!profile || chatting) return;
    setChatting(true);
    try {
      // Marketplace preview lock — viewable free, chat locked until acquired;
      // own library (never published) is NEVER locked. The single isChatLocked
      // check is enough (creator/owner never lock). Instead of the old silent
      // ignore (a placeholder because payment didn't exist), route to the
      // listing detail where the user can acquire the character — the stub
      // now has a working acquire flow. openCharacterChat keeps the central
      // hard gate as defense in depth.
      if (await isChatLocked(profile.id)) {
        const resolvedListing =
          listing ?? (await getListingForProfile(profile.id));
        if (resolvedListing) {
          navigation.navigate('MarketplaceItemDetail', {
            listingId: resolvedListing.id,
          });
        } else {
          log.warn(
            `Chat locked for marketplace profile ${profile.id} — no active listing resolved; ignored.`,
          );
        }
        return;
      }
      await openCharacterChat(profile, {
        navigateToChat: params => navigation.navigate('ChatDetail', params),
      });
    } catch (err) {
      log.error('Failed to open chat:', err);
      showToast(t('common:error'));
    } finally {
      setChatting(false);
    }
  };

  // Q8 — entity-level mute/disable toggles (A3 guard: user entities throw in
  // the repo, so these actions only ever apply to AI entities).
  const handleToggleEntityDisable = async () => {
    if (!aiEntityId) return;
    try {
      const next = !entityDisabled;
      await setEntityDisabled(aiEntityId, next);
      setEntityDisabledState(next);
      showToast(
        next
          ? t('aiDisabledToast', { name: profile?.name ?? '' })
          : t('aiEnabledToast', { name: profile?.name ?? '' }),
      );
    } catch (err) {
      log.warn('Failed to toggle disable:', err);
      showToast(t('common:error'));
    }
  };

  const handleToggleEntityMute = async () => {
    if (!aiEntityId) return;
    try {
      const next = !entityMuted;
      await setEntityMuted(aiEntityId, next);
      setEntityMutedState(next);
      showToast(
        next
          ? t('aiMutedToast', { name: profile?.name ?? '' })
          : t('aiUnmutedToast', { name: profile?.name ?? '' }),
      );
    } catch (err) {
      log.warn('Failed to toggle mute:', err);
      showToast(t('common:error'));
    }
  };

  const handleToggleLike = async () => {
    if (!profile) return;
    try {
      const nowLiked = await SocialService.toggleCharacterLike(profileId);
      const likes = await SocialService.getCharacterLikesCount(profileId);
      setProfileLiked(nowLiked);
      setProfileLikes(likes);
      showToast(
        nowLiked
          ? t('aiLikedToast', { name: profile.name })
          : t('aiUnlikedToast', { name: profile.name }),
      );
    } catch (err) {
      log.warn('Failed to toggle like:', err);
    }
  };

  const handleToggleSave = async () => {
    if (!profile) return;
    try {
      const nowSaved = await SocialService.toggleCharacterSave(profileId);
      setProfileSaved(nowSaved);
      showToast(
        nowSaved
          ? t('aiSavedToast', { name: profile.name })
          : t('aiUnsavedToast', { name: profile.name }),
      );
    } catch (err) {
      log.warn('Failed to toggle save:', err);
    }
  };

  const handleToggleImageLike = async (img: CharacterImage) => {
    try {
      const nowLiked = await SocialService.toggleImageLike(img.id);
      const likes = await SocialService.getImageLikesCount(img.id);
      setImagePosts(prev => ({
        ...prev,
        [img.id]: {
          liked: nowLiked,
          likes,
          commentCount: prev[img.id]?.commentCount ?? 0,
        },
      }));
    } catch (err) {
      log.warn('Failed to toggle image like:', err);
    }
  };

  const handleOpenComments = (img: CharacterImage) => {
    setCommentImageId(img.id);
    setCommentVisible(true);
  };

  const handleCommentsClosed = useCallback(() => {
    setCommentVisible(false);
    setCommentImageId(null);
    // Refresh the comment counts after the modal closes.
    if (commentImageId != null) {
      SocialService.getImageComments(commentImageId)
        .then(comments => {
          setImagePosts(prev => ({
            ...prev,
            [commentImageId]: {
              liked: prev[commentImageId]?.liked ?? false,
              likes: prev[commentImageId]?.likes ?? 0,
              commentCount: comments.length,
            },
          }));
        })
        .catch(() => {});
    }
  }, [commentImageId]);

  const handleOpenCreator = () => {
    if (!creator) return;
    // Open the creator's own profile page — a generic UserProfile pushed on
    // top of this AI profile so "back" returns here instead of switching to
    // the current user's "My Profile" tab. When the creator IS the current
    // user (locally-created characters), UserProfile mirrors My Profile
    // without changing tabs.
    navigation.push('UserProfile', {
      userId: creator.creatorUserId,
      displayName: creator.creatorDisplayName,
      avatarUrl: creator.creatorAvatarUrl,
    });
  };

  const handleToggleFollowCreator = async () => {
    if (!creator || !user) return;
    try {
      const nowFollowing = await SocialService.toggleFollow(
        creator.creatorUserId,
      );
      setFollowingCreator(nowFollowing);
      showToast(
        nowFollowing
          ? t('postFollowedToast', { name: creator.creatorDisplayName })
          : t('postUnfollowedToast', { name: creator.creatorDisplayName }),
      );
    } catch (err) {
      log.warn('Failed to toggle follow:', err);
    }
  };

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const errorColor = theme.colors.status.error;
  const resolvedName = (profile?.name || 'AI Character').trim();
  const bioText = (profile?.description ?? '').trim();

  // ── Tabs: Images (gallery) | Forks (other forks of this AI) ────────────
  const tabs = [
    {
      key: 'images' as AITabKey,
      icon: 'image-multiple-outline',
      iconFocused: 'image-multiple',
      label: t('aiImages'),
    },
    {
      key: 'copies' as AITabKey,
      icon: 'content-copy',
      iconFocused: 'content-copy',
      label: t('aiCopies'),
    },
  ];

  const displayedLikes = profileLikes + stats.likes;

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScreenHeader title={resolvedName} onBack={() => navigation.goBack()} />

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
        {!loaded ? (
          <View style={styles.centered}>
            <Icon name="account-circle-outline" size={40} color={theme.colors.text.muted} />
          </View>
        ) : !profile ? (
          <ThemedEmptyState
            icon="account-off-outline"
            title={t('aiNotFound')}
            subtitle={t('aiNotFoundHint')}
            style={styles.empty}
          />
        ) : (
          <>
            {/* ── Header: name + bio left, avatar right ── */}
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
                  {resolvedName}
                </ThemedText>

                {/* Creator badge — small pill with the creator's avatar + name */}
                {creator ? (
                  <TouchableOpacity
                    onPress={() => {
                      hapticLightPress();
                      handleOpenCreator();
                    }}
                    activeOpacity={0.7}
                    style={styles.creatorBadge}
                    testID="ai-profile-creator-badge"
                    accessibilityRole="button"
                    accessibilityLabel={t('aiCreatorBadge', {
                      name: creator.creatorDisplayName,
                    })}
                  >
                    <ProfileAvatar
                      name={creator.creatorDisplayName || '?'}
                      uri={creator.creatorAvatarUrl}
                      size={20}
                      showRing={false}
                    />
                    <ThemedText
                      size={11}
                      weight="medium"
                      style={{ color: theme.colors.text.secondary }}
                      numberOfLines={1}
                    >
                      {t('aiCreatorBadge', { name: creator.creatorDisplayName })}
                    </ThemedText>
                    <Icon
                      name="chevron-right"
                      size={14}
                      color={theme.colors.text.muted}
                    />
                  </TouchableOpacity>
                ) : null}

                {/* Follow button — shown when the creator is NOT the current user */}
                {creator && user?.id && creator.creatorUserId !== user.id ? (
                  <TouchableOpacity
                    onPress={() => {
                      hapticLightPress();
                      handleToggleFollowCreator();
                    }}
                    activeOpacity={0.7}
                    style={[
                      styles.followPill,
                      followingCreator && styles.followPillActive,
                      {
                        backgroundColor: followingCreator
                          ? accent + '2E'
                          : 'rgba(255,255,255,0.06)',
                        borderColor: followingCreator
                          ? accent
                          : 'rgba(255,255,255,0.15)',
                      },
                    ]}
                    testID="ai-profile-follow-button"
                    accessibilityRole="button"
                    accessibilityLabel={
                      followingCreator ? t('postFollowing') : t('postFollow')
                    }
                  >
                    <Icon
                      name={followingCreator ? 'check' : 'account-plus-outline'}
                      size={13}
                      color={followingCreator ? accent : theme.colors.text.secondary}
                    />
                    <ThemedText
                      size={12}
                      weight="medium"
                      variant={followingCreator ? 'accent' : 'primary'}
                    >
                      {followingCreator ? t('postFollowing') : t('postFollow')}
                    </ThemedText>
                  </TouchableOpacity>
                ) : null}

                {/* Bio — clean left-aligned floating text */}
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
                name={resolvedName}
                uri={avatarUri}
                size={96}
                testID="ai-profile-avatar"
              />
            </View>

            {/* ── Creator-only: Edit AI Profile and Settings (before Chat) ── */}
            {isOwner && (
              <View style={styles.ownerRow}>
                <TouchableOpacity
                  onPress={() => {
                    hapticLightPress();
                    handleOpenEditProfile();
                  }}
                  activeOpacity={0.7}
                  style={styles.ownerPill}
                  testID="ai-profile-edit-button"
                  accessibilityRole="button"
                  accessibilityLabel={t('aiEditProfileAndSettings')}
                >
                  <Icon name="account-edit-outline" size={14} color={accent} />
                  <ThemedText size={12} weight="medium" style={{ color: accent }}>
                    {t('aiEditProfileAndSettings')}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Action row: primary Chat + Like / Save ── */}
            <View style={styles.actionsRow}>
              {/* Primary Chat button — full-width, purple gradient. When an ACTIVE
                  listing resolves for this profile (Wave 1 stub linkage), the
                  label shows the SOUL price pill + lock icon and the tap routes
                  to the listing detail to acquire (marketplace preview lock —
                  viewable free, chat locked until acquired; own library never
                  locked). Otherwise it is a normal Chat button. */}
              <TouchableOpacity
                onPress={() => {
                  hapticLightPress();
                  handleChat();
                }}
                activeOpacity={0.85}
                disabled={chatting}
                style={styles.chatButton}
                testID="ai-profile-chat-button"
                accessibilityRole="button"
                accessibilityLabel={t('aiChatButton')}
              >
                <LinearGradient
                  colors={PURPLE_GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.chatButtonGradient}
                >
                  <Icon
                    name={listing ? 'lock-clock' : 'chat-processing'}
                    size={18}
                    color="#fff"
                  />
                  <ThemedText
                    size={15}
                    weight="bold"
                    style={{ color: '#fff', letterSpacing: 0.3 }}
                  >
                    {listing
                      ? `${t('market:chatPriceLabel', {
                          price: Number.isInteger(listing.priceSouls)
                            ? String(listing.priceSouls)
                            : listing.priceSouls.toFixed(2),
                        })}`
                      : t('aiChatButton')}
                  </ThemedText>
                </LinearGradient>
              </TouchableOpacity>

              {/* Rounded Like button — purple gradient when liked */}
              <TouchableOpacity
                onPress={() => {
                  hapticLightPress();
                  handleToggleLike();
                }}
                activeOpacity={0.7}
                style={[
                  styles.roundButton,
                  profileLiked && styles.roundButtonActive,
                ]}
                testID="ai-profile-like-button"
                accessibilityRole="button"
                accessibilityLabel={t('aiLike')}
              >
                {profileLiked ? (
                  <LinearGradient
                    colors={PURPLE_GRADIENT}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.roundButtonGradient}
                  >
                    <Icon name="heart" size={22} color="#fff" />
                  </LinearGradient>
                ) : (
                  <Icon
                    name="heart-outline"
                    size={22}
                    color={theme.colors.text.secondary}
                  />
                )}
              </TouchableOpacity>

              {/* Rounded Save button */}
              <TouchableOpacity
                onPress={() => {
                  hapticLightPress();
                  handleToggleSave();
                }}
                activeOpacity={0.7}
                style={[
                  styles.roundButton,
                  profileSaved && styles.roundButtonActive,
                ]}
                testID="ai-profile-save-button"
                accessibilityRole="button"
                accessibilityLabel={t('aiSave')}
              >
                <Icon
                  name={profileSaved ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color={profileSaved ? accent : theme.colors.text.secondary}
                />
              </TouchableOpacity>
            </View>

            {/* ── Entity status chip row (Q8) — disable / mute, global per entity ── */}
            {aiEntityId && (
              <View style={styles.entityChipRow}>
                <TouchableOpacity
                  onPress={() => {
                    hapticLightPress();
                    handleToggleEntityDisable();
                  }}
                  activeOpacity={0.7}
                  style={[
                    styles.entityChip,
                    entityDisabled && { backgroundColor: hexToRgba(errorColor, 0.15), borderColor: errorColor },
                  ]}
                  testID="ai-profile-disable-button"
                  accessibilityRole="button"
                  accessibilityLabel={entityDisabled ? t('enableEntity', { name: profile?.name ?? '' }) : t('disableEntity', { name: profile?.name ?? '' })}
                >
                  <Icon
                    name={entityDisabled ? 'shield-account-outline' : 'shield-off-outline'}
                    size={14}
                    color={entityDisabled ? errorColor : theme.colors.text.secondary}
                  />
                  <ThemedText size={12} weight="medium">
                    {entityDisabled ? t('enableEntity', { name: profile?.name ?? '' }) : t('disableEntity', { name: profile?.name ?? '' })}
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    hapticLightPress();
                    handleToggleEntityMute();
                  }}
                  activeOpacity={0.7}
                  style={[
                    styles.entityChip,
                    entityMuted && { backgroundColor: hexToRgba(accent, 0.15), borderColor: accent },
                  ]}
                  testID="ai-profile-mute-button"
                  accessibilityRole="button"
                  accessibilityLabel={entityMuted ? t('unmuteEntity', { name: profile?.name ?? '' }) : t('muteEntity', { name: profile?.name ?? '' })}
                >
                  <Icon
                    name={entityMuted ? 'volume-high' : 'volume-off'}
                    size={14}
                    color={entityMuted ? accent : theme.colors.text.secondary}
                  />
                  <ThemedText size={12} weight="medium">
                    {entityMuted ? t('unmuteEntity', { name: profile?.name ?? '' }) : t('muteEntity', { name: profile?.name ?? '' })}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Stats row: Likes · Chats ── */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <ThemedText variant="primary" size={18} weight="bold" hierarchy="header">
                  {displayedLikes}
                </ThemedText>
                <ThemedText variant="muted" size={12} hierarchy="caption">
                  {t('aiLikes')}
                </ThemedText>
              </View>
              <View style={styles.statItem}>
                <ThemedText variant="primary" size={18} weight="bold" hierarchy="header">
                  {stats.chats}
                </ThemedText>
                <ThemedText variant="muted" size={12} hierarchy="caption">
                  {t('aiChats')}
                </ThemedText>
              </View>
            </View>

            {/* ── Tab bar — icon-only with active underline ── */}
            <ProfileTabs active={activeTab} onChange={setActiveTab} tabs={tabs} />

            {/* ── Content ── */}
            <View style={styles.gridContent}>
              {activeTab === 'images' &&
                (images.length === 0 ? (
                  <ThemedEmptyState
                    icon="image-multiple-outline"
                    title={t('aiImagesEmpty')}
                    subtitle={t('aiImagesEmptyHint')}
                    compact
                    style={styles.gridEmpty}
                  />
                ) : (
                  <View style={styles.postsWrap}>
                    {images.map(img => {
                      const post = imagePosts[img.id] ?? {
                        liked: false,
                        likes: 0,
                        commentCount: 0,
                      };
                      return (
                        <View key={img.id} style={styles.postCard}>
                          <Image
                            source={{ uri: createDataURL(img.image_data, img.mime_type) }}
                            style={styles.postImage}
                            resizeMode="cover"
                          />
                          {/* Date/time caption under the image */}
                          <View style={styles.postDateRow}>
                            <Icon
                              name="clock-outline"
                              size={12}
                              color={theme.colors.text.muted}
                            />
                            <ThemedText variant="muted" size={11}>
                              {formatPostDate(img.created_at)}
                            </ThemedText>
                          </View>
                          <View style={styles.postActions}>
                            <TouchableOpacity
                              onPress={() => {
                                hapticLightPress();
                                handleToggleImageLike(img);
                              }}
                              activeOpacity={0.7}
                              style={styles.postActionBtn}
                              testID="ai-image-like-button"
                              accessibilityRole="button"
                              accessibilityLabel={t('aiLike')}
                            >
                              {post.liked ? (
                                <LinearGradient
                                  colors={PURPLE_GRADIENT}
                                  start={{ x: 0, y: 0 }}
                                  end={{ x: 1, y: 1 }}
                                  style={styles.postLikeGradient}
                                >
                                  <Icon name="heart" size={20} color="#fff" />
                                </LinearGradient>
                              ) : (
                                <Icon
                                  name="heart-outline"
                                  size={20}
                                  color={theme.colors.text.secondary}
                                />
                              )}
                              <ThemedText
                                size={12}
                                variant={post.liked ? 'primary' : 'muted'}
                              >
                                {post.likes}
                              </ThemedText>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => {
                                hapticLightPress();
                                handleOpenComments(img);
                              }}
                              activeOpacity={0.7}
                              style={styles.postActionBtn}
                              testID="ai-image-comment-button"
                              accessibilityRole="button"
                              accessibilityLabel={t('aiImageComments')}
                            >
                              <Icon
                                name="comment-outline"
                                size={18}
                                color={theme.colors.text.secondary}
                              />
                              <ThemedText size={12} variant="muted">
                                {post.commentCount}
                              </ThemedText>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ))}

              {activeTab === 'copies' &&
                (copies.length === 0 ? (
                  <ThemedEmptyState
                    icon="content-copy"
                    title={t('aiCopiesEmpty')}
                    subtitle={t('aiCopiesEmptyHint')}
                    compact
                    style={styles.gridEmpty}
                  />
                ) : (
                  <View style={styles.copiesWrap}>
                    {copies.map(copy => (
                      <TouchableOpacity
                        key={copy.id}
                        onPress={() => {
                          hapticLightPress();
                          // Updating the param re-runs useFocusEffect (the
                          // loadProfile callback identity changes with profileId),
                          // which reloads this screen for the chosen fork.
                          navigation.setParams({ profileId: copy.id });
                        }}
                        activeOpacity={0.75}
                        style={styles.copyRow}
                        testID="ai-copy-row"
                        accessibilityRole="button"
                        accessibilityLabel={copy.name}
                      >
                        <ProfileAvatar
                          name={copy.name}
                          uri={copiesAvatars[copy.id] ?? null}
                          size={40}
                          showRing={false}
                        />
                        <ThemedText
                          size={14}
                          weight="medium"
                          numberOfLines={1}
                          style={styles.copyName}
                        >
                          {copy.name}
                        </ThemedText>
                        <Icon
                          name="chevron-right"
                          size={20}
                          color={theme.colors.text.muted}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* ── Image comment sheet ── */}
      <ImageCommentModal
        visible={commentVisible}
        imageId={commentImageId}
        characterName={resolvedName}
        onClose={handleCommentsClosed}
        // The character's owner can moderate (copy/delete) any comment.
        canModerateAll={isOwner}
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
  centered: {
    paddingTop: 120,
    alignItems: 'center',
  },
  empty: {
    paddingTop: 120,
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
  bioText: {
    marginTop: 8,
    lineHeight: 20,
    textAlign: 'left',
  },
  // ── Creator badge ──
  creatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    maxWidth: '100%',
  },
  followPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  followPillActive: {
    borderWidth: 1,
  },
  // ── Actions row ──
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    paddingHorizontal: 16,
    gap: 10,
  },
  chatButton: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8f3ba7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 10,
  },
  chatButtonGradient: {
    flex: 1,
    height: '100%',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  roundButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  roundButtonActive: {
    borderColor: 'rgba(255,255,255,0.28)',
  },
  roundButtonGradient: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Owner badge ──
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 16,
  },
  ownerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#7c3aed' + '55',
    backgroundColor: '#7c3aed' + '18',
  },
  // ── Stats ──
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
  // ── Grid ──
  gridContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  gridEmpty: {
    paddingTop: 40,
  },
  // ── Image posts ──
  postsWrap: {
    gap: 16,
  },
  postCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },
  postImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  postDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  postActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  postActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  postLikeGradient: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Forks ──
  copiesWrap: {
    gap: 8,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  copyName: {
    flex: 1,
  },
  // ── Entity status chips (Q8) ──
  entityChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 16,
  },
  entityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
});

export default AIProfileScreen;
