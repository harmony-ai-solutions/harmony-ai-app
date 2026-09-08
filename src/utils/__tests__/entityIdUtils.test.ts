/**
 * Entity ID derivation — 6-1 §1 vectors (per-repo regression, post-D11).
 *
 * These pin the shared D2 schema app-side (`deriveEntityId`,
 * `src/utils/entityIdUtils.ts`). The fixed instant for all vectors is
 * 2026-09-05T12:35:14Z → suffix `-20260905123514`.
 */

import {
  deriveEntityId,
  slugifyEntityName,
  formatUtcTimestamp,
} from '../entityIdUtils';

const FIXED_INSTANT = new Date('2026-09-05T12:35:14Z');
const TS = '20260905123514';

describe('deriveEntityId — 6-1 §1 derivation vectors', () => {
  it('Isabella → Isabella-20260905123514', () => {
    expect(deriveEntityId('Isabella', FIXED_INSTANT)).toBe(`Isabella-${TS}`);
  });

  it('"Isabella 2" → Isabella-2-20260905123514 (space collapses to "-")', () => {
    expect(deriveEntityId('Isabella 2', FIXED_INSTANT)).toBe(`Isabella-2-${TS}`);
  });

  it('"  Max  2 " → Max-2-20260905123514 (edge spaces trimmed, run collapsed)', () => {
    expect(deriveEntityId('  Max  2 ', FIXED_INSTANT)).toBe(`Max-2-${TS}`);
  });

  it('"«Zoë»!!" → Zo-20260905123514 (non-ASCII runs collapse to "-", trailing trimmed)', () => {
    expect(deriveEntityId('«Zoë»!!', FIXED_INSTANT)).toBe(`Zo-${TS}`);
  });

  it('"--__--" → entity-20260905123514 (empty base fallback)', () => {
    expect(deriveEntityId('--__--', FIXED_INSTANT)).toBe(`entity-${TS}`);
  });

  it('60×A → 48×A + suffix (base capped at 48 chars)', () => {
    const id = deriveEntityId('A'.repeat(60), FIXED_INSTANT);
    expect(id).toBe(`${'A'.repeat(48)}-${TS}`);
    // The capped base is exactly 48 chars (no longer).
    expect(id.length).toBe(48 + 1 + 14);
  });

  it('"a.b_c-d" → a.b_c-d-20260905123514 (valid charset passthrough: . _ - preserved)', () => {
    expect(deriveEntityId('a.b_c-d', FIXED_INSTANT)).toBe(`a.b_c-d-${TS}`);
  });

  it('"user" still derives (the reserved-name REJECTION lives in the mint seam, D33)', () => {
    // Derivation itself is pure — "user" is a valid slug; mintEntityId is the
    // seam that throws (pinned in the entities repository tests).
    expect(deriveEntityId('user', FIXED_INSTANT)).toBe(`user-${TS}`);
  });
});

describe('deriveEntityId — timezone rule (always UTC regardless of local clock)', () => {
  it('a +02:00 local-time instant yields the same id as the Z instant', () => {
    const localTimeInstant = new Date('2026-09-05T14:35:14+02:00');
    expect(localTimeInstant.getTime()).toBe(FIXED_INSTANT.getTime());
    expect(deriveEntityId('Isabella', localTimeInstant)).toBe(
      `Isabella-${TS}`,
    );
  });

  it('a -07:00 local-time instant yields the same id as the Z instant', () => {
    const localTimeInstant = new Date('2026-09-05T05:35:14-07:00');
    expect(deriveEntityId('Isabella', localTimeInstant)).toBe(
      `Isabella-${TS}`,
    );
  });

  it('formatUtcTimestamp is second-precision and zero-padded', () => {
    expect(formatUtcTimestamp(new Date('2026-01-02T03:04:05Z'))).toBe(
      '20260102030405',
    );
    expect(formatUtcTimestamp(new Date('2026-11-22T23:59:58Z'))).toBe(
      '20261122235958',
    );
  });
});

describe('slugifyEntityName — base slug rules', () => {
  it('keeps [A-Za-z0-9._-] verbatim (valid charset passthrough)', () => {
    expect(slugifyEntityName('a.b_c-d')).toBe('a.b_c-d');
  });

  it('collapses interior runs and trims edge separators', () => {
    expect(slugifyEntityName('  Max  2 ')).toBe('Max-2');
    expect(slugifyEntityName('--__--')).toBe('entity');
  });

  it('falls back to "entity" for an empty/whitespace name', () => {
    expect(slugifyEntityName('')).toBe('entity');
    expect(slugifyEntityName('   ')).toBe('entity');
  });

  it('caps the base at 48 chars', () => {
    expect(slugifyEntityName('A'.repeat(60))).toBe('A'.repeat(48));
    // Cap applies to the SLUG, not the raw input (charset chars pass through).
    expect(slugifyEntityName('a.b_c-d'.repeat(10)).length).toBe(48);
  });
});