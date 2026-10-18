/**
 * ModuleConfigEditScreen — the 6-3 account-picker + capability-only form flow.
 *
 * Covers the phase doc's component-test list at the screen level:
 *  - the Provider → Account → Capability section flow (account auto-collapse);
 *  - catalog-backed model picker + Custom…;
 *  - the "Add account…" → shared AccountForm create path;
 *  - account-switch revalidation marking (stale refs, never dropped);
 *  - R12 param warnings (hidden in Simple, warned in Advanced);
 *  - the STT dual-slot save round-trip (flat account FK + capability overlay).
 *
 * The screen pulls in the whole repository/context layer, so those are mocked
 * down to the minimum the render paths touch. The capability-registry hook is
 * mocked so the picker options are deterministic; the live-discovery hook is
 * real (its fetch hits the mocked engine client), so debounce/cache are covered.
 */

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { MODEL_STALE_TESTID } from '../../../components/config/CatalogModelSelect';
import type { ModelInfoDto } from '../../../services/engine/EngineApiClient';

afterEach(async () => {
  await cleanup();
});
beforeEach(async () => {
  await cleanup();
  mockModuleType = 'backend';
  mockCatalog = { openai: OPENAI_CATALOG };
  resetPresetsCache();
  clearProviderModelCache();
  (engineApiClient.listPresets as jest.Mock).mockReset().mockResolvedValue({ presets: [] });
  (engineApiClient.getPreset as jest.Mock).mockReset();
  (engineApiClient.getProviderCapabilities as jest.Mock).mockReset();
  (engineApiClient.listProviderModels as jest.Mock)
    .mockReset()
    .mockResolvedValue({ models: [], voices: [] });
  (listAccounts as jest.Mock).mockReset().mockResolvedValue([]);
  (createAccount as jest.Mock).mockReset().mockResolvedValue('acc-new');
  (createSTTConfig as jest.Mock).mockReset().mockResolvedValue('s-new');
  (createBackendConfig as jest.Mock).mockReset().mockResolvedValue('b-new');
});

/** Module type the mocked `useRoute` reports; reset per test. */
let mockModuleType = 'backend';
/** Catalog returned by the mocked capability-registry hook. */
let mockCatalog: Record<string, ModelInfoDto[]> = {};

const OPENAI_CATALOG: ModelInfoDto[] = [
  { id: 'gpt-6-astra', label: 'gpt-6-astra', capabilities: ['chat'], context: 1050000, provenance: 'known' },
  // Declares a param set that omits `temperature` → R12 warning in Advanced.
  { id: 'no-temp-model', label: 'no-temp-model', capabilities: ['chat'], param_support: ['top_p'] },
];

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        glass: { borderGradientStart: '#333333', borderGradientEnd: '#555555', cardOpacity: 0.6 },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
      },
    },
  }),
}));

jest.mock('../../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: jest.fn() }),
}));

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { moduleType: mockModuleType } }),
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => {
      cb();
    }, []);
  },
}));

// Themed primitives → plain RN views so the screen renders without gradients.
jest.mock('../../../components/themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, style, ...p }: any) => React.createElement(Text, { style, ...p }, children) };
});
jest.mock('../../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../../components/themed/SectionHeader', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    SectionHeader: ({ title, ...p }: any) =>
      React.createElement(View, p, React.createElement(Text, null, title)),
  };
});
jest.mock('../../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  // Render the `right` action + children so the header's save button is present.
  return {
    __esModule: true,
    ScreenHeader: ({ right, children, ...p }: any) =>
      React.createElement(View, p, right, children),
  };
});
// ThemedButton (used by AccountForm) needs a richer theme than the minimal mock;
// render it as a plain pressable carrying its testID + onPress.
jest.mock('../../../components/themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, testID, disabled }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, testID, disabled, accessibilityRole: 'button' },
        React.createElement(Text, null, label),
      ),
  };
});

