/**
 * ChatDetailScreen — partner header alias fallback (2-2 UI / D21-8).
 *
 * D21-8: the visible partner name resolves as nickname || profile name ||
 * entity alias — for a PROFILE-LESS partner (no character_profiles row, e.g.
 * a persona entity) the header must show the entity alias, never the bare id
 * or the 'Chat' placeholder. The ruling covers BOTH the `charName` chain
 * ({{char}} macro / greeting swipes) and the `headerName` derivation.
 *
 * Harness note: reuses the chatDetailSessionError harness shape verbatim
 * (module-level mock registry + full-screen render quirks), with two changes:
 * ScreenHeader renders its `title` (the assertion surface for headerName) and
 * MarketplaceService is mocked (the profile-bearing tests cross the chat-lock
 * hard gate).
 */
import React from 'react';
import { act, cleanup, render } from '@testing-library/react-native';
import { ChatDetailScreen } from '../ChatDetailScreen';

afterEach(cleanup);
beforeEach(cleanup);

const mockShowAlert = jest.fn();
const mockShowToast = jest.fn();
const mockStartInteractionSession = jest.fn().mockResolvedValue(undefined);
const mockClearFailedSession = jest.fn().mockResolvedValue(undefined);

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
  useToast: () => ({ showToast: mockShowToast }),
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
    startInteractionSession: mockStartInteractionSession,
    stopInteractionSession: jest.fn().mockResolvedValue(undefined),
    clearFailedSession: mockClearFailedSession,
  }),
}));

jest.mock('../../services/EntitySessionService', () => {
  const { EventEmitter } = require('eventemitter3');
  const svc = new EventEmitter() as any;
  svc.generateGreeting = jest.fn();
  svc.startNewScenario = jest.fn();
  svc.getInteractionSession = jest.fn().mockReturnValue(null);
  svc.isTranscriptionFailed = jest.fn().mockReturnValue(false);
  svc.registerOpenConversation = jest.fn();
  svc.unregisterOpenConversation = jest.fn();
  return {
    __esModule: true,
    EntitySessionService: svc,
    default: svc,
    isIngestionSessionError: (e: string) => e === 'entity_not_defined',
  };
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

// The profile-bearing tests cross the marketplace hard gate — mock it open.
jest.mock('../../services/marketplace/MarketplaceService', () => ({
  __esModule: true,
  isChatLocked: jest.fn().mockResolvedValue(false),
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

jest.mock('../../database/repositories/chatConversationSettings', () => ({
  getReplyMode: jest.fn().mockResolvedValue('realistic'),
}));

// ScreenHeader renders the title (the headerName assertion surface) — the
// sessionError harness drops it, so this file needs the expanded mock.
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ScreenHeader: ({ title, left, titleRight, right }: any) =>
      React.createElement(
        View,
        { testID: 'screen-header-mock' },
        left,
        React.createElement(Text, { testID: 'screen-header-title' }, title),
        titleRight,
        right,
      ),
  };
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

const { getRecentConversationMessages } = require('../../database/repositories/conversation_messages');
const { getAllEntities } = require('../../database/repositories/entities');
const { getCharacterProfile } = require('../../database/repositories/characters');

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

const greetingMsg = makeMsg('msg-greeting', { type: 'greeting', content: 'Hello there!' });

// NO entityName — the route gives the screen no display name, so the header
// must resolve it from the partner entity (D21-8's target scenario).
const route = {
  key: 'chat-detail-1',
  name: 'ChatDetail',
  params: {
    interactionId: 'ix-test',
    participantKey: 'pk',
    participantIds: [ownEntityId, partnerEntityId],
    entityId: ownEntityId,
  },
} as any;
const navigation = { goBack: jest.fn(), navigate: jest.fn() } as any;

async function renderScreen() {
  const utils = await render(<ChatDetailScreen route={route} navigation={navigation} />);
  // Drain the async resolveHeaderName chain (getAllEntities → profile → image).
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return utils;
}

describe('ChatDetailScreen — partner header alias fallback (D21-8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRecentConversationMessages.mockResolvedValue([]);
    (getCharacterProfile as jest.Mock).mockReset().mockResolvedValue(null);
  });

  it('profile-less partner with alias → headerName AND charName show the alias', async () => {
    (getAllEntities as jest.Mock).mockResolvedValue([
      { id: ownEntityId, alias: 'You', character_profile_id: null, entity_type: 'user' },
      { id: partnerEntityId, alias: 'Alias Name', character_profile_id: null, entity_type: 'user' },
    ]);
    getRecentConversationMessages.mockResolvedValue([greetingMsg]);

    const screen = await renderScreen();

    // headerName path — the visible header title.
    expect(screen.getByTestId('screen-header-title').props.children).toBe('Alias Name');
    // charName path — the {{char}} resolution feeding the greeting swipes.
    expect(screen.getByTestId('greeting-swiper-mock').props.charName).toBe('Alias Name');
  });

  it('profile-less partner WITHOUT alias keeps the placeholder header (no regression)', async () => {
    (getAllEntities as jest.Mock).mockResolvedValue([
      { id: partnerEntityId, alias: null, character_profile_id: null, entity_type: 'ai' },
    ]);

    const screen = await renderScreen();

    // No alias, no profile → the initial 'Chat' placeholder stays (unchanged
    // pre-D21-8 behavior; the ruling only adds the alias fallback).
    expect(screen.getByTestId('screen-header-title').props.children).toBe('Chat');
  });

  it('partner WITH profile: profile name beats alias in the chain', async () => {
    (getAllEntities as jest.Mock).mockResolvedValue([
      {
        id: partnerEntityId,
        alias: 'Alias Name',
        character_profile_id: 'profile-1',
        entity_type: 'ai',
      },
    ]);
    (getCharacterProfile as jest.Mock).mockResolvedValue({
      id: 'profile-1',
      name: 'Profile Name',
      nickname: '',
    });

    const screen = await renderScreen();

    expect(screen.getByTestId('screen-header-title').props.children).toBe('Profile Name');
  });

  it('partner WITH profile nickname: nickname wins the chain (nickname || name || alias)', async () => {
    (getAllEntities as jest.Mock).mockResolvedValue([
      {
        id: partnerEntityId,
        alias: 'Alias Name',
        character_profile_id: 'profile-1',
        entity_type: 'ai',
      },
    ]);
    (getCharacterProfile as jest.Mock).mockResolvedValue({
      id: 'profile-1',
      name: 'Profile Name',
      nickname: 'Nick',
    });

    const screen = await renderScreen();

    expect(screen.getByTestId('screen-header-title').props.children).toBe('Nick');
  });
});
