/**
 * Human-readable byte size (MB/KB) for size + quota displays.
 *
 * Shared by `BackupSettingsScreen` (size + estimate dialog) and
 * `DesktopSyncScreen` (plan 7-6 relay buffer usage). `0`/absent → `0 MB`.
 */
export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    const whole = Number.isInteger(mb) || mb >= 10;
    return `${mb.toFixed(whole ? 0 : 1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
