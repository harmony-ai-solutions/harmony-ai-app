/**
 * ChatDetailScreen — scenario generation flow tests (§2-4).
 *
 * Verifies (with EntitySessionService dispatch mocked):
 *  - `shouldUseGenerateGreeting`: replace-vs-restart gate by message count.
 *  - empty chat: ✨ pill opens the sheet; Generate → GENERATE_GREETING
 *    (random: no `guided`).
 *  - shimmer ("preparing") while in flight → arrived greeting after resolve.
 *  - failure → non-blocking toast (chat stays as-is).
 *  - mid-conversation: Generate → START_NEW_SCENARIO (restart) + blocking
 *    sync + interaction-id swap (subsequent events route to the new id).
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ChatDetailScreen, shouldUseGenerateGreeting } from '../ChatDetailScreen';
import EntitySessionService from '../../services/EntitySessionService';

const mockShowAlert = jest.fn();

const THEME = {
  colors: {
    accent: {
      primary: '#7c3aed',
      secondary: '#a78bfa',
      primaryHover: '#6d28d9',
      secondaryHover: '#8b5cf6',
    },
    background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e', hover: '#1a1a2e' },
    border: { default: '#333333', focus: '#7c3aed', hover: '#444', accent: '#7c3aed' },
    text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
    status: { error: '#ef4444', success: '#22c55e', warning: '#f59e0b', info: '#3b82f6' },
    gradients: { primary: '', secondary: '', surface: '' },
    glass: {
      cardOpacity: 0.5,
      glowOpacity: 0.08,
      glowRadius: 14,
      borderGradientStart: 'rgba(255,255,255,0.4)',
      borderGradientEnd: 'rgba(167,139,250,0.4)',
    },
    typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
  },
} as any;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// ChatInputBar (senju's replacement for ChatInput) uses safe-area insets
// for the keyboard lift — mock the module like the other screen tests do.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// ChatDetailScreen shows themed toasts (senju's refactor) — mock the toast
// context so renders don't require AppToastProvider.
jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// The screen reads the signed-in user (senju's additions) — mock auth so
// renders don't require AuthProvider (null user is handled).
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

// PersonaSwitcherModal (rendered by the screen) resolves navigation via
// useNavigation — mock the module like CharactersScreen.test does.
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn() }),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

jest.mock('react-native-paper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Provider: ({ children }: any) => children,
    Avatar: { Image: (props: any) => React.createElement(View, props) },
  };
});

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: THEME }),
}));

jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

jest.mock('../../contexts/SyncConnectionContext', () => ({
  useSyncConnection: () => ({ isConnected: true }),
}));

jest.mock('../../contexts/EntitySessionContext', () => ({
  useEntitySession: () => ({
    isSessionActive: () => true,
    startInteractionSession: jest.fn().mockResolvedValue(undefined),
    stopInteractionSession: jest.fn(),
    clearFailedSession: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('../../services/EntitySessionService', () => {
  const { EventEmitter } = require('eventemitter3');
  const svc = new EventEmitter();
  svc.generateGreeting = jest.fn();
  svc.startNewScenario = jest.fn();
  svc.getInteractionSession = jest.fn().mockReturnValue(null);
  svc.isTranscriptionFailed = jest.fn().mockReturnValue(false);
  // Open-conversation registry (senju's unread tracking) — no-ops for tests.
  svc.registerOpenConversation = jest.fn();
  svc.unregisterOpenConversation = jest.fn();
  return { __esModule: true, EntitySessionService: svc, default: svc };
});

jest.mock('../../services/SyncService', () => {
  const instance = {
    syncAndWait: jest.fn().mockResolvedValue(undefined),
    initiateSync: jest.fn().mockResolvedValue(undefined),
  };
  return {
    __esModule: true,
    SyncService: { getInstance: () => instance },
    __mockSyncServiceInstance: instance,
  };
});

jest.mock('../../services/EntityEmojiActionService', () => ({
  __esModule: true,
  default: {
    seedDefaults: jest.fn().mockResolvedValue(undefined),
    resolveMessageActions: jest.fn().mockResolvedValue({
      hasActions: false,
      substitutedText: '',
      effects: null,
    }),
  },
}));

jest.mock('../../services/ChatPreferencesService', () => ({
  __esModule: true,
  default: {
    getReplyMode: jest.fn().mockResolvedValue('realistic'),
    setReplyMode: jest.fn().mockResolvedValue(undefined),
    getGlobalImpersonatedEntity: jest.fn().mockResolvedValue(null),
    setGlobalImpersonatedEntity: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../database/repositories/conversation_messages', () => ({
  getConversationMessagesByParticipantKey: jest.fn().mockResolvedValue([]),
  getRecentConversationMessages: jest.fn().mockResolvedValue([]),
  updateConversationMessage: jest.fn().mockResolvedValue(undefined),
  getConversationMessage: jest.fn().mockResolvedValue(null),
  deleteConversationMessage: jest.fn().mockResolvedValue(undefined),
  markConversationMessagesRead: jest.fn().mockResolvedValue(0),
  markConversationMessagesUnread: jest.fn().mockResolvedValue(0),
  getUnreadCountByParticipantKeys: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('../../database/repositories/characters', () => ({
  getPrimaryImage: jest.fn().mockResolvedValue(null),
  getCharacterProfile: jest.fn().mockResolvedValue(null),
  imageToDataURL: jest.fn().mockReturnValue(null),
}));

jest.mock('../../database/repositories/entities', () => ({
  getAllEntities: jest.fn().mockResolvedValue([]),
  deleteEntity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../database/repositories/interactions', () => ({
  deriveParticipantKey: jest.fn().mockReturnValue('pk'),
  deriveScopeFromParticipants: jest.fn().mockReturnValue('one_on_one'),
}));

jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: () => React.createElement(View, { testID: 'screen-header-mock' }) };
});

jest.mock('../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...props }: any) => React.createElement(View, { style, ...props }, children) };
});

jest.mock('../../components/themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, style, ...props }: any) => React.createElement(Text, { style, ...props }, children) };
});

jest.mock('../../components/chat/ChatBubble', () => ({
  __esModule: true,
  ChatBubble: () => null,
  isPartnerMessage: (m: any, own: string) => m.sender_entity_id !== own,
}));

jest.mock('../../components/chat/ChatInputBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ChatInputBar: (props: any) => React.createElement(View, { testID: 'chat-input-mock', ...props }) };
});

jest.mock('../../components/chat/TypingIndicator', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, TypingIndicator: () => React.createElement(View, { testID: 'typing-indicator-mock' }) };
});

const mockDividerProps: any[] = [];
jest.mock('../../components/chat/NewMessagesDivider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    NewMessagesDivider: (props: any) => {
      mockDividerProps.push(props);
      return React.createElement(View, { testID: 'new-messages-divider-mock' });
    },
  };
});

jest.mock('../../components/emoji/EmojiPickerInline', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, EmojiPickerInline: () => React.createElement(View, { testID: 'emoji-picker-mock' }) };
});

jest.mock('../../components/chat/AlternateGreetingSwiper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AlternateGreetingSwiper: (props: any) => React.createElement(View, { testID: 'greeting-swiper-mock', ...props }),
    parseAlternateGreetings: () => [],
  };
});

jest.mock('../../components/chat/GreetingBubble', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    GreetingBubble: ({ state, ...props }: any) =>
      React.createElement(View, { testID: `greeting-bubble-${state ?? 'arrived'}`, ...props }),
  };
});

jest.mock('../../components/chat/ScenarioGeneratorSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ScenarioGeneratorSheet: (props: any) =>
      React.createElement(View, { testID: 'scenario-generator-sheet', ...props }),
  };
});

jest.mock('../../components/themed/ThemedButton', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID, ...props }: any) =>
      React.createElement(
        View,
        {
          onPress: () => onPress(),
          accessibilityState: { disabled: !!disabled },
          testID,
          accessibilityRole: 'button',
          ...props,
        },
        React.createElement(Text, { testID: `${testID}-label` }, label),
      ),
  };
});

const { getRecentConversationMessages } = require('../../database/repositories/conversation_messages');
const { syncAndWait } = require('../../services/SyncService').__mockSyncServiceInstance;

const ownEntityId = 'user-entity';
const partnerEntityId = 'char-entity';

function makeMsg(
  id: string,
  opts: Partial<{ type: 'text' | 'audio' | 'combined' | 'image' | 'greeting'; sender: string; content: string }> = {},
) {
  return {
    id,
    entity_id: ownEntityId,
    sender_entity_id: opts.sender ?? partnerEntityId,
    interaction_id: 'ix-test',
    content: opts.content ?? 'hello',
    message_type: opts.type ?? 'text',
    audio_duration: null,
    audio_data: null,
    audio_mime_type: null,
    image_data: null,
    image_mime_type: null,
    vl_model: null,
    vl_model_interpretation: null,
    emotional_state_bits: 0,
    is_recon_followup: false,
    is_edited: false,
    edit_of_message_id: null,
    is_read: false,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };
}

const route = {
  key: 'chat-detail-1',
  name: 'ChatDetail',
  params: {
    interactionId: 'ix-test',
    participantKey: 'pk',
    participantIds: [ownEntityId, partnerEntityId],
    entityId: ownEntityId,
    entityName: 'Aria',
  },
} as any;
const navigation = { goBack: jest.fn(), navigate: jest.fn() } as any;

const greetingMsg = makeMsg('msg-greeting', {
  type: 'greeting',
  content: 'Hello there!',
});
const userMsg = makeMsg('msg-user', { type: 'text', sender: ownEntityId, content: 'Hi!' });

const guidedInputs = {
  mood: ['Warm'],
  setting: 'Cafe',
  relationship: 'old-friends',
  timeOfDay: 'Night',
  whoFirst: 'character' as const,
  premise: 'We meet again',
};

async function renderScreen() {
  return render(<ChatDetailScreen route={route} navigation={navigation} />);
}

function emitSessionStarted(hasFirstMes: boolean) {
  return act(async () => {
    (EntitySessionService as any).emit('session:started', 'ix-test', {
      interactionId: 'ix-test',
      ownEntityId,
      participantIds: [ownEntityId, partnerEntityId],
      hasFirstMes,
    });
  });
}

async function openSheetAndGenerate(utils: any, guided: any, hasFirstMes = false) {
  await emitSessionStarted(hasFirstMes);
  await fireEvent.press(utils.getByTestId('empty-chat-cta-pill'));
  const sheet = utils.getByTestId('scenario-generator-sheet');
  expect(sheet.props.open).toBe(true);
  await act(async () => {
    sheet.props.onGenerate(guided);
  });
}

describe('shouldUseGenerateGreeting (replace-vs-restart gate)', () => {
  it('true when the chat is empty (first custom greeting)', () => {
    expect(shouldUseGenerateGreeting([])).toBe(true);
  });

  it('true when the greeting is the only message (replace)', () => {
    expect(shouldUseGenerateGreeting([greetingMsg])).toBe(true);
  });

  it('false once the conversation has started (restart)', () => {
    expect(shouldUseGenerateGreeting([greetingMsg, userMsg])).toBe(false);
    expect(shouldUseGenerateGreeting([userMsg])).toBe(false);
  });
});

describe('ChatDetailScreen — scenario generation (§2-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowAlert.mockClear();
    getRecentConversationMessages.mockResolvedValue([]);
  });

  it('empty chat: ✨ pill opens the sheet; Generate (random) dispatches GENERATE_GREETING', async () => {
    const utils = await renderScreen();
    await emitSessionStarted(false);

    // The empty-chat CTA pill is present (enabled in P2).
    const pill = utils.getByTestId('empty-chat-cta-pill');
    expect(pill.props.accessibilityState.disabled).toBe(false);

    await openSheetAndGenerate(utils, null, false);

    expect((EntitySessionService as any).generateGreeting).toHaveBeenCalledTimes(1);
    expect((EntitySessionService as any).generateGreeting).toHaveBeenCalledWith({
      entityId: partnerEntityId,
      targetEntityId: ownEntityId,
      interactionId: 'ix-test',
      mode: 'random',
    });
    expect((EntitySessionService as any).startNewScenario).not.toHaveBeenCalled();
  });

  it('directed Generate passes the guided payload through to GENERATE_GREETING', async () => {
    (EntitySessionService as any).generateGreeting.mockResolvedValue({
      greeting: 'Guided hello',
      interactionId: 'ix-test',
    });
    const utils = await renderScreen();
    await openSheetAndGenerate(utils, guidedInputs, false);

    expect((EntitySessionService as any).generateGreeting).toHaveBeenCalledWith({
      entityId: partnerEntityId,
      targetEntityId: ownEntityId,
      interactionId: 'ix-test',
      mode: 'directed',
      guided: guidedInputs,
    });
  });

  it('shimmer while in flight → arrived greeting after resolve', async () => {
    let resolveGenerate: (v: any) => void = () => {};
    (EntitySessionService as any).generateGreeting.mockImplementation(
      () =>
        new Promise(res => {
          resolveGenerate = res;
        }),
    );

    const utils = await renderScreen();
    await openSheetAndGenerate(utils, null, false);

    // Preparing: GreetingShimmer + "Preparing the opening…" (GreetingBubble
    // `preparing` state + caption).
    expect(utils.getByTestId('scenario-preparing')).toBeTruthy();
    expect(utils.getByTestId('greeting-bubble-preparing')).toBeTruthy();
    expect(utils.getByTestId('scenario-preparing-text').props.children).toBe(
      'scenario:preparingOpening',
    );

    // New greeting arrives → reload renders it via the swiper (arrived).
    getRecentConversationMessages.mockResolvedValue([
      makeMsg('msg-greeting-new', { type: 'greeting', content: 'Fresh opener' }),
    ]);
    await act(async () => {
      resolveGenerate({ greeting: 'Fresh opener', interactionId: 'ix-test' });
    });

    expect(utils.queryByTestId('scenario-preparing')).toBeNull();
    const swiper = utils.getByTestId('greeting-swiper-mock');
    expect(swiper.props.greetings).toContain('Fresh opener');
  });

  it('failure → non-blocking toast; chat stays as-is', async () => {
    (EntitySessionService as any).generateGreeting.mockRejectedValue(
      new Error('backend down'),
    );

    const utils = await renderScreen();
    await openSheetAndGenerate(utils, null, false);

    // Platform is 'ios' in tests → showAlert (non-blocking).
    expect(mockShowAlert).toHaveBeenCalledTimes(1);
    expect(mockShowAlert).toHaveBeenCalledWith(
      'scenario:title',
      'scenario:generateFailedBackend',
      [{ text: 'common:ok' }],
    );

    // No fabrication — the chat stays as-is (empty-chat pill still present).
    expect(utils.queryByTestId('scenario-preparing')).toBeNull();
    expect(utils.getByTestId('empty-chat-cta-pill')).toBeTruthy();
  });

  it('mid-conversation: Generate → START_NEW_SCENARIO (restart) + blocking sync + interaction swap', async () => {
    (EntitySessionService as any).startNewScenario.mockResolvedValue({
      greeting: 'Restarted opener',
      interactionId: 'ix-new',
    });
    getRecentConversationMessages.mockResolvedValue([greetingMsg, userMsg]);

    const utils = await renderScreen();
    // Greeting is messages[0] → the greeting-wrap ✨ pill shows (has_first_mes
    // true keeps the empty-chat hint away).
    await emitSessionStarted(true);

    await fireEvent.press(utils.getByTestId('empty-chat-cta-pill'));
    await act(async () => {
      utils.getByTestId('scenario-generator-sheet').props.onGenerate(guidedInputs);
    });

    // Restart path — not replace.
    expect((EntitySessionService as any).generateGreeting).not.toHaveBeenCalled();
    expect((EntitySessionService as any).startNewScenario).toHaveBeenCalledTimes(1);
    expect((EntitySessionService as any).startNewScenario).toHaveBeenCalledWith({
      entityId: partnerEntityId,
      targetEntityId: ownEntityId,
      mode: 'directed',
      guided: guidedInputs,
    });

    // Blocking sync fetched the new interaction before unblocking.
    expect(syncAndWait).toHaveBeenCalled();
    expect(getRecentConversationMessages).toHaveBeenCalledWith(
      ownEntityId,
      'pk',
      200,
    );

    // Interaction-id swap: events for the NEW interaction now route (the
    // message:received listener compares against the swapped ref).
    getRecentConversationMessages.mockClear();
    getRecentConversationMessages.mockResolvedValue([
      makeMsg('msg-new-1', { type: 'greeting', content: 'Restarted opener' }),
    ]);
    await act(async () => {
      (EntitySessionService as any).emit('message:received', 'ix-new');
    });
    expect(getRecentConversationMessages).toHaveBeenCalled();

    expect(utils.queryByTestId('scenario-preparing')).toBeNull();
  });
});

describe('ChatDetailScreen — "new messages" divider derived from first unread (3-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDividerProps.length = 0;
    mockShowAlert.mockClear();
    getRecentConversationMessages.mockResolvedValue([]);
  });

  // helper: a partner/own message with an explicit is_read flag (the page that
  // drives the derived divider now carries is_read from the repo).
  function msgWithIsRead(
    id: string,
    sender: string,
    isRead: boolean,
  ): any {
    const m = makeMsg(id, { sender, content: id });
    m.is_read = isRead;
    return m;
  }

  it('inserts the divider at the FIRST partner-sent unread message', async () => {
    // Oldest → newest: a read partner msg, then the first unread partner msg,
    // then our own reply, then another unread partner msg.
    const p1Read = msgWithIsRead('m-read', partnerEntityId, true);
    const p2Unread = msgWithIsRead('m-first-unread', partnerEntityId, false);
    const ownMsg = msgWithIsRead('m-own', ownEntityId, false);
    const p3Unread = msgWithIsRead('m-last-unread', partnerEntityId, false);
    getRecentConversationMessages.mockResolvedValue([
      p1Read,
      p2Unread,
      ownMsg,
      p3Unread,
    ]);

    await renderScreen();
    await act(async () => {});

    // First unread partner message sits at index 1 → divider before it, with
    // count = messages.length - 1 (everything at-or-after the divider).
    const divider = mockDividerProps.find((p: any) => p && typeof p.count === 'number');
    expect(divider).toBeTruthy();
    expect(divider.count).toBe(3);
  });

  it('renders no divider when every partner message is already read', async () => {
    const p1 = msgWithIsRead('m1', partnerEntityId, true);
    const p2 = msgWithIsRead('m2', partnerEntityId, true);
    const own = msgWithIsRead('m-own', ownEntityId, false);
    getRecentConversationMessages.mockResolvedValue([p1, p2, own]);

    await renderScreen();
    await act(async () => {});

    expect(mockDividerProps).toHaveLength(0);
  });

  it('renders no divider when the FIRST message in the page is unread', async () => {
    // firstUnreadIndex === 0 → no "above/below" split to render (matches the
    // legacy `firstNewPartnerIndex > 0` gate).
    const p1Unread = msgWithIsRead('m-first', partnerEntityId, false);
    const p2Unread = msgWithIsRead('m-second', partnerEntityId, false);
    getRecentConversationMessages.mockResolvedValue([p1Unread, p2Unread]);

    await renderScreen();
    await act(async () => {});

    expect(mockDividerProps).toHaveLength(0);
  });
});
