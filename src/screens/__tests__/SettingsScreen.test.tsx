/**
 * SettingsScreen — settings-tab regroups, density and value chips.
 *
 * Covers:
 *  - the approved group order (User chat settings / Backup & sync / System);
 *  - the Option-B density rule: single-row cards render NO SectionHeader,
 *    multi-row cards do;
 *  - trailing value chips (voice model, persona count, desktop authority,
 *    engine version);
 *  - navigation: Personas → PersonaList, Voice input → the pinned STT editor
 *    only AFTER the deliberate ensure-link helper resolves;
 *  - the pre-existing push-notification authorization wiring.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

afterEach(cleanup);
beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockResolveVoice.mockResolvedValue({
    status: 'ok',
    configId: 'stt-1',
    modelLabel: 'FasterWhisper',
  });
  mockEnsureVoice.mockResolvedValue({ configId: 'stt-1', created: false });
  mockGetUserEntities.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
  mockGetSyncStatus.mockResolvedValue({
    config: { enabled: true, transport: 'lan' },
    local_authoritative: true,
  });
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('../../utils/haptics', () => ({
  setHapticFeedbackEnabled: jest.fn(),
  hapticLightPress: jest.fn(),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

const mockShowToast = jest.fn();
jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => {
      cb();
    }, []);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/navigation/GlassTabBar', () => ({ TAB_BAR_CONTENT_PAD: 0 }));

jest.mock('../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../components/themed/SectionHeader', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    SectionHeader: ({ title }: any) =>
      React.createElement(Text, { testID: `section-${title}` }, title),
  };
});
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: (props: any) => React.createElement(View, props) };
});

jest.mock('../../components/settings/SettingsRows', () => {
  const React = require('react');
  const { Switch, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    SettingsLinkRow: ({ label, value, onPress }: any) =>
      React.createElement(
        TouchableOpacity,
        { testID: `link-${label}`, onPress },
        React.createElement(Text, null, label),
        value
          ? React.createElement(Text, { testID: `value-${label}` }, value)
          : null,
      ),
    SettingsToggleRow: ({ label, value, onValueChange }: any) =>
      React.createElement(Switch, { testID: `toggle-${label}`, value, onValueChange }),
  };
});

const mockResolveVoice = jest.fn();
const mockEnsureVoice = jest.fn();
jest.mock('../../services/voiceInput/personaVoice', () => ({
  resolvePersonaVoice: (...args: unknown[]) => mockResolveVoice(...args),
  ensurePersonaVoiceConfig: (...args: unknown[]) => mockEnsureVoice(...args),
}));

const mockGetUserEntities = jest.fn();
jest.mock('../../database/repositories', () => ({
  getUserEntities: (...args: unknown[]) => mockGetUserEntities(...args),
}));

const mockGetSyncStatus = jest.fn();
jest.mock('../../services/engine/EngineApiClient', () => ({
  engineApiClient: { getSyncClientStatus: (...args: unknown[]) => mockGetSyncStatus(...args) },
}));

jest.mock('../../services/engine/EngineService', () => ({
  getEngineVersionState: () => ({ engineVersion: '0.3.0-dev' }),
  onEngineVersionStateChange: () => () => {},
}));

const mockRequest = jest.fn();
jest.mock('../../services/notifications/NotificationPermission', () => ({
  requestNotificationPermission: (...args: unknown[]) => mockRequest(...args),
  isNotificationAuthorized: (status: string) =>
    status === 'authorized' || status === 'provisional' || status === 'ephemeral',
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SettingsScreen } from '../SettingsScreen';

const mockSetItem = AsyncStorage.setItem as jest.Mock;

async function renderScreen() {
  const utils = await render(<SettingsScreen />);
  await waitFor(() => expect(utils.getByTestId('toggle-pushNotifications')).toBeTruthy());
  // Let the focus-driven summary reads settle.
  await waitFor(() => expect(utils.getByTestId('value-voiceInput')).toBeTruthy());
  return utils;
}

describe('SettingsScreen — push notification authorization', () => {
  it('requests authorization when the push toggle is enabled', async () => {
    mockRequest.mockResolvedValue('authorized');
    const utils = await renderScreen();

    await act(async () => {
      fireEvent(utils.getByTestId('toggle-pushNotifications'), 'valueChange', true);
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockSetItem).toHaveBeenCalledWith('@soulbits_setting_push_notifications', 'true');
  });

  it('surfaces the i18n hint when authorization is denied', async () => {
    mockRequest.mockResolvedValue('denied');
    const utils = await renderScreen();

    await act(async () => {
      fireEvent(utils.getByTestId('toggle-pushNotifications'), 'valueChange', true);
    });

    expect(mockShowToast).toHaveBeenCalledWith('notificationsPermissionDenied');
  });

  it('does not request authorization when the toggle is disabled', async () => {
    const utils = await renderScreen();

    await act(async () => {
      fireEvent(utils.getByTestId('toggle-pushNotifications'), 'valueChange', false);
    });

    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockSetItem).toHaveBeenCalledWith('@soulbits_setting_push_notifications', 'false');
  });
});

describe('SettingsScreen — approved groups (Option B density)', () => {
  it('keeps headers ONLY on multi-row cards', async () => {
    const utils = await renderScreen();

    // Multi-row groups.
    expect(utils.getByTestId('section-userChatGroup')).toBeTruthy();
    expect(utils.getByTestId('section-backupSyncGroup')).toBeTruthy();
    expect(utils.getByTestId('section-systemGroup')).toBeTruthy();
    expect(utils.getByTestId('section-notifications')).toBeTruthy();

    // Single-row cards: no header (label still renders on the row itself).
    expect(utils.queryByTestId('section-account')).toBeNull();
    expect(utils.queryByTestId('section-appearance')).toBeNull();
    expect(utils.queryByTestId('section-providers')).toBeNull();
    expect(utils.queryByTestId('section-support')).toBeNull();
  });

  it('renders the regrouped rows and drops the retired group keys', async () => {
    const utils = await renderScreen();

    expect(utils.getByTestId('link-voiceInput')).toBeTruthy();
    expect(utils.getByTestId('link-personas')).toBeTruthy();
    expect(utils.getByTestId('link-backup')).toBeTruthy();
    expect(utils.getByTestId('link-desktopSync')).toBeTruthy();
    expect(utils.getByTestId('link-engineStatus')).toBeTruthy();
    expect(utils.getByTestId('link-engineLogs')).toBeTruthy();
    expect(utils.getByTestId('link-appLogs')).toBeTruthy();
  });
});

describe('SettingsScreen — trailing value chips', () => {
  it('shows the voice model, persona count, desktop authority and engine version', async () => {
    const utils = await renderScreen();

    expect(utils.getByTestId('value-voiceInput').props.children).toBe('FasterWhisper');
    expect(utils.getByTestId('value-personas').props.children).toBe('2');
    expect(utils.getByTestId('value-desktopSync').props.children).toBe('authorityThisDevice');
    expect(utils.getByTestId('value-engineStatus').props.children).toBe('0.3.0-dev');
  });

  it('shows "off" when voice input resolves OFF', async () => {
    mockResolveVoice.mockResolvedValue({ status: 'off', configId: 'stt-disabled' });

    const utils = await renderScreen();

    expect(utils.getByTestId('value-voiceInput').props.children).toBe('off');
  });

  it('omits the desktop-sync chip when the status read fails', async () => {
    mockGetSyncStatus.mockRejectedValue(new Error('engine offline'));

    const utils = await renderScreen();

    expect(utils.queryByTestId('value-desktopSync')).toBeNull();
  });
});

describe('SettingsScreen — honest cloud-auth chip (2026-10-23 incident)', () => {
  it('says the cloud sign-in expired instead of naming an authority', async () => {
    mockGetSyncStatus.mockResolvedValue({
      state: 'auth_needed',
      relay: null,
      config: { enabled: true, transport: 'relay' },
      local_authoritative: false,
    });

    const utils = await renderScreen();

    await waitFor(() =>
      expect(utils.getByTestId('value-desktopSync').props.children).toBe('cloudSignInExpired'),
    );
  });

  it('also reports it when only the relay bridge flags auth_needed', async () => {
    mockGetSyncStatus.mockResolvedValue({
      state: 'backoff',
      relay: { auth_needed: true },
      config: { enabled: true, transport: 'relay' },
      local_authoritative: false,
    });

    const utils = await renderScreen();

    await waitFor(() =>
      expect(utils.getByTestId('value-desktopSync').props.children).toBe('cloudSignInExpired'),
    );
  });

  it('keeps the authority label when the relay is healthy', async () => {
    mockGetSyncStatus.mockResolvedValue({
      state: 'syncing',
      relay: { auth_needed: false },
      config: { enabled: true, transport: 'relay' },
      local_authoritative: false,
    });

    const utils = await renderScreen();

    await waitFor(() =>
      expect(utils.getByTestId('value-desktopSync').props.children).toBe('authorityPeer'),
    );
  });
});

describe('SettingsScreen — navigation', () => {
  it('Personas navigates to the dedicated list screen', async () => {
    const utils = await renderScreen();

    fireEvent.press(utils.getByTestId('link-personas'));

    expect(mockNavigate).toHaveBeenCalledWith('PersonaList');
  });

  it('Voice input ensures the fixed config, then opens the pinned STT editor', async () => {
    const utils = await renderScreen();

    fireEvent.press(utils.getByTestId('link-voiceInput'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('ModuleConfigEdit', {
        moduleType: 'stt',
        configId: 'stt-1',
      }),
    );
    expect(mockEnsureVoice).toHaveBeenCalledTimes(1);
  });

  it('surfaces the engine-unavailable hint and does not navigate when ensure fails', async () => {
    mockEnsureVoice.mockRejectedValue(new Error('no user entity'));

    const utils = await renderScreen();

    fireEvent.press(utils.getByTestId('link-voiceInput'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('voiceInputUnavailable'));
    expect(mockNavigate).not.toHaveBeenCalledWith('ModuleConfigEdit', expect.anything());
  });
});
