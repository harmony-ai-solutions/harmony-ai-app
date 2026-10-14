/**
 * Silent sign-in for the store launch gate (plan 7-14 V2, ruling 1).
 *
 * On cold start WITHOUT a session, a store build makes ONE silent attempt to
 * restore a previously-granted credential before falling back to the
 * non-dismissible sign-in wall. This module owns ONLY that attempt; the tokens
 * it yields are handed to the EXISTING AuthContext actions
 * (`loginWithGoogle`) — there is deliberately no parallel token path.
 *
 * Platform behaviour:
 *
 *   - **Android** — Google `signInSilently()` (the SDK's saved-credential
 *     restore). No UI, no consent dialog.
 *   - **iOS** — NO silent attempt. The ruling's iOS silent path is an SIWA
 *     auto-attempt, but `@invertase/react-native-apple-authentication`'s
 *     `performRequest()` ALWAYS presents the system sheet, so it is not a
 *     silent primitive; invoking it at cold start would show an interactive
 *     prompt. iOS therefore ships wall-only (pre-authorized judgment call:
 *     no new native SDK work this pass).
 *
 * `attemptSilentSignIn` NEVER throws and NEVER rejects: any failure, absence or
 * unexpected error resolves to `null` so the caller simply shows the wall.
 */

import { Platform } from 'react-native';
import { signInSilentlyWithGoogle } from './googleSignIn';
import { createLogger } from '../../utils/logger';

const log = createLogger('[SilentSignIn]');

/**
 * Make the store launch-gate's single silent sign-in attempt.
 *
 * @returns A provider credential (`google` id_token) when a saved sign-in was
 *          restored without user interaction, or `null` when there is nothing
 *          to restore / the attempt failed — the caller falls back to the wall.
 */
export async function attemptSilentSignIn(): Promise<string | null> {
  // iOS: no silent primitive exists on the current apple-auth integration
  // (`performRequest` is interactive) — the wall is the floor.
  if (Platform.OS !== 'android') {
    return null;
  }

  try {
    return await signInSilentlyWithGoogle();
  } catch (err: unknown) {
    log.info(
      'Silent Google sign-in unavailable — falling back to the wall:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
