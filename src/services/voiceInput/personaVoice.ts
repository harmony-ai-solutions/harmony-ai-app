/**
 * personaVoice — READ/ensure helper for the shared persona STT ("Voice input")
 * config owned by the canonical `user` entity (persona-modules 2-1).
 *
 * ## Mental model
 *
 * Voice input is NOT per-persona. It is the STT config wired to the canonical
 * `user` entity via its `entity_module_mappings.stt_config_id`, and is used
 * whenever the user chats as ANY persona. The engine seeder owns the canonical
 * `user` mapping row; the app only ever reads it in the background.
 *
 * ## LWW hazard (CRITICAL)
 *
 * The app must NEVER blindly ensure-create a NULL/empty `user` mapping row: a
 * locally-inserted NULL row would win row-LWW sync and destroy the engine's STT
 * wiring (the engine PUT is a full-row upsert, so every other module slot is
 * sent too). Therefore:
 *   - READ: `resolvePersonaVoice` is side-effect free and treats a missing
 *     mapping / NULL stt_config_id / provider === 'disabled' as OFF.
 *   - WRITE: rows are created / linked ONLY by `ensurePersonaVoiceConfig`, which
 *     runs on an explicit Settings-row (or PersonaEdit "Manage") tap. It always
 *     links a REAL stt_config_id (never null) and preserves every other module
 *     slot from the existing mapping row.
 *   - OFF: `disablePersonaVoice` writes the engine 'disabled' sentinel into the
 *     already-linked config — a deliberate user action, a legitimate LWW win.
 *
 * The in-chat persona selector (PersonaSwitcherModal) is unrelated and
 * untouched.
 */

import type { Entity, EntityModuleMapping, STTConfig } from '../../database/models';
import {
  createOrUpdateEntityModuleMapping,
  createSTTConfig,
  getEntity,
  getEntityModuleMapping,
  getSTTConfig,
  getSTTConfigByName,
  updateSTTConfig,
} from '../../database/repositories';
import { MODULE_DEFAULTS } from '../../constants/moduleDefaults';
import { createLogger } from '../../utils/logger';
import {
  resolveVoiceInputState,
  VOICE_INPUT_DISABLED,
} from './resolveVoiceInputState';

const log = createLogger('[personaVoice]');

/** The canonical user identity entity that owns the shared STT mapping. */
export const PERSONA_VOICE_ENTITY_ID = 'user';

/** Fixed name of the app-created voice-input STT config row. */
export const PERSONA_VOICE_CONFIG_NAME = 'Persona voice input';

/** Resolved READ state for the Settings chip and the OFF fallback UX. */
export interface PersonaVoiceState {
  status: 'off' | 'ok';
  /**
   * The linked STT config id when one exists (including a config whose
   * provider is the 'disabled' sentinel). Absent for a missing mapping, a NULL
   * stt_config_id, or a dangling id whose row no longer exists.
   */
  configId?: string;
  /** Live transcription provider key when status === 'ok'. */
  providerType?: string;
  /** Short model label for the value chip (e.g. "FasterWhisper"). */
  modelLabel?: string;
}

/** Result of the deliberate ensure/link write. */
export interface EnsurePersonaVoiceResult {
  configId: string;
  /** True when this call created the fixed STT config row. */
  created: boolean;
}

/**
 * Thrown when voice input cannot be set up because the canonical `user` entity
 * is not present locally yet (fresh install / engine not connected). The caller
 * surfaces the old screen's guidance instead of writing a mapping row.
 */
export class PersonaVoiceUnavailableError extends Error {
  constructor() {
    super(
      'Voice input is unavailable until Soulbits Engine has seeded the canonical user entity',
    );
    this.name = 'PersonaVoiceUnavailableError';
  }
}

/** Parse the transcription capability overlay's model id (best effort). */
function transcriptionModelOf(config: STTConfig | null | undefined): string | null {
  if (!config) return null;
  try {
    const parsed = JSON.parse(config.transcription_capability_json || '{}');
    const model = parsed && typeof parsed === 'object' ? (parsed as { model?: unknown }).model : null;
    return typeof model === 'string' && model.trim() !== '' ? model : null;
  } catch {
    return null;
  }
}

/**
 * Short, human-readable label for the current STT model. Mirrors the STT
 * editor's pipeline label ("FasterWhisper" for any faster-whisper model id).
 */
export function personaVoiceModelLabel(config: STTConfig | null | undefined): string | undefined {
  if (!config) return undefined;
  const model = transcriptionModelOf(config);
  if (model) return model.includes('whisper') ? 'FasterWhisper' : model;
  // No model overlay (engine-seeded generic config) — the config name is the
  // best short human label for the value chip.
  return config.name?.trim() ? config.name : undefined;
}

/**
 * READ-ONLY resolution of the shared persona voice-input state.
 *
 * Never writes. On any engine/data-layer error it resolves to OFF so the
 * Settings chip and navigation path stay usable.
 */
