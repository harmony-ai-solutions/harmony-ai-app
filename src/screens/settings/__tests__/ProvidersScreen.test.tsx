/**
 * ProvidersScreen — account management surface (provider-registry 6-2).
 *
 * Covers grouping + masking, the in-use badge, the "Test key" verify chip +
 * payload, the delete 409 `referencing_configs` alert, and the add flow
 * (create + auto-verify). The AccountForm itself is covered separately.
 */

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ProvidersScreen } from '../ProvidersScreen';
import { setAppVariantForTests } from '../../../config/appVariant';

const mockShowAlert = jest.fn();
const mockShowToast = jest.fn();

afterEach(async () => {
  await cleanup();
  setAppVariantForTests(null);
  jest.clearAllMocks();
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars
        ? `${key}(${Object.entries(vars)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')})`
        : key,
  }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
    useFocusEffect: (cb: () => void) => {
      React.useEffect(() => {
        cb();
      }, []);
    },
  };
});

jest.mock('../../../contexts/ThemeContext', () => ({
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

jest.mock('../../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

jest.mock('../../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('../../../components/navigation/GlassTabBar', () => ({ TAB_BAR_CONTENT_PAD: 120 }));

// Themed primitives → plain RN views/text so no gradient machinery is needed.
jest.mock('../../../components/themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, ...p }: any) => React.createElement(Text, p, children) };
});
jest.mock('../../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, ...p }: any) => React.createElement(View, p, children) };
});
jest.mock('../../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, ...p }: any) => React.createElement(View, p, children) };
});
jest.mock('../../../components/themed/SectionHeader', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    SectionHeader: ({ title }: any) => React.createElement(View, null, React.createElement(Text, null, title)),
  };
});
jest.mock('../../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ScreenHeader: ({ title, right }: any) =>
      React.createElement(View, null, React.createElement(Text, null, title), right),
  };
});

// The account form is exercised in its own suite — here it is a submit seam.
jest.mock('../../../components/providers/AccountForm', () => {
  const React = require('react');
  const { View, TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    AccountForm: ({ type, onSubmit, onCancel }: any) =>
      React.createElement(
        View,
        { testID: 'account-form' },
        React.createElement(Text, null, `form:${type}`),
        React.createElement(
          TouchableOpacity,
          {
            testID: 'account-form-submit',
            onPress: () => onSubmit({ name: 'New', api_key: 'sk-new', base_url: 'http://x' }),
          },
          React.createElement(Text, null, 'submit'),
        ),
        React.createElement(
          TouchableOpacity,
          { testID: 'account-form-cancel', onPress: onCancel },
          React.createElement(Text, null, 'cancel'),
        ),
      ),
  };
});

jest.mock('../../../services/engine/EngineApiClient', () => ({
  engineApiClient: { verifyProvider: jest.fn() },
}));

jest.mock('../../../services/engine/repositories/providers', () => {
  class ProviderInUseError extends Error {
    referencingConfigs: any[];
    constructor(_id: string, refs: any[]) {
      super('in use');
      this.name = 'ProviderInUseError';
      this.referencingConfigs = refs;
    }
  }
  return {
    ProviderInUseError,
    listAccounts: jest.fn(),
    isAccountInUse: jest.fn(),
    createAccount: jest.fn(),
    updateAccount: jest.fn(),
    deleteAccount: jest.fn(),
  };
});

import { engineApiClient } from '../../../services/engine/EngineApiClient';
import * as providersRepo from '../../../services/engine/repositories/providers';

const account = (over: Record<string, unknown> = {}) => ({
  id: 'acc1',
  type: 'openai',
  name: 'Work',
  api_key: 'sk-abcdefgh1234',
  base_url: '',
  extra: '{}',
  created_at: null,
  updated_at: null,
  deleted_at: null,
  ...over,
});

async function renderScreen() {
  const utils = await render(<ProvidersScreen />);
  await waitFor(() => expect(utils.getByTestId('providers-add')).toBeTruthy());
  return utils;
}

beforeEach(() => {
  (providersRepo.listAccounts as jest.Mock).mockResolvedValue([account()]);
  (providersRepo.isAccountInUse as jest.Mock).mockResolvedValue(false);
  (providersRepo.createAccount as jest.Mock).mockResolvedValue('new-id');
  (providersRepo.updateAccount as jest.Mock).mockResolvedValue(undefined);
  (providersRepo.deleteAccount as jest.Mock).mockResolvedValue(undefined);
  (engineApiClient.verifyProvider as jest.Mock).mockResolvedValue({ state: 'valid' });
});

describe('ProvidersScreen — list, grouping, masking', () => {
  it('groups accounts by provider type and masks the key', async () => {
    (providersRepo.listAccounts as jest.Mock).mockResolvedValue([
      account(),
      account({ id: 'acc2', type: 'openai', name: 'Personal', api_key: 'sk-zzz', base_url: 'https://proxy.example/v1' }),
      account({ id: 'acc3', type: 'soulvoice', name: 'Local speech', api_key: '', base_url: 'http://localhost:5000' }),
    ]);
    const utils = await renderScreen();

    await waitFor(() => expect(utils.getByText('OpenAI')).toBeTruthy());
    expect(utils.getByText('Soulvoice')).toBeTruthy();

    // Masked key + keyless label.
    expect(utils.getByText('sk-…1234')).toBeTruthy();
    expect(utils.getByText('keyless')).toBeTruthy();

    // base_url shown when set.
    expect(utils.getByText('https://proxy.example/v1')).toBeTruthy();
  });

  it('renders the empty state with no accounts', async () => {
    (providersRepo.listAccounts as jest.Mock).mockResolvedValue([]);
    const utils = await renderScreen();
    await waitFor(() => expect(utils.getByText('empty')).toBeTruthy());
  });

  it('filters to soulbitscloud only in the store variant', async () => {
    setAppVariantForTests('store');
    (providersRepo.listAccounts as jest.Mock).mockResolvedValue([
      account(),
      account({ id: 'acc3', type: 'soulbitscloud', name: 'Cloud', api_key: 'paseto' }),
    ]);
    const utils = await renderScreen();

    await waitFor(() => expect(utils.getByText('Soulbits Cloud')).toBeTruthy());
    expect(utils.queryByText('OpenAI')).toBeNull();
  });
});

