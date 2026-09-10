/**
 * PostCard — a user post card rendered in My Profile (Posts tab) and Discover.
 *
 * Shows the author avatar + name, the post text and/or image, a timestamp, and
 * Like / Comment action buttons. The author avatar is tappable → opens the
 * author's profile (My Profile pushed on top). Like/comment state is driven by
 * the client-only userSocial repository.
 */

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { hapticLightPress } from '../../utils/haptics';
import { formatPostDate, formatPostDateTime } from '../../utils/dateFormat';
import type { StubPost } from '../../services/social/SocialService';
import { createDataURL } from '../../database/base64';
import { hexToRgba } from '../../utils/colorUtils';

interface PostCardProps {
  post: StubPost;
  liked: boolean;
  likes: number;
  commentCount: number;
  onToggleLike: () => void;
  onOpenComments: () => void;
  onOpenAuthor?: () => void;
  showAuthor?: boolean;
  /** When set, a ⋮ menu with a Delete action is shown (post owner only). */
  onDeletePost?: () => void;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  liked,
  likes,
  commentCount,
  onToggleLike,
  onOpenComments,
  onOpenAuthor,
  showAuthor = true,
  onDeletePost,
}) => {
  const { theme } = useAppTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  // The stub post carries raw image bytes + mime — derive the data URL for the
  // <Image> (the future backend returns a ready-to-render URL).
  const imageDataUrl =
    post.imageData && post.imageMimeType
      ? createDataURL(post.imageData, post.imageMimeType)
      : null;

  return (
    <View style={styles.card}>
      {/* Author row */}
      {showAuthor ? (
        <TouchableOpacity
          style={styles.authorRow}
          onPress={onOpenAuthor}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <ProfileAvatar
            name={post.authorDisplayName || '?'}
            uri={post.authorAvatarUrl}
            size={38}
            showRing={false}
          />
          <View style={styles.authorInfo}>
            <ThemedText size={14} weight="bold" numberOfLines={1}>
              {post.authorDisplayName || 'User'}
            </ThemedText>
            <ThemedText variant="muted" size={11}>
              {formatPostDate(post.createdAt)}
            </ThemedText>
          </View>
        </TouchableOpacity>
      ) : (
        /* On the user's own profile the author row is hidden, but the
           date + time still needs to be visible. */
        <View style={styles.timestampRow}>
          <ThemedText variant="muted" size={11}>
            {formatPostDateTime(post.createdAt)}
          </ThemedText>
        </View>
      )}

      {/* ⋮ Menu — shown when the post owner can delete it */}
      {onDeletePost && (
        <View style={styles.menuWrap}>
          <TouchableOpacity
            onPress={() => {
              hapticLightPress();
              setMenuOpen(prev => !prev);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.menuBtn}
            accessibilityRole="button"
            accessibilityLabel="Post options"
          >
            <Icon name="dots-vertical" size={18} color={theme.colors.text.muted} />
          </TouchableOpacity>

          {menuOpen && (
            <View
              style={[
                styles.inlineMenu,
                {
                  backgroundColor: hexToRgba(theme.colors.background.surface, 0.95),
                  borderColor: hexToRgba(accent, 0.2),
                },
              ]}
            >
              <TouchableOpacity
                style={styles.inlineMenuItem}
                onPress={() => {
                  hapticLightPress();
                  setMenuOpen(false);
                  onDeletePost();
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Delete post"
              >
                <Icon
                  name="delete-outline"
                  size={16}
                  color={theme.colors.status.error}
                />
                <ThemedText
                  size={13}
                  weight="medium"
                  style={{ color: theme.colors.status.error }}
                >
                  Delete
                </ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Body */}
      {post.text ? (
        <ThemedText variant="secondary" size={14} style={styles.bodyText}>
          {post.text}
        </ThemedText>
      ) : null}
      {imageDataUrl ? (
        <Image
          source={{ uri: imageDataUrl }}
          style={styles.postImage}
          resizeMode="cover"
        />
      ) : null}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={() => {
            hapticLightPress();
            onToggleLike();
          }}
          activeOpacity={0.7}
          style={styles.actionBtn}
          testID="post-like-button"
          accessibilityRole="button"
          accessibilityLabel="Like post"
        >
          <Icon
            name={liked ? 'heart' : 'heart-outline'}
            size={19}
            color={liked ? accent : theme.colors.text.secondary}
          />
          <ThemedText size={12} variant={liked ? 'primary' : 'muted'}>
            {likes}
          </ThemedText>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            hapticLightPress();
            onOpenComments();
          }}
          activeOpacity={0.7}
          style={styles.actionBtn}
          testID="post-comment-button"
          accessibilityRole="button"
          accessibilityLabel="Comments"
        >
          <Icon name="comment-outline" size={18} color={theme.colors.text.secondary} />
          <ThemedText size={12} variant="muted">
            {commentCount}
          </ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
    padding: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  authorInfo: {
    flex: 1,
    gap: 1,
  },
  timestampRow: {
    marginBottom: 8,
  },
  bodyText: {
    marginBottom: 8,
  },
  postImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  // ── ⋮ menu (post owner) ──
  menuWrap: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 10,
  },
  menuBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineMenu: {
    position: 'absolute',
    top: 32,
    right: 0,
    minWidth: 120,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    paddingVertical: 4,
  },
  inlineMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
});

export default PostCard;
