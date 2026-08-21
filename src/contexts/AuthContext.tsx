/**
 * Auth Context — cloud authentication state
 *
 * Exposes `{ user, status, login, loginWithGoogle, loginWithApple, register, logout }`.
 *
 * On mount: loads tokens from Keychain and attempts `getProfile()`.  If tokens
 * are absent or the profile call returns 401 → `unauthenticated`.
 *
 * Provider position (App.tsx): BETWEEN DatabaseProvider and SyncConnectionProvider.
 * `status==='loading'` must NOT block the locally-paired self-hosted mode —
 * it only gates the cloud branch.
 *
 * NOTE: The phase document's `src/context/` is a typo — the app convention
 * is `src/contexts/` (plural).
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import AuthService, {
  AuthExpiredError,
  type UserProfile,
} from '../services/auth/AuthService';
import { cloudSessionService } from '../services/cloud/CloudSessionService';
import DeviceAuthService from '../services/cloud/DeviceAuthService';
import { startSoulbitsTokenSync } from '../services/cloud/soulbitsTokenSync';
import { claimSignupBonus } from '../database/repositories/marketplace';
import { createLogger } from '../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';

const log = createLogger('[AuthContext]');

/** Read the `connection_mode` flag — 'cloud' → true, anything else → false. */
async function isCloudMode(): Promise<boolean> {
  try {
    const m = await AsyncStorage.getItem('connection_mode');
    return m === 'cloud';
  } catch {
    return false;
  }
}

// ── Types ───────────────────────────────────────────────────────────────

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextType {
  user: UserProfile | null;
  status: AuthStatus;

  // Monotonic counter incremented after EVERY explicit sign-in action
  // (email/password, Google, Apple). AppShell observes it to navigate the
  // user straight to their profile (MyProfile tab) after a fresh sign-in —
  // the app-start bootstrap path (persisted token) does NOT bump it, so
  // returning users are not yanked to the profile on every launch.
  signInVersion: number;

  // All login/register methods return void: the backend token-pair response
  // carries no user profile, so `user` is populated asynchronously by the
  // `auth:changed` listener (via getProfile). Callers should read `user`/
  // `status` from the context rather than the action's return value.
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  loginWithApple: (identityToken: string) => Promise<void>;
  logout: () => Promise<void>;
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
  // Incremented on every explicit sign-in (login / social). AppShell watches
  // this to navigate the freshly-signed-in user to their profile.
  const [signInVersion, setSignInVersion] = useState(0);

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

        // Token loaded — try to fetch the profile.
        const profile = await AuthService.getProfile();
        if (!cancelled) {
          setUser(profile);
          setStatus('authenticated');
          if (await isCloudMode()) {
            cloudSessionService.connect().catch(e => log.warn('Cloud session connect failed on bootstrap:', e));
          }
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
  useEffect(() => {
    return startSoulbitsTokenSync();
  }, []);

  // ── Marketplace library hydration (non-blocking) ─────────────────────
  // When the user is authenticated, fetch their account-bound marketplace
  // library (everything purchased / grabbed free) and cache it locally so it
  // follows them on any device. Never blocks authentication or the UI.
  useEffect(() => {
    if (status !== 'authenticated' || !user?.id) return;
    import('../services/marketplace/librarySync').then(({ syncLibraryToLocal }) =>
      syncLibraryToLocal(user.id).catch(() => {}),
    );
  }, [status, user?.id]);

  // ── Listen for auth:changed events (login/refresh) ────────────────────
  useEffect(() => {
    const onChanged = async () => {
      // D-DEV-01 first-run registration: upsert the per-install device row
      // (authorized=false) so the broker's connect gate can find it. Best-
      // effort — a registration failure must not block login.
      DeviceAuthService.registerDevice().catch(e =>
        log.warn('Device registration failed (non-fatal):', e instanceof Error ? e.message : String(e)),
      );
      try {
        const profile = await AuthService.getProfile();
        setUser(profile);
        setStatus('authenticated');
        if (await isCloudMode()) {
          cloudSessionService.connect().catch(e => log.warn('Cloud session connect failed on auth:changed:', e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
        }
      } catch {
        // Profile fetch failed, but the token pair is valid (just stored /
        // refreshed). Stay authenticated — `user` populates on retry or next
        // launch. Only `auth:expired` (token rejection) downgrades to
        // unauthenticated, never a transient profile-read failure.
        setStatus('authenticated');
        if (await isCloudMode()) {
          cloudSessionService.connect().catch(e => log.warn('Cloud session connect failed on auth:changed:', e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
        }
      }
    };

    AuthService.on('auth:changed', onChanged);
    return () => {
      AuthService.off('auth:changed', onChanged);
    };
  }, []);

  // ── Action wrappers ───────────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string) => {
    // AuthService.login stores the token pair and emits `auth:changed`; the
    // listener above fetches the profile and flips status to `authenticated`.
    await AuthService.login(email, password);
    bumpSignInVersion();
  }, [bumpSignInVersion]);

  const registerAction = useCallback(
    async (email: string, password: string, displayName: string) => {
      await AuthService.register(email, password, displayName);
      // Registration does NOT return a token — user must verify email.
      //
      // One-time first-signup gift: 50 free SOUL, granted exactly once per
      // install. The claim is atomic + idempotent (soul_wallet compares-and-
      // sets a flag inside a transaction), so a repeated submit or a second
      // registration on the same device can never double-grant.
      try {
        const { claimed, balance } = await claimSignupBonus();
        log.info(
          claimed
            ? `First-signup bonus granted. New SOUL balance: ${balance}`
            : `Signup bonus already claimed. SOUL balance: ${balance}`,
        );
      } catch (err) {
        // The gift is best-effort — never fail the registration because of it.
        log.warn('Failed to claim signup soul bonus:', err);
      }
    },
    [],
  );

  const loginWithGoogle = useCallback(async (idToken: string) => {
    await AuthService.loginWithGoogle(idToken);
    bumpSignInVersion();
  }, [bumpSignInVersion]);

  const loginWithApple = useCallback(async (identityToken: string) => {
    await AuthService.loginWithApple(identityToken);
    bumpSignInVersion();
  }, [bumpSignInVersion]);

  const logout = useCallback(async () => {
    await cloudSessionService.disconnect().catch(() => {});
    await AuthService.logout();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        signInVersion,
        login,
        register: registerAction,
        loginWithGoogle,
        loginWithApple,
        logout,
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
