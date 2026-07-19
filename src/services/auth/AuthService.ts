/**
 * Cloud Auth Service — singleton
 *
 * Manages the cloud PASETO + refresh-token lifecycle for the soulbits-cloud
 * backend.  Emits `auth:changed` on login/refresh and `auth:expired` when
 * re-authentication is required.
 *
 * CRITICAL: Cloud credentials live in Keychain (service `com.harmonyai.cloud.auth`)
 * and are COMPLETELY independent from the self-hosted HL `harmony_jwt` path
 * (AsyncStorage).  This file never touches AsyncStorage or the HL connection path.
 */

import EventEmitter from 'eventemitter3';
import { AUTH_ENDPOINTS } from '../../config/cloud';
import {
  saveTokens,
  loadTokens,
  clearTokens,
  type TokenBlob,
} from './tokenStorage';

// ── Error types ─────────────────────────────────────────────────────────

export class AuthExpiredError extends Error {
  constructor() {
    super('Cloud auth expired — re-authentication required');
    this.name = 'AuthExpiredError';
  }
}

export class AuthError extends Error {
  /**
   * The HTTP status from the failing response, when known.
   *
   * Screens branch on this numeric value (login 403 → VerifyPrompt, social
   * 409 → conflict message, 401 → invalid credentials) rather than
   * substring-matching the message. Substring matching is brittle because the
   * backend 409 body carries its OWN error string ("An account with this
   * email already exists.") — not the status code — so a `message.includes('409')`
   * check can never match.
   */
  constructor(
    public readonly action: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`Auth ${action} failed: ${message}`);
    this.name = 'AuthError';
  }
}

// ── Events ──────────────────────────────────────────────────────────────

export interface AuthServiceEvents {
  'auth:changed': (paseto: string) => void;
  'auth:expired': () => void;
}

// ── Types ───────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  // Optional: the backend MeResponse does not currently return tier_id. Kept
  // optional so the type reflects the wire contract honestly.
  tier_id?: string;
  created_at: string;
}

interface TokenResponse {
  token: string;
  refresh_token: string;
  expires_at: string; // RFC 3339
}

// ── Singleton ───────────────────────────────────────────────────────────

class AuthServiceClass extends EventEmitter<AuthServiceEvents> {
  private static instance: AuthServiceClass;

  /** In-memory cache — avoids a Keychain read on every `getToken()` call. */
  private _paseto: string | null = null;
  private _refresh: string | null = null;

  /**
   * Parsed expiry in ms (Unix epoch milliseconds).
   * Set from `TokenResponse.expires_at` during login / register / refresh.
   * The PASETO v4.local payload is encrypted — we CANNOT decode claims.
   */
  private _expiresAtMs: number = 0;

  /** Refresh deduplication — non-null while a refresh is in-flight. */
  private _refreshing: Promise<boolean> | null = null;

  // ── Construction ──────────────────────────────────────────────────────

  private constructor() {
    super();
  }

  static getInstance(): AuthServiceClass {
    if (!AuthServiceClass.instance) {
      AuthServiceClass.instance = new AuthServiceClass();
    }
    return AuthServiceClass.instance;
  }

  // ── Public API ────────────────────────────────────────────────────────

  // ──── Login / Register ──────────────────────────────────────────────

