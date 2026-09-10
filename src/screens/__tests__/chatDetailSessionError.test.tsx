/**
 * ChatDetailScreen — terminal session-failure surface (4-3 / D36 + D35).
 *
 * The incident UX: after the service exhausted INIT_ENTITY recovery it
 * DELETED the session; ChatDetail kept showing the amber "Connecting…" dot
 * and the splash never revealed. Now the terminal failure:
 *   1. surfaces an inline error card (disabledBanner visual — Retry / Back,
 *      plus "Sync now" for the ingestion class),
 *   2. switches the header dot to the explicit red `error` state,
 *   3. reveals the splash (no more dead-end overlay),
 *   4. clears the flagged context entry on navigation-back (bounded retention),
 *   5. restores 'connected' when Retry succeeds (session:started).
 *
 * Screen-error matching (review-4 wiring fix, screen side): the emitted id is
 * the SERVICE's temp interactionId (the temp→canonical swap only happens on
 * INIT SUCCESS), so the listener matches by participant set as well.
 *
 * Harness note: this file reuses the chatDetailScenarioGenerate harness shape
 * verbatim (module-level mock registry + full-screen render quirks — see the
 * comments in chatDetailEmptyReveal/chatDetailScenarioGenerate). The header
 * dot lives inside ScreenHeader's `titleRight`, which that harness shape does
 * not render; the 4-state mapping it displays is unit-tested in
 * chatDetailConnectionState.test.ts instead.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ChatDetailScreen } from '../ChatDetailScreen';
import EntitySessionService from '../../services/EntitySessionService';

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
const { syncAndWait } = require('../../services/SyncService').__mockSyncServiceInstance;

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

/** A failed session as the service retains it — matching participant set,
 *  keyed by a service-temp id this screen never saw (the incident's
 *  id-drift: the temp→canonical swap only happens on INIT SUCCESS). */
function failedServiceSession(error: string) {
  return {
    interactionId: 'svc-temp-1',
    interaction: null,
    ownEntityId,
    participantIds: [ownEntityId, partnerEntityId],
    connections: new Map(),
    pendingTranscriptions: new Map(),
    failed: { error, at: 1 },
  };
}

async function renderScreen() {
  return render(<ChatDetailScreen route={route} navigation={navigation} />);
}

function emitSessionError(id: string, error: string) {
  return act(async () => {
    (EntitySessionService as any).emit('session:error', id, error);
  });
}

