/**
 * ChatDetailScreen — emoji action scope (entity id, NOT interaction id).
 *
 * The engine scopes emoji actions by ENTITY: `emoji_actions.entity_id → entities(id)`
 * is a real FK. ChatDetailScreen used to pass `currentInteractionIdRef.current`
 * (an INTERACTION id) to EntityEmojiActionService at three sites, which produced
 * two silent production failures (owner device, 2026-10-21):
 *
 *   1. seedDefaults(interactionId) — every row was rejected with
 *      "EngineApiError: FOREIGN KEY constraint failed" (app log spam:
 *      "Failed to seed emoji action defaults: …"; engine log: "Failed to create
 *      emoji action … FOREIGN KEY constraint failed").
 *   2. resolveMessageActions(interactionId, text) — always resolved an EMPTY
 *      action map, so emoji → RP substitution and `additional_effects` never
 *      fired. The messages went out with the raw emoji and no emotion deltas.
 *
 * The picker already did it right with the own entity (ChatInputBar is given
 * `entityId={ownEntityId}` → EmojiPickerInline → getActionsMap(entityId)), and
 * these tests pin that the two send paths and the seeder now match it.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ChatDetailScreen } from '../ChatDetailScreen';
import EntitySessionService from '../../services/EntitySessionService';
import EntityEmojiActionService from '../../services/EntityEmojiActionService';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const THEME = {
  colors: {
    accent: {
      primary: '#b84fd0',
      secondary: '#4a5fcf',
      primaryHover: '#a13fbb',
      secondaryHover: '#3d4fb0',
    },
    background: { base: '#0b0f19', surface: '#0f1525', elevated: '#151d30', hover: '#1a2138' },
    border: { default: '#2a3350', focus: '#b84fd0', hover: '#3a4568', accent: '#b84fd0' },
    text: { primary: '#f0edf6', secondary: '#c9c5da', muted: '#9692b0', disabled: '#555' },
    status: { error: '#ef4444', success: '#22c55e', warning: '#f59e0b', info: '#3b82f6' },
    gradients: { primary: '', secondary: '', surface: '' },
    glass: {
      cardOpacity: 0.5,
      glowOpacity: 0.08,
      glowRadius: 14,
      borderGradientStart: 'rgba(255,255,255,0.4)',
      borderGradientEnd: 'rgba(184,79,208,0.4)',
    },
    typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
  },
} as any;

jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: THEME }),
}));

jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: jest.fn() }),
}));

jest.mock('../../contexts/SyncConnectionContext', () => ({
  useSyncConnection: () => ({ isConnected: true }),
}));

const mockFocusCallbacks: Array<() => void | (() => void)> = [];

/** Active sessions as the context reports them (pre-populated per test). */
const mockActiveSessions = new Map<string, any>();
const mockStartSession = jest.fn().mockResolvedValue(undefined);
const mockStopSession = jest.fn().mockResolvedValue(undefined);

