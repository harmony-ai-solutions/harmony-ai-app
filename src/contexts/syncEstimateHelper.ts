/**
 * Pure decision helper for the sync size-estimate confirmation gate.
 *
 * The engine (Harmony Link) sends a SYNC_DATA_SIZE_ESTIMATE before pushing
 * data and blocks until the app confirms. This helper decides whether the UI
 * should prompt the user — extracted from SyncConnectionContext so it can be
 * unit-tested without rendering the provider (same pattern as
 * syncSettlementHelper).
 *
 * Semantics:
 *  - Prompt ONLY when the estimated download exceeds the configured limit.
 *  - Empty estimates (0 records AND 0 images) always auto-confirm silently —
 *    never prompt for nothing-to-download.
 *  - limitMB === null means "Unlimited" → never prompt (always auto-confirm).
 *  - isInitialSync === true (no last-sync watermark yet — new install, first
 *    sync) → ALWAYS prompt for any non-empty estimate, bypassing the limit.
 */
export function shouldPromptForSyncEstimate(params: {
  totalRecords: number;
  imageCount: number;
  estimatedDownloadMB: number;
  limitMB: number | null; // null = Unlimited → never prompt
  /** True when this is the very first sync (no persisted last-sync watermark). */
  isInitialSync?: boolean;
}): boolean {
  const { totalRecords, imageCount, estimatedDownloadMB, limitMB, isInitialSync = false } = params;
  if (totalRecords === 0 && imageCount === 0) return false; // nothing to sync
  if (isInitialSync) return true; // initial sync → always confirm (bypass limit)
  if (limitMB === null) return false; // Unlimited → never prompt
  return estimatedDownloadMB > limitMB;
}
