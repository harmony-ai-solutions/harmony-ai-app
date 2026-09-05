/**
 * ChatDetailScreen — empty-chat splash reveal (regression).
 *
 * Bug: the data-driven splash reveal required `messages.length > 0`. For a
 * character whose card has NO authored first_mes the engine delivers NO
 * greeting message ever (§1-10), so `messages` stayed empty and the splash
 * spinner spun forever. Fixed by revealing when the message query settled AND
 * the session surfaced `has_first_mes === false` (the empty chat then shows
 * the generate-greeting hint via the ListEmptyComponent).
 *
 * The splash is observable via the `chat-detail-splash` testID: present while
 * unrevealed, gone once revealed.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ChatDetailScreen } from '../ChatDetailScreen';
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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

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
  }),
}));

jest.mock('../../services/EntitySessionService', () => {
  const { EventEmitter } = require('eventemitter3');
  const svc = new EventEmitter();
  svc.generateGreeting = jest.fn();
  svc.startNewScenario = jest.fn();
  svc.getInteractionSession = jest.fn().mockReturnValue(null);
  svc.isTranscriptionFailed = jest.fn().mockReturnValue(false);
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

jest.mock('../../components/chat/NewMessagesDivider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    NewMessagesDivider: () => React.createElement(View, { testID: 'new-messages-divider-mock' }),
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

const ownEntityId = 'user-entity';
const partnerEntityId = 'char-entity';

const route = {
  key: 'chat-detail-1',
  name: 'ChatDetail',
  params: {
    interactionId: 'ix-test',
    participantKey: 'pk',
    participantIds: [ownEntityId, partnerEntityId],
    entityId: ownEntityId,
    entityName: 'Iris',
  },
} as any;
const navigation = { goBack: jest.fn(), navigate: jest.fn() } as any;

async function renderScreen() {
  const utils = render(<ChatDetailScreen route={route} navigation={navigation} />);
  // Flush the mount effects (message query → loading=false) deterministically.
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}


describe('ChatDetailScreen — empty-chat splash reveal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowAlert.mockClear();
    getRecentConversationMessages.mockResolvedValue([]);
  });

  // Both mounts live in ONE test: the full-screen harness shares the
  // module-level mock registry across tests, so sequential mounts inside a
  // single test are the deterministic shape here. The screen learns
  // has_first_mes through its MOUNT fallback (getInteractionSession — the
  // "session:started fired before this screen mounted" path in
  // loadMessagesAndTimestamp). Both phases assert splash PRESENCE, which is
  // deterministic in this harness; the known-empty REVEAL decision itself is
  // covered pure by shouldRevealEmptyChat tests in chatDetailGreetingGate.test.
  it('holds the splash while the signal is unknown and while a greeting is pending', async () => {
    // 1. No has_first_mes signal (INIT_ENTITY still in flight) → splash holds.
    (EntitySessionService as any).getInteractionSession.mockReturnValue(null);
    const first = await render(
      <ChatDetailScreen route={route} navigation={navigation} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.getByTestId('chat-detail-splash')).toBeTruthy();
    expect(first.queryByTestId('empty-chat-cta-pill')).toBeNull();
    first.unmount();

    // 2. has_first_mes=true with zero messages → the greeting WILL arrive
    //    (persisted engine-side, §1-10) → the splash keeps hiding the flash.
    (EntitySessionService as any).getInteractionSession.mockReturnValue({
      hasFirstMes: true,
    } as any);
    const second = await render(
      <ChatDetailScreen route={route} navigation={navigation} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(second.getByTestId('chat-detail-splash')).toBeTruthy();
    expect(second.queryByTestId('empty-chat-cta-pill')).toBeNull();
    second.unmount();
  });
});