// Capability-registry hook → deterministic catalog (the registry fetch itself is
// covered by its own tests).
jest.mock('../../../hooks/useProviderCapabilityCatalog', () => ({
  useProviderCapabilityCatalog: () => ({
    catalog: mockCatalog,
    paramMapping: {},
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

// Engine management client: keep the real module surface but stub the singleton.
jest.mock('../../../services/engine/EngineApiClient', () => {
  const actual = jest.requireActual('../../../services/engine/EngineApiClient');
  return {
    ...actual,
    engineApiClient: {
      listPresets: jest.fn(),
      getPreset: jest.fn(),
      getProviderCapabilities: jest.fn(),
      listProviderModels: jest.fn(),
    },
  };
});

// Heavy collaborators not exercised on these paths.
jest.mock('../../../components/config/SttTestPanel', () => ({ SttTestPanel: () => null }));
jest.mock('../../../components/config/TtsTestPanel', () => ({ TtsTestPanel: () => null }));
jest.mock('../../../components/config/SoulbitsModelSelect', () => ({ SoulbitsModelSelect: () => null }));
jest.mock('../../../components/config/AdvancedSamplingParams', () => ({ AdvancedSamplingParams: () => null }));

jest.mock('../../../services/variant/entityAccess', () => ({
  invalidateEntityAccessCache: jest.fn(),
}));

// Full repository surface → inert jest.fn()s.
jest.mock('../../../database/repositories', () => {
  const names = [
    'createBackendConfig', 'updateBackendConfig', 'getBackendConfig', 'deleteBackendConfig',
    'createCognitionConfig', 'updateCognitionConfig', 'getCognitionConfig', 'deleteCognitionConfig',
    'createMovementConfig', 'updateMovementConfig', 'getMovementConfig', 'deleteMovementConfig',
    'createRAGConfig', 'updateRAGConfig', 'getRAGConfig', 'deleteRAGConfig',
    'createSTTConfig', 'updateSTTConfig', 'getSTTConfig', 'deleteSTTConfig',
    'createTTSConfig', 'updateTTSConfig', 'getTTSConfig', 'deleteTTSConfig',
    'createVisionConfig', 'updateVisionConfig', 'getVisionConfig', 'deleteVisionConfig',
    'createImaginationConfig', 'updateImaginationConfig', 'getImaginationConfig', 'deleteImaginationConfig',
    'listAccounts', 'createAccount',
  ];
  const mod: Record<string, jest.Mock> = {};
  for (const name of names) mod[name] = jest.fn();
  return mod;
});

import { ModuleConfigEditScreen } from '../ModuleConfigEditScreen';
import { engineApiClient } from '../../../services/engine/EngineApiClient';
import { resetPresetsCache } from '../../../hooks/usePresets';
import { clearProviderModelCache } from '../../../services/providers/providerModelFetch';
import {
  listAccounts,
  createAccount,
  createSTTConfig,
  createBackendConfig,
} from '../../../database/repositories';
import type { ProviderAccount } from '../../../database/models';

const account = (over: Partial<ProviderAccount> & { id: string; type: string; name: string }): ProviderAccount => ({
  api_key: 'sk-1234567890',
  base_url: '',
  extra: '{}',
  created_at: null,
  updated_at: null,
  deleted_at: null,
  ...over,
});

async function renderScreen() {
  const utils = await render(<ModuleConfigEditScreen />);
  // Wait for the create-mode load to settle (provider chips appear).
  await waitFor(() => expect(utils.getAllByText('OpenAI').length).toBeGreaterThan(0));
  return utils;
}

describe('ModuleConfigEditScreen — Provider → Account → Capability flow', () => {
  it('renders Provider and Capability sections, and Account once a type is chosen', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('OpenAI'));

    await waitFor(() => expect(utils.getByText('Provider')).toBeTruthy());
    expect(utils.getByText('Account')).toBeTruthy();
    expect(utils.getByText('Capability')).toBeTruthy();
    // No account of the type yet → the create prompt.
    expect(utils.getByTestId('account-none-provider')).toBeTruthy();
    expect(utils.getByTestId('account-add-provider')).toBeTruthy();
  });

  it('auto-collapses the account step to a caption when only one exists', async () => {
    (listAccounts as jest.Mock).mockResolvedValue([
      account({ id: 'a1', type: 'openai', name: 'Personal key' }),
    ]);
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('OpenAI'));

    const caption = await waitFor(() => utils.getByTestId('account-collapse-provider'));
    expect(caption).toBeTruthy();
    expect(utils.getByText(/accountUsing/)).toBeTruthy();
    // The single account is auto-selected → the model Fetch button is enabled.
    expect(utils.queryByTestId('account-option-provider-a1')).toBeNull();
  });

  it('renders selectable account chips when several accounts exist', async () => {
    (listAccounts as jest.Mock).mockResolvedValue([
      account({ id: 'a1', type: 'openai', name: 'Personal' }),
      account({ id: 'a2', type: 'openai', name: 'Work' }),
    ]);
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('OpenAI'));

    await waitFor(() => expect(utils.getByTestId('account-option-provider-a1')).toBeTruthy());
    expect(utils.getByTestId('account-option-provider-a2')).toBeTruthy();
    expect(utils.queryByTestId('account-collapse-provider')).toBeNull();
  });
});

describe('ModuleConfigEditScreen — capability picker + param warnings', () => {
  it('renders the catalog-backed model picker for a provider with catalog entries', async () => {
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    const modelRow = await waitFor(() => utils.getByLabelText('Model'));
    await fireEvent.press(modelRow);
    await waitFor(() => expect(utils.getByText('gpt-6-astra')).toBeTruthy());
    expect(utils.getByText('modelCustom')).toBeTruthy();
  });

  it('warns on an unsupported sampling param in Advanced mode (never blocks)', async () => {
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    // Pick the model that declares a param set omitting temperature.
    await fireEvent.press(utils.getByLabelText('Model'));
    await waitFor(() => expect(utils.getByText('no-temp-model')).toBeTruthy());
    await fireEvent.press(utils.getByText('no-temp-model'));

    // Simple mode hides the deep param (no warning chip).
    expect(utils.queryByTestId('param-warning-provider-temperature')).toBeNull();

    // Advanced mode shows it WITH the warning chip.
    await fireEvent.press(utils.getByText('modeAdvanced'));
    await waitFor(() => expect(utils.getByTestId('param-warning-provider-temperature')).toBeTruthy());
  });
});

describe('ModuleConfigEditScreen — Add account (shared AccountForm)', () => {
  it('creates an account from the inline form and selects it', async () => {
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    await fireEvent.press(utils.getByTestId('account-add-provider'));

    // The shared AccountForm renders the openai account schema.
    const nameField = await waitFor(() => utils.getByTestId('account-field-name'));
    await fireEvent.changeText(nameField, 'My key');
    await fireEvent.changeText(utils.getByTestId('account-field-api_key'), 'sk-abcdef1234');
    await fireEvent.press(utils.getByTestId('account-submit'));

    await waitFor(() =>
      expect(createAccount).toHaveBeenCalledWith('openai', {
        name: 'My key',
        api_key: 'sk-abcdef1234',
      }),
    );
  });
});

describe('ModuleConfigEditScreen — account-switch revalidation (§3.2)', () => {
  it('marks a saved model stale when the new account’s live list lacks it (never drops it)', async () => {
    (listAccounts as jest.Mock).mockResolvedValue([
      account({ id: 'a1', type: 'openai', name: 'Personal', base_url: 'http://a1' }),
      account({ id: 'a2', type: 'openai', name: 'Work', base_url: 'http://a2' }),
    ]);
    (engineApiClient.listProviderModels as jest.Mock).mockImplementation(async (body: any) => {
      if (body.base_url === 'http://a1') return { models: [{ id: 'model-x', label: 'model-x' }] };
      return { models: [{ id: 'model-y', label: 'model-y' }] };
    });

    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    // Switch to account a1 → debounced live fetch returns model-x.
    await fireEvent.press(utils.getByTestId('account-option-provider-a1'));
    await waitFor(() => expect(engineApiClient.listProviderModels).toHaveBeenCalled());

    // Select model-x (now offered by the live list).
    await fireEvent.press(utils.getByLabelText('Model'));
    await waitFor(() => expect(utils.getByText('model-x')).toBeTruthy());
    await fireEvent.press(utils.getByText('model-x'));

    // Switch to account a2 → its live list lacks model-x → stale marker.
    await fireEvent.press(utils.getByTestId('account-option-provider-a2'));
    await waitFor(() => expect(utils.getByTestId(MODEL_STALE_TESTID)).toBeTruthy());
    // The stale value is still present (never silently dropped).
    expect(utils.getByText('model-x')).toBeTruthy();
  });

  it('debounces + caches: switching back to a fetched account issues no new request', async () => {
    (listAccounts as jest.Mock).mockResolvedValue([
      account({ id: 'a1', type: 'openai', name: 'Personal', base_url: 'http://a1' }),
      account({ id: 'a2', type: 'openai', name: 'Work', base_url: 'http://a2' }),
    ]);
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    await fireEvent.press(utils.getByTestId('account-option-provider-a1'));
    await waitFor(() => expect(engineApiClient.listProviderModels).toHaveBeenCalledTimes(1));

    await fireEvent.press(utils.getByTestId('account-option-provider-a2'));
    await waitFor(() => expect(engineApiClient.listProviderModels).toHaveBeenCalledTimes(2));

    // Back to a1 → served from the discovery cache.
    await fireEvent.press(utils.getByTestId('account-option-provider-a1'));
    await new Promise((r) => setTimeout(r, 400));
    expect(engineApiClient.listProviderModels).toHaveBeenCalledTimes(2);
  });
});

describe('ModuleConfigEditScreen — STT dual-slot round-trip', () => {
  it('renders two provider slots and saves both account FKs + overlays', async () => {
    mockModuleType = 'stt';
    const utils = await renderScreen();

    // Two Provider sections (transcription + VAD), each offering OpenAI.
    expect(utils.getAllByText('OpenAI').length).toBe(2);
    await fireEvent.press(utils.getAllByText('OpenAI')[0]);
    await fireEvent.press(utils.getAllByText('OpenAI')[1]);

    await waitFor(() => expect(utils.getAllByText('Transcription Capability').length).toBe(1));
    expect(utils.getAllByText('VAD Capability').length).toBe(1);

    await fireEvent.changeText(utils.getByPlaceholderText('Enter config name'), 'Voice');
    await fireEvent.press(utils.getByLabelText('Save configuration'));

    await waitFor(() => expect(createSTTConfig).toHaveBeenCalledTimes(1));
    const body = (createSTTConfig as jest.Mock).mock.calls[0][0];
    expect(body.transcription_provider).toBe('openai');
    expect(body.transcription_provider_account_id).toBeNull();
    expect(typeof body.transcription_capability_json).toBe('string');
    expect(body.vad_provider).toBe('openai');
    expect(typeof body.vad_capability_json).toBe('string');
    expect(body.name).toBe('Voice');
  });
});

describe('ModuleConfigEditScreen — standard save writes the flat FK + overlay', () => {
  it('creates a backend config with provider_account_id + capability_json', async () => {
    (listAccounts as jest.Mock).mockResolvedValue([
      account({ id: 'a1', type: 'openai', name: 'Personal' }),
    ]);
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));
    // The single account is auto-selected (collapsed caption).
    await waitFor(() => expect(utils.getByTestId('account-collapse-provider')).toBeTruthy());

    await fireEvent.changeText(utils.getByPlaceholderText('Enter config name'), 'Chat');
    await fireEvent.press(utils.getByLabelText('Save configuration'));

    await waitFor(() => expect(createBackendConfig).toHaveBeenCalledTimes(1));
    const body = (createBackendConfig as jest.Mock).mock.calls[0][0];
    expect(body.provider).toBe('openai');
    expect(body.provider_account_id).toBe('a1');
    expect(typeof body.capability_json).toBe('string');
    expect(JSON.parse(body.capability_json).model).toBe('gpt-4o');
  });
});
