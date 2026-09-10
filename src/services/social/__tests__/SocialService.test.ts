/**
 * SocialService + socialStubBackend + pure block filters tests.
 *
 * Covers:
 *   - profiles & follows (getPublicUserProfile, toggleFollow, isFollowing,
 *     getFollowedUsers)
 *   - posts (feed order, author filter, create/delete, post likes, comments)
 *   - character social (like/save toggles + counts, saved entries)
 *   - image social (like toggle + counts, comments CRUD)
 *   - block list (starts empty, block drops follow, unblock restores)
 *   - the three PURE filters in src/utils/blockedContentFilters.ts against
 *     plain arrays (no DB)
 *   - creator attribution (set/get/isCharacterCreator)
 *
 * Mocks `src/services/stub/stubBackendUtils` so latency is instant
 * (deviceAuth.test.ts pattern). The social backend is a module-level
 * singleton — `__resetForTests()` runs in beforeEach for order independence.
 */

// Mock the logger so it doesn't emit after tests finish.
jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock the stub backend utils: instant latency.
jest.mock('../../stub/stubBackendUtils', () => {
  const simulateLatency = jest.fn(async () => {});
  const simulateTransientFailure = jest.fn(() => false);
  return {
    simulateLatency,
    simulateTransientFailure,
    __simulateLatency: simulateLatency,
    __simulateTransientFailure: simulateTransientFailure,
  };
});

import * as SocialService from '../SocialService';
import * as SocialBackend from '../socialStubBackend';
import { SocialError } from '../../stub/StubServiceError';
import {
  filterBlockedCharacterProfiles,
  filterBlockedUserPosts,
  filterBlockedUserNotifications,
} from '../../../utils/blockedContentFilters';

beforeEach(() => {
  SocialBackend.__resetForTests();
});

