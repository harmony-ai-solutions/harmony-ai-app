/**
 * Cloud Environment Configuration
 *
 * Single source of truth for cloud-host endpoints, OAuth identifiers, and
 * auth-service URLs.  Build-flavor injection (Phase 8-1) sets IS_BETA,
 * GOOGLE_WEB_CLIENT_ID, and APPLE_SERVICES_ID via native BuildConfig /
 * xcconfig, surfaced to JS by react-native-config.
 *
 * Type pinning contract (resolves 5-1 review concern):
 *   IS_BETA is declared as `string | boolean` to handle the Android/iOS
 *   asymmetry — Android's buildConfigField "boolean" produces a JS boolean
 *   at runtime; iOS xcconfig produces a string.  The `=== true` comparison
 *   below handles both forms because React Native's bridge coerces iOS
 *   boolean Info.plist keys to strings for xcconfig values.
 *   Phase 8-1c (iOS xcconfig) must ensure the Info.plist IS_BETA key is
 *   typed Boolean so react-native-config surfaces a JS boolean, or the
 *   expression must be updated to `Config?.IS_BETA === true || Config?.IS_BETA === 'true'`.
 *   For now the `=== true` arm fires on Android (real boolean) and is
 *   a no-op on iOS until 8-1c resolves the type story.
 *
 * Local backend override:
 *   Set USE_LOCAL_BACKEND = true to route all cloud traffic to a local
 *   soulbits-cloud-backend docker-compose stack for end-to-end debugging.
 *   See the "Local backend override" section below.
 */

import Config from 'react-native-config';
import { Platform } from 'react-native';

// ── Local backend override ─────────────────────────────────────────────
// Flip to true in __DEV__ to route all cloud traffic to a local
// soulbits-cloud-backend docker-compose stack instead of the beta cloud.
// Only effective in __DEV__ builds — production always uses cloud hosts.
//
// Prerequisites:
//   cd soulbits-cloud-backend
//   docker compose --profile services up
//   docker compose ps   # wait for all services to report "healthy"
//
// The Android emulator reaches the host machine's localhost via 10.0.2.2
// (QEMU loopback alias).  iOS Simulator uses localhost directly.
//
// Service ports (matching soulbits-cloud-backend/docker-compose.yml):
//   auth-service       :8083   /v1/auth/*
//   session-broker     :8080   /v1/session/*
//   conduct-proxy      :8085   /ws/sync, /ws/worker  (WebSocket)
//   inference-gateway  :8082   /v1/inference/*
const USE_LOCAL_BACKEND = false;

const LOCAL_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const LOCAL_PORTS = {
  auth: 8083,
  sessionBroker: 8080,
  conductProxy: 8085,
  inference: 8082,
};

// ── Flavour detection ──────────────────────────────────────────────────
// __DEV__ fallback so local Metro (no native flavour) resolves to beta.*.
// IS_BETA is pinned to a real boolean — never a string ambiguity.
const IS_BETA: boolean = __DEV__
  ? true
  : (Config?.IS_BETA === true || Config?.IS_BETA === 'true');

const GOOGLE_WEB_CLIENT_ID: string = Config?.GOOGLE_WEB_CLIENT_ID ?? '';
const APPLE_SERVICES_ID: string = Config?.APPLE_SERVICES_ID ?? '';

const SUFFIX = IS_BETA ? 'beta.' : '';

// ── Host resolution ────────────────────────────────────────────────────
// Cloud: a single hostname per subdomain; an API gateway / ALB routes by
//        path prefix (/v1/auth/* → auth-service, /v1/session/* → broker).
// Local: no API gateway in docker-compose — each service is on its own
//        port, so auth and session endpoints need separate base URLs.
const useLocal = __DEV__ && USE_LOCAL_BACKEND;

const AUTH_HOST = useLocal
  ? `http://${LOCAL_HOST}:${LOCAL_PORTS.auth}`
  : `https://${SUFFIX}cloud.soulbits.app`;

const SESSION_HOST = useLocal
  ? `http://${LOCAL_HOST}:${LOCAL_PORTS.sessionBroker}`
  : `https://${SUFFIX}cloud.soulbits.app`;

const WS_HOST = useLocal
  ? `ws://${LOCAL_HOST}:${LOCAL_PORTS.conductProxy}`
  : `wss://${SUFFIX}connect.soulbits.app`;

const INFERENCE_HOST = useLocal
  ? `http://${LOCAL_HOST}:${LOCAL_PORTS.inference}`
  : `https://${SUFFIX}api.soulbits.app`;

// ── External hosts (backward-compatible export) ────────────────────────
// `session` is the session-broker host — used as the Soulbits client's
// `cloudURL` base for the `session.*` sub-API (POST /v1/session/connect &
// /disconnect). In cloud mode it equals `auth` (API gateway routes by path);
// in local dev the broker runs on its own port (see LOCAL_PORTS).
export const CLOUD_HOSTS = {
  auth: AUTH_HOST,
  session: SESSION_HOST,
  inference: INFERENCE_HOST,
  conductProxyWs: WS_HOST,
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

// ── Endpoint URLs ──────────────────────────────────────────────────────
// Auth routes → auth-service; Session routes → session-broker.
// In cloud both share the same hostname (API gateway routes by path).
// In local dev they use separate ports.
// ── Cloud session polling constants ────────────────────────────────────
export const DEFAULT_CLOUD_RETRY_MS = 2000;
export const MAX_PROVISIONING_ATTEMPTS = 95;

// NOTE: Session-broker routes (/v1/session/connect, /disconnect) are no longer
// listed here — they are reached via the first-party Soulbits API client
// (createClient({ cloudURL: CLOUD_HOSTS.session })), which builds the URL from
// its baseUrl. See src/services/cloud/CloudSessionService.ts.
export const AUTH_ENDPOINTS = {
  login: `${AUTH_HOST}/v1/auth/login`,
  register: `${AUTH_HOST}/v1/auth/register`,
  refresh: `${AUTH_HOST}/v1/auth/refresh`,
  logout: `${AUTH_HOST}/v1/auth/logout`,
  google: `${AUTH_HOST}/v1/auth/google`,
  apple: `${AUTH_HOST}/v1/auth/apple`,
  me: `${AUTH_HOST}/v1/auth/me`,
  resendVerification: `${AUTH_HOST}/v1/auth/resend-verification`,
};
