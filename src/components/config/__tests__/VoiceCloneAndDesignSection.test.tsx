/**
 * VoiceCloneAndDesignSection — operation-mode gating for Soulbits/Soulvoice.
 *
 * HarmonySpeech cannot synthesize without a speaker embedding (research
 * soulbits-model-defaults.md §3/§7), so it must open in Voice Cloning mode and
 * must not offer the single-speaker tab even when a config persisted
 * `operation_mode: 'single_speaker_tts'`. KittenTTS declares no cloning
 * surface at all → the whole section stays hidden.
 */

import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
import { VoiceCloneAndDesignSection } from '../VoiceCloneAndDesignSection';
import type { ModelInfoDto } from '../../../services/engine/EngineApiClient';

jest.mock('../../../services/engine/EngineApiClient', () => ({
  engineApiClient: {
    embedSpeaker: jest.fn(),
    cloneElevenLabsVoice: jest.fn(),
    designElevenLabsVoice: jest.fn(),
  },
}));

jest.mock('../../../services/AudioRecorder', () => ({
  __esModule: true,
  default: { startRecording: jest.fn(), stopRecording: jest.fn() },
}));

jest.mock('../../../services/AudioPlayer', () => ({
  __esModule: true,
  default: { playAudio: jest.fn() },
}));

jest.mock('../VoiceEmbeddingHeatmap', () => ({
  VoiceEmbeddingHeatmap: () => null,
  decodeEmbeddingFloats: () => [],
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

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

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

afterEach(async () => {
  await cleanup();
});

const ttsModel = (id: string, speechOptions: Record<string, unknown>): ModelInfoDto => ({
  id,
  label: id,
  capabilities: ['tts'],
  meta: { speech_options: speechOptions },
});

async function renderSection(model: ModelInfoDto, capability: Record<string, any>) {
  return render(
    <VoiceCloneAndDesignSection
      providerType="soulbitscloud"
      accountId="acc-1"
      selectedModel={model}
      capability={capability}
      onCapabilityChange={jest.fn()}
    />,
  );
}

describe('VoiceCloneAndDesignSection — Soul operation modes', () => {
  it('opens HarmonySpeech in Voice Cloning mode with no single-speaker tab', async () => {
    const utils = await renderSection(
      ttsModel('harmonyspeech', {
        supports_voice_cloning: true,
        operation_modes: ['single_speaker_tts', 'voice_cloning'],
        supported_generation_params: ['speed', 'pitch', 'energy'],
      }),
      // A stale persisted choice must not win for an embedding-only model.
      { model: 'harmonyspeech', operation_mode: 'single_speaker_tts' },
    );

    expect(utils.getByTestId('voice-clone-section')).toBeTruthy();
    expect(
      utils.getByTestId('tts-operation-mode-voice_cloning').props.accessibilityState.selected,
    ).toBe(true);
    expect(utils.queryByTestId('tts-operation-mode-single_speaker_tts')).toBeNull();
  });

  it('keeps both tabs for chatterbox (cloning is optional there)', async () => {
    const utils = await renderSection(
      ttsModel('chatterbox', {
        supports_voice_cloning: true,
        operation_modes: ['single_speaker_tts', 'voice_cloning'],
        supported_generation_params: ['exaggeration', 'cfg_weight'],
      }),
      { model: 'chatterbox' },
    );

    expect(utils.getByTestId('tts-operation-mode-single_speaker_tts')).toBeTruthy();
    expect(
      utils.getByTestId('tts-operation-mode-voice_cloning').props.accessibilityState.selected,
    ).toBe(true);
  });

  it('stays hidden for KittenTTS (no cloning surface)', async () => {
    const utils = await renderSection(
      ttsModel('kitten-tts-mini', {
        supports_voice_cloning: false,
        operation_modes: ['single_speaker_tts'],
        supported_generation_params: ['speed'],
      }),
      { model: 'kitten-tts-mini' },
    );

    expect(utils.queryByTestId('voice-clone-section')).toBeNull();
  });
});
