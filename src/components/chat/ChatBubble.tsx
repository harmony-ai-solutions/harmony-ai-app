import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Image, Dimensions, TextInput, ActivityIndicator, Text } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Avatar, IconButton } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../themed/ThemedText';
import Slider from '@react-native-community/slider';
import AudioPlayer from '../../services/AudioPlayer';
import {
  getConversationMessageAudioBase64,
  getConversationMessageImageBase64,
} from '../../services/engine/repositories/conversation_messages';
import { hasPlaybackStarted, isPlaybackPaused, isPlaybackInProgress } from '../../services/playbackState';
import { Theme } from '../../theme/types';
import { ConversationMessage } from '../../database/models';
import { EmojiAwareText } from '../emoji/EmojiAwareText';
import EmojiService from '../../services/EmojiService';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';
import { MessageReactionsBar } from './MessageReactionsBar';

const log = createLogger('[ChatBubble]');
const { width: screenWidth } = Dimensions.get('window');

/**
 * Inner width of a bubble at its maximum: `bubble.maxWidth` (75% of the
 * window) minus the bubble's 12px horizontal padding. The audio row claims it
 * so a voice note with its transcription collapsed is exactly as wide as a text
 * bubble that wrapped (owner report, 2026-10-22).
 */
const BUBBLE_INNER_MAX_WIDTH = Math.max(220, screenWidth * 0.75 - 24);
const AUDIO_ROW_MIN_WIDTH = BUBBLE_INNER_MAX_WIDTH;

/**
 * Inline image tile width: the SAME inner-bubble width as the audio row.
 * A percentage width (`width: '100%'`) collapses to a sliver inside a
 * content-sized bubble — the bubble has no intrinsic width to resolve against
 * (owner report, 2026-10-27: "image bubble renders as a narrow sliver"). The
 * tile therefore claims an explicit pixel width; its height follows the
 * photo's real aspect ratio (measured below).
 */
const IMAGE_TILE_WIDTH = BUBBLE_INNER_MAX_WIDTH;

/** Height clamp for the inline image tile (px). */
const IMAGE_TILE_MIN_HEIGHT = 120;
const IMAGE_TILE_MAX_HEIGHT = 360;

/** While `Image.getSize` is in flight (or if it fails): classic 4:3 photo. */
const FALLBACK_IMAGE_ASPECT = 4 / 3;

/**
 * Engine-parity blob presence (desktop frontend parity, `chatStoreUtils.js`):
 * the management-API timeline payload is deliberately METADATA-ONLY — audio and
 * image bytes are never inlined; they arrive lazily from the dedicated byte
 * endpoints (`GET /api/messages/:id/{audio,image}`) via the two-phase loader.
 * Media presence is therefore signaled by the lightweight mime columns (the
 * desktop frontend uses `has_audio: !!audio_mime_type`), with `message_type`
 * as a fallback for legacy rows that never stamped a mime.
 */

/** True when the message row carries the actual audio bytes. */
export function hasAudioBytes(
  message: Pick<ConversationMessage, 'audio_data'>,
): boolean {
  return Boolean(message.audio_data && message.audio_data.length > 0);
}

/** True when the message row carries the actual image bytes. */
export function hasImageBytes(
  message: Pick<ConversationMessage, 'image_data'>,
): boolean {
  return Boolean(message.image_data && message.image_data.length > 0);
}

/** True when the message indicates audio, with or without the bytes on hand. */
export function indicatesAudio(
  message: Pick<
    ConversationMessage,
    'audio_data' | 'audio_mime_type' | 'message_type'
  >,
): boolean {
  return (
    hasAudioBytes(message) ||
    Boolean(message.audio_mime_type) ||
    message.message_type === 'audio' ||
    message.message_type === 'combined'
  );
}

/** True when the message indicates an image, with or without the bytes. */
export function indicatesImage(
  message: Pick<
    ConversationMessage,
    'image_data' | 'image_mime_type' | 'message_type'
  >,
): boolean {
  return (
    hasImageBytes(message) ||
    Boolean(message.image_mime_type) ||
    message.message_type === 'image'
  );
}

/**
 * Per-screen cache of blobs already fetched lazily from the byte endpoints
 * (desktop parity: the shared player caches one object URL per message id).
 * Keys are `${kind}:${messageId}` so audio and image share the eviction cap.
 * A failed fetch is remembered too — a 404/network error must not re-fire on
 * every render of the same bubble.
 */
