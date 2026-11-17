/**
 * TtsTestPanel — TTS playback test studio for the TTS config editor
 * (persona-modules 2-3, reworked Phase 3-5 and again for the player rework).
 *
 * ## One transport — stateless direct synthesis
 *
 * The panel posts the live form settings to
 * `POST /api/module-configs/tts/test-speech` and plays the returned
 * `audio_base64`. This lets users test voice cloning, pitch/speed and voice
 * design immediately on the config editor, without saving a module config or
 * binding an AI entity.
 *
 * The entity-bound eventserver path (`INIT_ENTITY` + `TTS_GENERATE_SPEECH`) was
 * REMOVED by owner decision (2026-10-21): a saved config reaches the entity
 * anyway when it is spawned for a chat/game turn, so the panel never needs to
 * bother the entity — and the stateless route always tests the form state the
 * user is looking at.
 *
 * The `provider` field is REQUIRED by that route (engine
 * `management/routes_modules.go` → `normalizeTTSProvider`: missing/unknown →
 * "provider is required"/"unsupported provider type", surfaced as an error
 * status), so until a provider is selected the panel renders an honest
 * "select a provider" hint instead of a button that could only fail.
 *
 * The player state is the same as before: the synthesized audio is kept as
 * `lastAudio: { base64, mime }` plus the `lastSynthText` it was synthesized
 * from and a `lastSynthFingerprint` of the settings that produced it, so the
 * sample can be replayed or downloaded without another engine round-trip —
 * and can never be replayed once the settings (provider, account, capability
 * overlay: model, voice, pitch/speed, cloning params …) have moved on.
 *
 * ## Player row (rework)
 *
 * `phase` is `'idle' | 'synthesizing' | 'playing' | 'paused' | 'error'`.
 * `AudioPlayer.playAudio` resolves at playback START (it only calls
 * `TrackPlayer.play()`), so completion is detected the same way ChatBubble does:
 * a 250 ms poll of `AudioPlayer.getProgress()` / `getState()` while `playing`;
 * playback ends on `ended`/`stopped`/`none`/`error` after a real `playing`
 * observation → back to `idle` with the audio still loaded. `paused` is an
 * external interruption, handled separately (see "Completion classification").
 *
 *  - idle (no audio) → full-width gradient "▶ Synthesize & Play Sample".
 *  - synthesizing → spinner + label (inputs disabled) + disabled download.
 *  - playing / paused → compact player row: 30×30 play/pause bubble, a seek
 *    slider (`AudioPlayer.seekTo`), and a `0:03 / 0:12` time label, followed by
 *    the format badge (the ACTUAL sample format, sniffed from its bytes) and the
 *    download button.
 *  - finished → footer returns to the synthesize button (audio stays loaded):
 *    pressing it with UNCHANGED text AND settings replays instantly (the queue
 *    is REBUILT from the kept bytes — an external reset can outlive the
 *    panel's state), while an edited text OR a changed setting (the voice the
 *    user is now hearing must come from the settings the user is looking at)
 *    re-synthesizes.
 *
 * Duration comes up-front from the static `getDurationFromBase64` parser (which
 * sniffs the container, so declared-vs-actual mismatches — e.g. mp3 declared but
 * WAV bytes returned — still yield a duration) and falls back to the polled
 * progress duration.
 *
 * ## Download
 *
 * The 28×28 icon button next to the format badge writes the kept base64 to the
 * cache directory with `react-native-fs` and opens the OS share sheet with
 * `react-native-share` — the same write+share pattern as
 * `shareDiagnostics.shareDiagnosticsReport`. A cancelled share sheet is not an
 * error (`failOnCancel: false`); real failures surface through the panel's
 * error text.
 *
 * ## Tags (tts-voice-ux Phase 3)
 *
 * The insertable vocabulary is derived from the model's KINDED capabilities
 * (`audioTags` prop → cues / tones / breaks, `mode !== 'none'`); an older
 * engine's flat `paralinguisticTags` / `legacyTags` list is the fallback (one
 * "All tags" section). A segmented switch picks the kind, at most
 * `MAX_INLINE_TAGS` chips render per kind and a dashed "[+ N more]" chip opens
 * `TtsTagPickerModal` (grouped sections, optional kind filter) — picking a row
 * appends through the same `insertTag` path as a chip press.
 *
 * EVERY chip/row inserts the ASTERISK natural form (`*sighs*`), never a
 * bracketed provider tag: brackets are a TTS-boundary syntax and the bracket-
 * free invariant covers stored/shown chat text. The "Sent to TTS" box then
 * shows the engine's own provider string (`res.text`, clearly labelled as
 * provider output) plus a muted echo of `res.input_text` — display only, never
 * persisted, never part of the replay fingerprint.
 *
 * `vocalize_nonverbal` (default off) and the cue-budget demo (default 3, posted
 * as `audio_tag_budget`) both shape the engine output and therefore BOTH take
 * part in the replay fingerprint: flipping either re-synthesizes instead of
 * replaying stale audio.
 *
 * ## Completion classification
 *
 * "Finished" is NOT "anything but playing/buffering": RNTP reports `loading`
 * and `ready` while a track is prepared, so that rule ended playback ~250 ms in
 * (the player row vanished and the keep-awake flag was dropped mid-sample).
 * Playback now only ends on `ended`/`stopped`/`none`/`error` AND after at least
 * one `playing` observation (`src/services/playbackState.ts`).
 *
 * `paused` is NOT one of those end states any more (owner device, 2026-10-21).
 * `AudioPlayer.initialize()` sets `autoHandleInterruptions: true` (media3
 * `handleAudioFocus`), so every audio-focus loss — incoming call, another app
 * claiming audio, Bluetooth turning noisy, OEM ducking — PAUSES the player
 * underneath us. Counting that as "finished" dropped the panel to `idle`: the
 * sample looked dead (no player row, no resume path although the queue still
 * held the track) and the keep-awake hold was released mid-listen. A pause the
 * USER asks for never reaches the poll — `handleTogglePlayback` moves `phase`
 * to `paused` itself — so a `paused` read while `phase === 'playing'` is by
 * definition external. The poll then auto-resumes ONCE per utterance (the
 * interruption is usually a short focus loss) and, if the player pauses again
 * or the resume throws, settles into the EXISTING `paused` phase: player row
 * stays, sample stays loaded, the user can press play to continue.
 *
 * ## Keep-awake
 *
 * The screen is kept on across the WHOLE flow — `synthesizing || playing` (never
 * while paused/idle) — via the first-party `KeepScreenOn` native helper
 * (`src/services/keepScreenOn.ts`). The synthesis wait is a long, no-touch
 * stretch that ages the display idle timer out: screen-off → Activity onStop →
 * applifecycle ON_STOP → the biometric lock re-arms with zero grace, so the
 * phone locked itself mid-flow (owner device, Android 15, 2026-10-21). The hold
 * is released on a genuine end (`idle`), on `error`, and on unmount.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Slider from '@react-native-community/slider';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { getProviderModelFieldKey } from '../../constants/providerFieldSchemas';
import { ThemedText } from '../themed/ThemedText';
import AudioPlayer, { AudioPlayer as AudioPlayerClass } from '../../services/AudioPlayer';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import {
  activateKeepScreenOn,
  deactivateKeepScreenOn,
} from '../../services/keepScreenOn';
import {
  hasPlaybackStarted,
  isPlaybackPaused,
  isPlaybackInProgress,
} from '../../services/playbackState';
import { formatDuration } from '../../utils/formatDuration';
import {
  audioMimeFor,
  detectAudioFormat,
  type AudioFormat,
} from '../../utils/audioFormat';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';
import {
  AUDIO_TAG_KINDS,
  type AudioTagCapabilities,
  type AudioTagKind,
} from '../../constants/modelCapabilities';
import { TtsTagPickerModal } from './TtsTagPickerModal';
import { paralinguisticTagTestId } from './paralinguisticTagTestIds';

export { paralinguisticTagTestId };

const log = createLogger('[TtsTestPanel]');

/**
 * Inline chip ceiling PER KIND; the rest live behind the "[+ N more]" picker
 * chip. Cues/tones vocabularies reach 48 words on Eleven v3, so a kind-scoped
 * switch + a small inline cap keeps the toolbar usable.
 */
