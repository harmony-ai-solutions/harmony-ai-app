/**
 * CreatePostModal — full-screen composer for a new user post.
 *
 * Lets the current user write text and/or attach an image (from the photo
 * library), then publishes via the client-only user_posts repository.
 *
 * Full-screen (not a bottom sheet) so the keyboard never hides the composer
 * content — the whole screen is a scrollable canvas with the input always
 * reachable above the keyboard.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  Keyboard,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchImageLibrary } from 'react-native-image-picker';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useBiometricLock } from '../../contexts/BiometricLockContext';
import { useInModalToast } from '../modals/InModalToast';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';
import * as SocialService from '../../services/social/SocialService';
import { createLogger } from '../../utils/logger';

const log = createLogger('[CreatePostModal]');

interface CreatePostModalProps {
  visible: boolean;
  onClose: () => void;
  onPublished?: () => void;
}

export const CreatePostModal: React.FC<CreatePostModalProps> = ({
  visible,
  onClose,
  onPublished,
}) => {
  const { theme } = useAppTheme();
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const { withExternalFlow } = useBiometricLock();
  const toast = useInModalToast();

  const [text, setText] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  // Height of the soft keyboard (0 when hidden) — used as bottom padding so the
  // composer stays visible without double-compensating via KeyboardAvoidingView.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Reset on open
  useEffect(() => {
    if (visible) {
      setText('');
      setImageBase64(null);
      setImageMime(null);
      setPublishing(false);
    }
  }, [visible]);

  // ── Keyboard inset — lift the composer above the soft keyboard (edge-to-edge
  // Android: adjustResize doesn't fire). Manual listeners avoid the double
  // compensation that KeyboardAvoidingView causes inside a full-screen modal.
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

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover ?? accent;

  const handlePickImage = async () => {
    try {
      const result = await withExternalFlow(() =>
        launchImageLibrary({
          mediaType: 'photo',
          includeBase64: true,
          quality: 0.8,
        }),
      );
      if (result.assets && result.assets[0]?.base64) {
        const asset = result.assets[0];
        setImageBase64(asset.base64 as string);
        setImageMime(asset.type ?? 'image/jpeg');
      }
    } catch (err) {
      log.error('Failed to pick post image:', err);
    }
  };

  const handleRemoveImage = () => {
    setImageBase64(null);
    setImageMime(null);
  };

  const handlePublish = async () => {
    if (!user) return;
    const body = text.trim();
    if (!body && !imageBase64) return;
    setPublishing(true);
    try {
      // The stub service authors the post as the signed-in user (LOCAL_USER_ID);
      // the display name shown on the card comes from the cloud profile. The
      // future backend derives the author from the auth token.
      await SocialService.createPost({
        text: body,
        imageData: imageBase64,
        imageMimeType: imageMime,
      });
      hapticLightPress();
      toast.show(t('postPublished'));
      onClose();
      onPublished?.();
    } catch (err) {
      log.error('Failed to publish post:', err);
    } finally {
      setPublishing(false);
    }
  };

  const canPublish = (text.trim().length > 0 || !!imageBase64) && !publishing;

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
          colors={[accent + 'CC', accentSecondary + '55', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.topStripe}
        />

        <>
          {/* ── Header ── */}
          <View style={[styles.header, { paddingTop: safeTop + 8 }]}>
            <View style={styles.headerText}>
              <ThemedText size={20} weight="bold" hierarchy="header">
                {t('newPost')}
              </ThemedText>
              <ThemedText variant="muted" size={13}>
                {t('newPostHint')}
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

          {/* ── Scrollable composer ── */}
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: safeBottom + 24 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Text input */}
            <TextInput
              style={[
                styles.input,
                {
                  color: theme.colors.text.primary,
                  backgroundColor: hexToRgba(theme.colors.background.base, 0.55),
                  borderColor: hexToRgba(accent, 0.25),
                },
              ]}
              placeholder={t('postPlaceholder')}
              placeholderTextColor={theme.colors.text.disabled}
              value={text}
              onChangeText={setText}
              multiline
              autoCorrect
              autoFocus
              maxLength={1000}
            />

            {/* Image preview / attach */}
            {imageBase64 ? (
              <View style={styles.imageWrap}>
                <Image
                  source={{ uri: `data:${imageMime};base64,${imageBase64}` }}
                  style={styles.preview}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  onPress={handleRemoveImage}
                  style={styles.removeImageBtn}
                  hitSlop={8}
                  accessibilityLabel={t('postImageRemove')}
                  accessibilityRole="button"
                >
                  <Icon name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={handlePickImage}
                style={[
                  styles.addImageBtn,
                  {
                    borderColor: hexToRgba(accent, 0.25),
                    backgroundColor: hexToRgba(accent, 0.08),
                  },
                ]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('postImage')}
              >
                <Icon name="image-plus" size={20} color={accent} />
                <ThemedText size={13} weight="medium" variant="accent">
                  {t('postImage')}
                </ThemedText>
              </TouchableOpacity>
            )}

            {/* Publish */}
            <ThemedButton
              label={t('postPublish')}
              onPress={handlePublish}
              icon="send"
              disabled={!canPublish}
              style={styles.publishBtn}
              testID="publish-post-button"
            />
          </ScrollView>

          {/* Keyboard spacer — keeps the publish button visible above the keyboard */}
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
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
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
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  input: {
    minHeight: 140,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  imageWrap: {
    marginBottom: 12,
  },
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  removeImageBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  publishBtn: {
    marginTop: 4,
  },
});

export default CreatePostModal;