describe('ProvidersScreen — in-use badge', () => {
  it('badges accounts referenced by a live module config', async () => {
    (providersRepo.isAccountInUse as jest.Mock).mockResolvedValue(true);
    const utils = await renderScreen();
    await waitFor(() => expect(utils.getByTestId('in-use-acc1')).toBeTruthy());
  });
});

describe('ProvidersScreen — Test key (verify)', () => {
  it('shows the valid chip + payload extras', async () => {
    (engineApiClient.verifyProvider as jest.Mock).mockResolvedValue({
      state: 'valid',
      payload: { tier: 'starter', version: '1.2.3' },
    });
    const utils = await renderScreen();

    await fireEvent.press(utils.getByTestId('test-key-acc1'));

    await waitFor(() => expect(utils.getByText('verifyState.valid')).toBeTruthy());
    expect(engineApiClient.verifyProvider).toHaveBeenCalledWith({
      type: 'openai',
      api_key: 'sk-abcdefgh1234',
      extra: {},
    });
    expect(utils.getByTestId('verify-payload-acc1')).toBeTruthy();
    expect(utils.getByText(/version: 1\.2\.3/)).toBeTruthy();
  });

  it('renders the ElevenLabs character bar from the payload', async () => {
    (providersRepo.listAccounts as jest.Mock).mockResolvedValue([
      account({ type: 'elevenlabs', name: 'Voice', api_key: 'el-key' }),
    ]);
    (engineApiClient.verifyProvider as jest.Mock).mockResolvedValue({
      state: 'throttled',
      payload: { character_count: 17231, character_limit: 100000 },
    });
    const utils = await renderScreen();

    await fireEvent.press(utils.getByTestId('test-key-acc1'));
    await waitFor(() => expect(utils.getByText('verifyState.throttled')).toBeTruthy());
    expect(utils.getByTestId('verify-charbar-acc1')).toBeTruthy();
  });

  it('maps a transport failure to the unreachable chip', async () => {
    (engineApiClient.verifyProvider as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
    const utils = await renderScreen();

    await fireEvent.press(utils.getByTestId('test-key-acc1'));
    await waitFor(() => expect(utils.getByText('verifyState.unreachable')).toBeTruthy());
  });
});

describe('ProvidersScreen — delete + 409 referencing configs', () => {
  it('lists referencing_configs from the 409 body', async () => {
    (providersRepo.deleteAccount as jest.Mock).mockRejectedValue(
      new providersRepo.ProviderInUseError('acc1', [
        { module: 'backend', name: 'Main chat', id: 'mc1' },
      ]),
    );
    const utils = await renderScreen();

    await fireEvent.press(utils.getByTestId('delete-acc1'));

    // First alert: confirm.
    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledTimes(1));
    expect(mockShowAlert.mock.calls[0][0]).toBe('deleteTitle');

    // Trigger the destructive confirm button.
    const buttons = mockShowAlert.mock.calls[0][2] as Array<{ style?: string; onPress?: () => void }>;
    const destructive = buttons.find(b => b.style === 'destructive');
    destructive?.onPress?.();

    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledTimes(2));
    const [title, message] = mockShowAlert.mock.calls[1];
    expect(title).toBe('deleteInUseTitle');
    expect(String(message)).toContain('backend');
    expect(String(message)).toContain('Main chat');
  });

  it('deletes a free account and toasts', async () => {
    (providersRepo.deleteAccount as jest.Mock).mockResolvedValue(undefined);
    const utils = await renderScreen();

    await fireEvent.press(utils.getByTestId('delete-acc1'));
    await waitFor(() => expect(mockShowAlert).toHaveBeenCalledTimes(1));
    const buttons = mockShowAlert.mock.calls[0][2] as Array<{ style?: string; onPress?: () => void }>;
    buttons.find(b => b.style === 'destructive')?.onPress?.();

    await waitFor(() => expect(providersRepo.deleteAccount).toHaveBeenCalledWith('acc1'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('deletedToast'));
  });
});

describe('ProvidersScreen — add flow (create + auto-verify)', () => {
  it('creates an account and auto-runs the key check once', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByTestId('providers-add'));
    await waitFor(() => expect(utils.getByTestId('account-type-picker')).toBeTruthy());

    await fireEvent.press(utils.getByTestId('account-type-openai'));
    await waitFor(() => expect(utils.getByTestId('account-form')).toBeTruthy());

    await fireEvent.press(utils.getByTestId('account-form-submit'));

    await waitFor(() =>
      expect(providersRepo.createAccount).toHaveBeenCalledWith('openai', {
        name: 'New',
        api_key: 'sk-new',
        base_url: 'http://x',
      }),
    );
    await waitFor(() => expect(engineApiClient.verifyProvider).toHaveBeenCalledTimes(1));
  });
});
