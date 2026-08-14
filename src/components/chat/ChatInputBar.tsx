import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Keyboard,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { launchImageLibrary } from 'react-native-image-picker';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useBiometricLock } from '../../contexts/BiometricLockContext';
import { useToast } from '../../contexts/AppToastContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import EmojiPickerInline from '../emoji/EmojiPickerInline';
import { EmojiEntry } from '../../types/emoji';
import AudioRecorder from '../../services/AudioRecorder';
import { hapticLightPress, hapticPulse } from '../../utils/haptics';
import { openAppSettings } from '../../utils/permissions';
import { createLogger } from '../../utils/logger';
import { hexToRgba } from '../../utils/colorUtils';

const log = createLogger('[ChatInputBar]');

const MAX_IMAGE_SELECTIONS = 5;
const MAX_RECORDING_SECONDS = 120;
/** Extra breathing room below the bar so it floats above the gesture/nav bar. */
const BOTTOM_LIFT = 14;

/** A single picked image, kept in memory as base64 until sent. */
export interface PickedImage {
  base64: string;
  mimeType: string;
}

interface ChatInputBarProps {
  /** Called when the user presses send with non-empty text. */
  onSendText: (text: string) => void;
  /** Called when a voice recording finishes and should be delivered. */
  onSendAudio: (audioData: string, mimeType: string, duration: number) => void;
  /** Called when the user confirms the picked images. */
  onSendImages: (images: PickedImage[]) => void;
  /** When true, text sending is disabled (session offline) but photo/emoji/recording stay available. */
  disabled?: boolean;
  /** Own entity ID — used for the emoji picker action badges. */
  entityId?: string | null;
}

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  onSendText,
  onSendAudio,
  onSendImages,
  disabled = false,
  entityId,
}) => {
  const { t } = useTranslation('chatDetail');
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { showToast } = useToast();
  const { showAlert } = useAppAlert();
  const { withExternalFlow } = useBiometricLock();

  const inputRef = useRef<TextInput>(null);
  const selectionRef = useRef<number>(0);

  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedImages, setSelectedImages] = useState<PickedImage[]>([]);
  const [isPickingImages, setIsPickingImages] = useState(false);
  const [isSendingImages, setIsSendingImages] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  // ── Recording state ──────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isStoppingRecording, setIsStoppingRecording] = useState(false);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingAbortedRef = useRef(false);

  const pulseAnim = useRef(new Animated.Value(0)).current;
  const waveformAnim = useRef(new Animated.Value(0)).current;

  // Pulse + waveform animation while recording. Drives BOTH the pulsing accent
  // dot AND the animated "live" audio bars so the panel feels alive.
  useEffect(() => {
    if (isRecording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(waveformAnim, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(pulseAnim, {
              toValue: 0,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(waveformAnim, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulseAnim.setValue(0);
    waveformAnim.setValue(0);
  }, [isRecording, pulseAnim, waveformAnim]);

  // ── Keyboard inset — lift the bar above the soft keyboard on Android edge-to-edge
  // (adjustResize doesn't fire on modern RN). A simple bottom translate keeps the bar
  // glued just above the keyboard without double-counting the inset.
  useEffect(() => {
    const onShow = (e: any) => {
      const height =
        e?.endCoordinates?.height ??
        (Platform.OS === 'android' ? 300 : 336);
      setKeyboardOffset(height);
    };
    const onHide = () => {
      setKeyboardOffset(0);
    };

    const subs = [
      Keyboard.addListener('keyboardWillShow', onShow),
      Keyboard.addListener('keyboardDidShow', onShow),
      Keyboard.addListener('keyboardWillHide', onHide),
      Keyboard.addListener('keyboardDidHide', onHide),
    ];
    return () => {
      subs.forEach(s => s.remove());
    };
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  // Safety: stop + discard a dangling recording if the component unmounts.
  useEffect(() => {
    return () => {
      clearRecordingTimer();
    };
  }, [clearRecordingTimer]);

  // Track cursor position so emojis insert at the caret.
  const handleSelectionChange = useCallback(
    (e: any) => {
      selectionRef.current = e.nativeEvent.selection.start ?? inputText.length;
    },
    [inputText.length],
  );

  // ── Text send ─────────────────────────────────────────────────────────────
  const handleSendText = useCallback(() => {
    const text = inputText.trim();
    if (!text || disabled || isRecording) return;
    hapticLightPress();
    onSendText(text);
    setInputText('');
    if (showEmojiPicker) {
      setShowEmojiPicker(false);
    }
  }, [inputText, disabled, isRecording, onSendText, showEmojiPicker]);

  // ── Emoji ────────────────────────────────────────────────────────────────
  const toggleEmojiPicker = useCallback(() => {
    hapticLightPress();
    setShowEmojiPicker(prev => {
      const next = !prev;
      if (next) {
        Keyboard.dismiss();
      } else {
        inputRef.current?.focus();
      }
      return next;
    });
  }, []);

  const handleEmojiSelected = useCallback(
    (emoji: EmojiEntry) => {
      const caret = selectionRef.current;
      const next = inputText.slice(0, caret) + emoji.native + inputText.slice(caret);
      setInputText(next);
      requestAnimationFrame(() => {
        const pos = caret + emoji.native.length;
        inputRef.current?.setNativeProps({
          selection: { start: pos, end: pos },
        });
      });
      selectionRef.current = caret + emoji.native.length;
    },
    [inputText],
  );

  // ── Photo picking ────────────────────────────────────────────────────────
  const handlePickImages = useCallback(async () => {
    // NOTE: intentionally NOT gated by `disabled` — the parent screen handles
    // session-active checks on send (with a toast). This keeps the picker
    // responsive even when the sync session isn't ready yet.
    if (isPickingImages) return;
    hapticLightPress();
    try {
      setIsPickingImages(true);
      const result = await withExternalFlow(() =>
        launchImageLibrary({
          mediaType: 'photo',
          includeBase64: true,
          quality: 0.7,
          maxWidth: 1600,
          maxHeight: 1600,
          selectionLimit: Math.max(
            1,
            MAX_IMAGE_SELECTIONS - selectedImages.length,
          ),
        }),
      );
      if (result.didCancel || !result.assets) return;

      // Some devices (esp. iOS PHPicker / iCloud) don't populate `base64`.
      // Fall back to reading the picked file directly via react-native-fs so
      // the "+"/photo button always yields a usable image.
      const RNFS = require('react-native-fs');
      const picked: PickedImage[] = [];
      for (const asset of result.assets) {
        let base64 = asset.base64;
        if (!base64 && asset.uri) {
          try {
            base64 = await RNFS.readFile(asset.uri, 'base64');
          } catch (readErr) {
            log.warn('Failed to read picked image as base64:', readErr);
          }
        }
        if (!base64) continue;
        picked.push({
          base64,
          mimeType: asset.type ?? 'image/jpeg',
        });
      }

      if (picked.length === 0) {
        showToast(t('imagePickFailed'));
        return;
      }

      setSelectedImages(prev =>
        [...prev, ...picked].slice(0, MAX_IMAGE_SELECTIONS),
      );
    } catch (err) {
      log.error('Failed to pick images:', err);
      showToast(t('imagePickFailed'));
    } finally {
      setIsPickingImages(false);
    }
  }, [
    isPickingImages,
    selectedImages.length,
    withExternalFlow,
    showToast,
    t,
  ]);

  const handleRemoveImage = useCallback((index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSendImages = useCallback(async () => {
    if (selectedImages.length === 0 || isRecording || isSendingImages) return;
    hapticLightPress();
    setIsSendingImages(true);
    try {
      await onSendImages(selectedImages);
      // Only clear the previews once the parent has accepted (persisted) them.
      setSelectedImages([]);
      if (showEmojiPicker) {
        setShowEmojiPicker(false);
      }
    } finally {
      setIsSendingImages(false);
    }
  }, [selectedImages, isRecording, isSendingImages, onSendImages, showEmojiPicker]);

  // ── Voice recording (tap to record, tap to stop & send) ──────────────────
  const finishRecording = useCallback(async () => {
    if (!isRecording) return;
    setIsStoppingRecording(true);
    clearRecordingTimer();
    try {
      const result = await AudioRecorder.stopRecording();
      if (!recordingAbortedRef.current && result && result.data) {
        onSendAudio(result.data, result.mimeType, result.duration);
      }
    } catch (err: any) {
      log.error('Failed to stop recording:', err);
      showToast(t('recordingStopFailed'));
    } finally {
      setIsRecording(false);
      setIsStoppingRecording(false);
      setRecordingSeconds(0);
    }
  }, [
    isRecording,
    clearRecordingTimer,
    onSendAudio,
    showToast,
    t,
  ]);

  const startRecording = useCallback(async () => {
    if (disabled || isRecording) return;
    Keyboard.dismiss();
    setShowEmojiPicker(false);

    recordingAbortedRef.current = false;
    try {
      await AudioRecorder.startRecording();
      hapticPulse(24);
      setRecordingSeconds(0);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(prev => {
          const next = prev + 1;
          if (next >= MAX_RECORDING_SECONDS) {
            // Auto-stop at the ceiling.
            if (!recordingAbortedRef.current) {
              recordingAbortedRef.current = true;
              void finishRecording();
            }
          }
          return Math.min(next, MAX_RECORDING_SECONDS);
        });
      }, 1000);
    } catch (err: any) {
      log.error('Failed to start recording:', err);
      showAlert(
        t('permissionRequired'),
        t('permissionMessage'),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('openSettings'),
            onPress: () => {
              void openAppSettings();
            },
          },
        ],
        { icon: 'microphone-off' },
      );
    }
  }, [disabled, isRecording, finishRecording, showAlert, t]);

  const cancelRecording = useCallback(() => {
    if (!isRecording) return;
    recordingAbortedRef.current = true;
    clearRecordingTimer();
    AudioRecorder.stopRecording().catch(() => {
      // Best effort — the native recorder is reset either way.
    });
    setIsRecording(false);
    setRecordingSeconds(0);
    hapticLightPress();
  }, [isRecording, clearRecordingTimer]);

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      void finishRecording();
    } else {
      void startRecording();
    }
  }, [isRecording, finishRecording, startRecording]);

  if (!theme) return null;

  const hasText = inputText.trim().length > 0;
  const showSendButton = hasText && !isRecording;
  const accent = theme.colors.accent.primary;
  const accentSecondary =
    theme.colors.accent.secondary ?? theme.colors.accent.primaryHover ?? accent;

  // ── Recording panel (replaces the input row while recording) ─────────────
  const renderRecordingPanel = () => {
    const dotScale = pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.5],
    });
    const dotOpacity = pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.9, 0.3],
    });

    // Fake "live" waveform: 16 bars whose heights are derived from the pulse.
    const bars = Array.from({ length: 16 }, (_, i) => {
      const height = waveformAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [8, 16 + ((i * 13) % 14)],
      });
      return (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            {
              height,
              backgroundColor: accent,
              opacity: 0.6 + ((i % 3) * 0.13),
            },
          ]}
        />
      );
    });

    return (
      <View style={styles.recordingPanel}>
        <LinearGradient
          colors={[accent + '22', accentSecondary + '14']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.recordingGlow}
          pointerEvents="none"
        />
        <Animated.View
          style={[
            styles.recordingDot,
            {
              backgroundColor: accent,
              transform: [{ scale: dotScale }],
              opacity: dotOpacity,
            },
          ]}
        />
        <ThemedText
          size={13}
          weight="medium"
          style={[styles.recordingTimerText, { color: accent }]}
        >
          {t('recording', { duration: formatDuration(recordingSeconds) })}
        </ThemedText>
        <View style={styles.waveRow}>{bars}</View>

        <View style={styles.recordingActions}>
          <TouchableOpacity
            onPress={cancelRecording}
            style={styles.recordingCancelBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close" size={22} color={theme!.colors.text.secondary} />
          </TouchableOpacity>
          <LinearGradient
            colors={[accent, accentSecondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.recordingStopBtn}
          >
            <TouchableOpacity
              onPress={() => void finishRecording()}
              disabled={isStoppingRecording}
              style={styles.recordingStopBtnInner}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isStoppingRecording ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="send" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </LinearGradient>
        </View>
      </View>
    );
  };

  return (
    <ThemedView
      variant="elevated"
      style={[
        styles.container,
        { paddingBottom: Math.max(safeBottom, BOTTOM_LIFT) + 4 },
        { transform: [{ translateY: -keyboardOffset }] },
      ]}
    >
      {/* Top accent hairline — glassmorphic gradient border */}
      <LinearGradient
        colors={[accent + '00', accent + '88', accentSecondary + '66', accent + '00']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.topAccent}
        pointerEvents="none"
      />

      {/* ── Selected image previews ── */}
      {selectedImages.length > 0 && (
        <View style={styles.imagePreviewRow}>
          {selectedImages.map((img, i) => (
            <View key={`${img.base64.slice(0, 24)}-${i}`} style={styles.imagePreviewWrap}>
              <Image
                source={{ uri: `data:${img.mimeType};base64,${img.base64}` }}
                style={styles.imagePreview}
                resizeMode="cover"
              />
              <TouchableOpacity
                onPress={() => handleRemoveImage(i)}
                style={styles.imageRemoveBtn}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Icon name="close" size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity
            onPress={handlePickImages}
            disabled={
              selectedImages.length >= MAX_IMAGE_SELECTIONS ||
              isSendingImages
            }
            style={styles.imageAddBtn}
          >
            {isPickingImages ? (
              <ActivityIndicator size="small" color={accent} />
            ) : (
              <Icon name="plus" size={20} color={accent} />
            )}
          </TouchableOpacity>
          <LinearGradient
            colors={[accent, accentSecondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.imageSendBtn,
              isSendingImages && styles.imageSendBtnDisabled,
            ]}
          >
            <TouchableOpacity
              onPress={() => void handleSendImages()}
              disabled={isSendingImages}
              style={styles.imageSendBtnInner}
            >
              {isSendingImages ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Icon name="send" size={15} color="#fff" />
                  <ThemedText size={12} weight="bold" style={styles.imageSendText}>
                    {selectedImages.length}
                  </ThemedText>
                </>
              )}
            </TouchableOpacity>
          </LinearGradient>
        </View>
      )}

      {/* ── Main input row / recording panel ── */}
      {isRecording ? (
        renderRecordingPanel()
      ) : (
        <View style={styles.inputRow}>
          {/* Emoji toggle */}
          <TouchableOpacity
            onPress={toggleEmojiPicker}
            style={[
              styles.iconBtn,
              {
                backgroundColor: showEmojiPicker
                  ? hexToRgba(accent, 0.22)
                  : hexToRgba(theme!.colors.background.surface, 0.85),
              },
            ]}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel="Emoji"
            testID="chat-input-emoji-btn"
          >
            <Icon
              name={showEmojiPicker ? 'keyboard-outline' : 'emoticon-happy-outline'}
              size={22}
              color={showEmojiPicker ? accent : theme!.colors.text.secondary}
            />
          </TouchableOpacity>

          {/* Photo picker */}
          <TouchableOpacity
            onPress={handlePickImages}
            style={[
              styles.iconBtn,
              {
                backgroundColor: hexToRgba(theme!.colors.background.surface, 0.85),
              },
            ]}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel="Attach photos"
            testID="chat-input-photo-btn"
          >
            {isPickingImages ? (
              <ActivityIndicator size="small" color={theme!.colors.text.secondary} />
            ) : (
              <Icon
                name="image-multiple-outline"
                size={22}
                color={theme!.colors.text.secondary}
              />
            )}
          </TouchableOpacity>

          {/* Text field */}
          <View
            style={[
              styles.inputShell,
              {
                backgroundColor: hexToRgba(theme!.colors.background.surface, 0.85),
                borderColor: theme!.colors.border.default,
              },
            ]}
          >
            <TextInput
              ref={inputRef}
              value={inputText}
              onChangeText={setInputText}
              onSelectionChange={handleSelectionChange}
              onFocus={() => {
                if (showEmojiPicker) setShowEmojiPicker(false);
              }}
              onEndEditing={() => {
                if (showEmojiPicker) setShowEmojiPicker(false);
              }}
              placeholder={t('typeMessage')}
              placeholderTextColor={theme!.colors.text.muted}
              multiline
              maxLength={4000}
              style={[
                styles.input,
                { color: theme!.colors.text.primary },
              ]}
              editable={!disabled}
              testID="chat-input-text"
            />
            {disabled && (
              <View style={styles.inputLockedBadge}>
                <Icon name="cloud-off-outline" size={13} color={theme!.colors.text.muted} />
              </View>
            )}
          </View>

          {/* Send / Mic */}
          {showSendButton ? (
            <TouchableOpacity
              onPress={handleSendText}
              style={styles.sendBtnWrap}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              testID="chat-input-send-btn"
            >
              <LinearGradient
                colors={[accent, accentSecondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sendBtn}
              >
                <Icon name="send" size={19} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleToggleRecording}
              style={[
                styles.iconBtn,
                {
                  backgroundColor: hexToRgba(theme!.colors.background.surface, 0.85),
                },
              ]}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Record voice message"
              testID="chat-input-mic-btn"
            >
              <Icon
                name="microphone-outline"
                size={22}
                color={theme!.colors.text.secondary}
              />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Inline emoji picker ── */}
      {showEmojiPicker && !isRecording && (
        <EmojiPickerInline
          onEmojiSelected={handleEmojiSelected}
          entityId={entityId}
        />
      )}
    </ThemedView>
  );
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  topAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,127,127,0.18)',
  },
  inputShell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minHeight: 42,
    maxHeight: 120,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 6,
    paddingHorizontal: 0,
    // Keep Android from showing its own underline
    // (also avoids the extra bottom padding on iOS)
    textAlignVertical: 'center',
  },
  inputLockedBadge: {
    marginLeft: 6,
  },
  sendBtnWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  sendBtn: {
    flex: 1,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Image previews ──
  imagePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
  },
  imagePreviewWrap: {
    position: 'relative',
  },
  imagePreview: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: '#000',
  },
  imageRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageAddBtn: {
    width: 54,
    height: 54,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(127,127,127,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.08)',
  },
  imageSendBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginLeft: 'auto',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 4,
  },
  imageSendBtnDisabled: {
    opacity: 0.7,
  },
  imageSendBtnInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  imageSendText: {
    color: '#fff',
  },
  // ── Recording panel ──
  recordingPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    minHeight: 56,
    borderRadius: 16,
    overflow: 'hidden',
  },
  recordingGlow: {
    ...StyleSheet.absoluteFill,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  recordingTimerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5,
  },
  recordingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingCancelBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  recordingStopBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 5,
  },
  recordingStopBtnInner: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ChatInputBar;
