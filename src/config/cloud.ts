/**
 * Cloud Environment Configuration
 *
 * Single source of truth for cloud-host endpoints, OAuth identifiers, and
 * auth-service URLs.  Build-flavor injection (Phase 8-1) sets IS_BETA,
 * GOOGLE_WEB_CLIENT_ID, and APPLE_SERVICES_ID via native BuildConfig /
 * xcconfig.  Until 8-1 is wired, Config is undefined and __DEV__ keeps
 * the app pointing at beta.* hosts during local Metro iteration.
 */

// Ambient declaration — react-native-config is NOT installed yet (Phase 8-1).
// Using `declare const` keeps tsc clean without adding any runtime dependency.
declare const Config:
  | {
      IS_BETA?: boolean;
      GOOGLE_WEB_CLIENT_ID?: string;
      APPLE_SERVICES_ID?: string;
    }
  | undefined;

// ── Flavour detection ──────────────────────────────────────────────────
// __DEV__ fallback so local Metro (no native flavour) resolves to beta.*.
// When Config is available (8-1), IS_BETA is a real boolean, never a string.
const IS_BETA: boolean = __DEV__ ? true : (Config?.IS_BETA === true);

const GOOGLE_WEB_CLIENT_ID: string = Config?.GOOGLE_WEB_CLIENT_ID ?? '';
const APPLE_SERVICES_ID: string = Config?.APPLE_SERVICES_ID ?? '';

const SUFFIX = IS_BETA ? 'beta.' : '';

// ── External hosts ─────────────────────────────────────────────────────
// Auth / session-broker / subscription share the same host.
// Inference gateway and conduct proxy WS are separate subdomains.
export const CLOUD_HOSTS = {
  auth: `https://${SUFFIX}cloud.soulbits.app`,
  inference: `https://${SUFFIX}api.soulbits.app`,
  conductProxyWs: `wss://${SUFFIX}connect.soulbits.app`,
};

// ── WebSocket paths on the conduct proxy ───────────────────────────────
// True mirror of HL paths (Phase 1-3).
export const WS_PATHS = {
  sync: '/ws/sync',
  worker: '/ws/worker',
};

// ── OAuth identifiers ──────────────────────────────────────────────────
export const OAUTH = {
  googleWebClientId: GOOGLE_WEB_CLIENT_ID,
  appleServicesId: APPLE_SERVICES_ID,
};

// ── Dev-mode convenience alias ─────────────────────────────────────────
export const IS_DEV = IS_BETA;

// ── Auth endpoint URLs (fully qualified) ───────────────────────────────
export const AUTH_ENDPOINTS = {
  login: `${CLOUD_HOSTS.auth}/v1/auth/login`,
  register: `${CLOUD_HOSTS.auth}/v1/auth/register`,
  refresh: `${CLOUD_HOSTS.auth}/v1/auth/refresh`,
  logout: `${CLOUD_HOSTS.auth}/v1/auth/logout`,
  google: `${CLOUD_HOSTS.auth}/v1/auth/google`,
  apple: `${CLOUD_HOSTS.auth}/v1/auth/apple`,
  me: `${CLOUD_HOSTS.auth}/v1/auth/me`,
  sessionConnect: `${CLOUD_HOSTS.auth}/v1/session/connect`,
  sessionDisconnect: `${CLOUD_HOSTS.auth}/v1/session/disconnect`,
  resendVerification: `${CLOUD_HOSTS.auth}/v1/auth/resend-verification`,
};