export async function resolvePersonaVoice(): Promise<PersonaVoiceState> {
  try {
    const entity: Entity | null = await getEntity(PERSONA_VOICE_ENTITY_ID);
    if (!entity) return { status: 'off' };

    const mapping: EntityModuleMapping | null =
      await getEntityModuleMapping(PERSONA_VOICE_ENTITY_ID);
    const config = mapping?.stt_config_id
      ? await getSTTConfig(mapping.stt_config_id)
      : null;

    const state = resolveVoiceInputState({ mapping, sttConfig: config });
    if (!state.enabled) {
      // A linked 'disabled' config still has a real id — surface it so the
      // settings tap can reopen the same row instead of creating a duplicate.
      return {
        status: 'off',
        ...(config?.id ? { configId: config.id } : {}),
      };
    }

    const modelLabel = personaVoiceModelLabel(config);
    return {
      status: 'ok',
      ...(state.configId ? { configId: state.configId } : {}),
      ...(state.providerType ? { providerType: state.providerType } : {}),
      ...(modelLabel ? { modelLabel } : {}),
    };
  } catch (err) {
    log.warn('Failed to resolve persona voice state:', err);
    return { status: 'off' };
  }
}

/** Build the full mapping write, preserving every other module slot. */
function mappingWithStt(
  mapping: EntityModuleMapping | null,
  sttConfigId: string,
): Parameters<typeof createOrUpdateEntityModuleMapping>[0] {
  return {
    entity_id: PERSONA_VOICE_ENTITY_ID,
    backend_config_id: mapping?.backend_config_id ?? null,
    cognition_config_id: mapping?.cognition_config_id ?? null,
    imagination_config_id: mapping?.imagination_config_id ?? null,
    movement_config_id: mapping?.movement_config_id ?? null,
    rag_config_id: mapping?.rag_config_id ?? null,
    // Deliberate write: ALWAYS a real config id, never null.
    stt_config_id: sttConfigId,
    tts_config_id: mapping?.tts_config_id ?? null,
    vision_config_id: mapping?.vision_config_id ?? null,
  };
}

/** Create the fixed STT row in its OFF (disabled sentinel) state. */
async function createFixedVoiceConfig(): Promise<string> {
  const sttDefaults = MODULE_DEFAULTS.stt;
  return createSTTConfig({
    name: PERSONA_VOICE_CONFIG_NAME,
    main_stream_time_millis: sttDefaults.main_stream_time_millis,
    transition_stream_time_millis: sttDefaults.transition_stream_time_millis,
    max_buffer_count: sttDefaults.max_buffer_count,
    transcription_provider: VOICE_INPUT_DISABLED,
    transcription_provider_account_id: null,
    transcription_capability_json: '{}',
    vad_provider: VOICE_INPUT_DISABLED,
    vad_provider_account_id: null,
    vad_capability_json: '{}',
  });
}

/**
 * EXPLICIT-USER-ACTION ensure: return the linked STT config id, creating the
 * fixed "Persona voice input" config and/or relinking only when needed.
 *
 * Cases:
 *   - linked id → row exists        → reuse (no write)
 *   - linked id → row deleted       → relink the fixed config (or recreate)
 *   - NULL / missing stt_config_id  → link the fixed config (or create it)
 *
 * In every write path the link is a REAL config id, never NULL.
 * @throws {PersonaVoiceUnavailableError} when the canonical `user` entity is
 *         not local yet — never writes a NULL mapping row in that state.
 */
export async function ensurePersonaVoiceConfig(): Promise<EnsurePersonaVoiceResult> {
  const entity = await getEntity(PERSONA_VOICE_ENTITY_ID);
  if (!entity) throw new PersonaVoiceUnavailableError();

  const mapping = await getEntityModuleMapping(PERSONA_VOICE_ENTITY_ID);
  const linkedId = mapping?.stt_config_id ?? null;

  if (linkedId) {
    const linked = await getSTTConfig(linkedId);
    if (linked) {
      return { configId: linked.id, created: false };
    }
    log.warn(
      `Voice input mapping points at missing STT config ${linkedId} — repairing link`,
    );
  }

  // Reuse a previously-created fixed config when only the mapping link was
  // lost (sync lag / repaired state) so the user never accumulates duplicates.
  const existingFixed = await getSTTConfigByName(PERSONA_VOICE_CONFIG_NAME);
  if (existingFixed) {
    await createOrUpdateEntityModuleMapping(mappingWithStt(mapping, existingFixed.id));
    return { configId: existingFixed.id, created: false };
  }

  const configId = await createFixedVoiceConfig();
  await createOrUpdateEntityModuleMapping(mappingWithStt(mapping, configId));
  return { configId, created: true };
}

/**
 * Write the engine 'disabled' sentinel into the linked STT config. This is the
 * OFF switch and only runs on a deliberate user action (the editor's
 * "Disabled (voice input off)" chip).
 */
export async function disablePersonaVoice(configId: string): Promise<void> {
  const config = await getSTTConfig(configId);
  if (!config) return;
  await updateSTTConfig({
    ...config,
    transcription_provider: VOICE_INPUT_DISABLED,
    vad_provider: VOICE_INPUT_DISABLED,
  });
}
