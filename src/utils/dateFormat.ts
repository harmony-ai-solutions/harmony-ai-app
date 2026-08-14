/**
 * dateFormat — shared date/time formatting for posts.
 *
 * Renders a human-friendly "when" string: time-of-day for today, "Yesterday"
 * for yesterday, weekday for the last 7 days, and a short date beyond that.
 * Mirrors the ChatListScreen formatTime behaviour but always includes a full
 * date for older items.
 */

/**
 * Whole calendar days between the post date and now (today = 0, yesterday = 1).
 * Uses calendar-day boundaries, not elapsed 24h windows, so a post from
 * yesterday that was made < 24h ago still counts as "Yesterday".
 */
function calendarDayDiff(date: Date): number {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfPostDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  return Math.round(
    (startOfToday.getTime() - startOfPostDay.getTime()) / (1000 * 60 * 60 * 24),
  );
}

/**
 * Format a date for a post caption (e.g. "2:45 PM", "Yesterday", "Wed",
 * "Jul 12, 2026").
 */
export function formatPostDate(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  const now = new Date();
  const days = calendarDayDiff(d);

  if (days === 0) {
    // Today — show time
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  // Same year — "Jul 12"; older — "Jul 12, 2026"
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * Smart date + time — relative date when it's recent, full date for older
 * posts (e.g. "2:45 PM" for today, "Yesterday", "Wed · 2:45 PM",
 * "Jul 12 · 2:45 PM", "Jul 12, 2026 · 2:45 PM").
 */
export function formatPostDateTime(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  const now = new Date();
  const days = calendarDayDiff(d);
  const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (days === 0) {
    // Today — just the time
    return timePart;
  }
  if (days === 1) {
    // Yesterday — just the word
    return 'Yesterday';
  }
  if (days < 7) {
    const weekday = d.toLocaleDateString([], { weekday: 'short' });
    return `${weekday} · ${timePart}`;
  }
  // Same year — "Jul 12 · 2:45 PM"; older — "Jul 12, 2026 · 2:45 PM"
  const sameYear = d.getFullYear() === now.getFullYear();
  const datePart = d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${datePart} · ${timePart}`;
}
