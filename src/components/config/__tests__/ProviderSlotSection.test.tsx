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
/** Live discovery descriptors (null = not fetched), driven per test. */
let mockLiveModels: ModelInfoDto[] | null = null;

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
    models: mockLiveModels,
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
jest.mock('../CatalogModelSelect', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    CatalogModelSelect: ({ value, label, onChange }: any) =>
      React.createElement(
        View,
        { testID: 'catalog-model-select' },
        React.createElement(Text, null, label),
        React.createElement(Text, null, value ?? ''),
        React.createElement(
          TouchableOpacity,
          { testID: 'catalog-model-select-pick', onPress: () => onChange('custom-model') },
          React.createElement(Text, null, 'pick'),
        ),
      ),
  };
});
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

/** A catalog row carrying arbitrary `meta` (speech_options + audio_tags). */
const ttsModelWithMeta = (id: string, meta: Record<string, unknown>): ModelInfoDto => ({
  id,
  label: id,
  capabilities: ['tts'],
  meta,
});

/** `count` bracket-free vocabulary words (the engine's wire shape). */
const words = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

/** Eleven v3/v4: open cues 12 / tones 48 / breaks 3. */
const ELEVEN_OPEN_TAGS = {
  syntax: '[{}]',
  cues: { mode: 'open', vocabulary: words('cue', 12) },
  tones: { mode: 'open', vocabulary: words('tone', 48) },
  breaks: { mode: 'open', vocabulary: words('break', 3) },
};

/** Chatterbox Turbo: CLOSED cues 9 / tones 10, no breaks block. */
const CHATTERBOX_TURBO_TAGS = {
  syntax: '[{}]',
  cues: { mode: 'closed', vocabulary: words('cue', 9) },
  tones: { mode: 'closed', vocabulary: words('tone', 10) },
};

