/**
 * ChatDetailScreen — entity context menu: "Set background" entry.
 *
 * The entry sits between Partner/Character settings and Open chat bubble and
 * navigates to the per-entity background picker with the partner ENTITY id
 * (persona-independent scope).
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ChatDetailScreen } from '../ChatDetailScreen';
import EntitySessionService from '../../services/EntitySessionService';

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

jest.mock('../../contexts/EntitySessionContext', () => ({
  useEntitySession: () => ({
    isSessionActive: () => true,
    startInteractionSession: jest.fn().mockResolvedValue(undefined),
    stopInteractionSession: jest.fn(),
    clearFailedSession: jest.fn().mockResolvedValue(undefined),
  }),
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
  const svc = new EventEmitter();
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
  return { __esModule: true, EntitySessionService: svc, default: svc };
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

jest.mock('../../services/ChatBackgroundService', () => ({
  __esModule: true,
  default: {
    loadChatBackground: jest
      .fn()
      .mockResolvedValue({ ref: null, dim: 40, source: null }),
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

const route = {
  key: 'chat-detail-1',
  name: 'ChatDetail',
  params: {
    interactionId: 'ix-test',
    participantKey: 'pk-1',
    participantIds: [ownEntityId, partnerEntityId],
    entityId: ownEntityId,
    entityName: 'Iris',
  },
} as any;

const navigation = { goBack: jest.fn(), navigate: jest.fn() } as any;

async function renderScreen() {
  const utils = await render(<ChatDetailScreen route={route} navigation={navigation} />);
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

describe('ChatDetailScreen — entity menu "Set background"', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (EntitySessionService as any).getInteractionSession.mockReturnValue(null);
  });

  it('renders the entry and navigates to the picker with the partner entity', async () => {
    const { getByTestId, getByText } = await renderScreen();

    await fireEvent.press(getByTestId('chat-entity-menu-button'));

    expect(getByText('setBackground')).toBeTruthy();
    expect(getByText('setBackgroundCaption')).toBeTruthy();

    await fireEvent.press(getByTestId('chat-set-background'));

    expect(navigation.navigate).toHaveBeenCalledWith('ChatBackgroundPicker', {
      entityId: partnerEntityId,
      participantKey: 'pk-1',
      povEntityId: ownEntityId,
    });
  });
});