jest.mock('../../contexts/EntitySessionContext', () => ({
  useEntitySession: () => ({
    isSessionActive: (interactionId: string) =>
      mockActiveSessions.has(interactionId),
    activeSessions: mockActiveSessions,
    startInteractionSession: mockStartSession,
    stopInteractionSession: mockStopSession,
    clearFailedSession: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('react-native-applifecycle', () => ({
  AppLifecycle: {
    addEventListener: () => ({ remove: jest.fn() }),
    currentState: 'active',
    isAvailable: true,
  },
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn() }),
    useFocusEffect: (cb: () => void) => {
      mockFocusCallbacks.push(cb);
      React.useEffect(cb, [cb]);
    },
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

jest.mock('../../utils/haptics', () => ({
  hapticLightPress: jest.fn(),
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

jest.mock('../../services/EntitySessionService', () => {
  const { EventEmitter } = require('eventemitter3');
  const svc: any = new EventEmitter();
  svc.generateGreeting = jest.fn();
  svc.startNewScenario = jest.fn();
  svc.getInteractionSession = jest.fn().mockReturnValue(null);
  svc.isTranscriptionFailed = jest.fn().mockReturnValue(false);
  svc.registerOpenConversation = jest.fn();
  svc.unregisterOpenConversation = jest.fn();
  svc.getPendingMessages = jest.fn().mockReturnValue([]);
  svc.reconcilePendingMessages = jest.fn();
  svc.clearPendingMessages = jest.fn();
  svc.patchPendingMessage = jest.fn();
  // The text send path these tests drive.
  svc.sendTextMessage = jest.fn().mockResolvedValue(undefined);
  return { __esModule: true, EntitySessionService: svc, default: svc };
});

jest.mock('../../services/EntityEmojiActionService', () => ({
  __esModule: true,
  default: {
    seedDefaults: jest.fn().mockResolvedValue(0),
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

jest.mock('../../services/ChatBackgroundService', () => ({
  __esModule: true,
  default: {
    loadChatBackground: jest
      .fn()
      .mockResolvedValue({ ref: null, dim: 40, transparency: 100, source: null }),
  },
}));

jest.mock('../../services/engine/repositories/conversation_messages', () => ({
  getConversationMessagesByParticipantKey: jest.fn().mockResolvedValue([]),
  getRecentConversationMessages: jest.fn().mockResolvedValue([]),
  updateConversationMessage: jest.fn().mockResolvedValue(undefined),
  getConversationMessage: jest.fn().mockResolvedValue(null),
  deleteConversationMessage: jest.fn().mockResolvedValue(undefined),
  markConversationMessagesRead: jest.fn().mockResolvedValue(0),
  markConversationMessagesUnread: jest.fn().mockResolvedValue(0),
  getUnreadCountByParticipantKeys: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('../../services/engine/repositories/characters', () => ({
  getPrimaryImage: jest.fn().mockResolvedValue(null),
  getCharacterProfile: jest.fn().mockResolvedValue(null),
  imageToDataURL: jest.fn().mockReturnValue(null),
}));

jest.mock('../../services/engine/repositories/entities', () => ({
  getAllEntities: jest.fn().mockResolvedValue([]),
  deleteEntity: jest.fn().mockResolvedValue(undefined),
  getEntity: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/engine/repositories/interactions', () => ({
  deriveParticipantKey: jest.fn().mockReturnValue('pk'),
  deriveScopeFromParticipants: jest.fn().mockReturnValue('one_on_one'),
}));

jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ScreenHeader: ({ left, right, title }: any) =>
      React.createElement(
        View,
        { testID: 'screen-header-mock' },
        left,
        React.createElement(Text, null, title),
        right,
      ),
  };
});

jest.mock('../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedView: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});

jest.mock('../../components/themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

jest.mock('../../components/chat/ChatBubble', () => ({
  __esModule: true,
  ChatBubble: () => null,
  isPartnerMessage: (m: any, own: string) => m.sender_entity_id !== own,
}));

jest.mock('../../components/chat/ChatInputBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ChatInputBar: (props: any) =>
      React.createElement(View, { testID: 'chat-input-mock', ...props }),
  };
});

jest.mock('../../components/chat/TypingIndicator', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    TypingIndicator: () =>
      React.createElement(View, { testID: 'typing-indicator-mock' }),
  };
});

jest.mock('../../components/chat/NewMessagesDivider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    NewMessagesDivider: () =>
      React.createElement(View, { testID: 'new-messages-divider-mock' }),
  };
});

jest.mock('../../components/emoji/EmojiPickerInline', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    EmojiPickerInline: () =>
      React.createElement(View, { testID: 'emoji-picker-mock' }),
  };
});

jest.mock('../../components/chat/AlternateGreetingSwiper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AlternateGreetingSwiper: (props: any) =>
      React.createElement(View, { testID: 'greeting-swiper-mock', ...props }),
    parseAlternateGreetings: () => [],
  };
});

jest.mock('../../components/chat/GreetingBubble', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    GreetingBubble: ({ state, ...props }: any) =>
      React.createElement(View, {
        testID: `greeting-bubble-${state ?? 'arrived'}`,
        ...props,
      }),
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

const ownEntityId = 'user-entity';
const partnerEntityId = 'char-entity';
/** The route's interaction id — the value that must NEVER reach the service. */
const INTERACTION_ID = 'ix-test';

const route = {
  key: 'chat-detail-emoji',
  name: 'ChatDetail',
  params: {
    interactionId: INTERACTION_ID,
    participantKey: 'pk-1',
    participantIds: [ownEntityId, partnerEntityId],
    entityId: ownEntityId,
    entityName: 'Iris',
  },
} as any;

const navigation = { goBack: jest.fn(), navigate: jest.fn() } as any;

const seedDefaultsMock = EntityEmojiActionService.seedDefaults as jest.Mock;
const resolveActionsMock =
  EntityEmojiActionService.resolveMessageActions as jest.Mock;

/** A live session entry as EntitySessionContext holds it. */
function liveSession(id: string) {
  return {
    interactionId: id,
    ownEntityId,
    participantIds: [ownEntityId, partnerEntityId],
    failed: false,
    connections: new Map([
      [ownEntityId, { connectionId: 'c-user', status: 'active' }],
      [partnerEntityId, { connectionId: 'c-char', status: 'active' }],
    ]),
  };
}

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderScreen() {
  // NOTE: `render` is awaited on purpose — RNTL v14 returns a promise here, and
  // consuming it un-awaited leaves the tree uncommitted, so element queries find
  // nothing (the handler assertions below would silently have no target).
  const utils = await render(
    <ChatDetailScreen route={route} navigation={navigation} />,
  );
  await flush();
  return utils;
}

describe('ChatDetailScreen — emoji actions keyed by the OWN entity id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallbacks.length = 0;
    mockStartSession.mockResolvedValue(undefined);
    mockStopSession.mockResolvedValue(undefined);
    (EntitySessionService as any).getInteractionSession.mockReturnValue(null);
    mockActiveSessions.clear();
    // The session for this chat is already live (the service reuses it), which is
    // the production state when the seed effect runs.
    mockActiveSessions.set(INTERACTION_ID, liveSession(INTERACTION_ID));
  });

  it('seedDefaults receives the own entity id (the engine FK key), never the interaction id', async () => {
    const { unmount } = await renderScreen();

    expect(seedDefaultsMock).toHaveBeenCalled();
    expect(seedDefaultsMock).toHaveBeenCalledWith(ownEntityId);
    // The pre-fix call: dead FK, one failed INSERT per default action.
    expect(seedDefaultsMock).not.toHaveBeenCalledWith(INTERACTION_ID);
    for (const call of seedDefaultsMock.mock.calls) {
      expect(call[0]).toBe(ownEntityId);
    }

    await unmount();
  });

  it('resolveMessageActions receives the own entity id when sending text', async () => {
    const { getByTestId, unmount } = await renderScreen();

    // The composer renders in the hidden-until-revealed content container (the
    // splash overlay is on top until messages settle), so ask for hidden
    // elements explicitly — the handler is wired regardless.
    const inputBar = getByTestId('chat-input-mock', {
      includeHiddenElements: true,
    });

    await act(async () => {
      fireEvent(inputBar, 'onSendText', 'Hello there 🙂');
    });
    await flush();

    expect(resolveActionsMock).toHaveBeenCalled();
    expect(resolveActionsMock).toHaveBeenCalledWith(ownEntityId, 'Hello there 🙂');
    // Pre-fix this resolved an empty map (no substitution, no additional_effects).
    for (const call of resolveActionsMock.mock.calls) {
      expect(call[0]).not.toBe(INTERACTION_ID);
      expect(call[0]).toBe(ownEntityId);
    }

    await unmount();
  });
});
