import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ToastAndroid,
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { Appbar, Avatar } from 'react-native-paper';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ChatBubble } from '../components/chat/ChatBubble';
import { ChatInput } from '../components/chat/ChatInput';
import { TypingIndicator } from '../components/chat/TypingIndicator';
import { NewMessagesDivider } from '../components/chat/NewMessagesDivider';
import { useEntitySession } from '../contexts/EntitySessionContext';
import EntitySessionService from '../services/EntitySessionService'; // Still needed for event listeners
import { getRecentConversationMessages, updateConversationMessage, getConversationMessage, deleteConversationMessage } from '../database/repositories/conversation_messages';
import { getPrimaryImage, getCharacterProfile, imageToDataURL } from '../database/repositories/characters';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { createLogger } from '../utils/logger';
import { ConversationMessage } from '../database/models';

const log = createLogger('[ChatDetailScreen]');

type Props = NativeStackScreenProps<RootStackParamList, 'ChatDetail'>;

export const ChatDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { partnerEntityId, partnerCharacterId, impersonatedEntityId } = route.params;
  const { theme } = useAppTheme();
  const { isConnected } = useSyncConnection();
  const { isDualSessionActive, startDualSession, stopDualSession } = useEntitySession();
  
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [partnerName, setPartnerName] = useState<string>('Chat');
  const [partnerAvatar, setPartnerAvatar] = useState<string | null>(null);
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(0);
  const [failedTranscriptions, setFailedTranscriptions] = useState<Set<string>>(new Set());
  
  const flatListRef = useRef<FlatList<any>>(null);
  const hasScrolledToNewMessages = useRef(false);
  // Tracks whether the user is near the bottom of the list; used to decide whether to auto-scroll on new messages
  const isNearBottom = useRef(true);

  // Load partner info (avatar, name)
  useEffect(() => {
    const loadPartnerInfo = async () => {
      if (partnerCharacterId) {
        const profile = await getCharacterProfile(partnerCharacterId);
        if (profile) {
          setPartnerName(profile.name);
        }
        const image = await getPrimaryImage(partnerCharacterId);
        if (image) {
          setPartnerAvatar(imageToDataURL(image));
        }
      }
    };
    loadPartnerInfo();
  }, [partnerCharacterId]);

  // Load messages and last-read timestamp
  useEffect(() => {
    const loadMessagesAndTimestamp = async () => {
      try {
        setLoading(true);
        
        const existingMessages = await getRecentConversationMessages(
          impersonatedEntityId,
          partnerEntityId,
          50
        );
        setMessages(existingMessages);
        
        // Detect stuck transcriptions (messages with audio but no text that aren't actively transcribing)
        const stuckTranscriptions = existingMessages
          .filter(msg => 
            msg.audio_data && 
            msg.audio_data.length > 0 && 
            (!msg.content || msg.content.trim().length === 0) &&
            msg.sender_entity_id === impersonatedEntityId // Only user's own messages
          )
          .map(msg => msg.id);
        
        if (stuckTranscriptions.length > 0) {
          log.info(`Found ${stuckTranscriptions.length} stuck transcriptions on load`);
          setFailedTranscriptions(new Set(stuckTranscriptions));
        }
        
        const timestamp = await ChatPreferencesService.getLastReadTimestamp(partnerEntityId);
        setLastReadTimestamp(timestamp);
      } catch (error) {
        log.error('Failed to load messages:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadMessagesAndTimestamp();
  }, [partnerEntityId, impersonatedEntityId]);

  // Session lifecycle – stop session only when the screen unmounts
  // (user navigates away).  This is intentionally NOT triggered by isConnected
  // changes so that EntitySessionContext's own sync-drop cleanup is the sole
  // owner of that path, eliminating the double-stop race condition (Bug #4).
  useEffect(() => {
    return () => {
      log.info(`Screen unmounting – stopping session for ${partnerEntityId}`);
      stopDualSession(partnerEntityId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerEntityId]);

  // Session initialization – (re)start the session whenever the sync
  // connection becomes available or the chat target changes.  The service's
  // startDualSession() handles "already active" and "stale" cases internally
  // so we do not need an isDualSessionActive guard here.
  useEffect(() => {
    let mounted = true;

    if (!isConnected) {
      // Sync not connected yet – wait for the next time this effect fires
      // (when isConnected transitions to true).
      return;
    }

    const initializeSession = async () => {
      try {
        log.info(`Initializing dual session for ${partnerEntityId}...`);
        await startDualSession(partnerEntityId, impersonatedEntityId);
        // Session starts in 'connecting' state; UI shows "Connecting..."
        // Status transitions to 'active' when INIT_ENTITY responses arrive.
      } catch (error: any) {
        if (!mounted) return;

        log.error('Failed to initialize entity session:', error);

        const errorMessage = error?.message || 'Unknown error';
        if (Platform.OS === 'android') {
          ToastAndroid.show(
            `Failed to start chat session: ${errorMessage}`,
            ToastAndroid.LONG
          );
        } else {
          Alert.alert(
            'Connection Error',
            `Could not establish chat session: ${errorMessage}`,
            [{ text: 'OK' }]
          );
        }
      }
    };

    initializeSession();

    return () => {
      mounted = false;
    };
  }, [partnerEntityId, impersonatedEntityId, isConnected]);

  // Listen for new messages and typing indicator
  useEffect(() => {
    const handleNewMessage = (entityId: string) => {
      if (entityId === partnerEntityId) {
        // Reload messages from database
        getRecentConversationMessages(impersonatedEntityId, partnerEntityId, 50)
          .then(setMessages);
      }
    };
    
    const handleTyping = (entityId: string, senderId: string, isTypingActive: boolean) => {
      if (entityId === partnerEntityId && (senderId === partnerEntityId || senderId === '')) {
        setIsTyping(isTypingActive);
        if (isTypingActive) setIsRecording(false);
      }
    };

    const handleRecording = (entityId: string, senderId: string, isRecordingActive: boolean) => {
      if (entityId === partnerEntityId && (senderId === partnerEntityId || senderId === '')) {
        setIsRecording(isRecordingActive);
        if (isRecordingActive) setIsTyping(false);
      }
    };

    // Cleanup indicators when session becomes inactive
    if (!isDualSessionActive(partnerEntityId)) {
      setIsTyping(false);
      setIsRecording(false);
    }

    const handleTranscriptionCompleted = (entityId: string, messageId: string, text: string) => {
      if (entityId === partnerEntityId) {
        log.info(`Transcription completed for message ${messageId}: "${text}"`);
        // Remove from failed set if it was there
        setFailedTranscriptions(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
        // Reload messages to show updated transcription and scroll to it
        getRecentConversationMessages(impersonatedEntityId, partnerEntityId, 50)
          .then(updatedMessages => {
            // Transcription completion updates the user's own message - always scroll to it
            isNearBottom.current = true;
            setMessages(updatedMessages);
          });
      }
    };

    const handleTranscriptionFailed = (entityId: string, messageId: string) => {
      if (entityId === partnerEntityId) {
        log.warn(`Transcription failed for message ${messageId}`);
        // Add to failed set
        setFailedTranscriptions(prev => new Set(prev).add(messageId));
        // Reload messages to trigger re-render
        getRecentConversationMessages(impersonatedEntityId, partnerEntityId, 50)
          .then(setMessages);
      }
    };
    
    EntitySessionService.on('message:received', handleNewMessage);
    EntitySessionService.on('typing:indicator', handleTyping);
    EntitySessionService.on('recording:indicator', handleRecording);
    EntitySessionService.on('transcription:completed', handleTranscriptionCompleted);
    EntitySessionService.on('transcription:failed', handleTranscriptionFailed);

    return () => {
      EntitySessionService.off('message:received', handleNewMessage);
      EntitySessionService.off('typing:indicator', handleTyping);
      EntitySessionService.off('recording:indicator', handleRecording);
      EntitySessionService.off('transcription:completed', handleTranscriptionCompleted);
      EntitySessionService.off('transcription:failed', handleTranscriptionFailed);
    };
  }, [partnerEntityId, impersonatedEntityId]);

  // Listen for session errors
  useEffect(() => {
    const handleSessionError = (errorPartnerId: string, error: string) => {
      if (errorPartnerId === partnerEntityId) {
        log.error(`Session error for ${partnerEntityId}:`, error);
        
        if (Platform.OS === 'android') {
          ToastAndroid.show(
            `Chat session error: ${error}`,
            ToastAndroid.LONG
          );
        } else {
          Alert.alert(
            'Session Error',
            error,
            [{ text: 'OK' }]
          );
        }
      }
    };
    
    EntitySessionService.on('session:error', handleSessionError);
    
    return () => {
      EntitySessionService.off('session:error', handleSessionError);
    };
  }, [partnerEntityId]);

  const handleSendText = useCallback(async (text: string) => {
    if (!text.trim() || !isDualSessionActive(partnerEntityId)) {
      log.warn('Cannot send message: session not active');
      return;
    }
    
    try {
      await EntitySessionService.sendTextMessage(partnerEntityId, text.trim());
      // Optimistically reload from database
      const updatedMessages = await getRecentConversationMessages(
        impersonatedEntityId,
        partnerEntityId,
        50
      );
      // Always scroll to the message the user just sent
      isNearBottom.current = true;
      setMessages(updatedMessages);
    } catch (error) {
      log.error('Failed to send message:', error);
    }
  }, [partnerEntityId, impersonatedEntityId, isDualSessionActive]);

  const handleSendAudio = useCallback(async (audioData: string, duration: number) => {
    if (!isDualSessionActive(partnerEntityId)) return;
    
    try {
      await EntitySessionService.newAudioMessage(
        partnerEntityId,
        audioData,
        'audio/wav',
        duration
      );
      
      log.info('Audio message saved, awaiting transcription...');
      
      const updatedMessages = await getRecentConversationMessages(
        impersonatedEntityId,
        partnerEntityId,
        50
      );
      // Always scroll to the message the user just sent
      isNearBottom.current = true;
      setMessages(updatedMessages);
    } catch (error) {
      log.error('Failed to save audio message:', error);
    }
  }, [partnerEntityId, impersonatedEntityId, isDualSessionActive]);

  const handleConfirmAndSendMessage = useCallback(async (messageId: string, finalText: string) => {
    if (!isDualSessionActive(partnerEntityId)) {
      log.warn('Cannot send message: session not active');
      return;
    }
    
    try {
      const message = await getConversationMessage(messageId);
      if (!message || !message.audio_data) {
        throw new Error('Message not found or has no audio');
      }

      const base64Audio = message.audio_data; // Already base64 string

      // Update message with final text and change type to 'combined'
      const updates: any = { message_type: 'combined' };
      if (finalText !== message.content) {
        updates.content = finalText;
      }
      await updateConversationMessage(messageId, updates);

      const dualSession = EntitySessionService.getSession(partnerEntityId);
      if (dualSession) {
        const utterance = {
          entity_id: dualSession.impersonatedEntityId,
          content: finalText,
          type: 'UTTERANCE_COMBINED',
          audio: base64Audio,
          audio_type: message.audio_mime_type || 'audio/wav',
          audio_duration: message.audio_duration || 0,
          message_id: messageId
        };

        await EntitySessionService.sendUtterance(
          dualSession.partnerSession.connectionId,
          utterance
        );

        log.info(`Message ${messageId} sent to partner entity`);

        const updatedMessages = await getRecentConversationMessages(
          impersonatedEntityId,
          partnerEntityId,
          50
        );
        // Always scroll to the message the user just sent
        isNearBottom.current = true;
        setMessages(updatedMessages);
      }
    } catch (error: any) {
      log.error('Failed to send message:', error);
      if (Platform.OS === 'android') {
        ToastAndroid.show(`Failed to send: ${error.message}`, ToastAndroid.LONG);
      } else {
        Alert.alert('Error', `Failed to send message: ${error.message}`);
      }
    }
  }, [partnerEntityId, impersonatedEntityId, isDualSessionActive]);

  const handleSendImage = useCallback(async (imageBase64: string, mimeType: string, caption?: string) => {
    if (!isDualSessionActive(partnerEntityId)) return;
    
    try {
      await EntitySessionService.sendImageMessage(partnerEntityId, imageBase64, mimeType, caption);
      const updatedMessages = await getRecentConversationMessages(
        impersonatedEntityId,
        partnerEntityId,
        50
      );
      // Always scroll to the message the user just sent
      isNearBottom.current = true;
      setMessages(updatedMessages);
    } catch (error) {
      log.error('Failed to send image:', error);
    }
  }, [partnerEntityId, isDualSessionActive]);

  const handleTypingStart = useCallback(() => {
    // Send typing indicator if session active
  }, [partnerEntityId, isDualSessionActive]);

  // Delete message handler
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteConversationMessage(messageId);
              const updatedMessages = await getRecentConversationMessages(
                impersonatedEntityId,
                partnerEntityId,
                50
              );
              setMessages(updatedMessages);
              
              if (Platform.OS === 'android') {
                ToastAndroid.show('Message deleted', ToastAndroid.SHORT);
              }
            } catch (error) {
              log.error('Failed to delete message:', error);
            }
          },
        },
      ]
    );
  }, [impersonatedEntityId, partnerEntityId]);

  // Regenerate message handler (for partner's last message)
  const handleRegenerateMessage = useCallback(async (messageId: string) => {
    Alert.alert(
      'Regenerate Response',
      'Delete this response and regenerate a new one?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          onPress: async () => {
            try {
              // Delete the partner's message
              await deleteConversationMessage(messageId);
              
              // Find the last user message
              const userMessages = messages.filter(m => m.sender_entity_id === impersonatedEntityId);
              if (userMessages.length === 0) {
                throw new Error('No previous message to regenerate from');
              }
              
              const lastUserMessage = userMessages[userMessages.length - 1];
              
              // Delete the old user message record - sendTextMessage will re-create it with
              // the current session_id, preventing duplication when the session was restarted
              await deleteConversationMessage(lastUserMessage.id);
              
              // Resend the user's last message
              await EntitySessionService.sendTextMessage(partnerEntityId, lastUserMessage.content);
              
              // Reload messages
              const updatedMessages = await getRecentConversationMessages(
                impersonatedEntityId,
                partnerEntityId,
                50
              );
              // Always scroll to the re-sent user message
              isNearBottom.current = true;
              setMessages(updatedMessages);
              
              if (Platform.OS === 'android') {
                ToastAndroid.show('Regenerating response...', ToastAndroid.SHORT);
              }
            } catch (error: any) {
              log.error('Failed to regenerate:', error);
              if (Platform.OS === 'android') {
                ToastAndroid.show(`Failed: ${error.message}`, ToastAndroid.LONG);
              } else {
                Alert.alert('Error', error.message);
              }
            }
          },
        },
      ]
    );
  }, [messages, impersonatedEntityId, partnerEntityId]);

  // Edit message handler (for user's last message)
  const handleEditMessage = useCallback(async (messageId: string, newText: string) => {
    Alert.alert(
      'Edit and Resend',
      'Edit and resend this message? This will trigger a new AI response.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Edit & Resend',
          onPress: async () => {
            try {
              // Update the message content
              await updateConversationMessage(messageId, { content: newText });
              
              // Get the message to check if it has audio
              const message = await getConversationMessage(messageId);
              if (!message) {
                throw new Error('Message not found');
              }
              
              // Resend with new text
              await EntitySessionService.sendTextMessage(partnerEntityId, newText);
              
              // Reload messages
              const updatedMessages = await getRecentConversationMessages(
                impersonatedEntityId,
                partnerEntityId,
                50
              );
              setMessages(updatedMessages);
              
              if (Platform.OS === 'android') {
                ToastAndroid.show('Message updated and sent', ToastAndroid.SHORT);
              }
            } catch (error: any) {
              log.error('Failed to edit message:', error);
              if (Platform.OS === 'android') {
                ToastAndroid.show(`Failed: ${error.message}`, ToastAndroid.LONG);
              } else {
                Alert.alert('Error', error.message);
              }
            }
          },
        },
      ]
    );
  }, [impersonatedEntityId, partnerEntityId]);

  const handleRetryTranscription = useCallback(async (messageId: string) => {
    try {
      // Remove from failed set optimistically
      setFailedTranscriptions(prev => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
      
      await EntitySessionService.retryTranscription(messageId, partnerEntityId);
      
      if (Platform.OS === 'android') {
        ToastAndroid.show('Retrying transcription...', ToastAndroid.SHORT);
      }
    } catch (error: any) {
      log.error('Failed to retry transcription:', error);
      
      // Add back to failed set
      setFailedTranscriptions(prev => new Set(prev).add(messageId));
      
      if (Platform.OS === 'android') {
        ToastAndroid.show(`Retry failed: ${error.message}`, ToastAndroid.LONG);
      } else {
        Alert.alert('Retry Failed', error.message);
      }
    }
  }, [partnerEntityId]);

  // Calculate messages with divider
  const messagesWithDivider = useMemo(() => {
    if (messages.length === 0 || lastReadTimestamp === 0) {
      return messages;
    }
    
    // Find the first new message
    const firstNewIndex = messages.findIndex(m => 
      m.created_at.getTime() > lastReadTimestamp
    );
    
    // If no new messages or all messages are new, don't add divider
    if (firstNewIndex === -1 || firstNewIndex === 0) {
      return messages;
    }
    
    // Insert divider before first new message
    const newMessageCount = messages.length - firstNewIndex;
    const result: any[] = [...messages];
    result.splice(firstNewIndex, 0, {
      id: 'new-messages-divider',
      type: 'divider',
      count: newMessageCount,
    });
    
    return result;
  }, [messages, lastReadTimestamp]);

  // Scroll to new messages on mount
  useEffect(() => {
    if (messagesWithDivider.length > 0 && !hasScrolledToNewMessages.current) {
      const dividerIndex = messagesWithDivider.findIndex((m: any) => m.type === 'divider');
      
      if (dividerIndex !== -1) {
        const messagesAfterDivider = messagesWithDivider.length - dividerIndex - 1;
        
        // Small delay to ensure FlatList is rendered
        setTimeout(() => {
          if (messagesAfterDivider < 3) {
            // Close to bottom, scroll to end
            flatListRef.current?.scrollToEnd({ animated: true });
          } else {
            // Scroll to show divider at top; mark not-near-bottom so auto-scroll
            // on content size change doesn't immediately override this position
            isNearBottom.current = false;
            try {
              flatListRef.current?.scrollToIndex({
                index: dividerIndex,
                animated: true,
                viewPosition: 0,
              });
            } catch (error) {
              // Fallback to scroll to end if scrollToIndex fails
              flatListRef.current?.scrollToEnd({ animated: true });
            }
          }
          hasScrolledToNewMessages.current = true;
        }, 100);
      }
    }
  }, [messagesWithDivider]);

  // Capture the final scroll position accurately when a scroll animation or drag ends.
  // This avoids relying solely on the throttled onScroll event and ensures
  // isNearBottom.current is correct when the user "lands" at the bottom.
  const handleScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    isNearBottom.current =
      contentSize.height - (contentOffset.y + layoutMeasurement.height) < 150;
  }, []);

  // Handle scroll for mark-as-read and near-bottom tracking
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const scrollPosition = contentOffset.y;
    const totalHeight = contentSize.height;
    const viewportHeight = layoutMeasurement.height;

    // Track whether the user is near the bottom so incoming messages can auto-scroll
    const distanceFromBottom = totalHeight - (scrollPosition + viewportHeight);
    isNearBottom.current = distanceFromBottom < 150;

    // If scrolled past 75% of content, mark all as read
    if (scrollPosition + viewportHeight > totalHeight * 0.75) {
      if (messages.length > 0) {
        const latestTimestamp = messages[messages.length - 1]?.created_at.getTime() || 0;
        if (latestTimestamp > lastReadTimestamp) {
          setLastReadTimestamp(latestTimestamp);
          ChatPreferencesService.setLastReadTimestamp(partnerEntityId, latestTimestamp);
        }
      }
    }
  }, [messages, lastReadTimestamp, partnerEntityId]);

  // Auto-scroll to bottom whenever the message list changes and the user is near the bottom.
  // This is the primary mechanism for scrolling on new incoming messages.
  // A 50 ms delay lets FlatList finish rendering the new item before we scroll.
  useEffect(() => {
    if (messages.length > 0 && isNearBottom.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [messages]);

  const renderMessage = useCallback(({ item }: { item: any }) => {
    // Render divider
    if (item.type === 'divider') {
      return <NewMessagesDivider count={item.count} theme={theme!} />;
    }
    
    // Render message
    const isOwn = item.sender_entity_id === impersonatedEntityId;
    const isLastMessage = messages.length > 0 && item.id === messages[messages.length - 1].id;
    const isTranscriptionFailed = failedTranscriptions.has(item.id);
    
    return (
      <ChatBubble
        message={item}
        isOwn={isOwn}
        isLastMessage={isLastMessage}
        isTranscriptionFailed={isTranscriptionFailed}
        partnerAvatar={!isOwn ? partnerAvatar : null}
        partnerName={partnerName}
        onImagePress={() => {
          // Navigate to full-screen image viewer
        }}
        onSendMessage={handleConfirmAndSendMessage}
        onDelete={handleDeleteMessage}
        onRegenerate={handleRegenerateMessage}
        onEdit={handleEditMessage}
        onRetryTranscription={handleRetryTranscription}
        theme={theme!}
      />
    );
  }, [messages, partnerAvatar, theme, impersonatedEntityId, failedTranscriptions, handleConfirmAndSendMessage, handleDeleteMessage, handleRegenerateMessage, handleEditMessage, handleRetryTranscription]);

  if (loading) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme?.colors.accent.primary} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Appbar.Header style={{ backgroundColor: theme?.colors.background.surface }}>
        <Appbar.BackAction 
          onPress={() => navigation.goBack()}
          color={theme?.colors.text.primary}
        />
        {partnerAvatar ? (
          <Avatar.Image size={36} source={{ uri: partnerAvatar }} style={styles.headerAvatar} />
        ) : (
          <Avatar.Text 
            size={36} 
            label={partnerName.substring(0, 2).toUpperCase()} 
            style={styles.headerAvatar}
          />
        )}
        <Appbar.Content
          title={partnerName}
          titleStyle={{ color: theme?.colors.text.primary }}
        />
        {isConnected ? (
          isDualSessionActive(partnerEntityId) ? (
            <ThemedText variant="success" size={12} style={styles.statusIndicator}>
              Connected
            </ThemedText>
          ) : (
            <ThemedText variant="muted" size={12} style={styles.statusIndicator}>
              Connecting...
            </ThemedText>
          )
        ) : (
          <ThemedText variant="muted" size={12} style={styles.statusIndicator}>
            Offline
          </ThemedText>
        )}
      </Appbar.Header>

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messagesWithDivider}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
          onContentSizeChange={() => {
            // Auto-scroll to bottom on initial load / layout changes when near the bottom
            if (isNearBottom.current) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onLayout={() => {
            // On initial layout, default isNearBottom is true so this scrolls to the end
            if (isNearBottom.current) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
        />
        
        {isTyping && (
          <TypingIndicator theme={theme} mode="text" />
        )}
        {isRecording && (
          <TypingIndicator theme={theme} mode="audio" />
        )}

        <ChatInput
          onSendText={handleSendText}
          onSendAudio={handleSendAudio}
          onSendImage={handleSendImage}
          onTypingStart={handleTypingStart}
          disabled={!isDualSessionActive(partnerEntityId)}
          theme={theme!}
        />
      </KeyboardAvoidingView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  messageList: {
    paddingVertical: 8,
  },
  headerAvatar: {
    marginRight: 8,
  },
  statusIndicator: {
    marginRight: 16,
  },
});
