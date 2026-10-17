/**
 * accountKeyPayload — the shared-account escrow payload codec (owner ruling
 * 2026-10-17).
 *
 * The cloud stores the account's backup-key blob OPAQUELY (KMS-wrapped at rest),
 * so its shape is engine-owned and may evolve without any cloud change. v1:
 *
 *   base64(JSON {"v":1,"dek":"<dek-b64>","code":"<recovery-code>"})
 *
 * A legacy account may hold the raw base64 DEK (no code) — `decodeAccountKeyPayload`
 * falls back to that shape so an existing account keeps working.
 *
 * The engine is the policy owner (its `DecodeAccountKeyPayload` accepts both
 * shapes); the app uses this codec to BUILD the payload it PUTs to the account
 * escrow and to READ the DEK out of a fetched blob for the restore path.
 */

import { uint8ArrayToBase64 } from '../../database/base64';
import { utf8Encode } from '../../utils/charactercard/pngWriter';
import { base64DecodeToUtf8 } from '../../utils/charactercard/pngParser';

/** The decoded escrow blob. */
export interface DecodedAccountKeyPayload {
  /** The lineage DEK (base64). */
  dekBase64: string;
  /** The recovery code — v1 payloads only; absent for the legacy shape. */
  code?: string;
}

/** Build the v1 escrow payload from the lineage DEK + recovery code. */
export function encodeAccountKeyPayload(dekBase64: string, code: string): string {
  const json = JSON.stringify({ v: 1, dek: dekBase64, code });
  return uint8ArrayToBase64(utf8Encode(json));
}

/**
 * Decode an escrow blob, accepting BOTH the v1 JSON payload and the legacy
 * raw-base64 DEK. Returns null for an empty input.
 */
export function decodeAccountKeyPayload(wrapped: string): DecodedAccountKeyPayload | null {
  const s = (wrapped ?? '').trim();
  if (!s) return null;

  const json = base64DecodeToUtf8(s);
  if (json) {
    try {
      const parsed = JSON.parse(json) as { v?: unknown; dek?: unknown; code?: unknown };
      if (parsed && parsed.v === 1 && typeof parsed.dek === 'string' && parsed.dek) {
        return {
          dekBase64: parsed.dek,
          code: typeof parsed.code === 'string' && parsed.code ? parsed.code : undefined,
        };
      }
    } catch {
      // Not JSON — fall through to the legacy raw-DEK shape.
    }
  }

  // Legacy: the blob IS the base64 DEK.
  return { dekBase64: s };
}
