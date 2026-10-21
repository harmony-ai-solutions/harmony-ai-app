/**
 * ChatBackgroundService — per-entity background storage, file promotion and
 * dangling-ref self-healing.
 *
 * Storage seam: AsyncStorage keyed `@soulbits_chat_background_<entityId>`.
 * Profile images are refs by id; chat-history images are written to the
 * persistent document directory and referenced by path.
 */

import ChatBackgroundService, {
  CHAT_BACKGROUND_KEY_PREFIX,
  DEFAULT_CHAT_BACKGROUND_DIM,
} from '../ChatBackgroundService';
import {
  characterImageSource,
  getCachedImageBytes,
  getCharacterImagesMetadata,
} from '../engine/repositories/characters';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach(key => mockStore.delete(key));
    }),
    getAllKeys: jest.fn(async () => Array.from(mockStore.keys())),
    clear: jest.fn(async () => {
      mockStore.clear();
    }),
  },
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../engine/repositories/characters', () => ({
  // Stays the cheap liveness probe; renders never use the URL any more.
  characterImageSource: jest.fn((profileId: string, imageId: string) => ({
    uri: `http://127.0.0.1:2/api/character-profiles/${profileId}/images/${imageId}`,
    headers: {},
  })),
  // Display bytes resolve as a data URL, the same path as every other surface.
  getCachedImageBytes: jest.fn(),
  getCharacterImagesMetadata: jest.fn(),
}));

const RNFS = require('react-native-fs');

const mockCharacterImageSource = characterImageSource as jest.Mock;
const mockGetCachedImageBytes = getCachedImageBytes as jest.Mock;
const mockGetCharacterImagesMetadata = getCharacterImagesMetadata as jest.Mock;

