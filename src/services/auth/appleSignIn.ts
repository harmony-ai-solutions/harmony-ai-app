/**
 * Apple Sign-In wrapper
 *
 * Thin typed wrapper around `@invertase/react-native-apple-authentication`.
 * Exports `signInWithApple()` (returns an `identityToken` string) and typed
 * error discriminator so UI consumers can branch on failure modes.
 *
 * The iOS SIWA capability + entitlement + provisioning profile are applied
 * in Phase 8-1 — SIWA won't work at runtime until then. The wrapper
 * compiles and type-checks regardless.
 *
 * API notes:
 * - `appleAuth.performRequest()` throws on cancellation with
 *   `error.code === appleAuth.Error.CANCELED`.
 * - `appleAuth.isSupported` is `false` on Android and iOS < 13.
 * - `identityToken` is `string | null` on the response; `null` on failure.
 * - `identityToken.email` is only present on the FIRST authorization;
 *   subsequent logins omit it — the backend resolves by `sub`.
 */

import appleAuth from '@invertase/react-native-apple-authentication';

// ── Typed error discriminator ─────────────────────────────────────────

export enum AppleSignInErrorType {
  /** User cancelled the sign-in flow. */
  CANCELLED = 'CANCELLED',
  /** Apple Sign-In is not configured or not available on this device. */
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  /** Other / unexpected failure. */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Typed error thrown by `signInWithApple()`.
 *
 * Consumers switch on `.type` to branch UI behaviour:
 * - `CANCELLED` → silently dismiss (no error toast)
 * - `NOT_CONFIGURED` → show i18n "not available" message
 * - `UNKNOWN` → show generic error
 */
export class AppleSignInError extends Error {
  constructor(
    public readonly type: AppleSignInErrorType,
    message: string,
  ) {
    super(message);
    this.name = 'AppleSignInError';
  }
}

// ── Sign-in wrapper ───────────────────────────────────────────────────

/**
 * Launch the native Apple Sign-In flow (iOS only).
 *
 * Steps:
 * 1. Quick check `appleAuth.isSupported` (false on Android / iOS < 13).
 * 2. Present the Apple Sign-In credential sheet.
 * 3. Extract the `identityToken` from the response.
 * 4. Return the `identityToken` string on success.
 *
 * All failures are mapped to `AppleSignInError` with a typed `.type`
 * discriminator for clean UI branching.
 */
export async function signInWithApple(): Promise<string> {
  // ── Step 1: Quick availability check ──────────────────────────────
  if (!appleAuth.isSupported) {
    throw new AppleSignInError(
      AppleSignInErrorType.NOT_CONFIGURED,
      'Apple Sign-In is not supported on this device or iOS version',
    );
  }

  // ── Step 2: Native sign-in ────────────────────────────────────────
  try {
    const appleAuthRequestResponse = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
    });

    const identityToken = appleAuthRequestResponse.identityToken;
    if (!identityToken) {
      throw new AppleSignInError(
        AppleSignInErrorType.UNKNOWN,
        'Apple Sign-In returned no identityToken',
      );
    }

    return identityToken;
  } catch (err: unknown) {
    // Rethrow our own typed errors as-is
    if (err instanceof AppleSignInError) {
      throw err;
    }

    // Map invertase SDK error codes to typed errors
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code: unknown }).code;

      if (code === appleAuth.Error.CANCELED) {
        throw new AppleSignInError(
          AppleSignInErrorType.CANCELLED,
          'User cancelled the Apple Sign-In flow',
        );
      }

      if (
        code === appleAuth.Error.INVALID_RESPONSE ||
        code === appleAuth.Error.NOT_HANDLED
      ) {
        throw new AppleSignInError(
          AppleSignInErrorType.NOT_CONFIGURED,
          'Apple Sign-In is not available or not configured on this device',
        );
      }
    }

    // Fallback: anything else → UNKNOWN
    throw new AppleSignInError(
      AppleSignInErrorType.UNKNOWN,
      err instanceof Error ? err.message : 'An unknown Apple Sign-In error occurred',
    );
  }
}
