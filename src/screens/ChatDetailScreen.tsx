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
  RefreshControl,
  ToastAndroid,
  NativeScrollEvent,
  NativeSyntheticEvent,
  TouchableOpacity,
  Modal,
  View,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Avatar } from 'react-native-paper';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { hapticLightPress } from '../utils/haptics';
import { ChatBubble, isPartnerMessage } from '../components/chat/ChatBubble';
import { ChatInput, ChatInputRef } from '../components/chat/ChatInput';
import { TypingIndicator } from '../components/chat/TypingIndicator';
import { NewMessagesDivider } from '../components/chat/NewMessagesDivider';
import { PersonaChangeDivider } from '../components/chat/PersonaChangeDivider';
import { EmojiPickerInline } from '../components/emoji/EmojiPickerInline';
import { AlternateGreetingSwiper, parseAlternateGreetings } from '../components/chat/AlternateGreetingSwiper';
import { EmptyChatCTA } from '../components/chat/EmptyChatCTA';
import { GreetingBubble } from '../components/chat/GreetingBubble';
import { ScenarioGeneratorSheet, ScenarioGuidedInputs } from '../components/chat/ScenarioGeneratorSheet';
import EntityEmojiActionService from '../services/EntityEmojiActionService';
import { EmojiEntry } from '../types/emoji';
import { useEntitySession } from '../contexts/EntitySessionContext';
import EntitySessionService, { InteractionSession } from '../services/EntitySessionService'; // Still needed for event listeners
import { SyncService } from '../services/SyncService';
import {
  getConversationMessagesByParticipantKey,
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
import { getAllEntities } from '../database/repositories/entities';
import { deleteEntity } from '../database/repositories/entities';
import { getPersona } from '../database/repositories/personas';
import { PersonaSwitcherModal } from '../components/modals/PersonaSwitcherModal';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { createLogger } from '../utils/logger';
import { ConversationMessage, CharacterProfile } from '../database/models';
import {
  deriveParticipantKey,
  deriveScopeFromParticipants,
} from '../database/repositories/interactions';

const log = createLogger('[ChatDetailScreen]');

// TODO: Automatic scrollback pagination — when the user scrolls near the top of the
// message list, older messages should be loaded via getConversationMessagesByParticipantKey
// with a beforeTimestamp cursor (the created_at of the oldest currently loaded message).
// The initial load and refresh calls should use the same page size, but refreshes (new message,
// edit, delete) currently replace the entire list — they need to be changed to smart-merge
// (append new, keep older pages) so the user doesn't lose already-loaded history.
// For now, this constant controls the fixed window size shown on open and refresh.
const MESSAGES_PAGE_SIZE = 200;

/**
 * Empty-chat hint gate (§1-10): show the (P1-disabled) "generate a greeting"
 * hint only when the engine told us the card has NO first_mes AND the
 * conversation has zero messages — the display mirror of the engine's
 * truly-new-chat gate ("no prior interaction with messages"). `null` means the
 * INIT_ENTITY signal hasn't arrived yet → show nothing (still loading).
 */
export function shouldShowEmptyChatHint(
  hasFirstMes: boolean | null,
  messageCount: number,
): boolean {
  return hasFirstMes === false && messageCount === 0;
}

/**
 * Replace-vs-restart gate (§2-4): GENERATE_GREETING is valid only while the
 * greeting is the only message (the engine enforces this too and returns ERROR
 * otherwise — the client then falls back to START_NEW_SCENARIO). `true` also
 * covers the truly-empty chat (FIRST custom greeting).
 */
export function shouldUseGenerateGreeting(
  messages: Pick<ConversationMessage, 'message_type'>[],
): boolean {
  return (
    messages.length === 0 ||
    (messages.length === 1 && messages[0].message_type === 'greeting')
  );
}

type Props = NativeStackScreenProps<RootStackParamList, 'ChatDetail'>;

export const ChatDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { t } = useTranslation('chatDetail');
  const {
    interactionId: routeInteractionId,
    participantKey: routeParticipantKey,
    participantIds: routeParticipantIds,
    entityId: ownEntityId,
    entityName: routeEntityName,
  } = route.params;
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { isConnected } = useSyncConnection();
  const { isSessionActive, startInteractionSession, stopInteractionSession } =
    useEntitySession();

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [partnerName, setPartnerName] = useState<string>('Chat');
  const [partnerAvatar, setPartnerAvatar] = useState<string | null>(null);
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(0);
  const [failedTranscriptions, setFailedTranscriptions] = useState<Set<string>>(
    new Set(),
  );

  // Render-only greeting support (§1-10):
  // - hasFirstMes: surfaced from the INIT_ENTITY SUCCESS payload via the
  //   InteractionSession (session:started). null until known.
  // - partnerProfile: the partner character's profile — provides
  //   alternate_greetings (authored swipes) + nickname for macro resolution.
  // - ownEntityName: the own entity's alias — {{user}} macro substitution.
  const [hasFirstMes, setHasFirstMes] = useState<boolean | null>(null);
  const [partnerProfile, setPartnerProfile] = useState<CharacterProfile | null>(null);
  const [ownEntityName, setOwnEntityName] = useState<string>('You');

  // Scenario generation (§2-4):
  // - scenarioSheetOpen: drives the ScenarioGeneratorSheet (paper Modal+Portal).
  // - greetingPreparing: in-flight generation → GreetingBubble `preparing`
  //   (GreetingShimmer + TypingIndicator). No streaming — the shimmer is the
  //   sole latency affordance.
  // - lastGuidedRef: remembers the last guided inputs so the swiper's
  //   "Generate another" reuses the same directed style (or random if the last
  //   generation was "Surprise me").
  const [scenarioSheetOpen, setScenarioSheetOpen] = useState(false);
  const [greetingPreparing, setGreetingPreparing] = useState(false);
  const lastGuidedRef = useRef<ScenarioGuidedInputs | null>(null);

  // Resolve participant info for header
  const [participantIds, setParticipantIds] = useState<string[]>(
    routeParticipantIds || [ownEntityId]
  );
  const [participantKey, setParticipantKey] = useState<string>(
    routeParticipantKey || ''
  );

  const chatInputRef = useRef<ChatInputRef>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Track the canonical interactionId — starts as temp UUIDv7 from route params,
  // updated to the server-assigned canonical ID when INIT_ENTITY response arrives.
  // Using a ref (not state) avoids re-render cascades and stale closure issues
  // in event listeners that need the current ID at callback time.
  const currentInteractionIdRef = useRef(routeInteractionId);

  const flatListRef = useRef<FlatList<any>>(null);
  const sessionDividerTimestamp = useRef<number>(0);
  const isInitialScrollDone = useRef(false);
  const isNearBottom = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isReadyToShow, setIsReadyToShow] = useState(false);
  const isReadyToShowRef = useRef(false);
  const messagesCountAtReveal = useRef(0);
  const pendingOwnMessageScroll = useRef(false);
  const loadedMessagesRef = useRef<ConversationMessage[]>([]);
  const lastReadTimestampRef = useRef<number>(0);
  const [showDivider, setShowDivider] = useState(true);
  const [menuVisible, setMenuVisible] = useState(false);
  const [personaSwitcherVisible, setPersonaSwitcherVisible] = useState(false);
  // In-chat persona switch confirmation (rendered like a date/divider row)
  const [personaChangeText, setPersonaChangeText] = useState<string | null>(null);
  const [replyMode, setReplyMode] = useState<string>('realistic');
  const replyModeRef = useRef<string>('realistic');
  const [isGroupChat, setIsGroupChat] = useState(false);
  const [headerName, setHeaderName] = useState<string>('Chat');

  // Derive participantKey if not provided (for group chats or new)
  useEffect(() => {
    if (!participantKey && participantIds.length > 0) {
      const scope = deriveScopeFromParticipants(participantIds);
      const key = deriveParticipantKey(participantIds, ownEntityId, scope);
      if (key) {
        setParticipantKey(key);
      }
    }
  }, [participantKey, participantIds, ownEntityId]);

  // Derive isGroupChat from participantIds
  useEffect(() => {
    if (participantIds.length > 2) {
      setIsGroupChat(true);
    }
  }, [participantIds]);

  // Resolve header display name and avatar per D-11
  useEffect(() => {
    const resolveHeaderName = async () => {
      // Set name from routeEntityName if provided, then CONTINUE to load avatar
      if (routeEntityName) {
        setHeaderName(routeEntityName);
        setPartnerName(routeEntityName);
        // Fall through to avatar loading below
      }

      if (isGroupChat) {
        // Group chat: show participant names inline per D-11
        const otherIds = participantIds.filter(id => id !== ownEntityId);
        const allEntities = await getAllEntities();
        const entityMap = new Map(allEntities.map(e => [e.id, e]));
        const names: string[] = [];

        for (const pid of otherIds) {
          const entity = entityMap.get(pid);
          if (entity?.character_profile_id) {
            const profile = await getCharacterProfile(entity.character_profile_id);
            if (profile) {
              names.push(profile.name);
              continue;
            }
          }
          names.push(pid);
        }

        const displayName = names.join(', ');
        if (!routeEntityName) {
          setHeaderName(displayName);
          setPartnerName(displayName);
        }

        // Set avatar from first participant
        if (otherIds.length > 0) {
          const firstEntity = entityMap.get(otherIds[0]);
          if (firstEntity?.character_profile_id) {
            const image = await getPrimaryImage(firstEntity.character_profile_id);
            if (image) {
              setPartnerAvatar(imageToDataURL(image));
            }
          }
        }
      } else {
        // Private chat: load partner info
        const otherIds = participantIds.filter(id => id !== ownEntityId);
        const partnerEntityId = otherIds[0] || '';
        if (!routeEntityName) {
          setPartnerName(partnerEntityId);
        }

        const allEntities = await getAllEntities();
        const entity = allEntities.find(e => e.id === partnerEntityId);
        if (entity?.character_profile_id) {
          const profile = await getCharacterProfile(entity.character_profile_id);
          if (profile) {
            // Partner profile — drives authored alternate-greeting swipes and
            // {{char}} macro resolution (nickname || name) for the greeting.
            setPartnerProfile(profile);
            if (!routeEntityName) {
              setPartnerName(profile.name);
              setHeaderName(profile.name);
            }
          }
          const image = await getPrimaryImage(entity.character_profile_id);
          if (image) {
            setPartnerAvatar(imageToDataURL(image));
          }
        }

        // Own entity's display name — {{user}} macro substitution in greetings.
        const own = allEntities.find(e => e.id === ownEntityId);
        if (own?.alias) {
          setOwnEntityName(own.alias);
        }
      }
    };

    resolveHeaderName();
  }, [ownEntityId, participantIds, isGroupChat, routeEntityName]);

  // Load reply mode preference using participantKey (stable across navigation).
  // routeInteractionId changes every visit (new canonical ID per session), so it
  // cannot be used as a persistence key — the mode would be "forgotten" each time.
  useEffect(() => {
    if (!participantKey) return;
    const loadReplyMode = async () => {
      const savedMode = await ChatPreferencesService.getReplyMode(participantKey);
      const mode = savedMode || 'realistic';
      setReplyMode(mode);
      replyModeRef.current = mode;
    };
    loadReplyMode();
  }, [participantKey]);

  // Load messages and last-read timestamp
  const loadMessagesAndTimestamp = useCallback(async () => {
    try {
      if (!participantKey) {
        return;
      }

      const existingMessages = await getRecentConversationMessages(
        ownEntityId,
        participantKey,
        MESSAGES_PAGE_SIZE,
      );
      setMessages(existingMessages);
      loadedMessagesRef.current = existingMessages;

      // Detect stuck transcriptions (messages with audio but no text that aren't actively transcribing)
      const stuckTranscriptions = existingMessages
        .filter(
          msg =>
            msg.audio_data &&
            msg.audio_data.length > 0 &&
            (!msg.content || msg.content.trim().length === 0) &&
            msg.sender_entity_id === ownEntityId,
        )
        .map(msg => msg.id);

      if (stuckTranscriptions.length > 0) {
        log.info(
          `Found ${stuckTranscriptions.length} stuck transcriptions on load`,
        );
        setFailedTranscriptions(new Set(stuckTranscriptions));
      }

      const timestamp =
        await ChatPreferencesService.getLastReadTimestamp(routeInteractionId);
      setLastReadTimestamp(timestamp);
      lastReadTimestampRef.current = timestamp;
      sessionDividerTimestamp.current = timestamp;

      // Fallback: if session:started fired before this screen mounted, read
      // has_first_mes straight from the live session (primary path is the
      // session:started listener below).
      const liveSession = EntitySessionService.getInteractionSession(
        currentInteractionIdRef.current,
      );
      if (liveSession?.hasFirstMes !== undefined) {
        setHasFirstMes(liveSession.hasFirstMes);
      }
    } catch (error) {
      log.error('Failed to load messages:', error);
    }
  }, [routeInteractionId, participantKey, ownEntityId]);

  // Load messages and last-read timestamp on mount
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadMessagesAndTimestamp();
      setLoading(false);
    };
    init();
  }, [loadMessagesAndTimestamp]);

  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMessagesAndTimestamp();
    setRefreshing(false);
  }, [loadMessagesAndTimestamp]);

  // Keep stable refs in sync with state
  useEffect(() => {
    loadedMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    lastReadTimestampRef.current = lastReadTimestamp;
  }, [lastReadTimestamp]);

  // Track canonical interactionId — temp UUIDv7 is replaced by server's canonical
  // ID when INIT_ENTITY response arrives. This listener updates the ref so all
  // service calls and event comparisons use the correct ID.
  useEffect(() => {
    const handleSessionStarted = (interactionId: string, session: InteractionSession) => {
      if (session.ownEntityId === ownEntityId) {
        const screenParticipants = [...participantIds].sort().join('+');
        const sessionParticipants = [...session.participantIds].sort().join('+');
        if (screenParticipants === sessionParticipants) {
          if (interactionId !== currentInteractionIdRef.current) {
            log.info(`InteractionId updated from ${currentInteractionIdRef.current} to canonical ${interactionId}`);
            currentInteractionIdRef.current = interactionId;
          }
          // Render-only greeting support (§1-10): surface has_first_mes so the
          // screen can branch synchronously (GreetingBubble vs EmptyChatCTA).
          if (session.hasFirstMes !== undefined) {
            setHasFirstMes(session.hasFirstMes);
          }
        }
      }
    };

    EntitySessionService.on('session:started', handleSessionStarted);
    return () => {
      EntitySessionService.off('session:started', handleSessionStarted);
    };
  }, [ownEntityId, participantIds]);

  // Session lifecycle – stop session only when the screen unmounts
  useEffect(() => {
    return () => {
      log.info(`Screen unmounting – stopping session for ${currentInteractionIdRef.current}`);
      stopInteractionSession(currentInteractionIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeInteractionId]);

  // Session initialization – (re)start the session when sync connection becomes available
  useEffect(() => {
    let mounted = true;

    if (!isConnected || !participantKey) {
      return;
    }

    const initializeSession = async () => {
      try {
        log.info(`Initializing interaction session for ${routeInteractionId}...`);
        // Read reply mode fresh from storage to avoid race with loadReplyMode
        // useEffect.  Uses participantKey (stable) — NOT routeInteractionId.
        const savedMode = await ChatPreferencesService.getReplyMode(participantKey);
        const mode = savedMode || 'realistic';
        setReplyMode(mode);
        replyModeRef.current = mode;
        await startInteractionSession(ownEntityId, participantIds, mode);
      } catch (error: any) {
        if (!mounted) return;

        log.error('Failed to initialize entity session:', error);

        const errorMessage = error?.message || 'Unknown error';
        if (Platform.OS === 'android') {
          ToastAndroid.show(
            `${t('common:error')}: ${errorMessage}`,
            ToastAndroid.LONG,
          );
        } else {
          showAlert(
            t('common:error'),
            `${t('common:error')}: ${errorMessage}`,
            [{ text: t('common:ok') }],
          );
        }
      }
    };

    initializeSession();

    return () => {
      mounted = false;
    };
  }, [routeInteractionId, ownEntityId, participantIds, isConnected, participantKey]);

  // Listen for new messages and typing indicator
  useEffect(() => {
    const handleNewMessage = (receivedInteractionId: string) => {
      if (receivedInteractionId === currentInteractionIdRef.current) {
        // Reload messages from database
        if (participantKey) {
          getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          ).then(setMessages);
        }
      }
    };

    const handleTyping = (
      receivedInteractionId: string,
      senderId: string,
      isTypingActive: boolean,
    ) => {
      if (
        receivedInteractionId === currentInteractionIdRef.current &&
        (senderId !== ownEntityId || senderId === '')
      ) {
        setIsTyping(isTypingActive);
        if (isTypingActive) setIsRecording(false);
      }
    };

    const handleRecording = (
      receivedInteractionId: string,
      senderId: string,
      isRecordingActive: boolean,
    ) => {
      if (
        receivedInteractionId === currentInteractionIdRef.current &&
        (senderId !== ownEntityId || senderId === '')
      ) {
        setIsRecording(isRecordingActive);
        if (isRecordingActive) setIsTyping(false);
      }
    };

    // Cleanup indicators when session becomes inactive
    if (!isSessionActive(currentInteractionIdRef.current)) {
      setIsTyping(false);
      setIsRecording(false);
    }

    const handleTranscriptionCompleted = (
      receivedInteractionId: string,
      messageId: string,
      text: string,
    ) => {
      if (receivedInteractionId === currentInteractionIdRef.current) {
        log.info(`Transcription completed for message ${messageId}: "${text}"`);
        setFailedTranscriptions(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
        if (participantKey) {
          getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          ).then(updatedMessages => {
            pendingOwnMessageScroll.current = true;
            setMessages(updatedMessages);
          });
        }
      }
    };

    const handleTranscriptionFailed = (
      receivedInteractionId: string,
      messageId: string,
    ) => {
      if (receivedInteractionId === currentInteractionIdRef.current) {
        log.warn(`Transcription failed for message ${messageId}`);
        setFailedTranscriptions(prev => new Set(prev).add(messageId));
        if (participantKey) {
          getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          ).then(setMessages);
        }
      }
    };

    const handleIncomingMessageEdit = (receivedInteractionId: string) => {
      if (receivedInteractionId === currentInteractionIdRef.current) {
        if (participantKey) {
          getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          ).then(setMessages);
        }
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
  }, [routeInteractionId, ownEntityId, participantKey]);

  // Listen for session errors
  useEffect(() => {
    const handleSessionError = (errorInteractionId: string, error: string) => {
      if (errorInteractionId === currentInteractionIdRef.current) {
        log.error(`Session error for ${currentInteractionIdRef.current}:`, error);

        if (Platform.OS === 'android') {
          ToastAndroid.show(t('chatSessionError', { error }), ToastAndroid.LONG);
        } else {
          showAlert(t('common:error'), error, [{ text: t('common:ok') }]);
        }
      }
    };

    EntitySessionService.on('session:error', handleSessionError);

    return () => {
      EntitySessionService.off('session:error', handleSessionError);
    };
  }, [routeInteractionId]);

  // Seed emoji action defaults when session becomes active
  useEffect(() => {
    if (currentInteractionIdRef.current && isSessionActive(currentInteractionIdRef.current)) {
      // Use interactionId as the key for emoji defaults
      EntityEmojiActionService.seedDefaults(currentInteractionIdRef.current).catch(err => {
        log.warn('Failed to seed emoji action defaults:', err);
      });
    }
  }, [routeInteractionId, isSessionActive]);

  const handleSendText = useCallback(
    async (text: string) => {
      if (!text.trim() || !isSessionActive(currentInteractionIdRef.current)) {
        log.warn('Cannot send message: session not active');
        return;
      }

      try {
        // Resolve emoji actions
        let sendText = text.trim();
        let additionalEffects = null;

        const resolved = await EntityEmojiActionService.resolveMessageActions(
          currentInteractionIdRef.current,
          sendText,
        );

        if (resolved.hasActions) {
          sendText = resolved.substitutedText;
          additionalEffects = resolved.effects;
          log.info(`Resolved emoji actions: ${resolved.effects.emotionEffects.length} effects`);
        }

        await EntitySessionService.sendTextMessage(
          currentInteractionIdRef.current,
          sendText,
          additionalEffects,
        );

        // Optimistically reload from database
        if (participantKey) {
          const updatedMessages = await getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          );
          pendingOwnMessageScroll.current = true;
          setMessages(updatedMessages);
        }
      } catch (error) {
        log.error('Failed to send message:', error);
      }
    },
    [routeInteractionId, ownEntityId, participantKey, isSessionActive],
  );

  const handleEmojiSelected = useCallback((emoji: EmojiEntry) => {
    chatInputRef.current?.insertEmoji(emoji.native);
  }, []);

  const handleSendAudio = useCallback(
    async (audioData: string, duration: number) => {
      if (!isSessionActive(currentInteractionIdRef.current)) return;

      try {
        await EntitySessionService.newAudioMessage(
          currentInteractionIdRef.current,
          audioData,
          'audio/wav',
          duration,
        );

        log.info('Audio message saved, awaiting transcription...');

        if (participantKey) {
          const updatedMessages = await getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          );
          pendingOwnMessageScroll.current = true;
          setMessages(updatedMessages);
        }
      } catch (error) {
        log.error('Failed to save audio message:', error);
      }
    },
    [routeInteractionId, ownEntityId, participantKey, isSessionActive],
  );

  const handleConfirmAndSendMessage = useCallback(
    async (messageId: string, finalText: string) => {
      if (!isSessionActive(currentInteractionIdRef.current)) {
        log.warn('Cannot send message: session not active');
        return;
      }

      try {
        const message = await getConversationMessage(messageId);
        if (!message || !message.audio_data) {
          throw new Error('Message not found or has no audio');
        }

        const base64Audio = message.audio_data;

        // Resolve emoji actions in the text
        let sendText = finalText;
        let additionalEffects = null;

        const resolved = await EntityEmojiActionService.resolveMessageActions(
          currentInteractionIdRef.current,
          sendText,
        );

        if (resolved.hasActions) {
          sendText = resolved.substitutedText;
          additionalEffects = resolved.effects;
        }

        // Update message with final text and change type to 'combined'
        const updates: any = { message_type: 'combined' };
        if (sendText !== message.content) {
          updates.content = sendText;
        }
        await updateConversationMessage(messageId, updates);

        // Build the combined utterance (audio + text)
        const session = EntitySessionService.getInteractionSession(currentInteractionIdRef.current);
        if (session) {
          const utterance: any = {
            entity_id: session.ownEntityId,
            content: sendText,
            type: 'UTTERANCE_COMBINED',
            audio: base64Audio,
            audio_type: message.audio_mime_type || 'audio/wav',
            audio_duration: message.audio_duration || 0,
            message_id: messageId,
          };

          if (additionalEffects) {
            utterance.additional_effects = additionalEffects;
          }

          // Send to ALL partner connections (participant-agnostic broadcast)
          await EntitySessionService.sendCombinedMessage(
            currentInteractionIdRef.current,
            utterance,
          );

          log.info(`Message ${messageId} sent for interaction ${routeInteractionId}`);

          if (participantKey) {
            const updatedMessages = await getRecentConversationMessages(
              ownEntityId,
              participantKey,
              MESSAGES_PAGE_SIZE,
            );
            pendingOwnMessageScroll.current = true;
            setMessages(updatedMessages);
          }
        }
      } catch (error: any) {
        log.error('Failed to send message:', error);
        if (Platform.OS === 'android') {
          ToastAndroid.show(
            t('failedToSend', { message: error.message }),
            ToastAndroid.LONG,
          );
        } else {
          showAlert(t('common:error'), t('common:error') + `: ${error.message}`);
        }
      }
    },
    [routeInteractionId, ownEntityId, participantKey, isSessionActive],
  );

  const handleSendImage = useCallback(
    async (imageBase64: string, mimeType: string, caption?: string) => {
      if (!isSessionActive(currentInteractionIdRef.current)) return;

      try {
        await EntitySessionService.sendImageMessage(
          currentInteractionIdRef.current,
          imageBase64,
          mimeType,
          caption,
        );
        if (participantKey) {
          const updatedMessages = await getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          );
          pendingOwnMessageScroll.current = true;
          setMessages(updatedMessages);
        }
      } catch (error) {
        log.error('Failed to send image:', error);
      }
    },
    [routeInteractionId, isSessionActive, ownEntityId, participantKey],
  );

  const handleTypingStart = useCallback(() => {
    // Send typing indicator if session active
  }, [routeInteractionId, isSessionActive]);

  // Delete message handler
  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      showAlert(
        t('deleteMessageTitle'),
        t('deleteMessageBody'),
        [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('common:delete'),
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteConversationMessage(messageId);
                if (participantKey) {
                  const updatedMessages = await getRecentConversationMessages(
                    ownEntityId,
                    participantKey,
                    MESSAGES_PAGE_SIZE,
                  );
                  setMessages(updatedMessages);
                }

                if (Platform.OS === 'android') {
                  ToastAndroid.show(t('toastMessageDeleted'), ToastAndroid.SHORT);
                }
              } catch (error) {
                log.error('Failed to delete message:', error);
              }
            },
          },
        ],
      );
    },
    [ownEntityId, participantKey],
  );

  // Regenerate message handler
  const handleRegenerateMessage = useCallback(
    async (messageId: string) => {
      showAlert(
        t('regenerateTitle'),
        t('regenerateBody'),
        [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('regenerateButton'),
            onPress: async () => {
              try {
                await deleteConversationMessage(messageId);

                const userMessages = messages.filter(
                  m => m.sender_entity_id === ownEntityId,
                );
                if (userMessages.length === 0) {
                  throw new Error('No previous message to regenerate from');
                }

                const lastUserMessage = userMessages[userMessages.length - 1];

                await deleteConversationMessage(lastUserMessage.id);

                await EntitySessionService.sendTextMessage(
                  currentInteractionIdRef.current,
                  lastUserMessage.content,
                );

                if (participantKey) {
                  const updatedMessages = await getRecentConversationMessages(
                    ownEntityId,
                    participantKey,
                    MESSAGES_PAGE_SIZE,
                  );
                  pendingOwnMessageScroll.current = true;
                  setMessages(updatedMessages);
                }

                if (Platform.OS === 'android') {
                  ToastAndroid.show(
                    t('toastRegenerating'),
                    ToastAndroid.SHORT,
                  );
                }
              } catch (error: any) {
                log.error('Failed to regenerate:', error);
                if (Platform.OS === 'android') {
                  ToastAndroid.show(
                    t('toastFailed', { message: error.message }),
                    ToastAndroid.LONG,
                  );
                } else {
                  showAlert(t('errorTitle'), error.message);
                }
              }
            },
          },
        ],
      );
    },
    [messages, ownEntityId, currentInteractionIdRef, participantKey],
  );

  // Edit message handler
  const handleEditMessage = useCallback(
    async (messageId: string, newText: string) => {
      showAlert(
        t('editResendTitle'),
        t('editResendBody'),
        [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('edit'),
            onPress: async () => {
              try {
                // Soft-delete the original so only the replacement appears
                await deleteConversationMessage(messageId);

                await EntitySessionService.sendTextMessage(
                  currentInteractionIdRef.current,
                  newText,
                );

                if (participantKey) {
                  const updatedMessages = await getRecentConversationMessages(
                    ownEntityId,
                    participantKey,
                    MESSAGES_PAGE_SIZE,
                  );
                  setMessages(updatedMessages);
                }

                if (Platform.OS === 'android') {
                  ToastAndroid.show(
                    t('toastMessageUpdated'),
                    ToastAndroid.SHORT,
                  );
                }
              } catch (error: any) {
                log.error('Failed to edit message:', error);
                if (Platform.OS === 'android') {
                  ToastAndroid.show(
                    t('toastFailed', { message: error.message }),
                    ToastAndroid.LONG,
                  );
                } else {
                  showAlert(t('errorTitle'), error.message);
                }
              }
            },
          },
        ],
      );
    },
    [ownEntityId, routeInteractionId, participantKey],
  );

  const handleRetryTranscription = useCallback(
    async (messageId: string) => {
      try {
        setFailedTranscriptions(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });

        await EntitySessionService.retryTranscription(
          messageId,
          currentInteractionIdRef.current,
        );

        if (Platform.OS === 'android') {
          ToastAndroid.show(t('toastRetryingTranscription'), ToastAndroid.SHORT);
        }
      } catch (error: any) {
        log.error('Failed to retry transcription:', error);
        setFailedTranscriptions(prev => new Set(prev).add(messageId));

        if (Platform.OS === 'android') {
          ToastAndroid.show(
            t('toastRetryFailed', { message: error.message }),
            ToastAndroid.LONG,
          );
        } else {
          showAlert(t('retryFailedTitle'), error.message);
        }
      }
    },
    [routeInteractionId],
  );

  // Entity context menu
  const handleEntityContextMenu = useCallback(() => {
    setMenuVisible(true);
  }, []);

  const handleDeleteEntity = useCallback(() => {
    setMenuVisible(false);
    // For the delete entity flow, we need the partner entity ID from participantIds
    const otherIds = participantIds.filter(id => id !== ownEntityId);
    const partnerEntityId = otherIds[0] || '';
    showAlert(
      t('deleteEntityTitle'),
      t('deleteEntityBody', { name: headerName }),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('common:delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteEntity(partnerEntityId);
              navigation.navigate('MainTabs');
            } catch (err: any) {
              showAlert(
                t('common:error'),
                err?.message ?? t('common:error'),
              );
            }
          },
        },
      ],
    );
  }, [ownEntityId, participantIds, headerName, navigation]);

  // Open the persona switcher (the "My Personas" role in this chat). Personas
  // are the ONLY identities the user can chat as; switching the active persona
  // persists the global preference and shows a confirmation in the chat.
  const handleOpenPersonaSwitcher = useCallback(() => {
    setMenuVisible(false);
    setPersonaSwitcherVisible(true);
  }, []);

  // Switch the active persona for this chat ('user' = chat as own profile).
  // Persists the global preference and renders an in-chat divider
  // ("Now chatting as X") matching the app's divider/date-row design language.
  const handleSwitchPersona = useCallback(
    async (personaId: string) => {
      setPersonaSwitcherVisible(false);
      try {
        if (personaId === 'user') {
          // Chat as my own profile — clear the stored persona preference.
          await ChatPreferencesService.setGlobalImpersonatedEntity('user');
          setPersonaChangeText(t('personaChangedUser'));
          return;
        }

        const persona = await getPersona(personaId);
        await ChatPreferencesService.setGlobalImpersonatedEntity(personaId);

        setPersonaChangeText(t('personaChanged', { name: persona?.name ?? personaId }));
      } catch (err) {
        log.error('Failed to switch persona:', err);
      }
    },
    [t],
  );

  // Open settings/module configuration for the OTHER participant
  // (partner/character) in this chat.
  const handlePartnerSettings = useCallback(() => {
    setMenuVisible(false);
    // For entity settings, we need the partner entity ID
    const otherIds = participantIds.filter(id => id !== ownEntityId);
    const partnerEntityId = otherIds[0] || '';
    if (partnerEntityId) {
      navigation.navigate('EntityConfigEdit', { entityId: partnerEntityId });
    }
  }, [ownEntityId, participantIds, navigation]);

  const handleToggleReplyMode = useCallback(async () => {
    const newMode = replyMode === 'realistic' ? 'instant' : 'realistic';
    setReplyMode(newMode);

    // Persist locally using participantKey (stable across navigations)
    await ChatPreferencesService.setReplyMode(participantKey, newMode);
    replyModeRef.current = newMode;

    // Send to Harmony Link if session is active
    if (isSessionActive(currentInteractionIdRef.current)) {
      try {
        await EntitySessionService.setReplyMode(currentInteractionIdRef.current, newMode);
      } catch (error) {
        log.error('Failed to send reply mode update:', error);
      }
    }
  }, [replyMode, participantKey, isSessionActive]);

  // Calculate messages with divider AND compute the initial scroll target
  const { messagesWithDivider, initialScrollTarget } = useMemo(() => {
    if (messages.length === 0 && !personaChangeText) {
      return { messagesWithDivider: messages, initialScrollTarget: 'bottom' as const };
    }

    let withDivider: any[] = messages;

    if (sessionDividerTimestamp.current !== 0 && showDivider) {
      const firstNewPartnerIndex = messages.findIndex(
        m =>
          m.created_at.getTime() > sessionDividerTimestamp.current &&
          m.sender_entity_id !== ownEntityId,
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

    // Append the in-chat persona-switch confirmation at the very bottom
    // (rendered like a date/divider row, matching the chat's divider rhythm).
    if (personaChangeText) {
      withDivider = [
        ...withDivider,
        {
          id: 'persona-change-divider',
          type: 'personaChange',
          personaName: personaChangeText,
        },
      ];
    }

    const dividerIndex = withDivider.findIndex(
      (m: any) => m.type === 'divider' || m.type === 'personaChange',
    );
    let target: 'bottom' | number = 'bottom';
    if (dividerIndex !== -1) {
      const messagesAfterDivider = withDivider.length - dividerIndex - 1;
      if (messagesAfterDivider >= 3) {
        target = dividerIndex;
      }
    }

    return { messagesWithDivider: withDivider, initialScrollTarget: target };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, showDivider, ownEntityId, personaChangeText]);

  useEffect(() => {
    if (!isInitialScrollDone.current) {
      isNearBottom.current = initialScrollTarget === 'bottom';
    }
  }, [initialScrollTarget]);

  const persistMarkAsRead = useCallback(() => {
    const msgs = loadedMessagesRef.current;
    if (msgs.length === 0) return;
    const latestTimestamp = msgs[msgs.length - 1]?.created_at.getTime() || 0;
    if (latestTimestamp > lastReadTimestampRef.current) {
      lastReadTimestampRef.current = latestTimestamp;
      setLastReadTimestamp(latestTimestamp);
      ChatPreferencesService.setLastReadTimestamp(routeInteractionId, latestTimestamp);
    }
    if (isReadyToShowRef.current) {
      setShowDivider(false);
    }
  }, [routeInteractionId]);

  const handleScrollEnd = useCallback(
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

  // ✨ Scenario trigger (§2-4): P1 left the composer ✨ icon + ✨ pill PRESENT
  // but DISABLED. Opening the sheet is now wired (the sheet's Generate →
  // onGenerate → runScenarioGeneration dispatches the engine event).
  const openScenarioSheet = useCallback(() => {
    setScenarioSheetOpen(true);
  }, []);

  const closeScenarioSheet = useCallback(() => {
    setScenarioSheetOpen(false);
  }, []);

  const showGenerateFailed = useCallback(() => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(t('scenario:generateFailedBackend'), ToastAndroid.LONG);
    } else {
      showAlert(t('scenario:title'), t('scenario:generateFailedBackend'), [
        { text: t('common:ok') },
      ]);
    }
  }, [t, showAlert]);

  /** Dispatch GENERATE_GREETING (replace path) — shared by the sheet's
   *  replace branch and the swiper's "Generate another" slot. */
  const performGenerateGreeting = useCallback(
    async (guided: ScenarioGuidedInputs | null) => {
      const partnerEntityId = participantIds.find(id => id !== ownEntityId);
      if (!partnerEntityId) return;

      const mode = guided ? ('directed' as const) : ('random' as const);

      setGreetingPreparing(true);
      try {
        await EntitySessionService.generateGreeting({
          entityId: partnerEntityId,
          targetEntityId: ownEntityId,
          interactionId: currentInteractionIdRef.current,
          mode,
          ...(guided ? { guided } : {}),
        });

        // Reload so the (new/updated) greeting message renders — the engine
        // delivers it via the message/sync path; this is a belt-and-braces
        // refresh on top of the message:received listener.
        if (participantKey) {
          const updatedMessages = await getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          );
          setMessages(updatedMessages);
          loadedMessagesRef.current = updatedMessages;
        }
      } catch (error) {
        log.error('Greeting generation failed:', error);
        // Non-blocking toast/alert — chat stays as-is (no fabrication).
        showGenerateFailed();
      } finally {
        setGreetingPreparing(false);
      }
    },
    [participantIds, ownEntityId, participantKey, showGenerateFailed],
  );

  /** Restart path — START_NEW_SCENARIO with interaction-id swap + blocking sync. */
  const performScenarioRestart = useCallback(
    async (guided: ScenarioGuidedInputs | null) => {
      const partnerEntityId = participantIds.find(id => id !== ownEntityId);
      if (!partnerEntityId) return;

      const mode = guided ? ('directed' as const) : ('random' as const);

      setGreetingPreparing(true);
      try {
        const result = await EntitySessionService.startNewScenario({
          entityId: partnerEntityId,
          targetEntityId: ownEntityId,
          mode,
          ...(guided ? { guided } : {}),
        });

        // Swap the active interactionId to the brand-new interaction, then run
        // a blocking sync to fetch the new interaction + its first message
        // before unblocking (the chat re-renders the fresh scenario).
        if (result.interactionId && result.interactionId !== currentInteractionIdRef.current) {
          log.info(
            `Scenario restart: swapping interaction ${currentInteractionIdRef.current} → ${result.interactionId}`,
          );
          currentInteractionIdRef.current = result.interactionId;
        }
        setHasFirstMes(true);

        await SyncService.getInstance()
          .syncAndWait()
          .catch(err => {
            log.warn('Scenario restart sync failed (best-effort):', err);
          });

        if (participantKey) {
          const updatedMessages = await getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          );
          setMessages(updatedMessages);
          loadedMessagesRef.current = updatedMessages;
        }
      } catch (error) {
        log.error('Scenario restart failed:', error);
        showGenerateFailed();
      } finally {
        setGreetingPreparing(false);
      }
    },
    [participantIds, ownEntityId, participantKey, showGenerateFailed],
  );

  /** Replace-vs-restart dispatch selection (based on message count). */
  const runScenarioGeneration = useCallback(
    async (guided: ScenarioGuidedInputs | null) => {
      if (shouldUseGenerateGreeting(messages)) {
        await performGenerateGreeting(guided);
      } else {
        await performScenarioRestart(guided);
      }
    },
    [messages, performGenerateGreeting, performScenarioRestart],
  );

  const handleScenarioGenerate = useCallback(
    async (guided: ScenarioGuidedInputs | null) => {
      lastGuidedRef.current = guided;
      setScenarioSheetOpen(false); // Generate collapses the sheet
      await runScenarioGeneration(guided);
    },
    [runScenarioGeneration],
  );

  /** Regenerate swipe — "Generate another" in the AlternateGreetingSwiper slot. */
  const handleRegenerateGreeting = useCallback(async () => {
    if (greetingPreparing) return;
    await performGenerateGreeting(lastGuidedRef.current);
  }, [greetingPreparing, performGenerateGreeting]);

  // The regenerate slot is only shown while the greeting is still the only
  // message (GENERATE_GREETING gate — the engine enforces this too).
  const canRegenerateGreeting = useMemo(
    () => shouldUseGenerateGreeting(messages),
    [messages],
  );

  // Render-only greeting support (§1-10): the engine delivers the authored
  // first_mes as a normal message_type="greeting" PARTNER message. For a
  // truly-new chat it is the FIRST message in the conversation — wrap it in
  // the authored AlternateGreetingSwiper (first_mes + alternate_greetings from
  // the profile JSON column). No local first_mes, no optimistic placeholder,
  // no reconciliation.
  const { greetingMessage, isGreetingOpening } = useMemo(() => {
    const idx = messages.findIndex(
      m => m.message_type === 'greeting' && isPartnerMessage(m, ownEntityId),
    );
    const found = idx === -1 ? null : messages[idx];
    return {
      greetingMessage: found,
      isGreetingOpening: found !== null && messages[0]?.id === found.id,
    };
  }, [messages, ownEntityId]);

  // Authored swipes: [delivered first_mes, ...alternate_greetings (JSON)].
  // Each swipe is macro-resolved for display inside GreetingBubble.
  const greetingSwipes = useMemo(() => {
    if (!greetingMessage) return [];
    const alternates = parseAlternateGreetings(partnerProfile?.alternate_greetings);
    return [greetingMessage.content, ...alternates].filter(
      g => g && g.trim().length > 0,
    );
  }, [greetingMessage, partnerProfile]);

  // {{char}} → profile nickname || name; {{user}} → own entity alias.
  const charName = partnerProfile?.nickname || partnerProfile?.name || partnerName;

  const renderMessage = useCallback(
    ({ item }: { item: any }) => {
      if (item.type === 'divider') {
        return <NewMessagesDivider count={item.count} theme={theme!} />;
      }
      if (item.type === 'personaChange') {
        return <PersonaChangeDivider personaName={item.personaName} theme={theme!} />;
      }

      const isOwn = !isPartnerMessage(item, ownEntityId);

      // Truly-new chat + has_first_mes → the delivered greeting is the opening:
      // render it wrapped in the authored AlternateGreetingSwiper, with the ✨
      // Scenario pill beside it for discoverability (enabled in P2 — opens the
      // generator sheet). The regenerate slot appears after the last authored
      // greeting while GENERATE_GREETING is valid (greeting = only message).
      if (
        !isOwn &&
        item.message_type === 'greeting' &&
        item.id === greetingMessage?.id &&
        isGreetingOpening
      ) {
        return (
          <View style={styles.greetingWrap}>
            <AlternateGreetingSwiper
              key={item.id}
              greetings={greetingSwipes}
              charName={charName}
              userName={ownEntityName}
              theme={theme!}
              onRegenerateSwipe={
                canRegenerateGreeting ? handleRegenerateGreeting : undefined
              }
            />
            <View style={styles.scenarioPillRow}>
              <EmptyChatCTA
                variant="pill"
                disabled={false}
                onPress={openScenarioSheet}
                theme={theme!}
              />
            </View>
          </View>
        );
      }

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
          onImagePress={() => {}}
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
      ownEntityId,
      failedTranscriptions,
      handleConfirmAndSendMessage,
      handleDeleteMessage,
      handleRegenerateMessage,
      handleEditMessage,
      handleRetryTranscription,
      greetingMessage,
      isGreetingOpening,
      greetingSwipes,
      charName,
      ownEntityName,
      openScenarioSheet,
      canRegenerateGreeting,
      handleRegenerateGreeting,
    ],
  );


  // In-flight generation affordance (§2-4): GreetingBubble `preparing` (shimmer
  // + TypingIndicator) plus the "Preparing the opening…" caption. No streaming —
  // this shimmer is the sole latency affordance.
  const renderGreetingPreparing = useCallback(() => {
    return (
      <View style={styles.preparingWrap} testID="scenario-preparing">
        <GreetingBubble
          text=""
          charName={charName}
          userName={ownEntityName}
          theme={theme}
          state="preparing"
        />
        <ThemedText
          variant="muted"
          size={12}
          style={styles.preparingText}
          testID="scenario-preparing-text"
        >
          {t('scenario:preparingOpening')}
        </ThemedText>
      </View>
    );
  }, [charName, ownEntityName, theme, t]);

  return (
    <ThemedView style={styles.container}>
      {!isReadyToShow && (
        <ThemedView style={[styles.loadingOverlay, styles.centered]} pointerEvents="none">
          <ActivityIndicator size="large" color={theme?.colors.accent.primary} />
        </ThemedView>
      )}
      <ScreenHeader
        title={headerName}
        onBack={() => navigation.goBack()}
        left={
          partnerAvatar ? (
            <Avatar.Image
              size={36}
              source={{ uri: partnerAvatar }}
              style={styles.headerAvatar}
            />
          ) : (
            <LinearGradient
              colors={[
                (theme?.colors.accent.primary ?? '#7c3aed') + '33',
                theme?.colors.background.elevated ?? '#1e1e2e',
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerAvatarFallback}
            >
              <ThemedText
                size={14}
                weight="bold"
                style={{ color: theme?.colors.accent.primary }}
              >
                {headerName.substring(0, 2).toUpperCase()}
              </ThemedText>
            </LinearGradient>
          )
        }
        right={
          <View style={styles.headerControlsRow}>
            {isConnected ? (
              isSessionActive(currentInteractionIdRef.current) ? (
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
            <TouchableOpacity
              onPress={() => {
                hapticLightPress();
                handleToggleReplyMode();
              }}
              style={styles.replyModeButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              disabled={!isSessionActive(currentInteractionIdRef.current)}
            >
              <ThemedText
                size={11}
                weight="medium"
                style={[
                  styles.replyModeText,
                  { color: replyMode === 'instant'
                    ? theme?.colors.accent.primary
                    : theme?.colors.text.muted },
                ]}
              >
                {replyMode === 'instant' ? '⚡ Instant' : '💬 Realistic'}
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                hapticLightPress();
                handleEntityContextMenu();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon
                name="dots-vertical"
                size={24}
                color={theme?.colors.text.primary}
              />
            </TouchableOpacity>
          </View>
        }
      />

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
                <LinearGradient
                  colors={[
                    theme!.colors.background.elevated,
                    theme!.colors.background.surface,
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={[StyleSheet.absoluteFill, styles.menuGradientRadius]}
                />
                <LinearGradient
                  colors={[theme!.colors.accent.primary + '12', 'transparent']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0.6 }}
                  style={[StyleSheet.absoluteFill, styles.menuGradientRadius]}
                  pointerEvents="none"
                />
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
                {/* ── My Personas (the identity the user is acting as) ── */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handleOpenPersonaSwitcher}
                  activeOpacity={0.65}
                  testID="chat-persona-switcher"
                >
                  <View
                    style={[
                      styles.menuIconBadge,
                      { backgroundColor: theme!.colors.accent.primary + '1A' },
                    ]}
                  >
                    <Icon name="account-switch-outline" size={18} color={theme!.colors.accent.primary} />
                  </View>
                  <ThemedText size={15} weight="medium" style={{ flex: 1 }}>
                    {t('myPersonas')}
                  </ThemedText>
                  <Icon name="chevron-right" size={18} color={theme!.colors.text.muted} />
                </TouchableOpacity>
                <ThemedText variant="muted" size={11} style={styles.menuItemCaption}>
                  {t('myPersonasCaption')}
                </ThemedText>
                <View
                  style={[
                    styles.menuItemSeparator,
                    { backgroundColor: theme!.colors.border.default + '44' },
                  ]}
                />

                {/* ── Partner / Character (the OTHER participant) ── */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handlePartnerSettings}
                  activeOpacity={0.65}
                >
                  <View
                    style={[
                      styles.menuIconBadge,
                      { backgroundColor: (theme!.colors.accent.secondary ?? theme!.colors.accent.primaryHover) + '1A' },
                    ]}
                  >
                    <Icon
                      name="cog-outline"
                      size={18}
                      color={theme!.colors.accent.secondary ?? theme!.colors.accent.primaryHover}
                    />
                  </View>
                  <ThemedText size={15} weight="medium" style={{ flex: 1 }}>
                    {t('partnerSettings')}
                  </ThemedText>
                  <Icon name="chevron-right" size={18} color={theme!.colors.text.muted} />
                </TouchableOpacity>
                <ThemedText variant="muted" size={11} style={styles.menuItemCaption}>
                  {t('partnerSettingsCaption', { name: headerName })}
                </ThemedText>
                <View
                  style={[
                    styles.menuItemSeparator,
                    { backgroundColor: theme!.colors.border.default + '44' },
                  ]}
                />
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

      {/* Persona switcher — pick the persona to chat as, or create a new one */}
      <PersonaSwitcherModal
        visible={personaSwitcherVisible}
        activePersonaId={ownEntityId === 'user' ? null : ownEntityId}
        onSelect={handleSwitchPersona}
        onClose={() => setPersonaSwitcherVisible(false)}
      />

      {/* Android: 'height' recomputes the container frame on every re-render
          (e.g. during session/retry churn), which makes the bottom input flicker.
          Leave behavior undefined on Android — the window resizes for the keyboard
          by default and we avoid the re-layout feedback loop. */}
      <KeyboardAvoidingView
        style={[styles.content, !isReadyToShow && styles.hidden]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
        style={{ flex: 1 }}
        ref={flatListRef}
          data={messagesWithDivider}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.messageList, { flexGrow: 1 }]}
          ListEmptyComponent={
            // In-flight first generation → preparing shimmer instead of the hint.
            greetingPreparing ? (
              <View style={styles.emptyChat}>{renderGreetingPreparing()}</View>
            ) : // No first_mes → empty chat + the generate-greeting hint (enabled
            // in P2 — tapping opens the ScenarioGeneratorSheet). has_first_mes=false
            // is known only once the session surfaces it; before that we show
            // nothing (still loading).
            shouldShowEmptyChatHint(hasFirstMes, messagesWithDivider.length) ? (
              <View style={styles.emptyChat}>
                <ThemedText variant="muted" size={13} style={styles.emptyChatHint}>
                  {t('scenario:noGreetingHint')}
                </ThemedText>
                <EmptyChatCTA
                  variant="pill"
                  disabled={false}
                  onPress={openScenarioSheet}
                  theme={theme!}
                />
              </View>
            ) : null
          }
          onScroll={handleScroll}
          scrollEventThrottle={100}
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme!.colors.accent.primary]}
              tintColor={theme!.colors.accent.primary}
              progressBackgroundColor={theme!.colors.background.surface}
            />
          }
          initialNumToRender={MESSAGES_PAGE_SIZE}
          maxToRenderPerBatch={MESSAGES_PAGE_SIZE}
          windowSize={21}
          onScrollToIndexFailed={() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }}
          onContentSizeChange={() => {
            if (!isReadyToShowRef.current) {
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

              if (!isInitialScrollDone.current) {
                isInitialScrollDone.current = true;
                const revealTarget = initialScrollTarget;
                setTimeout(() => {
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

        {greetingPreparing && messages.length > 0 && renderGreetingPreparing()}
        {isTyping && <TypingIndicator theme={theme} mode="text" />}
        {isRecording && <TypingIndicator theme={theme} mode="audio" />}

        {showScrollToBottom && (
          <TouchableOpacity
            style={[
              styles.scrollToBottomButton,
              { backgroundColor: theme?.colors.accent.primary },
            ]}
            onPress={() => {
              hapticLightPress();
              flatListRef.current?.scrollToEnd({ animated: true });
            }}
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
          ref={chatInputRef}
          onSendText={handleSendText}
          onSendAudio={handleSendAudio}
          onSendImage={handleSendImage}
          onTypingStart={handleTypingStart}
          onEmojiToggle={() => {
            if (!showEmojiPicker) Keyboard.dismiss();
            setShowEmojiPicker(prev => !prev);
          }}
          showEmojiButton={true}
          disabled={!isSessionActive(currentInteractionIdRef.current)}
          entityId={currentInteractionIdRef.current}
          showScenarioButton={true}
          onScenarioPress={openScenarioSheet}
          theme={theme!}
        />
        {showEmojiPicker && (
          <EmojiPickerInline
            onEmojiSelected={handleEmojiSelected}
            entityId={currentInteractionIdRef.current}
            onOpenActionEditor={() => {
              setShowEmojiPicker(false);
              navigation.navigate('EmojiActionEditor', {
                entityId: currentInteractionIdRef.current,
                entityName: headerName,
              });
            }}
          />
        )}
      </KeyboardAvoidingView>

      {/* Scenario generator bottom sheet (§2-4) — paper Modal+Portal (§A18).
          Generate collapses the sheet and dispatches GENERATE_GREETING /
          START_NEW_SCENARIO (replace vs restart) via handleScenarioGenerate. */}
      <ScenarioGeneratorSheet
        open={scenarioSheetOpen}
        onClose={closeScenarioSheet}
        onGenerate={handleScenarioGenerate}
      />
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
  hidden: {
    opacity: 0,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
  },
  messageList: {
    paddingVertical: 8,
  },
  greetingWrap: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  preparingWrap: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  preparingText: {
    marginTop: 4,
    marginLeft: 4,
  },
  scenarioPillRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 6,
  },
  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  emptyChatHint: {
    textAlign: 'center',
    marginBottom: 12,
  },
  headerAvatar: {
    marginRight: 8,
  },
  headerAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  statusIndicator: {
    marginRight: 6,
  },
  headerControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  replyModeButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  replyModeText: {
    fontSize: 11,
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: 16,
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
  menuItemCaption: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 0,
    marginTop: -4,
    marginLeft: 46,
  },
});