const resolvedBlobCache = new Map<string, string>();
const blobFailures = new Set<string>();
const RESOLVED_BLOB_CACHE_MAX = 48;

function cacheBlob(key: string, base64: string): void {
  if (resolvedBlobCache.has(key)) resolvedBlobCache.delete(key);
  resolvedBlobCache.set(key, base64);
  if (resolvedBlobCache.size > RESOLVED_BLOB_CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldest = resolvedBlobCache.keys().next().value;
    if (oldest !== undefined) resolvedBlobCache.delete(oldest);
  }
}

function cachedBlob(key: string): string | undefined {
  const hit = resolvedBlobCache.get(key);
  if (hit !== undefined) {
    // Refresh recency so a repeated play doesn't evict the hot entry.
    resolvedBlobCache.delete(key);
    resolvedBlobCache.set(key, hit);
  }
  return hit;
}

/**
 * Partner-message derivation (§1-10): a message is a PARTNER message when its
 * sender is NOT the own entity. `message_type="greeting"` messages are always
 * sent by the character (`sender_entity_id` = character), so they naturally
 * derive as partner messages — no message_type special-casing needed.
 */
export function isPartnerMessage(
  message: Pick<ConversationMessage, 'sender_entity_id'>,
  ownEntityId: string,
): boolean {
  return message.sender_entity_id !== ownEntityId;
}

interface ChatBubbleProps {
  message: ConversationMessage;
  isOwn: boolean;
  isTranscriptionFailed?: boolean;
  partnerAvatar?: string | null;
  partnerName?: string;
  /** The message this one replies to (rendered as a "Replying to" header). */
  repliedMessage?: ConversationMessage | null;
  onImagePress?: (imageBase64: string, mimeType: string) => void;
  onSendMessage?: (messageId: string, editedText: string) => void;
  onEdit?: (messageId: string, newText: string) => void;
  onRetryTranscription?: (messageId: string) => void;
  /** Called when the user long-presses the bubble (opens the message action sheet). */
  onLongPress?: (message: ConversationMessage) => void;
  /** Called when the user taps a reaction chip below the bubble. */
  onReact?: (messageId: string, emoji: string) => void;
  theme: Theme;
}

/**
 * FormattedRPText renders message content with roleplay-aware formatting.
 * Text between asterisks (*action*) is rendered in italic with the accent color.
 * All other text is rendered with emoji support via EmojiAwareText.
 */
