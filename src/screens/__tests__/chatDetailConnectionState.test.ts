/**
 * ChatDetailScreen — connectionState mapping (4-3 / D36).
 *
 * The header dot previously had THREE states with the final `else` mapping
 * everything unknown to grey "offline" — so a terminally FAILED session
 * masqueraded as amber "connecting" forever (the incident's dead-end UX).
 * The mapping now lives in one pure helper with an explicit fourth `error`
 * state, shared by the dot render, the pulse effect and the input-bar gating,
 * so all three can never disagree.
 */
import { resolveChatConnectionState } from '../ChatDetailScreen';

describe('resolveChatConnectionState (4-state mapping, D36)', () => {
  it('connected when sync is up and the session is fully active', () => {
    expect(
      resolveChatConnectionState({ isConnected: true, isSessionActive: true, sessionFailed: false }),
    ).toBe('connected');
  });

  it('connecting when sync is up and the session is still initializing', () => {
    expect(
      resolveChatConnectionState({ isConnected: true, isSessionActive: false, sessionFailed: false }),
    ).toBe('connecting');
  });

  it('error when the session terminally failed — never masquerades as connecting', () => {
    expect(
      resolveChatConnectionState({ isConnected: true, isSessionActive: false, sessionFailed: true }),
    ).toBe('error');
  });

  it('offline when the sync transport is down — even for a failed session', () => {
    // Precedence: offline is the most accurate transport description; the
    // error card surfaces the failure independently of the dot.
    expect(
      resolveChatConnectionState({ isConnected: false, isSessionActive: false, sessionFailed: true }),
    ).toBe('offline');
    expect(
      resolveChatConnectionState({ isConnected: false, isSessionActive: true, sessionFailed: false }),
    ).toBe('offline');
  });
});