const ENTITY = 'ent-1';
const KEY = `${CHAT_BACKGROUND_KEY_PREFIX}${ENTITY}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockGetCharacterImagesMetadata.mockResolvedValue([]);
  // The original path keeps its own mime (GIF/WebP stay animated).
  mockGetCachedImageBytes.mockResolvedValue({
    data: 'ORIGINAL_BASE64',
    contentType: 'image/gif',
  });
  (RNFS.exists as jest.Mock).mockResolvedValue(false);
});

describe('ChatBackgroundService — persistence', () => {
  it('defaults to no image and 40% dim', async () => {
    const record = await ChatBackgroundService.getChatBackgroundRecord(ENTITY);
    expect(record).toEqual({ ref: null, dim: DEFAULT_CHAT_BACKGROUND_DIM });
  });

  it('stores a profile ref by id (never a URL) and preserves dim', async () => {
    await ChatBackgroundService.setChatBackgroundDim(ENTITY, 65);
    await ChatBackgroundService.setChatBackgroundProfile(ENTITY, 'p1', 'img-9');

    const raw = JSON.parse(mockStore.get(KEY) as string);
    expect(raw).toEqual({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'img-9' },
      dim: 65,
    });
    expect(mockCharacterImageSource).not.toHaveBeenCalled();
  });

  it('writes chat-history base64 to a file and stores only the path', async () => {
    const path = await ChatBackgroundService.setChatBackgroundFromBase64(
      ENTITY,
      'QUJD',
      'image/png',
      'm-1',
    );

    expect(RNFS.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/chat-backgrounds\/ent-1_\d+_[a-z0-9]+\.png$/),
      'QUJD',
      'base64',
    );
    const raw = JSON.parse(mockStore.get(KEY) as string);
    expect(raw.ref.kind).toBe('file');
    expect(raw.ref.path).toBe(path);
    expect(raw.ref.mimeType).toBe('image/png');
    expect(raw.ref.messageId).toBe('m-1');
    expect(raw.ref.path).not.toContain('QUJD');
  });

  it('removes the previous managed file when the background is replaced', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    const first = await ChatBackgroundService.setChatBackgroundFromBase64(
      ENTITY,
      'FIRST',
      'image/jpeg',
    );
    (RNFS.unlink as jest.Mock).mockClear();

    const second = await ChatBackgroundService.setChatBackgroundFromBase64(
      ENTITY,
      'SECOND',
      'image/jpeg',
    );

    expect(RNFS.unlink).toHaveBeenCalledWith(first);
    expect(JSON.parse(mockStore.get(KEY) as string).ref.path).toBe(second);
  });

  it('records the new ref BEFORE unlinking the previous file (record-first)', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    const first = await ChatBackgroundService.setChatBackgroundFromBase64(
      ENTITY,
      'FIRST',
      'image/jpeg',
    );
    (RNFS.unlink as jest.Mock).mockClear();

    // Snapshot the persisted record at the moment the old file is deleted: a
    // crash between unlink and setItem must never be able to lose the image.
    let recordAtUnlink: { ref: { path: string } } | null = null;
    (RNFS.unlink as jest.Mock).mockImplementationOnce(async () => {
      recordAtUnlink = JSON.parse(mockStore.get(KEY) as string);
    });

    const second = await ChatBackgroundService.setChatBackgroundFromBase64(
      ENTITY,
      'SECOND',
      'image/jpeg',
    );

    expect(RNFS.unlink).toHaveBeenCalledWith(first);
    expect(recordAtUnlink).not.toBeNull();
    expect(recordAtUnlink!.ref.path).toBe(second);
  });

  it('keeps the previous file and record when the new record cannot be written', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    const first = await ChatBackgroundService.setChatBackgroundFromBase64(
      ENTITY,
      'FIRST',
      'image/jpeg',
    );
    const recordBefore = mockStore.get(KEY);
    (RNFS.unlink as jest.Mock).mockClear();

    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    const second = await ChatBackgroundService.setChatBackgroundFromBase64(
      ENTITY,
      'SECOND',
      'image/jpeg',
    );

    expect(second).toBeNull();
    // The stored record still points at the surviving first file.
    expect(mockStore.get(KEY)).toBe(recordBefore);
    expect(RNFS.unlink).not.toHaveBeenCalledWith(first);
  });

  it('clamps dim to 0–100 and keeps the ref', async () => {
    await ChatBackgroundService.setChatBackgroundProfile(ENTITY, 'p1', 'img-1');
    await ChatBackgroundService.setChatBackgroundDim(ENTITY, 240);
    expect(JSON.parse(mockStore.get(KEY) as string).dim).toBe(100);
    await ChatBackgroundService.setChatBackgroundDim(ENTITY, -5);
    expect(JSON.parse(mockStore.get(KEY) as string).dim).toBe(0);
    expect(JSON.parse(mockStore.get(KEY) as string).ref.imageId).toBe('img-1');
  });

  it('clears the image but keeps the chosen dim', async () => {
    await ChatBackgroundService.setChatBackgroundProfile(ENTITY, 'p1', 'img-1');
    await ChatBackgroundService.setChatBackgroundDim(ENTITY, 70);

    await ChatBackgroundService.clearChatBackground(ENTITY);

    expect(JSON.parse(mockStore.get(KEY) as string)).toEqual({
      ref: null,
      dim: 70,
    });
  });
});

describe('ChatBackgroundService — resolution and self-healing', () => {
  it('renders a profile ref from the byte cache as a data URL', async () => {
    await ChatBackgroundService.setChatBackgroundProfile(ENTITY, 'p1', 'img-1');
    mockGetCharacterImagesMetadata.mockResolvedValue([{ id: 'img-1' }]);

    const resolved = await ChatBackgroundService.loadChatBackground(ENTITY);

    // The URL builder is only the liveness probe; the render source is bytes.
    expect(mockCharacterImageSource).toHaveBeenCalledWith('p1', 'img-1');
    expect(mockGetCachedImageBytes).toHaveBeenCalledWith('p1', 'img-1', 'original');
    expect(resolved.source).toEqual({
      uri: 'data:image/gif;base64,ORIGINAL_BASE64',
    });
  });

  it('renders nothing for a profile ref whose bytes cannot be read, keeping the ref', async () => {
    await ChatBackgroundService.setChatBackgroundProfile(ENTITY, 'p1', 'img-1');
    mockGetCharacterImagesMetadata.mockResolvedValue([{ id: 'img-1' }]);
    mockGetCachedImageBytes.mockRejectedValueOnce(new Error('offline'));

    const resolved = await ChatBackgroundService.loadChatBackground(ENTITY);

    expect(resolved.source).toBeNull();
    expect(resolved.ref).toEqual({
      kind: 'profile',
      profileId: 'p1',
      imageId: 'img-1',
    });
  });

  it('renders nothing when the cache reports no bytes, keeping the ref', async () => {
    await ChatBackgroundService.setChatBackgroundProfile(ENTITY, 'p1', 'img-1');
    mockGetCharacterImagesMetadata.mockResolvedValue([{ id: 'img-1' }]);
    mockGetCachedImageBytes.mockResolvedValueOnce(null);

    const resolved = await ChatBackgroundService.loadChatBackground(ENTITY);

    expect(resolved.source).toBeNull();
    expect(JSON.parse(mockStore.get(KEY) as string).ref.imageId).toBe('img-1');
  });

  it('drops a profile ref whose image was deleted (keeps dim)', async () => {
    await ChatBackgroundService.setChatBackgroundProfile(ENTITY, 'p1', 'gone');
    await ChatBackgroundService.setChatBackgroundDim(ENTITY, 55);
    mockGetCharacterImagesMetadata.mockResolvedValue([{ id: 'other' }]);

    const resolved = await ChatBackgroundService.loadChatBackground(ENTITY);

    expect(resolved).toEqual({
      ref: null,
      dim: 55,
      source: null,
    });
    expect(JSON.parse(mockStore.get(KEY) as string).ref).toBeNull();
  });

  it('keeps a profile ref when the engine metadata read fails', async () => {
    await ChatBackgroundService.setChatBackgroundProfile(ENTITY, 'p1', 'img-1');
    mockGetCharacterImagesMetadata.mockRejectedValue(new Error('offline'));

    const resolved = await ChatBackgroundService.loadChatBackground(ENTITY);

    expect(resolved.source).not.toBeNull();
    expect(resolved.ref).toEqual({
      kind: 'profile',
      profileId: 'p1',
      imageId: 'img-1',
    });
  });

  it('drops a file ref whose file disappeared', async () => {
    await ChatBackgroundService.setChatBackgroundFromBase64(
      ENTITY,
      'QUJD',
      'image/jpeg',
    );
    (RNFS.exists as jest.Mock).mockResolvedValue(false);

    const resolved = await ChatBackgroundService.loadChatBackground(ENTITY);

    expect(resolved.ref).toBeNull();
    expect(JSON.parse(mockStore.get(KEY) as string).ref).toBeNull();
  });

  it('renders a surviving file ref as a file:// URI', async () => {
    const path = await ChatBackgroundService.setChatBackgroundFromBase64(
      ENTITY,
      'QUJD',
      'image/jpeg',
    );
    (RNFS.exists as jest.Mock).mockResolvedValue(true);

    const resolved = await ChatBackgroundService.loadChatBackground(ENTITY);

    expect(resolved.source).toEqual({ uri: `file://${path}` });
  });

  it('compare refs only match the same kind and id/path', () => {
    const profile = {
      kind: 'profile' as const,
      profileId: 'p1',
      imageId: 'i1',
    };
    expect(ChatBackgroundService.isSameBackgroundRef(profile, { ...profile })).toBe(true);
    expect(
      ChatBackgroundService.isSameBackgroundRef(profile, {
        ...profile,
        imageId: 'i2',
      }),
    ).toBe(false);
    expect(
      ChatBackgroundService.isSameBackgroundRef(profile, {
        kind: 'file',
        path: '/x',
        mimeType: 'image/jpeg',
      }),
    ).toBe(false);
  });
});
