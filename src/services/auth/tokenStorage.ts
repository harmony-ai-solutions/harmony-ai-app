/**
 * Cloud-credential token storage (Keychain)
 *
 * The cloud PASETO + refresh token pair is stored in a dedicated Keychain
 * service (`com.harmonyai.cloud.auth`) and is COMPLETELY independent from
 * the self-hosted HL path that uses AsyncStorage (`harmony_jwt`).
 *
 * Pattern mirror: `src/database/connection.ts:59-90`
 */

import * as Keychain from 'react-native-keychain';

// ── Constants ───────────────────────────────────────────────────────────

/** Dedicated Keychain service — never overlap with `com.harmonyai.database`. */
const SERVICE = 'com.harmonyai.cloud.auth';

/**
 * Single credential username.  The password field holds a JSON blob
 * `{ paseto, refresh, expires_at }`.
 */
const USER = 'cloud_auth';

// ── Types ───────────────────────────────────────────────────────────────

export interface TokenBlob {
  paseto: string;
  refresh: string;
  expires_at: string; // RFC 3339, e.g. "2026-07-16T01:00:00Z"
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Persist a cloud-auth token pair to the device Keychain.
 *
 * @param paseto    The v4.local PASETO (Bearer token).
 * @param refresh   Opaque refresh token.
 * @param expiresAt RFC 3339 expiry timestamp from `TokenResponse.expires_at`.
 */
export async function saveTokens(
  paseto: string,
  refresh: string,
  expiresAt: string,
): Promise<void> {
  const blob: TokenBlob = { paseto, refresh, expires_at: expiresAt };
  await Keychain.setGenericPassword(USER, JSON.stringify(blob), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
  });
}

/**
 * Read the stored token blob from Keychain.
 *
 * Returns `null` when no credential exists (first launch, after logout, or
 * after a manual wipe).
 */
export async function loadTokens(): Promise<TokenBlob | null> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: SERVICE });
    if (!credentials || !credentials.password) {
      return null;
    }
    return JSON.parse(credentials.password) as TokenBlob;
  } catch {
    return null;
  }
}

/**
 * Delete the cloud-auth credential from Keychain.
 *
 * Safe to call multiple times — Keychain silently ignores missing records.
 */
export async function clearTokens(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
