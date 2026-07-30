/**
 * Unit tests for the pure connection-status helper.
 *
 * Tests the derivation of `canUseChat` and `connectionStatus` for all
 * mode + state combinations, without rendering any React component.
 */
import {
  computeConnectionStatus,
  canUseChatForMode,
} from '../connectionStatusHelper';

describe('canUseChatForMode', () => {
  describe('cloud mode', () => {
    it('returns true only when status === ready', () => {
      expect(canUseChatForMode('cloud', 'ready', false)).toBe(true);
    });

    it('returns false for provisioning', () => {
      expect(canUseChatForMode('cloud', 'provisioning', false)).toBe(false);
    });

    it('returns false for requesting', () => {
      expect(canUseChatForMode('cloud', 'requesting', false)).toBe(false);
    });

    it('returns false for failed', () => {
      expect(canUseChatForMode('cloud', 'failed', false)).toBe(false);
    });

    it('returns false for idle', () => {
      expect(canUseChatForMode('cloud', 'idle', false)).toBe(false);
    });

    it('ignores isPaired in cloud mode', () => {
      // isPaired is always false in cloud mode, but even if it were true,
      // the cloud gate should still require ready.
      expect(canUseChatForMode('cloud', 'ready', true)).toBe(true);
      expect(canUseChatForMode('cloud', 'provisioning', true)).toBe(false);
    });
  });

  describe('self-hosted mode', () => {
    it('returns true when isPaired is true', () => {
      expect(canUseChatForMode('selfhosted', 'idle', true)).toBe(true);
    });

    it('returns false when isPaired is false', () => {
      expect(canUseChatForMode('selfhosted', 'idle', false)).toBe(false);
    });

    it('ignores cloud status in self-hosted mode', () => {
      expect(canUseChatForMode('selfhosted', 'ready', false)).toBe(false);
      expect(canUseChatForMode('selfhosted', 'ready', true)).toBe(true);
    });
  });
});

describe('computeConnectionStatus', () => {
  // ── Cloud mode ───────────────────────────────────────────────────────────

  describe('cloud: ready + connected', () => {
    const result = computeConnectionStatus('cloud', 'ready', false, true, false);

    it('returns textKey connected', () => {
      expect(result.textKey).toBe('connected');
    });
    it('returns success variant', () => {
      expect(result.variant).toBe('success');
    });
    it('returns cloud mode', () => {
      expect(result.mode).toBe('cloud');
    });
  });

  describe('cloud: ready + not connected', () => {
    const result = computeConnectionStatus('cloud', 'ready', false, false, false);

    it('returns textKey connecting', () => {
      expect(result.textKey).toBe('connecting');
    });
    it('returns warning variant', () => {
      expect(result.variant).toBe('warning');
    });
  });

  describe('cloud: provisioning', () => {
    const result = computeConnectionStatus('cloud', 'provisioning', false, false, false);

    it('returns textKey preparing', () => {
      expect(result.textKey).toBe('preparing');
    });
    it('returns warning variant', () => {
      expect(result.variant).toBe('warning');
    });
  });

  describe('cloud: requesting', () => {
    const result = computeConnectionStatus('cloud', 'requesting', false, false, false);

    it('returns textKey preparing', () => {
      expect(result.textKey).toBe('preparing');
    });
  });

  describe('cloud: failed', () => {
    const result = computeConnectionStatus('cloud', 'failed', false, false, false);

    it('returns textKey offline', () => {
      expect(result.textKey).toBe('offline');
    });
    it('returns error variant', () => {
      expect(result.variant).toBe('error');
    });
  });

  describe('cloud: idle', () => {
    const result = computeConnectionStatus('cloud', 'idle', false, false, false);

    it('returns textKey offline', () => {
      expect(result.textKey).toBe('offline');
    });
    it('returns muted variant', () => {
      expect(result.variant).toBe('muted');
    });
  });

  // ── Self-hosted mode ─────────────────────────────────────────────────────

  describe('self-hosted: not paired', () => {
    const result = computeConnectionStatus('selfhosted', 'idle', false, false, false);

    it('returns textKey notPaired', () => {
      expect(result.textKey).toBe('notPaired');
    });
    it('returns error variant', () => {
      expect(result.variant).toBe('error');
    });
    it('returns selfhosted mode', () => {
      expect(result.mode).toBe('selfhosted');
    });
  });

  describe('self-hosted: paired + connected', () => {
    const result = computeConnectionStatus('selfhosted', 'idle', true, true, false);

    it('returns textKey connected', () => {
      expect(result.textKey).toBe('connected');
    });
    it('returns success variant', () => {
      expect(result.variant).toBe('success');
    });
  });

  describe('self-hosted: paired + reconnecting', () => {
    const result = computeConnectionStatus('selfhosted', 'idle', true, false, true);

    it('returns textKey reconnecting', () => {
      expect(result.textKey).toBe('reconnecting');
    });
    it('returns warning variant', () => {
      expect(result.variant).toBe('warning');
    });
  });

  describe('self-hosted: paired + disconnected (not reconnecting)', () => {
    const result = computeConnectionStatus('selfhosted', 'idle', true, false, false);

    it('returns textKey disconnected', () => {
      expect(result.textKey).toBe('disconnected');
    });
    it('returns muted variant', () => {
      expect(result.variant).toBe('muted');
    });
  });

  describe('self-hosted: paired + connected carries cloud status ignored', () => {
    // Even if cloudStatus were 'failed', self-hosted mode should ignore it.
    const result = computeConnectionStatus('selfhosted', 'failed', true, true, false);

    it('returns textKey connected', () => {
      expect(result.textKey).toBe('connected');
    });
  });
});