const MAX_INLINE_TAGS = 8;

/** Cue-budget demo values (`audio_tag_budget`); 3 is the engine default. */
const CUE_BUDGET_OPTIONS = [1, 3, 5] as const;
const DEFAULT_CUE_BUDGET = 3;

/** Stable empty list (keeps the tag-section memo from re-running every render). */
const EMPTY_TAGS: string[] = [];

/** Preset sample scripts: cue + tone + break, and a narrative action. */
const SAMPLE_SCRIPTS = [
  { key: 'sampleScriptCue', labelKey: 'sampleScriptCue' },
  { key: 'sampleScriptAction', labelKey: 'sampleScriptAction' },
  { key: 'sampleScriptMixed', labelKey: 'sampleScriptMixed' },
] as const;

/** How often completion is polled while audio plays (ChatBubble parity). */
const PROGRESS_POLL_MS = 250;

type TtsPhase = 'idle' | 'synthesizing' | 'playing' | 'paused' | 'error';

/** One kind group of insertable tags (`*word*` forms). */
export interface TtsTagSection {
  /** `cues` / `tones` / `breaks`, or `all` for the legacy flat list. */
  kind: string;
  label: string;
  tags: string[];
}

/** The last synthesized sample, kept so it can be replayed and downloaded. */
interface SynthesizedAudio {
  base64: string;
  mime: string;
}

export interface TtsTestPanelProps {
  /** Provider type for stateless direct synthesis (`testTtsSpeech`). */
  providerType?: string;
  /** Selected provider account id (direct synthesis). */
  accountId?: string | null;
  /** The live capability overlay (model, voice, cloning params, …). */
  capability?: Record<string, any>;
  /**
   * Legacy flat tag list (`[sigh]`, `[laughter]`, …) — quick-insertion
   * fallback for engines that publish no kinded `audio_tags` block.
   */
  paralinguisticTags?: string[];
  /** Preferred name for the legacy flat list; wins over `paralinguisticTags`. */
  legacyTags?: string[];
  /**
   * Kinded audio-tag capabilities resolved from the TIER-2 catalog
   * (`getAudioTagCapabilities`). Drives the kinded pickers; absent ⇒ the
   * legacy flat list (or no chips at all) is used.
   */
  audioTags?: AudioTagCapabilities;
}

/**
 * A tag's ASTERISK NATURAL FORM — the only dialect stored/typed in chat text.
 *
 * `[clears throat]` / `clears throat` / `*clears throat*` all normalize to
 * `*clears throat*`, so the panel never inserts a bracketed tag (brackets exist
 * only at the TTS boundary, and the engine renders them back for display).
 */
function asteriskTagForm(tag: string): string {
  const word = tag
    .trim()
    .replace(/^[[\]*]+/, '')
    .replace(/[[\]*]+$/, '')
    .trim();
  return word === '' ? '' : `*${word}*`;
}

/** Normalize an engine `format` value into an audio mime type. */
function audioMime(format?: string): string {
  if (!format) return 'audio/wav';
  return format.includes('/') ? format : `audio/${format}`;
}

