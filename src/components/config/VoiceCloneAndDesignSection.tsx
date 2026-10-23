/**
 * VoiceCloneAndDesignSection — capability-tree driven Voice Cloning / Voice
 * Design UI for the TTS config editor (Phase 3-5).
 *
 * Two provider families are covered:
 *
 *  - **Soulbits Cloud / Soulvoice** — when the selected model declares
 *    `voice_cloning` (either `supports_voice_cloning` or an `operation_modes`
 *    entry), show the `Single Speaker TTS` ↔ `Voice Cloning (Zero-Shot)` mode
 *    tabs. In cloning mode the user records or pastes a reference sample, taps
 *    **Generate Speaker Embedding** (`POST /api/module-configs/tts/embed-speaker`)
 *    and the returned float32 vector is rendered as a 2D heatmap.
 *
 *  - **ElevenLabs** — `Voice Library` | `Instant Voice Clone` |
 *    `Voice Design (Prompt)` tabs. Instant cloning posts the reference audio to
 *    `/api/providers/elevenlabs/voices/clone` and selects the returned voice id;
 *    Voice Design requests previews from `/voices/design` and can save a chosen
 *    generated voice id.
 *
 * All persistence flows through the parent's capability overlay via
 * `onCapabilityChange`, so the section never owns config state.
 *
 * Visual language: the dashed magenta `clone-box` / `mode-tabs` / `slider-box`
 * treatment from `3 - TTS Voice Design Cloning & Realtime STT+VAD Pipeline
 * Preview.html`.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import {
  getSpeechOptions,
  resolveEffectiveSpeechOptions,
} from '../../constants/modelCapabilities';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import type { ModelInfoDto } from '../../services/engine/EngineApiClient';
import AudioRecorder from '../../services/AudioRecorder';
import AudioPlayer from '../../services/AudioPlayer';
import {
  VoiceEmbeddingHeatmap,
  decodeEmbeddingFloats,
} from './VoiceEmbeddingHeatmap';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[VoiceCloneAndDesignSection]');

export interface VoiceCloneAndDesignSectionProps {
  providerType: string;
  accountId: string | null;
  selectedModel: ModelInfoDto | null;
  capability: Record<string, any>;
  onCapabilityChange: (key: string, value: any) => void;
  /** Called after a clone/design operation resolves a new voice id. */
  onVoiceCloned?: (voiceId: string) => void;
}

type SoulMode = 'single_speaker_tts' | 'voice_cloning';
type ElevenLabsMode = 'voice_library' | 'instant_clone' | 'voice_design';

interface DesignPreview {
  generated_voice_id: string;
  audio_base_64: string;
  media_type?: string;
  duration_secs?: number;
}

const SOUL_PROVIDERS = new Set(['soulbitscloud', 'soulvoice']);

const SOUL_MODES: Array<[SoulMode, string]> = [
  ['single_speaker_tts', '🗣️ Single-Speaker'],
  ['voice_cloning', '🧬 Voice Cloning'],
];

const ELEVEN_MODES: Array<[ElevenLabsMode, string]> = [
  ['voice_library', '🎙️ Account Voices'],
  ['instant_clone', '🧬 Instant Clone'],
  ['voice_design', '✨ Voice Design'],
];

/** Exact 8×6 (48-cell) purple/magenta heatmap matrix from File 3 Tab 1. */
const PREVIEW_HEATMAP_ROWS: string[][] = [
  ['#1E1B4B', '#312E81', '#4C1D95', '#6D28D9', '#7C3AED', '#9333EA', '#C026D3', '#E879F9'],
  ['#4C1D95', '#7C3AED', '#A855F7', '#D946EF', '#F472B6', '#C026D3', '#6D28D9', '#312E81'],
  ['#312E81', '#6D28D9', '#C026D3', '#E879F9', '#F0ABFC', '#E879F9', '#9333EA', '#4C1D95'],
  ['#1E1B4B', '#4C1D95', '#9333EA', '#D946EF', '#E879F9', '#A855F7', '#5B21B6', '#312E81'],
  ['#312E81', '#5B21B6', '#7C3AED', '#A855F7', '#C026D3', '#7C3AED', '#4C1D95', '#1E1B4B'],
  ['#1E1B4B', '#312E81', '#4C1D95', '#6D28D9', '#7C3AED', '#5B21B6', '#312E81', '#1E1B4B'],
];

