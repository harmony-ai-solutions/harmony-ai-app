/**
 * AIProfileScreen gallery-tile bytes (contract 1.8.0 tri-state).
 *
 * The tile renders DISPLAY bytes as a data URL — never a URL + `source.headers`
 * Image source, which the Fabric loader cannot authenticate (owner device,
 * Android 15, 2026-10-21). The decision the screen must still get right is
 * which variant it asks the byte cache for:
 *   ready / pending (legacy backfill) → thumb
 *   unavailable                        → original
 *   field absent (older engine)        → the legacy `has_thumbnail` flag
 *
 * A full render is covered elsewhere only for simpler screens; this pins the
 * screen's exported tile helper while the widget wrappers are stubbed.
 */

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: jest.fn(),
}));
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));
jest.mock('../../contexts/AppToastContext', () => ({
  useToast: jest.fn(),
}));
jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: jest.fn(),
}));
jest.mock('../../services/social/SocialService', () => ({}));
jest.mock('../../services/CharacterChatService', () => ({
  openCharacterChat: jest.fn(),
}));
jest.mock('../../services/marketplace/MarketplaceService', () => ({
  getListingForProfile: jest.fn().mockResolvedValue(null),
  isChatLocked: jest.fn().mockReturnValue(false),
}));

// Keep the real `shouldUseThumbnail`/`createDataURL` wiring, stub only the byte
// cache so the helper's variant argument and the resulting data URL are
// observable.
jest.mock('../../services/engine/repositories/characters', () => {
  const actual = jest.requireActual('../../services/engine/repositories/characters');
  return {
    ...actual,
    getCachedImageBytes: jest.fn(),
  };
});

import { galleryTileImageSource } from '../AIProfileScreen';
import { getCachedImageBytes } from '../../services/engine/repositories/characters';
import type { CharacterImage } from '../../database/models';

const mockGetCachedImageBytes = getCachedImageBytes as jest.Mock;

/** The thumb route re-encodes; the original keeps its own mime. */
function bytes(variant: string) {
  return variant === 'thumb'
    ? { data: 'THUMB_BASE64', contentType: 'image/jpeg' }
    : { data: 'ORIGINAL_BASE64', contentType: 'image/gif' };
}

function galleryImage(over: Partial<CharacterImage> = {}): CharacterImage {
  return {
    id: 'i1',
    character_profile_id: 'p1',
    image_data: '',
    mime_type: 'image/gif',
    description: '',
    is_primary: true,
    display_order: 0,
    vl_model: '',
    vl_model_interpretation: '',
    created_at: new Date('2026-10-12T09:00:00Z'),
    updated_at: new Date('2026-10-12T09:00:00Z'),
    deleted_at: null,
    ...over,
  };
}

describe('AIProfileScreen gallery tile — thumbnail_state (contract 1.8.0)', () => {
  beforeEach(() => {
    mockGetCachedImageBytes.mockReset();
    mockGetCachedImageBytes.mockImplementation(
      async (_profileId: string, _imageId: string, variant: string) => bytes(variant),
    );
  });

  it('asks for the thumb of a pending legacy image', async () => {
    const uri = await galleryTileImageSource(
      'p1',
      galleryImage({ thumbnail_state: 'pending', has_thumbnail: false }),
    );

    expect(mockGetCachedImageBytes).toHaveBeenCalledWith(
      'p1',
      'i1',
      'thumb',
      expect.objectContaining({ thumbnailState: 'pending' }),
    );
    // The thumbnail's response mime wins over the metadata mime (GIF original).
    expect(uri).toBe('data:image/jpeg;base64,THUMB_BASE64');
  });

  it('asks for the thumb of a ready image', async () => {
    await galleryTileImageSource(
      'p1',
      galleryImage({ thumbnail_state: 'ready', has_thumbnail: true }),
    );
    expect(mockGetCachedImageBytes).toHaveBeenCalledWith(
      'p1',
      'i1',
      'thumb',
      expect.anything(),
    );
  });

  it('asks for the original of an unavailable image', async () => {
    const uri = await galleryTileImageSource(
      'p1',
      galleryImage({ thumbnail_state: 'unavailable', has_thumbnail: false }),
    );

    expect(mockGetCachedImageBytes).toHaveBeenCalledWith(
      'p1',
      'i1',
      'original',
      expect.anything(),
    );
    expect(uri).toBe('data:image/gif;base64,ORIGINAL_BASE64');
  });

  it('falls back to has_thumbnail when the engine omits thumbnail_state', async () => {
    await galleryTileImageSource('p1', galleryImage({ has_thumbnail: true }));
    expect(mockGetCachedImageBytes).toHaveBeenLastCalledWith(
      'p1',
      'i1',
      'thumb',
      expect.anything(),
    );

    await galleryTileImageSource('p1', galleryImage({ id: 'i2', has_thumbnail: false }));
    expect(mockGetCachedImageBytes).toHaveBeenLastCalledWith(
      'p1',
      'i2',
      'original',
      expect.anything(),
    );
  });

  it('falls back to the original when the remembered thumb 404s', async () => {
    mockGetCachedImageBytes.mockImplementation(
      async (_profileId: string, _imageId: string, variant: string) =>
        variant === 'thumb' ? null : bytes('original'),
    );

    const uri = await galleryTileImageSource(
      'p1',
      galleryImage({ thumbnail_state: 'ready', has_thumbnail: true }),
    );

    expect(mockGetCachedImageBytes).toHaveBeenLastCalledWith(
      'p1',
      'i1',
      'original',
    );
    expect(uri).toBe('data:image/gif;base64,ORIGINAL_BASE64');
  });

  it('renders a row that already carries bytes without a request', async () => {
    const uri = await galleryTileImageSource(
      'p1',
      galleryImage({ image_data: 'OWN_BYTES', mime_type: 'image/webp' }),
    );

    expect(mockGetCachedImageBytes).not.toHaveBeenCalled();
    expect(uri).toBe('data:image/webp;base64,OWN_BYTES');
  });

  it('returns null when the bytes cannot be resolved (tile keeps its box)', async () => {
    mockGetCachedImageBytes.mockResolvedValue(null);
    await expect(
      galleryTileImageSource('p1', galleryImage({ thumbnail_state: 'unavailable' })),
    ).resolves.toBeNull();
  });
});
