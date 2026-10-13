/**
 * syncCloudTypes — the cloud-sync pairing payload + parser (plan 7-3).
 *
 * The portal (7-4) displays a QR encoding a small JSON object; the app scans it
 * (or the user pastes the same string by hand). The pinned shape is:
 *
 *   { "relay_url": "wss://…/v1/sync/ws", "pairing_token": "…", "account_hint": "…" }
 *
 * `pairing_token` is a short-lived, single-use credential the engine presents on
 * its first relay connect (7-1 consume). `account_hint` identifies the signed-in
 * account the code was minted for; the app verifies it matches the current
 * session before applying the code. `relay_url` is the relay WS endpoint.
 */

/** The decoded pairing payload (QR or manual paste). */
export interface SyncPairingPayload {
  relay_url: string;
  pairing_token: string;
  account_hint: string;
}

/** Thrown when a scanned/pasted pairing code cannot be parsed or is incomplete. */
export class SyncPairingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncPairingParseError';
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Parse a pairing code into {@link SyncPairingPayload}.
 *
 * Accepts the canonical JSON object as a string (what the QR encodes and what
 * the portal's "copy pairing code" button yields), or a `key=value` query-style
 * string (`relay_url=…&pairing_token=…&account_hint=…`) for robustness against
 * hand-typed codes. Throws {@link SyncPairingParseError} when a required field is
 * missing.
 */
export function parseSyncPairingPayload(raw: string): SyncPairingPayload {
  const text = (raw ?? '').trim();
  if (!text) {
    throw new SyncPairingParseError('empty pairing code');
  }

  let obj: Record<string, unknown> | null = null;

  if (text.startsWith('{')) {
    try {
      obj = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new SyncPairingParseError('pairing code is not valid JSON');
    }
  } else if (text.includes('=')) {
    // Query-style fallback: relay_url=…&pairing_token=…&account_hint=…
    const query = text.startsWith('?') ? text.slice(1) : text;
    obj = {};
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const key = decodeURIComponent(pair.slice(0, eq));
      const value = decodeURIComponent(pair.slice(eq + 1));
      obj[key] = value;
    }
  } else {
    throw new SyncPairingParseError('unrecognized pairing code format');
  }

  const relay_url = asString(obj.relay_url);
  const pairing_token = asString(obj.pairing_token);
  const account_hint = asString(obj.account_hint);

  if (!relay_url || !pairing_token) {
    throw new SyncPairingParseError('pairing code is missing relay_url or pairing_token');
  }

  return { relay_url, pairing_token, account_hint };
}

/**
 * Whether a payload's `account_hint` matches the signed-in account. A blank hint
 * (some codes may omit it) is treated as "no constraint" so pairing still works;
 * a non-blank hint that differs is a hard mismatch (the code was minted for a
 * different account).
 */
export function accountHintMatches(hint: string, signedInIdentifiers: string[]): boolean {
  const wanted = asString(hint).toLowerCase();
  if (!wanted) return true;
  return signedInIdentifiers.some(id => asString(id).toLowerCase() === wanted);
}
