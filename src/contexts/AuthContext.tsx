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
  AuthError,
  type UserProfile,
} from '../services/auth/AuthService';
import { createLogger } from '../utils/logger';

const log = createLogger('[AuthContext]');

// ── Types ───────────────────────────────────────────────────────────────

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextType {
  user: UserProfile | null;
  status: AuthStatus;

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

  // ── Listen for auth:changed events (login/refresh) ────────────────────
  useEffect(() => {
    const onChanged = async () => {
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

  // ── Action wrappers ───────────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string) => {
    // AuthService.login stores the token pair and emits `auth:changed`; the
    // listener above fetches the profile and flips status to `authenticated`.
    await AuthService.login(email, password);
  }, []);

  const registerAction = useCallback(
    async (email: string, password: string, displayName: string) => {
      await AuthService.register(email, password, displayName);
      // Registration does NOT return a token — user must verify email.
    },
    [],
  );

  const loginWithGoogle = useCallback(async (idToken: string) => {
    await AuthService.loginWithGoogle(idToken);
  }, []);

  const loginWithApple = useCallback(async (identityToken: string) => {
    await AuthService.loginWithApple(identityToken);
  }, []);

  const logout = useCallback(async () => {
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
