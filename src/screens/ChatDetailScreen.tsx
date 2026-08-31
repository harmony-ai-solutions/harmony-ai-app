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
  ActivityIndicator,
  RefreshControl,
  Keyboard,
  Platform,
  ToastAndroid,
  NativeScrollEvent,
  NativeSyntheticEvent,
  TouchableOpacity,
  Modal,
  View,
  TouchableWithoutFeedback,
  Animated,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import LinearGradient from 'react-native-linear-gradient';
import { Avatar } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useToast } from '../contexts/AppToastContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { hapticLightPress } from '../utils/haptics';
import { ChatBubble, isPartnerMessage } from '../components/chat/ChatBubble';
import { ChatInputBar, PickedImage } from '../components/chat/ChatInputBar';
import { TypingIndicator } from '../components/chat/TypingIndicator';
import { NewMessagesDivider } from '../components/chat/NewMessagesDivider';
import { PersonaChangeDivider } from '../components/chat/PersonaChangeDivider';
import { AlternateGreetingSwiper, parseAlternateGreetings } from '../components/chat/AlternateGreetingSwiper';
import { EmptyChatCTA } from '../components/chat/EmptyChatCTA';
import { GreetingBubble } from '../components/chat/GreetingBubble';
import { ScenarioGeneratorSheet, ScenarioGuidedInputs } from '../components/chat/ScenarioGeneratorSheet';
import { DayDivider } from '../components/chat/DayDivider';
import EntityEmojiActionService from '../services/EntityEmojiActionService';
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
import {
  getAllEntities,
  deleteEntity,
  getEntity,
  setEntityDisabled,
} from '../database/repositories/entities';
import { getReplyMode } from '../database/repositories/chatConversationSettings';
import { getUserPersona } from '../database/repositories/userEntities';
import { PersonaSwitcherModal } from '../components/modals/PersonaSwitcherModal';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { createLogger } from '../utils/logger';
import { ConversationMessage, CharacterProfile } from '../database/models';
import {
  deriveParticipantKey,
  deriveScopeFromParticipants,
} from '../database/repositories/interactions';
import {
  MessageActionSheet,
  MessageAction,
} from '../components/chat/MessageActionSheet';
import { MESSAGE_REPLY_ENABLED } from '../constants/chatFeatures';
import {
  ForwardPickerModal,
  ForwardTarget,
} from '../components/chat/ForwardPickerModal';
import { markConversationMessagesRead } from '../database/repositories/conversation_messages';
import {
  showBubble,
  hasBubblePermission,
  requestBubblePermission,
} from '../services/ChatBubbleService';
import { isChatLocked } from '../services/marketplace/MarketplaceService';

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

// After revealing the conversation (list made visible), keep re-pinning to the
// bottom for this long so async content growth (message images decoding, rows
// rendering in later batches) doesn't leave the viewport stranded partway up
// the conversation. The list opens at the latest message and stays there until
// these late sizes settle.
const INITIAL_SCROLL_SETTLE_MS = 1200;

/** Returns true when the two timestamps fall on the same local calendar day. */
function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type Props = NativeStackScreenProps<RootStackParamList, 'ChatDetail'>;

