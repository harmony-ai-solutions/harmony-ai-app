/**
 * Unit tests for shouldPromptForSyncEstimate — the pure "should we ask the
 * user before syncing?" gate.
 *
 * Extracted from SyncConnectionContext so it can be unit-tested without
 * rendering the provider (same pattern as syncSettlementHelper / Phase 9).
 *
 * Semantics:
 *  - The confirmation dialog is shown ONLY when estimated_download_mb > limit.
 *  - Empty estimates (0 records AND 0 images) always auto-confirm silently —
 *    never prompt for nothing-to-download.
 *  - limitMB === null means "Unlimited" → never prompt (always auto-confirm).
 */
import { shouldPromptForSyncEstimate } from '../syncEstimateHelper';

describe('shouldPromptForSyncEstimate', () => {
  describe('empty estimate (nothing to sync)', () => {
    it('returns false when there are no records and no images', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 0,
          imageCount: 0,
          estimatedDownloadMB: 0,
          limitMB: 5,
        }),
      ).toBe(false);
    });

    it('returns false for an empty estimate even with a tiny nonzero MB value', () => {
      // The engine may report a non-zero MB for a 0-record estimate (rounding);
      // "nothing to sync" must still win.
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 0,
          imageCount: 0,
          estimatedDownloadMB: 0.4,
          limitMB: 5,
        }),
      ).toBe(false);
    });
  });

  describe('at or below the limit', () => {
    it('returns false when the estimate is below the limit', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 10,
          imageCount: 0,
          estimatedDownloadMB: 3,
          limitMB: 5,
        }),
      ).toBe(false);
    });

    it('returns false when the estimate is exactly at the limit (boundary)', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 10,
          imageCount: 0,
          estimatedDownloadMB: 5,
          limitMB: 5,
        }),
      ).toBe(false);
    });

    it('returns false when the estimate is exactly at a larger custom limit', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 100,
          imageCount: 5,
          estimatedDownloadMB: 50,
          limitMB: 50,
        }),
      ).toBe(false);
    });
  });

  describe('above the limit', () => {
    it('returns true when the estimate exceeds the limit', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 10,
          imageCount: 0,
          estimatedDownloadMB: 5.1,
          limitMB: 5,
        }),
      ).toBe(true);
    });

    it('returns true with images when the estimate exceeds the limit', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 50,
          imageCount: 20,
          estimatedDownloadMB: 60,
          limitMB: 50,
        }),
      ).toBe(true);
    });
  });

  describe('Unlimited (null limit)', () => {
    it('returns false for a nonzero estimate when the limit is Unlimited', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 100,
          imageCount: 0,
          estimatedDownloadMB: 1000,
          limitMB: null,
        }),
      ).toBe(false);
    });

    it('returns false with images when the limit is Unlimited', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 500,
          imageCount: 200,
          estimatedDownloadMB: 5000,
          limitMB: null,
        }),
      ).toBe(false);
    });
  });

  describe('initial sync (new install, no watermark)', () => {
    it('returns true for a small estimate on initial sync (bypasses the limit)', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 1,
          imageCount: 0,
          estimatedDownloadMB: 0.1,
          limitMB: 5,
          isInitialSync: true,
        }),
      ).toBe(true);
    });

    it('returns true on initial sync even when the limit is Unlimited', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 1,
          imageCount: 0,
          estimatedDownloadMB: 0.1,
          limitMB: null,
          isInitialSync: true,
        }),
      ).toBe(true);
    });

    it('returns false on initial sync for an empty estimate (nothing to sync)', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 0,
          imageCount: 0,
          estimatedDownloadMB: 0,
          limitMB: 5,
          isInitialSync: true,
        }),
      ).toBe(false);
    });

    it('returns false for a non-initial sync below the limit (threshold still applies)', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 1,
          imageCount: 0,
          estimatedDownloadMB: 0.1,
          limitMB: 5,
          isInitialSync: false,
        }),
      ).toBe(false);
    });
  });

  describe('boundary / edge values', () => {
    it('returns true just above the limit (floating point)', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 1,
          imageCount: 0,
          estimatedDownloadMB: 5.0001,
          limitMB: 5,
        }),
      ).toBe(true);
    });

    it('handles a zero limit (any nonzero estimate prompts)', () => {
      expect(
        shouldPromptForSyncEstimate({
          totalRecords: 1,
          imageCount: 0,
          estimatedDownloadMB: 0.1,
          limitMB: 0,
        }),
      ).toBe(true);
    });
  });
});
