/**
 * engineLifecycleCall — pure helper tests (task 4-3).
 *
 * Locks the 4-1 facade result shapes + the RFC3339 wire format the engine's
 * `parseOptionalTime` accepts.
 */

import {
  outreachDueEntityIds,
  parseBatchResult,
  parseMaintenanceResult,
  toRfc3339,
} from '../engineLifecycleCall';

describe('toRfc3339', () => {
  it('renders second-precision UTC', () => {
    expect(toRfc3339(Date.UTC(2026, 0, 2, 3, 4, 5, 678))).toBe('2026-01-02T03:04:05Z');
  });
});

describe('parseBatchResult', () => {
  it('parses the facade batch DTO', () => {
    const json = JSON.stringify({
      completed: [
        {
          entityId: 'e1',
          plan: {
            elapsedSeconds: 3600,
            gapKind: 'short',
            beatsToFire: 2,
            missedBeats: 1,
            foldBeats: 0,
            dreamDue: false,
            compactDue: false,
            outreachDue: true,
            seed: 42,
          },
        },
      ],
      truncated: ['e2'],
      degraded: ['e3'],
    });
    const result = parseBatchResult(json);
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].entityId).toBe('e1');
    expect(result.truncated).toEqual(['e2']);
    expect(result.degraded).toEqual(['e3']);
    expect(outreachDueEntityIds(result)).toEqual(['e1']);
  });

  it('is defensive against malformed / partial JSON', () => {
    expect(parseBatchResult('')).toEqual({
      completed: [],
      truncated: [],
      degraded: [],
      skippedReason: null,
    });
    expect(parseBatchResult('{not json')).toEqual({
      completed: [],
      truncated: [],
      degraded: [],
      skippedReason: null,
    });
    const partial = parseBatchResult(JSON.stringify({ completed: [{ entityId: 'e1' }, {}] }));
    expect(partial.completed).toHaveLength(1);
  });

  it('surfaces a plan 7-8 not-authoritative skip reason (well-formed, not an error)', () => {
    const result = parseBatchResult(
      JSON.stringify({ completed: [], truncated: [], degraded: [], skipped_reason: 'not_authoritative' }),
    );
    expect(result.skippedReason).toBe('not_authoritative');
    expect(result.completed).toEqual([]);
  });
});

describe('parseMaintenanceResult', () => {
  it('parses the facade maintenance DTO', () => {
    const json = JSON.stringify({
      compacted: [{ entityId: 'e1', ops: 3, tokens: 1000 }],
      skipped: ['e2'],
      degraded: ['e3'],
      truncated: ['e4'],
      failed: [{ entityId: 'e5', ops: 0, tokens: 10, error: 'boom' }],
    });
    const result = parseMaintenanceResult(json);
    expect(result.compacted).toHaveLength(1);
    expect(result.compacted[0]).toMatchObject({ entityId: 'e1', ops: 3 });
    expect(result.skipped).toEqual(['e2']);
    expect(result.failed[0].error).toBe('boom');
  });

  it('is defensive against malformed JSON', () => {
    expect(parseMaintenanceResult('nope')).toEqual({
      compacted: [],
      skipped: [],
      degraded: [],
      truncated: [],
      failed: [],
      skippedReason: null,
    });
  });

  it('surfaces a plan 7-8 not-authoritative skip reason', () => {
    const result = parseMaintenanceResult(JSON.stringify({ skipped_reason: 'not_authoritative' }));
    expect(result.skippedReason).toBe('not_authoritative');
  });
});
