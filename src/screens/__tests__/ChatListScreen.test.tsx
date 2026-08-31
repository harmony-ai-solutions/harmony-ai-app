/**
 * ChatListScreen — derived-unread badge seam (3-1) pure predicates.
 *
 * NOTE: a full `render(<ChatListScreen />)` is NOT covered here — RN 0.86's
 * core index.js lazy-getters (Animated / RefreshControl / TouchableOpacity)
 * crash the node test env for this particular screen (see the render attempts).
 * The two behaviors are instead pinned at their pure seams:
 *  - `resolveDisplayUnreadCount` — mute (O10/Q8) suppresses the derived badge
 *    on the recount/load path.
 *  - `shouldReloadAfterSync` — the sync-apply handler gate (a
 *    `sync:data-applied` payload only triggers a reload when a list-affecting
 *    table changed: `conversation_messages` for unread/last-message,
 *    `chat_conversation_settings` for pin/archive sort, 4-1).
 *
 * The producer of the event is pinned separately (syncMessagesApplied.test.ts).
 */

import {
  resolveDisplayUnreadCount,
  shouldReloadAfterSync,
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

describe('ChatListScreen sync-apply reload gate (3-1 → 4-1)', () => {
  it('reloads when conversation_messages was applied', () => {
    expect(shouldReloadAfterSync(['conversation_messages'])).toBe(true);
    expect(shouldReloadAfterSync(['entities', 'conversation_messages'])).toBe(true);
  });

  it('reloads when chat_conversation_settings was applied (pin/archive, 4-1)', () => {
    expect(shouldReloadAfterSync(['chat_conversation_settings'])).toBe(true);
    expect(shouldReloadAfterSync(['entities', 'chat_conversation_settings'])).toBe(true);
  });

  it('does NOT reload when only non-list-affecting tables were applied', () => {
    expect(shouldReloadAfterSync(['entities'])).toBe(false);
    expect(shouldReloadAfterSync(['entity_module_mappings'])).toBe(false);
    expect(shouldReloadAfterSync([])).toBe(false);
  });
});
