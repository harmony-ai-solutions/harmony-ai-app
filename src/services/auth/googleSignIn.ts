/**
 * Google Sign-In wrapper
 *
 * Thin typed wrapper around `@react-native-google-signin/google-signin` (v16).
 * Exports `signInWithGoogle()` (returns an `idToken` string) and typed error
 * discriminator so UI consumers can branch on failure modes.
 *
 * Key design decisions:
 * - Configure the SDK lazily inside `signInWithGoogle()` — NOT at module scope.
 *   Module-scope configure runs before the RN bridge may have the native config
 *   ready (react-native-config), and a stale empty webClientId causes
 *   `idToken=null` responses.
 * - Call `GoogleSignin.signOut()` before `signIn()` to clear any stale
 *   credential from a previous session.
 * - Request explicit `scopes` (`profile`, `email`, `openid`) to guarantee the
 *   SDK requests an `idToken` from Google.
 * - On Android, do NOT pass webClientId or offlineAccess. The SDK
 *   auto-discovers the OAuth client from google-services.json at build time.
 *   Passing an iOS OAuth client ID as webClientId causes DEVELOPER_ERROR.
 * - On iOS, pass webClientId + offlineAccess so the SDK produces a
 *   serverAuthCode the backend can exchange for a refresh token.
 *
 * Android prerequisites:
 *   - android/app/google-services.json MUST contain real project credentials
 *     (not placeholders). The Google Play Services Gradle plugin reads this
 *     file at build time.
 *   - The debug/release SHA-1 fingerprint MUST be registered in the GCP
 *     OAuth 2.0 Android client.
 *
 * iOS prerequisites:
 *   - Info.plist MUST contain CFBundleURLTypes with REVERSED_CLIENT_ID.
 *   - AppDelegate MUST call GIDSignIn.sharedInstance.handle(url).
 *
 * This works for both first-time users (sign-up) AND returning users
 * (sign-in). The backend `/v1/auth/google` endpoint handles both cases
 * transparently.
 */

import { Platform } from 'react-native';
import {
  GoogleSignin,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { OAUTH } from '../../config/cloud';
import { createLogger } from '../../utils/logger';

const log = createLogger('[GoogleSignIn]');

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
 * - `UNKNOWN` → show generic error with raw message for debugging
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

// ── Platform-aware SDK configuration ──────────────────────────────────
//
// ANDROID: The SDK auto-discovers the OAuth 2.0 Android client from
// google-services.json at build time. Do NOT pass webClientId or
// offlineAccess — the configured GOOGLE_WEB_CLIENT_ID is an iOS OAuth
// client, and passing it as webClientId on Android → DEVELOPER_ERROR.
//
// iOS: The SDK auto-discovers from GoogleService-Info.plist. For offline
// access (serverAuthCode → backend refresh token), a webClientId is needed.

function getConfigureParams(): {
  webClientId?: string;
  scopes: string[];
} {
  const params: { webClientId?: string; scopes: string[] } = {
    scopes: ['profile', 'email', 'openid'],
  };

  // Only pass webClientId on iOS (where it enables offlineAccess).
  // On Android, let google-services.json handle everything.
  const configured = OAUTH.googleWebClientId;
  if (configured && Platform.OS === 'ios') {
    params.webClientId = configured;
  }

  return params;
}

// ── Sign-in wrapper ───────────────────────────────────────────────────

/**
 * Launch the native Google Sign-In flow.
 *
 * Steps:
 * 1. Configure the SDK with platform-appropriate parameters.
 * 2. Sign out any stale credential from a previous session.
 * 3. Check Play Services availability (Android only).
 * 4. Present the account picker / consent dialog.
 * 5. Return the `idToken` string for backend verification.
 *
 * All failures are mapped to `GoogleSignInError` with a typed `.type`
 * discriminator for clean UI branching.
 */
export async function signInWithGoogle(): Promise<string> {
  // ── Step 0: Configure the SDK ──────────────────────────────────────
  const params = getConfigureParams();

  log.info('Configuring Google Sign-In', {
    platform: Platform.OS,
    hasWebClientId: !!params.webClientId,
    scopes: params.scopes,
  });

  try {
    GoogleSignin.configure(params);
  } catch (configErr: unknown) {
    log.error('GoogleSignin.configure() failed:', configErr);
    throw new GoogleSignInError(
      GoogleSignInErrorType.UNKNOWN,
      `Google Sign-In configuration failed: ${configErr instanceof Error ? configErr.message : String(configErr)}`,
    );
  }

  // ── Step 1: Clear any stale credential ─────────────────────────────
  try {
    await GoogleSignin.signOut();
    log.info('Signed out previous Google credential');
  } catch {
    // signOut() throws if no user is signed in — safe to ignore.
  }

  // ── Step 2: Play Services check (Android only) ─────────────────────
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch (err: unknown) {
    log.warn('Google Play Services unavailable:', err);
    throw new GoogleSignInError(
      GoogleSignInErrorType.PLAY_SERVICES,
      err instanceof Error
        ? err.message
        : 'Google Play Services are unavailable on this device',
    );
  }

  // ── Step 3: Native sign-in ────────────────────────────────────────
  try {
    log.info('Launching native Google Sign-In...');
    const response = await GoogleSignin.signIn();

    if (!isSuccessResponse(response)) {
      log.info('Google Sign-In cancelled by user');
      throw new GoogleSignInError(
        GoogleSignInErrorType.CANCELLED,
        'User cancelled the Google Sign-In flow',
      );
    }

    const { idToken, user } = response.data;
    log.info('Google Sign-In native flow succeeded', {
      hasIdToken: !!idToken,
      userEmail: user?.email ?? '(none)',
      userName: user?.name ?? '(none)',
    });

    if (!idToken) {
      log.error(
        'Google Sign-In returned no idToken. Verify the OAuth client ' +
        'type registered in cloud.ts matches your platform. ' +
        'Current value: ' + (OAUTH.googleWebClientId ? '(set)' : '(empty)'),
      );
      throw new GoogleSignInError(
        GoogleSignInErrorType.UNKNOWN,
        'Google Sign-In returned no idToken. The OAuth configuration may be incomplete.',
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
      const errObj = err as Record<string, unknown>;
      const code = errObj.code;
      const message =
        typeof errObj.message === 'string' ? errObj.message : String(err);

      log.error('GoogleSignin.signIn() native error:', { code, message });

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

      // DEVELOPER_ERROR — SHA-1, OAuth client mismatch, or wrong client type
      if (
        typeof code === 'string' &&
        (code === 'DEVELOPER_ERROR' ||
          code === '10' ||
          code.includes('DEVELOPER'))
      ) {
        throw new GoogleSignInError(
          GoogleSignInErrorType.DEVELOPER_ERROR,
          'Google Sign-In developer error — check SHA-1 fingerprint registration and OAuth client type',
        );
      }

      if (code === statusCodes.SIGN_IN_REQUIRED) {
        throw new GoogleSignInError(
          GoogleSignInErrorType.UNKNOWN,
          'Google Sign-In required — the user must sign in again',
        );
      }

      if (code === statusCodes.IN_PROGRESS) {
        throw new GoogleSignInError(
          GoogleSignInErrorType.UNKNOWN,
          'Google Sign-In is already in progress — please wait',
        );
      }
    }

    // Fallback: anything else → UNKNOWN (include the raw error for debugging)
    const rawMessage = err instanceof Error ? err.message : String(err);
    log.error('Google Sign-In unexpected error:', rawMessage);
    throw new GoogleSignInError(GoogleSignInErrorType.UNKNOWN, rawMessage);
  }
}
