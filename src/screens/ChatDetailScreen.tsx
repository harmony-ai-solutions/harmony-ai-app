import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  FlatList,
  View,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
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
import EntitySessionService from '../services/EntitySessionService';
import { getRecentChatMessages } from '../database/repositories/chat_messages';
import { getPrimaryImage, getCharacterProfile, imageToDataURL } from '../database/repositories/characters';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import { createLogger } from '../utils/logger';
import { ChatMessage } from '../database/models';

const log = createLogger('[ChatDetailScreen]');

type Props = NativeStackScreenProps<RootStackParamList, 'ChatDetail'>;

export const ChatDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { partnerEntityId, partnerCharacterId } = route.params;
  const { theme } = useAppTheme();
  const { isPaired } = useSyncConnection();
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [partnerName, setPartnerName] = useState<string>('Chat');
  const [partnerAvatar, setPartnerAvatar] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const impersonatedEntityId = 'user';

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

  // Load messages and initialize session
  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true);
        
        // Load existing messages
        const existingMessages = await getRecentChatMessages(
          impersonatedEntityId,
          partnerEntityId,
          50
        );
        setMessages(existingMessages);
        
        // Start entity session
        if (isPaired) {
          await EntitySessionService.startDualSession(partnerEntityId, impersonatedEntityId);
          setSessionActive(true);
        }
      } catch (error) {
        log.error('Failed to initialize chat:', error);
      } finally {
        setLoading(false);
      }
    };
    
    initialize();
    
    // Cleanup on unmount
    return () => {
      EntitySessionService.stopSession(partnerEntityId);
    };
  }, [partnerEntityId, isPaired]);

  // Listen for new messages
  useEffect(() => {
    const handleNewMessage = (entityId: string) => {
      if (entityId === partnerEntityId) {
        // Reload messages from database
        getRecentChatMessages(impersonatedEntityId, partnerEntityId, 50)
          .then(setMessages);
      }
    };
    
    const handleTyping = (entityId: string, senderId: string, isTypingActive: boolean) => {
      if (entityId === partnerEntityId && senderId === partnerEntityId) {
        setIsTyping(isTypingActive);
      }
    };
    
    EntitySessionService.on('message:received', handleNewMessage);
    EntitySessionService.on('typing:indicator', handleTyping);
    
    return () => {
      EntitySessionService.off('message:received', handleNewMessage);
      EntitySessionService.off('typing:indicator', handleTyping);
    };
  }, [partnerEntityId]);

  const handleSendText = useCallback(async (text: string) => {
    if (!text.trim() || !sessionActive) return;
    
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
  }, [partnerEntityId, sessionActive]);

  const handleSendAudio = useCallback(async (audioData: Uint8Array, duration: number) => {
    if (!sessionActive) return;
    
    try {
      await EntitySessionService.sendAudioMessage(
        partnerEntityId,
        audioData,
        'audio/wav',
        duration
      );
      const updatedMessages = await getRecentChatMessages(
        impersonatedEntityId,
        partnerEntityId,
        50
      );
      setMessages(updatedMessages);
    } catch (error) {
      log.error('Failed to send audio:', error);
    }
  }, [partnerEntityId, sessionActive]);

  const handleSendImage = useCallback(async (imageBase64: string, mimeType: string, caption?: string) => {
    if (!sessionActive) return;
    
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
  }, [partnerEntityId, sessionActive]);

  const handleTypingStart = useCallback(() => {
    // Send typing indicator if session active
  }, [sessionActive]);

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
        theme={theme!}
      />
    );
  }, [partnerAvatar, theme]);

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
        {!sessionActive && (
          <ThemedText variant="muted" size={12} style={styles.offlineIndicator}>
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
        
        {isTyping && <TypingIndicator theme={theme} />}
        
        <ChatInput
          onSendText={handleSendText}
          onSendAudio={handleSendAudio}
          onSendImage={handleSendImage}
          onTypingStart={handleTypingStart}
          disabled={!sessionActive}
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
  offlineIndicator: {
    marginRight: 16,
  },
});