/**
 * Stable stringification — object key order INSensitive.
 *
 * Used for the replay guard's settings fingerprint. The config editor rebuilds
 * the capability overlay object on every field edit (`{...prev, [key]: value}`)
 * and object identities cannot be compared across re-renders; a canonical
 * serialization makes one field change flip the fingerprint while harmless
 * re-renders with the same content do not.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, v]) => `${JSON.stringify(key)}:${stableStringify(v)}`)
    .join(',')}}`;
}

/**
 * Fingerprint of everything that shapes a synthesis run: the provider, the
 * account, the live capability overlay AND the demo switches that change the
 * engine's output (`vocalize_nonverbal`, `audio_tag_budget`). The big-button
 * replay guard compares this against the fingerprint stored with the kept
 * sample (owner report, 2026-10-21: changing the TTS voice still replayed the
 * previous voice, because the guard only compared the sample text).
 */
function synthesisFingerprint(input: {
  providerType?: string;
  accountId?: string | null;
  capability?: Record<string, any> | null;
  vocalizeNonverbal?: boolean;
  cueBudget?: number;
}): string {
  return stableStringify({
    providerType: input.providerType ?? null,
    accountId: input.accountId ?? null,
    capability: input.capability ?? null,
    vocalizeNonverbal: input.vocalizeNonverbal ?? false,
    cueBudget: input.cueBudget ?? DEFAULT_CUE_BUDGET,
  });
}

/** File extension for a shareable sample, derived from its mime type. */
function audioFileExtension(mime: string): string {
  const value = (mime || '').toLowerCase();
  if (value.includes('mpeg') || value.includes('mp3')) return 'mp3';
  if (value.includes('ogg')) return 'ogg';
  if (value.includes('opus')) return 'opus';
  if (value.includes('flac')) return 'flac';
  if (value.includes('aac')) return 'aac';
  if (value.includes('mp4') || value.includes('m4a')) return 'm4a';
  return 'wav';
}

/** Badge label for a stored sample mime (`audio/mpeg` → `MP3`, `audio/wav` → `WAV`). */
function formatLabelForMime(mime: string): string {
  return audioFileExtension(mime).toUpperCase();
}

/** True when a DECLARED mime already names the sniffed format. */
function declaredMimeMatchesFormat(mime: string, format: AudioFormat): boolean {
  const value = (mime || '').toLowerCase();
  switch (format) {
    case 'wav':
      return value.includes('wav');
    case 'mp3':
      return value.includes('mpeg') || value.includes('mp3');
    case 'ogg':
      return value.includes('ogg') || value.includes('opus');
    case 'flac':
      return value.includes('flac');
    default:
      return true;
  }
}

/**
 * Trust the BYTES, not the declared label.
 *
 * The TTS API currently declares mp3 but returns WAV bytes (backend bug), so a
 * declared-mime-only sample got an mp3 data-URI / filename / badge and a dead
 * duration parse. Sniff the actual container once, log the mismatch, and keep
 * the actual mime — every downstream consumer (badge, download extension,
 * share type, duration parser) reads `SynthesizedAudio.mime`.
 */
function resolveSynthesizedAudio(
  base64: string,
  declaredMime: string,
): SynthesizedAudio {
  const format = detectAudioFormat(base64);
  if (format === 'unknown') {
    return { base64, mime: declaredMime };
  }
  if (!declaredMimeMatchesFormat(declaredMime, format)) {
    log.warn(
      `TTS sample declared ${declaredMime} but bytes are ${format.toUpperCase()} — using the actual format (backend format bug)`,
    );
  }
  return { base64, mime: audioMimeFor(format) };
}

/** Prefer `playBase64Audio` when available; fall back to `playAudio`. */
async function playSynthesizedAudio(audio: string, mime: string): Promise<void> {
  const player = AudioPlayer as unknown as {
    playBase64Audio?: (base64: string, mimeType?: string) => Promise<void>;
    playAudio: (base64: string, mimeType?: string) => Promise<void>;
  };
  if (typeof player.playBase64Audio === 'function') {
    await player.playBase64Audio(audio, mime);
    return;
  }
  await player.playAudio(audio, mime);
}

/**
 * Immediate duration for a just-synthesized sample.
 *
 * The service's parser is a STATIC class method while the module's default
 * export is an INSTANCE, so the static is reached through the class. Test
 * doubles attach the same function to the default export instead, so prefer it
 * when present. Always resolves (a parse failure just means the polled progress
 * duration is used instead).
 */
async function parseAudioDuration(base64: string, mime: string): Promise<number | null> {
  const instance = AudioPlayer as unknown as {
    getDurationFromBase64?: (audio: string, mimeType: string) => Promise<number | null>;
  };
  try {
    if (typeof instance.getDurationFromBase64 === 'function') {
      return await instance.getDurationFromBase64(base64, mime);
    }
    return await AudioPlayerClass.getDurationFromBase64(base64, mime);
  } catch (error) {
    log.warn('Could not determine audio duration up-front:', error);
    return null;
  }
}

