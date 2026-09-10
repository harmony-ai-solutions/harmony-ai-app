/**
 * resolveVoiceInputState — pure LWW-safe resolver for the shared persona STT
 * ("Voice input") state (persona-modules 2-1).
 *
 * ## CRITICAL LWW hazard
 *
 * The engine seeder creates the canonical `user` mapping row (with STT). The
 * app must NEVER ensure-create it blindly: a locally-inserted NULL row would
 * win row-LWW sync and destroy the engine's STT wiring. Therefore this module
 * implements ONLY the READ side, with these semantics:
 *
 *   - mapping row missing                     → OFF
 *   - mapping.stt_config_id NULL              → OFF
 *   - stt config provider === 'disabled'      → OFF  (engine sentinel)
 *   - otherwise                               → ON  (surfaces providerType + configId)
 *
 * ## Write path
 *
 * Rows are created/linked ONLY on deliberate user save (a legitimate LWW win) —
 * see VoiceInputSettingsScreen's toggle/save handlers. There is NO bootstrap or
 * ensure-create logic anywhere in the read path.
 */

import type { EntityModuleMapping, STTConfig } from '../../database/models';

/** Engine sentinel exactly as defined by config.ProviderDisabled on the engine. */
export const VOICE_INPUT_DISABLED = 'disabled';

/** Resolved voice-input state (READ-only; never used to bootstrap rows). */
export interface VoiceInputState {
  enabled: boolean;
  /** The STT transcription provider key (e.g. 'openai'), or null when OFF. */
  providerType: string | null;
  /** The stt_configs row id backing the voice input, or null when OFF. */
  configId: string | null;
}

/**
 * Resolve the shared persona STT voice-input state from the `user` mapping and
 * its (optional) STT config row.
 *
 * @param input The `user` entity module mapping and the resolved STT config.
 * @returns The READ view of voice input: ON only when a live (non-sentinel)
 *          provider config is linked to the canonical `user` mapping row.
 */
export function resolveVoiceInputState(input: {
  mapping?: EntityModuleMapping | null;
  sttConfig?: STTConfig | null;
}): VoiceInputState {
  const { mapping, sttConfig } = input;

  // Mapping missing → OFF (fresh install / pre-seed before first sync).
  if (!mapping) {
    return { enabled: false, providerType: null, configId: null };
  }

  // stt_config_id NULL → OFF (engine has not wired STT for the user yet).
  if (!mapping.stt_config_id) {
    return { enabled: false, providerType: null, configId: null };
  }

  // Config row missing (dangling id) → OFF.
  if (!sttConfig) {
    return { enabled: false, providerType: null, configId: null };
  }

  // Engine sentinel 'disabled' → OFF. A disabled config row is a legitimate
  // end state the user deliberately wrote (toggle OFF) or the engine seeded.
  if (sttConfig.transcription_provider === VOICE_INPUT_DISABLED) {
    return { enabled: false, providerType: null, configId: null };
  }

  // Live provider → ON.
  return {
    enabled: true,
    providerType: sttConfig.transcription_provider,
    configId: sttConfig.id,
  };
}