export const ChatDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { t } = useTranslation('chatDetail');
  const { bottom: safeBottom } = useSafeAreaInsets();
  const {
    interactionId: routeInteractionId,
    participantKey: routeParticipantKey,
    participantIds: routeParticipantIds,
    entityId: ownEntityId,
    entityName: routeEntityName,
  } = route.params;
  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { showToast } = useToast();
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
  const [partnerProfileId, setPartnerProfileId] = useState<string | null>(null);
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

  const [actionSheetMessage, setActionSheetMessage] =
    useState<ConversationMessage | null>(null);
  // Reply-to context: the message the user is replying to (consumed on send).
  // The UI entry points stay gated behind MESSAGE_REPLY_ENABLED (chatFeatures);
  // the pipeline itself is fully restored so a flag flip activates the feature.
  const [replyToMessage, setReplyToMessage] =
    useState<ConversationMessage | null>(null);
  const [forwardPickerVisible, setForwardPickerVisible] = useState(false);
  const [forwardMessageText, setForwardMessageText] = useState('');
  const [isDisabled, setIsDisabled] = useState(false);

  // Track the canonical interactionId — starts as temp UUIDv7 from route params,
  // updated to the server-assigned canonical ID when INIT_ENTITY response arrives.
  // Using a ref (not state) avoids re-render cascades and stale closure issues
  // in event listeners that need the current ID at callback time.
  const currentInteractionIdRef = useRef(routeInteractionId);

  // HARD GATE — marketplace preview lock (viewable free, chat locked until
  // acquired; own library never locked): once set, this chat is a locked
  // marketplace conversation — the session must never start and any open is
  // reverted. Guards the async race between the header-resolution lock check
  // and session initialization.
  const chatLockedRef = useRef(false);

  const flatListRef = useRef<FlatList<any>>(null);
  const isInitialScrollDone = useRef(false);
  const isArmRevealScheduled = useRef(false);
  const isNearBottom = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isReadyToShow, setIsReadyToShow] = useState(false);
  const isReadyToShowRef = useRef(false);
  const messagesCountAtReveal = useRef(0);
  const pendingOwnMessageScroll = useRef(false);
  // While this is non-zero (timestamp of the scheduled settle check), the list
  // keeps re-pinning to the bottom on every onContentSizeChange. This absorbs
  // async content growth (images loading, rows rendering in batches) that would
  // otherwise leave the viewport stranded partway up the conversation, so we
  // only stop re-pinning once everything has settled.
  const settleUntilRef = useRef(0);
  const loadedMessagesRef = useRef<ConversationMessage[]>([]);
  const [showDivider, setShowDivider] = useState(true);
  const [menuVisible, setMenuVisible] = useState(false);
  const [personaSwitcherVisible, setPersonaSwitcherVisible] = useState(false);
  // In-chat persona switch confirmation (rendered like a date/divider row)
  const [personaChangeText, setPersonaChangeText] = useState<string | null>(null);
  const [isGroupChat, setIsGroupChat] = useState(false);
  const [headerName, setHeaderName] = useState<string>('Chat');

  // ── Keyboard — keep the last messages visible & scrollable above the IME ──
  // The input bar lifts itself above the keyboard (ChatInputBar translateY),
  // so the message list must shrink by the same amount. Adding the keyboard
  // height as bottom padding to the list's content makes the newest messages
  // scroll into the space above the keyboard instead of being covered.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // True while the soft keyboard is up. Used to re-scroll after the keyboard
  // padding applies so a just-sent message is never left behind the keyboard.
  const keyboardVisibleRef = useRef(false);
  useEffect(() => {
    const onShow = (e: any) => {
      const height =
        e?.endCoordinates?.height ?? (Platform.OS === 'android' ? 300 : 336);
      keyboardVisibleRef.current = true;
      setKeyboardHeight(height);
      // Reveal the latest message above the keyboard.
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      });
    };
    const onHide = () => {
      keyboardVisibleRef.current = false;
      setKeyboardHeight(0);
      // Return to the true bottom once the keyboard is gone.
      flatListRef.current?.scrollToEnd({ animated: true });
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

      // Reset partner profile linkage each resolution pass; it is only set
      // for a private chat with an AI character (not group chats).
      setPartnerProfileId(null);

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
          // HARD GATE — marketplace preview lock (viewable free, chat locked
          // until acquired; own library never locked): if the partner is a
          // marketplace-listed AI the local user has not acquired (and does
          // not own), this chat must never open — navigate back immediately
          // and stop the session before any message can be sent or received.
          // Defense in depth: the central openCharacterChat gate normally
          // prevents reaching this screen, but direct navigation (chat list,
          // bubbles, deep links) still hits this path.
          try {
            if (await isChatLocked(entity.character_profile_id)) {
              log.warn(
                `Chat locked for marketplace profile ${entity.character_profile_id} — closing chat.`,
              );
              // Never let a session start for this chat, stop any session the
              // context may have started, then leave.
              chatLockedRef.current = true;
              stopInteractionSession(routeInteractionId).catch(() => {});
              navigation.goBack();
              return;
            }
          } catch (lockErr) {
            log.warn('Failed to check chat lock, allowing:', lockErr);
          }

          // Link the header to the partner's AI profile (tap avatar/name →
          // AIProfile). Skip in group chats — there is no single profile to open.
          setPartnerProfileId(entity.character_profile_id);
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

  // Load disabled state (the partner ENTITY flag, Q8) + register the
  // conversation as open (so incoming messages don't bump the unread counter
  // while this chat is on screen).
  useEffect(() => {
    let mounted = true;
    const loadDisabled = async () => {
      try {
        if (participantKey) {
          const partnerEntityId = participantIds.find(id => id !== ownEntityId);
          if (partnerEntityId) {
            const partner = await getEntity(partnerEntityId);
            if (mounted) setIsDisabled(partner?.is_disabled === 1);
          }
        }
      } catch (error) {
        log.error('Failed to load disabled state:', error);
      }
    };
    loadDisabled();
    if (participantKey) {
      EntitySessionService.registerOpenConversation(participantKey);
    }
    return () => {
      mounted = false;
      if (participantKey) {
        EntitySessionService.unregisterOpenConversation(participantKey);
      }
    };
  }, [participantKey, participantIds, ownEntityId]);

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

    // HARD GATE — marketplace preview lock: never start a session for a locked
    // marketplace conversation (the header-resolution gate set the ref).
    if (chatLockedRef.current) {
      return;
    }

    if (!isConnected || !participantKey) {
      return;
    }

    const initializeSession = async () => {
      try {
        log.info(`Initializing interaction session for ${routeInteractionId}...`);
        // Reply mode is read fresh from the SYNCED settings column on every
        // session init so the mode is not lost between navigations. Uses
        // participantKey (stable). 4-4: supersedes ChatPreferencesService; the
        // one-time legacy AsyncStorage migration runs inside getReplyMode.
        const savedMode = await getReplyMode(participantKey);
        const mode = savedMode || 'realistic';
        await startInteractionSession(ownEntityId, participantIds, mode);
      } catch (error: any) {
        if (!mounted) return;

        log.error('Failed to initialize entity session:', error);

        const errorMessage = error?.message || 'Unknown error';
        showToast(`${t('common:error')}: ${errorMessage}`);
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

        // Q8/A3 — a DISABLED AI partner is a terminal state. The engine refuses
        // INIT_ENTITY with `entity_disabled`; the app surfaces the honest
        // disabled-partner toast and jumps to the AI profile (which shows the
        // disabled state + the enable action). Distinct from the generic error
        // path.
        if (error === 'entity_disabled') {
          showToast(t('entityDisabledBody', { name: headerName }));
          if (partnerProfileId) {
            navigation.navigate('AIProfile', { profileId: partnerProfileId });
          }
          return;
        }

        showToast(t('chatSessionError', { error }));
      }
    };

    EntitySessionService.on('session:error', handleSessionError);

    return () => {
      EntitySessionService.off('session:error', handleSessionError);
    };
  }, [routeInteractionId, partnerProfileId, headerName, navigation, showToast, t]);

  // Seed emoji action defaults when session becomes active
  useEffect(() => {
    if (currentInteractionIdRef.current && isSessionActive(currentInteractionIdRef.current)) {
      // Use interactionId as the key for emoji defaults
      EntityEmojiActionService.seedDefaults(currentInteractionIdRef.current).catch(err => {
        log.warn('Failed to seed emoji action defaults:', err);
      });
    }
  }, [routeInteractionId, isSessionActive]);

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
        showToast(t('failedToSend', { message: error.message }));
      }
    },
    [routeInteractionId, ownEntityId, participantKey, isSessionActive],
  );

  // ---------------------------------------------------------------------------
  // Message action sheet (long-press a bubble)
  // ---------------------------------------------------------------------------

  const handleLongPressMessage = useCallback((message: ConversationMessage) => {
    setActionSheetMessage(message);
  }, []);

  const closeActionSheet = useCallback(() => {
    setActionSheetMessage(null);
  }, []);

  const handleReactToMessage = useCallback(
    async (messageId: string, emoji: string) => {
      try {
        const msg = await getConversationMessage(messageId);
        if (!msg) return;

        // Parse existing reactions
        let reactions: string[] = [];
        if (msg.reactions_json) {
          try {
            const parsed = JSON.parse(msg.reactions_json);
            if (Array.isArray(parsed)) {
              reactions = parsed.filter((r): r is string => typeof r === 'string');
            }
          } catch {
            reactions = [];
          }
        }

        // Toggle: remove if already present, else add
        const next = reactions.includes(emoji)
          ? reactions.filter(r => r !== emoji)
          : [...reactions, emoji];

        await updateConversationMessage(messageId, {
          reactions_json: JSON.stringify(next),
        });

        if (participantKey) {
          const updatedMessages = await getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          );
          setMessages(updatedMessages);
        }
      } catch (error) {
        log.error('Failed to toggle reaction:', error);
      }
    },
    [ownEntityId, participantKey],
  );

  const handleCopyMessage = useCallback(async (message: ConversationMessage) => {
    if (message.content) {
      await Clipboard.setString(message.content);
      showToast(t('toastCopied'));
    }
  }, [t]);

  const handleForwardMessage = useCallback((message: ConversationMessage) => {
    // Open the forward target picker — all characters the user has chatted with.
    setForwardMessageText(message.content || '');
    setForwardPickerVisible(true);
  }, []);

  const handleForwardSelect = useCallback(
    (target: ForwardTarget) => {
      setForwardPickerVisible(false);
      showToast(t('forwarding'));

      // Send the message directly to the target character's session in the
      // background — no navigation, the user stays on the current chat.
      EntitySessionService.forwardTextMessage(
        ownEntityId,
        target.participantIds,
        forwardMessageText,
      )
        .then(() => {
          showToast(t('toastForwarded'));
        })
        .catch(err => {
          log.error('Failed to forward message:', err);
          showToast(t('toastForwardFailed'));
        });
    },
    [ownEntityId, forwardMessageText, t, showToast],
  );

  const handleTranslateMessage = useCallback(
    async (message: ConversationMessage) => {
      // NOTE: There is no translation backend available yet. We show a
      // friendly confirmation so the action is not a dead button.
      if (!message.content) return;
      showAlert(
        t('translateTitle'),
        t('translateNotAvailable'),
        [{ text: t('common:ok') }],
      );
    },
    [showAlert, t],
  );

  const handleTogglePinMessage = useCallback(
    async (message: ConversationMessage) => {
      try {
        const nextPinned = !message.is_pinned;
        await updateConversationMessage(message.id, { is_pinned: nextPinned });
        // Keep the sheet's label in sync with the live message state.
        setActionSheetMessage(prev =>
          prev && prev.id === message.id ? { ...prev, is_pinned: nextPinned } : prev,
        );
        if (participantKey) {
          const updatedMessages = await getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          );
          setMessages(updatedMessages);
        }
        showToast(nextPinned ? t('toastPinned') : t('toastUnpinned'));
      } catch (error) {
        log.error('Failed to toggle pin:', error);
      }
    },
    [ownEntityId, participantKey],
  );

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

                showToast(t('toastMessageDeleted'));
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

                showToast(t('toastRegenerating'));
              } catch (error: any) {
                log.error('Failed to regenerate:', error);
                showToast(t('toastFailed', { message: error.message }));
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

                showToast(t('toastMessageUpdated'));
              } catch (error: any) {
                log.error('Failed to edit message:', error);
                showToast(t('toastFailed', { message: error.message }));
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

        showToast(t('toastRetryingTranscription'));
      } catch (error: any) {
        log.error('Failed to retry transcription:', error);
        setFailedTranscriptions(prev => new Set(prev).add(messageId));
        showToast(t('toastRetryFailed', { message: error.message }));
      }
    },
    [routeInteractionId],
  );

  // ---------------------------------------------------------------------------
  // Message sending — text / audio / images (driven by ChatInputBar)
  // ---------------------------------------------------------------------------

  const handleSendTextMessage = useCallback(
    async (text: string) => {
      if (isDisabled) {
        log.warn('Cannot send message: AI is disabled');
        showToast(t('disabledBanner'));
        return;
      }
      if (!isSessionActive(currentInteractionIdRef.current)) {
        log.warn('Cannot send message: session not active');
        showToast(t('failedToSend', { message: 'Session not active' }));
        return;
      }

      try {
        // Resolve emoji actions in the text
        let sendText = text;
        let additionalEffects = null;
        const replyId = replyToMessage?.id ?? null;

        const resolved = await EntityEmojiActionService.resolveMessageActions(
          currentInteractionIdRef.current,
          sendText,
        );

        if (resolved.hasActions) {
          sendText = resolved.substitutedText;
          additionalEffects = resolved.effects;
        }

        // Store the reply reference (reply_to_message_id) instead of embedding
        // a text quote — the UI renders a proper "Replying to" header.
        await EntitySessionService.sendTextMessage(
          currentInteractionIdRef.current,
          sendText,
          additionalEffects,
          replyId,
        );

        // Reply context consumed
        if (replyToMessage) {
          setReplyToMessage(null);
        }

        log.info(`Text message sent for interaction ${routeInteractionId}`);
        if (participantKey) {
          const updatedMessages = await getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          );
          pendingOwnMessageScroll.current = true;
          setMessages(updatedMessages);
        }
      } catch (error: any) {
        log.error('Failed to send text message:', error);
        showToast(t('failedToSend', { message: error.message }));
      }
    },
    [
      routeInteractionId,
      ownEntityId,
      participantKey,
      isSessionActive,
      showToast,
      t,
      replyToMessage,
    ],
  );

  const handleSendAudioMessage = useCallback(
    async (audioData: string, mimeType: string, duration: number) => {
      if (isDisabled) {
        log.warn('Cannot send audio: AI is disabled');
        showToast(t('disabledBanner'));
        return;
      }
      if (!isSessionActive(currentInteractionIdRef.current)) {
        log.warn('Cannot send audio: session not active');
        showToast(t('failedToSend', { message: 'Session not active' }));
        return;
      }

      try {
        // newAudioMessage stores the message locally and requests transcription.
        // Transcription completes server-side and fires 'transcription:completed'.
        await EntitySessionService.newAudioMessage(
          currentInteractionIdRef.current,
          audioData,
          mimeType,
          duration,
        );

        log.info(`Audio message flow started for interaction ${routeInteractionId}`);
        if (participantKey) {
          const updatedMessages = await getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          );
          pendingOwnMessageScroll.current = true;
          setMessages(updatedMessages);
        }
      } catch (error: any) {
        log.error('Failed to send audio message:', error);
        showToast(t('audioSendFailed', { message: error.message }));
      }
    },
    [
      routeInteractionId,
      ownEntityId,
      participantKey,
      isSessionActive,
      showToast,
      t,
    ],
  );

  const handleSendImages = useCallback(
    async (images: PickedImage[]) => {
      if (isDisabled) {
        log.warn('Cannot send images: AI is disabled');
        showToast(t('disabledBanner'));
        return;
      }
      if (!isSessionActive(currentInteractionIdRef.current)) {
        log.warn('Cannot send images: session not active');
        showToast(t('failedToSend', { message: 'Session not active' }));
        // Rethrow so the input bar keeps the previews for a retry.
        throw new Error('Session not active');
      }

      try {
        for (const image of images) {
          await EntitySessionService.sendImageMessage(
            currentInteractionIdRef.current,
            image.base64,
            image.mimeType,
          );
        }

        log.info(`Sent ${images.length} image message(s) for interaction ${routeInteractionId}`);
        if (participantKey) {
          const updatedMessages = await getRecentConversationMessages(
            ownEntityId,
            participantKey,
            MESSAGES_PAGE_SIZE,
          );
          pendingOwnMessageScroll.current = true;
          setMessages(updatedMessages);
        }
      } catch (error: any) {
        log.error('Failed to send image message:', error);
        showToast(t('imageSendFailed', { message: error.message }));
        throw error;
      }
    },
    [
      routeInteractionId,
      ownEntityId,
      participantKey,
      isSessionActive,
      showToast,
      t,
    ],
  );

  const handleReplyToMessage = useCallback(
    (message: ConversationMessage) => {
      setReplyToMessage(message);
    },
    [],
  );

  const handleCancelReply = useCallback(() => {
    setReplyToMessage(null);
  }, []);

  // Handle the message action sheet selection
  const handleMessageAction = useCallback(
    (action: MessageAction) => {
      const message = actionSheetMessage;
      if (!message) return;
      closeActionSheet();

      switch (action) {
        case 'reply':
          handleReplyToMessage(message);
          break;
        case 'delete':
          handleDeleteMessage(message.id);
          break;
        case 'copy':
          handleCopyMessage(message);
          break;
        case 'forward':
          handleForwardMessage(message);
          break;
        case 'translate':
          handleTranslateMessage(message);
          break;
        case 'pin':
          handleTogglePinMessage(message);
          break;
      }
    },
    [
      actionSheetMessage,
      closeActionSheet,
      handleReplyToMessage,
      handleDeleteMessage,
      handleCopyMessage,
      handleForwardMessage,
      handleTranslateMessage,
      handleTogglePinMessage,
    ],
  );

  // ── Disable / enable ──
  const handleDisableToggle = useCallback(() => {
    setMenuVisible(false);
    if (!participantKey) return;
    const otherIds = participantIds.filter(id => id !== ownEntityId);
    const partnerEntityId = otherIds[0] || '';
    const partnerName = headerName || t('partnerSettings');

    // Disable is a per-ENTITY flag (Q8) — no single partner (group) → no-op.
    if (!partnerEntityId) return;

    if (!isDisabled) {
      showAlert(
        t('disableTitle', { name: partnerName }),
        t('disableBody', { name: partnerName }),
        [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('disableTitle', { name: partnerName }),
            style: 'destructive',
            onPress: async () => {
              try {
                await setEntityDisabled(partnerEntityId, true);
                setIsDisabled(true);
                showToast(t('toastDisabled'));
              } catch (error) {
                log.error('Failed to disable:', error);
              }
            },
          },
        ],
      );
    } else {
      // Enable — the send/incoming guards read the entity flag directly
      // (Q8), no conversation override to seed.
      setIsDisabled(false);
      showToast(t('toastEnabled'));
      setEntityDisabled(partnerEntityId, false).catch(error =>
        log.error('Failed to enable:', error),
      );
    }
  }, [
    participantKey,
    participantIds,
    ownEntityId,
    headerName,
    isDisabled,
    showAlert,
    showToast,
    t,
  ]);

  // ── Open chat bubble ──
  const handleOpenBubble = useCallback(async () => {
    setMenuVisible(false);
    const conversation = {
      participantKey,
      interactionId: currentInteractionIdRef.current,
      entityId: participantIds.filter(id => id !== ownEntityId)[0] || '',
      ownEntityId,
      entityName: headerName,
      participantIds,
      avatar: partnerAvatar,
    };

    // showBubble remembers the conversation and auto-requests the overlay
    // permission when missing; the bubble auto-shows on return from settings.
    const shown = await showBubble(conversation);
    if (shown) {
      showToast(t('openBubble'));
      return;
    }

    // Permission not granted yet — request it; pending conversation auto-shows.
    const accepted = await requestBubblePermission();
    if (!accepted) {
      showToast(t('common:error'));
    } else {
      showToast(t('openBubble'));
    }
  }, [
    participantKey,
    participantIds,
    ownEntityId,
    headerName,
    partnerAvatar,
    showToast,
    t,
  ]);

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

        const persona = await getUserPersona(personaId);
        await ChatPreferencesService.setGlobalImpersonatedEntity(personaId);

        setPersonaChangeText(t('personaChanged', { name: persona?.name ?? personaId }));
      } catch (err) {
        log.error('Failed to switch persona:', err);
      }
    },
    [t],
  );

  // Open settings for the OTHER participant (partner/character) in this chat.
  // Resolves the partner entity → its character profile and opens the single
  // edit surface (Create AI Partner screen in edit mode).
  const handlePartnerSettings = useCallback(() => {
    setMenuVisible(false);
    const otherIds = participantIds.filter(id => id !== ownEntityId);
    const partnerEntityId = otherIds[0] || '';
    if (!partnerEntityId) return;
    (async () => {
      try {
        const entity = await getEntity(partnerEntityId);
        if (entity?.character_profile_id) {
          navigation.navigate('CreateAI', {
            editProfileId: entity.character_profile_id,
          });
        }
      } catch (err) {
        log.warn('Failed to resolve partner entity for settings:', err);
      }
    })();
  }, [ownEntityId, participantIds, navigation]);

  // Open the AI partner's profile page (AIProfile) when the user taps the
  // header avatar or character name in a private chat with an AI character.
  const handleOpenPartnerProfile = useCallback(() => {
    if (!partnerProfileId) return;
    hapticLightPress();
    navigation.navigate('AIProfile', { profileId: partnerProfileId });
  }, [partnerProfileId, navigation]);

  // Index messages by id so reply headers can look up the quoted message.
  const messageById = useMemo(() => {
    const map = new Map<string, ConversationMessage>();
    for (const m of messages) {
      map.set(m.id, m);
    }
    return map;
  }, [messages]);

  // Calculate messages with divider AND compute the initial scroll target
  const { messagesWithDivider, initialScrollTarget } = useMemo(() => {
    if (messages.length === 0 && !personaChangeText) {
      return { messagesWithDivider: messages, initialScrollTarget: 'bottom' as const };
    }

    // Insert a calendar-day divider before the first message of each new day.
    // This runs on the raw messages so dividers stay stable regardless of the
    // session/persona divider insertion below. D1-8: also emit a divider for
    // the FIRST message (i === 0) so a freshly opened conversation shows its
    // start date ("Today"/"Yesterday"/date) like mainstream chat apps.
    let withDivider: any[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (
        i === 0 ||
        !isSameCalendarDay(messages[i - 1].created_at, messages[i].created_at)
      ) {
        withDivider.push({
          id: `day-divider-${messages[i].id}`,
          type: 'day',
          date: messages[i].created_at,
        });
      }
      withDivider.push(messages[i]);
    }

    if (showDivider) {
      // "New messages" divider = the FIRST partner-sent UNREAD message at open,
      // derived from the loaded page's `is_read` flags (3-1 — no AsyncStorage;
      // the legacy last-read-timestamp divider-key derivation is gone A5/A2).
      const firstUnreadIndex = messages.findIndex(
        m =>
          m.sender_entity_id !== ownEntityId &&
          m.is_read === false,
      );

      if (firstUnreadIndex > 0) {
        // Map the raw-message index to the corresponding index in the
        // day-augmented array (each message has one preceding day-divider).
        const insertionIndex = withDivider.findIndex(
          (m: any) => m.id === messages[firstUnreadIndex].id,
        );
        if (insertionIndex !== -1) {
          const newMessageCount = messages.length - firstUnreadIndex;
          withDivider.splice(insertionIndex, 0, {
            id: 'new-messages-divider',
            type: 'divider',
            count: newMessageCount,
          });
        }
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

    // ALWAYS open the conversation at the most recent (bottom) message. The
    // "new messages" divider is still inserted above so it stays visible for
    // context when the user scrolls up, but the initial viewport must land on
    // the latest message — starting mid-conversation (on the divider) was the
    // reported bug, so the scroll target is never a divider index.
    return { messagesWithDivider: withDivider, initialScrollTarget: 'bottom' as const };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, showDivider, ownEntityId, personaChangeText]);

  useEffect(() => {
    if (!isInitialScrollDone.current) {
      isNearBottom.current = initialScrollTarget === 'bottom';
    }
  }, [initialScrollTarget]);

  // Authority for the initial reveal + bottom-pin. This is driven by DATA
  // (messages / persona-change row) instead of onContentSizeChange, so it is
  // reliable regardless of when/whether the list reports size changes — the
  // first onContentSizeChange fires while the list is empty, which would
  // otherwise arm (and expire) the reveal before a slow, chunked message load
  // finishes, stranding the viewport on the very first message.
  //
  // When real content first arrives: arm a short settle window during which we
  // keep snapping to the bottom (absorbing async image decode / late batches),
  // then reveal the screen. Re-runs whenever the message list grows during
  // init so a late-arriving message still re-anchors the viewport to the bottom.
  useEffect(() => {
    const hasRealContent =
      messages.length > 0 || Boolean(personaChangeText);
    if (
      !isReadyToShowRef.current &&
      !isInitialScrollDone.current &&
      initialScrollTarget === 'bottom' &&
      hasRealContent
    ) {
      const scroll = () => flatListRef.current?.scrollToEnd({ animated: false });
      // First snap immediately, then keep re-snapping on a few frames so rows
      // get a chance to render (images decode async → content grows).
      requestAnimationFrame(scroll);

      if (!isArmRevealScheduled.current) {
        isArmRevealScheduled.current = true;
        isInitialScrollDone.current = true;
        settleUntilRef.current = Date.now() + INITIAL_SCROLL_SETTLE_MS;

        const begin = Date.now();
        const interval = setInterval(() => {
          scroll();
          if (Date.now() - begin >= INITIAL_SCROLL_SETTLE_MS) {
            clearInterval(interval);
            settleUntilRef.current = 0;
            messagesCountAtReveal.current = messagesWithDivider.length;
            isReadyToShowRef.current = true;
            setIsReadyToShow(true);
          }
        }, 60);
      }
    }
  }, [messages, personaChangeText, messagesWithDivider, initialScrollTarget]);

  const persistMarkAsRead = useCallback(() => {
    // Derived unread (A5/A2): mark partner-sent messages in THIS conversation
    // read, fire-and-forget. Reading the chat clears the derived unread badge.
    if (participantKey) {
      markConversationMessagesRead(participantKey, ownEntityId).catch(error =>
        log.error('Failed to mark conversation read:', error),
      );
    }
    // The legacy last-read-timestamp AsyncStorage key is gone (3-1) — the
    // divider no longer depends on it; only the derived-first-unread flags
    // matter. Hide the divider once the reveal settles so it doesn't re-appear
    // on scroll.
    if (isReadyToShowRef.current) {
      setShowDivider(false);
    }
  }, [participantKey, ownEntityId]);

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
      if (item.type === 'day') {
        return <DayDivider date={item.date} theme={theme!} />;
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
      const repliedMessage =
        item.reply_to_message_id && messageById.has(item.reply_to_message_id)
          ? messageById.get(item.reply_to_message_id)
          : null;

      return (
        <ChatBubble
          message={item}
          isOwn={isOwn}
          isTranscriptionFailed={isTranscriptionFailed}
          partnerAvatar={!isOwn ? partnerAvatar : null}
          partnerName={partnerName}
          repliedMessage={repliedMessage}
          onImagePress={() => {}}
          onSendMessage={handleConfirmAndSendMessage}
          onEdit={handleEditMessage}
          onRetryTranscription={handleRetryTranscription}
          onLongPress={handleLongPressMessage}
          onReact={handleReactToMessage}
          theme={theme!}
        />
      );
    },
    [
      messages,
      messageById,
      partnerAvatar,
      theme,
      ownEntityId,
      failedTranscriptions,
      handleConfirmAndSendMessage,
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
      handleLongPressMessage,
      handleReactToMessage,
    ],
  );

  // Connection indicator (D1-7): three states, restored from her cd821db
  // collapse (which reduced it to a single online/offline boolean dot).
  //   connected  — sync WS up AND the entity session is fully active (purple)
  //   connecting — sync WS up, session still initializing (amber, pulsing)
  //   offline    — sync WS down / disconnected (grey)
  const connectionState: 'connected' | 'connecting' | 'offline' = isConnected
    ? isSessionActive(currentInteractionIdRef.current)
      ? 'connected'
      : 'connecting'
    : 'offline';

  // Pulsing affordance for the "connecting" state.
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (connectionState === 'connecting') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.35,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulseAnim.setValue(1);
  }, [connectionState, pulseAnim]);

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
        onTitlePress={partnerProfileId ? handleOpenPartnerProfile : undefined}
        titleRight={
          connectionState === 'connected' ? (
            <View
              style={styles.statusDotWrap}
              accessibilityRole="image"
              accessibilityLabel={t('statusConnected')}
            >
              <LinearGradient
                colors={[
                  (theme?.colors.accent.primary ?? '#7c3aed') + 'E6',
                  ((theme?.colors.accent.secondary ?? theme?.colors.accent.primaryHover ?? '#7c3aed') + '80'),
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.statusDot, styles.statusDotOnline]}
              />
            </View>
          ) : connectionState === 'connecting' ? (
            <Animated.View
              style={[styles.statusDotWrap, { opacity: pulseAnim }]}
              accessibilityRole="image"
              accessibilityLabel={t('statusConnecting')}
            >
              <View style={[styles.statusDot, styles.statusDotConnecting]} />
            </Animated.View>
          ) : (
            <View
              style={styles.statusDotWrap}
              accessibilityRole="image"
              accessibilityLabel={t('statusOffline')}
            >
              <LinearGradient
                colors={['#6b7280', '#9ca3af']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.statusDot, styles.statusDotOffline]}
              />
            </View>
          )
        }
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
                  onPress={handleOpenBubble}
                  activeOpacity={0.65}
                  testID="chat-open-bubble"
                >
                  <View
                    style={[
                      styles.menuIconBadge,
                      { backgroundColor: (theme!.colors.accent.secondary ?? theme!.colors.accent.primaryHover) + '1A' },
                    ]}
                  >
                    <Icon
                      name="chat-processing-outline"
                      size={18}
                      color={theme!.colors.accent.secondary ?? theme!.colors.accent.primaryHover}
                    />
                  </View>
                  <ThemedText size={15} weight="medium" style={{ flex: 1 }}>
                    {t('openBubble')}
                  </ThemedText>
                  <Icon name="chevron-right" size={18} color={theme!.colors.text.muted} />
                </TouchableOpacity>
                <View
                  style={[
                    styles.menuItemSeparator,
                    { backgroundColor: theme!.colors.border.default + '44' },
                  ]}
                />
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handleDisableToggle}
                  activeOpacity={0.65}
                  testID="chat-disable-toggle"
                >
                  <View
                    style={[
                      styles.menuIconBadge,
                      { backgroundColor: theme!.colors.status.error + '1A' },
                    ]}
                  >
                    <Icon
                      name={isDisabled ? 'shield-account-outline' : 'shield-off-outline'}
                      size={18}
                      color={theme!.colors.status.error}
                    />
                  </View>
                  <ThemedText size={15} weight="medium" style={{ flex: 1, color: theme!.colors.status.error }}>
                    {isDisabled ? t('enable') : t('disableTitle', { name: headerName })}
                  </ThemedText>
                  <Icon name="chevron-right" size={18} color={theme!.colors.text.muted} />
                </TouchableOpacity>
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

      {/* Message action sheet — long-press a bubble. Only the last message of
          the conversation may be deleted, so deletion is hidden otherwise. */}
      <MessageActionSheet
        visible={actionSheetMessage !== null}
        message={actionSheetMessage}
        isOwn={actionSheetMessage?.sender_entity_id === ownEntityId}
        partnerName={partnerName}
        isPinned={actionSheetMessage?.is_pinned ?? false}
        hideReactions
        hideForward
        canDelete={
          actionSheetMessage !== null &&
          messages.length > 0 &&
          messages[messages.length - 1].id === actionSheetMessage.id
        }
        onAction={handleMessageAction}
        onReact={(emoji) => {
          if (actionSheetMessage) {
            handleReactToMessage(actionSheetMessage.id, emoji);
          }
        }}
        onClose={closeActionSheet}
      />

      {/* Forward picker — choose a character to forward the message to */}
      <ForwardPickerModal
        visible={forwardPickerVisible}
        ownEntityId={ownEntityId}
        messageText={forwardMessageText}
        onSelect={handleForwardSelect}
        onClose={() => setForwardPickerVisible(false)}
      />

      <View
        style={styles.keyboardAvoid}
      >
      <View
        style={[
          styles.content,
          !isReadyToShow && styles.hidden,
          // The input bar floats above the keyboard via translateY (visual
          // only). Translate the message list up by the SAME amount so both
          // move together — the list keeps its full height/scroll range (no
          // shrinking) and its bottom stays aligned with the input bar top.
          // Sending a message then scrolls to the list's end, which now sits
          // above the keyboard, making the new message the visible one.
          keyboardHeight > 0 && { transform: [{ translateY: -keyboardHeight }] },
        ]}
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
              // Initial load (data-driven effect owns the reveal). While not yet
              // revealed, keep re-pinning to the bottom on EVERY content-size
              // change: messages are chronological (oldest→newest) in a
              // non-inverted list and rows have variable height (images decode
              // async, later batches render after the first pass), so contentSize
              // grows several times before it's stable. Re-pinning each change
              // keeps the viewport anchored at the latest message.
              if (initialScrollTarget === 'bottom') {
                flatListRef.current?.scrollToEnd({ animated: false });
              }
            } else {
              // Post-reveal. Keep re-pinning to the bottom through the settle
              // window too — late image decoding / row rendering can still grow
              // contentSize right after reveal, which would otherwise push the
              // bottom out from under the viewport and leave it mid-conversation.
              if (
                settleUntilRef.current !== 0 &&
                Date.now() < settleUntilRef.current
              ) {
                flatListRef.current?.scrollToEnd({ animated: false });
                return;
              }
              // Settle window done — clear it.
              if (settleUntilRef.current !== 0) {
                settleUntilRef.current = 0;
              }

              if (pendingOwnMessageScroll.current) {
                // A message was just sent — always reveal it above the keyboard.
                // (No `length > count` guard here: when the keyboard margin
                // resizes the content AFTER the send, the count is unchanged
                // but the viewport needs to re-scroll, and the guard would
                // swallow that corrective scroll — hiding the sent message.)
                pendingOwnMessageScroll.current = false;
                isNearBottom.current = true;
                flatListRef.current?.scrollToEnd({ animated: true });
              } else if (
                messagesWithDivider.length > messagesCountAtReveal.current
              ) {
                messagesCountAtReveal.current = messagesWithDivider.length;
                if (isNearBottom.current) {
                  isNearBottom.current = true;
                  // Wait for the keyboard margin to apply before scrolling so
                  // the new message lands above the keyboard, not behind it.
                  if (keyboardVisibleRef.current) {
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        flatListRef.current?.scrollToEnd({ animated: true });
                      });
                    });
                  } else {
                    flatListRef.current?.scrollToEnd({ animated: true });
                  }
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

