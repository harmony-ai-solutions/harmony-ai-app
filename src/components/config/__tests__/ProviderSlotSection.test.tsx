/**
 * ProviderSlotSection — TTS Language / Base Voice gating (metadata-driven).
 *
 * The pickers are ONLY offered when the selected model's
 * `meta.speech_options` actually declares languages/voices (research
 * `.current_work/provider-registry/research/soulbits-model-defaults.md`
 * §0/§3/§7):
 *  - a model declaring voices → picker with exactly those options (never the
 *    old static "Claire / Nova / Alloy" fallback);
 *  - a model with no voice ids but a cloning pipeline (chatterbox /
 *    harmonyspeech) → muted "default speaker" hint instead of a picker;
 *  - a model with neither → no row at all;
 *  - a single declared language (KittenTTS `default`) → locked read-only row;
 *  - no declared languages (offline catalog) → language hidden, never a
 *    fabricated list;
 *  - a seeded/saved value missing from the descriptor stays visible as-is.
 */

import React from 'react';
import { cleanup, fireEvent, render, within } from '@testing-library/react-native';
import { ProviderSlotSection } from '../ProviderSlotSection';
import type { ModelInfoDto } from '../../../services/engine/EngineApiClient';

let mockCatalog: Record<string, ModelInfoDto[]> = {};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, variant, size, weight, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

jest.mock('../../themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedCard: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});

jest.mock('../../themed/SectionHeader', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    SectionHeader: ({ title, right, ...props }: any) =>
      React.createElement(View, props, React.createElement(Text, null, title), right),
  };
});

