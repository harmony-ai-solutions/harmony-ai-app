/**
 * Chat display preferences — app-local, per-conversation UI toggles.
 *
 * The only preference today is "Show emotional state" (tts-voice-ux Phase 5):
 * opting in shows the mood chip in the chat header. It is stored app-locally
 * (AsyncStorage, keyed by the engine-aligned `participantKey`) — there is NO
 * engine change in v1.
 *
 * Persistence mirrors `utils/haptics.ts`: a module-level in-memory mirror lets
 * callers read the current value synchronously (so a toggle flips the chip
 * without waiting for a re-render fetch), writes update the mirror first and
 * then persist best-effort.
 *
 * Fail-safe default is **off** (opt-in): a missing value, an unreadable
 * storage entry or any error resolves to `false`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from './logger';

const log = createLogger('[ChatDisplayPrefs]');

/** `@soulbits_` prefix matches the app's reserved AsyncStorage key convention. */
export const SHOW_EMOTION_STATE_PREFIX = '@soulbits_chat_show_emotion_';

/** In-memory mirror of the persisted values (read synchronously by the UI). */
const mirror = new Map<string, boolean>();

function storageKey(participantKey: string): string {
  return `${SHOW_EMOTION_STATE_PREFIX}${participantKey}`;
}

/**
 * Current value from the in-memory mirror.
 *
 * Returns `null` when this conversation has not been loaded yet this session,
 * so callers can distinguish "known off" from "not read yet".
 */
export function getCachedShowEmotionState(
  participantKey: string | null | undefined,
): boolean | null {
  if (!participantKey) return null;
  const cached = mirror.get(participantKey);
  return cached === undefined ? null : cached;
}

/**
 * Read the persisted "Show emotional state" preference for a conversation.
 *
 * Defaults to `false` (opt-in) when unset, when no key is known, or on any
 * storage error. The result is written to the in-memory mirror.
 */
export async function getShowEmotionState(
  participantKey: string | null | undefined,
): Promise<boolean> {
  if (!participantKey) return false;
  const cached = mirror.get(participantKey);
  if (cached !== undefined) return cached;

  try {
    const stored = await AsyncStorage.getItem(storageKey(participantKey));
    const enabled = stored === 'true';
    mirror.set(participantKey, enabled);
    return enabled;
  } catch (error) {
    log.warn(`Failed to read emotion-state preference for ${participantKey}:`, error);
    return false;
  }
}

/**
 * Persist the preference AND update the in-memory mirror immediately, so the
 * header chip flips without waiting for the storage round-trip. A failed write
 * keeps the mirror value for this session (the toggle still behaves).
 */
export async function setShowEmotionState(
  participantKey: string | null | undefined,
  enabled: boolean,
): Promise<void> {
  if (!participantKey) return;
  mirror.set(participantKey, enabled);
  try {
    await AsyncStorage.setItem(storageKey(participantKey), String(enabled));
    log.debug(`Show emotional state for ${participantKey}: ${enabled}`);
  } catch (error) {
    log.warn(`Failed to persist emotion-state preference for ${participantKey}:`, error);
  }
}

/** Test-only: drop the in-memory mirror so suites start from a clean slate. */
export function resetChatDisplayPrefsForTests(): void {
  mirror.clear();
}
