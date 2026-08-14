/**
 * ImageCommentModal — full-screen comment viewer for a character image post.
 *
 * Lists existing comments (author name + text), lets the current user add a
 * new comment, and lets the author of a comment delete it. Uses the client-only
 * `character_image_comments` repository (never synced to the engine).
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
  getImageComments,
  addImageComment,
  deleteImageComment,
  CharacterImageComment,
} from '../../database/repositories/characterSocial';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { useAuth } from '../../contexts/AuthContext';
import UserProfileStore from '../../services/profile/UserProfileStore';
import { createLogger } from '../../utils/logger';
import { formatPostDate } from '../../utils/dateFormat';

const log = createLogger('[ImageCommentModal]');

interface ImageCommentModalProps {
  visible: boolean;
  imageId: number | null;
  characterName: string;
  onClose: () => void;
  /** Fired after a comment is successfully posted (parent can notify the creator) */
  onCommentPosted?: () => void;
  /**
   * The current user owns the image post (or the character's creator) →
   * can copy/delete ANY comment on it, not just their own.
   */
  canModerateAll?: boolean;
}

export const ImageCommentModal: React.FC<ImageCommentModalProps> = ({
  visible,
  imageId,
  characterName,
  onClose,
  onCommentPosted,
  canModerateAll = false,
}) => {
  const { theme } = useAppTheme();
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const toast = useInModalToast();

  const [comments, setComments] = useState<CharacterImageComment[]>([]);
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
    if (imageId == null) return;
    setLoading(true);
    try {
      const list = await getImageComments(imageId);
      setComments(list);
    } catch (err) {
      log.warn('Failed to load comments:', err);
    } finally {
      setLoading(false);
    }
  }, [imageId]);

  useEffect(() => {
    if (visible && imageId != null) {
      setDraft('');
      setActionCommentId(null);
      load();
    }
  }, [visible, imageId, load]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover;

  const handlePost = async () => {
    const text = draft.trim();
    if (!text || posting || imageId == null) return;
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
      const created = await addImageComment({
        imageId,
        authorUserId,
        authorDisplayName: authorDisplayName || 'Guest',
        authorAvatarUrl,
        text,
      });
      setComments(prev => [...prev, created]);
      setDraft('');
      toast.show(t('commentSent'));
      onCommentPosted?.();
    } catch (err) {
      log.warn('Failed to post comment:', err);
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (comment: CharacterImageComment) => {
    setActionCommentId(null);
    try {
      await deleteImageComment(comment.id);
      setComments(prev => prev.filter(c => c.id !== comment.id));
      toast.show(t('commentDeleted'));
    } catch (err) {
      log.warn('Failed to delete comment:', err);
    }
  };

  const handleCopyComment = (comment: CharacterImageComment) => {
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
                {t('aiImageComments')}
              </ThemedText>
              <ThemedText variant="muted" size={13} numberOfLines={1}>
                {characterName}
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Close"
              accessibilityRole="button"
              style={[
                styles.closeBtn,
                { backgroundColor: hexToRgba(theme.colors.background.base, 0.75) },
              ]}
            >
              <Icon name="close" size={22} color={theme.colors.text.muted} />
            </TouchableOpacity>
          </View>

          {/* ── Comment list ── */}
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
                {t('aiCommentEmpty')}
              </ThemedText>
            ) : (
              comments.map(comment => {
                const isMine =
                  !!user &&
                  comment.authorUserId != null &&
                  comment.authorUserId === user.id;
                // The image owner (or the comment author) can moderate a comment.
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
                        size={34}
                        showRing={false}
                      />
                      <View style={styles.commentBody}>
                        <View style={styles.commentHeader}>
                          <ThemedText size={13} weight="medium" numberOfLines={1}>
                            {comment.authorDisplayName || 'Guest'}
                          </ThemedText>
                          <ThemedText variant="muted" size={11}>
                            {formatPostDate(comment.createdAt)}
                          </ThemedText>
                        </View>
                        <ThemedText
                          variant="secondary"
                          size={14}
                          style={styles.commentText}
                        >
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

          {/* ── Comment composer ── */}
          <View style={[styles.composer, { paddingBottom: safeBottom + 10 }]}>
            <TextInput
              style={[
                styles.input,
                {
                  color: theme.colors.text.primary,
                  backgroundColor: hexToRgba(
                    theme.colors.background.surface,
                    0.6,
                  ),
                  borderColor: 'rgba(255,255,255,0.12)',
                },
              ]}
              value={draft}
              onChangeText={setDraft}
              placeholder={t('aiCommentPlaceholder')}
              placeholderTextColor={theme.colors.text.muted}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              onPress={() => {
                hapticLightPress();
                handlePost();
              }}
              disabled={!draft.trim() || posting}
              activeOpacity={0.7}
              style={[
                styles.postBtn,
                { backgroundColor: accent },
                (!draft.trim() || posting) && styles.postBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('aiCommentPost')}
            >
              <Icon name="send" size={18} color="#fff" />
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
    gap: 14,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 32,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
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
  commentText: {
    lineHeight: 19,
  },
  // ── Inline long-press actions ──
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginLeft: 44,
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
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  input: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 110,
    fontSize: 14,
  },
  postBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  postBtnDisabled: {
    opacity: 0.4,
  },
});

export default ImageCommentModal;
