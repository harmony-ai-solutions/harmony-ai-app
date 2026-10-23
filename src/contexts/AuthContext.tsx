/**
 * Auth Context — cloud authentication state.
 *
 * Exposes `{ user, status, signInVersion, signInViaPortal, cancelSignIn,
 * logout, refreshUser, pendingSignIn }`.
 *
 * ── PORTAL IS THE SIGN-IN (Option B, owner-ruled 2026-10-17) ──────────────
 * The app no longer collects credentials directly. `signInViaPortal()` starts a
 * cloud connect session, opens the portal URL in the system browser, and the
 * user signs in / approves there. The redeemed token pair takes the IDENTICAL
 * Keychain + `auth:changed` path the retired email/password login used — see
 * {@link ConnectSessionService}. The direct-credential surface
 * (login/loginWithGoogle/loginWithApple/register) is removed.
 *
 * On mount: loads tokens from Keychain and attempts `getProfile()`.  If tokens
 * are absent or the profile call returns 401 → `unauthenticated`.
 *
 * Provider position (App.tsx): BETWEEN DatabaseProvider and SyncConnectionProvider.
 * `status==='loading'` must NOT block the locally-paired self-hosted mode —
 * it only gates the cloud branch.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { Linking } from 'react-native';
import AuthService, {
  AuthExpiredError,
  type UserProfile,
} from '../services/auth/AuthService';
import DeviceAuthService from '../services/cloud/DeviceAuthService';
import { getConnectSessionService } from '../services/cloud/ConnectSessionService';
import { startSoulbitsTokenSync } from '../services/cloud/soulbitsTokenSync';
import { startSeedingEnsure } from '../services/providers/seeding';
import { attachRelayTokenRotationReinject } from '../services/sync/relayTokenRotationReinject';
import { pushTokenStore } from '../services/notifications/PushTokenStore';
import { createLogger } from '../utils/logger';

const log = createLogger('[AuthContext]');

// ── Types ───────────────────────────────────────────────────────────────

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

/**
 * The pending portal-sign-in state the waiting UI renders. `pending` is the
 * live state; the others are terminal (the user must retry or cancel).
 */
export interface PendingSignIn {
  /** The portal URL to (re)open; null until the session is created. */
  connectUrl: string | null;
  status: 'pending' | 'expired' | 'consumed' | 'errored';
  /** Whole seconds left on the connect session (pending only). */
  remainingSeconds: number;
  /** Machine-readable message for the terminal states (errored only). */
  message: string | null;
}

export interface AuthContextType {
  user: UserProfile | null;
  status: AuthStatus;

  // Monotonic counter incremented after EVERY explicit sign-in action.
  // AppShell observes it to navigate the user straight to their profile
  // (MyProfile tab) after a fresh sign-in — the app-start bootstrap path
  // (persisted token) does NOT bump it, so returning users are not yanked to
  // the profile on every launch.
  signInVersion: number;

  /**
   * Begin the portal sign-in: create a connect session, open the portal URL in
   * the system browser, and start polling. Resolves once the browser is opened
   * (the redeem itself happens asynchronously via the poll → `auth:changed`).
   */
  signInViaPortal: () => Promise<void>;
  /** Abandon a pending sign-in (stops polling, clears the waiting state). */
  cancelSignIn: () => void;
  logout: () => Promise<void>;
  /** Re-fetch the current user's profile from the backend and update `user`. */
  refreshUser: () => Promise<void>;
  /** Live portal-sign-in state for the waiting screen (null when idle). */
  pendingSignIn: PendingSignIn | null;
}

