/**
 * ChatListScreen — derived-unread badge seam (3-1) pure predicates.
 *
 * NOTE: a full `render(<ChatListScreen />)` is NOT covered here — RN 0.86's
 * core index.js lazy-getters (Animated / RefreshControl / TouchableOpacity)
 * crash the node test env for this particular screen (see the render attempts).
 * The two behaviors are instead pinned at their pure seams:
 *  - `resolveDisplayUnreadCount` — mute (O10/Q8) suppresses the derived badge
 *    on the recount/load path.
 *  - `shouldRecountAfterSync` — the sync-apply handler gate (a
 *    `sync:messages-applied` payload only triggers a recount when the message
 *    table actually changed).
 *
 * The producer of the event is pinned separately (syncMessagesApplied.test.ts).
 */

import {
  resolveDisplayUnreadCount,
  shouldRecountAfterSync,
} from '../ChatListScreen';

describe('ChatListScreen derived-unread badge seam (3-1)', () => {
  it('shows the derived unread count when the partner is not muted', () => {
    expect(resolveDisplayUnreadCount(3, false)).toBe(3);
  });

  it('zeroes the badge for a muted partner (O10 — entity-level is_muted)', () => {
    expect(resolveDisplayUnreadCount(3, true)).toBe(0);
    expect(resolveDisplayUnreadCount(0, true)).toBe(0);
  });

  it('is a no-op for a non-muted partner with zero unread', () => {
    expect(resolveDisplayUnreadCount(0, false)).toBe(0);
  });
});

describe('ChatListScreen sync-apply recount gate (3-1)', () => {
  it('recounts when conversation_messages was applied', () => {
    expect(shouldRecountAfterSync(['conversation_messages'])).toBe(true);
    expect(shouldRecountAfterSync(['entities', 'conversation_messages'])).toBe(true);
  });

  it('does NOT recount when only non-message tables were applied', () => {
    expect(shouldRecountAfterSync(['entities'])).toBe(false);
    expect(shouldRecountAfterSync([])).toBe(false);
  });
});
