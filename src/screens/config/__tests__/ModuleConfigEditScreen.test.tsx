/**
 * ModuleConfigEditScreen — catalog-backed model picker wiring (2-1).
 *
 * The screen renders the provider `model` field through `CatalogModelSelect`
 * when the (provider, module) pair has catalog entries, and keeps the plain
 * free-text input otherwise. This exercises that routing at the screen level
 * (the picker's own behaviour is covered in CatalogModelSelect.test.tsx).
 *
 * The screen pulls in the whole repository/context layer, so those are mocked
 * down to the minimum the create-mode render path touches.
 */

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CUSTOM_MODEL_INPUT_TESTID } from '../../../components/config/CatalogModelSelect';

afterEach(cleanup);
beforeEach(() => {
  cleanup();
  mockModuleType = 'backend';
});

/** Module type the mocked `useRoute` reports; reset per test. */
let mockModuleType = 'backend';

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
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
      },
    },
  }),
}));

jest.mock('../../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: jest.fn() }),
}));

jest.mock('../../../contexts/SyncConnectionContext', () => ({
  useSyncConnection: () => ({ isConnected: false, connectionStatus: { mode: 'local' } }),
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
  const { View } = require('react-native');
  return { __esModule: true, SectionHeader: (p: any) => React.createElement(View, p) };
});
jest.mock('../../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: (p: any) => React.createElement(View, p) };
});

// Heavy collaborators not exercised on the create-mode render path.
jest.mock('../../../components/config/SttTestPanel', () => ({ SttTestPanel: () => null }));
jest.mock('../../../components/config/TtsTestPanel', () => ({ TtsTestPanel: () => null }));
jest.mock('../../../components/config/SoulbitsModelSelect', () => ({ SoulbitsModelSelect: () => null }));
jest.mock('../../../components/config/AdvancedSamplingParams', () => ({ AdvancedSamplingParams: () => null }));

jest.mock('../../../services/variant/entityAccess', () => ({
  invalidateEntityAccessCache: jest.fn(),
}));
jest.mock('../../../services/cloud/soulbitsTokenSync', () => ({
  injectSoulbitsToken: jest.fn(async (c: any) => c.providerConfig),
}));
jest.mock('../../../services/auth/AuthService', () => ({
  __esModule: true,
  default: { getToken: jest.fn(async () => null) },
}));

// Full repository surface → inert jest.fn()s (create mode never calls them).
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
    'createOpenAIProviderConfig', 'updateOpenAIProviderConfig', 'getOpenAIProviderConfig', 'deleteOpenAIProviderConfig',
    'createOpenAICompatibleProviderConfig', 'updateOpenAICompatibleProviderConfig', 'getOpenAICompatibleProviderConfig', 'deleteOpenAICompatibleProviderConfig',
    'createOpenRouterProviderConfig', 'updateOpenRouterProviderConfig', 'getOpenRouterProviderConfig', 'deleteOpenRouterProviderConfig',
    'createElevenLabsProviderConfig', 'updateElevenLabsProviderConfig', 'getElevenLabsProviderConfig', 'deleteElevenLabsProviderConfig',
    'createSoulvoiceProviderConfig', 'updateSoulvoiceProviderConfig', 'getSoulvoiceProviderConfig', 'deleteSoulvoiceProviderConfig',
    'createLocalAIProviderConfig', 'updateLocalAIProviderConfig', 'getLocalAIProviderConfig', 'deleteLocalAIProviderConfig',
    'createMistralProviderConfig', 'updateMistralProviderConfig', 'getMistralProviderConfig', 'deleteMistralProviderConfig',
    'createOllamaProviderConfig', 'updateOllamaProviderConfig', 'getOllamaProviderConfig', 'deleteOllamaProviderConfig',
    'createComfyUIProviderConfig', 'updateComfyUIProviderConfig', 'getComfyUIProviderConfig', 'deleteComfyUIProviderConfig',
    'createGoogleProviderConfig', 'updateGoogleProviderConfig', 'getGoogleProviderConfig', 'deleteGoogleProviderConfig',
    'createXAIProviderConfig', 'updateXAIProviderConfig', 'getXAIProviderConfig', 'deleteXAIProviderConfig',
    'createAnthropicProviderConfig', 'updateAnthropicProviderConfig', 'getAnthropicProviderConfig', 'deleteAnthropicProviderConfig',
    'createSoulbitsCloudProviderConfig', 'updateSoulbitsCloudProviderConfig', 'getSoulbitsCloudProviderConfig', 'deleteSoulbitsCloudProviderConfig',
  ];
  const mod: Record<string, jest.Mock> = {};
  for (const name of names) mod[name] = jest.fn();
  return mod;
});

import { ModuleConfigEditScreen } from '../ModuleConfigEditScreen';

async function renderScreen() {
  const utils = await render(<ModuleConfigEditScreen />);
  // Wait for the create-mode load to settle (provider chips appear). STT shows
  // two sections, so use the plural query.
  await waitFor(() => expect(utils.getAllByText('OpenAI').length).toBeGreaterThan(0));
  return utils;
}

describe('ModuleConfigEditScreen — catalog-backed model field', () => {
  it('renders the catalog picker for a provider with entries (openai/backend)', async () => {
    const utils = await renderScreen();

    fireEvent.press(utils.getByText('OpenAI'));

    // The model field now renders the SelectPicker (labelled "Model") …
    const modelRow = await waitFor(() => utils.getByLabelText('Model'));
    expect(modelRow).toBeTruthy();

    // … whose options come from the catalog.
    fireEvent.press(modelRow);
    await waitFor(() => expect(utils.getByText('gpt-6-astra')).toBeTruthy());
  });

  it('keeps the free-text input for a provider without catalog entries (openrouter/backend)', async () => {
    const utils = await renderScreen();

    fireEvent.press(utils.getByText('OpenRouter'));

    await waitFor(() => expect(utils.getByTestId(CUSTOM_MODEL_INPUT_TESTID)).toBeTruthy());
  });

  it('covers both STT slots: transcription uses the picker, VAD stays free text', async () => {
    mockModuleType = 'stt';
    const utils = await renderScreen();

    // Two provider sections (transcription + VAD), each offering OpenAI.
    const openAiChips = utils.getAllByText('OpenAI');
    expect(openAiChips.length).toBe(2);

    // Transcription slot → OpenAI → catalog-backed model picker.
    fireEvent.press(openAiChips[0]);
    const transcriptionModelRow = await waitFor(() => utils.getByLabelText('Model'));
    fireEvent.press(transcriptionModelRow);
    await waitFor(() => expect(utils.getByText('gpt-transcribe')).toBeTruthy());

    // VAD slot → OpenAI → no VAD catalog, so the model field stays free text.
    fireEvent.press(utils.getAllByText('OpenAI')[1]);
    await waitFor(() => expect(utils.getByTestId(CUSTOM_MODEL_INPUT_TESTID)).toBeTruthy());
  });
});