// ── Context ─────────────────────────────────────────────────────────────
// Seeded with `undefined` so the `useAuth()` guard reliably fires when a
// consumer is rendered outside the provider (a non-undefined default would
// make `!context` always false and silently defer the error to call time).
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ── Provider ────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  // Incremented on every explicit sign-in (portal redeem). AppShell watches
  // this to navigate the freshly-signed-in user to their profile.
  const [signInVersion, setSignInVersion] = useState(0);
  const [pendingSignIn, setPendingSignIn] = useState<PendingSignIn | null>(null);

  const bumpSignInVersion = useCallback(() => {
    setSignInVersion(v => v + 1);
  }, []);

  // ── Bootstrap: load persisted tokens and attempt profile fetch ─────────
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        // getToken() loads from Keychain if the in-memory cache is cold.
        // If no credential exists it throws AuthExpiredError → caught below.
        const paseto = await AuthService.getToken();
        if (!paseto) {
          if (!cancelled) setStatus('unauthenticated');
          return;
        }

        // Proactive startup refresh (provider-registry follow-up). The 6-4
        // seeding ensure-flow writes whatever `getToken()` returns into the
        // engine account, so a cached-but-expired PASETO would be propagated as
        // a stale credential. Refresh FIRST when the token is expired or within
        // the refresh-ahead window; success emits `auth:changed`, and the
        // existing listeners (tokenSync + seedingEnsure) carry the fresh PASETO
        // through — no propagation code lives here.
        //
        // Transient failures are swallowed (the lazy 401 path stays
        // authoritative and MUST NOT be pre-empted by a network blip). A
        // terminal failure (rejected refresh token) returns false here and then
        // falls through to the getProfile() → auth:expired/invalidate path.
        await AuthService.refreshIfExpiring().catch((error: unknown) => {
          log.warn(
            'Startup proactive refresh skipped:',
            error instanceof Error ? error.message : String(error),
          );
        });

        // Token loaded — try to fetch the profile.
        const profile = await AuthService.getProfile();
        if (!cancelled) {
          setUser(profile);
          setStatus('authenticated');
        }
      } catch (error: unknown) {
        if (!cancelled) {
          if (error instanceof AuthExpiredError) {
            log.info('No valid cloud credential found — unauthenticated');
          } else {
            log.warn('Auth bootstrap failed:', error);
          }
          // Clear any stale state
          await AuthService.invalidate().catch(() => {});
          setStatus('unauthenticated');
        }
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Listen for auth:expired events ────────────────────────────────────
  useEffect(() => {
    const onExpired = () => {
      log.info('Auth expired — transitioning to unauthenticated');
      setUser(null);
      setStatus('unauthenticated');
      setPendingSignIn(null);
    };

    AuthService.on('auth:expired', onExpired);
    return () => {
      AuthService.off('auth:expired', onExpired);
    };
  }, []);

  // ── Propagate refreshed cloud PASETO into soulbitscloud provider rows ──
  // Subscribes to `auth:changed` (login + refresh) and bulk-updates the api_key
  // of every non-deleted soulbitscloud provider config. DB is guaranteed ready:
  // AuthProvider sits BELOW DatabaseProvider in App.tsx.
  //
  // 6-4 adds the seeding ensure-flow alongside it: the token-first account
  // ensure (never flag-gated) + the guard-gated gap-fill, on `auth:changed` AND
  // on the bootstrap-authenticated path (cold start already signed in). Both
  // converge on the single soulbitscloud account row post-3-2.
  //
  // 2026-10-23: the SAME event also re-injects a rotated PASETO into the
  // engine's relay config (cloud-relay sync only, verified before the write) so
  // the engine's relay credential never ages out behind a perfectly valid
  // sign-in. Idempotent by construction — see relayAuthRecovery's gates.
  useEffect(() => {
    const stopTokenSync = startSoulbitsTokenSync();
    const stopSeedingEnsure = startSeedingEnsure();
    const stopRelayTokenRotation = attachRelayTokenRotationReinject();
    return () => {
      stopTokenSync();
      stopSeedingEnsure();
      stopRelayTokenRotation();
    };
  }, []);

  // ── Listen for auth:changed events (portal redeem / refresh) ──────────
  useEffect(() => {
    const onChanged = async () => {
      // The redeem resolved (or a refresh landed) — the waiting screen is done.
      setPendingSignIn(null);

      // D-DEV-01 first-run registration: upsert the per-install device row
      // (authorized=false) so the broker's connect gate can find it. Best-
      // effort — a registration failure must not block login.
      //
      // Plan 7-12 §3: carry the effective push token (the Firebase FCM token
      // when the SDK supplied one, else the native raw-APNs fallback). A token
      // acquired at boot BEFORE sign-in could not be registered (signed out),
      // and Android's FCM token is only ever registered through this flow.
      const pushToken = pushTokenStore.getPushToken();
      DeviceAuthService.registerDevice(pushToken ? { pushToken } : {}).catch(e =>
        log.warn('Device registration failed (non-fatal):', e instanceof Error ? e.message : String(e)),
      );
      try {
        const profile = await AuthService.getProfile();
        setUser(profile);
        setStatus('authenticated');
      } catch {
        // Profile fetch failed, but the token pair is valid (just stored /
        // refreshed). Stay authenticated — `user` populates on retry or next
        // launch. Only `auth:expired` (token rejection) downgrades to
        // unauthenticated, never a transient profile-read failure.
        setStatus('authenticated');
      }
    };

    AuthService.on('auth:changed', onChanged);
    return () => {
      AuthService.off('auth:changed', onChanged);
    };
  }, []);

  // ── Mirror the connect-session service state into `pendingSignIn` ─────
  useEffect(() => {
    const service = getConnectSessionService();
    return service.subscribe((s) => {
      const status: PendingSignIn['status'] | null =
        s.status === 'pending' ||
        s.status === 'expired' ||
        s.status === 'consumed' ||
        s.status === 'errored'
          ? s.status
          : null;

      if (status === 'pending') {
        setPendingSignIn(prev => ({
          connectUrl: s.connectUrl ?? prev?.connectUrl ?? null,
          status: 'pending',
          remainingSeconds: s.remainingSeconds,
          message: null,
        }));
      } else if (status !== null) {
        setPendingSignIn(prev => ({
          connectUrl: s.connectUrl ?? prev?.connectUrl ?? null,
          status,
          remainingSeconds: 0,
          message: s.message,
        }));
      } else if (s.status === 'approved') {
        // The redeem already emitted `auth:changed` (which clears the waiting
        // state). Bump the fresh-sign-in counter so AppShell routes the user
        // to their profile exactly as the old login path did.
        bumpSignInVersion();
      }
      // idle / starting — no UI update.
    });
  }, [bumpSignInVersion]);

  // ── Action wrappers ───────────────────────────────────────────────────

  const signInViaPortal = useCallback(async () => {
    const service = getConnectSessionService();
    setPendingSignIn({
      connectUrl: null,
      status: 'pending',
      remainingSeconds: 0,
      message: null,
    });
    try {
      const { connectUrl } = await service.start();
      setPendingSignIn({
        connectUrl,
        status: 'pending',
        remainingSeconds: service.getState().remainingSeconds,
        message: null,
      });
      // Open the portal in the system browser. A failure to open is non-fatal
      // (the user can retry via "Open browser again" on the waiting screen).
      await Linking.openURL(connectUrl).catch(() => undefined);
    } catch (e) {
      log.warn('Failed to start portal sign-in:', e instanceof Error ? e.message : String(e));
      setPendingSignIn({
        connectUrl: null,
        status: 'errored',
        remainingSeconds: 0,
        message: 'start_failed',
      });
    }
  }, []);

  const cancelSignIn = useCallback(() => {
    getConnectSessionService().cancel();
    setPendingSignIn(null);
  }, []);

  const logout = useCallback(async () => {
    getConnectSessionService().cancel();
    setPendingSignIn(null);
    await AuthService.logout();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  // ── Re-fetch the profile (after PATCH /v1/auth/me display-name saves) ──
  const refreshUser = useCallback(async () => {
    try {
      const profile = await AuthService.getProfile();
      setUser(profile);
    } catch (err) {
      log.warn('Failed to refresh user profile:', err);
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        signInVersion,
        signInViaPortal,
        cancelSignIn,
        logout,
        refreshUser,
        pendingSignIn,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