const FormattedRPText: React.FC<{
  content: string;
  isOwn: boolean;
  accentColor: string;
  textColor: string;
}> = ({ content, isOwn, accentColor, textColor }) => {
  // Parse shortcodes first — converts :emoji: to native emoji characters
  const normalizedContent = EmojiService.parseShortcodes(content);

  const parts = normalizedContent.split(/(\*[^*]+\*)/g);

  // When there's no action text, just render plain text through ThemedText's <Text> parent
  if (parts.length <= 1 && !normalizedContent.includes('*')) {
    return <>{normalizedContent}</>;
  }

  // Render all segments as <Text> children so they flow inline.
  // Emoji shortcodes are already resolved to native characters by parseShortcodes,
  // so they display correctly as text glyphs inside the parent <Text> tree.
  // This avoids React Native's invalid View-in-Text nesting that caused the overlap.
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          // Non-verbal action — italic with accent color, asterisks stripped
          return (
            <Text
              key={index}
              style={{
                fontStyle: 'italic',
                color: isOwn ? textColor : accentColor,
              }}
            >
              {part.slice(1, -1)}
            </Text>
          );
        }
        return <Text key={index}>{part}</Text>;
      })}
    </>
  );
};

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  isOwn,
  isTranscriptionFailed = false,
  partnerAvatar,
  partnerName = 'AI',
  repliedMessage,
  onImagePress,
  onSendMessage,
  onEdit,
  onRetryTranscription,
  onLongPress,
  onReact,
  theme,
}) => {
  const { t } = useTranslation('chatDetail');

  // When replying, size the bubble to at least the quoted message's width so
  // the reply preview isn't squeezed into a tiny bubble. Estimate width from
  // content length (≈6.5px/char at 12-14px font) capped at the max bubble width.
  const replyMinWidth = repliedMessage?.content
    ? Math.min(
        screenWidth * 0.72,
        Math.max(140, repliedMessage.content.length * 6.5),
      )
    : undefined;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(message.content || '');
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [currentPosition, setCurrentPosition] = useState<number>(0);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [showTranscription, setShowTranscription] = useState(false);
  /**
   * Engine parity: image bytes for the inline tile resolve lazily from
   * `GET /api/messages/:id/image` — the timeline payload only carries the mime.
   */
  const [resolvedImage, setResolvedImage] = useState<string | null>(
    hasImageBytes(message) ? message.image_data ?? null : null,
  );
  /**
   * Real width/height ratio of the resolved image, measured from the data URI
   * once the bytes land. `null` = still measuring (or getSize failed) → the
   * 4:3 fallback keeps the tile a sane size instead of collapsing.
   */
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Has playback actually started for the current utterance? RNTP reports
   * `loading`/`ready` while preparing a track, so a poll tick before the first
   * `playing` sample must never be read as "finished" (same classification as
   * the TTS test panel — `src/services/playbackState.ts`).
   */
  const hasStartedRef = useRef(false);
  /**
   * Has the poll already tried to auto-resume THIS utterance after an external
   * audio interruption (`paused`)? One attempt per utterance: a resume that
   * pauses straight back means the interruption (call, another app holding
   * audio focus) is still on, and retrying would be a resume loop.
   */
  const autoResumeAttemptedRef = useRef(false);

  /**
   * Set the instant the user taps pause, BEFORE `AudioPlayer.pause()` resolves.
   * The 250 ms progress poll can observe RNTP's `paused` state in the same
   * window and classify it as an external interruption — which used to
   * auto-resume the very pause the user just requested (owner device,
   * 2026-10-22: "sometimes it just continues to play despite I stopped").
   * A deliberate pause must never be auto-resumed.
   */
  const userPausedRef = useRef(false);

  /** True while the finger is on the seeker, so the poll can't fight the thumb. */
  const isSeekingRef = useRef(false);

  /** A seek made before the track was ever loaded, applied on first play. */
  const pendingSeekPositionRef = useRef<number | null>(null);

  useEffect(() => {
    setEditedText(message.content || '');
  }, [message.content]);

  // FlatList recycles rows: transport state belongs to `message.id`, so reset
  // it when the row is rebound to a different message.
  useEffect(() => {
    setAudioDuration(null);
    setCurrentPosition(0);
    setIsPlaying(false);
    hasStartedRef.current = false;
    autoResumeAttemptedRef.current = false;
    userPausedRef.current = false;
    pendingSeekPositionRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  // The FlatList reuses bubble rows; re-derive the inline image bytes whenever
  // the row's message changes — inline bytes win, otherwise the cache.
  const messageImageKey = `${message.id}:${message.image_data ? 'bytes' : 'meta'}`;
  useEffect(() => {
    if (hasImageBytes(message)) {
      setResolvedImage(message.image_data ?? null);
    } else {
      setResolvedImage(cachedBlob(`image:${message.id}`) ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageImageKey]);

  // Lazy two-phase image load: the list payload carries only `image_mime_type`;
  // fetch the bytes from the byte endpoint once per message (cached above).
  useEffect(() => {
    if (resolvedImage) return;
    const key = `image:${message.id}`;
    if (!indicatesImage(message) || blobFailures.has(key)) return;
    let cancelled = false;
    (async () => {
      try {
        const base64 = await getConversationMessageImageBase64(message.id);
        if (!base64) {
          blobFailures.add(key);
          return;
        }
        cacheBlob(key, base64);
        if (!cancelled) setResolvedImage(base64);
      } catch (error) {
        blobFailures.add(key);
        log.warn('Failed to load message image:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, resolvedImage]);

  // Measure the inline image so the tile follows the photo's REAL aspect
  // ratio. A fixed height used to cover-crop portrait photos into squares;
  // `Image.getSize` reads the data URI directly (no extra round-trip) and the
  // 4:3 fallback holds the tile's size while measuring or if it fails.
  useEffect(() => {
    if (!resolvedImage) {
      setImageAspect(null);
      return;
    }
    let cancelled = false;
    const uri = `data:${message.image_mime_type || 'image/jpeg'};base64,${resolvedImage}`;
    setImageAspect(null);
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled && width > 0 && height > 0) {
          setImageAspect(width / height);
        }
      },
      (error) => {
        log.warn('Failed to measure message image:', error);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, message.image_mime_type, resolvedImage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  // Track playback progress
  useEffect(() => {
    if (isPlaying) {
      // Start polling for progress updates
      progressIntervalRef.current = setInterval(async () => {
        try {
          const progress = await AudioPlayer.getProgress();
          // While the finger is on the seeker, the slider owns the position.
          if (!isSeekingRef.current) {
            setCurrentPosition(progress.position);
          }
          
          // End only on a genuine end state (ended/stopped/none/error) AFTER
          // playback was actually observed — `loading`/`ready` are the player
          // preparing the track, not the utterance finishing, and `paused` is
          // an external interruption (handled below).
          const state = await AudioPlayer.getState();
          if (isPlaybackInProgress(state)) {
            if (hasPlaybackStarted(state)) {
              hasStartedRef.current = true;
            }
            return;
          }
          if (!hasStartedRef.current) return;

          // `paused` after a real `playing` observation is an EXTERNAL audio
          // interruption, NOT the end of the message: AudioPlayer sets up RNTP
          // with `autoHandleInterruptions: true`, so any audio-focus loss (call,
          // another app claiming audio, Bluetooth turning noisy, OEM ducking)
          // pauses the player for us (owner device, 2026-10-21). A tap-pause
          // never lands here — handlePlayAudio clears `isPlaying` itself.
          //
          // ChatBubble has no 'paused' surface (the TTS panel's paused phase
          // keeps its player row), only "playing" and "loaded, tap to
          // continue", so the closest equivalent is used: try ONE auto-resume
          // — the interruption is usually a brief focus loss, and playback then
          // just keeps going. If the resume throws or the player is paused
          // again on the next tick, stop polling and fall back to the play
          // glyph WITHOUT resetting the position: the audio stays loaded and
          // the next tap continues where the interruption caught it, instead of
          // the bubble looking like the message finished at 0:00.
          if (isPlaybackPaused(state)) {
            // A tap-pause is not an interruption: honour it and stop polling.
            if (userPausedRef.current) {
              setIsPlaying(false);
              return;
            }
            if (!autoResumeAttemptedRef.current) {
              autoResumeAttemptedRef.current = true;
              log.info('Playback paused externally — auto-resuming once');
              try {
                await AudioPlayer.resume();
                // Keep polling: the next tick tells us whether the focus came
                // back (`playing`/`buffering`) or the interruption still holds.
                return;
              } catch (resumeError) {
                log.warn('Auto-resume after an external interruption failed:', resumeError);
              }
            }
            setIsPlaying(false);
            return;
          }

          setIsPlaying(false);
          setCurrentPosition(0);
        } catch (error) {
          // Playback might have stopped or encountered an error
          setIsPlaying(false);
          setCurrentPosition(0);
        }
      }, 250);
    } else {
      // Clear interval when not playing
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isPlaying]);

  const handlePlayAudio = async () => {
    if (!indicatesAudio(message)) return;

    try {
      if (isPlaying) {
        // Deliberate pause: claim the intent BEFORE awaiting the player, so an
        // in-flight poll tick can't mistake it for an external interruption and
        // auto-resume it.
        userPausedRef.current = true;
        try {
          await AudioPlayer.pause();
        } finally {
          setIsPlaying(false);
        }
      } else {
        userPausedRef.current = false;
        // Engine parity: the timeline payload is metadata-only — on first play
        // the audio bytes are fetched lazily from
        // `GET /api/messages/:id/audio` (desktop frontend parity: the shared
        // player resolves its object URL on demand).
        const key = `audio:${message.id}`;
        let audioBytes = message.audio_data || cachedBlob(key);
        if (!audioBytes && !blobFailures.has(key)) {
          setIsLoadingAudio(true);
          try {
            audioBytes = await getConversationMessageAudioBase64(message.id);
            if (audioBytes) {
              cacheBlob(key, audioBytes);
            } else {
              blobFailures.add(key);
            }
          } finally {
            setIsLoadingAudio(false);
          }
        }
        if (!audioBytes) return;

        // Check if the correct audio is loaded
        if (!AudioPlayer.isMessageLoaded(message.id)) {
          log.debug(`Loading audio for message ${message.id} (current: ${AudioPlayer.getCurrentMessageId()})`);
          // Wrong audio is loaded, load the correct one
          await AudioPlayer.loadAudioForMessage(
            message.id,
            audioBytes,
            message.audio_mime_type || 'audio/wav'
          );
          
          // Update duration if we get it
          setTimeout(async () => {
            try {
              const duration = await AudioPlayer.getDuration();
              if (duration && duration > 0) {
                setAudioDuration(duration);
              }
            } catch (error) {
              log.warn('Could not get duration:', error);
            }
          }, 300);
        }
        
        // Check if playback has finished (position at or near end) — unless the
        // user picked a start point on the seeker before ever playing the
        // track, in which case honour that choice.
        const pendingSeek = pendingSeekPositionRef.current;
        if (pendingSeek !== null) {
          pendingSeekPositionRef.current = null;
          await AudioPlayer.seekTo(pendingSeek);
          setCurrentPosition(pendingSeek);
        } else {
          const progress = await AudioPlayer.getProgress();
          if (audioDuration && progress.position >= audioDuration - 0.5) {
            // Seek back to beginning if playback has finished
            await AudioPlayer.seekTo(0);
            setCurrentPosition(0);
          }
        }
        
        // Resume playback (track is already loaded)
        await AudioPlayer.resume();
        hasStartedRef.current = false;
        // Same for the one-shot external-interruption auto-resume: this is a
        // fresh start, so the bubble may attempt one again if it gets paused.
        autoResumeAttemptedRef.current = false;
        setIsPlaying(true);
      }
    } catch (error) {
      log.error('Failed to toggle playback:', error);
      setIsPlaying(false);
    }
  };

  /** Seeker — the finger owns the position until release (the poll backs off). */
  const handleSeekStart = () => {
    isSeekingRef.current = true;
  };

  /** Seeker release — label updates immediately, then the player seeks. */
  const handleSeekComplete = async (value: number) => {
    isSeekingRef.current = false;
    setCurrentPosition(value);
    if (!AudioPlayer.isMessageLoaded(message.id)) {
      // The track has not been loaded yet (seek before first play): remember
      // the chosen start point and apply it once the bytes are loaded.
      pendingSeekPositionRef.current = value;
      return;
    }
    try {
      await AudioPlayer.seekTo(value);
    } catch (error) {
      log.warn('Failed to seek message audio:', error);
    }
  };

  const handleImagePress = () => {
    // Bytes may still be resolving lazily — only open the lightbox once the
    // image data is actually available.
    const base64 = resolvedImage ?? (hasImageBytes(message) ? message.image_data : null);
    if (base64 && onImagePress) {
      onImagePress(base64, message.image_mime_type || 'image/jpeg');
    }
  };

  const handleEditSave = () => {
    setIsEditing(false);
    if (onEdit && editedText !== message.content) {
      onEdit(message.id, editedText);
    }
  };

  const handleEditCancel = () => {
    setEditedText(message.content || '');
    setIsEditing(false);
  };

  const renderContent = () => {
    const hasText = message.content && message.content.trim().length > 0;
    // Media presence from the lightweight mime columns; the bytes (audio on
    // first play, image inline) resolve lazily via the byte endpoints.
    const hasAudio = indicatesAudio(message);
    const hasImage = resolvedImage !== null && indicatesImage(message);

    // Explicit tile geometry: pixel width (never a percentage — see
    // IMAGE_TILE_WIDTH) + height from the measured aspect, clamped so a
    // panorama stays readable and a portrait photo gets a proper tall tile.
    const imageAspectRatio =
      imageAspect && imageAspect > 0 ? imageAspect : FALLBACK_IMAGE_ASPECT;
    const imageTileHeight = Math.round(
      Math.min(
        IMAGE_TILE_MAX_HEIGHT,
        Math.max(IMAGE_TILE_MIN_HEIGHT, IMAGE_TILE_WIDTH / imageAspectRatio),
      ),
    );

    // Audio message with transcription (message_type: 'combined' or 'audio' with text)
    const hasAudioWithTranscription = hasAudio && hasText;
    // Still transcribing (message_type: 'audio' without text yet)
    const isTranscribing = hasAudio && !hasText;
    // Pending send (user's own audio message before sending)
    const isPendingSend = message.message_type === 'audio' && hasText && isOwn;

    // Transport length: the live player duration wins once known, otherwise the
    // conversation row's metadata (`audio_duration`) — so the seeker works from
    // the very first frame, before the bytes are even fetched.
    const seekDuration =
      audioDuration && audioDuration > 0 ? audioDuration : message.audio_duration ?? 0;
    const seekMaximum = Math.max(seekDuration, 0.1);
    const clampedPosition = Math.min(Math.max(currentPosition, 0), seekMaximum);

    return (
      <>
        {/* ── Reply header: "Replying to X" with a snippet of the quoted message ── */}
        {repliedMessage && (
          <TouchableOpacity
            style={[
              styles.replyHeader,
              {
                backgroundColor: isOwn
                  ? 'rgba(255,255,255,0.12)'
                  : theme.colors.accent.primary + '12',
                borderLeftColor: theme.colors.accent.primary,
              },
            ]}
            activeOpacity={0.7}
          >
            <View style={styles.replyHeaderText}>
              <ThemedText
                size={12}
                weight="bold"
                numberOfLines={1}
                style={{
                  color: isOwn ? '#fff' : theme.colors.accent.primary,
                }}
              >
                {t('replyingTo', { name: repliedMessage.sender_entity_id === message.entity_id ? partnerName : t('you') })}
              </ThemedText>
              <ThemedText
                size={12}
                numberOfLines={2}
                style={{
                  color: isOwn ? 'rgba(255,255,255,0.85)' : theme.colors.text.secondary,
                }}
              >
                {repliedMessage.content || t('mediaMessage')}
              </ThemedText>
            </View>
          </TouchableOpacity>
        )}

        {hasImage && (
          <TouchableOpacity
            onPress={handleImagePress}
            style={styles.imageContainer}
            testID={`chat-image-${message.id}`}
          >
            <Image
              source={{ uri: `data:${message.image_mime_type || 'image/jpeg'};base64,${resolvedImage}` }}
              style={[styles.image, { width: IMAGE_TILE_WIDTH, height: imageTileHeight }]}
              resizeMode="cover"
            />
          </TouchableOpacity>
        )}
        
        {hasAudio && (
          <View
            style={[
              styles.audioContainer,
              // Engine-parity bubbles are content-width by default; audio-only
              // messages (transcription collapsed) collapsed to a sliver. The
              // player always claims the same width a wrapped text bubble gets
              // (bubble maxWidth − horizontal padding).
              { backgroundColor: theme.colors.background.elevated + '40', minWidth: AUDIO_ROW_MIN_WIDTH },
            ]}
            testID={`chat-audio-row-${message.id}`}
          >
            <TouchableOpacity
              onPress={handlePlayAudio}
              testID={`chat-audio-${message.id}`}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('pause') : t('play')}
              disabled={isLoadingAudio}
              activeOpacity={0.7}
              style={styles.playButtonTouchable}
            >
              {isLoadingAudio ? (
                <ActivityIndicator size="small" color={theme.colors.accent.primary} />
              ) : (
                <IconButton
                  icon={isPlaying ? 'pause' : 'play'}
                  size={24}
                  iconColor={theme.colors.accent.primary}
                  animated={false}
                  style={styles.playButton}
                />
              )}
            </TouchableOpacity>
            <Slider
              testID={`chat-audio-seek-${message.id}`}
              style={styles.audioSeekSlider}
              minimumValue={0}
              maximumValue={seekMaximum}
              value={clampedPosition}
              minimumTrackTintColor={theme.colors.accent.primary}
              maximumTrackTintColor={theme.colors.text.muted + '30'}
              thumbTintColor={theme.colors.accent.primary}
              disabled={seekDuration <= 0 || isLoadingAudio}
              onSlidingStart={handleSeekStart}
              onSlidingComplete={handleSeekComplete}
            />
            <ThemedText variant="muted" size={12} style={styles.durationText}>
              {seekDuration > 0
                ? `${formatDuration(currentPosition)} / ${formatDuration(seekDuration)}`
                : '--:--'
              }
            </ThemedText>
          </View>
        )}

        {isTranscribing && !isTranscriptionFailed && (
          <View style={styles.transcriptionStatus}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            <ThemedText variant="muted" size={12} style={styles.statusText}>
              {t('transcribing')}
            </ThemedText>
          </View>
        )}
        
        {isTranscriptionFailed && (
          <View style={styles.transcriptionStatus}>
            <ThemedText variant="muted" size={12} style={styles.statusText}>
              {t('transcriptionFailed')}
            </ThemedText>
            <TouchableOpacity
              onPress={() => {
                hapticLightPress();
                onRetryTranscription && onRetryTranscription(message.id);
              }}
              style={[styles.retryButton, { backgroundColor: theme.colors.accent.primary }]}
            >
              <IconButton icon="refresh" size={14} iconColor="#fff" style={styles.retryIcon} />
              <ThemedText style={{ color: '#fff' }} size={12}>{t('retry')}</ThemedText>
            </TouchableOpacity>
          </View>
        )}
        
        {hasAudioWithTranscription && !isPendingSend && !isEditing && (
          <TouchableOpacity 
            onPress={() => setShowTranscription(!showTranscription)}
            style={styles.transcriptionToggle}
          >
            <ThemedText variant="muted" size={12}>
              {t('transcription')}
            </ThemedText>
            <IconButton
              icon={showTranscription ? 'chevron-up' : 'chevron-down'}
              size={16}
              iconColor={theme.colors.text.muted}
              style={styles.transcriptionToggleIcon}
            />
          </TouchableOpacity>
        )}
        
        {hasText && (
          <View>
            {isEditing ? (
              <TextInput
                value={editedText}
                onChangeText={setEditedText}
                multiline
                style={[styles.textInput, { color: theme.colors.text.primary, borderColor: theme.colors.border.default }]}
                placeholderTextColor={theme.colors.text.muted}
              />
            ) : (
              <>
                {(!hasAudioWithTranscription || isPendingSend || showTranscription) && (
                  <View style={styles.textContentContainer}>
                    <ThemedText variant={isOwn ? 'primary' : 'secondary'} style={styles.textContent}>
                      <FormattedRPText
                        content={isPendingSend && editedText !== message.content ? editedText : message.content}
                        isOwn={isOwn}
                        accentColor={theme.colors.accent.primary}
                        textColor={isOwn ? theme.colors.text.primary : theme.colors.text.secondary}
                      />
                    </ThemedText>
                    {message.is_edited && (
                      <ThemedText variant="muted" size={11} style={styles.editedIndicator}>
                        {t('edited')}
                      </ThemedText>
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {isEditing && !isPendingSend && (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              onPress={() => {
                hapticLightPress();
                handleEditCancel();
              }}
              style={styles.actionButton}
            >
              <ThemedText variant="muted" size={12}>{t('cancel')}</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                hapticLightPress();
                handleEditSave();
              }}
              style={[styles.actionButton, styles.primaryActionButton, { backgroundColor: theme.colors.accent.primary }]}
            >
              <ThemedText style={{ color: '#fff' }} size={12}>{t('save')}</ThemedText>
            </TouchableOpacity>
          </View>
        )}

        {isPendingSend && (
          <View style={styles.actionButtons}>
            {isEditing ? (
              <>
                <TouchableOpacity
                  onPress={() => {
                    hapticLightPress();
                    handleEditCancel();
                  }}
                  style={styles.actionButton}
                >
                  <ThemedText variant="muted" size={12}>{t('cancel')}</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    hapticLightPress();
                    handleEditSave();
                  }}
                  style={[styles.actionButton, styles.primaryActionButton, { backgroundColor: theme.colors.accent.primary }]}
                >
                  <ThemedText style={{ color: '#fff' }} size={12}>{t('save')}</ThemedText>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  onPress={() => {
                    hapticLightPress();
                    setIsEditing(true);
                  }}
                  style={styles.actionButton}
                >
                  <IconButton icon="pencil" size={16} iconColor={theme.colors.text.muted} />
                  <ThemedText variant="muted" size={12}>{t('edit')}</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    hapticLightPress();
                    onSendMessage && onSendMessage(message.id, editedText);
                  }}
                  style={[styles.actionButton, styles.primaryActionButton, { backgroundColor: theme.colors.accent.primary }]}
                >
                  <IconButton icon="send" size={16} iconColor="#fff" />
                  <ThemedText style={{ color: '#fff' }} size={12}>{t('send')}</ThemedText>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
        
        <View style={styles.timestampRow}>
          <ThemedText variant="muted" size={10} style={styles.timestamp}>
            {formatTime(message.created_at)}
          </ThemedText>
        </View>
      </>
    );
  };

  return (
    <View style={[styles.container, isOwn ? styles.ownContainer : styles.partnerContainer]}>
      {!isOwn && partnerAvatar && (
        <Avatar.Image size={32} source={{ uri: partnerAvatar }} style={styles.avatar} />
      )}
      {!isOwn && !partnerAvatar && (
        <LinearGradient
          colors={[
            theme.colors.accent.primary + '33',
            theme.colors.background.elevated,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.avatarFallback}
        >
          <ThemedText size={13} weight="bold" style={{ color: theme.colors.accent.primary }}>
            {partnerName.substring(0, 2).toUpperCase()}
          </ThemedText>
        </LinearGradient>
      )}

      <TouchableOpacity
        activeOpacity={1}
        delayLongPress={400}
        onLongPress={() => {
          if (onLongPress && !isEditing) {
            hapticLightPress();
            onLongPress(message);
          }
        }}
      >
        {isOwn ? (
          // Own bubble: accent gradient at ~55-35% opacity — gives colour depth
          // without washing out text or audio controls.
          <LinearGradient
            colors={[theme.colors.accent.primary + 'B3', (theme.colors.accent.secondary ?? theme.colors.accent.primaryHover) + '80']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.bubble,
              styles.ownBubble,
              { backgroundColor: theme.colors.background.surface, minWidth: replyMinWidth },
            ]}
          >
            {renderContent()}
          </LinearGradient>
        ) : (
          // Partner bubble: subtle elevated→surface gradient
          <LinearGradient
            colors={[theme.colors.background.elevated, theme.colors.background.surface]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.bubble, styles.partnerBubble, { minWidth: replyMinWidth }]}
          >
            {renderContent()}
          </LinearGradient>
        )}
      </TouchableOpacity>

      {/* Reactions float BELOW the bubble as separate chips, so they don't
          blend into the bubble gradient. */}
      <MessageReactionsBar
        reactionsJson={message.reactions_json}
        onReact={onReact ? (emoji) => onReact(message.id, emoji) : undefined}
        align={isOwn ? 'right' : 'left'}
      />
    </View>
  );
};

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginVertical: 4,
    paddingHorizontal: 12,
    alignItems: 'flex-end',
  },
  ownContainer: {
    justifyContent: 'flex-end',
  },
  partnerContainer: {
    justifyContent: 'flex-start',
  },
  avatar: {
    marginRight: 8,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  bubble: {
    maxWidth: screenWidth * 0.75,
    borderRadius: 16,
    padding: 12,
  },
  ownBubble: {
    borderBottomRightRadius: 4,
  },
  partnerBubble: {
    borderBottomLeftRadius: 4,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  replyHeaderText: {
    flex: 1,
  },
  textContent: {
    fontSize: 16,
    lineHeight: 22,
  },
  textContentContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
  editedIndicator: {
    marginLeft: 6,
    fontStyle: 'italic',
    opacity: 0.6,
  },
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timestamp: {
    alignSelf: 'flex-end',
  },
  imageContainer: {
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    // Width/height are set inline from IMAGE_TILE_WIDTH + the measured aspect
    // ratio — never a percentage (it collapsed inside a content-sized bubble).
    borderRadius: 12,
  },
  audioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginBottom: 8,
  },
  playButton: {
    margin: 0,
  },
  playButtonTouchable: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioSeekSlider: {
    flex: 1,
    height: 30,
    marginHorizontal: 4,
  },
  durationText: {
    minWidth: 60,
    textAlign: 'right',
    // Same monospace clock as the TTS test panel's player row — keeps the
    // running `0:03 / 0:57` from shifting width on every tick.
    fontFamily: 'monospace',
  },
  waveformBar: {
    height: 4,
    borderRadius: 2,
    width: '60%',
  },
  transcriptionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  statusText: {
    marginLeft: 8,
    marginRight: 8,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  retryIcon: {
    margin: 0,
    marginLeft: -4,
  },
  transcriptionToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginBottom: 4,
  },
  transcriptionToggleIcon: {
    margin: 0,
    marginLeft: -8,
  },
  textInput: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  primaryActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
});
