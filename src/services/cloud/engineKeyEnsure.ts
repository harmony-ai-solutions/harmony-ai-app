/**
 * Engine Key Ensure — gives the embedded engine a LONG-LIVED Soulbits Cloud API
 * key (`sb_cloud_*`) as the `soulbitscloud` provider account credential.
 *
 * Background (2026-10-23 production incident): the app used to write the
 * account PASETO — a ≤1h credential — into the engine's `soulbitscloud`
 * account rows (`api_key`). Live engine modules pinned that value and started
 * 401ing the moment it expired. The account credential is now an API key that
 * does not expire: the app ensures ONE key named {@link CLOUD_ENGINE_KEY_NAME}
 * per account and writes it to the engine row only when it actually changes.
 * The engine mirrors row writes into live sessions per request, so no
 * per-rotation write is needed (or wanted).
 *
 * Server facts this module is built on:
 *   - `POST /v1/auth/api-keys` requires the PASETO, returns the FULL key ONCE
 *     (it is never retrievable again), and answers 409 once the 5-active-key
 *     cap is hit.
 *   - `GET /v1/auth/api-keys` lists id/name/prefix/created_at/last_used_at only.
 *     Deleted or revoked keys are NEVER listed, so absence means
 *     revoked-or-never-existed — never "try it again".
 *   - Names are not unique.
 *
 * Consequence: the only time this app can hold a key's secret is right after it
 * mints it — or when the engine row already carries it (the engine returns the
 * account `api_key` unmasked by design, single-user local engine). Both are
 * handled here; a listed key whose secret is unknown is never "reused" as a
 * write target, because there is nothing to write.
 *
 * Contract:
 *   - Signed out / no PASETO → no-op (`signed_out`). Standalone mode keeps the
 *     user-entered key; nothing is ever written while signed out.
 *   - Mint 409 → honest warn + `cap_reached`, NO retry loop (the user must
 *     revoke a key in their account settings).
 *   - The row write goes through the EXISTING `updateAllSoulbitsCloudApiKeys`
 *     path and happens ONLY when the key differs from the last key this module
 *     successfully applied / the row does not already hold it.
 *   - Single-flight: concurrent callers share ONE attempt, so the hourly
 *     `auth:changed` handler and the seeding/boot paths can never mint twice.
 *
 * The engine-readiness deferral lives with the callers (see
 * `soulbitsTokenSync`) — a not-connected error thrown from here is the boot
 * race they park and retry.
 */

import AuthService from '../auth/AuthService';
import {
  listAccounts,
  updateAllSoulbitsCloudApiKeys,
} from '../../database/repositories';
import { createLogger } from '../../utils/logger';
import { CLOUD_HOSTS } from '../../config/cloud';
import { buildSoulbitsClient } from './soulbitsClient';

const log = createLogger('[EngineKeyEnsure]');

// ── Constants ───────────────────────────────────────────────────────────

/** The ONE account key this app mints and keeps for the engine. */
export const CLOUD_ENGINE_KEY_NAME = 'Soulbits Engine';

/** The account type whose `api_key` is the engine inference credential. */
const SOULBITS = 'soulbitscloud';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * The honest outcome of one ensure attempt:
 *   - `applied`     → the key was written to the engine row (minted or already
 *                     known to this process but not yet in the row);
 *   - `reused`      → the engine row already held the active named key (no
 *                     mint, no write);
 *   - `unchanged`   → the key the engine row holds is the one this process
 *                     already applied (no mint, no write);
 *   - `signed_out`  → no cloud credential; nothing was read or written;
 *   - `cap_reached` → minting answered 409 (5 active keys); nothing was
 *                     written, and nothing will be retried automatically.
 */
export type EngineKeyEnsureStatus =
  | 'applied'
  | 'reused'
  | 'unchanged'
  | 'signed_out'
  | 'cap_reached';

export interface EngineKeyEnsureResult {
  status: EngineKeyEnsureStatus;
  /** The `sb_cloud_*` key this attempt resolved (absent for signed_out/cap_reached). */
  key?: string;
  /** The server id of the resolved key, when known. */
  keyId?: string;
  /** True when this attempt minted the key (applied only). */
  minted?: boolean;
}

// ── Module state ────────────────────────────────────────────────────────

/**
 * The full key this process resolved (the only place its secret can live —
 * the server never returns it again). Kept so an hourly refresh, a retried
 * deferred write and the create-time seeding all reuse the SAME key.
 */
let resolvedEngineKey: string | null = null;
let resolvedKeyId: string | null = null;

/** The last key this module successfully wrote to the engine row. */
let lastAppliedEngineKey: string | null = null;

/** The single attempt in flight, shared by every concurrent caller. */
let inFlight: Promise<EngineKeyEnsureResult> | null = null;

/**
 * The engine key to seed into a NEW `soulbitscloud` account row. Returns the
 * last key written (or the key this process already resolved but has not been
 * able to write yet — the deferred retry will write it). `null` until the
 * ensure flow has resolved one, in which case callers seed an empty key and the
 * next ensure trigger fills it.
 */
