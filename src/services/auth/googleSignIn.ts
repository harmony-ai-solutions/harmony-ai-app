/**
 * Google Sign-In wrapper
 *
 * Thin typed wrapper around `@react-native-google-signin/google-signin`.
 * Exports `signInWithGoogle()` (returns an `idToken` string) and typed error
 * discriminator so UI consumers can branch on failure modes.
 *
 * Configured once at module scope with the OAuth web client ID from
 * cloud.ts (Phase 8-1 injects the real value; empty string is acceptable
 * for compilation).
 *
 * API notes (v16):
 * - `GoogleSignin.signIn()` returns `SignInResponse =
 *   { type: 'success', data: User } | { type: 'cancelled', data: null }`.
 * - Cancellation is a RESPONSE, not a thrown error.
 * - `User.idToken` is `string | null`.
 * - `statusCodes` does NOT include `DEVELOPER_ERROR` — that comes as
 *   a thrown native error without a constant.
 */

import {
  GoogleSignin,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { OAUTH } from '../../config/cloud';

// ── Typed error discriminator ─────────────────────────────────────────

export enum GoogleSignInErrorType {
  /** Google Play Services are unavailable (non-GMS device / no Play Store). */
  PLAY_SERVICES = 'PLAY_SERVICES',
  /** Developer configuration error (e.g. SHA-1 not registered in Google Cloud Console). */
  DEVELOPER_ERROR = 'DEVELOPER_ERROR',
  /** User cancelled the sign-in flow. */
  CANCELLED = 'CANCELLED',
  /** Other / unexpected failure. */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Typed error thrown by `signInWithGoogle()`.
 *
 * Consumers switch on `.type` to branch UI behaviour:
 * - `PLAY_SERVICES` → fall back to email/password (do NOT block)
 * - `DEVELOPER_ERROR` → show i18n "not configured" message
 * - `CANCELLED` → silently dismiss (no toast)
 * - `UNKNOWN` → show generic error
 */
export class GoogleSignInError extends Error {
  constructor(
    public readonly type: GoogleSignInErrorType,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleSignInError';
  }
}

// ── Configure once at module scope ────────────────────────────────────
// webClientId is set from `Config.GOOGLE_WEB_CLIENT_ID` (Phase 8-1).
// Until then `OAUTH.googleWebClientId` is an empty string — acceptable
// for compilation; native Google Sign-In at runtime requires the real ID.

GoogleSignin.configure({ webClientId: OAUTH.googleWebClientId });

// ── Sign-in wrapper ───────────────────────────────────────────────────

/**
 * Launch the native Google Sign-In flow.
 *
 * Steps:
 * 1. Check Play Services availability (throws on non-GMS devices).
 * 2. Present the account picker / consent dialog.
 * 3. Return the `idToken` string on success.
 *
 * All failures are mapped to `GoogleSignInError` with a typed `.type`
 * discriminator for clean UI branching.
 */
export async function signInWithGoogle(): Promise<string> {
  // ── Step 1: Play Services check ─────────────────────────────────────
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch (err: unknown) {
    throw new GoogleSignInError(
      GoogleSignInErrorType.PLAY_SERVICES,
      err instanceof Error
        ? err.message
        : 'Google Play Services are unavailable on this device',
    );
  }

  // ── Step 2: Native sign-in ──────────────────────────────────────────
  try {
    const response = await GoogleSignin.signIn();

    // Handle cancellation as a typed error for consistent UI branching
    if (!isSuccessResponse(response)) {
      throw new GoogleSignInError(
        GoogleSignInErrorType.CANCELLED,
        'User cancelled the Google Sign-In flow',
      );
    }

    const { idToken } = response.data;
    if (!idToken) {
      throw new GoogleSignInError(
        GoogleSignInErrorType.UNKNOWN,
        'Google Sign-In returned no idToken',
      );
    }

    return idToken;
  } catch (err: unknown) {
    // Rethrow our own typed errors as-is
    if (err instanceof GoogleSignInError) {
      throw err;
    }

    // Map SDK status codes to typed errors
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code: unknown }).code;

      if (code === statusCodes.SIGN_IN_CANCELLED) {
        throw new GoogleSignInError(
          GoogleSignInErrorType.CANCELLED,
          'User cancelled the Google Sign-In flow',
        );
      }

      if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new GoogleSignInError(
          GoogleSignInErrorType.PLAY_SERVICES,
          'Google Play Services not available on this device',
        );
      }

      // DEVELOPER_ERROR is not in statusCodes but is a known native error code
      // (e.g. "DEVELOPER_ERROR" or 10 from GoogleApiClient).
      if (
        typeof code === 'string' &&
        (code === 'DEVELOPER_ERROR' || code === '10' || code.includes('DEVELOPER'))
      ) {
        throw new GoogleSignInError(
          GoogleSignInErrorType.DEVELOPER_ERROR,
          'Google Sign-In developer error — check SHA-1 and OAuth client configuration',
        );
      }
    }

    // Fallback: anything else → UNKNOWN
    throw new GoogleSignInError(
      GoogleSignInErrorType.UNKNOWN,
      err instanceof Error ? err.message : 'An unknown Google Sign-In error occurred',
    );
  }
}
