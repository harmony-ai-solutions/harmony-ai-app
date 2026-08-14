/**
 * dateFormat — shared relative date/time formatting for posts & images.
 *
 * Renders a human-friendly "when" string: relative time ("just now",
 * "10 minutes ago", "3 hours ago", "1 day ago") for anything under a week,
 * then a full date ("Jul 12, 2026") beyond that.
 */

/**
 * Shared relative-time computation:
 *  - < 1 minute  → "just now"
 *  - < 1 hour    → "X minutes ago"
 *  - < 24 hours  → "X hours ago"
 *  - < 7 days    → "X days ago" (1 → "1 day ago")
 *  - otherwise   → full date string ("Jul 12, 2026")
 */
function formatRelative(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Future timestamps (clock skew) — treat as just now.
  if (diffMs < 60 * 1000) {
    return 'just now';
  }

  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  // 1 week+ — full date.
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a date for a post/image caption (e.g. "just now", "10 minutes ago",
 * "3 days ago", "Jul 12, 2026").
 */
export function formatPostDate(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return formatRelative(d);
}

/**
 * Relative date + full date for older posts (e.g. "just now", "10 minutes
 * ago", "3 days ago", "Jul 12, 2026"). Kept for contexts that previously
 * wanted a date + time variant — now also purely relative, matching
 * formatPostDate.
 */
export function formatPostDateTime(date: Date | string | number): string {
  return formatPostDate(date);
}