  /**
   * Email/password login.
   *
   * Resolves once the token pair is stored + cached; emits `auth:changed`.
   * The backend `POST /v1/auth/login` returns ONLY `{token, refresh_token,
   * expires_at}` — no user profile — so this method returns void. The profile
   * is fetched separately via `getProfile()` (the AuthContext `auth:changed`
   * listener does this and populates `user`).
   */
  async login(email: string, password: string): Promise<void> {
    const res = await fetch(AUTH_ENDPOINTS.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = await parseErrorBody(res);
      throw new AuthError('login', body?.error ?? `HTTP ${res.status}`, res.status);
    }

    const data = (await res.json()) as TokenResponse;
    await this.handleTokenResponse(data);
  }

  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<void> {
    const res = await fetch(AUTH_ENDPOINTS.register, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: displayName }),
    });

    if (!res.ok) {
      const body = await parseErrorBody(res);
      throw new AuthError('register', body?.error ?? `HTTP ${res.status}`, res.status);
    }

    // Registration returns 202 + verification email — no token pair.
  }

  // ──── Resend verification email ──────────────────────────────────────

  /**
   * Resend the email-verification email.
   *
   * POST /v1/auth/resend-verification is unauthenticated (no Bearer).
   *
   * @returns An empty object on success, or `{ retryAfter }` when the
   *          backend returns 429 (rate-limited within a 60s cooldown).
   */
  async resendVerification(email: string): Promise<{ retryAfter?: number }> {
    const res = await fetch(AUTH_ENDPOINTS.resendVerification, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (res.status === 202) {
      return {};
    }

    if (res.status === 429) {
      const body: { error?: string; retry_after?: number } | null =
        await parseErrorBody(res) as { error?: string; retry_after?: number } | null;
      const retryAfter = body?.retry_after ?? 60;
      return { retryAfter };
    }

    const body = await parseErrorBody(res);
    throw new AuthError(
      'resendVerification',
      body?.error ?? `HTTP ${res.status}`,
      res.status,
    );
  }

  // ──── Social login (stubs until 5-4 / 5-5) ─────────────────────────

  /**
   * Google OAuth login (mobile id_token flow). See `login()` for why this
   * returns void (the backend token-pair response carries no user profile).
   */
  async loginWithGoogle(idToken: string): Promise<void> {
    const res = await fetch(AUTH_ENDPOINTS.google, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    });

    if (!res.ok) {
      const body = await parseErrorBody(res);
      throw new AuthError(
        'loginWithGoogle',
        body?.error ?? `HTTP ${res.status}`,
        res.status,
      );
    }

    const data = (await res.json()) as TokenResponse;
    await this.handleTokenResponse(data);
  }

  /**
   * Apple Sign-In login (identity_token flow). See `login()` for why this
   * returns void (the backend token-pair response carries no user profile).
   */
  async loginWithApple(identityToken: string): Promise<void> {
    const res = await fetch(AUTH_ENDPOINTS.apple, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity_token: identityToken }),
    });

    if (!res.ok) {
      const body = await parseErrorBody(res);
      throw new AuthError(
        'loginWithApple',
        body?.error ?? `HTTP ${res.status}`,
        res.status,
      );
    }

    const data = (await res.json()) as TokenResponse;
    await this.handleTokenResponse(data);
  }

  // ──── Refresh ───────────────────────────────────────────────────────

  /**
   * Attempt to refresh the token pair.
   *
   * Returns:
   *  - `true`  → refresh succeeded; a new pair is stored + cached.
   *  - `false` → TERMINAL: the refresh token was rejected (HTTP 401) or no
   *              refresh token is cached. The caller should invalidate and
   *              force re-authentication.
   *
   * THROWS on TRANSIENT failures (network error or a non-401 server error such
   * as 5xx). The caller MUST NOT invalidate in that case — the credentials are
   * still valid and the operation can be retried. This distinction is what
   * prevents a momentary network blip during a 401-refresh from logging the
   * user out.
   */
  async refresh(): Promise<boolean> {
    const rt = this._refresh;
    if (!rt) {
      return false;
    }

    let res: Response;
    try {
      res = await fetch(AUTH_ENDPOINTS.refresh, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
    } catch {
      // Network error — transient. Surface it so the caller can retry WITHOUT
      // invalidating the (still-valid) credentials.
      throw new Error('Cloud auth refresh failed: network error');
    }

    if (res.status === 401) {
      return false; // refresh token rejected/expired — terminal
    }

    if (!res.ok) {
      // Non-401 server error (5xx, etc.) — transient; do NOT log the user out.
      throw new Error(`Cloud auth refresh failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as TokenResponse;
    await this.handleTokenResponse(data);
    return true;
  }

  // ──── Logout ────────────────────────────────────────────────────────

  /**
   * Best-effort logout: notify the backend, then clear local credentials
   * regardless of the server response.
   */
  async logout(): Promise<void> {
    try {
      const paseto = this._paseto;
      if (paseto) {
        await fetch(AUTH_ENDPOINTS.logout, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${paseto}`,
            'Content-Type': 'application/json',
          },
        });
      }
    } catch {
      // Network error during logout is non-fatal.
    } finally {
      await this.invalidate();
    }
  }

  // ──── Profile ───────────────────────────────────────────────────────

  /**
   * Fetch the current user's profile from `GET /v1/auth/me`.
   *
   * The underlying `this.fetch()` transparently retries once on 401 with
   * a single deduplicated refresh.  If the refresh also fails,
   * `AuthExpiredError` is thrown naturally — callers do NOT need to handle
   * 401 status explicitly.
   */
  async getProfile(): Promise<UserProfile> {
    const res = await this.fetch(AUTH_ENDPOINTS.me);

    if (!res.ok) {
      const body = await parseErrorBody(res);
      throw new AuthError('getProfile', body?.error ?? `HTTP ${res.status}`);
    }

    return (await res.json()) as UserProfile;
  }

  // ──── Token access ──────────────────────────────────────────────────

  /**
   * Return the current PASETO, loading from Keychain if the cache is cold.
   *
   * The Keychain read only happens once per app session (on first access
   * after a cold start / after `invalidate()`).
   */
  async getToken(): Promise<string> {
    if (this._paseto) {
      return this._paseto;
    }

    const blob = await loadTokens();
    if (!blob) {
      throw new AuthExpiredError();
    }

    this._paseto = blob.paseto;
    this._refresh = blob.refresh;
    this._expiresAtMs = Date.parse(blob.expires_at);
    return this._paseto;
  }

  /**
   * Cached expiry in Unix epoch milliseconds.
   *
   * Returns 0 when no token is loaded (first launch / after logout).
   *
   * CRITICAL: This value is derived from `TokenResponse.expires_at` (RFC 3339),
   * NOT from PASETO claim decoding — v4.local is encrypted and the App has
   * no symmetric key.
   */
  getTokenExpiresAt(): number {
    return this._expiresAtMs;
  }

  // ──── Invalidation ──────────────────────────────────────────────────

  /**
   * Clear the in-memory cache AND Keychain credentials.
   *
   * Safe to call multiple times.  Emits `auth:expired` so the AuthContext
   * can transition to `unauthenticated`.
   */
  async invalidate(): Promise<void> {
    this._paseto = null;
    this._refresh = null;
    this._expiresAtMs = 0;
    await clearTokens();
    this.emit('auth:expired');
  }

  // ──── Authenticated fetch ───────────────────────────────────────────

  /**
   * Fetch wrapper — attaches the cloud PASETO Bearer token and transparently
   * retries once on 401 with a single deduplicated refresh.
   *
   * 401 body contract (backend `pkg/auth/auth.go:89-107`):
   *   { "error": "token expired" | "token revoked" | "invalid token" }
   *
   * Refresh semantics: a TERMINAL refresh failure (refresh token rejected →
   * `refresh()` returns `false`) invalidates the credentials once and throws
   * `AuthExpiredError`. A TRANSIENT refresh failure (network / 5xx →
   * `refresh()` throws) propagates WITHOUT invalidating, so a momentary
   * network blip does not log the user out.
   */
  async fetch(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const paseto = await this.getToken();
    const headers = {
      ...init.headers,
      Authorization: `Bearer ${paseto}`,
      'Content-Type': 'application/json',
    };

    const res = await globalThis.fetch(url, { ...init, headers });
    if (res.status !== 401) {
      return res;
    }

    // ── 401 — attempt one deduplicated refresh, then retry once ───────
    try {
      const ok = await (this._refreshing ??= this.refresh());
      if (!ok) {
        await this.invalidate();
        throw new AuthExpiredError();
      }
    } finally {
      this._refreshing = null;
    }

    const fresh = await this.getToken();
    const retryHeaders = {
      ...init.headers,
      Authorization: `Bearer ${fresh}`,
      'Content-Type': 'application/json',
    };
    return globalThis.fetch(url, { ...init, headers: retryHeaders });
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  private async handleTokenResponse(data: TokenResponse): Promise<void> {
    const { token, refresh_token, expires_at } = data;

    // Persist to Keychain
    await saveTokens(token, refresh_token, expires_at);

    // Update in-memory cache
    this._paseto = token;
    this._refresh = refresh_token;
    this._expiresAtMs = Date.parse(expires_at);

    this.emit('auth:changed', token);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function parseErrorBody(
  res: Response,
): Promise<{ error?: string } | null> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return null;
  }
}

// ── Export singleton ────────────────────────────────────────────────────

const AuthService = AuthServiceClass.getInstance();
export default AuthService;
