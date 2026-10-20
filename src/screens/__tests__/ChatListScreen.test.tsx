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
  shouldShowNewChatFab,
  hydrateListAvatars,
} from '../ChatListScreen';
import type { ChatListItem } from '../ChatListScreen';

function chatListItem(over: Partial<ChatListItem> = {}): ChatListItem {
  return {
    interactionId: 'i1',
    entityId: 'e2',
    characterId: 'p1',
    characterName: 'Aria',
    lastMessage: 'hi',
    lastMessageSender: 'Aria',
    lastMessageTime: new Date('2026-10-12T09:00:00Z'),
    avatarUri: null,
    avatarProfileId: 'p1',
    participantKey: 'e1+e2',
    participantIds: ['e1', 'e2'],
    isGroup: false,
    pinned: false,
    archived: false,
    muted: false,
    disabled: false,
    locked: false,
    unreadCount: 0,
    ...over,
  };
}

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

  it('zeroes the badge for a store-locked entity (7-14 V3 — not actionable)', () => {
    // A locked entity stays listed in search, but an unread badge would imply
    // an interaction that is impossible — suppressed like mute.
    expect(resolveDisplayUnreadCount(3, false, true)).toBe(0);
    expect(resolveDisplayUnreadCount(3, false, false)).toBe(3);
    expect(resolveDisplayUnreadCount(3, true, true)).toBe(0);
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

describe('ChatListScreen New Chat FAB guard (1-1)', () => {
  it('renders the + FAB when chat is usable', () => {
    expect(shouldShowNewChatFab(true)).toBe(true);
  });

  it('hides the + FAB when chat is not usable (!canUseChat)', () => {
    // While the screen shows the "engine starting" empty state, an actionable
    // FAB would open a picker that cannot mint a conversation.
    expect(shouldShowNewChatFab(false)).toBe(false);
  });
});

describe('ChatListScreen avatar hydration (contract 1.8.0)', () => {
  it('exposes rows BEFORE avatars resolve, then fills every row in one pass', async () => {
    let resolveAvatar!: (uri: string | null) => void;
    const pendingAvatar = new Promise<string | null>(resolve => {
      resolveAvatar = resolve;
    });

    const base = [
      chatListItem({ participantKey: 'e1+e2' }),
      chatListItem({ participantKey: 'e1+e3', entityId: 'e3', avatarProfileId: 'p2' }),
    ];
    const hydration = hydrateListAvatars(base, () => pendingAvatar);

    // First paint: rows exist (name/preview/time) with NO avatar yet.
    expect(base).toHaveLength(2);
    expect(base.every(item => item.avatarUri === null)).toBe(true);

    resolveAvatar('data:image/jpeg;base64,AQID');
    const filled = await hydration;

    expect(filled[0].avatarUri).toBe('data:image/jpeg;base64,AQID');
    expect(filled[1].avatarUri).toBe('data:image/jpeg;base64,AQID');
    expect(filled[0].characterName).toBe('Aria');
  });

  it('resolves a shared profile once for several rows', async () => {
    const resolver = jest.fn().mockResolvedValue('data:image/jpeg;base64,AQID');
    const filled = await hydrateListAvatars(
      [
        chatListItem({ participantKey: 'e1+e2' }),
        chatListItem({ participantKey: 'e1+e2b', entityId: 'e2b' }),
      ],
      resolver,
    );

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith('p1');
    expect(filled.every(item => item.avatarUri === 'data:image/jpeg;base64,AQID')).toBe(true);
  });

  it('leaves avatar-less rows untouched', async () => {
    const resolver = jest.fn();
    const items = [chatListItem({ avatarProfileId: null })];
    const filled = await hydrateListAvatars(items, resolver);

    expect(resolver).not.toHaveBeenCalled();
    expect(filled).toBe(items);
  });
});
