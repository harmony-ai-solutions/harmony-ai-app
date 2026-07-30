/**
 * Google Sign-In wrapper
 *
 * Thin typed wrapper around `@react-native-google-signin/google-signin` (v16).
 * Exports `signInWithGoogle()` (returns an `idToken` string) and typed error
 * discriminator so UI consumers can branch on failure modes.
 *
 * Key design decisions (v16 SDK):
 * - Configure the SDK lazily inside `signInWithGoogle()` — NOT at module scope.
 *   Module-scope configure runs before the RN bridge may have the native config
 *   ready (react-native-config), and a stale empty webClientId causes
 *   `idToken=null` responses.
 * - Call `GoogleSignin.signOut()` before `signIn()` to clear any stale
 *   credential from a previous session. Without this the SDK may return a
 *   cached (possibly expired) credential.
 * - Request explicit `scopes` (`profile`, `email`, `openid`) to guarantee the
 *   SDK requests an `idToken` from Google. Without explicit scopes, some
 *   devices/accounts may not produce an idToken, resulting in the "no idToken"
 *   error path.
 * - Hard-code a fallback webClientId for development to survive timing issues
 *   with react-native-config.
 *
 * Android prerequisite:
 *   android/app/google-services.json MUST contain real project credentials
 *   (not placeholders). The Google Play Services Gradle plugin reads this file
 *   at build time. Without it, `GoogleSignin.signIn()` returns an error.
 *
 * iOS prerequisites:
 *   - Info.plist MUST contain a CFBundleURLTypes entry with the
 *     REVERSED_CLIENT_ID from GoogleService-Info.plist.
 *   - AppDelegate MUST call GIDSignIn.sharedInstance.handle(url) for
 *     the OAuth redirect to complete.
 */

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

// ── Web client ID resolution ──────────────────────────────────────────
// react-native-config may not be ready at module scope on cold start.
// Resolve lazily inside signInWithGoogle() and provide a hard-coded
// fallback for development builds (matches the value in .env and
// android/gradle.properties).

const DEV_WEB_CLIENT_ID =
  '128352209891-3lm1pgood2a4h97kpasjmjlaer0oighu.apps.googleusercontent.com';

function getWebClientId(): string {
  const configured = OAUTH.googleWebClientId;
  if (configured) {
    return configured;
  }
  // Fallback for development builds where react-native-config hasn't
  // bridged the native BuildConfig value yet.
  if (__DEV__) {
    log.warn('OAUTH.googleWebClientId is empty — using hard-coded dev client ID');
    return DEV_WEB_CLIENT_ID;
  }
  return '';
}

// ── Sign-in wrapper ───────────────────────────────────────────────────

/**
 * Launch the native Google Sign-In flow.
 *
 * Steps:
 * 1. Configure the SDK with the web client ID + scopes (lazy, not module-scope).
 * 2. Sign out any stale credential from a previous session.
 * 3. Check Play Services availability (Android only; no-op on iOS).
 * 4. Present the account picker / consent dialog.
 * 5. Return the `idToken` string for backend verification.
 *
 * This works for both first-time users (sign-up) AND returning users
 * (sign-in). The backend `/v1/auth/google` endpoint handles both cases
 * transparently.
 *
 * All failures are mapped to `GoogleSignInError` with a typed `.type`
 * discriminator for clean UI branching.
 */
export async function signInWithGoogle(): Promise<string> {
  // ── Step 0: Configure the SDK ──────────────────────────────────────
  // MUST happen before any other SDK call. Placed inside the function
  // (not module scope) to guarantee the web client ID is resolved.
  const webClientId = getWebClientId();

  log.info('Configuring Google Sign-In', {
    hasWebClientId: !!webClientId,
    webClientIdPrefix: webClientId ? webClientId.substring(0, 20) + '...' : '(none)',
  });

  try {
    GoogleSignin.configure({
      webClientId: webClientId || undefined,
      // Explicit scopes guarantee the SDK requests an idToken.
      // Without these, some device/account combinations produce idToken=null.
      scopes: ['profile', 'email', 'openid'],
      // Request offline access so the backend can exchange the
      // serverAuthCode for a refresh token for long-lived sessions.
      offlineAccess: true,
    });
  } catch (configErr: unknown) {
    log.error('GoogleSignin.configure() failed:', configErr);
    throw new GoogleSignInError(
      GoogleSignInErrorType.UNKNOWN,
      `Google Sign-In configuration failed: ${configErr instanceof Error ? configErr.message : String(configErr)}`,
    );
  }

  // ── Step 1: Clear any stale credential ─────────────────────────────
  // Without this, the SDK may return a cached credential from a previous
  // session that has an expired or null idToken.
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

    // Handle cancellation as a typed error for consistent UI branching
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
      log.error('Google Sign-In returned no idToken — check webClientId and scopes');
      throw new GoogleSignInError(
        GoogleSignInErrorType.UNKNOWN,
        'Google Sign-In returned no idToken — the OAuth configuration may be incomplete',
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
      const message = typeof errObj.message === 'string'
        ? errObj.message
        : String(err);

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

      // Map other known error codes
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
    throw new GoogleSignInError(
      GoogleSignInErrorType.UNKNOWN,
      rawMessage,
    );
  }
}
