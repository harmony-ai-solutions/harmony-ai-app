/**
 * connectionStatusHelper — engine connection status derivation (task 3-4).
 *
 * After the sync/cloud stack deletion the status is a pure function of the
 * local engine connection (paired / connected / reconnecting).
 */
import {
  computeConnectionStatus,
  canUseChatForMode,
} from '../connectionStatusHelper';

describe('computeConnectionStatus', () => {
  it('reports notPaired when the engine connection is unavailable', () => {
    const info = computeConnectionStatus('selfhosted', false, false, false);
    expect(info.textKey).toBe('notPaired');
    expect(info.variant).toBe('error');
    expect(info.mode).toBe('selfhosted');
  });

  it('reports connected when the engine WS is up', () => {
    const info = computeConnectionStatus('selfhosted', true, true, false);
    expect(info.textKey).toBe('connected');
    expect(info.variant).toBe('success');
  });

  it('reports reconnecting while a reconnect is scheduled/in-flight', () => {
    const info = computeConnectionStatus('selfhosted', true, false, true);
    expect(info.textKey).toBe('reconnecting');
    expect(info.variant).toBe('warning');
  });

  it('reports disconnected when paired but not connected and not reconnecting', () => {
    const info = computeConnectionStatus('selfhosted', true, false, false);
    expect(info.textKey).toBe('disconnected');
    expect(info.variant).toBe('muted');
  });
});

describe('canUseChatForMode', () => {
  it('is true when the engine connection is available', () => {
    expect(canUseChatForMode('selfhosted', true)).toBe(true);
  });

  it('is false when the engine connection is unavailable', () => {
    expect(canUseChatForMode('selfhosted', false)).toBe(false);
  });
});
