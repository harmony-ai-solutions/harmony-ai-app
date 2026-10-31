/**
 * ChatListScreen inbox data path (global chat-list convergence, task 02-1).
 *
 * A full `render(<ChatListScreen />)` is not viable in the node test env (see
 * the header of ChatListScreen.test.tsx — RN 0.86's core index lazy-getters
 * crash it), so the load path is pinned at its exported seams:
 *  - `readInboxPage` — one inbox page read: the GLOBAL endpoint first, the
 *    legacy per-entity fan-out as the transparent fallback (mock management
 *    server, exactly like the repository tests).
 *  - `planInboxRows` — Phase-A planning (blocked / deleted / group guards).
 *  - `arrangeChatListItems` — server order is authoritative on the global
 *    path; only the legacy path is re-sorted client-side.
 *  - `mergeArchivedInboxRows` — the global archived array folds into the same
 *    archived section as the per-entity path.
 */

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { engineApiClient } from '../../services/engine/EngineApiClient';
import { resetEngineServiceForTests, setEngineConnection } from '../../services/engine/EngineService';
import { createMockManagementServer } from '../../services/engine/__tests__/mockManagementServer';
import {
  arrangeChatListItems,
  mergeArchivedInboxRows,
  planInboxRows,
  readInboxPage,
} from '../ChatListScreen';
import type { ChatListItem } from '../ChatListScreen';
import type { PhoneConversationPageRow } from '../../services/engine/repositories/interactions';

const CONN = {
  wsPort: 1,
  wssPort: 0,
  adminPort: 2,
  bind: '127.0.0.1',
  pid: 1,
  dataDir: '',
  token: 'tok',
};

/** One global-inbox row as the engine serialises it (task 02-1 shape). */
const globalRow = (over: Record<string, unknown> = {}) => ({
  interaction_id: 'i1',
  participant_key: 'user+e2',
  interaction_scope: 'private',
  participant_ids: '["user","e2"]',
  last_message: null,
  last_message_at: null,
  unread_count: 0,
  pinned: false,
  archived: false,
  reply_mode: 'realistic',
  entity_id: 'e2',
  last_activity_at: null,
  muted: false,
  entity_disabled: false,
  partner_entity_id: 'user',
  partner_display_name: 'Aria',
  partner_profile_id: 'p1',
  ...over,
});

function install(server: ReturnType<typeof createMockManagementServer>) {
  engineApiClient.setFetchImpl(server.fetch);
}

beforeEach(() => {
  resetEngineServiceForTests();
  setEngineConnection(CONN);
});

afterAll(() => {
  resetEngineServiceForTests();
});