export function getLastAppliedEngineKey(): string | null {
  return lastAppliedEngineKey ?? resolvedEngineKey;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** The cached cloud PASETO, or null in standalone mode / on any read failure. */
async function readPaseto(): Promise<string | null> {
  try {
    const token = await AuthService.getToken();
    return token || null;
  } catch {
    return null;
  }
}

/** The HTTP status carried by a client error, when it has one. */
function httpStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** True when `key` carries the first 12 characters the server reports as `prefix`. */
function prefixMatches(key: string, prefix: string | undefined): boolean {
  return !!key && !!prefix && key.startsWith(prefix);
}

/**
 * The api_key currently on a live `soulbitscloud` account row (the mightiest
 * evidence that the engine already holds a key), or null when the row is empty.
 *
 * Throws the management-API "engine not connected" error on the cold-start boot
 * race — deliberately BEFORE any mint, so a failed boot can never mint a key
 * whose secret this process would lose.
 */
async function readEngineRowKey(): Promise<string | null> {
  const accounts = (await listAccounts(SOULBITS)).filter(a => !a.deleted_at);
  for (const account of accounts) {
    const key = (account.api_key ?? '').trim();
    if (key) return key;
  }
  return null;
}

/** Write the key through the existing bulk-refresh path and record it. */
async function writeEngineKey(key: string): Promise<void> {
  await updateAllSoulbitsCloudApiKeys(key);
  lastAppliedEngineKey = key;
  // The success log belongs to the verified write path only.
  log.info('Soulbits Engine API key applied to the engine');
}

/** One attempt at a time; concurrent callers join the attempt already running. */
function singleFlight(
  run: () => Promise<EngineKeyEnsureResult>,
): Promise<EngineKeyEnsureResult> {
  if (inFlight) return inFlight;

  const attempt = run();
  inFlight = attempt;

  const clear = () => {
    if (inFlight === attempt) inFlight = null;
  };
  void attempt.then(clear, clear);

  return attempt;
}

// ── Entry point ─────────────────────────────────────────────────────────

/**
 * Ensure the engine's `soulbitscloud` account carries our long-lived
 * `Soulbits Engine` API key. Idempotent, single-flight, and honest about every
 * outcome. Throws only on transport/auth failures (the caller decides whether
 * that is the boot race to defer).
 */
export function ensureCloudEngineKey(): Promise<EngineKeyEnsureResult> {
  return singleFlight(runEnsure);
}

async function runEnsure(): Promise<EngineKeyEnsureResult> {
  const paseto = await readPaseto();
  if (!paseto) {
    // Standalone mode — the user's own key is none of our business.
    log.debug('No cloud sign-in — leaving the engine provider key untouched');
    return {status: 'signed_out'};
  }

  // Read the row BEFORE minting: the boot race belongs here, and a minted key
  // whose secret we then cannot persist would be wasted.
  const rowKey = await readEngineRowKey();

  // 1) This process already resolved a key. Re-apply only when the row lost it.
  if (resolvedEngineKey) {
    if (rowKey === resolvedEngineKey) {
      const status = lastAppliedEngineKey === resolvedEngineKey ? 'unchanged' : 'reused';
      lastAppliedEngineKey = resolvedEngineKey;
      return {status, key: resolvedEngineKey, keyId: resolvedKeyId ?? undefined};
    }
    await writeEngineKey(resolvedEngineKey);
    return {
      status: 'applied',
      key: resolvedEngineKey,
      keyId: resolvedKeyId ?? undefined,
      minted: false,
    };
  }

  // 2) The engine row may already carry an active key named "Soulbits Engine"
  //    (a previous app session, or a duplicate name). Its secret is known from
  //    the row itself — reuse it rather than burn a slot. Newest wins.
  const client = buildSoulbitsClient({paseto, cloudURL: CLOUD_HOSTS.auth});
  const listed = await client.apiKeys.listAPIKeysOrThrow();
  const candidates = (listed ?? [])
    .filter(item => item.name === CLOUD_ENGINE_KEY_NAME)
    .sort((a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''));

  const existing = candidates.find(item => prefixMatches(rowKey ?? '', item.prefix));
  if (existing && rowKey) {
    resolvedEngineKey = rowKey;
    resolvedKeyId = existing.id;
    lastAppliedEngineKey = rowKey;
    log.info('Reusing the Soulbits Engine API key the engine already holds');
    return {status: 'reused', key: rowKey, keyId: existing.id};
  }

  // 3) Mint the one key. This is also the path for an EMPTY fresh-install row
  //    while a named key already exists: the server never reveals that key's
  //    secret again, so only a freshly minted one can be written. A 409 is the
  //    5-active-key cap: honest, terminal for this trigger, never retried.
  let created: {id: string; key: string};
  try {
    created = await client.apiKeys.createAPIKeyOrThrow(CLOUD_ENGINE_KEY_NAME);
  } catch (error) {
    if (httpStatus(error) === 409) {
      log.warn(
        'Could not create the Soulbits Engine API key: the account has reached its 5-key limit. ' +
          'Revoke an unused API key in the account settings, then sign in again. ' +
          'The engine keeps its current key until then.',
      );
      return {status: 'cap_reached'};
    }
    throw error;
  }

  resolvedEngineKey = created.key;
  resolvedKeyId = created.id;
  await writeEngineKey(created.key);
  return {status: 'applied', key: created.key, keyId: created.id, minted: true};
}

// ── Test support ────────────────────────────────────────────────────────

/**
 * Forget the module state (resolved key, applied key, in-flight attempt) so
 * suites start from a cold app. Test-only — never called by production code.
 */
export function resetEngineKeyEnsureForTests(): void {
  resolvedEngineKey = null;
  resolvedKeyId = null;
  lastAppliedEngineKey = null;
  inFlight = null;
}
