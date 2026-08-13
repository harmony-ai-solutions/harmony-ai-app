/**
 * ImageCommentModal — bottom-sheet comment viewer for a character image post.
 *
 * Lists existing comments (author name + text), lets the current user add a
 * new comment, and lets the author of a comment delete it. Uses the client-only
 * `character_image_comments` repository (never synced to the engine).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
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

const log = createLogger('[ImageCommentModal]');

interface ImageCommentModalProps {
  visible: boolean;
  imageId: number | null;
  characterName: string;
  onClose: () => void;
}

export const ImageCommentModal: React.FC<ImageCommentModalProps> = ({
  visible,
  imageId,
  characterName,
  onClose,
}) => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('profile');
  const { user } = useAuth();

  const [comments, setComments] = useState<CharacterImageComment[]>([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(false);

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
          authorDisplayName =
            local.displayName || authorDisplayName;
          authorAvatarUrl = local.avatar_data_url ?? authorAvatarUrl;
        } catch {
          // Local profile extras are optional — keep cloud values.
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
    } catch (err) {
      log.warn('Failed to post comment:', err);
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (comment: CharacterImageComment) => {
    try {
      await deleteImageComment(comment.id);
      setComments(prev => prev.filter(c => c.id !== comment.id));
    } catch (err) {
      log.warn('Failed to delete comment:', err);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.sheet, { paddingBottom: safeBottom + 16 }]}>
                {/* Gradient background */}
                <LinearGradient
                  colors={[
                    theme.colors.background.elevated,
                    theme.colors.background.surface,
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={[StyleSheet.absoluteFill, styles.sheetRadius]}
                />
                {/* Prismatic tint */}
                <LinearGradient
                  colors={[accent + '10', 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0.6 }}
                  style={[StyleSheet.absoluteFill, styles.sheetRadius]}
                  pointerEvents="none"
                />
                {/* Top accent stripe */}
                <LinearGradient
                  colors={[accent + 'CC', accentSecondary + '66', 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.topStripe}
                />

                {/* Header */}
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    <ThemedText size={18} weight="bold">
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
                  >
                    <Icon name="close" size={22} color={theme.colors.text.muted} />
                  </TouchableOpacity>
                </View>

                {/* Comment list */}
                <ScrollView
                  style={styles.list}
                  contentContainerStyle={styles.listContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {!loading && comments.length === 0 ? (
                    <ThemedText variant="muted" size={13} style={styles.emptyText}>
                      {t('aiCommentEmpty')}
                    </ThemedText>
                  ) : (
                    comments.map(comment => {
                      const isMine =
                        !!user &&
                        comment.authorUserId != null &&
                        comment.authorUserId === user.id;
                      return (
                        <View key={comment.id} style={styles.commentRow}>
                          <ProfileAvatar
                            name={comment.authorDisplayName || '?'}
                            uri={comment.authorAvatarUrl}
                            size={34}
                            showRing={false}
                          />
                          <View style={styles.commentBody}>
                            <ThemedText size={13} weight="medium" numberOfLines={1}>
                              {comment.authorDisplayName || 'Guest'}
                            </ThemedText>
                            <ThemedText variant="secondary" size={14} style={styles.commentText}>
                              {comment.text}
                            </ThemedText>
                          </View>
                          {isMine && (
                            <TouchableOpacity
                              onPress={() => {
                                hapticLightPress();
                                handleDelete(comment);
                              }}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              accessibilityRole="button"
                              accessibilityLabel={t('aiCommentDelete')}
                              style={styles.deleteBtn}
                            >
                              <Icon
                                name="delete-outline"
                                size={18}
                                color={theme.colors.text.muted}
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })
                  )}
                </ScrollView>

                {/* Comment composer */}
                <View style={styles.composer}>
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
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '75%',
    minHeight: 320,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  sheetRadius: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  topStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  headerText: {
    flex: 1,
    gap: 2,
    marginRight: 12,
  },
  list: {
    flexShrink: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 12,
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
  commentText: {
    lineHeight: 19,
  },
  deleteBtn: {
    padding: 4,
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
