/**
 * socialFixtures — seed data for the in-memory social stub backend.
 *
 * Visible in ALL builds (O5 ruling — stubs ship everywhere, no visibility
 * flag). 5–8 realistic stub users with posts, pre-seeded follows, image
 * comments, character/image like baselines and creator attribution rows, plus
 * the notification feed fixtures (welcome + marketplace/social events).
 *
 * Types are SELF-CONTAINED (no service imports) so the constants module stays
 * dependency-free. The block list deliberately starts EMPTY.
 */

export interface StubUserSeed {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  /** Initial-based avatar text (no image assets in the stub). */
  avatarText?: string;
  bio?: string;
  followerCount: number;
  followingCount: number;
}

export interface StubPostSeed {
  id: string;
  authorUserId: string;
  text: string;
  imageData?: string | null;
  imageMimeType?: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface StubImageCommentSeed {
  id: string;
  imageId: string;
  authorUserId: string;
  authorDisplayName: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  text: string;
}

export interface StubNotificationSeed {
  id: string;
  type:
    | 'welcome'
    | 'follow'
    | 'profile_like'
    | 'image_like'
    | 'image_comment'
    | 'post_like'
    | 'post_comment'
    | 'listing_sold'
    | 'listing_purchased';
  /** Null for system/automated notifications. */
  actorUserId: string | null;
  actorDisplayName: string;
  text: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  isRead: boolean;
}

export interface StubCharacterCreatorSeed {
  profileId: string;
  creatorUserId: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

// ── Users ─────────────────────────────────────────────────────────────────

export const SOCIAL_USERS: readonly StubUserSeed[] = [
  {
    id: 'user-aurora',
    displayName: 'Aurora Vale',
    avatarText: 'AV',
    bio: 'Moonlit oracle & dream artist',
    followerCount: 1284,
    followingCount: 56,
  },
  {
    id: 'user-ryo',
    displayName: 'Ryo Tanaka',
    avatarText: 'RT',
    bio: 'Ember samurai storyteller',
    followerCount: 956,
    followingCount: 32,
  },
  {
    id: 'user-elara',
    displayName: 'Elara Finch',
    avatarText: 'EF',
    bio: 'Weaving dreams into words',
    followerCount: 2210,
    followingCount: 84,
  },
  {
    id: 'user-owen',
    displayName: 'Owen Clarke',
    avatarText: 'OC',
    bio: 'Professor of clockwork mysteries',
    followerCount: 640,
    followingCount: 121,
  },
  {
    id: 'user-serein',
    displayName: 'Serein Moss',
    avatarText: 'SM',
    bio: 'Gardener of glass and light',
    followerCount: 312,
    followingCount: 17,
  },
  {
    id: 'user-iris',
    displayName: 'Iris Blackwood',
    avatarText: 'IB',
    bio: 'Poet of shadow and silence',
    followerCount: 1788,
    followingCount: 43,
  },
  {
    id: 'user-mina',
    displayName: 'Mina Alvarez',
    avatarText: 'MA',
    bio: 'Cooking warmth into every chat',
    followerCount: 503,
    followingCount: 29,
  },
];

// ── Posts (community feed) ────────────────────────────────────────────────

export const SOCIAL_POSTS: readonly StubPostSeed[] = [
  {
    id: 'post-1',
    authorUserId: 'user-aurora',
    text: 'Releasing a new oracle this week — Luna has been whispering all the right things.',
    createdAt: '2026-08-20T10:00:00.000Z',
  },
  {
    id: 'post-2',
    authorUserId: 'user-ryo',
    text: 'Kai\'s dojo is open. Bring your best questions and your worst excuses.',
    createdAt: '2026-08-21T14:30:00.000Z',
  },
  {
    id: 'post-3',
    authorUserId: 'user-elara',
    text: 'Dream journaling prompt: what does your ideal morning look like?',
    createdAt: '2026-08-22T08:15:00.000Z',
  },
  {
    id: 'post-4',
    authorUserId: 'user-owen',
    text: 'The clockwork academy gates open at dusk. Enrollment is free; patience is required.',
    createdAt: '2026-08-23T18:45:00.000Z',
  },
  {
    id: 'post-5',
    authorUserId: 'user-serein',
    text: 'The glass garden blooms at midnight. Come say hello — the flowers listen.',
    createdAt: '2026-08-24T23:20:00.000Z',
  },
  {
    id: 'post-6',
    authorUserId: 'user-mina',
    text: 'Saffron\'s kitchen is testing a new recipe — taste testers welcome, aprons provided.',
    createdAt: '2026-08-25T07:05:00.000Z',
  },
  {
    id: 'post-7',
    authorUserId: 'user-iris',
    text: 'Silence is a language too. Nyx translates.',
    createdAt: '2026-08-25T09:40:00.000Z',
  },
];

// ── Pre-seeded follows (the local user follows these cloud users) ─────────

export const SOCIAL_FOLLOW_SEED: readonly string[] = ['user-serein', 'user-iris'];

// ── Image comments on gallery images (posts) ──────────────────────────────

export const SOCIAL_IMAGE_COMMENTS: readonly StubImageCommentSeed[] = [
  {
    id: 'imgc-1',
    imageId: 'img-aurora-1',
    authorUserId: 'user-ryo',
    authorDisplayName: 'Ryo Tanaka',
    createdAt: '2026-08-21T11:10:00.000Z',
    text: 'The moonstone palette is stunning.',
  },
  {
    id: 'imgc-2',
    imageId: 'img-aurora-1',
    authorUserId: 'user-elara',
    authorDisplayName: 'Elara Finch',
    createdAt: '2026-08-22T09:05:00.000Z',
    text: 'I can almost hear her voice. Beautiful work.',
  },
];

// ── Character / image like baselines (community counts) ───────────────────

export const SOCIAL_CHARACTER_LIKE_COUNTS: Record<string, number> = {
  'char-luna': 128,
  'char-kai': 86,
  'char-mira': 203,
  'char-nyx': 342,
  'char-echo': 512,
};

export const SOCIAL_IMAGE_LIKE_COUNTS: Record<string, number> = {
  'img-aurora-1': 45,
  'img-aurora-2': 12,
  'img-ryo-1': 67,
  'img-elara-1': 98,
};

// ── Character display names (saved-entries fallback registry) ─────────────

export const SOCIAL_CHARACTER_NAMES: Record<string, string> = {
  'char-luna': 'Luna — Moonlit Oracle',
  'char-kai': 'Kai the Ember Samurai',
  'char-mira': 'Mira — Dream Weaver',
  'char-nyx': 'Nyx, Silent Sentinel',
  'char-echo': 'Companion: Echo',
};

export const SOCIAL_CHARACTER_AVATAR_TEXT: Record<string, string> = {
  'char-luna': 'LU',
  'char-kai': 'KA',
  'char-mira': 'MI',
  'char-nyx': 'NY',
  'char-echo': 'EC',
};

// ── Creator attribution rows (until V3-authorship derivation lands) ───────

export const SOCIAL_CHARACTER_CREATORS: readonly StubCharacterCreatorSeed[] = [
  { profileId: 'char-kai', creatorUserId: 'user-ryo', createdAt: '2026-08-01T10:00:00.000Z' },
  { profileId: 'char-nyx', creatorUserId: 'user-iris', createdAt: '2026-08-02T10:00:00.000Z' },
];

// ── Notifications feed (welcome + marketplace/social events) ──────────────

export const SOCIAL_NOTIFICATIONS: readonly StubNotificationSeed[] = [
  {
    id: 'notif-welcome',
    type: 'welcome',
    actorUserId: null,
    actorDisplayName: 'Harmony',
    text: 'Welcome to Harmony! Your marketplace, wallet and community feed are ready.',
    createdAt: '2026-08-20T09:00:00.000Z',
    isRead: false,
  },
  {
    id: 'notif-follow-aurora',
    type: 'follow',
    actorUserId: 'user-aurora',
    actorDisplayName: 'Aurora Vale',
    text: 'Aurora Vale started following you',
    createdAt: '2026-08-21T11:00:00.000Z',
    isRead: false,
  },
  {
    id: 'notif-image-comment',
    type: 'image_comment',
    actorUserId: 'user-ryo',
    actorDisplayName: 'Ryo Tanaka',
    text: 'Ryo Tanaka commented on your AI image',
    createdAt: '2026-08-22T13:00:00.000Z',
    isRead: false,
  },
  {
    id: 'notif-listing-sold',
    type: 'listing_sold',
    actorUserId: null,
    actorDisplayName: 'Marketplace',
    text: 'Your listing "Companion: Echo" was acquired — 0 souls to you, many smiles to them.',
    createdAt: '2026-08-23T15:00:00.000Z',
    isRead: true,
  },
  {
    id: 'notif-listing-purchased',
    type: 'listing_purchased',
    actorUserId: null,
    actorDisplayName: 'Marketplace',
    text: 'You acquired "Professor Wren" from Owen Clarke. It is now in your library.',
    createdAt: '2026-08-24T17:00:00.000Z',
    isRead: true,
  },
];