function chatListItem(over: Partial<ChatListItem> = {}): ChatListItem {
  return {
    interactionId: 'i1',
    entityId: 'e2',
    characterId: 'p1',
    characterName: 'Aria',
    lastMessage: 'hi',
    lastMessageSender: 'Aria',
    lastMessageTime: new Date('2026-10-01T00:00:00Z'),
    avatarUri: null,
    avatarProfileId: 'p1',
    participantKey: 'user+e2',
    participantIds: ['user', 'e2'],
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

describe('readInboxPage — global path', () => {
  it('returns rows in SERVER order (the global contract forbids a client re-sort)', async () => {
    // Server order deliberately contradicts recency: the OLDER thread comes
    // first. A client re-sort would flip these.
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/entities/chat-list',
        json: {
          conversations: [
            globalRow({
              interaction_id: 'i-old',
              participant_key: 'user+e2',
              last_message_at: '2026-10-01T00:00:00Z',
            }),
            globalRow({
              interaction_id: 'i-new',
              participant_key: 'user+e3',
              participant_ids: '["user","e3"]',
              entity_id: 'e3',
              partner_profile_id: 'p2',
              last_message_at: '2026-10-20T00:00:00Z',
            }),
          ],
          has_more: false,
          next_offset: null,
        },
      },
    ]);
    install(server);

    const page = await readInboxPage({ povEntityId: 'user', limit: 20, offset: 0 });

    expect(page.source).toBe('global');
    expect(page.globalUnsupported).toBe(false);
    expect(page.rows.map(row => row.participantKey)).toEqual(['user+e2', 'user+e3']);
    // Rows arrive pre-hydrated, so the screen's Phase-B fallbacks stay no-ops.
    expect(page.rows[0].pinned).toBe(false);
    expect(page.rows[0].archived).toBe(false);
    expect(page.rows[0].unreadCount).toBe(0);
    expect(page.rows[0].lastMessage).toBeNull();

    // The screen arranges global rows by passthrough; the legacy path sorts.
    const asItems = page.rows.map((row, index) =>
      chatListItem({
        participantKey: row.participantKey,
        lastMessageTime: new Date(row.lastMessageAt ?? '2026-10-01T00:00:00Z'),
        interactionId: row.interactionId || `i${index}`,
      }),
    );
    expect(
      arrangeChatListItems([...asItems], true).map(item => item.participantKey),
    ).toEqual(['user+e2', 'user+e3']);
    expect(
      arrangeChatListItems([...asItems], false).map(item => item.participantKey),
    ).toEqual(['user+e3', 'user+e2']);
  });

  it('asks for the archived array on page 0 and merges it alongside active rows', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/entities/chat-list',
        json: {
          conversations: [globalRow()],
          archived: [
            globalRow({
              interaction_id: 'i-arch',
              participant_key: 'user+e9',
              participant_ids: '["user","e9"]',
              entity_id: 'e9',
              archived: true,
            }),
          ],
          has_more: true,
          next_offset: 20,
        },
      },
    ]);
    install(server);

    const page = await readInboxPage({
      povEntityId: 'user',
      limit: 20,
      offset: 0,
      includeArchived: true,
    });

    const call = server.lastCall('GET', '/api/entities/chat-list')!;
    expect(call.query).toEqual({ pov_entity_id: 'user', limit: '20', offset: '0', include_archived: '1' });
    expect(page.archivedRows.map(row => row.participantKey)).toEqual(['user+e9']);
    expect(page.archivedRows[0].archived).toBe(true);
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(20);

    const merged = mergeArchivedInboxRows(page.rows, page.archivedRows);
    expect(merged.map(row => row.participantKey)).toEqual(['user+e2', 'user+e9']);
    // Archived rows keep their flag, so the screen's archived section shows them.
    expect(merged.filter(row => row.archived).map(row => row.participantKey)).toEqual(['user+e9']);

    // Duplicate keys never double a row.
    expect(mergeArchivedInboxRows(page.rows, [page.rows[0]])).toEqual(page.rows);
  });

  it('forwards the offset for later pages', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/entities/chat-list',
        respond: req => ({
          json: {
            conversations: [globalRow({ participant_key: `user+${req.query.offset}` })],
            has_more: false,
            next_offset: null,
          },
        }),
      },
    ]);
    install(server);

    const page = await readInboxPage({ povEntityId: 'user', limit: 20, offset: 40 });
    expect(server.lastCall('GET', '/api/entities/chat-list')!.query.offset).toBe('40');
    expect(page.rows[0].participantKey).toBe('user+40');
  });
});