describe('SocialService — profiles & follows', () => {
  it('getPublicUserProfile returns a seeded fixture profile', async () => {
    const profile = await SocialService.getPublicUserProfile('user-aurora');
    expect(profile.id).toBe('user-aurora');
    expect(profile.displayName).toBe('Aurora Vale');
    expect(profile.followerCount).toBeGreaterThan(0);
  });

  it('getPublicUserProfile throws SocialError 404 for unknown users', async () => {
    let err: unknown;
    try {
      await SocialService.getPublicUserProfile('user-ghost');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SocialError);
    expect((err as SocialError).status).toBe(404);
    expect((err as SocialError).code).toBe('not_found');
  });

  it('toggleFollow flips state and getFollowedUsers reflects it', async () => {
    expect(await SocialService.isFollowing('user-ryo')).toBe(false);

    expect(await SocialService.toggleFollow('user-ryo')).toBe(true);
    expect(await SocialService.isFollowing('user-ryo')).toBe(true);
    const followed = await SocialService.getFollowedUsers();
    expect(followed.some(u => u.id === 'user-ryo')).toBe(true);

    expect(await SocialService.toggleFollow('user-ryo')).toBe(false);
    expect(await SocialService.isFollowing('user-ryo')).toBe(false);
  });

  it('getFollowedUsers starts with the seeded follows', async () => {
    const followed = await SocialService.getFollowedUsers();
    const ids = followed.map(u => u.id).sort();
    expect(ids).toEqual(['user-iris', 'user-serein']);
  });

  it('toggleFollow throws SocialError 404 for unknown users', async () => {
    await expect(SocialService.toggleFollow('user-ghost')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('SocialService — posts (community feed)', () => {
  it('getPosts returns the seeded feed, newest first', async () => {
    const posts = await SocialService.getPosts();
    expect(posts.length).toBeGreaterThanOrEqual(5);
    const times = posts.map(p => new Date(p.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(posts[0].id).toBe('post-7');
    expect(posts[0]).toMatchObject({
      authorUserId: 'user-iris',
      likeCount: 0,
      commentCount: 0,
    });
  });

  it('getPosts filters by author', async () => {
    const posts = await SocialService.getPosts({ authorId: 'user-aurora' });
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts.every(p => p.authorUserId === 'user-aurora')).toBe(true);
  });

  it('createPost appends to the feed', async () => {
    const post = await SocialService.createPost({ text: 'Hello community!' });
    expect(post.text).toBe('Hello community!');
    expect(post.authorUserId).toBe('local-user');

    const feed = await SocialService.getPosts();
    expect(feed.some(p => p.id === post.id)).toBe(true);
  });

  it('deletePost removes a post', async () => {
    const post = await SocialService.createPost({ text: 'Temporary post' });
    await SocialService.deletePost(post.id);
    expect((await SocialService.getPosts()).some(p => p.id === post.id)).toBe(false);
  });

  it('deletePost throws SocialError 404 for unknown posts', async () => {
    await expect(SocialService.deletePost('missing-post')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('togglePostLike flips the like and updates likeCount', async () => {
    const first = (await SocialService.getPosts())[0];
    expect(await SocialService.togglePostLike(first.id)).toBe(true);
    const liked = (await SocialService.getPosts()).find(p => p.id === first.id)!;
    expect(liked.likeCount).toBe(1);
    expect(await SocialService.togglePostLike(first.id)).toBe(false);
  });

  it('post comments CRUD', async () => {
    const post = (await SocialService.getPosts())[0];
    const comment = await SocialService.addPostComment({ postId: post.id, text: 'Nice!' });
    expect(comment.postId).toBe(post.id);

    const comments = await SocialService.getPostComments(post.id);
    expect(comments.some(c => c.id === comment.id)).toBe(true);

    await SocialService.deletePostComment(comment.id);
    expect(
      (await SocialService.getPostComments(post.id)).some(c => c.id === comment.id),
    ).toBe(false);
  });
});

describe('SocialService — character social', () => {
  it('like/save toggles + saved entries', async () => {
    expect(await SocialService.isCharacterLiked('char-luna')).toBe(false);
    expect(await SocialService.toggleCharacterLike('char-luna')).toBe(true);
    expect(await SocialService.isCharacterLiked('char-luna')).toBe(true);
    expect(await SocialService.toggleCharacterLike('char-luna')).toBe(false);

    expect(await SocialService.toggleCharacterSave('char-luna')).toBe(true);
    const saved = await SocialService.getSavedCharacterEntries();
    expect(saved.some(e => e.profileId === 'char-luna')).toBe(true);
    expect(saved.find(e => e.profileId === 'char-luna')?.name).toBe('Luna — Moonlit Oracle');

    expect(await SocialService.toggleCharacterSave('char-luna')).toBe(false);
    expect(
      (await SocialService.getSavedCharacterEntries()).some(e => e.profileId === 'char-luna'),
    ).toBe(false);
  });

  it('getCharacterLikesCount is the seeded baseline + the local like', async () => {
    const before = await SocialService.getCharacterLikesCount('char-luna');
    expect(before).toBe(128);
    await SocialService.toggleCharacterLike('char-luna');
    expect(await SocialService.getCharacterLikesCount('char-luna')).toBe(before + 1);
    await SocialService.toggleCharacterLike('char-luna');
    expect(await SocialService.getCharacterLikesCount('char-luna')).toBe(before);
  });
});

describe('SocialService — image social (gallery images as posts)', () => {
  it('toggleImageLike flips the like and updates the count', async () => {
    const before = await SocialService.getImageLikesCount('img-aurora-1');
    expect(before).toBe(45);
    expect(await SocialService.toggleImageLike('img-aurora-1')).toBe(true);
    expect(await SocialService.getImageLikesCount('img-aurora-1')).toBe(before + 1);
    expect(await SocialService.toggleImageLike('img-aurora-1')).toBe(false);
    expect(await SocialService.getImageLikesCount('img-aurora-1')).toBe(before);
  });

  it('image comments CRUD (seeded + added + deleted)', async () => {
    expect((await SocialService.getImageComments('img-aurora-1')).length).toBe(2);

    const comment = await SocialService.addImageComment({
      imageId: 'img-aurora-1',
      text: 'Gorgeous!',
    });
    const comments = await SocialService.getImageComments('img-aurora-1');
    expect(comments.some(c => c.id === comment.id)).toBe(true);
    expect(comments[comments.length - 1].authorDisplayName).toBe('You');

    await SocialService.deleteImageComment(comment.id);
    expect(
      (await SocialService.getImageComments('img-aurora-1')).some(c => c.id === comment.id),
    ).toBe(false);
  });
});

describe('SocialService — block list', () => {
  it('starts empty', async () => {
    expect((await SocialService.getBlockedUserIds()).size).toBe(0);
  });

  it('blockUser adds to the set and drops any existing follow', async () => {
    await SocialService.toggleFollow('user-ryo');
    expect(await SocialService.isFollowing('user-ryo')).toBe(true);

    await SocialService.blockUser('user-ryo');
    const blocked = await SocialService.getBlockedUserIds();
    expect(blocked.has('user-ryo')).toBe(true);
    expect(await SocialService.isFollowing('user-ryo')).toBe(false);
  });

  it('unblockUser restores the user', async () => {
    await SocialService.blockUser('user-ryo');
    await SocialService.unblockUser('user-ryo');
    expect((await SocialService.getBlockedUserIds()).has('user-ryo')).toBe(false);
  });

  it('blockUser throws SocialError 404 for unknown users', async () => {
    await expect(SocialService.blockUser('user-ghost')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('blockedContentFilters — pure filters (no DB)', () => {
  it('filterBlockedCharacterProfiles drops {id} and {profile:{id}} shapes', () => {
    const items = [
      { id: 'p1' },
      { id: 'p2' },
      { profile: { id: 'p1' } },
      { profile: { id: 'p3' } },
    ];
    const result = filterBlockedCharacterProfiles(items, new Set(['p1']));
    expect(result).toEqual([{ id: 'p2' }, { profile: { id: 'p3' } }]);
  });

  it('filterBlockedUserPosts drops posts by blocked authors, keeps author-less posts', () => {
    const posts = [
      { id: '1', authorUserId: 'u1', text: 'blocked author' },
      { id: '2', authorUserId: null, text: 'system post' },
      { id: '3', authorUserId: 'u2', text: 'fine' },
    ];
    const result = filterBlockedUserPosts(posts, new Set(['u1']));
    expect(result.map(p => p.id)).toEqual(['2', '3']);
  });

  it('filterBlockedUserNotifications drops actor-notifications from blocked users', () => {
    const items = [
      { id: 'n1', actorUserId: 'u1' },
      { id: 'n2', actorUserId: null },
      { id: 'n3', actorUserId: 'u3' },
    ];
    const result = filterBlockedUserNotifications(items, new Set(['u1']));
    expect(result.map(n => n.id)).toEqual(['n2', 'n3']);
  });

  it('empty blocked set returns the input unchanged', () => {
    const profiles = [{ id: 'a' }, { id: 'b' }];
    const posts = [{ id: '1', authorUserId: null }];
    const notifications = [{ id: 'n1', actorUserId: null }];
    expect(filterBlockedCharacterProfiles(profiles, new Set())).toBe(profiles);
    expect(filterBlockedUserPosts(posts, new Set())).toBe(posts);
    expect(filterBlockedUserNotifications(notifications, new Set())).toBe(notifications);
  });
});

describe('SocialService — creators (attribution)', () => {
  it('seeded creator rows are readable', async () => {
    const creator = await SocialService.getCharacterCreator('char-kai');
    expect(creator).not.toBeNull();
    expect(creator!.creatorUserId).toBe('user-ryo');
    expect(creator!.creatorDisplayName).toBe('Ryo Tanaka');
  });

  it('setCharacterCreator / getCharacterCreator / isCharacterCreator round-trip', async () => {
    await SocialService.setCharacterCreator({ profileId: 'char-luna', userId: 'user-aurora' });

    const creator = await SocialService.getCharacterCreator('char-luna');
    expect(creator?.creatorUserId).toBe('user-aurora');
    expect(creator?.creatorDisplayName).toBe('Aurora Vale');

    expect(await SocialService.isCharacterCreator('char-luna', 'user-aurora')).toBe(true);
    expect(await SocialService.isCharacterCreator('char-luna', 'user-other')).toBe(false);
    expect(await SocialService.isCharacterCreator('char-luna', null)).toBe(false);
  });

  it('getCharacterCreator returns null when no creator is recorded', async () => {
    expect(await SocialService.getCharacterCreator('char-unknown')).toBeNull();
  });
});