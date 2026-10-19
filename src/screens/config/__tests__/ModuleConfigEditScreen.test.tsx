/**
 * ModuleConfigEditScreen — Wave 2 screen & slot orchestration.
 *
 * Covers the phase docs' component-test list at the screen level:
 *  - single-slot unified `General & Provider` card + `Simple | Advanced`
 *    switch living in the Capability header (Phase 2-3);
 *  - module-scoped capability fields: Backend never renders/persists TTS or
 *    Imagination keys (Phase 1-2 / 3-1);
 *  - the collapsed unsupported-params drawer instead of an orange warning wall
 *    (Phase 2-2);
 *  - Cognition `generate_expressions` toggle writing 1/0 (Phase 3-2);
 *  - RAG hiding `embedding_concurrency` until Advanced (Phase 3-4);
 *  - STT's interactive Stage 1 VAD ↔ Stage 2 Transcription pipeline (3-6);
 *  - Imagination xAI using `image_model` + aspect-ratio chips (3-8);
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
  (createCognitionConfig as jest.Mock).mockReset().mockResolvedValue('c-new');
  (createTTSConfig as jest.Mock).mockReset().mockResolvedValue('t-new');
});

/** Module type the mocked `useRoute` reports; reset per test. */
let mockModuleType = 'backend';
/** Catalog returned by the mocked capability-registry hook. */
let mockCatalog: Record<string, ModelInfoDto[]> = {};

