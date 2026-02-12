import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Image, Dimensions, TextInput, ActivityIndicator } from 'react-native';
import { Avatar, IconButton, Menu } from 'react-native-paper';
import { ThemedText } from '../themed/ThemedText';
import AudioPlayer from '../../services/AudioPlayer';
import { Theme } from '../../theme/types';
import { ConversationMessage } from '../../database/models';

const { width: screenWidth } = Dimensions.get('window');

interface ChatBubbleProps {
  message: ConversationMessage;
  isOwn: boolean;
  isLastMessage?: boolean;
  partnerAvatar?: string | null;
  onImagePress?: (imageBase64: string, mimeType: string) => void;
  onSendMessage?: (messageId: string, editedText: string) => void;
  onDelete?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, newText: string) => void;
  theme: Theme;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  isOwn,
  isLastMessage = false,
  partnerAvatar,
  onImagePress,
  onSendMessage,
  onDelete,
  onRegenerate,
  onEdit,
  theme,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(message.content || '');
  const [menuVisible, setMenuVisible] = useState(false);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [currentPosition, setCurrentPosition] = useState<number>(0);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [showTranscription, setShowTranscription] = useState(false);
  const progressIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    setEditedText(message.content || '');
  }, [message.content]);

  // Preload audio to get duration
  useEffect(() => {
    const preloadAudio = async () => {
      if (message.audio_data && !audioDuration) {
        try {
          // Initialize and load the track without playing
          await AudioPlayer.initialize();
          await AudioPlayer.stop(); // Reset any previous track
          
          // Add the track
          const uri = `data:${message.audio_mime_type || 'audio/wav'};base64,${message.audio_data}`;
          await AudioPlayer.playAudio(message.audio_data, message.audio_mime_type || 'audio/wav');
          
          // Immediately pause it (so it doesn't play)
          await AudioPlayer.pause();
          
          // Get the duration after a brief delay to ensure track is loaded
          setTimeout(async () => {
            try {
              const duration = await AudioPlayer.getDuration();
              console.log('Preloaded audio duration:', duration);
              if (duration && duration > 0) {
                setAudioDuration(duration);
              } else if (message.audio_duration) {
                // Fallback to stored duration
                setAudioDuration(message.audio_duration);
              }
            } catch (error) {
              console.warn('Could not get duration during preload:', error);
              if (message.audio_duration) {
                setAudioDuration(message.audio_duration);
              }
            }
          }, 300);
        } catch (error) {
          console.warn('Could not preload audio:', error);
          // Use stored duration as fallback
          if (message.audio_duration) {
            setAudioDuration(message.audio_duration);
          }
        }
      }
    };
    
    preloadAudio();
  }, [message.audio_data, message.audio_mime_type, message.audio_duration]);

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
          setCurrentPosition(progress.position);
          
          // Auto-stop when playback finishes
          const state = await AudioPlayer.getState();
          if (state !== 'playing' && state !== 'buffering') {
            setIsPlaying(false);
            setCurrentPosition(0);
          }
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
    if (!message.audio_data) return;
    
    try {
      if (isPlaying) {
        // Pause playback
        await AudioPlayer.pause();
        setIsPlaying(false);
      } else {
        // Check if playback has finished (position at or near end)
        const progress = await AudioPlayer.getProgress();
        if (audioDuration && progress.position >= audioDuration - 0.5) {
          // Seek back to beginning if playback has finished
          await AudioPlayer.seekTo(0);
          setCurrentPosition(0);
        }
        
        // Resume playback (track is already loaded from preload)
        await AudioPlayer.resume();
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('Failed to toggle playback:', error);
      setIsPlaying(false);
    }
  };

  const handleImagePress = () => {
    if (message.image_data && onImagePress) {
      onImagePress(message.image_data, message.image_mime_type || 'image/jpeg');
    }
  };

  const handleDelete = () => {
    setMenuVisible(false);
    if (onDelete) {
      onDelete(message.id);
    }
  };

  const handleRegenerate = () => {
    setMenuVisible(false);
    if (onRegenerate) {
      onRegenerate(message.id);
    }
  };

  const handleEditStart = () => {
    setMenuVisible(false);
    setIsEditing(true);
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
    const hasAudio = message.audio_data && message.audio_data.length > 0;
    const hasImage = message.image_data && message.image_data.length > 0;

    // Audio message with transcription (message_type: 'combined' or 'audio' with text)
    const hasAudioWithTranscription = hasAudio && hasText;
    // Still transcribing (message_type: 'audio' without text yet)
    const isTranscribing = hasAudio && !hasText;
    // Pending send (user's own audio message before sending)
    const isPendingSend = message.message_type === 'audio' && hasText && isOwn;

    return (
      <>
        {hasImage && (
          <TouchableOpacity onPress={handleImagePress} style={styles.imageContainer}>
            <Image
              source={{ uri: `data:${message.image_mime_type || 'image/jpeg'};base64,${message.image_data}` }}
              style={styles.image}
              resizeMode="cover"
            />
          </TouchableOpacity>
        )}
        
        {hasAudio && (
          <TouchableOpacity 
            onPress={handlePlayAudio} 
            style={[styles.audioContainer, { backgroundColor: theme.colors.background.elevated + '40' }]}
            disabled={isLoadingAudio}
            activeOpacity={1}
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
            <View style={styles.audioWaveform}>
              <View style={[styles.progressBarBackground, { backgroundColor: theme.colors.text.muted + '30' }]}>
                <View 
                  style={[
                    styles.progressBar, 
                    { 
                      backgroundColor: theme.colors.accent.primary,
                      width: audioDuration && audioDuration > 0 
                        ? `${(currentPosition / audioDuration) * 100}%`
                        : '0%'
                    }
                  ]} 
                />
              </View>
            </View>
            <ThemedText variant="muted" size={12} style={styles.durationText}>
              {audioDuration && currentPosition > 0
                ? `${formatDuration(currentPosition)} / ${formatDuration(audioDuration)}`
                : audioDuration
                ? `${formatDuration(currentPosition)} / ${formatDuration(audioDuration)}`
                : message.audio_duration
                ? formatDuration(message.audio_duration)
                : '--:--'
              }
            </ThemedText>
          </TouchableOpacity>
        )}

        {isTranscribing && (
          <View style={styles.transcriptionStatus}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            <ThemedText variant="muted" size={12} style={styles.statusText}>
              Transcribing...
            </ThemedText>
          </View>
        )}
        
        {hasAudioWithTranscription && !isPendingSend && !isEditing && (
          <TouchableOpacity 
            onPress={() => setShowTranscription(!showTranscription)}
            style={styles.transcriptionToggle}
          >
            <ThemedText variant="muted" size={12}>
              Transcription
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
                  <ThemedText variant={isOwn ? 'primary' : 'secondary'} style={styles.textContent}>
                    {message.content}
                  </ThemedText>
                )}
              </>
            )}
          </View>
        )}

        {isPendingSend && (
          <View style={styles.actionButtons}>
            {isEditing ? (
              <>
                <TouchableOpacity
                  onPress={() => {
                    setEditedText(message.content || '');
                    setIsEditing(false);
                  }}
                  style={styles.actionButton}
                >
                  <ThemedText variant="muted" size={12}>Cancel</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setIsEditing(false)}
                  style={[styles.actionButton, styles.primaryActionButton, { backgroundColor: theme.colors.accent.primary }]}
                >
                  <ThemedText style={{ color: '#fff' }} size={12}>Save</ThemedText>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  onPress={() => setIsEditing(true)}
                  style={styles.actionButton}
                >
                  <IconButton icon="pencil" size={16} iconColor={theme.colors.text.muted} />
                  <ThemedText variant="muted" size={12}>Edit</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onSendMessage && onSendMessage(message.id, editedText)}
                  style={[styles.actionButton, styles.primaryActionButton, { backgroundColor: theme.colors.accent.primary }]}
                >
                  <IconButton icon="send" size={16} iconColor="#fff" />
                  <ThemedText style={{ color: '#fff' }} size={12}>Send</ThemedText>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
        
        <View style={styles.timestampRow}>
          <ThemedText variant="muted" size={10} style={styles.timestamp}>
            {formatTime(message.created_at)}
          </ThemedText>
          {isLastMessage && !isPendingSend && !isEditing && (
            <Menu
              visible={menuVisible}
              onDismiss={() => setMenuVisible(false)}
              anchor={
                <IconButton
                  icon="dots-vertical"
                  size={16}
                  iconColor={theme.colors.text.muted}
                  onPress={() => setMenuVisible(true)}
                  style={styles.menuButton}
                />
              }
            >
              {isOwn ? (
                <>
                  <Menu.Item onPress={handleEditStart} title="Edit" leadingIcon="pencil" />
                  <Menu.Item onPress={handleDelete} title="Delete" leadingIcon="delete" />
                </>
              ) : (
                <>
                  <Menu.Item onPress={handleRegenerate} title="Regenerate" leadingIcon="refresh" />
                  <Menu.Item onPress={handleDelete} title="Delete" leadingIcon="delete" />
                </>
              )}
            </Menu>
          )}
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
        <Avatar.Text size={32} label="AI" style={styles.avatar} />
      )}
      
      <View style={[
        styles.bubble,
        isOwn 
          ? [styles.ownBubble, { backgroundColor: theme.colors.accent.primary + '20' }]
          : [styles.partnerBubble, { backgroundColor: theme.colors.background.elevated }],
      ]}>
        {renderContent()}
      </View>
    </View>
  );
};

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  bubble: {
    width: screenWidth * 0.75,
    borderRadius: 16,
    padding: 12,
  },
  ownBubble: {
    borderBottomRightRadius: 4,
  },
  partnerBubble: {
    borderBottomLeftRadius: 4,
  },
  textContent: {
    fontSize: 16,
    lineHeight: 22,
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
  menuButton: {
    margin: 0,
    marginLeft: 4,
  },
  imageContainer: {
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: 200,
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
  audioWaveform: {
    flex: 1,
    height: 24,
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  progressBarBackground: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  durationText: {
    minWidth: 60,
    textAlign: 'right',
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