describe('ChatDetailScreen — terminal session-failure surface (4-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowToast.mockClear();
    getRecentConversationMessages.mockResolvedValue([]);
    (EntitySessionService as any).getInteractionSession.mockReset().mockReturnValue(null);
  });

  it('shows the error card + reveals the splash on a terminal failure (ingestion class)', async () => {
    const screen = await renderScreen();

    (EntitySessionService as any).getInteractionSession.mockReturnValue(
      failedServiceSession('entity_not_defined'),
    );
    await emitSessionError('svc-temp-1', 'entity_not_defined');

    // Splash revealed — no more dead-end overlay.
    expect(screen.queryByTestId('chat-detail-splash')).toBeNull();
    // Error card (disabledBanner visual) with the ingestion sync hint.
    expect(screen.getByTestId('session-error-card')).toBeTruthy();
    expect(screen.getByText('sessionErrorBanner')).toBeTruthy();
    expect(screen.getByText('sessionErrorSyncHint')).toBeTruthy();
    expect(screen.getByTestId('session-error-sync')).toBeTruthy();
    expect(screen.getByTestId('session-error-retry')).toBeTruthy();
    expect(screen.getByTestId('session-error-back')).toBeTruthy();
    // The composer is replaced by the card (nothing can be sent anyway).
    expect(screen.queryByTestId('chat-input-mock')).toBeNull();
  });

  it('shows the card WITHOUT the sync hint for non-ingestion errors', async () => {
    const screen = await renderScreen();

    (EntitySessionService as any).getInteractionSession.mockReturnValue(
      failedServiceSession('Connection lost'),
    );
    await emitSessionError('svc-temp-1', 'Connection lost');

    expect(screen.getByTestId('session-error-card')).toBeTruthy();
    expect(screen.queryByText('sessionErrorSyncHint')).toBeNull();
    expect(screen.queryByTestId('session-error-sync')).toBeNull();
    expect(screen.getByTestId('session-error-retry')).toBeTruthy();
    expect(screen.getByTestId('session-error-back')).toBeTruthy();
  });

  it('matches the failure by PARTICIPANT SET when the emitted id is an unseen temp id', async () => {
    const screen = await renderScreen();

    (EntitySessionService as any).getInteractionSession.mockReturnValue(
      failedServiceSession('boom'),
    );
    await emitSessionError('svc-temp-1', 'boom');
    expect(screen.getByTestId('session-error-card')).toBeTruthy();
  });

  it('ignores failures from unrelated sessions', async () => {
    const screen = await renderScreen();
    // The mount init effect may already have toasted a setup error (the real
    // getReplyMode throws without a DB in this harness) — clear it so this
    // test only observes the unrelated session:error.
    mockShowToast.mockClear();

    // No session matches the emitted id and its id is not this screen's.
    await emitSessionError('some-other-chat', 'boom');
    expect(screen.queryByTestId('session-error-card')).toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('Retry re-invokes startInteractionSession; success (session:started) restores the chat', async () => {
    const screen = await renderScreen();

    (EntitySessionService as any).getInteractionSession.mockReturnValue(
      failedServiceSession('entity_not_defined'),
    );
    await emitSessionError('svc-temp-1', 'entity_not_defined');
    expect(screen.getByTestId('session-error-card')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-error-retry'));
    });
    expect(mockStartInteractionSession).toHaveBeenCalled();

    // Session reaches all-active → session:started for this participant set.
    await act(async () => {
      (EntitySessionService as any).emit('session:started', 'canonical-1', {
        interactionId: 'canonical-1',
        interaction: null,
        ownEntityId,
        participantIds: [ownEntityId, partnerEntityId],
        hasFirstMes: false,
        connections: new Map(),
        pendingTranscriptions: new Map(),
      });
    });

    // Error card gone, composer back.
    expect(screen.queryByTestId('session-error-card')).toBeNull();
    expect(screen.getByTestId('chat-input-mock')).toBeTruthy();
  });

  it('"Sync now" runs syncAndWait then retries (D35 hint action)', async () => {
    const screen = await renderScreen();

    (EntitySessionService as any).getInteractionSession.mockReturnValue(
      failedServiceSession('entity_not_defined'),
    );
    await emitSessionError('svc-temp-1', 'entity_not_defined');
    expect(screen.getByTestId('session-error-card')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-error-sync'));
      // Drain the press → syncAndWait → handleSessionRetry (whose best-effort
      // reply-mode read rejects without a DB here) → start chain.
      await new Promise(res => setTimeout(res, 25));
    });

    expect(syncAndWait).toHaveBeenCalledTimes(1);
    // Mount init (1) + the retry after the sync (2).
    expect(mockStartInteractionSession).toHaveBeenCalledTimes(2);
  });

  it('Back pops navigation', async () => {
    const screen = await renderScreen();

    (EntitySessionService as any).getInteractionSession.mockReturnValue(
      failedServiceSession('boom'),
    );
    await emitSessionError('svc-temp-1', 'boom');

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-error-back'));
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('the entity_disabled branch still toasts + navigates instead of showing the card (Q8)', async () => {
    const screen = await renderScreen();

    (EntitySessionService as any).getInteractionSession.mockReturnValue(
      failedServiceSession('entity_disabled'),
    );
    await emitSessionError('svc-temp-1', 'entity_disabled');

    expect(mockShowToast).toHaveBeenCalledWith('entityDisabledBody');
    expect(screen.queryByTestId('session-error-card')).toBeNull();
  });

  it('navigation-back clears the flagged entry for this participant set (bounded retention)', async () => {
    const screen = await renderScreen();

    (EntitySessionService as any).getInteractionSession.mockReturnValue(
      failedServiceSession('boom'),
    );
    await emitSessionError('svc-temp-1', 'boom');
    mockClearFailedSession.mockClear();

    // The unmount-side cleanup runs asynchronously after unmount() — flush it.
    await act(async () => {
      screen.unmount();
    });

    expect(mockClearFailedSession).toHaveBeenCalledWith(ownEntityId, [
      ownEntityId,
      partnerEntityId,
    ]);
  });
});
