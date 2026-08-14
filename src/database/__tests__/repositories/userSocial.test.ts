/**
 * User Social Repository Tests
 *
 * Verifies the client-only posts, follows & notifications layer:
 *   - user posts (create / get / delete + image data URL)
 *   - post likes (toggle / counts)
 *   - post comments (add / list / delete / count)
 *   - follows (follow / unfollow / list)
 *   - notifications (add / list / unread count / mark read)
 */

import { useFreshDatabase } from '../repositoryFixtures';
import {
  createUserPost,
  getUserPost,
  getUserPostsByAuthor,
  getMyUserPosts,
  getAllUserPosts,
  deleteUserPost,
  isPostLiked,
  addPostLike,
  removePostLike,
  togglePostLike,
  getPostLikesCount,
  addPostComment,
  getPostComments,
  deletePostComment,
  getPostCommentsCount,
  isFollowing,
  addFollow,
  removeFollow,
  getFollowedUsers,
  addNotification,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../../repositories/userSocial';

describe('user social repository', () => {
  useFreshDatabase();

  describe('user posts', () => {
    it('creates and reads back a text post', async () => {
      const created = await createUserPost({
        authorUserId: 'u1',
        authorDisplayName: 'Alice',
        authorAvatarUrl: null,
        text: 'Hello world',
      });
      expect(created.id).toBeTruthy();
      expect(created.authorDisplayName).toBe('Alice');

      const fetched = await getUserPost(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.text).toBe('Hello world');
    });

    it('creates an image post with a data URL', async () => {
      const created = await createUserPost({
        authorUserId: 'u1',
        authorDisplayName: 'Alice',
        authorAvatarUrl: null,
        text: '',
        imageData: 'iVBORw0KGgo',
        imageMimeType: 'image/png',
      });
      expect(created.imageDataUrl).toContain('data:image/png;base64,');
    });

    it('lists posts per author newest-first', async () => {
      await createUserPost({ authorUserId: 'u1', authorDisplayName: 'Alice', authorAvatarUrl: null, text: 'one' });
      await createUserPost({ authorUserId: 'u1', authorDisplayName: 'Alice', authorAvatarUrl: null, text: 'two' });
      await createUserPost({ authorUserId: 'u2', authorDisplayName: 'Bob', authorAvatarUrl: null, text: 'bob' });

      const mine = await getMyUserPosts('u1');
      expect(mine).toHaveLength(2);
      expect(mine[0].text).toBe('two'); // newest first

      const all = await getAllUserPosts();
      expect(all).toHaveLength(3);
    });

    it('deletes a post', async () => {
      const created = await createUserPost({ authorUserId: 'u1', authorDisplayName: 'Alice', authorAvatarUrl: null, text: 'x' });
      await deleteUserPost(created.id);
      expect(await getUserPost(created.id)).toBeNull();
    });
  });

  describe('post likes', () => {
    it('toggles like state and counts', async () => {
      const post = await createUserPost({ authorUserId: 'u1', authorDisplayName: 'Alice', authorAvatarUrl: null, text: 'hi' });
      expect(await isPostLiked(post.id)).toBe(false);

      expect(await togglePostLike(post.id)).toBe(true);
      expect(await isPostLiked(post.id)).toBe(true);
      expect(await getPostLikesCount(post.id)).toBe(1);

      expect(await togglePostLike(post.id)).toBe(false);
      expect(await getPostLikesCount(post.id)).toBe(0);

      await addPostLike(post.id);
      await addPostLike(post.id); // idempotent
      expect(await getPostLikesCount(post.id)).toBe(1);
      await removePostLike(post.id);
      expect(await getPostLikesCount(post.id)).toBe(0);
    });
  });

  describe('post comments', () => {
    it('adds, lists, counts and deletes comments', async () => {
      const post = await createUserPost({ authorUserId: 'u1', authorDisplayName: 'Alice', authorAvatarUrl: null, text: 'post' });
      const c1 = await addPostComment({
        postId: post.id,
        authorUserId: 'u2',
        authorDisplayName: 'Bob',
        authorAvatarUrl: null,
        text: 'nice!',
      });
      await addPostComment({
        postId: post.id,
        authorUserId: 'u3',
        authorDisplayName: 'Carol',
        authorAvatarUrl: null,
        text: 'agree',
      });

      const list = await getPostComments(post.id);
      expect(list).toHaveLength(2);
      expect(list[0].text).toBe('nice!');
      expect(await getPostCommentsCount(post.id)).toBe(2);

      await deletePostComment(c1.id);
      expect(await getPostCommentsCount(post.id)).toBe(1);
    });
  });

  describe('follows', () => {
    it('follows, checks, unfollows and lists', async () => {
      expect(await isFollowing('creator-1')).toBe(false);
      await addFollow({ targetUserId: 'creator-1', targetDisplayName: 'Creator One', targetAvatarUrl: null });
      expect(await isFollowing('creator-1')).toBe(true);

      const followed = await getFollowedUsers();
      expect(followed).toHaveLength(1);
      expect(followed[0].targetUserId).toBe('creator-1');

      await removeFollow('creator-1');
      expect(await isFollowing('creator-1')).toBe(false);
    });
  });

  describe('notifications', () => {
    it('adds, lists and counts unread notifications', async () => {
      await addNotification({
        recipientUserId: 'me',
        actorUserId: 'someone',
        actorDisplayName: 'Someone',
        actorAvatarUrl: null,
        type: 'follow',
      });
      await addNotification({
        recipientUserId: 'me',
        actorUserId: 'liker',
        actorDisplayName: 'Liker',
        actorAvatarUrl: null,
        type: 'post_like',
      });

      const list = await getNotifications('me');
      expect(list).toHaveLength(2);
      expect(list[0].type).toBe('post_like'); // newest first
      expect(await getUnreadNotificationCount('me')).toBe(2);
    });

    it('marks notifications read', async () => {
      const n = await addNotification({
        recipientUserId: 'me2',
        actorUserId: 'x',
        actorDisplayName: 'X',
        actorAvatarUrl: null,
        type: 'image_comment',
      });
      await markNotificationRead(n.id);
      expect(await getUnreadNotificationCount('me2')).toBe(0);

      await addNotification({
        recipientUserId: 'me2',
        actorUserId: 'y',
        actorDisplayName: 'Y',
        actorAvatarUrl: null,
        type: 'post_comment',
      });
      await markAllNotificationsRead('me2');
      expect(await getUnreadNotificationCount('me2')).toBe(0);
    });
  });
});
