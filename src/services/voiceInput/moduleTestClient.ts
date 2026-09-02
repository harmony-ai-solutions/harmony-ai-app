/**
 * moduleTestClient — engine module-test HTTP client (persona-modules 2-2 / 2-3).
 *
 * ## Engine-HTTP access pattern (investigated + documented)
 *
 * Today the app reaches Harmony Link (the engine) **only over WebSocket**
 * (WSS `/events`; URL + JWT + server cert persisted in AsyncStorage via
 * `ConnectionStateManager`). There is NO pre-existing engine HTTP client for
 * the new management test endpoints from phase 1-2. Rather than invent an
 * unrelated transport, this module introduces a minimal one that is consistent
 * with the existing config/host handling:
 *
 *   - Base URL: derived from the stored WSS/WS URL by swapping the scheme
 *     (`wss://` → `https://`, `ws://` → `http://`) and stripping the `/events`
 *     path — so `wss://host:8081/events` → `https://host:8081`.
 *   - Auth: the stored Harmony Link JWT as a Bearer token (same credential the
 *     WebSocket connection uses).
 *   - Payload: the PINNED contract from `1-2-EngineModuleTestAPI.md` — the
 *     provider is executed server-side with the (possibly unsaved) config.
 *
 * The HTTP layer is mocked in tests with contract-shaped fixtures; no live
 * engine is ever touched by unit tests.
 */

import ConnectionStateManager from '../ConnectionStateManager';
import { createLogger } from '../../utils/logger';

const log = createLogger('[moduleTestClient]');

/** The PINNED contract's draft-config shape (provider + optional config id + module config). */
export interface ModuleTestDraftConfig {
  provider_type: string;
  provider_config_id: string | number | null;
  module_config: Record<string, any>;
}

export interface VadSegment {
  start_ms: number;
  end_ms: number;
}

export interface SttTestResult {
  transcript: string;
  vad_segments: VadSegment[];
  duration_ms: number;
}

export interface TtsTestResult {
  audio_base64: string;
  mime_type: string;
}

/** Thrown when the engine endpoint returns a non-2xx `{ error }` payload or is unreachable. */
export class ModuleTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleTestError';
  }
}

const ENGINE_TEST_PATH = '/modules/test/stt';

/**
 * Derive the engine's HTTP base URL from the stored WSS/WS URL.
 *
 * @returns `https://host[:port]` (from wss) or `http://host[:port]` (from ws),
 *          or null when no engine URL is configured (not paired).
 */
export async function resolveEngineHttpBaseUrl(): Promise<string | null> {
  const wssUrl = await ConnectionStateManager.getWSSUrl();
  const wsUrl = await ConnectionStateManager.getWSUrl();
  const raw = wssUrl || wsUrl;
  if (!raw) return null;

  // wss:// → https:// , ws:// → http://
  const schemeSwapped = raw
    .replace(/^wss:/i, 'https:')
    .replace(/^ws:/i, 'http:');

  const withoutEvents = schemeSwapped.replace(/\/events\/?$/i, '');
  return withoutEvents.replace(/\/+$/, '');
}

/**
 * POST to the engine's STT module-test endpoint (PINNED contract, phase 1-2).
 *
 * @param draft        The draft config to execute against (provider_type,
 *                     provider_config_id, module_config).
 * @param audioBase64  Base64-encoded audio bytes (WAV from the recorder).
 * @param mimeType     Audio MIME type (e.g. 'audio/wav').
 * @returns The transcript, VAD segments and duration.
 * @throws ModuleTestError on engine 4xx `{ error }` or when the engine is
 *         unreachable.
 */
export async function testStt(
  draft: ModuleTestDraftConfig,
  audioBase64: string,
  mimeType: string,
): Promise<SttTestResult> {
  const base = await resolveEngineHttpBaseUrl();
  if (!base) {
    throw new ModuleTestError('Not connected to Harmony Link');
  }

  const jwt = ConnectionStateManager.getJWTToken();
  const url = `${base}${ENGINE_TEST_PATH}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify({
        provider_type: draft.provider_type,
        provider_config_id: draft.provider_config_id,
        module_config: draft.module_config,
        audio_base64: audioBase64,
        mime_type: mimeType,
      }),
    });
  } catch (err) {
    log.error('STT test request failed:', err);
    throw new ModuleTestError('Could not reach Harmony Link');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = (data && (data as any).error) || `STT test failed (${res.status})`;
    throw new ModuleTestError(String(message));
  }

  return data as SttTestResult;
}
