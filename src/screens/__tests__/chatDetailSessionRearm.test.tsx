/**
 * ChatDetailScreen — session re-arm on focus / app foreground.
 *
 * EntitySessionService deliberately closes every session when the whole app
 * stops (androidx ProcessLifecycleOwner ON_STOP) while the sync connection
 * stays up (D1-5 always-connected), so a foreground return never changes
 * `isConnected` and the init effect (deps include `isConnected`) never re-ran:
 * the open chat stayed dead until a full unmount/remount (owner device,
 * 2026-10-21). These tests pin the re-arm: focus and AppLifecycle `active` both
 * start a session when none exists for this participant set, neither restarts a
 * live one, and unmount still stops (owner-approved teardown-on-leave).
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

/**
 * Latest `useFocusEffect` callbacks (the screen has two: background reload +
 * session re-arm), so a test can simulate "the user came back to this screen"
 * on the already-mounted chat.
 */
const mockFocusCallbacks: Array<() => void | (() => void)> = [];
/** AppLifecycle 'change' handlers the screen subscribed to. */
const mockLifecycleHandlers: Array<(state: string) => void> = [];

/** Active sessions as the context would report them (mutated in place). */
const mockActiveSessions = new Map<string, any>();
const mockStartSession = jest.fn().mockResolvedValue(undefined);
const mockStopSession = jest.fn().mockResolvedValue(undefined);

jest.mock('../../contexts/EntitySessionContext', () => ({
  useEntitySession: () => ({
    // Always "active" for callers that only probe the current interaction —
    // the re-arm uses `activeSessions` (participant-set scoped) instead.
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
    addEventListener: (_event: string, handler: (state: string) => void) => {
      mockLifecycleHandlers.push(handler);
      return {
        remove: () => {
          const at = mockLifecycleHandlers.indexOf(handler);
          if (at >= 0) mockLifecycleHandlers.splice(at, 1);
        },
      };
    },
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


/** A session entry as EntitySessionContext holds it (failed ⇒ terminal). */
function liveSession(id: string, over: Record<string, any> = {}) {
  return {
    interactionId: id,
    ownEntityId,
    participantIds: [ownEntityId, partnerEntityId],
    failed: false,
    connections: new Map(),
    ...over,
  };
}

async function flush() {
  // Drain the init chain: getReplyMode → startInteractionSession → listeners.
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('ChatDetailScreen — session re-arm (focus / foreground)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallbacks.length = 0;
    mockLifecycleHandlers.length = 0;
    mockActiveSessions.clear();
    mockStartSession.mockResolvedValue(undefined);
    mockStopSession.mockResolvedValue(undefined);
    (EntitySessionService as any).getInteractionSession.mockReturnValue(null);
  });

  it('mount still starts once (control), then focus starts again after the teardown', async () => {
    const { unmount } = await renderScreen();
    await flush();
    expect(mockStartSession).toHaveBeenCalledTimes(1);

    // ON_STOP closed every session while the screen stayed mounted (D1-5 keeps
    // sync connected, so the init effect never re-runs on foreground).
    mockActiveSessions.clear();
    mockStartSession.mockClear();

    await act(async () => {
      mockFocusCallbacks.forEach(cb => cb());
    });
    await flush();

    expect(mockStartSession).toHaveBeenCalledWith(ownEntityId, [
      ownEntityId,
      partnerEntityId,
    ], 'realistic');
    await unmount();
  });

  it('re-arms on app foreground (AppLifecycle active) but not on background', async () => {
    const { unmount } = await renderScreen();
    await flush();
    mockStartSession.mockClear();
    mockActiveSessions.clear();

    await act(async () => {
      mockLifecycleHandlers.forEach(handler => handler('background'));
    });
    await flush();
    expect(mockStartSession).not.toHaveBeenCalled();

    await act(async () => {
      mockLifecycleHandlers.forEach(handler => handler('active'));
    });
    await flush();
    expect(mockStartSession).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('does NOT restart a live session (including one still connecting)', async () => {
    const { unmount } = await renderScreen();
    await flush();
    mockStartSession.mockClear();

    // Same participant set, not failed: the re-arm must leave it alone (the
    // service would reuse it anyway — this avoids the pointless INIT wiring).
    mockActiveSessions.set('ix-live', liveSession('ix-live'));

    await act(async () => {
      mockFocusCallbacks.forEach(cb => cb());
    });
    mockLifecycleHandlers.forEach(handler => handler('active'));
    await flush();

    expect(mockStartSession).not.toHaveBeenCalled();
    await unmount();
  });

  it('retries when the retained session is FAILED (terminal, not reusable)', async () => {
    const { unmount } = await renderScreen();
    await flush();
    mockStartSession.mockClear();

    mockActiveSessions.set('ix-failed', liveSession('ix-failed', { failed: true }));

    await act(async () => {
      mockFocusCallbacks.forEach(cb => cb());
    });
    await flush();

    expect(mockStartSession).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('keeps the owner-approved teardown on unmount', async () => {
    const { unmount } = await renderScreen();
    await flush();

    await unmount();

    expect(mockStopSession).toHaveBeenCalledWith('ix-test');
  });
});
