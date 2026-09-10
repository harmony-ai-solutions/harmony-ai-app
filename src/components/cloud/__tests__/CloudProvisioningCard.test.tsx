/**
 * CloudProvisioningCard tests — Phase 9.
 *
 * Pure-function tests for classifyCloudStage and calcElapsedSeconds.
 * Component rendering is impractical in the current test environment
 * (react-native + react-test-renderer environment incompatibility);
 * the logic-layer tests cover the critical mapping logic.
 *
 * Per spec: "If full rendering is impractical in the existing test setup,
 * at minimum add logic tests for the status→stage mapping function
 * (extract it as a pure helper so it's testable)."
 */

import { classifyCloudStage, calcElapsedSeconds } from '../CloudProvisioningCard';
import type { CloudSessionStatus } from '../../../services/cloud/CloudSessionService';

// ── Pure function: classifyCloudStage ─────────────────────────────────────

describe('classifyCloudStage', () => {
  /**
   * Every (status, isConnected) pair maps to the correct RadarState.
   * Verified against the spec table:
   *
   * | idle       | —    | idle            |
   * | requesting | no   | connecting      |
   * | provisioning| no  | waiting         |
   * | ready      | no   | connecting      |
   * | ready      | yes  | connected       |
   * | failed     | —    | error           |
   */
  it.each<[CloudSessionStatus, boolean, string]>([
    ['idle', false, 'idle'],
    ['idle', true, 'idle'],
    ['requesting', false, 'connecting'],
    ['requesting', true, 'connecting'],
    ['provisioning', false, 'waiting'],
    ['provisioning', true, 'waiting'],
    ['ready', false, 'connecting'],
    ['ready', true, 'connected'],
    ['failed', false, 'error'],
    ['failed', true, 'error'],
  ])('maps status=%s isConnected=%s → %s', (status, isConnected, expected) => {
    expect(classifyCloudStage(status, isConnected)).toBe(expected);
  });

  it('never returns idle for active provisioning statuses', () => {
    const active: CloudSessionStatus[] = ['requesting', 'provisioning', 'ready', 'failed'];
    for (const s of active) {
      expect(classifyCloudStage(s, false)).not.toBe('idle');
      expect(classifyCloudStage(s, true)).not.toBe('idle');
    }
  });

  it('returns connected only when ready + isConnected', () => {
    expect(classifyCloudStage('ready', true)).toBe('connected');
    expect(classifyCloudStage('requesting', true)).not.toBe('connected');
    expect(classifyCloudStage('provisioning', true)).not.toBe('connected');
  });
});

// ── Pure function: calcElapsedSeconds ─────────────────────────────────────

describe('calcElapsedSeconds', () => {
  it('returns 0 when no requestedAt', () => {
    expect(calcElapsedSeconds(undefined, undefined)).toBe(0);
    expect(calcElapsedSeconds(undefined, 1000)).toBe(0);
  });

  it('calculates elapsed when stoppedAt is given', () => {
    expect(calcElapsedSeconds(1000, 5000)).toBe(4);
    expect(calcElapsedSeconds(5000, 5000)).toBe(0);
    expect(calcElapsedSeconds(5000, 3000)).toBe(0);   // floor clamp, never negative
  });

  it('handles negative elapsed gracefully', () => {
    // stoppedAt before requestedAt is edge case; should return 0
    expect(calcElapsedSeconds(5000, 1000)).toBe(0);
  });
});