/** Numeric capability value with a safe fallback. */
function numberValue(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const VoiceCloneAndDesignSection: React.FC<
  VoiceCloneAndDesignSectionProps
> = ({
  providerType,
  accountId,
  selectedModel,
  capability,
  onCapabilityChange,
  onVoiceCloned,
}) => {
  const { theme } = useAppTheme();

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<DesignPreview[]>([]);
  const [savedPreviewId, setSavedPreviewId] = useState<string | null>(null);

  const setCap = useCallback(
    (key: string, value: any) => onCapabilityChange(key, value),
    [onCapabilityChange],
  );

  if (!theme) return null;

  const speech =
    resolveEffectiveSpeechOptions(selectedModel, capability.model, providerType) ??
    getSpeechOptions(selectedModel);
  const operationModes = speech?.operation_modes ?? [];
  const supportsCloning =
    speech?.supports_voice_cloning === true || operationModes.includes('voice_cloning');

  const inputAudio = String(capability.input_audio ?? '');
  const targetEmbedding = String(capability.target_embedding ?? '');
  const isSoul = SOUL_PROVIDERS.has(providerType);
  const isElevenLabs = providerType === 'elevenlabs';

  const embeddingDims = targetEmbedding
    ? decodeEmbeddingFloats(targetEmbedding).length
    : 0;

  const toggleRecording = async () => {
    hapticLightPress();
    setError(null);
    try {
      if (recording) {
        const result = await AudioRecorder.stopRecording();
        setRecording(false);
        setCap('input_audio', result.data);
      } else {
        await AudioRecorder.startRecording();
        setRecording(true);
      }
    } catch (e: any) {
      setRecording(false);
      setError(e?.message ?? 'Audio recording failed');
      log.error('Reference recording failed:', e);
    }
  };

  const playReference = async () => {
    if (!inputAudio) return;
    try {
      await AudioPlayer.playAudio(inputAudio, 'audio/wav');
    } catch (e: any) {
      setError(e?.message ?? 'Playback failed');
    }
  };

  const generateEmbedding = async () => {
    if (!inputAudio) {
      setError('Record or paste a reference sample first.');
      return;
    }
    hapticLightPress();
    setBusy(true);
    setError(null);
    try {
      const res = await engineApiClient.embedSpeaker({
        provider: providerType,
        provider_account_id: accountId,
        model: capability.model,
        capability_json: capability,
        input_audio: inputAudio,
      });
      setCap('target_embedding', res.data);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to generate speaker embedding');
      log.error('Embedding failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const cloneElevenLabsVoice = async () => {
    const name = String(capability.voice_name ?? '').trim();
    if (!name) {
      setError('Voice name is required.');
      return;
    }
    if (!inputAudio) {
      setError('Record or paste a reference sample first.');
      return;
    }
    hapticLightPress();
    setBusy(true);
    setError(null);
    try {
      const res = await engineApiClient.cloneElevenLabsVoice({
        name,
        audio_files: [inputAudio],
        remove_background_noise: capability.remove_background_noise === true,
        provider_account_id: accountId,
      });
      const voiceId = String(res?.data?.voice_id ?? res?.voice_id ?? '');
      if (!voiceId) throw new Error('No voice id returned');
      setCap('voice_id', voiceId);
      onVoiceCloned?.(voiceId);
    } catch (e: any) {
      setError(e?.message ?? 'Voice cloning failed');
      log.error('ElevenLabs clone failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const requestDesignPreviews = async () => {
    const description = String(capability.voice_description ?? '').trim();
    const sampleText = String(capability.text ?? '');
    const autoGenerate = capability.auto_generate_text === true;
    if (!description) {
      setError('Voice description is required.');
      return;
    }
    if (!autoGenerate && sampleText.trim().length < 100) {
      setError('Sample text must be at least 100 characters (or enable auto-generate).');
      return;
    }
    hapticLightPress();
    setBusy(true);
    setError(null);
    setSavedPreviewId(null);
    try {
      const res = await engineApiClient.designElevenLabsVoice({
        action: 'preview',
        voice_description: description,
        text: sampleText,
        auto_generate_text: autoGenerate,
        provider_account_id: accountId,
      });
      const rawPreviews = (res?.data?.previews ??
        res?.previews ??
        []) as unknown as DesignPreview[];
      setPreviews(rawPreviews.filter((p) => p?.generated_voice_id && p?.audio_base_64));
    } catch (e: any) {
      setError(e?.message ?? 'Voice preview generation failed');
      log.error('ElevenLabs design preview failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const saveDesignedVoice = async (preview: DesignPreview) => {
    const description = String(capability.voice_description ?? '').trim();
    const voiceName =
      String(capability.voice_name ?? '').trim() || 'Designed Voice';
    hapticLightPress();
    setBusy(true);
    setError(null);
    try {
      const res = await engineApiClient.designElevenLabsVoice({
        action: 'save',
        voice_name: voiceName,
        voice_description: description,
        generated_voice_id: preview.generated_voice_id,
        provider_account_id: accountId,
      });
      const voiceId = String(res?.data?.voice_id ?? res?.voice_id ?? '');
      if (voiceId) {
        setCap('voice_id', voiceId);
        onVoiceCloned?.(voiceId);
      }
      setSavedPreviewId(preview.generated_voice_id);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save designed voice');
      log.error('ElevenLabs design save failed:', e);
    } finally {
      setBusy(false);
    }
  };

  // ── Shared visual primitives ────────────────────────────────────────────

  const gradientButton = (
    label: string,
    onPress: () => void,
    testID: string,
    extraStyle?: object,
    disabled?: boolean,
  ) => (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={[
        styles.gradientButtonWrap,
        extraStyle,
        disabled || busy ? styles.disabled : null,
      ]}
    >
      <LinearGradient
        colors={['#D946EF', '#9333EA']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientButton}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : null}
        <ThemedText size={11.5} weight="medium" style={styles.gradientButtonText}>
          {label}
        </ThemedText>
      </LinearGradient>
    </TouchableOpacity>
  );

  const modeTabs = (
    testID: string,
    modes: Array<[string, string]>,
    activeMode: string,
    onSelect: (mode: string) => void,
  ) => (
    <View style={styles.modeTabs} testID={testID}>
      {modes.map(([id, label]) => {
        const active = activeMode === id;
        return (
          <TouchableOpacity
            key={id}
            testID={`${
              testID === 'tts-operation-mode-tabs'
                ? 'tts-operation-mode'
                : 'elevenlabs-mode'
            }-${id}`}
            onPress={() => {
              hapticLightPress();
              onSelect(id);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.modeTab, active ? styles.modeTabActive : null]}
          >
            <ThemedText
              size={10.5}
              style={active ? styles.modeTabActiveText : styles.modeTabText}
            >
              {label}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const cloneBoxHeader = (title: string, endpoint: string) => (
    <View style={styles.sectionTitleRow}>
      <ThemedText size={11.5} style={styles.cloneTitle}>
        {title}
      </ThemedText>
      <View style={styles.endpointBadge}>
        <ThemedText size={9.5} style={styles.endpointBadgeText}>
          {endpoint}
        </ThemedText>
      </View>
    </View>
  );

  const referenceAudioRow = (recordTestID: string, playTestID: string) => (
    <View style={styles.referenceRow}>
      <View style={[styles.darkInput, styles.referenceStatus]}>
        <ThemedText size={11} numberOfLines={1} style={styles.referenceText}>
          {inputAudio
            ? `📎 Reference loaded (${inputAudio.length} chars)`
            : '📎 No reference audio'}
        </ThemedText>
        <TouchableOpacity
          testID={playTestID}
          onPress={() => {
            void playReference();
          }}
          disabled={!inputAudio}
          accessibilityRole="button"
          accessibilityLabel="Play reference sample"
        >
          <ThemedText
            size={10.5}
            style={inputAudio ? styles.playReferenceText : styles.playReferenceDisabled}
          >
            ▶ Play
          </ThemedText>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        testID={recordTestID}
        onPress={() => {
          void toggleRecording();
        }}
        accessibilityRole="button"
        accessibilityLabel={recording ? 'Stop recording' : 'Pick or record reference sample'}
        style={[
          styles.btnOutlineDark,
          recording ? styles.recordButtonActive : null,
        ]}
      >
        <ThemedText
          size={10.5}
          style={recording ? styles.recordButtonActiveText : styles.btnOutlineDarkText}
        >
          {recording ? '⏹ Stop' : '📂 Pick / Mic'}
        </ThemedText>
      </TouchableOpacity>
    </View>
  );

  const miniSlider = (
    label: string,
    key: string,
    fallback: number,
    min: number,
    max: number,
    step: number,
  ) => {
    const value = numberValue(capability[key], fallback);
    const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    const set = (next: number) =>
      setCap(key, Number(Math.min(max, Math.max(min, next)).toFixed(2)));
    return (
      <View style={[styles.sliderBox, styles.twoColItem]}>
        <View style={styles.sliderTop}>
          <ThemedText size={10.5} style={styles.sliderLabel}>
            {label}
          </ThemedText>
          <ThemedText size={10.5} style={styles.sliderValue}>
            {value.toFixed(1)}
          </ThemedText>
        </View>
        <View style={styles.sliderTrack}>
          <LinearGradient
            colors={['#A855F7', '#E879F9']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.sliderFill, { width: `${pct}%` }]}
          />
        </View>
        <View style={styles.sliderStepRow}>
          <TouchableOpacity
            onPress={() => set(value - step)}
            accessibilityRole="button"
            accessibilityLabel={`Decrease ${label}`}
          >
            <ThemedText size={11} style={styles.sliderStepText}>−</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => set(value + step)}
            accessibilityRole="button"
            accessibilityLabel={`Increase ${label}`}
          >
            <ThemedText size={11} style={styles.sliderStepText}>+</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const errorBlock = error ? (
    <ThemedText
      size={12}
      testID="voice-clone-error"
      style={{ color: theme.colors.status.error }}
    >
      {error}
    </ThemedText>
  ) : null;

  // ── Soulbits Cloud / Soulvoice voice cloning ────────────────────────────
  if (isSoul) {
    if (!supportsCloning) return null;
    // Default to `voice_cloning` unless explicitly switched to `single_speaker_tts`
    // (matches File 3 Tab 1 `let currentTtsMode = 'voice_cloning'`). HarmonySpeech
    // cannot synthesize without a speaker embedding at all (research
    // soulbits-model-defaults.md §3/§7), so a persisted single-speaker choice
    // must not win there — and the single-speaker tab is hidden entirely.
    const requiresEmbedding = String(selectedModel?.id ?? capability.model ?? '')
      .toLowerCase()
      .includes('harmonyspeech');
    const singleSpeakerSupported =
      operationModes.length === 0 || operationModes.includes('single_speaker_tts');
    const allowSingleSpeaker = singleSpeakerSupported && !requiresEmbedding;
    const soulMode: SoulMode =
      capability.operation_mode === 'single_speaker_tts' && allowSingleSpeaker
        ? 'single_speaker_tts'
        : 'voice_cloning';
    const soulModes = allowSingleSpeaker
      ? SOUL_MODES
      : SOUL_MODES.filter(([mode]) => mode === 'voice_cloning');

    return (
      <View style={styles.wrapper} testID="voice-clone-section">
        <ThemedText size={11} style={styles.fieldLabel}>
          Operation Mode (from model speech_options)
        </ThemedText>
        {modeTabs('tts-operation-mode-tabs', soulModes, soulMode, (mode) =>
          setCap('operation_mode', mode as SoulMode),
        )}

        {soulMode === 'voice_cloning' ? (
          <View style={styles.cloneBox}>
            {cloneBoxHeader('🧬 Speaker Embedding & Voice Cloning', 'POST /v1/embed/speaker')}
            {referenceAudioRow('tts-record-reference-button', 'tts-play-reference-button')}

            <View style={styles.heatmapRow}>
              {targetEmbedding ? (
                <VoiceEmbeddingHeatmap embeddingBase64={targetEmbedding} compact />
              ) : (
                <View style={styles.previewHeatmapGrid} testID="voice-embedding-preview-grid">
                  {PREVIEW_HEATMAP_ROWS.map((row, rIdx) => (
                    <View key={rIdx} style={styles.previewHeatmapRow}>
                      {row.map((color, cIdx) => (
                        <View
                          key={`${rIdx}-${cIdx}`}
                          style={[styles.previewHeatmapCell, { backgroundColor: color }]}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.heatmapInfo}>
                <View style={styles.heatmapTopRow}>
                  <ThemedText
                    size={11.5}
                    style={
                      targetEmbedding
                        ? styles.embeddingReadyText
                        : styles.embeddingReadyText
                    }
                  >
                    {targetEmbedding ? '✓ Embedding Ready' : '✓ 2D Vector Preview'}
                  </ThemedText>
                  <ThemedText
                    size={10}
                    testID="voice-embedding-dims"
                    style={styles.embeddingDims}
                  >
                    {`${embeddingDims || 256}-d vector`}
                  </ThemedText>
                </View>
                <ThemedText size={10.5} numberOfLines={1} style={styles.embeddingSubtitle}>
                  {`Extracted for ${
                    selectedModel?.id || capability.model || 'openvoice_v2'
                  }`}
                </ThemedText>
                {gradientButton(
                  `⚡ ${
                    targetEmbedding
                      ? 'Re-Generate Embedding'
                      : 'Generate Speaker Embedding'
                  }`,
                  () => {
                    void generateEmbedding();
                  },
                  'tts-generate-embedding-button',
                )}
              </View>
            </View>
          </View>
        ) : null}
        {errorBlock}
      </View>
    );
  }

  // ── ElevenLabs: Voice Library / Instant Clone / Voice Design ───────────
  if (!isElevenLabs) return null;

  const elevenMode: ElevenLabsMode =
    capability.elevenlabs_mode === 'instant_clone' ||
    capability.elevenlabs_mode === 'voice_design'
      ? capability.elevenlabs_mode
      : 'voice_library';

  const libraryVoices = (speech?.voices ?? [])
    .map((voice) =>
      typeof voice === 'string'
        ? { id: voice, name: voice }
        : { id: String(voice.id ?? voice.name ?? ''), name: String(voice.name ?? voice.id ?? '') },
    )
    .filter((voice) => voice.id !== '');

  return (
    <View style={styles.wrapper} testID="elevenlabs-voice-section">
      <ThemedText size={10.5} style={styles.fieldLabel}>
        Voice Mode
      </ThemedText>
      {modeTabs('elevenlabs-mode-tabs', ELEVEN_MODES, elevenMode, (mode) =>
        setCap('elevenlabs_mode', mode as ElevenLabsMode),
      )}

      {elevenMode === 'voice_library' && libraryVoices.length > 0 ? (
        <View style={styles.cloneBox}>
          {cloneBoxHeader('🎙️ Account Voices (/v2/voices)', 'GET /v1/voices')}
          <View style={styles.chips}>
            {libraryVoices.map((voice) => {
              const active = capability.voice_id === voice.id;
              return (
                <TouchableOpacity
                  key={voice.id}
                  testID={`elevenlabs-voice-${voice.id}`}
                  onPress={() => {
                    hapticLightPress();
                    setCap('voice_id', voice.id);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active ? styles.chipActive : null]}
                >
                  <ThemedText
                    size={10.5}
                    style={active ? styles.chipActiveText : styles.chipText}
                  >
                    {voice.name || voice.id}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {elevenMode === 'instant_clone' ? (
        <View style={styles.cloneBox}>
          {cloneBoxHeader('🧬 ElevenLabs Instant Voice Cloning (IVC)', 'POST /v1/voices/add')}

          <View style={styles.twoCol}>
            <View style={styles.twoColItem}>
              <ThemedText size={10.5} style={styles.fieldLabel}>
                New Voice Name *
              </ThemedText>
              <TextInput
                testID="elevenlabs-clone-name-input"
                value={String(capability.voice_name ?? '')}
                onChangeText={(text) => setCap('voice_name', text)}
                placeholder="My cloned voice"
                placeholderTextColor="#64748B"
                style={[styles.darkInput, styles.inputText]}
              />
            </View>
            <View style={styles.twoColItem}>
              <ThemedText size={10.5} style={styles.fieldLabel}>
                Reference Samples (1–3)
              </ThemedText>
              <TouchableOpacity
                testID="elevenlabs-clone-reference-button"
                onPress={() => {
                  void toggleRecording();
                }}
                accessibilityRole="button"
                style={styles.darkInput}
              >
                <ThemedText size={10.5} numberOfLines={1} style={styles.referenceText}>
                  {recording
                    ? '⏹ Recording…'
                    : inputAudio
                      ? `📎 + Audio file (${inputAudio.length} chars)`
                      : '+ Add audio file'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.toggleRow}>
            <ThemedText size={10.5} style={styles.toggleLabel}>
              Isolate & Remove Background Noise
            </ThemedText>
            <Switch
              testID="elevenlabs-clone-remove-noise-switch"
              value={capability.remove_background_noise === true}
              onValueChange={(value) => setCap('remove_background_noise', value)}
              trackColor={{ false: '#334155', true: '#D946EF' }}
              thumbColor="#F8FAFC"
            />
          </View>

          {gradientButton(
            '🧬 Clone Voice & Select in Config',
            () => {
              void cloneElevenLabsVoice();
            },
            'elevenlabs-clone-voice-button',
            styles.fullWidth,
          )}
        </View>
      ) : null}

      {elevenMode === 'voice_design' ? (
        <View style={styles.cloneBox}>
          {cloneBoxHeader('✨ ElevenLabs Voice Design (Text-to-Voice)', '/v1/text-to-voice')}

          <ThemedText size={10.5} style={styles.fieldLabel}>
            Voice Description Prompt *
          </ThemedText>
          <TextInput
            testID="elevenlabs-design-description-input"
            value={String(capability.voice_description ?? '')}
            onChangeText={(text) => setCap('voice_description', text)}
            placeholder="A warm, raspy narrator with a slight British accent…"
            placeholderTextColor="#64748B"
            multiline
            numberOfLines={3}
            style={[styles.darkInput, styles.textArea]}
          />

          <ThemedText size={10.5} style={styles.fieldLabel}>
            Sample Text
          </ThemedText>
          <TextInput
            testID="elevenlabs-design-text-input"
            value={String(capability.text ?? '')}
            onChangeText={(text) => setCap('text', text)}
            placeholder="At least 100 characters, or enable auto-generate…"
            placeholderTextColor="#64748B"
            multiline
            numberOfLines={3}
            style={[styles.darkInput, styles.textArea]}
          />

          <View style={styles.toggleRow}>
            <ThemedText size={10.5} style={styles.toggleLabel}>
              Auto-generate sample text
            </ThemedText>
            <Switch
              testID="elevenlabs-auto-text"
              value={capability.auto_generate_text === true}
              onValueChange={(value) => setCap('auto_generate_text', value)}
              trackColor={{ false: '#334155', true: '#D946EF' }}
              thumbColor="#F8FAFC"
            />
          </View>

          <View style={styles.twoCol}>
            {miniSlider('Guidance Scale', 'guidance_scale', 5, 0, 10, 0.5)}
            {miniSlider('Loudness', 'loudness', 0.5, 0, 1, 0.05)}
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              testID="elevenlabs-design-preview-button"
              onPress={() => {
                void requestDesignPreviews();
              }}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.btnOutlineDark, styles.flexButton]}
            >
              <ThemedText size={11} style={styles.btnOutlineDarkText}>
                ▶ Preview 3 Candidates
              </ThemedText>
            </TouchableOpacity>
            {gradientButton(
              '✨ Save Designed Voice',
              () => {
                if (previews[0]) void saveDesignedVoice(previews[0]);
              },
              'elevenlabs-design-save-button',
              styles.flexButton,
              previews.length === 0,
            )}
          </View>

          {previews.length > 0 ? (
            <View style={styles.previews} testID="elevenlabs-previews">
              {previews.map((preview, index) => (
                <View
                  key={preview.generated_voice_id}
                  style={styles.previewRow}
                  testID={`elevenlabs-preview-${index}`}
                >
                  <TouchableOpacity
                    testID={`elevenlabs-preview-play-${index}`}
                    onPress={() => {
                      hapticLightPress();
                      void AudioPlayer.playAudio(
                        preview.audio_base_64,
                        preview.media_type || 'audio/mpeg',
                      ).catch((e) => setError((e as Error)?.message ?? 'Playback failed'));
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Play voice preview"
                    style={styles.iconButton}
                  >
                    <Icon name="play-circle-outline" size={20} color="#E879F9" />
                  </TouchableOpacity>
                  <ThemedText size={11} style={styles.previewName}>
                    {`Preview ${index + 1}`}
                  </ThemedText>
                  <TouchableOpacity
                    testID={`elevenlabs-preview-save-${index}`}
                    onPress={() => {
                      void saveDesignedVoice(preview);
                    }}
                    disabled={busy}
                    accessibilityRole="button"
                    style={styles.btnOutlineDark}
                  >
                    <ThemedText size={10.5} style={styles.btnOutlineDarkText}>
                      {savedPreviewId === preview.generated_voice_id ? 'Saved' : 'Save Voice'}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {errorBlock}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  fieldLabel: {
    color: '#CBD5E1',
    fontWeight: '600',
    marginBottom: 1,
  },

  // ── Mode tabs (`mode-tabs`) ──
  modeTabs: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 4,
    backgroundColor: '#070B14',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 10,
    padding: 4,
  },
  modeTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modeTabActive: {
    backgroundColor: 'rgba(232, 121, 249, 0.18)',
    borderColor: 'rgba(232, 121, 249, 0.38)',
  },
  modeTabText: { color: '#64748B', fontWeight: '600' },
  modeTabActiveText: { color: '#E879F9', fontWeight: '600' },

  // ── Dashed magenta clone box (`clone-box`) ──
  cloneBox: {
    backgroundColor: 'rgba(7, 11, 20, 0.72)',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(232, 121, 249, 0.4)',
    borderRadius: 11,
    padding: 10,
    gap: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  cloneTitle: {
    flexShrink: 1,
    color: '#E879F9',
    fontWeight: '600',
  },
  endpointBadge: {
    backgroundColor: 'rgba(232, 121, 249, 0.15)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  endpointBadgeText: {
    color: '#E879F9',
    fontWeight: '600',
  },

  // ── Inputs ──
  darkInput: {
    backgroundColor: '#070B14',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  inputText: {
    color: '#E2E8F0',
    fontSize: 11.5,
    paddingVertical: 8,
  },
  textArea: {
    color: '#E2E8F0',
    fontSize: 11,
    lineHeight: 16,
    minHeight: 58,
    textAlignVertical: 'top',
    alignItems: 'flex-start',
  },
  referenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  referenceStatus: {
    flex: 1,
  },
  referenceText: {
    flexShrink: 1,
    color: '#CBD5E1',
  },
  playReferenceText: { color: '#38BDF8', fontWeight: '600' },
  playReferenceDisabled: { color: '#475569', fontWeight: '600' },

  // ── Heatmap row ──
  heatmapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0F1626',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 9,
    padding: 8,
  },
  placeholderGrid: {
    width: 6 * 8 + 1.5 * 7,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 1.5,
    flexShrink: 0,
  },
  placeholderCell: {
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: 'rgba(76, 29, 149, 0.45)',
  },
  previewHeatmapGrid: {
    gap: 1.5,
    borderRadius: 4,
    overflow: 'hidden',
    flexShrink: 0,
  },
  previewHeatmapRow: {
    flexDirection: 'row',
    gap: 1.5,
  },
  previewHeatmapCell: {
    width: 6,
    height: 6,
    borderRadius: 1,
  },
  heatmapInfo: {
    flex: 1,
    gap: 3,
  },
  heatmapTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  embeddingReadyText: { color: '#4ADE80', fontWeight: '700' },
  embeddingMissingText: { color: '#64748B', fontWeight: '600' },
  embeddingDims: { color: '#64748B' },
  embeddingSubtitle: { color: '#64748B' },

  // ── Buttons ──
  gradientButtonWrap: {
    borderRadius: 9,
    overflow: 'hidden',
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  gradientButtonText: { color: '#FFFFFF', fontWeight: '700' },
  disabled: { opacity: 0.55 },
  fullWidth: { width: '100%' },
  flexButton: { flex: 1 },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  btnOutlineDark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 22, 38, 0.9)',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  btnOutlineDarkText: { color: '#E879F9', fontWeight: '600' },
  recordButtonActive: {
    borderColor: 'rgba(236, 72, 153, 0.55)',
    backgroundColor: 'rgba(236, 72, 153, 0.14)',
  },
  recordButtonActiveText: { color: '#f472b6', fontWeight: '600' },

  // ── Layout helpers ──
  twoCol: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  twoColItem: { flex: 1 },

  // ── Slider box (`slider-box`) ──
  sliderBox: {
    backgroundColor: '#070B14',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 4,
  },
  sliderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  sliderLabel: { color: '#CBD5E1', fontWeight: '600' },
  sliderValue: {
    color: '#E879F9',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  sliderTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    overflow: 'hidden',
  },
  sliderFill: { height: '100%', borderRadius: 999 },
  sliderStepRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 14,
  },
  sliderStepText: { color: '#94A3B8', fontWeight: '700' },

  // ── Toggle row ──
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 2,
  },
  toggleLabel: { color: '#CBD5E1', flex: 1 },

  // ── Hint box / chips / previews ──
  hintBox: {
    backgroundColor: 'rgba(7, 11, 20, 0.72)',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(148, 163, 184, 0.25)',
    borderRadius: 10,
    padding: 10,
  },
  hintText: { color: '#64748B', lineHeight: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    backgroundColor: '#070B14',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  chipActive: {
    borderColor: 'rgba(232, 121, 249, 0.5)',
    backgroundColor: 'rgba(232, 121, 249, 0.15)',
  },
  chipText: { color: '#94A3B8', fontWeight: '600' },
  chipActiveText: { color: '#E879F9', fontWeight: '600' },
  previews: { gap: 6 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#070B14',
  },
  previewName: { flex: 1, color: '#CBD5E1' },
  iconButton: { padding: 2 },
});
