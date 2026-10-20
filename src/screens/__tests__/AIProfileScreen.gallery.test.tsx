/**
 * AIProfileScreen gallery-tile source decision (contract 1.8.0 tri-state).
 *
 * The tile renders BY URL (no base64 blob), so the one thing the screen must get
 * right is whether the URL carries `?variant=thumb`:
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

// Keep the real `shouldUseThumbnail`, stub only the URL builder so the helper's
// variant argument is observable.
jest.mock('../../services/engine/repositories/characters', () => {
  const actual = jest.requireActual('../../services/engine/repositories/characters');
  return {
    ...actual,
    characterImageSource: jest.fn(
      (profileId: string, imageId: string, variant?: 'thumb') => ({
        uri: `http://127.0.0.1:2/api/character-profiles/${profileId}/images/${imageId}${
          variant ? `?variant=${variant}` : ''
        }`,
        headers: { 'X-Loopback-Token': 'tok' },
      }),
    ),
  };
});

import { galleryTileImageSource } from '../AIProfileScreen';
import { characterImageSource } from '../../services/engine/repositories/characters';
import type { CharacterImage } from '../../database/models';

const mockCharacterImageSource = characterImageSource as jest.Mock;

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
    mockCharacterImageSource.mockClear();
  });

  it('requests ?variant=thumb for a pending legacy image', () => {
    const source = galleryTileImageSource(
      'p1',
      galleryImage({ thumbnail_state: 'pending', has_thumbnail: false }),
    );

    expect(mockCharacterImageSource).toHaveBeenCalledWith('p1', 'i1', 'thumb');
    expect(source?.uri).toBe(
      'http://127.0.0.1:2/api/character-profiles/p1/images/i1?variant=thumb',
    );
  });

  it('requests ?variant=thumb for a ready image', () => {
    galleryTileImageSource(
      'p1',
      galleryImage({ thumbnail_state: 'ready', has_thumbnail: true }),
    );
    expect(mockCharacterImageSource).toHaveBeenCalledWith('p1', 'i1', 'thumb');
  });

  it('uses the original URL for an unavailable image', () => {
    const source = galleryTileImageSource(
      'p1',
      galleryImage({ thumbnail_state: 'unavailable', has_thumbnail: false }),
    );

    expect(mockCharacterImageSource).toHaveBeenCalledWith('p1', 'i1', undefined);
    expect(source?.uri).toBe('http://127.0.0.1:2/api/character-profiles/p1/images/i1');
  });

  it('falls back to has_thumbnail when the engine omits thumbnail_state', () => {
    galleryTileImageSource('p1', galleryImage({ has_thumbnail: true }));
    expect(mockCharacterImageSource).toHaveBeenLastCalledWith('p1', 'i1', 'thumb');

    galleryTileImageSource('p1', galleryImage({ id: 'i2', has_thumbnail: false }));
    expect(mockCharacterImageSource).toHaveBeenLastCalledWith('p1', 'i2', undefined);
  });
});