// Deterministic offline capability registry (the fetch is covered elsewhere).
jest.mock('../../../hooks/useProviderCapabilityCatalog', () => ({
  useProviderCapabilityCatalog: () => ({
    catalog: mockCatalog,
    paramMapping: {},
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

// Live discovery is irrelevant here: these cases drive the offline catalog.
jest.mock('../../../hooks/useProviderModels', () => ({
  useProviderModels: () => ({
    models: null,
    voices: null,
    fetching: false,
    error: null,
    fetchNow: jest.fn(),
    scheduleFetch: jest.fn(),
  }),
}));

// Heavy / irrelevant collaborators.
jest.mock('../AccountPicker', () => ({ AccountPicker: () => null }));
jest.mock('../VoiceProfileBar', () => ({ VoiceProfileBar: () => null }));
jest.mock('../SoulbitsModelSelect', () => ({ SoulbitsModelSelect: () => null }));
jest.mock('../CatalogModelSelect', () => ({ CatalogModelSelect: () => null }));
jest.mock('../AdvancedSamplingParams', () => ({ AdvancedSamplingParams: () => null }));
jest.mock('../VoiceCloneAndDesignSection', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    VoiceCloneAndDesignSection: () => React.createElement(View, { testID: 'voice-clone-section' }),
  };
});

afterEach(async () => {
  await cleanup();
});

const ttsModel = (id: string, speechOptions?: Record<string, unknown>): ModelInfoDto => ({
  id,
  label: id,
  capabilities: ['tts'],
  ...(speechOptions ? { meta: { speech_options: speechOptions } } : {}),
});

async function renderSlot(model: ModelInfoDto | undefined, capability: Record<string, any>) {
  mockCatalog = { soulbitscloud: model ? [model] : [] };
  const onCapabilityChange = jest.fn();
  const utils = await render(
    <ProviderSlotSection
      slot="provider"
      slotLabel=""
      modelModuleType="tts"
      providerOptions={[{ id: 'soulbitscloud', name: 'Soulbits Cloud', icon: 'cloud' }]}
      state={{ providerType: 'soulbitscloud', accountId: null, capability }}
      accounts={[]}
      showAdvanced={false}
      explicitFields={{}}
      onProviderChange={jest.fn()}
      onAccountChange={jest.fn()}
      onCapabilityChange={onCapabilityChange}
      onAddAccount={jest.fn()}
    />,
  );
  return { utils, onCapabilityChange };
}

/** No fabricated voice may leak in from the retired static fallback. */
function expectNoStaticFallback(utils: { queryByText: (text: string) => unknown }) {
  for (const fabricated of ['Claire', 'Nova', 'Alloy', 'Echo', 'Shimmer']) {
    expect(utils.queryByText(fabricated)).toBeNull();
  }
}

describe('ProviderSlotSection — declared voices', () => {
  it('offers exactly the model-declared voices (KittenTTS) and locks its language', async () => {
    const { utils } = await renderSlot(
      ttsModel('kitten-tts-mini', {
        voices: ['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'],
        languages: [{ code: 'default', name: 'default' }],
        supports_voice_cloning: false,
        operation_modes: ['single_speaker_tts'],
        supported_generation_params: ['speed'],
      }),
      { model: 'kitten-tts-mini', voice: 'Bella', language: 'default' },
    );

    // The seeded default is the exact-cased declared id → shown as selected.
    const voicePicker = utils.getByLabelText('baseVoice');
    expect(within(voicePicker).getByText('Bella')).toBeTruthy();
    expectNoStaticFallback(utils);

    // A single declared language can't be changed (worker hard-fails).
    expect(utils.getByTestId('tts-language-locked-provider')).toBeTruthy();
    expect(utils.queryByLabelText('language')).toBeNull();
    expect(utils.getByText('ttsLanguageLocked')).toBeTruthy();
    // No cloning hint: this model DOES have named voices.
    expect(utils.queryByTestId('tts-default-speaker-hint-provider')).toBeNull();
  });

  it('keeps a seeded voice that the descriptor omits visible instead of clearing it', async () => {
    const { utils } = await renderSlot(
      ttsModel('openvoice_v2', {
        supports_voice_cloning: true,
        operation_modes: ['single_speaker_tts', 'voice_cloning'],
        supported_generation_params: ['speed'],
        languages: [
          { code: 'EN', name: 'English', voices: ['EN-Newest', 'EN-Default'] },
          { code: 'ZH', name: 'Chinese', voices: ['ZH'] },
        ],
      }),
      { model: 'openvoice_v2', voice: 'Legacy-Voice', language: 'EN' },
    );

    expect(within(utils.getByLabelText('baseVoice')).getByText('Legacy-Voice')).toBeTruthy();
    // Multi-language models keep a real language picker.
    expect(utils.getByLabelText('language')).toBeTruthy();
    expect(utils.queryByTestId('tts-language-locked-provider')).toBeNull();
  });

  it('scopes the voice list to the selected language (OpenVoice V2)', async () => {
    const { utils } = await renderSlot(
      ttsModel('openvoice_v2', {
        supports_voice_cloning: true,
        operation_modes: ['single_speaker_tts', 'voice_cloning'],
        supported_generation_params: ['speed'],
        languages: [
          { code: 'EN', name: 'English', voices: ['EN-Newest', 'EN-Default', 'EN-US'] },
          { code: 'ZH', name: 'Chinese', voices: ['ZH'] },
        ],
      }),
      { model: 'openvoice_v2', voice: 'ZH', language: 'ZH' },
    );

    await fireEvent.press(utils.getByLabelText('baseVoice'));
    // The ZH scope is offered…
    expect(utils.getAllByText('ZH').length).toBeGreaterThanOrEqual(2);
    // …and the EN-only voices are not (the worker would reject them).
    expect(utils.queryByText('EN-Newest')).toBeNull();
    expect(utils.queryByText('EN-Default')).toBeNull();
  });
});

describe('ProviderSlotSection — models that declare no voices', () => {
  it('shows a cloning hint instead of a picker for chatterbox', async () => {
    const { utils } = await renderSlot(
      ttsModel('chatterbox', {
        supports_voice_cloning: true,
        operation_modes: ['single_speaker_tts', 'voice_cloning'],
        supported_generation_params: ['exaggeration', 'cfg_weight'],
        paralinguistic_tags: ['[laugh]'],
      }),
      { model: 'chatterbox', voice: '', language: '' },
    );

    expect(utils.getByTestId('tts-default-speaker-hint-provider')).toBeTruthy();
    expect(utils.getByText('ttsDefaultSpeakerHint')).toBeTruthy();
    expect(utils.queryByLabelText('baseVoice')).toBeNull();
    expectNoStaticFallback(utils);
    // No declared languages either → the language row is hidden entirely.
    expect(utils.queryByLabelText('language')).toBeNull();
  });

  it('falls back to the chatterbox family when the catalog has no metadata', async () => {
    const { utils } = await renderSlot(undefined, { model: 'chatterbox', voice: '', language: '' });

    expect(utils.getByTestId('tts-default-speaker-hint-provider')).toBeTruthy();
    expect(utils.queryByLabelText('baseVoice')).toBeNull();
  });

  it('shows metadata-declared languages for chatterbox_multilingual (still no voice ids)', async () => {
    const { utils } = await renderSlot(
      ttsModel('chatterbox_multilingual', {
        supports_voice_cloning: true,
        operation_modes: ['single_speaker_tts', 'voice_cloning'],
        supported_generation_params: ['exaggeration', 'cfg_weight'],
        languages: [
          { code: 'en', name: 'en' },
          { code: 'de', name: 'de' },
        ],
      }),
      { model: 'chatterbox_multilingual', voice: '', language: 'en' },
    );

    // Declared languages → an enabled picker (not locked, not fabricated).
    expect(utils.getByLabelText('language')).toBeTruthy();
    expect(utils.queryByTestId('tts-language-locked-provider')).toBeNull();
    // No declared voices → the cloning hint replaces the picker.
    expect(utils.getByTestId('tts-default-speaker-hint-provider')).toBeTruthy();
    expect(utils.queryByLabelText('baseVoice')).toBeNull();
  });

  it('hides language for chatterbox_multilingual when speech_options are missing', async () => {
    // The multilingual worker DOES accept a language, but with no metadata we
    // must not fabricate one — SOULBITS_MODEL_DEFAULTS already seeds `en`.
    const { utils } = await renderSlot(undefined, {
      model: 'chatterbox_multilingual',
      voice: '',
      language: 'en',
    });

    expect(utils.getByTestId('tts-default-speaker-hint-provider')).toBeTruthy();
    expect(utils.queryByLabelText('language')).toBeNull();
  });

  it('omits the row entirely when the model supports neither voices nor cloning', async () => {
    // Unknown/offline model: no descriptor, no cloning family → nothing to show.
    const { utils } = await renderSlot(undefined, { model: 'ghost-tts', voice: '', language: '' });

    expect(utils.queryByTestId('tts-default-speaker-hint-provider')).toBeNull();
    expect(utils.queryByLabelText('baseVoice')).toBeNull();
    expect(utils.queryByLabelText('language')).toBeNull();
    expectNoStaticFallback(utils);
  });

  it('notices that HarmonySpeech needs an embedding for single-speaker TTS', async () => {
    const { utils } = await renderSlot(
      ttsModel('harmonyspeech', {
        supports_voice_cloning: true,
        operation_modes: ['single_speaker_tts', 'voice_cloning'],
        supported_generation_params: ['speed', 'pitch', 'energy'],
      }),
      { model: 'harmonyspeech', voice: '', language: '' },
    );

    expect(utils.getByTestId('tts-embedding-notice-provider')).toBeTruthy();
    expect(utils.getByText('ttsEmbeddingRequiredNotice')).toBeTruthy();
    // The cloning workflow is rendered right below the notice.
    expect(utils.getByTestId('voice-clone-section')).toBeTruthy();
    // Still no speaker picker / no static fallback.
    expect(utils.queryByLabelText('baseVoice')).toBeNull();
    expectNoStaticFallback(utils);
  });
});
