import React, { useState, useRef, useCallback, useEffect, useImperativeHandle } from 'react';
import {
  StyleSheet,
  View,
  TextInput,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Alert,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchImageLibrary } from 'react-native-image-picker';
import { useTranslation } from 'react-i18next';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import AudioRecorder from '../../services/AudioRecorder';
import { Theme } from '../../theme/types';
import { createLogger } from '../../utils/logger';
import { EmojiAutocomplete } from '../emoji/EmojiAutocomplete';
import EmojiService from '../../services/EmojiService';
import { EmojiEntry } from '../../types/emoji';
import { EmojiActionInput } from './EmojiActionInput';

const log = createLogger('[ChatInput]');

export interface ChatInputRef {
  insertEmoji: (emoji: string) => void;
}

interface ChatInputProps {
  onSendText: (text: string) => void;
  onSendAudio: (audioData: string, duration: number) => void;
  onSendImage: (imageBase64: string, mimeType: string, caption?: string) => void;
  onTypingStart?: () => void;
  onEmojiToggle?: () => void;
  showEmojiButton?: boolean;
  disabled?: boolean;
  theme: Theme;
  entityId?: string | null;
}

export const ChatInput = React.forwardRef<ChatInputRef, ChatInputProps>(({
  onSendText,
  onSendAudio,
  onSendImage,
  onTypingStart,
  onEmojiToggle,
  showEmojiButton = true,
  disabled = false,
  theme,
  entityId,
}, ref) => {
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('chatDetail');
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasRecordPermission, setHasRecordPermission] = useState<boolean | null>(null);
  const [autocompleteResults, setAutocompleteResults] = useState<EmojiEntry[]>([]);
  const [shortcodePrefix, setShortcodePrefix] = useState('');

  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useImperativeHandle(ref, () => ({
    insertEmoji: (emoji: string) => {
      setText(prev => prev + emoji);
    },
  }));

  // Check initial permission
  useEffect(() => {
    const checkInitialPermission = async () => {
      try {
        const hasPermission = await AudioRecorder.hasPermission();
        setHasRecordPermission(hasPermission);
      } catch (error) {
        log.error('Failed to check audio permission:', error);
        setHasRecordPermission(false);
      }
    };

    checkInitialPermission();
  }, []);

  // Recheck permission when app returns to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && hasRecordPermission === false) {
        AudioRecorder.hasPermission().then(setHasRecordPermission);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [hasRecordPermission]);

  // Pulse animation for recording indicator
  const startPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.3,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  const stopPulseAnimation = () => {
    pulseAnim.setValue(1);
    pulseAnim.stopAnimation();
  };

  const handleTextChange = (newText: string) => {
    setText(newText);
    if (newText.length === 1 && onTypingStart) {
      onTypingStart();
    }
    detectShortcodeAutocomplete(newText);
  };

  const detectShortcodeAutocomplete = (text: string) => {
    const lastColonIndex = text.lastIndexOf(':');
    if (lastColonIndex === -1) {
      setAutocompleteResults([]);
      setShortcodePrefix('');
      return;
    }
    if (lastColonIndex === text.length - 1) {
      const popular = EmojiService.searchByShortcodePrefix('', 8);
      setAutocompleteResults(popular);
      setShortcodePrefix('');
      return;
    }
    const prefix = text.slice(lastColonIndex + 1);
    if (prefix.includes(' ') || prefix.includes(':')) {
      setAutocompleteResults([]);
      setShortcodePrefix('');
      return;
    }
    const results = EmojiService.searchByShortcodePrefix(prefix.toLowerCase(), 8);
    setAutocompleteResults(results);
    setShortcodePrefix(prefix);
  };

  const handleAutocompleteSelect = (emoji: EmojiEntry) => {
    const lastColonIndex = text.lastIndexOf(':');
    if (lastColonIndex === -1) return;
    const before = text.slice(0, lastColonIndex);
    const after = text.slice(lastColonIndex + shortcodePrefix.length + 1);
    const newText = before + emoji.native + after;
    setText(newText);
    setAutocompleteResults([]);
    setShortcodePrefix('');
    if (onTypingStart) onTypingStart();
  };

  const handleSend = () => {
    if (text.trim() && !disabled) {
      onSendText(text.trim());
      setText('');
    }
  };

  const toggleRecording = useCallback(async () => {
    if (disabled) return;
    
    if (!isRecording) {
      // Start recording
      try {
        // Initialize will check/request permission
        await AudioRecorder.initialize();
        
        // Update permission state
        setHasRecordPermission(true);
        
        await AudioRecorder.startRecording();
        setIsRecording(true);
        setRecordingDuration(0);
        startPulseAnimation();
        
        recordingTimer.current = setInterval(() => {
          setRecordingDuration(prev => prev + 1);
        }, 1000);
        
      } catch (error: any) {
        log.error('Failed to start recording:', error);
        
        // Check if it's a permission error
        if (error.message?.includes('permission')) {
          setHasRecordPermission(false);
          Alert.alert(
            t('permissionRequired'),
            t('permissionMessage'),
            [
              { text: t('common:cancel'), style: 'cancel' },
              {
                text: t('openSettings'),
                onPress: () => {
                  const { openAppSettings } = require('../../utils/permissions');
                  openAppSettings();
                }
              }
            ]
          );
        } else {
          Alert.alert(t('common:error'), t('recordingFailed'));
        }
      }
    } else {
      // Stop recording
      try {
        setIsProcessing(true);
        
        if (recordingTimer.current) {
          clearInterval(recordingTimer.current);
          recordingTimer.current = null;
        }
        
        const result = await AudioRecorder.stopRecording();
        setIsRecording(false);
        stopPulseAnimation();
        
        if (result.data.length > 0) {
          onSendAudio(result.data, result.duration);
        }
      } catch (error) {
        log.error('Failed to stop recording:', error);
        Alert.alert(t('common:error'), t('recordingStopFailed'));
      } finally {
        setIsProcessing(false);
      }
    }
  }, [disabled, isRecording, onSendAudio]);

  const handleImagePick = useCallback(async () => {
    if (disabled) return;
    
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        includeBase64: true,
      });
      
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.base64 && asset.type) {
          Alert.prompt(
            t('addCaption'),
            t('addCaptionMessage'),
            [
              { text: t('skip'), onPress: () => onSendImage(asset.base64!, asset.type!) },
              { text: t('send'), onPress: (caption?: string) => onSendImage(asset.base64!, asset.type!, caption) },
            ],
            'plain-text'
          );
        }
      }
    } catch (error) {
      log.error('Failed to pick image:', error);
      Alert.alert(t('common:error'), t('imagePickFailed'));
    }
  }, [disabled, onSendImage]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isRecording) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: theme.colors.background.surface, paddingBottom: safeBottom }]}>
        <View style={styles.recordingContainer}>
          <Animated.View
            style={[
              styles.recordingIndicator,
              { 
                backgroundColor: theme.colors.status.error,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
          <ThemedText variant="primary" style={styles.recordingText}>
            {t('recording', { duration: formatDuration(recordingDuration) })}
          </ThemedText>
          <TouchableOpacity
            onPress={toggleRecording}
            style={[styles.stopButton, { backgroundColor: theme.colors.accent.primary }]}
          >
            <Icon name="stop" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.colors.background.surface, paddingBottom: safeBottom }]}>
      <EmojiAutocomplete
        results={autocompleteResults}
        query={shortcodePrefix}
        onSelect={handleAutocompleteSelect}
        onDismiss={() => { setAutocompleteResults([]); setShortcodePrefix(''); }}
        theme={theme}
      />
      <View style={styles.inputRow}>
        {showEmojiButton && onEmojiToggle && (
          <TouchableOpacity
            onPress={onEmojiToggle}
            disabled={disabled || isProcessing}
            style={styles.iconButton}
          >
            <Icon
              name="emoticon-outline"
              size={24}
              color={disabled ? theme.colors.text.disabled : theme.colors.accent.primary}
            />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={handleImagePick}
          disabled={disabled || isProcessing}
          style={styles.iconButton}
        >
          <Icon
            name="image-plus"
            size={24}
            color={disabled ? theme.colors.text.disabled : theme.colors.accent.primary}
          />
        </TouchableOpacity>

        <View style={[styles.inputContainer, { backgroundColor: theme.colors.background.elevated }]}>
          <EmojiActionInput
            value={text}
            onChangeText={handleTextChange}
            placeholder={t('typeMessage')}
            placeholderTextColor={theme.colors.text.muted}
            textColor={theme.colors.text.primary}
            backgroundColor={theme.colors.background.elevated}
            maxLength={2000}
            editable={!disabled && !isProcessing}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
            entityId={entityId ?? null}
            theme={theme}
          />
        </View>

        {text.trim().length > 0 ? (
          <TouchableOpacity
            onPress={handleSend}
            disabled={disabled || isProcessing}
            style={[styles.sendButton, { backgroundColor: theme.colors.accent.primary }]}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon name="send" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={toggleRecording}
            disabled={disabled || isProcessing}
            style={styles.iconButton}
          >
            <Icon
              name={hasRecordPermission === false ? "microphone-off" : "microphone"}
              size={28}
              color={
                disabled 
                  ? theme.colors.text.disabled 
                  : hasRecordPermission === false
                  ? theme.colors.status.error
                  : theme.colors.accent.primary
              }
            />
          </TouchableOpacity>
        )}
      </View>
    </ThemedView>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputContainer: {
    flex: 1,
    borderRadius: 20,
    marginHorizontal: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    // 4 lines × 22px line-height + 2 × 8px vertical padding = 104px
    maxHeight: 104,
  },
  input: {
    fontSize: 16,
    // 4 lines of text (lineHeight 22px each)
    maxHeight: 88,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  recordingIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  recordingText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    fontWeight: '500',
  },
  stopButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