describe('readInboxPage — fallback to the per-entity path', () => {
  const perEntityRow = (over: Record<string, unknown> = {}) => ({
    interaction_id: 'i1',
    participant_key: 'user+e2',
    interaction_scope: 'private',
    participant_ids: '["user","e2"]',
    last_message: null,
    last_message_at: null,
    unread_count: 1,
    pinned: false,
    archived: false,
    reply_mode: 'realistic',
    ...over,
  });

  it('falls back when the connected engine has no global route (404)', async () => {
    // Only the per-entity route exists → the global call 404s.
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /\/api\/entities\/[^/]+\/chat-list$/,
        json: { conversations: [perEntityRow()], has_more: false, next_offset: null },
      },
    ]);
    install(server);

    const page = await readInboxPage({ povEntityId: 'user', limit: 1, offset: 0 });

    expect(page.source).toBe('per-entity');
    expect(page.globalUnsupported).toBe(true);
    expect(page.rows.map(row => row.participantKey)).toEqual(['user+e2']);
    // Per-entity pages signal "more" by returning a full page.
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(1);
    expect(page.archivedRows).toEqual([]);

    const call = server.lastCall('GET', /\/api\/entities\/[^/]+\/chat-list$/)!;
    expect(call.path).toBe('/api/entities/user/chat-list');
    expect(call.query).toEqual({ limit: '1', offset: '0' });
  });

  it('does not retry the unsupported global route once the caller has learned it', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /\/api\/entities\/[^/]+\/chat-list$/,
        json: { conversations: [], has_more: false, next_offset: null },
      },
    ]);
    install(server);

    await readInboxPage({ povEntityId: 'user', limit: 20, offset: 0 });
    const globalCallsAfterFirst = server.calls.filter(
      call => call.path === '/api/entities/chat-list',
    ).length;

    const page = await readInboxPage({
      povEntityId: 'user',
      limit: 20,
      offset: 20,
      preferGlobal: false,
    });

    expect(page.source).toBe('per-entity');
    expect(
      server.calls.filter(call => call.path === '/api/entities/chat-list').length,
    ).toBe(globalCallsAfterFirst);
  });

  it('does NOT swallow a real engine failure (only 404/unsupported falls back)', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/entities/chat-list',
        status: 500,
        json: { error: 'boom' },
      },
    ]);
    install(server);

    await expect(
      readInboxPage({ povEntityId: 'user', limit: 20, offset: 0 }),
    ).rejects.toThrow(/boom/);
  });
});

describe('planInboxRows — Phase-A filtering still applies on the global path', () => {
  const row = (over: Partial<PhoneConversationPageRow> = {}): PhoneConversationPageRow => ({
    interactionId: 'i1',
    interactionScope: 'private',
    participantKey: 'user+e2',
    participantIds: '["user","e2"]',
    lastMessage: null,
    unreadCount: 0,
    pinned: false,
    archived: false,
    ...over,
  });

  const known = new Set(['user', 'e2', 'e3', 'e4', 'e5']);

  it('drops a blocked partner but keeps a store-locked one visible', () => {
    const plans = planInboxRows(
      [
        row({ participantKey: 'user+e2' }),
        row({ participantKey: 'user+e3', participantIds: '["user","e3"]' }),
      ],
      'user',
      new Set(['e3']), // e3 blocked → hidden; e2 (locked) is not filtered
      known,
    );

    expect(plans.map(plan => plan.participantKey)).toEqual(['user+e2']);
    expect(plans[0].partnerEntityId).toBe('e2');
  });

  it('drops private rows whose partner entity no longer exists (deleted)', () => {
    const plans = planInboxRows(
      [row({ participantKey: 'user+gone', participantIds: '["user","gone"]' })],
      'user',
      new Set(),
      known,
    );
    expect(plans).toEqual([]);
  });

  it('drops group chats containing a blocked participant, collapses duplicate private rows', () => {
    const groupRow = (key: string, ids: string[]) =>
      row({
        interactionScope: 'group',
        participantKey: key,
        participantIds: JSON.stringify(ids),
      });
    const plans = planInboxRows(
      [
        groupRow('e2+e3+e4', ['user', 'e2', 'e3', 'e4']),
        groupRow('e2+e4+e5', ['user', 'e2', 'e4', 'e5']),
        // Group keys are NOT deduped client-side (both inbox routes dedupe in
        // SQL); only private rows are collapsed here.
        row({ participantKey: 'user+e2' }),
        row({ participantKey: 'user+e2' }),
      ],
      'user',
      new Set(['e3']), // e3 blocked → first group dropped
      known,
    );

    expect(plans.map(plan => plan.participantKey)).toEqual([
      'e2+e4+e5',
      'user+e2', // duplicate private rows collapse to one
    ]);
  });
});