const OPENAI_CATALOG: ModelInfoDto[] = [
  { id: 'gpt-6-astra', label: 'gpt-6-astra', capabilities: ['chat'], context: 1050000, provenance: 'known' },
  // Declares a param set that omits `temperature` → unsupported drawer.
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
    SectionHeader: ({ title, right, ...p }: any) =>
      React.createElement(View, p, React.createElement(Text, null, title), right),
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
  createCognitionConfig,
  createTTSConfig,
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

describe('ModuleConfigEditScreen — unified General & Provider flow (2-3)', () => {
  it('renders one General & Provider card and puts the mode switch in the Capability header', async () => {
    const utils = await renderScreen();

    // Config name + provider chips live in a single top card.
    expect(utils.getByText('generalAndProvider')).toBeTruthy();
    expect(utils.getByTestId('config-name-provider')).toBeTruthy();
    // The standalone General card is gone for single-slot modules.
    expect(utils.queryByText('general')).toBeNull();

    await fireEvent.press(utils.getByText('OpenAI'));

    await waitFor(() => expect(utils.getByText('capabilityChat')).toBeTruthy());
    // Account is inline — no separate Account section header.
    expect(utils.getByTestId('account-none-provider')).toBeTruthy();
    expect(utils.getByTestId('account-add-provider')).toBeTruthy();

    // Simple | Advanced now lives in the Capability SectionHeader.
    expect(utils.getByTestId('mode-simple-button')).toBeTruthy();
    expect(utils.getByTestId('mode-advanced-button')).toBeTruthy();

    // The header save affordance is the 32×32 pink rounded-square badge.
    expect(utils.getByTestId('header-save-button')).toBeTruthy();

    // Simple hides deep sampling; Advanced reveals it.
    expect(utils.queryByText('Temperature')).toBeNull();
    await fireEvent.press(utils.getByTestId('mode-advanced-button'));
    await waitFor(() => expect(utils.getByText('Temperature')).toBeTruthy());
  });

  it('auto-collapses the account step to a caption when only one exists', async () => {
    (listAccounts as jest.Mock).mockResolvedValue([
      account({ id: 'a1', type: 'openai', name: 'Personal key' }),
    ]);
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('OpenAI'));

    const caption = await waitFor(() => utils.getByTestId('account-collapse-provider'));
    expect(caption).toBeTruthy();
    expect(utils.getByText(/Account:/)).toBeTruthy();
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

describe('ModuleConfigEditScreen — capability picker + unsupported drawer', () => {
  it('renders the catalog-backed model picker for a provider with catalog entries', async () => {
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    const modelRow = await waitFor(() => utils.getByLabelText('Model'));
    await fireEvent.press(modelRow);
    await waitFor(() => expect(utils.getByText('gpt-6-astra')).toBeTruthy());
    expect(utils.getByText('modelCustom')).toBeTruthy();
  });

  it('collapses unsupported params into one drawer in Advanced mode (never blocks)', async () => {
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    // Pick the model that declares a param set omitting temperature.
    await fireEvent.press(utils.getByLabelText('Model'));
    await waitFor(() => expect(utils.getByText('no-temp-model')).toBeTruthy());
    await fireEvent.press(utils.getByText('no-temp-model'));

    // Simple mode hides the deep param entirely.
    expect(utils.queryByText('Temperature')).toBeNull();

    // Advanced: the unsupported param is tucked into the footer drawer.
    await fireEvent.press(utils.getByTestId('mode-advanced-button'));
    const drawer = await waitFor(() => utils.getByTestId('unsupported-params-drawer-provider'));
    expect(drawer).toBeTruthy();
    expect(utils.queryByText('Temperature')).toBeNull();

    await fireEvent.press(drawer);
    await waitFor(() => expect(utils.getByText('Temperature')).toBeTruthy());
  });
});

describe('ModuleConfigEditScreen — module-scoped fields per module', () => {
  it('Backend Simple mode excludes TTS and Imagination keys', async () => {
    const utils = await renderScreen();
    // soulbitscloud declares chat + TTS + imagination fields in one schema.
    await fireEvent.press(utils.getByText('Soulbits Cloud'));

    await waitFor(() => expect(utils.getByText('capabilityChat')).toBeTruthy());
    expect(utils.queryByText('Voice')).toBeNull();
    expect(utils.queryByText('Speed')).toBeNull();
    expect(utils.queryByText('Image Aspect Ratio')).toBeNull();
    expect(utils.queryByText('Normalize Loudness')).toBeNull();
  });

  it('Cognition generate_expressions toggle writes 1 / 0', async () => {
    mockModuleType = 'cognition';
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    const toggle = await waitFor(() => utils.getByTestId('module-field-generate_expressions'));
    await fireEvent(toggle, 'valueChange', true);

    await fireEvent.changeText(utils.getByTestId('config-name-provider'), 'Subconscious');
    await fireEvent.press(utils.getByLabelText('Save configuration'));

    await waitFor(() => expect(createCognitionConfig).toHaveBeenCalledTimes(1));
    const body = (createCognitionConfig as jest.Mock).mock.calls[0][0];
    expect(body.generate_expressions).toBe(1);
  });

  it('Cognition generate_expressions writes 0 when disabled', async () => {
    mockModuleType = 'cognition';
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    const toggle = await waitFor(() => utils.getByTestId('module-field-generate_expressions'));
    await fireEvent(toggle, 'valueChange', true);
    await fireEvent(toggle, 'valueChange', false);

    await fireEvent.changeText(utils.getByTestId('config-name-provider'), 'Subconscious');
    await fireEvent.press(utils.getByLabelText('Save configuration'));

    await waitFor(() => expect(createCognitionConfig).toHaveBeenCalledTimes(1));
    const body = (createCognitionConfig as jest.Mock).mock.calls[0][0];
    expect(body.generate_expressions).toBe(0);
  });

  it('RAG renders Embedding Concurrency inside the capability footer (Advanced only)', async () => {
    mockModuleType = 'rag';
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    await waitFor(() => expect(utils.getByText('capabilityEmbeddings')).toBeTruthy());
    // Simple: the footer stays hidden and there is no standalone RAG card.
    expect(utils.queryByText('Embedding Concurrency')).toBeNull();
    expect(utils.queryByText('RAG Settings')).toBeNull();

    await fireEvent.press(utils.getByTestId('mode-advanced-button'));
    await waitFor(() => expect(utils.getByText('Embedding Concurrency')).toBeTruthy());
    // Still no third card — the field lives in the CAPABILITY footer.
    expect(utils.getByTestId('module-field-embedding_concurrency')).toBeTruthy();
    expect(utils.queryByText('RAG Settings')).toBeNull();
    expect(utils.getAllByText('capabilityEmbeddings').length).toBe(1);
  });

  it('RAG shows the embedding dimension metadata badge', async () => {
    mockModuleType = 'rag';
    mockCatalog = {
      openai: [
        {
          id: 'text-embedding-3-small',
          label: 'text-embedding-3-small',
          capabilities: ['embedding'],
          meta: { embedding_dimensions: 1536 },
        },
      ],
    };
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    await fireEvent.press(utils.getByLabelText('embeddingModel'));
    await waitFor(() => expect(utils.getByText('text-embedding-3-small')).toBeTruthy());
    await fireEvent.press(utils.getByText('text-embedding-3-small'));

    await waitFor(() => expect(utils.getByTestId('embedding-dims-provider')).toBeTruthy());
    expect(utils.getByText('embeddingDimensions')).toBeTruthy();
  });

  it('Imagination xAI uses image_model and aspect-ratio chips', async () => {
    mockModuleType = 'imagination';
    mockCatalog = {
      xai: [
        {
          id: 'grok-imagine-image-2.0',
          label: 'grok-imagine-image-2.0',
          capabilities: ['image'],
        },
      ],
    };
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('xAI / Grok'));

    await waitFor(() => expect(utils.getByText('Image Model')).toBeTruthy());
    // Aspect-ratio pill selector is the shared chips control.
    expect(utils.getByText('Image Aspect Ratio')).toBeTruthy();
    expect(utils.getByText('1:1 Square')).toBeTruthy();
    expect(utils.getByText('16:9 Landscape')).toBeTruthy();
    // The chat `model` is scoped out of Imagination on xAI.
    expect(utils.queryByText('Model')).toBeNull();
  });
});

describe('ModuleConfigEditScreen — module card titles (design parity)', () => {
  it.each([
    ['movement', 'movementExecution'],
    ['vision', 'imagePreprocessing'],
    ['cognition', 'cognitionSettings'],
  ])('%s uses the designed module card title', async (moduleId, titleKey) => {
    mockModuleType = moduleId;
    const utils = await renderScreen();
    expect(utils.getByText(titleKey)).toBeTruthy();
  });
});

describe('ModuleConfigEditScreen — TTS voice design & behavior (File 3)', () => {
  it('renders the VOICE DESIGN & CAPABILITY header + model metadata badge', async () => {
    mockModuleType = 'tts';
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    await waitFor(() => expect(utils.getByText('voiceDesignCapability')).toBeTruthy());
    expect(utils.getByText('ttsModel')).toBeTruthy();
    expect(utils.getByText('badgeTtsMultiVoice')).toBeTruthy();
    // OpenAI gpt-4o-mini-tts uses the 11-voice chip row + instructions prompt.
    expect(utils.getByText('Voice')).toBeTruthy();
    expect(utils.getByText('alloy')).toBeTruthy();
    expect(utils.getByText('coral')).toBeTruthy();
    expect(utils.getByText('Voice Design Instructions (gpt-4o-mini-tts)')).toBeTruthy();
  });

  it('renders TTS MODULE BEHAVIOR with the toggle + pronunciation overrides and saves them', async () => {
    mockModuleType = 'tts';
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    await waitFor(() => expect(utils.getByText('moduleBehaviorTts')).toBeTruthy());
    expect(utils.getByText('voiceTestStudio')).toBeTruthy();
    expect(utils.getByText('directEngineSynthesis')).toBeTruthy();
    // Legacy `output_type` is persisted but never rendered.
    expect(utils.queryByText('Output Type')).toBeNull();

    const toggle = utils.getByTestId('module-field-vocalize_nonverbal');
    expect(toggle).toBeTruthy();
    await fireEvent(toggle, 'valueChange', true);

    await fireEvent.changeText(
      utils.getByTestId('module-field-words_to_replace'),
      'Soulbits=Soul-bits',
    );
    await fireEvent.changeText(utils.getByTestId('config-name-provider'), 'Claire Voice');
    await fireEvent.press(utils.getByLabelText('Save configuration'));

    await waitFor(() => expect(createTTSConfig).toHaveBeenCalledTimes(1));
    const body = (createTTSConfig as jest.Mock).mock.calls[0][0];
    expect(body.vocalize_nonverbal).toBe(1);
    expect(body.words_to_replace).toBe('Soulbits=Soul-bits');
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

describe('ModuleConfigEditScreen — STT 2-stage realtime pipeline (3-6)', () => {
  it('renders the pipeline banner + ONE single stage card, and saves both slots', async () => {
    mockModuleType = 'stt';
    const utils = await renderScreen();

    // Card 1: Realtime Audio Pipeline (Config Name + stage flow), with its own
    // Simple | Advanced switch. No separate General card.
    expect(utils.getByText('sttPipelineTitle')).toBeTruthy();
    expect(utils.getByTestId('config-name-stt')).toBeTruthy();
    expect(utils.queryByText('general')).toBeNull();

    // Both stage nodes are always visible.
    expect(utils.getByTestId('stt-stage-vad')).toBeTruthy();
    expect(utils.getByTestId('stt-stage-transcription')).toBeTruthy();

    // Default stage is transcription → its single combined card renders.
    expect(utils.getByText('stage2CardTitle')).toBeTruthy();
    expect(utils.getByText('stage2Badge')).toBeTruthy();
    expect(utils.getAllByText('OpenAI').length).toBe(1);
    expect(utils.getAllByText('Ollama (experimental)').length).toBe(1);
    // No account/model controls until a provider is chosen.
    expect(utils.queryByTestId('account-none-transcription')).toBeNull();
    // AutoVAD is off until the VAD provider is configured.
    expect(utils.queryByText('autoVadActive')).toBeNull();

    await fireEvent.press(utils.getByText('OpenAI'));
    await waitFor(() => expect(utils.getByTestId('account-none-transcription')).toBeTruthy());

    // Switch to Stage 1 VAD → only the VAD slot renders (its own provider list).
    await fireEvent.press(utils.getByTestId('stt-stage-vad'));
    await waitFor(() => expect(utils.getByText('stage1CardTitle')).toBeTruthy());
    expect(utils.getByText('stage1Badge')).toBeTruthy();
    expect(utils.queryByText('stage2CardTitle')).toBeNull();
    expect(utils.getAllByText('Soulbits Cloud').length).toBe(1);
    expect(utils.getAllByText('Soulvoice').length).toBe(1);
    // Transcription-only providers are gone from the VAD stage.
    expect(utils.queryByText('OpenAI')).toBeNull();

    await fireEvent.press(utils.getByText('Soulbits Cloud'));
    await waitFor(() => expect(utils.getByTestId('account-managed-vad')).toBeTruthy());
    // Card 1 now reports the AutoVAD pipeline as active.
    expect(utils.getByText('autoVadActive')).toBeTruthy();

    // Switch back to confirm Stage 2 kept its provider.
    await fireEvent.press(utils.getByTestId('stt-stage-transcription'));
    await waitFor(() => expect(utils.getByText('stage2CardTitle')).toBeTruthy());

    await fireEvent.changeText(utils.getByTestId('config-name-stt'), 'Voice');
    await fireEvent.press(utils.getByLabelText('Save configuration'));

    await waitFor(() => expect(createSTTConfig).toHaveBeenCalledTimes(1));
    const body = (createSTTConfig as jest.Mock).mock.calls[0][0];
    expect(body.transcription_provider).toBe('openai');
    expect(body.transcription_provider_account_id).toBeNull();
    expect(typeof body.transcription_capability_json).toBe('string');
    expect(body.vad_provider).toBe('soulbitscloud');
    expect(typeof body.vad_capability_json).toBe('string');
    expect(body.name).toBe('Voice');
  });

  it('clears the VAD provider from the Disabled chip and saves an empty VAD slot', async () => {
    mockModuleType = 'stt';
    const utils = await renderScreen();

    await fireEvent.press(utils.getByTestId('stt-stage-vad'));
    await waitFor(() => expect(utils.getByText('stage1CardTitle')).toBeTruthy());
    await fireEvent.press(utils.getByText('Soulbits Cloud'));
    await waitFor(() => expect(utils.getByTestId('account-managed-vad')).toBeTruthy());

    await fireEvent.press(utils.getByTestId('provider-disabled-vad'));
    await waitFor(() => expect(utils.queryByTestId('account-managed-vad')).toBeNull());
    expect(utils.queryByText('autoVadActive')).toBeNull();

    // Stage 2 must still be configured; the VAD slot is optional (manual PT).
    await fireEvent.press(utils.getByTestId('stt-stage-transcription'));
    await fireEvent.press(utils.getByText('OpenAI'));
    await fireEvent.changeText(utils.getByTestId('config-name-stt'), 'Manual Voice');
    await fireEvent.press(utils.getByLabelText('Save configuration'));

    await waitFor(() => expect(createSTTConfig).toHaveBeenCalledTimes(1));
    const body = (createSTTConfig as jest.Mock).mock.calls[0][0];
    expect(body.vad_provider).toBe('');
  });

  it('hides the stream buffer card until Advanced', async () => {
    mockModuleType = 'stt';
    const utils = await renderScreen();
    await fireEvent.press(utils.getByText('OpenAI'));

    expect(utils.queryByText('sttBufferTitle')).toBeNull();
    await fireEvent.press(utils.getByTestId('mode-advanced-button'));
    await waitFor(() => expect(utils.getByText('sttBufferTitle')).toBeTruthy());
    expect(utils.getByTestId('module-field-main_stream_time_millis')).toBeTruthy();
    expect(utils.getByTestId('module-field-transition_stream_time_millis')).toBeTruthy();
    expect(utils.getByTestId('module-field-max_buffer_count')).toBeTruthy();
    expect(utils.getByText('chunkWindow')).toBeTruthy();
    expect(utils.getByText('transitionOverlap')).toBeTruthy();
    expect(utils.getByText('maxSpeechChunks')).toBeTruthy();
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

    await fireEvent.changeText(utils.getByTestId('config-name-provider'), 'Chat');
    await fireEvent.press(utils.getByLabelText('Save configuration'));

    await waitFor(() => expect(createBackendConfig).toHaveBeenCalledTimes(1));
    const body = (createBackendConfig as jest.Mock).mock.calls[0][0];
    expect(body.provider).toBe('openai');
    expect(body.provider_account_id).toBe('a1');
    expect(typeof body.capability_json).toBe('string');
    expect(JSON.parse(body.capability_json).model).toBe('gpt-4o');
  });
});
