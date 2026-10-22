/**
 * soulbitsClient — factory for the first-party Soulbits API client.
 *
 * Centralises construction of `createClient(...)` for the harmony-ai-app so the
 * auth policy and host resolution live in exactly one place. Every REST call to
 * the Soulbits backend (session broker today; account/subscription/inference
 * later) goes through a client built here.
 *
 * ── AUTH POLICY ───────────────────────────────────────────────────────────
 * The client is built in **PASETO-only mode** (no `refreshToken`):
 *
 *   - The client injects `Authorization: Bearer <paseto>` on every request.
 *   - The client does **NOT** auto-refresh on 401. The JS client's built-in
 *     single-flight refresh only activates when a `refreshToken` is supplied
 *     (`createAuthFetch` checks `auth.refreshToken`); by omitting it we keep
 *     that behaviour disabled.
 *
 * Why? The app's `AuthService` is the single source of truth for the token pair
 * (Keychain persistence, WebSocket `Sec-WebSocket-Protocol` dial auth, the
 * proactive-refresh timer, and the reactive WS-onclose refresh layer). The JS
 * client refreshes **in-memory only** and exposes no read-back / notification
 * hook, so a client-side refresh would desync from the Keychain copy consumed by
 * the WebSocket layer — risking double-refreshes and, with rotating refresh
 * tokens, terminal logout. Keeping refresh in `AuthService` guarantees one
 * persisted, broadcast token. Consumers that receive a 401 must therefore call
 * `AuthService.refresh()` themselves (see `CloudSessionService._runConnectLoop`,
 * which re-builds the client with the freshest token before each connect).
 *
 * ── HOST RESOLUTION ───────────────────────────────────────────────────────
 * `cloudURL` is the **session-broker** host (`CLOUD_HOSTS.session`). In cloud
 * mode this equals the auth-service host (an API gateway routes by path), so
 * `account.*` / `subscription.*` resolve correctly too. In local dev the broker
 * runs on its own port, so only the `session.*` sub-API is valid for a client
 * built here; `account.*` would need `CLOUD_HOSTS.auth`.
 */

import { createClient } from '@harmony-ai-solutions/soulbits-api-client';
import { CLOUD_HOSTS } from '../../config/cloud';

export interface BuildSoulbitsClientOptions {
  /**
   * Current cloud PASETO (v4.local). Required — without it the client sends no
   * auth header and every protected endpoint returns 401.
   */
  paseto: string;
}

/**
 * Build a SoulbitsClient bound to the app's resolved cloud hosts and the given
 * PASETO. See the file-level docstring for the auth policy.
 *
 * @returns A {@link createClient} instance whose `session.*` sub-API targets the
 *          session broker. Reconstructed per call with the latest token — the
 *          client is lightweight (two openapi-fetch instances) and this avoids
 *          ever holding a stale token inside a long-lived client.
 */
export function buildSoulbitsClient(
  opts: BuildSoulbitsClientOptions,
): ReturnType<typeof createClient> {
  return createClient({
    paseto: opts.paseto,
    // Deliberately NO refreshToken → disables the client's in-memory auto-refresh.
    cloudURL: CLOUD_HOSTS.session,
    inferenceURL: CLOUD_HOSTS.inference,
  });
}

// ── Subscription / tier policy (task 2-5) ────────────────────────────────
//
// Cloud-mode startup fetches the caller's tier policy so the on-device engine
// can honour it locally (the beat budget, `autonomy_beats_per_day`, is consumed
// by the on-device lifecycle batch — wired for 4-x). Resolution goes through
// the authenticated `/v1/subscription/me` endpoint; in cloud mode the
// session-broker host equals the auth-service host (an API gateway routes by
// path), so the client built here resolves `subscription.*` correctly.

/** A snapshot of the caller's active subscription + tier limits. */
export interface SubscriptionSnapshot {
  /** Tier id (`free`, `core`, `infinite`, …). */
  tierId: string;
  displayName: string;
  status: string;
  expiresAt: string | null;
  /** Per-tier limits; `autonomy_beats_per_day` lives here. */
  limits: Record<string, unknown>;
  features: Record<string, unknown>;
}

/**
 * Fetch the caller's current subscription. Throws on a transport/auth error
 * (the caller decides whether that is fatal).
 */
export async function fetchMySubscription(paseto: string): Promise<SubscriptionSnapshot> {
  const client = buildSoulbitsClient({ paseto });
  const sub = await client.subscription.getMySubscriptionOrThrow();
  return {
    tierId: sub.tier_id,
    displayName: sub.display_name,
    status: sub.status,
    expiresAt: sub.expires_at ?? null,
    limits: (sub.limits ?? {}) as Record<string, unknown>,
    features: (sub.features ?? {}) as Record<string, unknown>,
  };
}

/**
 * Fetch the tier's daily autonomy-beat budget (`autonomy_beats_per_day`,
 * added in 4-4). Returns null when the tier does not define one (unlimited /
 * not applicable). Best-effort callers should catch and treat null as
 * "unknown".
 */
export async function fetchAutonomyBeatsPerDay(paseto: string): Promise<number | null> {
  const sub = await fetchMySubscription(paseto);
  const raw = sub.limits['autonomy_beats_per_day'];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}
