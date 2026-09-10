/**
 * Timestamp UTC normalization tests (D21-7 / D32, shipped with the 3-2 wipe
 * release).
 *
 * Pins the 6-1 §2 vector table: all three coexisting timestamp formats must
 * normalize to the same UTC instant (all six inputs → `20260905091244`),
 * truncated to seconds AFTER normalizing. In particular, the space-separated
 * SQLite format (format A) must be parsed as UTC — the bare `new Date(str)`
 * path reads it as LOCAL time (V8), which is the #1 divergence hazard.
 */

import {toUnixTimestamp, normalizeTimestampForSync} from '../sync';

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

/** The expected UTC instant for every 6-1 §2 vector: 2026-09-05T09:12:44Z. */
const EXPECTED_UNIX = Date.parse('2026-09-05T09:12:44Z') / 1000;

/** Format a unix-second value as `YYYYMMDDHHMMSS` in UTC (6-1 §2 rule 4). */
function toUtcCompact(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

// 6-1 §2 vector table — every row must yield `20260905091244`.
const VECTORS: Array<{input: string; note: string}> = [
  {input: '2026-09-05 09:12:44', note: 'format A (SQLite CURRENT_TIMESTAMP, UTC by definition)'},
  {input: '2026-09-05 09:12:44.999999999+00:00', note: 'format B, zero offset'},
  {input: '2026-09-05 11:12:44.123456789+02:00', note: 'format B, +02:00'},
  {input: '2026-09-05 02:12:44.5-07:00', note: 'format B, negative offset'},
  {input: '2026-09-05T09:12:44.123Z', note: 'format C'},
  {input: '2026-09-05T11:12:44.123+02:00', note: 'format C with offset'},
];

describe('toUnixTimestamp — 6-1 §2 UTC rules', () => {
  it.each(VECTORS.map(v => [v.input, v.note] as const))(
    'parses %s (%s) to the same UTC instant',
    (input) => {
      expect(toUnixTimestamp(input)).toBe(EXPECTED_UNIX);
      expect(toUtcCompact(toUnixTimestamp(input))).toBe('20260905091244');
    },
  );

  it('parses the space format as UTC, never as LOCAL time (the #1 divergence hazard)', () => {
    // `new Date("2026-09-05 09:12:44")` would yield LOCAL 09:12:44 — a
    // different instant whenever the machine is not UTC. The compact form must
    // be exactly 09:12:44 UTC regardless of the machine's timezone.
    const unix = toUnixTimestamp('2026-09-05 09:12:44');
    expect(toUtcCompact(unix)).toBe('20260905091244');
    expect(unix).toBe(Date.parse('2026-09-05T09:12:44Z') / 1000);
  });

  it('treats a space-format string WITHOUT offset as UTC (format A / legacy writer)', () => {
    // Legacy Go-driver strings may carry nanoseconds without any offset
    // (`emotion/ekman8.go:120` shape). UTC is the deterministic choice.
    expect(toUnixTimestamp('2026-09-05 09:12:44.123456789')).toBe(
      Date.parse('2026-09-05T09:12:44Z') / 1000,
    );
  });
});

describe('normalizeTimestampForSync — UTC-aware normalization', () => {
  it('normalizes every space-format vector to the same UTC instant', () => {
    // Format A and the offset-bearing format-B rows re-format through the
    // shared parser.
    expect(normalizeTimestampForSync('2026-09-05 09:12:44')).toBe(
      '2026-09-05T09:12:44.000Z',
    );
    expect(normalizeTimestampForSync('2026-09-05 09:12:44.999999999+00:00')).toBe(
      '2026-09-05T09:12:44.999Z',
    );
    expect(normalizeTimestampForSync('2026-09-05 11:12:44.123456789+02:00')).toBe(
      '2026-09-05T09:12:44.123Z',
    );
    expect(normalizeTimestampForSync('2026-09-05 02:12:44.5-07:00')).toBe(
      '2026-09-05T09:12:44.500Z',
    );
  });

  it('passes format-C strings through unchanged (existing contract)', () => {
    expect(normalizeTimestampForSync('2026-09-05T09:12:44.123Z')).toBe(
      '2026-09-05T09:12:44.123Z',
    );
    expect(normalizeTimestampForSync('2026-09-05T11:12:44.123+02:00')).toBe(
      '2026-09-05T11:12:44.123+02:00',
    );
  });

  it('falls back to current time for nullish input (existing contract)', () => {
    const before = Date.now();
    const result = normalizeTimestampForSync(undefined as any);
    const after = Date.now();
    const parsed = Date.parse(result);
    expect(parsed).toBeGreaterThanOrEqual(before - 1);
    expect(parsed).toBeLessThanOrEqual(after + 1);
  });
});