import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ToastAndroid,
  Alert,
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
import { useEntitySession } from '../contexts/EntitySessionContext';
import EntitySessionService from '../services/EntitySessionService'; // Still needed for event listeners
import { getRecentChatMessages, updateChatMessage, getChatMessage } from '../database/repositories/chat_messages';
import { getPrimaryImage, getCharacterProfile, imageToDataURL } from '../database/repositories/characters';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import { createLogger } from '../utils/logger';
import { ChatMessage } from '../database/models';

const log = createLogger('[ChatDetailScreen]');

type Props = NativeStackScreenProps<RootStackParamList, 'ChatDetail'>;

export const ChatDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { partnerEntityId, partnerCharacterId, impersonatedEntityId } = route.params;
  const { theme } = useAppTheme();
  const { isConnected } = useSyncConnection();
  const { isDualSessionActive, startDualSession, stopDualSession } = useEntitySession();
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [partnerName, setPartnerName] = useState<string>('Chat');
  const [partnerAvatar, setPartnerAvatar] = useState<string | null>(null);
  
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

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

  // Load messages
  useEffect(() => {
    const loadMessages = async () => {
      try {
        setLoading(true);
        
        const existingMessages = await getRecentChatMessages(
          impersonatedEntityId,
          partnerEntityId,
          50
        );
        setMessages(existingMessages);
      } catch (error) {
        log.error('Failed to load messages:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadMessages();
  }, [partnerEntityId, impersonatedEntityId]);

  // Initialize entity session
  useEffect(() => {
    let mounted = true;
    
    const initializeSession = async () => {
      // Only start if we have an active sync connection
      if (!isConnected) {
        log.warn('Cannot start entity session: sync not connected');
        return;
      }
      
      // Check if session already exists (e.g., navigating back to chat)
      if (isDualSessionActive(partnerEntityId)) {
        log.info(`Session already active for ${partnerEntityId}`);
        return;
      }
      
      try {
        log.info(`Initializing dual session for ${partnerEntityId}...`);
        await startDualSession(partnerEntityId, impersonatedEntityId);
        // Session will be in 'connecting' state, UI will show "Connecting..."
        // When INIT_ENTITY responses arrive, UI will update to "Connected"
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
    
    // Cleanup on unmount
    return () => {
      mounted = false;
      if (isDualSessionActive(partnerEntityId)) {
        log.info(`Stopping session for ${partnerEntityId} on unmount`);
        stopDualSession(partnerEntityId);
      }
    };
  }, [partnerEntityId, impersonatedEntityId, isConnected]);

  // Listen for new messages and typing indicator
  useEffect(() => {
    const handleNewMessage = (entityId: string) => {
      if (entityId === partnerEntityId) {
        // Reload messages from database
        getRecentChatMessages(impersonatedEntityId, partnerEntityId, 50)
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
        // Reload messages to show updated transcription
        getRecentChatMessages(impersonatedEntityId, partnerEntityId, 50)
          .then(setMessages);
      }
    };
    
    EntitySessionService.on('message:received', handleNewMessage);
    EntitySessionService.on('typing:indicator', handleTyping);
    EntitySessionService.on('recording:indicator', handleRecording);
    EntitySessionService.on('transcription:completed' as any, handleTranscriptionCompleted);

    return () => {
      EntitySessionService.off('message:received', handleNewMessage);
      EntitySessionService.off('typing:indicator', handleTyping);
      EntitySessionService.off('recording:indicator', handleRecording);
      EntitySessionService.off('transcription:completed' as any, handleTranscriptionCompleted);
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
      const updatedMessages = await getRecentChatMessages(
        impersonatedEntityId,
        partnerEntityId,
        50
      );
      setMessages(updatedMessages);
    } catch (error) {
      log.error('Failed to send message:', error);
    }
  }, [partnerEntityId, impersonatedEntityId, isDualSessionActive]);

  const handleSendAudio = useCallback(async (audioData: Uint8Array, duration: number) => {
    if (!isDualSessionActive(partnerEntityId)) return;
    
    try {
      await EntitySessionService.newAudioMessage(
        partnerEntityId,
        audioData,
        'audio/wav',
        duration
      );
      
      log.info('Audio message saved, awaiting transcription...');
      
      const updatedMessages = await getRecentChatMessages(
        impersonatedEntityId,
        partnerEntityId,
        50
      );
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
      const message = await getChatMessage(messageId);
      if (!message || !message.audio_data) {
        throw new Error('Message not found or has no audio');
      }

      const base64Audio = message.audio_data; // Already base64 string

      if (finalText !== message.content) {
        await updateChatMessage(messageId, { content: finalText });
      }

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

        const updatedMessages = await getRecentChatMessages(
          impersonatedEntityId,
          partnerEntityId,
          50
        );
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
      const updatedMessages = await getRecentChatMessages(
        impersonatedEntityId,
        partnerEntityId,
        50
      );
      setMessages(updatedMessages);
    } catch (error) {
      log.error('Failed to send image:', error);
    }
  }, [partnerEntityId, isDualSessionActive]);

  const handleTypingStart = useCallback(() => {
    // Send typing indicator if session active
  }, [partnerEntityId, isDualSessionActive]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isOwn = item.sender_entity_id === impersonatedEntityId;
    
    return (
      <ChatBubble
        message={item}
        isOwn={isOwn}
        partnerAvatar={!isOwn ? partnerAvatar : null}
        onImagePress={() => {
          // Navigate to full-screen image viewer
        }}
        onSendMessage={handleConfirmAndSendMessage}
        theme={theme!}
      />
    );
  }, [partnerAvatar, theme, impersonatedEntityId, handleConfirmAndSendMessage]);

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
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
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