export const TtsTestPanel: React.FC<TtsTestPanelProps> = ({
  providerType,
  accountId,
  capability,
  paralinguisticTags,
  legacyTags,
  audioTags,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const { isConnected } = useSyncConnection();

  const [phase, setPhase] = useState<TtsPhase>('idle');
  const [text, setText] = useState(() => t('sampleText'));
  const [error, setError] = useState<string | null>(null);
  /**
   * The engine's provider-bound string (`res.text`, the `*asterisks*` →
   * `[brackets]` translation) and the input echo (`res.input_text`). Display
   * only: they are NEVER persisted into chat text and are excluded from the
   * replay fingerprint.
   */
  const [synthText, setSynthText] = useState<string | null>(null);
  const [inputText, setInputText] = useState<string | null>(null);
  const [sentOpen, setSentOpen] = useState(true);
  /** Demo switches — both shape the engine output, so both fingerprint. */
  const [vocalizeNonverbal, setVocalizeNonverbal] = useState(false);
  const [cueBudget, setCueBudget] = useState<number>(DEFAULT_CUE_BUDGET);
  /** The kinded tag groups the model supports (empty ⇒ no pickers). */
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [pickerKind, setPickerKind] = useState<string | null>(null);
  /** The kept sample + the exact text it was synthesized from (replay guard). */
  const [lastAudio, setLastAudio] = useState<SynthesizedAudio | null>(null);
  const [lastSynthText, setLastSynthText] = useState('');
  /**
   * The settings fingerprint of the kept sample (the replay guard's other
   * half): an unchanged text with CHANGED voice settings must re-synthesize,
   * not replay the previous voice (owner report, 2026-10-21).
   */
  const [lastSynthFingerprint, setLastSynthFingerprint] = useState('');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);

  /**
   * The insertable tag groups, in display order.
   *
   * Kinded capabilities win; the LEGACY flat list is the old-engine fallback
   * (one ungrouped section). Every tag is the ASTERISK form — brackets are a
   * TTS-boundary syntax and must never reach the text field or chat.
   */
  const tagSections = useMemo<TtsTagSection[]>(() => {
    const kindLabel = (kind: AudioTagKind): string =>
      t(kind === 'cues' ? 'tagKindCues' : kind === 'tones' ? 'tagKindTones' : 'tagKindBreaks');

    const sections: TtsTagSection[] = [];
    if (audioTags) {
      for (const kind of AUDIO_TAG_KINDS) {
        const block = audioTags[kind];
        if (!block || block.mode === 'none') continue;
        const seen = new Set<string>();
        const tags: string[] = [];
        for (const word of block.vocabulary) {
          const tag = asteriskTagForm(word);
          if (tag === '' || seen.has(tag)) continue;
          seen.add(tag);
          tags.push(tag);
        }
        if (tags.length > 0) sections.push({ kind, label: kindLabel(kind), tags });
      }
    }
    if (sections.length > 0) return sections;

    const legacy = legacyTags ?? paralinguisticTags ?? EMPTY_TAGS;
    const seen = new Set<string>();
    const flat: string[] = [];
    for (const raw of legacy) {
      const tag = asteriskTagForm(raw);
      if (tag === '' || seen.has(tag)) continue;
      seen.add(tag);
      flat.push(tag);
    }
    return flat.length > 0 ? [{ kind: 'all', label: t('tagKindAll'), tags: flat }] : [];
  }, [audioTags, legacyTags, paralinguisticTags, t]);

  const activeSection =
    tagSections.find((section) => section.kind === activeKind) ?? tagSections[0];
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Has the CURRENT utterance been observed as `playing`? A poll tick that
   * lands during RNTP's pre-start `loading`/`ready` transient must never be
   * allowed to end playback; only a real end AFTER this flips can.
   */
  const hasStartedRef = useRef(false);
  /**
   * Has the poll already tried to auto-resume THIS utterance after an external
   * audio interruption (`paused` while `phase === 'playing'`)? One attempt per
   * utterance: a resume that immediately pauses again means the interruption
   * (call, other app holding focus) is still on, and fighting it would be a
   * resume loop. Reset next to [hasStartedRef] whenever playback starts anew.
   */
  const autoResumeAttemptedRef = useRef(false);

  const isOffline = !isConnected;
  // The test-speech route always needs a provider type (see the header note).
  const canSynthesize = Boolean(providerType);

  // ── Screen keep-awake — held across synthesis AND playback ────────────
  // The whole flow is a long, no-touch stretch: the synthesis wait ages the
  // display idle timer out, and screen-off → Activity onStop → applifecycle
  // ON_STOP → BiometricLockContext re-arms the app lock with zero grace (owner
  // device, Android 15, 2026-10-21). So the flag is held from the moment
  // synthesis starts until a GENUINE end. Pausing/dropping to idle/error
  // releases it; unmount always releases (the wrapper refcounts, so LockScreen
  // holding it at the same time is fine).
  const keepAwake = phase === 'synthesizing' || phase === 'playing';
  useEffect(() => {
    if (!keepAwake) return;
    activateKeepScreenOn();
    return () => {
      deactivateKeepScreenOn();
    };
  }, [keepAwake]);

  // ── Completion polling (ChatBubble parity) ────────────────────────────
  // `AudioPlayer.playAudio` resolves at playback START, so the only reliable
  // "the utterance ended" signal is the player's own state reaching a genuine
  // END state (`ended`/`stopped`/`none`/`error`) AFTER we have seen it play.
  // `loading`/`ready` are still in progress — RNTP reports them while the
  // track is prepared, and reading them as "finished" dropped the player row
  // and the keep-awake flag ~250 ms into a real sample. `paused` is an
  // EXTERNAL interruption (autoHandleInterruptions), not an end — see the
  // header's "Completion classification". Also mirrors the live position +
  // duration into state.
  useEffect(() => {
    if (phase !== 'playing') {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      return;
    }

    progressIntervalRef.current = setInterval(async () => {
      try {
        const progress = await AudioPlayer.getProgress();
        setPosition(progress.position);
        if (progress.duration > 0) {
          setDuration(progress.duration);
        }

        // Still working on the utterance (playing / buffering / loading /
        // ready) — nothing to end. Note the proof that playback really began.
        const state = await AudioPlayer.getState();
        if (isPlaybackInProgress(state)) {
          if (hasPlaybackStarted(state)) {
            hasStartedRef.current = true;
          }
          return;
        }

        // A pre-start transient (`none`/`stopped` while the queue is rebuilt,
        // or a poll tick that beat the first `playing` sample) is NOT an end.
        if (!hasStartedRef.current) return;

        // `paused` after a real `playing` observation is an EXTERNAL audio
        // interruption, never "finished": the player is parked mid-utterance
        // (autoHandleInterruptions pauses on any focus loss — see the header).
        // A pause the USER asked for cannot land here, because
        // `handleTogglePlayback` moves `phase` to 'paused' itself.
        if (isPlaybackPaused(state)) {
          if (!autoResumeAttemptedRef.current) {
            autoResumeAttemptedRef.current = true;
            log.info('Playback paused externally — auto-resuming once');
            try {
              await AudioPlayer.resume();
              // Keep polling: the next tick says whether the focus came back
              // (`playing`/`buffering`) or the interruption still holds.
              return;
            } catch (err) {
              log.warn('Auto-resume after an external interruption failed:', err);
            }
          }
          // Paused again (the interruption persisted) or the resume threw:
          // settle into the EXISTING 'paused' phase instead of dropping to
          // 'idle' — the player row and the loaded sample must survive, or the
          // sample looks dead with no way to continue (owner device,
          // 2026-10-21). Keep the position; only a genuine end resets it.
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
          }
          setPhase('paused');
          return;
        }

        // Genuine end.
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setPhase('idle');
        setPosition(0);
      } catch (err) {
        // Playback might have stopped or encountered an error.
        log.debug('Playback progress poll failed:', err);
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setPhase('idle');
        setPosition(0);
      }
    }, PROGRESS_POLL_MS);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [phase]);

  /** Synthesize the sample over the stateless test-speech API and play it. */
  const synthesize = useCallback(async () => {
    if (!canSynthesize || !providerType) return;
    const spoken = text.trim();
    if (!spoken) return;

    hapticLightPress();
    setPhase('synthesizing');
    setError(null);
    // A new synthesis invalidates the previous engine-side display strings.
    setSynthText(null);
    setInputText(null);
    // A new utterance: the poll must not end it before it is seen playing.
    hasStartedRef.current = false;
    autoResumeAttemptedRef.current = false;
    try {
      const res = await engineApiClient.testTtsSpeech({
        text: spoken,
        provider: providerType,
        provider_account_id: accountId ?? null,
        // The model id lives under the provider's own capability key
        // (ElevenLabs: `model_id`), not necessarily `model`.
        model: capability?.[getProviderModelFieldKey(providerType, 'tts')],
        capability_json: capability,
        voice_config_file: capability?.voice_config_file,
        // Demo switches: the engine vocalizes (or skips) nonverbal spans and
        // caps how many cue/tone tags it renders per utterance.
        vocalize_nonverbal: vocalizeNonverbal,
        audio_tag_budget: cueBudget,
      });
      const audio = res.audio_base64 || res.audio || res.data;
      if (!audio) {
        throw new Error('No audio returned');
      }
      // The EXACT provider-bound string + the input echo. Display only — the
      // bracket text never leaves this panel (chat text stays asterisk-only).
      setSynthText(typeof res.text === 'string' && res.text.trim() !== '' ? res.text : null);
      setInputText(
        typeof res.input_text === 'string' && res.input_text.trim() !== ''
          ? res.input_text
          : null,
      );
      setSentOpen(true);
      const result = resolveSynthesizedAudio(audio, audioMime(res.format));
      await playSynthesizedAudio(result.base64, result.mime);

      // Duration up-front so the seeker is correct on the very first frame;
      // the polled progress duration takes over if the parse failed.
      const knownDuration = await parseAudioDuration(result.base64, result.mime);
      setDuration(knownDuration != null && knownDuration > 0 ? knownDuration : 0);
      setLastAudio(result);
      setLastSynthText(spoken);
      setLastSynthFingerprint(
        synthesisFingerprint({ providerType, accountId, capability, vocalizeNonverbal, cueBudget }),
      );
      setPosition(0);
      setPhase('playing');
    } catch (err: any) {
      setPhase('error');
      setError(t('ttsError', { message: err?.message ?? '' }));
      log.error('TTS test failed:', err);
    }
  }, [
    text,
    providerType,
    accountId,
    capability,
    canSynthesize,
    vocalizeNonverbal,
    cueBudget,
    t,
  ]);

  /**
   * Fingerprint of the settings the USER is looking at right now. Computed in
   * the render body so a capability-field edit flips it on the very next
   * render, before the button is pressed.
   */
  const currentFingerprint = synthesisFingerprint({
    providerType,
    accountId,
    capability,
    vocalizeNonverbal,
    cueBudget,
  });

  /**
   * Big-button handler: instant replay only when the kept sample was
   * synthesized from the CURRENT text AND the CURRENT settings (the user must
   * never hear the previous voice after changing it — owner report,
   * 2026-10-21); otherwise a fresh synthesis with the live settings.
   */
  const handlePlay = useCallback(async () => {
    if (phase === 'synthesizing') return;

    if (
      lastAudio &&
      lastSynthText === text.trim() &&
      lastSynthFingerprint === currentFingerprint
    ) {
      hapticLightPress();
      setError(null);
      // A new playback of the kept sample: re-arm the pre-start guard.
      hasStartedRef.current = false;
      // …and re-arm the one-shot external-interruption auto-resume.
      autoResumeAttemptedRef.current = false;
      try {
        // Rebuild the queue from the kept sample — never seekTo(0)+resume().
        // An entity-session teardown (whole-app ON_STOP) resets the shared
        // TrackPlayer singleton while this panel stays mounted, so the panel's
        // "a sample is loaded" state can outlive the actual queue; resuming a
        // reset player made the control look dead with no way to regenerate
        // (owner device, 2026-10-21). playSynthesizedAudio reloads the bytes,
        // so replay stays instant (no re-synthesis).
        await playSynthesizedAudio(lastAudio.base64, lastAudio.mime);
        setPosition(0);
        setPhase('playing');
      } catch (err: any) {
        log.warn('Failed to replay synthesized audio:', err);
        setPhase('error');
        setError(t('ttsError', { message: err?.message ?? '' }));
      }
      return;
    }

    await synthesize();
  }, [
    phase,
    lastAudio,
    lastSynthText,
    lastSynthFingerprint,
    currentFingerprint,
    text,
    synthesize,
    t,
  ]);

  /** Player-row play/pause bubble. */
  const handleTogglePlayback = useCallback(async () => {
    hapticLightPress();
    if (phase === 'playing') {
      try {
        await AudioPlayer.pause();
        setPhase('paused');
      } catch (err) {
        log.warn('Failed to pause playback:', err);
      }
      return;
    }
    if (phase === 'paused') {
      try {
        await AudioPlayer.resume();
        setPhase('playing');
      } catch (err) {
        log.warn('Failed to resume playback:', err);
      }
    }
  }, [phase]);

  /** Seeker — update the label immediately, then seek the loaded track. */
  const handleSeek = useCallback(async (value: number) => {
    setPosition(value);
    try {
      await AudioPlayer.seekTo(value);
    } catch (err) {
      log.warn('Failed to seek synthesized audio:', err);
    }
  }, []);

  /** Write the kept sample to the cache dir and open the OS share sheet. */
  const handleDownload = useCallback(async () => {
    if (!lastAudio) return;
    hapticLightPress();
    setError(null);
    try {
      const filename = `soulbits-tts-sample-${Date.now()}.${audioFileExtension(lastAudio.mime)}`;
      const dir = RNFS.CachesDirectoryPath || RNFS.DocumentDirectoryPath;
      const path = `${dir}/${filename}`;
      await RNFS.writeFile(path, lastAudio.base64, 'base64');
      await Share.open({
        title: 'Soulbits voice sample',
        subject: 'Soulbits voice sample',
        type: lastAudio.mime,
        url: `file://${path}`,
        filename,
        failOnCancel: false,
      });
    } catch (err: any) {
      // A cancelled share sheet resolves (failOnCancel: false) — only real
      // failures land here.
      log.warn('Failed to save/share the TTS sample:', err);
      setError(t('downloadFailed', { message: err?.message ?? '' }));
    }
  }, [lastAudio, t]);

  if (!theme) return null;

  // ── No provider selected yet → nothing to synthesize with ──
  // `POST /api/module-configs/tts/test-speech` REQUIRES `provider`
  // (engine `normalizeTTSProvider` → "provider is required"), so a
  // provider-less request could ONLY fail. Rather than a button that silently
  // errors, show the honest precondition.
  if (!providerType) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.offlineRow}>
          <Icon name="information-outline" size={20} color={theme.colors.text.muted} />
          <ThemedText size={13} variant="muted" style={styles.offlineText} testID="tts-needs-provider">
            {t('ttsNeedsProviderHint')}
          </ThemedText>
        </View>
      </View>
    );
  }

  const isBusy = phase === 'synthesizing';
  const isPlaying = phase === 'playing';
  const isPaused = phase === 'paused';
  const hasAudio = lastAudio !== null;
  const showPlayerRow = hasAudio && (isPlaying || isPaused);
  const canDownload = hasAudio && !isBusy;
  // Prefer the STORED sample's actual mime (sniffed from the bytes) once audio
  // exists; before synthesis fall back to the declared capability format.
  const declaredFormatLabel = String(
    capability?.format ?? capability?.audio_format ?? 'wav',
  )
    .replace(/^audio\//, '')
    .toUpperCase();
  const formatLabel = hasAudio
    ? formatLabelForMime(lastAudio.mime)
    : declaredFormatLabel;

  const insertTag = (tag: string) => {
    if (isBusy) return;
    hapticLightPress();
    setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${tag}` : tag));
  };

  return (
    <View style={styles.wrapper}>
      {/* ── Offline notice (non-blocking: the engine HTTP route may still answer) ── */}
      {isOffline ? (
        <>
          <View style={styles.offlineRow} testID="tts-offline-notice">
            <Icon name="link-off" size={16} color={theme.colors.text.muted} />
            <ThemedText size={12} variant="muted" style={styles.offlineText}>
              {t('ttsOfflineTitle')}
            </ThemedText>
          </View>
          <ThemedText size={12} variant="muted">
            {t('ttsOfflineHint')}
          </ThemedText>
        </>
      ) : null}

      {/* ── Kinded quick-insert toolbar (`tag-pill`) ── */}
      {tagSections.length > 0 && activeSection ? (
        <>
          <View style={styles.kindRow}>
            {tagSections.length > 1 ? (
              <View style={styles.segmented} testID="tts-tag-kind-switch">
                {tagSections.map((section) => {
                  const isActive = section.kind === activeSection.kind;
                  return (
                    <TouchableOpacity
                      key={section.kind}
                      testID={`tts-tag-kind:${section.kind}`}
                      onPress={() => {
                        hapticLightPress();
                        setActiveKind(section.kind);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={section.label}
                      style={[styles.segment, isActive ? styles.segmentActive : null]}
                    >
                      <ThemedText
                        size={10.5}
                        weight="medium"
                        style={isActive ? styles.segmentActiveText : styles.segmentText}
                      >
                        {`${section.label} · ${section.tags.length}`}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
            <TouchableOpacity
              testID="tts-tag-search-all"
              onPress={() => {
                if (isBusy) return;
                hapticLightPress();
                setPickerKind(null);
                setTagPickerVisible(true);
              }}
              disabled={isBusy}
              accessibilityRole="button"
              accessibilityLabel={t('tagSearchPlaceholderAll')}
              style={[styles.searchAllButton, isBusy ? styles.disabled : null]}
            >
              <Icon name="magnify" size={13} color="#94A3B8" />
              <ThemedText size={10.5} style={styles.tagChipMoreText}>
                {t('tagSearchPlaceholderAll')}
              </ThemedText>
            </TouchableOpacity>
          </View>

          <View style={styles.tagRow} testID="tts-tag-chips">
            {activeSection.tags.slice(0, MAX_INLINE_TAGS).map((tag) => (
              <TouchableOpacity
                key={tag}
                testID={paralinguisticTagTestId(tag)}
                onPress={() => insertTag(tag)}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel={`Insert ${tag}`}
                style={[styles.tagChip, isBusy ? styles.disabled : null]}
              >
                <ThemedText size={10.5} style={styles.tagChipText}>
                  {tag}
                </ThemedText>
              </TouchableOpacity>
            ))}
            {activeSection.tags.length > MAX_INLINE_TAGS ? (
              <TouchableOpacity
                testID="tts-tag-more"
                onPress={() => {
                  if (isBusy) return;
                  hapticLightPress();
                  setPickerKind(activeSection.kind);
                  setTagPickerVisible(true);
                }}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel={t('tagMore', {
                  count: activeSection.tags.length - MAX_INLINE_TAGS,
                })}
                style={[styles.tagChip, styles.tagChipMore, isBusy ? styles.disabled : null]}
              >
                <ThemedText size={10.5} style={[styles.tagChipText, styles.tagChipMoreText]}>
                  {t('tagMore', { count: activeSection.tags.length - MAX_INLINE_TAGS })}
                </ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* ── Preset sample scripts (tap to fill the input) ── */}
          <View style={styles.presetRow} testID="tts-sample-scripts">
            <ThemedText size={10.5} variant="muted" style={styles.presetLabel}>
              {t('sampleScripts')}
            </ThemedText>
            {SAMPLE_SCRIPTS.map((script) => (
              <TouchableOpacity
                key={script.key}
                testID={`tts-sample-script:${script.key}`}
                onPress={() => {
                  if (isBusy) return;
                  hapticLightPress();
                  setText(t(script.labelKey));
                }}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityLabel={t(script.labelKey)}
                style={[styles.presetChip, isBusy ? styles.disabled : null]}
              >
                <ThemedText size={10} style={styles.presetChipText} numberOfLines={1}>
                  {t(script.labelKey)}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : audioTags ? (
        // Tag-free model: no chips, no pickers, no tag-bearing presets.
        <ThemedText
          size={11.5}
          variant="muted"
          testID="tts-no-audio-tags"
          accessibilityRole="text"
        >
          {t('audioTagsNoneHint')}
        </ThemedText>
      ) : null}

      {/* ── Sample text input (`sh-textarea`) ── */}
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={3}
        placeholder={t('sampleText')}
        placeholderTextColor="#64748B"
        editable={!isBusy}
        testID="tts-text-input"
      />

      {/* ── "Sent to TTS": the EXACT string the engine handed the provider ── */}
      {synthText || inputText ? (
        <View style={styles.sentBlock} testID="tts-sent-to-tts">
          <TouchableOpacity
            testID="tts-sent-text-toggle"
            onPress={() => {
              hapticLightPress();
              setSentOpen((open) => !open);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: sentOpen }}
            accessibilityLabel={t('sentToTts')}
            style={styles.sentHeader}
          >
            <ThemedText size={11} weight="medium" variant="secondary">
              {t('sentToTts')}
            </ThemedText>
            <View style={styles.sentBadge}>
              <ThemedText size={9} style={styles.sentBadgeText}>
                {t('sentToTtsProviderOutput')}
              </ThemedText>
            </View>
            <Icon
              name={sentOpen ? 'chevron-up' : 'chevron-down'}
              size={14}
              color="#94A3B8"
            />
          </TouchableOpacity>
          {sentOpen && synthText ? (
            <ThemedText size={10.5} style={styles.sentText} testID="tts-sent-text">
              {synthText}
            </ThemedText>
          ) : null}
          {sentOpen && inputText ? (
            <ThemedText
              size={10}
              variant="muted"
              style={styles.inputEcho}
              testID="tts-input-echo"
            >
              {t('inputEcho', { text: inputText })}
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {/* ── Demo switches: vocalize nonverbal + cue budget ── */}
      {tagSections.length > 0 ? (
        <>
          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <ThemedText size={11.5} weight="medium">
                {t('voiceActions')}
              </ThemedText>
              <ThemedText size={10.5} variant="muted">
                {t('voiceActionsHint')}
              </ThemedText>
            </View>
            <Switch
              testID="tts-vocalize-nonverbal"
              value={vocalizeNonverbal}
              onValueChange={(value) => {
                hapticLightPress();
                setVocalizeNonverbal(value);
              }}
              disabled={isBusy}
              accessibilityRole="switch"
              accessibilityLabel={t('voiceActions')}
              accessibilityState={{ checked: vocalizeNonverbal }}
              trackColor={{ false: 'rgba(148,163,184,0.25)', true: 'rgba(217,70,239,0.55)' }}
              thumbColor="#E9D5FF"
            />
          </View>
          <View style={styles.budgetRow}>
            <ThemedText size={11} variant="secondary" style={styles.budgetLabel}>
              {t('cueBudgetDemo')}
            </ThemedText>
            <View style={styles.segmented}>
              {CUE_BUDGET_OPTIONS.map((option) => {
                const isActive = cueBudget === option;
                return (
                  <TouchableOpacity
                    key={option}
                    testID={`tts-cue-budget:${option}`}
                    onPress={() => {
                      hapticLightPress();
                      setCueBudget(option);
                    }}
                    disabled={isBusy}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={`${t('cueBudgetDemo')} ${option}`}
                    style={[styles.segment, isActive ? styles.segmentActive : null]}
                  >
                    <ThemedText
                      size={10.5}
                      weight="medium"
                      style={isActive ? styles.segmentActiveText : styles.segmentText}
                    >
                      {String(option)}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </>
      ) : null}

      {/* ── Player row / synthesize button + format badge + download ── */}
      <View style={styles.footerRow}>
        {showPlayerRow ? (
          <>
            <TouchableOpacity
              testID="tts-play-toggle"
              onPress={handleTogglePlayback}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('pause') : t('play')}
              style={styles.playToggle}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} size={15} color="#E9D5FF" />
            </TouchableOpacity>
            <Slider
              testID="tts-seek-slider"
              style={styles.seekSlider}
              minimumValue={0}
              maximumValue={Math.max(duration, 0.1)}
              value={position}
              minimumTrackTintColor="#D946EF"
              maximumTrackTintColor="rgba(148,163,184,0.25)"
              thumbTintColor="#E9D5FF"
              onSlidingComplete={handleSeek}
            />
            <ThemedText size={10.5} style={styles.timeLabel} testID="tts-time-label">
              {`${formatDuration(position)} / ${formatDuration(duration)}`}
            </ThemedText>
          </>
        ) : (
          <TouchableOpacity
            testID="tts-play-button"
            onPress={handlePlay}
            disabled={isBusy || !canSynthesize}
            accessibilityRole="button"
            accessibilityLabel={t('play')}
            style={[
              styles.playButtonWrap,
              isBusy || !canSynthesize ? styles.disabled : null,
            ]}
          >
            <LinearGradient
              colors={['#D946EF', '#9333EA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.playButton}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : null}
              <ThemedText size={11.5} weight="medium" style={styles.playButtonText}>
                {isBusy ? t('synthesizing') : t('synthesizePlay')}
              </ThemedText>
            </LinearGradient>
          </TouchableOpacity>
        )}

        <View style={styles.formatBadge}>
          <ThemedText size={10} style={styles.formatBadgeText}>
            {formatLabel}
          </ThemedText>
        </View>

        <TouchableOpacity
          testID="tts-download-button"
          onPress={handleDownload}
          disabled={!canDownload}
          accessibilityRole="button"
          accessibilityLabel={t('downloadSample')}
          style={[styles.downloadButton, !canDownload ? styles.disabled : null]}
        >
          <Icon
            name="download-outline"
            size={15}
            color={canDownload ? '#E9D5FF' : '#94A3B8'}
          />
        </TouchableOpacity>
      </View>

      {/* ── Error state (synthesis or sample download/share) ── */}
      {error && (
        <ThemedText size={13} variant="primary" style={{ color: theme.colors.status.error }} testID="tts-error">
          {error}
        </ThemedText>
      )}

      {/* ── Full tag list (grouped by kind, searchable) ── */}
      <TtsTagPickerModal
        visible={tagPickerVisible}
        sections={tagSections}
        kindFilter={pickerKind}
        onClose={() => setTagPickerVisible(false)}
        onPick={(tag) => {
          insertTag(tag);
          setTagPickerVisible(false);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 10 },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offlineText: { flex: 1 },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  tagChip: {
    backgroundColor: 'rgba(168, 85, 247, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagChipMore: {
    borderStyle: 'dashed',
  },
  tagChipText: {
    color: '#E9D5FF',
    fontFamily: 'monospace',
  },
  tagChipMoreText: {
    color: '#94A3B8',
  },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  searchAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(148, 163, 184, 0.35)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  segmented: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 7,
    padding: 2,
    gap: 2,
    backgroundColor: '#070B14',
  },
  segment: {
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  segmentActive: {
    backgroundColor: 'rgba(168, 85, 247, 0.28)',
  },
  segmentText: {
    color: '#94A3B8',
  },
  segmentActiveText: {
    color: '#E9D5FF',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
  },
  presetLabel: {
    marginRight: 2,
  },
  presetChip: {
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.25)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    maxWidth: 150,
  },
  presetChipText: {
    color: '#CBD5E1',
  },
  sentBlock: {
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    borderRadius: 9,
    backgroundColor: '#070B14',
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 4,
  },
  sentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sentBadge: {
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  sentBadgeText: {
    color: '#38BDF8',
  },
  sentText: {
    color: '#E9D5FF',
    fontFamily: 'monospace',
    lineHeight: 15,
  },
  inputEcho: {
    fontFamily: 'monospace',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  switchTextWrap: {
    flex: 1,
    gap: 2,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  budgetLabel: {
    flex: 1,
  },
  input: {
    backgroundColor: '#070B14',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 9,
    color: '#E2E8F0',
    fontSize: 11.5,
    lineHeight: 16,
    minHeight: 66,
    textAlignVertical: 'top',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playButtonWrap: {
    flex: 1,
    borderRadius: 9,
    overflow: 'hidden',
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  playButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  playToggle: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.45)',
    backgroundColor: 'rgba(168,85,247,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekSlider: {
    flex: 1,
    height: 30,
  },
  timeLabel: {
    color: '#94A3B8',
    fontFamily: 'monospace',
  },
  formatBadge: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    backgroundColor: '#070B14',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  formatBadgeText: {
    color: '#94A3B8',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  downloadButton: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.2)',
    backgroundColor: '#070B14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.55 },
});
