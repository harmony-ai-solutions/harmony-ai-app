/**
 * Unit tests for extracted pure helpers from SyncConnectionContext.
 *
 * Tests the WS failure → re-provision threshold logic without any
 * React rendering or singleton dependencies.
 */
import { shouldReprovisionAfterWsFailure } from '../SyncConnectionContext';

describe('shouldReprovisionAfterWsFailure', () => {
  describe('with default maxFailures (5)', () => {
    it('returns false, nextCount=1 when starting from 0', () => {
      const result = shouldReprovisionAfterWsFailure(0);
      expect(result.shouldReprovision).toBe(false);
      expect(result.nextCount).toBe(1);
    });

    it('returns false, nextCount=4 when starting from 3', () => {
      const result = shouldReprovisionAfterWsFailure(3);
      expect(result.shouldReprovision).toBe(false);
      expect(result.nextCount).toBe(4);
    });

    it('returns true, nextCount=0 when reaching max (4→5)', () => {
      const result = shouldReprovisionAfterWsFailure(4);
      expect(result.shouldReprovision).toBe(true);
      expect(result.nextCount).toBe(0);
    });

    it('returns true, nextCount=0 when exceeding max (5→6)', () => {
      const result = shouldReprovisionAfterWsFailure(5);
      expect(result.shouldReprovision).toBe(true);
      expect(result.nextCount).toBe(0);
    });

    it('returns true, nextCount=0 for large count (100→101)', () => {
      const result = shouldReprovisionAfterWsFailure(100);
      expect(result.shouldReprovision).toBe(true);
      expect(result.nextCount).toBe(0);
    });
  });

  describe('with custom maxFailures', () => {
    it('respects maxFailures=3: 2→3 triggers re-provision', () => {
      const result = shouldReprovisionAfterWsFailure(2, 3);
      expect(result.shouldReprovision).toBe(true);
      expect(result.nextCount).toBe(0);
    });

    it('respects maxFailures=3: 1→2 does not trigger', () => {
      const result = shouldReprovisionAfterWsFailure(1, 3);
      expect(result.shouldReprovision).toBe(false);
      expect(result.nextCount).toBe(2);
    });

    it('respects maxFailures=10: 9→10 triggers', () => {
      const result = shouldReprovisionAfterWsFailure(9, 10);
      expect(result.shouldReprovision).toBe(true);
      expect(result.nextCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles negative currentCount (should not happen but guard)', () => {
      const result = shouldReprovisionAfterWsFailure(-1);
      expect(result.nextCount).toBe(0);
      expect(result.shouldReprovision).toBe(false);
    });

    it('handles maxFailures=1: any count triggers', () => {
      const result = shouldReprovisionAfterWsFailure(0, 1);
      expect(result.shouldReprovision).toBe(true);
      expect(result.nextCount).toBe(0);
    });
  });
});
