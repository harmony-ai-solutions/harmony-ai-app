/**
 * PostCommentModal — full-screen comment viewer for a user post.
 *
 * Lists existing comments (author name + text), lets the current user add a
 * new comment, and lets the author of a comment delete it. Uses the client-only
 * `user_post_comments` repository (never synced to the engine).
 *
 * Full-screen (not a bottom sheet) so the keyboard never hides the comment
 * composer — the whole screen is the feed with the input always reachable
 * above the keyboard.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Keyboard,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useInModalToast } from '../modals/InModalToast';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';
import {
  getPostComments,
  addPostComment,
  deletePostComment,
  UserPostComment,
} from '../../database/repositories/userSocial';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { useAuth } from '../../contexts/AuthContext';
import UserProfileStore from '../../services/profile/UserProfileStore';
import { createLogger } from '../../utils/logger';
import { addNotification, getUserPost } from '../../database/repositories/userSocial';
import { formatPostDate } from '../../utils/dateFormat';

const log = createLogger('[PostCommentModal]');

interface PostCommentModalProps {
  visible: boolean;
  postId: string | null;
  onClose: () => void;
  /**
   * The current user owns the post → can copy/delete ANY comment on it,
   * not just their own. Posts are client-local, so this is true for every
   * post rendered in the app today.
   */
  canModerateAll?: boolean;
}

