/**
 * ChatDetailScreen — session-INIT gate (Q8 / review).
 *
 * Verifies the extracted predicate guarding `startInteractionSession`: the
 * screen must NEVER send INIT for a disabled partner, and must NEVER INIT
 * before the entity disabled flag has loaded (the async `getEntity` on mount
 * may resolve after the init effect's first run — `disabledLoaded` closes that
 * race). The full screen has no node-env render harness (RN 0.86 crash — see
 * the record doc), so the gate logic is tested as a pure predicate.
 */

import { shouldInitializeEntitySession } from '../ChatDetailScreen';

describe('shouldInitializeEntitySession (session INIT gate, Q8)', () => {
  const base = {
    chatLocked: false,
    isConnected: true,
    participantKey: 'pk',
    disabledLoaded: true,
    isDisabled: false,
  };

  it('true when connected, loaded, enabled, not locked', () => {
    expect(shouldInitializeEntitySession(base)).toBe(true);
  });

  it('false when the sync connection is not connected', () => {
    expect(shouldInitializeEntitySession({ ...base, isConnected: false })).toBe(false);
  });

  it('false when there is no participantKey yet', () => {
    expect(shouldInitializeEntitySession({ ...base, participantKey: null })).toBe(false);
  });

  it('false when the marketplace conversation is locked', () => {
    expect(shouldInitializeEntitySession({ ...base, chatLocked: true })).toBe(false);
  });

  it('false when the disabled flag has NOT loaded yet (load-ordering race)', () => {
    // If this were true, INIT could be sent for a disabled partner before the
    // async getEntity sets isDisabled — the engine would reject with
    // ErrEntityDisabled and the user would see an error toast.
    expect(shouldInitializeEntitySession({ ...base, disabledLoaded: false })).toBe(false);
  });

  it('false when the partner entity is disabled (never send INIT)', () => {
    expect(shouldInitializeEntitySession({ ...base, isDisabled: true })).toBe(false);
  });
});
