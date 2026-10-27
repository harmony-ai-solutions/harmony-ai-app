/**
 * ChatDetailScreen — image sends from the single main send button
 * (owner report, 2026-10-27).
 *
 * `handleSendImages` now accepts the composer caption and attaches it to the
 * LAST image only: the transcript then reads like a caption under the image
 * stack (rapid-fire utterances merge into one engine turn).
 *
 * The ChatInputBar double exposes the real props, so the test drives the exact
 * callback the bar would call after the parent accepts the send.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ChatDetailScreen } from '../ChatDetailScreen';
import EntitySessionService from '../../services/EntitySessionService';

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
    activeSessions: new Map(),
    startInteractionSession: jest.fn().mockResolvedValue(undefined),
    stopInteractionSession: jest.fn(),
    clearFailedSession: jest.fn().mockResolvedValue(undefined),
  }),
}));

let mockPendingRows: any[] = [];

jest.mock('../../services/EntitySessionService', () => {
  const { EventEmitter } = require('eventemitter3');
  const svc = new EventEmitter();
  svc.generateGreeting = jest.fn();
  svc.startNewScenario = jest.fn();
  svc.getInteractionSession = jest.fn().mockReturnValue(null);
  svc.isTranscriptionFailed = jest.fn().mockReturnValue(false);
  svc.registerOpenConversation = jest.fn();
  svc.unregisterOpenConversation = jest.fn();
  svc.getPendingMessages = jest.fn(() => mockPendingRows);
  svc.reconcilePendingMessages = jest.fn();
  svc.clearPendingMessages = jest.fn();
  svc.patchPendingMessage = jest.fn();
  svc.sendImageMessage = jest.fn().mockResolvedValue(undefined);
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
  deriveScopeFromParticipants: jest.fn().mockReturnValue('private'),
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
  return {
    __esModule: true,
    ChatInputBar: (props: any) =>
      React.createElement(View, { testID: 'chat-input-mock', ...props }),
  };
});

jest.mock('../../components/chat/TypingIndicator', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, TypingIndicator: () => React.createElement(View, { testID: 'typing-indicator-mock' }) };
});

jest.mock('../../components/chat/NewMessagesDivider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, NewMessagesDivider: () => React.createElement(View, { testID: 'new-messages-divider-mock' }) };
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
  return { __esModule: true, GreetingBubble: () => React.createElement(View, { testID: 'greeting-bubble-mock' }) };
});

jest.mock('../../components/chat/ScenarioGeneratorSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScenarioGeneratorSheet: (props: any) => React.createElement(View, { testID: 'scenario-generator-sheet', ...props }) };
});

const ownEntityId = 'user-entity';
const partnerEntityId = 'char-entity';
const OWN_INTERACTION_ID = 'ix-user-pov';

const route = {
  key: 'chat-detail-1',
  name: 'ChatDetail',
  params: {
    interactionId: OWN_INTERACTION_ID,
    participantKey: 'pk',
    participantIds: [ownEntityId, partnerEntityId],
    entityId: ownEntityId,
    entityName: 'Claire',
  },
} as any;
const navigation = { goBack: jest.fn(), navigate: jest.fn() } as any;

async function renderScreen() {
  return render(<ChatDetailScreen route={route} navigation={navigation} />);
}

const sendImageMessage = (EntitySessionService as any).sendImageMessage as jest.Mock;

describe('ChatDetailScreen — image send caption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPendingRows = [];
    sendImageMessage.mockResolvedValue(undefined);
  });

  it('attaches the caption to the LAST image only', async () => {
    const utils = await renderScreen();
    const inputBar = utils.getByTestId('chat-input-mock');

    await act(async () => {
      await inputBar.props.onSendImages(
        [
          { base64: 'b64-a', mimeType: 'image/png' },
          { base64: 'b64-b', mimeType: 'image/jpeg' },
        ],
        'Under the stack',
      );
    });

    expect(sendImageMessage).toHaveBeenCalledTimes(2);
    expect(sendImageMessage).toHaveBeenNthCalledWith(
      1,
      OWN_INTERACTION_ID,
      'b64-a',
      'image/png',
    );
    expect(sendImageMessage).toHaveBeenNthCalledWith(
      2,
      OWN_INTERACTION_ID,
      'b64-b',
      'image/jpeg',
      'Under the stack',
    );
  });

  it('sends images with no caption call unchanged (3 args on the last image too)', async () => {
    const utils = await renderScreen();
    const inputBar = utils.getByTestId('chat-input-mock');

    await act(async () => {
      await inputBar.props.onSendImages([{ base64: 'b64-a', mimeType: 'image/png' }]);
    });

    expect(sendImageMessage).toHaveBeenCalledTimes(1);
    expect(sendImageMessage).toHaveBeenNthCalledWith(
      1,
      OWN_INTERACTION_ID,
      'b64-a',
      'image/png',
    );
  });
});
