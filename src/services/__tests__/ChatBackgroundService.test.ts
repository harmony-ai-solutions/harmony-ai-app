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
  characterImageSource: jest.fn((profileId: string, imageId: string) => ({
    uri: `http://127.0.0.1:2/api/character-profiles/${profileId}/images/${imageId}`,
    headers: {},
  })),
  getCharacterImagesMetadata: jest.fn(),
}));

const RNFS = require('react-native-fs');

const mockCharacterImageSource = characterImageSource as jest.Mock;
const mockGetCharacterImagesMetadata = getCharacterImagesMetadata as jest.Mock;

const ENTITY = 'ent-1';
const KEY = `${CHAT_BACKGROUND_KEY_PREFIX}${ENTITY}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockGetCharacterImagesMetadata.mockResolvedValue([]);
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
      expect.stringMatching(/chat-backgrounds\/ent-1_\d+\.png$/),
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
  it('rebuilds a profile URL from the stored id', async () => {
    await ChatBackgroundService.setChatBackgroundProfile(ENTITY, 'p1', 'img-1');
    mockGetCharacterImagesMetadata.mockResolvedValue([{ id: 'img-1' }]);

    const resolved = await ChatBackgroundService.loadChatBackground(ENTITY);

    expect(mockCharacterImageSource).toHaveBeenCalledWith('p1', 'img-1');
    expect(resolved.source).toEqual({
      uri: 'http://127.0.0.1:2/api/character-profiles/p1/images/img-1',
      headers: {},
    });
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
