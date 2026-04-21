import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
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
  TouchableOpacity,
  Modal,
  View,
  TouchableWithoutFeedback,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Appbar, Avatar } from 'react-native-paper';
import { ThemedAppbar } from '../components/themed/ThemedAppbar';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
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
import {
  getRecentConversationMessages,
  updateConversationMessage,
  getConversationMessage,
  deleteConversationMessage,
} from '../database/repositories/conversation_messages';
import {
  getPrimaryImage,
  getCharacterProfile,
  imageToDataURL,
} from '../database/repositories/characters';
import { deleteEntity } from '../database/repositories/entities';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { createLogger } from '../utils/logger';
import { ConversationMessage } from '../database/models';

const log = createLogger('[ChatDetailScreen]');

type Props = NativeStackScreenProps<RootStackParamList, 'ChatDetail'>;

export const ChatDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { partnerEntityId, partnerCharacterId, impersonatedEntityId } =
    route.params;
  const { theme } = useAppTheme();
  const { isConnected } = useSyncConnection();
  const { isDualSessionActive, startDualSession, stopDualSession } =
    useEntitySession();

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [partnerName, setPartnerName] = useState<string>('Chat');
  const [partnerAvatar, setPartnerAvatar] = useState<string | null>(null);
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(0);
  const [failedTranscriptions, setFailedTranscriptions] = useState<Set<string>>(
    new Set(),
  );

  const flatListRef = useRef<FlatList<any>>(null);
  // NEW ref — frozen at mount, used only for divider computation
  const sessionDividerTimestamp = useRef<number>(0);
  // NEW ref — guards one-shot initial scroll
  const isInitialScrollDone = useRef(false);
  // Tracks whether the user is near the bottom of the list; used to decide whether to auto-scroll on new messages
  const isNearBottom = useRef(true);
  // NEW state — FAB visibility
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  // Controls whether the chat content is revealed; stays false until the initial
  // scroll position has been committed so the user never sees intermediate states.
  const [isReadyToShow, setIsReadyToShow] = useState(false);
  // Ref mirror of isReadyToShow — readable synchronously inside effects/callbacks
  // without closure staleness. Used to gate subsequent-message auto-scrolls so
  // that any setMessages calls during the hidden window don't cause visible jumps.
  const isReadyToShowRef = useRef(false);
  // Snapshot of messages.length at the moment the chat is revealed. onContentSizeChange
  // uses this to distinguish FlatList's initial batch-render passes (same count) from
  // a genuinely new incoming message (count exceeds snapshot). Without this guard the
  // list animates to the bottom multiple times during its first render batch.
  const messagesCountAtReveal = useRef(0);
  // Set to true when the user sends their own message (text, audio, image, edit,
  // regenerate, transcription). The next onContentSizeChange will auto-scroll to
  // the bottom and then clear this ref. Partner messages never set this ref, so
  // the divider remains visible until the user manually scrolls down.
  const pendingOwnMessageScroll = useRef(false);
  // Stable ref to the loaded messages array — used in the initial scroll effect and scroll
  // handlers to save the latest read timestamp without relying on closed-over state that
  // may be stale. Always kept in sync with the `messages` state.
  const loadedMessagesRef = useRef<ConversationMessage[]>([]);
  // Stable ref to lastReadTimestamp — same reason: avoids stale closures in scroll handlers.
  const lastReadTimestampRef = useRef<number>(0);
  // Controls visibility of the new-messages divider. Set to false when the user
  // scrolls to the bottom of the list (they've now seen all new messages).
  const [showDivider, setShowDivider] = useState(true);
  // Entity context menu visibility
  const [menuVisible, setMenuVisible] = useState(false);

  // Load partner info (avatar, name)
  useEffect(() => {
    const loadPartnerInfo = async () => {
      // Always set the entity ID as fallback first
      setPartnerName(partnerEntityId);

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
  }, [partnerCharacterId, partnerEntityId]);

  // Load messages and last-read timestamp
  useEffect(() => {
    const loadMessagesAndTimestamp = async () => {
      try {
        setLoading(true);

        const existingMessages = await getRecentConversationMessages(
          impersonatedEntityId,
          partnerEntityId,
          50,
        );
        setMessages(existingMessages);
        // Keep ref in sync so scroll handlers always see the latest messages.
        loadedMessagesRef.current = existingMessages;

        // Detect stuck transcriptions (messages with audio but no text that aren't actively transcribing)
        const stuckTranscriptions = existingMessages
          .filter(
            msg =>
              msg.audio_data &&
              msg.audio_data.length > 0 &&
              (!msg.content || msg.content.trim().length === 0) &&
              msg.sender_entity_id === impersonatedEntityId, // Only user's own messages
          )
          .map(msg => msg.id);

        if (stuckTranscriptions.length > 0) {
          log.info(
            `Found ${stuckTranscriptions.length} stuck transcriptions on load`,
          );
          setFailedTranscriptions(new Set(stuckTranscriptions));
        }

        const timestamp =
          await ChatPreferencesService.getLastReadTimestamp(partnerEntityId);
        setLastReadTimestamp(timestamp);
        lastReadTimestampRef.current = timestamp;
        sessionDividerTimestamp.current = timestamp; // freeze for this session
      } catch (error) {
        log.error('Failed to load messages:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMessagesAndTimestamp();
  }, [partnerEntityId, impersonatedEntityId]);

  // Keep stable refs in sync with state so scroll handlers never see stale values
  // (avoids stale-closure bugs when useCallback deps change between renders).
  useEffect(() => {
    loadedMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    lastReadTimestampRef.current = lastReadTimestamp;
  }, [lastReadTimestamp]);

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
            ToastAndroid.LONG,
          );
        } else {
          Alert.alert(
            'Connection Error',
            `Could not establish chat session: ${errorMessage}`,
            [{ text: 'OK' }],
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
        getRecentConversationMessages(
          impersonatedEntityId,
          partnerEntityId,
          50,
        ).then(setMessages);
      }
    };

    const handleTyping = (
      entityId: string,
      senderId: string,
      isTypingActive: boolean,
    ) => {
      if (
        entityId === partnerEntityId &&
        (senderId === partnerEntityId || senderId === '')
      ) {
        setIsTyping(isTypingActive);
        if (isTypingActive) setIsRecording(false);
      }
    };

    const handleRecording = (
      entityId: string,
      senderId: string,
      isRecordingActive: boolean,
    ) => {
      if (
        entityId === partnerEntityId &&
        (senderId === partnerEntityId || senderId === '')
      ) {
        setIsRecording(isRecordingActive);
        if (isRecordingActive) setIsTyping(false);
      }
    };

    // Cleanup indicators when session becomes inactive
    if (!isDualSessionActive(partnerEntityId)) {
      setIsTyping(false);
      setIsRecording(false);
    }

    const handleTranscriptionCompleted = (
      entityId: string,
      messageId: string,
      text: string,
    ) => {
      if (entityId === partnerEntityId) {
        log.info(`Transcription completed for message ${messageId}: "${text}"`);
        // Remove from failed set if it was there
        setFailedTranscriptions(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
        // Reload messages to show updated transcription and scroll to it
        getRecentConversationMessages(
          impersonatedEntityId,
          partnerEntityId,
          50,
        ).then(updatedMessages => {
          // Transcription completion updates the user's own message — always scroll to it
          pendingOwnMessageScroll.current = true;
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
        getRecentConversationMessages(
          impersonatedEntityId,
          partnerEntityId,
          50,
        ).then(setMessages);
      }
    };

    const handleIncomingMessageEdit = (entityId: string) => {
      if (entityId === partnerEntityId) {
        // Reload messages from database to show the updated content
        getRecentConversationMessages(
          impersonatedEntityId,
          partnerEntityId,
          50,
        ).then(setMessages);
      }
    };

    EntitySessionService.on('message:received', handleNewMessage);
    EntitySessionService.on('message:edited', handleIncomingMessageEdit);
    EntitySessionService.on('typing:indicator', handleTyping);
    EntitySessionService.on('recording:indicator', handleRecording);
    EntitySessionService.on(
      'transcription:completed',
      handleTranscriptionCompleted,
    );
    EntitySessionService.on('transcription:failed', handleTranscriptionFailed);

    return () => {
      EntitySessionService.off('message:received', handleNewMessage);
      EntitySessionService.off('message:edited', handleIncomingMessageEdit);
      EntitySessionService.off('typing:indicator', handleTyping);
      EntitySessionService.off('recording:indicator', handleRecording);
      EntitySessionService.off(
        'transcription:completed',
        handleTranscriptionCompleted,
      );
      EntitySessionService.off(
        'transcription:failed',
        handleTranscriptionFailed,
      );
    };
  }, [partnerEntityId, impersonatedEntityId]);

  // Listen for session errors
  useEffect(() => {
    const handleSessionError = (errorPartnerId: string, error: string) => {
      if (errorPartnerId === partnerEntityId) {
        log.error(`Session error for ${partnerEntityId}:`, error);

        if (Platform.OS === 'android') {
          ToastAndroid.show(`Chat session error: ${error}`, ToastAndroid.LONG);
        } else {
          Alert.alert('Session Error', error, [{ text: 'OK' }]);
        }
      }
    };

    EntitySessionService.on('session:error', handleSessionError);

    return () => {
      EntitySessionService.off('session:error', handleSessionError);
    };
  }, [partnerEntityId]);

  const handleSendText = useCallback(
    async (text: string) => {
      if (!text.trim() || !isDualSessionActive(partnerEntityId)) {
        log.warn('Cannot send message: session not active');
        return;
      }

      try {
        await EntitySessionService.sendTextMessage(
          partnerEntityId,
          text.trim(),
        );
        // Optimistically reload from database
        const updatedMessages = await getRecentConversationMessages(
          impersonatedEntityId,
          partnerEntityId,
          50,
        );
        // Always scroll to the message the user just sent
        pendingOwnMessageScroll.current = true;
        setMessages(updatedMessages);
      } catch (error) {
        log.error('Failed to send message:', error);
      }
    },
    [partnerEntityId, impersonatedEntityId, isDualSessionActive],
  );

  const handleSendAudio = useCallback(
    async (audioData: string, duration: number) => {
      if (!isDualSessionActive(partnerEntityId)) return;

      try {
        await EntitySessionService.newAudioMessage(
          partnerEntityId,
          audioData,
          'audio/wav',
          duration,
        );

        log.info('Audio message saved, awaiting transcription...');

        const updatedMessages = await getRecentConversationMessages(
          impersonatedEntityId,
          partnerEntityId,
          50,
        );
        // Always scroll to the message the user just sent
        pendingOwnMessageScroll.current = true;
        setMessages(updatedMessages);
      } catch (error) {
        log.error('Failed to save audio message:', error);
      }
    },
    [partnerEntityId, impersonatedEntityId, isDualSessionActive],
  );

  const handleConfirmAndSendMessage = useCallback(
    async (messageId: string, finalText: string) => {
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
            message_id: messageId,
          };

          await EntitySessionService.sendUtterance(
            dualSession.partnerSession.connectionId,
            utterance,
          );

          log.info(`Message ${messageId} sent to partner entity`);

          const updatedMessages = await getRecentConversationMessages(
            impersonatedEntityId,
            partnerEntityId,
            50,
          );
          // Always scroll to the message the user just sent
          pendingOwnMessageScroll.current = true;
          setMessages(updatedMessages);
        }
      } catch (error: any) {
        log.error('Failed to send message:', error);
        if (Platform.OS === 'android') {
          ToastAndroid.show(
            `Failed to send: ${error.message}`,
            ToastAndroid.LONG,
          );
        } else {
          Alert.alert('Error', `Failed to send message: ${error.message}`);
        }
      }
    },
    [partnerEntityId, impersonatedEntityId, isDualSessionActive],
  );

  const handleSendImage = useCallback(
    async (imageBase64: string, mimeType: string, caption?: string) => {
      if (!isDualSessionActive(partnerEntityId)) return;

      try {
        await EntitySessionService.sendImageMessage(
          partnerEntityId,
          imageBase64,
          mimeType,
          caption,
        );
        const updatedMessages = await getRecentConversationMessages(
          impersonatedEntityId,
          partnerEntityId,
          50,
        );
        // Always scroll to the message the user just sent
        pendingOwnMessageScroll.current = true;
        setMessages(updatedMessages);
      } catch (error) {
        log.error('Failed to send image:', error);
      }
    },
    [partnerEntityId, isDualSessionActive],
  );

  const handleTypingStart = useCallback(() => {
    // Send typing indicator if session active
  }, [partnerEntityId, isDualSessionActive]);

  // Delete message handler
  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
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
                  50,
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
        ],
      );
    },
    [impersonatedEntityId, partnerEntityId],
  );

  // Regenerate message handler (for partner's last message)
  const handleRegenerateMessage = useCallback(
    async (messageId: string) => {
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
                const userMessages = messages.filter(
                  m => m.sender_entity_id === impersonatedEntityId,
                );
                if (userMessages.length === 0) {
                  throw new Error('No previous message to regenerate from');
                }

                const lastUserMessage = userMessages[userMessages.length - 1];

                // Delete the old user message record - sendTextMessage will re-create it with
                // the current session_id, preventing duplication when the session was restarted
                await deleteConversationMessage(lastUserMessage.id);

                // Resend the user's last message
                await EntitySessionService.sendTextMessage(
                  partnerEntityId,
                  lastUserMessage.content,
                );

                // Reload messages
                const updatedMessages = await getRecentConversationMessages(
                  impersonatedEntityId,
                  partnerEntityId,
                  50,
                );
                // Always scroll to the re-sent user message
                pendingOwnMessageScroll.current = true;
                setMessages(updatedMessages);

                if (Platform.OS === 'android') {
                  ToastAndroid.show(
                    'Regenerating response...',
                    ToastAndroid.SHORT,
                  );
                }
              } catch (error: any) {
                log.error('Failed to regenerate:', error);
                if (Platform.OS === 'android') {
                  ToastAndroid.show(
                    `Failed: ${error.message}`,
                    ToastAndroid.LONG,
                  );
                } else {
                  Alert.alert('Error', error.message);
                }
              }
            },
          },
        ],
      );
    },
    [messages, impersonatedEntityId, partnerEntityId],
  );

  // Edit message handler (for user's last message)
  const handleEditMessage = useCallback(
    async (messageId: string, newText: string) => {
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
                await updateConversationMessage(messageId, {
                  content: newText,
                });

                // Get the message to check if it has audio
                const message = await getConversationMessage(messageId);
                if (!message) {
                  throw new Error('Message not found');
                }

                // Resend with new text
                await EntitySessionService.sendTextMessage(
                  partnerEntityId,
                  newText,
                );

                // Reload messages
                const updatedMessages = await getRecentConversationMessages(
                  impersonatedEntityId,
                  partnerEntityId,
                  50,
                );
                setMessages(updatedMessages);

                if (Platform.OS === 'android') {
                  ToastAndroid.show(
                    'Message updated and sent',
                    ToastAndroid.SHORT,
                  );
                }
              } catch (error: any) {
                log.error('Failed to edit message:', error);
                if (Platform.OS === 'android') {
                  ToastAndroid.show(
                    `Failed: ${error.message}`,
                    ToastAndroid.LONG,
                  );
                } else {
                  Alert.alert('Error', error.message);
                }
              }
            },
          },
        ],
      );
    },
    [impersonatedEntityId, partnerEntityId],
  );

  const handleRetryTranscription = useCallback(
    async (messageId: string) => {
      try {
        // Remove from failed set optimistically
        setFailedTranscriptions(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });

        await EntitySessionService.retryTranscription(
          messageId,
          partnerEntityId,
        );

        if (Platform.OS === 'android') {
          ToastAndroid.show('Retrying transcription...', ToastAndroid.SHORT);
        }
      } catch (error: any) {
        log.error('Failed to retry transcription:', error);

        // Add back to failed set
        setFailedTranscriptions(prev => new Set(prev).add(messageId));

        if (Platform.OS === 'android') {
          ToastAndroid.show(
            `Retry failed: ${error.message}`,
            ToastAndroid.LONG,
          );
        } else {
          Alert.alert('Retry Failed', error.message);
        }
      }
    },
    [partnerEntityId],
  );

  // ── Entity context menu (AppBar ⋮ button) ───────────────────────────────────
  const handleEntityContextMenu = useCallback(() => {
    setMenuVisible(true);
  }, []);

  const handleDeleteEntity = useCallback(() => {
    setMenuVisible(false);
    Alert.alert(
      'Delete Entity',
      `Delete "${partnerName}"? Chat history will be preserved but this entity will no longer be accessible.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteEntity(partnerEntityId);
              navigation.navigate('ChatList');
            } catch (err: any) {
              Alert.alert(
                'Error',
                err?.message ?? 'Failed to delete entity.',
              );
            }
          },
        },
      ],
    );
  }, [partnerEntityId, partnerName, navigation]);

  const handleEntitySettings = useCallback(() => {
    setMenuVisible(false);
    navigation.navigate('EntityConfigEdit', { entityId: partnerEntityId });
  }, [partnerEntityId, navigation]);

  // Calculate messages with divider AND compute the initial scroll target in one pass.
  // The scroll target MUST be computed synchronously during render (not in a useEffect)
  // because onContentSizeChange fires before any effects run and needs the value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { messagesWithDivider, initialScrollTarget } = useMemo(() => {
    if (messages.length === 0) {
      return { messagesWithDivider: messages, initialScrollTarget: 'bottom' as const };
    }

    let withDivider: any[] = messages;

    if (sessionDividerTimestamp.current !== 0 && showDivider) { // eslint-disable-line react-hooks/exhaustive-deps
      // Only messages from the chat partner (not the user's own messages) count
      // as "new" for the purpose of the divider.
      const firstNewPartnerIndex = messages.findIndex(
        m =>
          m.created_at.getTime() > sessionDividerTimestamp.current &&
          m.sender_entity_id !== impersonatedEntityId,
      );

      if (firstNewPartnerIndex > 0) {
        const newMessageCount = messages.length - firstNewPartnerIndex;
        const result: any[] = [...messages];
        result.splice(firstNewPartnerIndex, 0, {
          id: 'new-messages-divider',
          type: 'divider',
          count: newMessageCount,
        });
        withDivider = result;
      }
    }

    // Compute where the FlatList should start — used by onContentSizeChange
    // to scroll to the correct position during the hidden initial render phase.
    const dividerIndex = withDivider.findIndex((m: any) => m.type === 'divider');
    let target: 'bottom' | number = 'bottom';
    if (dividerIndex !== -1) {
      const messagesAfterDivider = withDivider.length - dividerIndex - 1;
      if (messagesAfterDivider >= 3) {
        target = dividerIndex;
      }
    }

    return { messagesWithDivider: withDivider, initialScrollTarget: target };
  // showDivider and impersonatedEntityId ARE deps: divider visibility depends on both.
  // sessionDividerTimestamp.current is intentionally NOT a dep (frozen ref).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, showDivider, impersonatedEntityId]);

  // Sync isNearBottom when the initial scroll target changes (computed above).
  useEffect(() => {
    if (!isInitialScrollDone.current) {
      isNearBottom.current = initialScrollTarget === 'bottom';
    }
  }, [initialScrollTarget]);

  // Helper — saves the latest read timestamp using stable refs (no stale-closure risk).
  const persistMarkAsRead = useCallback(() => {
    const msgs = loadedMessagesRef.current;
    if (msgs.length === 0) return;
    const latestTimestamp = msgs[msgs.length - 1]?.created_at.getTime() || 0;
    if (latestTimestamp > lastReadTimestampRef.current) {
      lastReadTimestampRef.current = latestTimestamp;
      setLastReadTimestamp(latestTimestamp);
      ChatPreferencesService.setLastReadTimestamp(partnerEntityId, latestTimestamp);
    }
    // Only hide the divider once the content is visible to the user.
    // During the hidden initial-scroll phase, programmatic scrollToEnd also
    // triggers handleScrollEnd — we must not remove the divider then because
    // the user hasn't actually seen it yet.
    if (isReadyToShowRef.current) {
      setShowDivider(false);
    }
  }, [partnerEntityId]);

  // Capture the final scroll position accurately when a scroll animation or drag ends.
  // Uses stable refs so it never reads stale closed-over state.
  const handleScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const distanceFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);

      log.debug(`handleScrollEnd: distanceFromBottom=${distanceFromBottom.toFixed(1)}`);
      isNearBottom.current = distanceFromBottom < 150;
      setShowScrollToBottom(!isNearBottom.current);

      if (isNearBottom.current) {
        persistMarkAsRead();
      }
    },
    [persistMarkAsRead],
  );

  // Handle scroll for near-bottom tracking and mark-as-read.
  // Uses stable refs so it never reads stale closed-over state.
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const distanceFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);

      isNearBottom.current = distanceFromBottom < 150;
      setShowScrollToBottom(!isNearBottom.current);

      if (isNearBottom.current) {
        persistMarkAsRead();
      }
    },
    [persistMarkAsRead],
  );

  // NOTE: There is intentionally no "messages changed → auto-scroll" useEffect here.
  // Auto-scroll for new incoming messages is handled exclusively by onContentSizeChange
  // on the FlatList (below), gated by isReadyToShowRef.current. Having two mechanisms
  // both calling scrollToEnd caused the list to animate down multiple times per new message.

  const renderMessage = useCallback(
    ({ item }: { item: any }) => {
      // Render divider
      if (item.type === 'divider') {
        return <NewMessagesDivider count={item.count} theme={theme!} />;
      }

      // Render message
      const isOwn = item.sender_entity_id === impersonatedEntityId;
      const isLastMessage =
        messages.length > 0 && item.id === messages[messages.length - 1].id;
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
    },
    [
      messages,
      partnerAvatar,
      theme,
      impersonatedEntityId,
      failedTranscriptions,
      handleConfirmAndSendMessage,
      handleDeleteMessage,
      handleRegenerateMessage,
      handleEditMessage,
      handleRetryTranscription,
    ],
  );

  if (loading) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme?.colors.accent.primary} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {/* Loading overlay — shown between data-ready and scroll-committed so
          the user never sees the list at position 0 before it snaps to the
          correct offset. Uses the same spinner as the initial loading state. */}
      {!isReadyToShow && (
        <ThemedView style={[styles.loadingOverlay, styles.centered]} pointerEvents="none">
          <ActivityIndicator size="large" color={theme?.colors.accent.primary} />
        </ThemedView>
      )}
      <ThemedAppbar>
        <Appbar.BackAction
          onPress={() => navigation.goBack()}
          color={theme?.colors.text.primary}
        />
        {partnerAvatar ? (
          <Avatar.Image
            size={36}
            source={{ uri: partnerAvatar }}
            style={styles.headerAvatar}
          />
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
            <ThemedText
              variant="success"
              size={12}
              style={styles.statusIndicator}
            >
              Connected
            </ThemedText>
          ) : (
            <ThemedText
              variant="muted"
              size={12}
              style={styles.statusIndicator}
            >
              Connecting...
            </ThemedText>
          )
        ) : (
          <ThemedText variant="muted" size={12} style={styles.statusIndicator}>
            Offline
          </ThemedText>
        )}
        {/* Entity context menu */}
        <TouchableOpacity
          onPress={handleEntityContextMenu}
          style={styles.headerMenuButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon
            name="dots-vertical"
            size={24}
            color={theme?.colors.text.primary}
          />
        </TouchableOpacity>
      </ThemedAppbar>

      {/* ── Entity context menu (styled like SettingsMenu) ── */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setMenuVisible(false)}>
          <View style={styles.menuOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.menuShell}>
                {/* Gradient background */}
                <LinearGradient
                  colors={[
                    theme!.colors.background.elevated,
                    theme!.colors.background.surface,
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={[StyleSheet.absoluteFillObject, styles.menuGradientRadius]}
                />

                {/* Prismatic tint */}
                <LinearGradient
                  colors={[theme!.colors.accent.primary + '12', 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0.6 }}
                  style={[StyleSheet.absoluteFillObject, styles.menuGradientRadius]}
                  pointerEvents="none"
                />

                {/* Top accent stripe */}
                <LinearGradient
                  colors={[
                    theme!.colors.accent.primary + 'CC',
                    (theme!.colors.accent.secondary ?? theme!.colors.accent.primaryHover) + '66',
                    'transparent',
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.menuTopStripe}
                />

                {/* Entity Settings */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handleEntitySettings}
                  activeOpacity={0.65}
                >
                  <View
                    style={[
                      styles.menuIconBadge,
                      { backgroundColor: theme!.colors.accent.primary + '1A' },
                    ]}
                  >
                    <Icon name="cog" size={18} color={theme!.colors.accent.primary} />
                  </View>
                  <ThemedText size={15} weight="medium" style={{ flex: 1 }}>
                    Entity Settings
                  </ThemedText>
                  <Icon name="chevron-right" size={18} color={theme!.colors.text.muted} />
                </TouchableOpacity>

                {/* Separator */}
                <View
                  style={[
                    styles.menuItemSeparator,
                    { backgroundColor: theme!.colors.border.default + '44' },
                  ]}
                />

                {/* Delete Entity */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handleDeleteEntity}
                  activeOpacity={0.65}
                >
                  <View
                    style={[
                      styles.menuIconBadge,
                      { backgroundColor: theme!.colors.status.error + '1A' },
                    ]}
                  >
                    <Icon name="delete-outline" size={18} color={theme!.colors.status.error} />
                  </View>
                  <ThemedText size={15} weight="medium" style={{ flex: 1, color: theme!.colors.status.error }}>
                    Delete Entity
                  </ThemedText>
                  <Icon name="chevron-right" size={18} color={theme!.colors.text.muted} />
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <KeyboardAvoidingView
        style={[styles.content, !isReadyToShow && styles.hidden]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messagesWithDivider}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.messageList}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
          // Render all items in one pass so there are no batch-render
          // content-size updates that would shift the scroll position after
          // we call scrollToEnd. 50 matches the getRecentConversationMessages limit.
          initialNumToRender={50}
          maxToRenderPerBatch={50}
          windowSize={21}
          onScrollToIndexFailed={() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }}
          onContentSizeChange={() => {
            log.debug(`onContentSizeChange: isReadyToShow=${isReadyToShowRef.current}, initialScrollTarget=${initialScrollTarget}, isInitialScrollDone=${isInitialScrollDone.current}`);
            if (!isReadyToShowRef.current) {
              // INITIAL PHASE: FlatList is hidden. Scroll to target on every
              // content-size change (safe since user sees nothing).
              // initialScrollTarget is computed synchronously in useMemo so it's
              // always current when this callback fires.
              if (initialScrollTarget === 'bottom') {
                flatListRef.current?.scrollToEnd({ animated: false });
              } else if (typeof initialScrollTarget === 'number') {
                try {
                  flatListRef.current?.scrollToIndex({
                    index: initialScrollTarget,
                    animated: false,
                    viewPosition: 0,
                  });
                } catch {
                  flatListRef.current?.scrollToEnd({ animated: false });
                }
              }

              // Mark scroll as done on first content-size change and schedule reveal.
              // The reveal timeout also re-issues the scroll command right before
              // making content visible — this ensures the native layout has fully
              // committed before the scroll offset is set for the final time.
              if (!isInitialScrollDone.current) {
                isInitialScrollDone.current = true;
                const revealTarget = initialScrollTarget; // capture in closure
                setTimeout(() => {
                  // Re-issue scroll right before reveal to overcome any layout resets
                  log.debug(`revealTimeout: re-scrolling to target=${revealTarget}`);
                  if (revealTarget === 'bottom') {
                    flatListRef.current?.scrollToEnd({ animated: false });
                  } else if (typeof revealTarget === 'number') {
                    try {
                      flatListRef.current?.scrollToIndex({
                        index: revealTarget,
                        animated: false,
                        viewPosition: 0,
                      });
                    } catch {
                      flatListRef.current?.scrollToEnd({ animated: false });
                    }
                  }
                  messagesCountAtReveal.current = messagesWithDivider.length;
                  isReadyToShowRef.current = true;
                  setIsReadyToShow(true);
                }, 200);
              }
            } else {
              // POST-REVEAL PHASE: auto-scroll rules:
              // 1. Own messages always scroll to bottom (pendingOwnMessageScroll).
              // 2. Partner messages scroll only if user was already near the bottom
              //    (isNearBottom) — so the divider stays visible when user is reading history.
              if (messagesWithDivider.length > messagesCountAtReveal.current) {
                messagesCountAtReveal.current = messagesWithDivider.length;
                if (pendingOwnMessageScroll.current || isNearBottom.current) {
                  pendingOwnMessageScroll.current = false;
                  isNearBottom.current = true;
                  flatListRef.current?.scrollToEnd({ animated: true });
                }
              }
            }
          }}
        />

        {isTyping && <TypingIndicator theme={theme} mode="text" />}
        {isRecording && <TypingIndicator theme={theme} mode="audio" />}

        {showScrollToBottom && (
          <TouchableOpacity
            style={[
              styles.scrollToBottomButton,
              { backgroundColor: theme?.colors.accent.primary },
            ]}
            onPress={() => flatListRef.current?.scrollToEnd({ animated: true })}
            activeOpacity={0.8}
          >
            <Icon
              name="chevron-down"
              size={24}
              color={theme?.colors.background.base}
            />
          </TouchableOpacity>
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
  // Invisible during the post-load pre-scroll window
  hidden: {
    opacity: 0,
  },
  // Absolute overlay that sits on top of the hidden content while scroll is pending
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  messageList: {
    paddingVertical: 8,
  },
  headerAvatar: {
    marginRight: 8,
  },
  statusIndicator: {
    marginRight: 8,
  },
  headerMenuButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: 16,
    // Place the FAB above the ChatInput (approx 56px) plus padding.
    // Using 72 caused overlap on some devices; 80 gives comfortable clearance.
    bottom: 80,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },

  // ── Entity context menu (matches SettingsMenu styling) ──
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  menuShell: {
    width: 260,
    marginTop: 56,
    marginRight: 8,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
    overflow: 'hidden',
  },
  menuGradientRadius: {
    borderRadius: 14,
  },
  menuTopStripe: {
    height: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  menuItemSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 62,
  },
});