export const PostCommentModal: React.FC<PostCommentModalProps> = ({
  visible,
  postId,
  onClose,
  canModerateAll = true,
}) => {
  const { theme } = useAppTheme();
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const toast = useInModalToast();

  const [comments, setComments] = useState<UserPostComment[]>([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(false);
  // Long-pressed comment (own comment only) — shows an inline action row
  const [actionCommentId, setActionCommentId] = useState<string | null>(null);

  // Dismiss the inline action menu (tap anywhere / scroll).
  const closeActions = useCallback(() => setActionCommentId(null), []);
  // Height of the soft keyboard (0 when hidden) — keeps the composer visible
  // without double-compensating via KeyboardAvoidingView.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // ── Keyboard inset (edge-to-edge Android: adjustResize doesn't fire) ──
  useEffect(() => {
    const onShow = (e: any) => {
      setKeyboardHeight(e?.endCoordinates?.height ?? 300);
    };
    const onHide = () => setKeyboardHeight(0);
    const subs = [
      Keyboard.addListener('keyboardWillShow', onShow),
      Keyboard.addListener('keyboardDidShow', onShow),
      Keyboard.addListener('keyboardWillHide', onHide),
      Keyboard.addListener('keyboardDidHide', onHide),
    ];
    return () => subs.forEach(s => s.remove());
  }, []);

  const load = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    try {
      const list = await getPostComments(postId);
      setComments(list);
    } catch (err) {
      log.warn('Failed to load comments:', err);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    if (visible && postId) {
      setDraft('');
      setActionCommentId(null);
      load();
    }
  }, [visible, postId, load]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  const handlePost = async () => {
    const text = draft.trim();
    if (!text || posting || !postId) return;
    setPosting(true);
    try {
      let authorUserId: string | null = null;
      let authorDisplayName = '';
      let authorAvatarUrl: string | null = null;
      if (user) {
        authorUserId = user.id;
        authorDisplayName =
          user.display_name || user.email?.split('@')[0] || '';
        authorAvatarUrl = user.avatar_url ?? null;
        try {
          const local = await UserProfileStore.getLocalProfile(user.id);
          authorDisplayName = local.displayName || authorDisplayName;
          authorAvatarUrl = local.avatar_data_url ?? authorAvatarUrl;
        } catch {
          // keep cloud values
        }
      }
      const created = await addPostComment({
        postId,
        authorUserId,
        authorDisplayName: authorDisplayName || 'Guest',
        authorAvatarUrl,
        text,
      });
      setComments(prev => [...prev, created]);
      setDraft('');
      toast.show(t('commentSent'));

      // Notify the post author when someone comments on their post.
      try {
        const post = await getUserPost(postId);
        if (
          post &&
          post.authorUserId &&
          user?.id &&
          post.authorUserId !== user.id
        ) {
          await addNotification({
            recipientUserId: post.authorUserId,
            actorUserId: user.id,
            actorDisplayName: authorDisplayName || 'Someone',
            actorAvatarUrl: authorAvatarUrl,
            type: 'post_comment',
            targetType: 'user_post',
            targetId: postId,
            targetLabel: post.text.slice(0, 40),
          });
        }
      } catch (notifErr) {
        log.warn('Failed to create post-comment notification:', notifErr);
      }
    } catch (err) {
      log.warn('Failed to post comment:', err);
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (comment: UserPostComment) => {
    setActionCommentId(null);
    try {
      await deletePostComment(comment.id);
      setComments(prev => prev.filter(c => c.id !== comment.id));
      toast.show(t('commentDeleted'));
    } catch (err) {
      log.warn('Failed to delete comment:', err);
    }
  };

  const handleCopyComment = (comment: UserPostComment) => {
    setActionCommentId(null);
    try {
      Clipboard.setString(comment.text);
      toast.show(t('commentCopied'));
    } catch (err) {
      log.warn('Failed to copy comment:', err);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <LinearGradient
          colors={[
            theme.colors.background.elevated,
            theme.colors.background.base,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[accent + '10', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.6 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[accent + 'CC', accentSecondary + '66', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.topStripe}
        />

        <>
          {/* ── Header ── */}
          <View style={[styles.header, { paddingTop: safeTop + 8 }]}>
            <View style={styles.headerText}>
              <ThemedText size={20} weight="bold" hierarchy="header">
                {t('postCommentsTitle')}
              </ThemedText>
              <ThemedText variant="muted" size={13}>
                {comments.length} · {t('aiCommentPlaceholder')}
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('common:close')}
              accessibilityRole="button"
              style={[
                styles.closeBtn,
                { backgroundColor: hexToRgba(theme.colors.background.base, 0.75) },
              ]}
            >
              <Icon name="close" size={22} color={theme.colors.text.muted} />
            </TouchableOpacity>
          </View>

          {/* ── Comments list — any touch closes the action menu ── */}
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: safeBottom + 16 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onTouchStart={closeActions}
          >
            {loading ? (
              <ThemedText variant="muted" size={13} style={styles.emptyText}>
                Loading…
              </ThemedText>
            ) : comments.length === 0 ? (
              <ThemedText variant="muted" size={13} style={styles.emptyText}>
                {t('postCommentEmpty')}
              </ThemedText>
            ) : (
              comments.map(comment => {
                const isMine =
                  !!user?.id && comment.authorUserId === user.id;
                // The post owner (or the comment author) can moderate a comment.
                const canModerate = isMine || canModerateAll;
                const showActions = canModerate && actionCommentId === comment.id;
                return (
                  <View key={comment.id}>
                    <TouchableOpacity
                      style={styles.commentRow}
                      activeOpacity={0.7}
                      onLongPress={
                        canModerate
                          ? () => {
                              hapticLightPress();
                              setActionCommentId(
                                actionCommentId === comment.id
                                  ? null
                                  : comment.id,
                              );
                            }
                          : undefined
                      }
                      delayLongPress={350}
                      accessibilityRole="button"
                    >
                      <ProfileAvatar
                        name={comment.authorDisplayName || '?'}
                        uri={comment.authorAvatarUrl}
                        size={30}
                        showRing={false}
                      />
                      <View style={styles.commentBody}>
                        <View style={styles.commentHeader}>
                          <ThemedText size={13} weight="bold" numberOfLines={1}>
                            {comment.authorDisplayName || 'Guest'}
                          </ThemedText>
                          <ThemedText variant="muted" size={11}>
                            {formatPostDate(comment.createdAt)}
                          </ThemedText>
                        </View>
                        <ThemedText variant="secondary" size={13}>
                          {comment.text}
                        </ThemedText>
                      </View>
                    </TouchableOpacity>

                    {/* Inline action row — small, under the comment */}
                    {showActions && (
                      <View
                        style={[
                          styles.inlineActions,
                          {
                            backgroundColor: hexToRgba(
                              theme.colors.background.surface,
                              0.6,
                            ),
                            borderColor: hexToRgba(accent, 0.18),
                          },
                        ]}
                        // Don't let a tap on the action buttons bubble up to the
                        // ScrollView's dismiss handler (which would unmount this
                        // row before onPress fires).
                        onTouchStart={e => e.stopPropagation()}
                      >
                        <TouchableOpacity
                          style={styles.inlineActionBtn}
                          onPress={() => {
                            hapticLightPress();
                            handleCopyComment(comment);
                          }}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                        >
                          <Icon
                            name="content-copy"
                            size={14}
                            color={accent}
                          />
                          <ThemedText size={12} weight="medium" variant="accent">
                            {t('commentCopy')}
                          </ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.inlineActionBtn}
                          onPress={() => {
                            hapticLightPress();
                            handleDelete(comment);
                          }}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                        >
                          <Icon
                            name="delete-outline"
                            size={14}
                            color={theme.colors.status.error}
                          />
                          <ThemedText
                            size={12}
                            weight="medium"
                            style={{ color: theme.colors.status.error }}
                          >
                            {t('postCommentDelete')}
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* ── Composer ── */}
          <View style={[styles.composer, { paddingBottom: safeBottom + 10 }]}>
            <TextInput
              style={[
                styles.input,
                {
                  color: theme.colors.text.primary,
                  backgroundColor: hexToRgba(theme.colors.background.base, 0.55),
                  borderColor: hexToRgba(accent, 0.25),
                },
              ]}
              placeholder={t('postCommentPlaceholder')}
              placeholderTextColor={theme.colors.text.disabled}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              onPress={handlePost}
              disabled={!draft.trim() || posting}
              style={[
                styles.sendBtn,
                {
                  backgroundColor:
                    draft.trim() && !posting
                      ? accent
                      : theme.colors.text.disabled,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('postCommentPost')}
              testID="post-comment-send"
            >
              <Icon name="send" size={16} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Keyboard spacer — keeps the composer visible above the keyboard */}
          <View style={{ height: keyboardHeight }} />

          {/* In-modal toast — visible above the modal window */}
          {toast.view}
        </>

      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  flex: {
    flex: 1,
  },
  topStripe: {
    height: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 32,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  commentBody: {
    flex: 1,
    gap: 2,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  input: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    maxHeight: 90,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Inline long-press actions ──
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginLeft: 40,
    marginBottom: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  inlineActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
});

export default PostCommentModal;