</View>

{isDisabled ? (
        <View style={[styles.disabledBanner, { paddingBottom: safeBottom + 14 }]}>
          <Icon name="shield-off-outline" size={18} color={theme?.colors.status.error} />
          <ThemedText variant="muted" size={13} style={styles.disabledBannerText}>
            {t('disabledBanner')}
          </ThemedText>
        </View>
      ) : (
        <ChatInputBar
          onSendText={handleSendTextMessage}
          onSendAudio={handleSendAudioMessage}
          onSendImages={handleSendImages}
          disabled={connectionState !== 'connected'}
          entityId={ownEntityId}
          showScenarioButton={!hasFirstMes}
          onScenarioPress={openScenarioSheet}
          replyTo={
            MESSAGE_REPLY_ENABLED && replyToMessage
              ? {
                  id: replyToMessage.id,
                  senderName:
                    replyToMessage.sender_entity_id === ownEntityId
                      ? ownEntityName
                      : partnerName,
                  content: replyToMessage.content || '',
                }
              : null
          }
          onCancelReply={handleCancelReply}
        />
      )}

      {/* Scenario generator bottom sheet (§2-4) — paper Modal+Portal (§A18).
          Generate collapses the sheet and dispatches GENERATE_GREETING /
          START_NEW_SCENARIO (replace vs restart) via handleScenarioGenerate. */}
      <ScenarioGeneratorSheet
        open={scenarioSheetOpen}
        onClose={closeScenarioSheet}
        onGenerate={handleScenarioGenerate}
      />
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
    // Clip the translated-up message list at the header's bottom edge so the
    // conversation never bleeds over the header when the keyboard is open.
    overflow: 'hidden',
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
  statusDotWrap: {
    marginLeft: 2,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusDotOnline: {
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 3,
  },
  // Amber "session initializing" dot (D1-7 third state); the Animated.View
  // wrapping it pulses opacity while connecting.
  statusDotConnecting: {
    backgroundColor: '#f59e0b',
  },
  statusDotOffline: {
    opacity: 0.85,
  },
  headerControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  disabledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(220, 38, 38, 0.3)',
  },
  disabledBannerText: {
    flex: 1,
  },
});