async function renderSlot(
  model: ModelInfoDto | undefined,
  capability: Record<string, any>,
  providerType: 'soulbitscloud' | 'elevenlabs' = 'soulbitscloud',
  liveModels: ModelInfoDto[] | null = null,
) {
  mockCatalog = { [providerType]: model ? [model] : [] };
  mockLiveModels = liveModels;
  const onCapabilityChange = jest.fn();
  const utils = await render(
    <ProviderSlotSection
      slot="provider"
      slotLabel=""
      modelModuleType="tts"
      providerOptions={[{ id: providerType, name: providerType, icon: 'cloud' }]}
      state={{ providerType, accountId: null, capability }}
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

describe('ProviderSlotSection — ElevenLabs model key', () => {
  async function renderElevenLabsSlot(
    modelModuleType: 'tts' | 'stt',
    capability: Record<string, any>,
  ) {
    mockCatalog = { elevenlabs: [] };
    const onCapabilityChange = jest.fn();
    const utils = await render(
      <ProviderSlotSection
        slot="provider"
        slotLabel=""
        modelModuleType={modelModuleType}
        providerOptions={[{ id: 'elevenlabs', name: 'ElevenLabs', icon: 'cloud' }]}
        state={{ providerType: 'elevenlabs', accountId: null, capability }}
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

  it('TTS shows the engine-stored model_id in the picker and writes it back', async () => {
    const { utils, onCapabilityChange } = await renderElevenLabsSlot('tts', {
      model_id: 'eleven_multilingual_v2',
      voice_id: '',
    });

    // One model picker, seeded from `model_id` — no separate "Model ID" field.
    const pickers = utils.getAllByTestId('catalog-model-select');
    expect(pickers).toHaveLength(1);
    expect(within(pickers[0]).getByText('eleven_multilingual_v2')).toBeTruthy();

    fireEvent.press(utils.getByTestId('catalog-model-select-pick'));
    expect(onCapabilityChange).toHaveBeenCalledWith('model_id', 'custom-model');
  });

  it('STT shows the engine’s Scribe catalog picker and writes stt_model_id', async () => {
    const { utils, onCapabilityChange } = await renderElevenLabsSlot('stt', {
      stt_model_id: 'scribe_v2',
    });

    // The engine serves the curated Scribe catalog, so STT is catalog-backed.
    const pickers = utils.getAllByTestId('catalog-model-select');
    expect(pickers).toHaveLength(1);
    expect(within(pickers[0]).getByText('scribe_v2')).toBeTruthy();

    fireEvent.press(utils.getByTestId('catalog-model-select-pick'));
    expect(onCapabilityChange).toHaveBeenCalledWith('stt_model_id', 'custom-model');
  });
});

describe('ProviderSlotSection — Voice expression (kinded audio tags)', () => {
  it('shows three OPEN kind cards with their vocabulary counts (Eleven v3)', async () => {
    const { utils } = await renderSlot(
      ttsModelWithMeta('eleven_v3', {
        speech_options: { supported_generation_params: ['stability'] },
        audio_tags: ELEVEN_OPEN_TAGS,
      }),
      { model_id: 'eleven_v3' },
      'elevenlabs',
    );

    const cues = utils.getByTestId('tts-tag-kind-provider-cues');
    const tones = utils.getByTestId('tts-tag-kind-provider-tones');
    const breaks = utils.getByTestId('tts-tag-kind-provider-breaks');

    expect(within(cues).getByText('tagKindCues · 12')).toBeTruthy();
    expect(within(tones).getByText('tagKindTones · 48')).toBeTruthy();
    expect(within(breaks).getByText('tagKindBreaks · 3')).toBeTruthy();
    // Mode badges: every kind is `open`.
    expect(within(cues).getAllByText('tagModeOpen')).toHaveLength(1);
    expect(within(tones).getAllByText('tagModeOpen')).toHaveLength(1);
    expect(within(breaks).getAllByText('tagModeOpen')).toHaveLength(1);
    // The accessibility label carries kind + mode + count.
    expect(cues.props.accessibilityLabel).toBe('tagKindCues, tagModeOpen, 12');

    // Asterisk dialect hint, no legacy row, no stale Chatterbox pills.
    expect(utils.getByText('audioTagsBoundaryHint')).toBeTruthy();
    expect(utils.queryByTestId('tts-legacy-audio-tags-provider')).toBeNull();
    expect(utils.queryByTestId('tts-no-audio-tags')).toBeNull();
    expect(utils.queryByText('Paralinguistic Tags (supported inline in utterances)')).toBeNull();
  });

  it('shows CLOSED kind cards without a breaks card (Chatterbox Turbo)', async () => {
    const { utils } = await renderSlot(
      ttsModelWithMeta('chatterbox_turbo', {
        speech_options: { supported_generation_params: ['temperature'] },
        audio_tags: CHATTERBOX_TURBO_TAGS,
      }),
      { model: 'chatterbox_turbo' },
    );

    const cues = utils.getByTestId('tts-tag-kind-provider-cues');
    expect(within(cues).getByText('tagKindCues · 9')).toBeTruthy();
    expect(within(cues).getByText('tagModeClosed')).toBeTruthy();
    expect(within(utils.getByTestId('tts-tag-kind-provider-tones')).getByText('tagKindTones · 10')).toBeTruthy();
    // Breaks are absent from the block → no card, and no invented one.
    expect(utils.queryByTestId('tts-tag-kind-provider-breaks')).toBeNull();
  });

  it('shows the none-state for a tag-free model (chatterbox_multilingual)', async () => {
    const { utils } = await renderSlot(
      ttsModel('chatterbox_multilingual', {
        supports_voice_cloning: true,
        supported_generation_params: ['exaggeration', 'cfg_weight'],
        languages: [{ code: 'en', name: 'en' }],
      }),
      { model: 'chatterbox_multilingual', voice: '', language: 'en' },
    );

    expect(utils.getByTestId('tts-no-audio-tags')).toBeTruthy();
    expect(utils.getByText('audioTagsNoneHint')).toBeTruthy();
    // No fabricated kinds and no stale 5-tag pill list.
    expect(utils.queryByTestId('tts-tag-kind-provider-cues')).toBeNull();
    expect(utils.queryByText('[laughter]')).toBeNull();
  });

  it('warns that Eleven v2 models read delivery guides ALOUD', async () => {
    const { utils } = await renderSlot(
      ttsModelWithMeta('eleven_multilingual_v2', {
        speech_options: { supported_generation_params: ['stability'] },
      }),
      { model_id: 'eleven_multilingual_v2', voice_id: '' },
      'elevenlabs',
    );

    expect(utils.getByTestId('tts-no-audio-tags')).toBeTruthy();
    expect(utils.getByTestId('tts-audio-tags-v2-warning-provider')).toBeTruthy();
    expect(utils.getByText('audioTagsV2Warning')).toBeTruthy();
  });

  it('shows ONE legacy row for an old engine (flat tags, no kinds)', async () => {
    const { utils } = await renderSlot(
      ttsModel('chatterbox_turbo', {
        supported_generation_params: ['temperature'],
        paralinguistic_tags: ['[laugh]', '[sigh]', '[cough]'],
      }),
      { model: 'chatterbox_turbo' },
    );

    expect(utils.getByTestId('tts-legacy-audio-tags-provider')).toBeTruthy();
    expect(utils.getByText('audioTagsLegacyHint')).toBeTruthy();
    // No kind is fabricated from a flat list.
    expect(utils.queryByTestId('tts-tag-kind-provider-cues')).toBeNull();
    expect(utils.queryByTestId('tts-no-audio-tags')).toBeNull();
  });

  it('resolves the kinds from the catalog even when the live descriptor lacks them', async () => {
    // Live discovery descriptors carry only speech_options, never audio_tags.
    const { utils } = await renderSlot(
      ttsModelWithMeta('eleven_v3', {
        speech_options: { supported_generation_params: ['stability'] },
        audio_tags: ELEVEN_OPEN_TAGS,
      }),
      { model_id: 'eleven_v3' },
      'elevenlabs',
      [{ id: 'eleven_v3', label: 'Eleven v3', capabilities: ['tts'] }],
    );

    expect(utils.getByTestId('tts-tag-kind-provider-cues')).toBeTruthy();
    expect(within(utils.getByTestId('tts-tag-kind-provider-tones')).getByText('tagKindTones · 48')).toBeTruthy();
  });
});

describe('ProviderSlotSection — Accent (ElevenLabs v3/v4 only)', () => {
  const EL_V3_SPEECH = {
    supported_generation_params: ['stability'],
    accents: ['British accent', 'American accent', 'Australian accent'],
  };

  it('offers the engine-seeded accents and writes capability.accent', async () => {
    const { utils, onCapabilityChange } = await renderSlot(
      ttsModelWithMeta('eleven_v3', {
        speech_options: EL_V3_SPEECH,
        audio_tags: ELEVEN_OPEN_TAGS,
      }),
      { model_id: 'eleven_v3', voice_id: '', accent: '' },
      'elevenlabs',
    );

    expect(utils.getByTestId('tts-accent-picker-provider')).toBeTruthy();
    // The picker shows the plain word — never a bracketed tag.
    expect(utils.getByText('accentBoundaryHint')).toBeTruthy();

    await fireEvent.press(utils.getByLabelText('accent'));
    await fireEvent.press(utils.getByText('British accent'));

    expect(onCapabilityChange).toHaveBeenCalledWith('accent', 'British accent');
  });

  it('keeps a saved accent that the declared list omits visible as-is', async () => {
    const { utils } = await renderSlot(
      ttsModelWithMeta('eleven_v3', {
        speech_options: EL_V3_SPEECH,
        audio_tags: ELEVEN_OPEN_TAGS,
      }),
      { model_id: 'eleven_v3', voice_id: '', accent: 'Kiwi accent' },
      'elevenlabs',
    );

    expect(within(utils.getByTestId('tts-accent-picker-provider')).getByText('Kiwi accent')).toBeTruthy();
  });

  it('falls back to the tier-2 catalog row when the live descriptor has no accents', async () => {
    const { utils } = await renderSlot(
      ttsModelWithMeta('eleven_v4', {
        speech_options: { ...EL_V3_SPEECH, supported_generation_params: ['stability'] },
        audio_tags: ELEVEN_OPEN_TAGS,
      }),
      { model_id: 'eleven_v4', voice_id: '', accent: '' },
      'elevenlabs',
      [
        {
          id: 'eleven_v4',
          label: 'Eleven v4',
          capabilities: ['tts'],
          meta: { speech_options: { supported_generation_params: ['stability'] } },
        },
      ],
    );

    expect(utils.getByTestId('tts-accent-picker-provider')).toBeTruthy();
  });

  it('never offers an accent on the tag-free v2 family', async () => {
    for (const modelId of ['eleven_multilingual_v2', 'eleven_turbo_v2_5']) {
      const { utils } = await renderSlot(
        ttsModelWithMeta(modelId, {
          // Even with an accents list declared, a tag-free model must not get
          // the picker — the tag would be SPOKEN ALOUD.
          speech_options: { supported_generation_params: ['stability'], accents: ['British accent'] },
        }),
        { model_id: modelId, voice_id: '', accent: '' },
        'elevenlabs',
      );

      expect(utils.queryByTestId('tts-accent-picker-provider')).toBeNull();
      expect(utils.queryByLabelText('accent')).toBeNull();
      await cleanup();
    }
  });

  it('shows a locked hint for a stored accent on a tag-free model', async () => {
    const { utils } = await renderSlot(
      ttsModelWithMeta('eleven_multilingual_v2', {
        speech_options: { supported_generation_params: ['stability'], accents: ['British accent'] },
      }),
      { model_id: 'eleven_multilingual_v2', voice_id: '', accent: 'British accent' },
      'elevenlabs',
    );

    expect(utils.getByTestId('tts-accent-locked-provider')).toBeTruthy();
    expect(utils.getByText('accentLocked')).toBeTruthy();
    expect(utils.queryByTestId('tts-accent-picker-provider')).toBeNull();
  });

  it('shows no accent row at all when the model declares no accent list', async () => {
    const { utils } = await renderSlot(
      ttsModelWithMeta('eleven_v3', {
        speech_options: { supported_generation_params: ['stability'] },
        audio_tags: ELEVEN_OPEN_TAGS,
      }),
      { model_id: 'eleven_v3', voice_id: '', accent: '' },
      'elevenlabs',
    );

    expect(utils.getByTestId('tts-accent-none-provider')).toBeTruthy();
    expect(utils.getByText('accentNoneHint')).toBeTruthy();
    expect(utils.queryByLabelText('accent')).toBeNull();
  });
});
