/**
 * Character-categories repository adapter — unit tests (engine step 5,
 * "path b"): the synced category tables are the source of truth and every
 * write goes through the engine management routes.
 */

jest.mock('../../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { engineApiClient } from '../../EngineApiClient';
import { resetEngineServiceForTests, setEngineConnection } from '../../EngineService';
import { createMockManagementServer } from '../../__tests__/mockManagementServer';
import * as categoriesRepo from '../characterCategories';

const CONN = {
  wsPort: 1,
  wssPort: 0,
  adminPort: 3,
  bind: '127.0.0.1',
  pid: 1,
  dataDir: '',
  token: 'tok',
};

/** One wire row exactly as `GET /api/character-categories` returns it. */
const categoryRow = (over: Record<string, unknown> = {}) => ({
  id: 'cat-1',
  name: 'Heroes',
  sort_order: 0,
  created_at: '2026-10-12T09:00:00Z',
  updated_at: '2026-10-12T10:00:00Z',
  member_count: 2,
  profile_ids: ['p1', 'p2'],
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

describe('character categories repo — reads', () => {
  it('maps the list to domain rows in engine (sort_order) order', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/character-categories',
        json: [
          categoryRow({ id: 'cat-2', name: 'Villains', sort_order: 1, member_count: 0, profile_ids: [] }),
          categoryRow(),
        ],
      },
    ]);
    install(server);

    const categories = await categoriesRepo.listCharacterCategories();
    expect(categories.map(c => c.id)).toEqual(['cat-1', 'cat-2']);
    expect(categories[0]).toMatchObject({
      name: 'Heroes',
      sort_order: 0,
      member_count: 2,
      profile_ids: ['p1', 'p2'],
    });
    expect(categories[0].updated_at).toBeInstanceOf(Date);
  });

  it('normalizes a null list (Go marshals an empty slice as null)', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/character-categories', json: null },
    ]);
    install(server);

    expect(await categoriesRepo.listCharacterCategories()).toEqual([]);
  });

  it('builds the categoryId → member set map from one read', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/character-categories', json: [categoryRow()] },
    ]);
    install(server);

    const map = await categoriesRepo.getCharacterCategoryMemberMap();
    expect([...(map.get('cat-1') ?? [])]).toEqual(['p1', 'p2']);
    expect(server.calls).toHaveLength(1);
  });

  it('resolves the category ids a profile belongs to (membership rows only)', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/character-categories',
        json: [
          categoryRow(),
          categoryRow({ id: 'cat-3', name: 'Mages', sort_order: 1, profile_ids: ['p9'] }),
        ],
      },
    ]);
    install(server);

    expect(await categoriesRepo.getCategoryIdsForProfile('p2')).toEqual(['cat-1']);
    expect(await categoriesRepo.getCategoryIdsForProfile('p9')).toEqual(['cat-3']);
    expect(await categoriesRepo.getCategoryIdsForProfile('nobody')).toEqual([]);
  });
});

describe('character categories repo — writes', () => {
  it('create posts the trimmed name and maps the returned row', async () => {
    const server = createMockManagementServer([
      { method: 'POST', path: '/api/character-categories', json: categoryRow({ name: 'Heroes' }) },
    ]);
    install(server);

    const created = await categoriesRepo.createCharacterCategory('  Heroes  ');
    expect(created.id).toBe('cat-1');
    expect(server.lastCall('POST', '/api/character-categories')?.body).toEqual({
      name: 'Heroes',
    });
  });

  it('rename patches the id-scoped route (membership follows the row)', async () => {
    const server = createMockManagementServer([
      {
        method: 'PATCH',
        path: /^\/api\/character-categories\/[^/]+$/,
        json: categoryRow({ name: 'Protagonists' }),
      },
    ]);
    install(server);

    const renamed = await categoriesRepo.renameCharacterCategory('cat-1', ' Protagonists ');
    expect(renamed.name).toBe('Protagonists');
    const call = server.lastCall('PATCH', /^\/api\/character-categories\/[^/]+$/);
    expect(call?.path).toBe('/api/character-categories/cat-1');
    expect(call?.body).toEqual({ name: 'Protagonists' });
  });

  it('delete hits DELETE /:id', async () => {
    const server = createMockManagementServer([
      {
        method: 'DELETE',
        path: /^\/api\/character-categories\/[^/]+$/,
        json: { status: 'category deleted', id: 'cat-1' },
      },
    ]);
    install(server);

    await categoriesRepo.deleteCharacterCategory('cat-1');
    expect(server.lastCall('DELETE', '/api/character-categories/cat-1')).toBeDefined();
  });

  it('reorder posts the full ordered id list', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/character-categories/reorder',
        json: [categoryRow({ sort_order: 0 }), categoryRow({ id: 'cat-2', sort_order: 1 })],
      },
    ]);
    install(server);

    const reordered = await categoriesRepo.reorderCharacterCategories(['cat-1', 'cat-2']);
    expect(reordered.map(c => c.id)).toEqual(['cat-1', 'cat-2']);
    expect(server.lastCall('POST', '/api/character-categories/reorder')?.body).toEqual({
      ordered_ids: ['cat-1', 'cat-2'],
    });
  });

  it('membership add posts the UNION of the engine set and the new profile', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/character-categories', json: [categoryRow()] },
      {
        method: 'POST',
        path: /^\/api\/character-categories\/[^/]+\/members$/,
        json: categoryRow({ member_count: 3, profile_ids: ['p1', 'p2', 'p3'] }),
      },
    ]);
    install(server);

    await categoriesRepo.setProfileCategoryMembership('cat-1', 'p3', true);

    // The POST carries the engine's existing members too — a "complete set"
    // write must never drop memberships learned from another device.
    expect(
      server.lastCall('POST', '/api/character-categories/cat-1/members')?.body,
    ).toEqual({ profile_ids: ['p1', 'p2', 'p3'] });
  });

  it('membership add is a no-op when the profile is already a member', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/character-categories', json: [categoryRow()] },
    ]);
    install(server);

    await categoriesRepo.setProfileCategoryMembership('cat-1', 'p1', true);

    expect(server.calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });

  it('membership removal deletes the single junction row', async () => {
    const server = createMockManagementServer([
      {
        method: 'DELETE',
        path: /^\/api\/character-categories\/[^/]+\/members\/[^/]+$/,
        json: { status: 'member removed', category_id: 'cat-1', profile_id: 'p1' },
      },
    ]);
    install(server);

    await categoriesRepo.setProfileCategoryMembership('cat-1', 'p1', false);

    expect(
      server.lastCall('DELETE', '/api/character-categories/cat-1/members/p1'),
    ).toBeDefined();
  });

  it('an absent category surfaces the 404 instead of silently succeeding', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/character-categories', json: [] },
    ]);
    install(server);

    await expect(
      categoriesRepo.setProfileCategoryMembership('missing', 'p1', true),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('maps the engine 409 to the name-taken predicate', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/character-categories',
        status: 409,
        json: { error: 'category name is already in use' },
      },
    ]);
    install(server);

    const error = await categoriesRepo.createCharacterCategory('Heroes').catch(e => e);
    expect(categoriesRepo.isCategoryNameTakenError(error)).toBe(true);
    expect(categoriesRepo.isCategoryNameTakenError(new Error('nope'))).toBe(false);
  });
});
