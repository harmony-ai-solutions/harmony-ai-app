import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, Image, Dimensions, TextInput, ActivityIndicator } from 'react-native';
import { Avatar, IconButton } from 'react-native-paper';
import { Buffer } from 'buffer';
import { ThemedText } from '../themed/ThemedText';
import AudioPlayer from '../../services/AudioPlayer';
import { Theme } from '../../theme/types';
import { ChatMessage } from '../../database/models';

const { width: screenWidth } = Dimensions.get('window');

interface ChatBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  partnerAvatar?: string | null;
  onImagePress?: (imageBase64: string, mimeType: string) => void;
  onSendMessage?: (messageId: string, editedText: string) => void;
  theme: Theme;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  isOwn,
  partnerAvatar,
  onImagePress,
  onSendMessage,
  theme,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(message.content || '');

  useEffect(() => {
    setEditedText(message.content || '');
  }, [message.content]);

  const handlePlayAudio = async () => {
    if (!message.audio_data) return;
    
    if (isPlaying) {
      await AudioPlayer.pause();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      await AudioPlayer.playAudio(message.audio_data, message.audio_mime_type || 'audio/wav');
      setIsPlaying(false);
    }
  };

  const handleImagePress = () => {
    if (message.image_data && onImagePress) {
      onImagePress(message.image_data, message.image_mime_type || 'image/jpeg');
    }
  };

  const renderContent = () => {
    const hasText = message.content && message.content.trim().length > 0;
    const hasAudio = message.audio_data && message.audio_data.length > 0;
    const hasImage = message.image_data && message.image_data.length > 0;

    const isAudioMessage = message.message_type === 'audio' && hasAudio;
    const isTranscribing = isAudioMessage && !hasText;
    const isPendingSend = isAudioMessage && hasText && isOwn;

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
          >
            <IconButton
              icon={isPlaying ? 'pause' : 'play'}
              size={24}
              iconColor={theme.colors.accent.primary}
            />
            <View style={styles.audioWaveform}>
              <View style={[styles.waveformBar, { backgroundColor: theme.colors.accent.primary }]} />
            </View>
            {message.audio_duration && (
              <ThemedText variant="muted" size={12}>
                {formatDuration(message.audio_duration)}
              </ThemedText>
            )}
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
              <ThemedText variant={isOwn ? 'primary' : 'secondary'} style={styles.textContent}>
                {message.content}
              </ThemedText>
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
        
        <ThemedText variant="muted" size={10} style={styles.timestamp}>
          {formatTime(message.created_at)}
        </ThemedText>
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
  textContent: {
    fontSize: 16,
    lineHeight: 22,
  },
  timestamp: {
    marginTop: 4,
    alignSelf: 'flex-end',
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
  audioWaveform: {
    flex: 1,
    height: 24,
    justifyContent: 'center',
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
