/**
 * AIProfileScreen — image viewer "Set as background" action wiring.
 *
 * The viewer action targets the CHAT entity for this profile (the same
 * `getEntityByCharacterProfileId` lookup the chat screen's partner settings
 * uses in reverse). When the viewed image already is the background, the
 * label flips to the current-background variant and tapping removes it.
 * The background ref is re-read on FOCUS, because it can change from the chat
 * picker while this screen stays mounted.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AIProfileScreen } from '../AIProfileScreen';
import ChatBackgroundService from '../../services/ChatBackgroundService';
import { getEntityByCharacterProfileId } from '../../database/repositories';

const THEME = {
  colors: {
    accent: {
      primary: '#b84fd0',
      secondary: '#4a5fcf',
      primaryHover: '#a13fbb',
      secondaryHover: '#3d4fb0',
    },
    background: { base: '#0b0f19', surface: '#0f1525', elevated: '#151d30', hover: '#1a2138' },
    border: { default: '#2a3350', focus: '#b84fd0', hover: '#3a4568', accent: '#b84fd0' },
    text: { primary: '#f0edf6', secondary: '#c9c5da', muted: '#9692b0', disabled: '#555' },
    status: { error: '#ef4444', success: '#22c55e', warning: '#f59e0b', info: '#3b82f6' },
    gradients: { primary: '', secondary: '', surface: '' },
    glass: {
      cardOpacity: 0.5,
      glowOpacity: 0.08,
      glowRadius: 14,
      borderGradientStart: 'rgba(255,255,255,0.4)',
      borderGradientEnd: 'rgba(184,79,208,0.4)',
    },
    typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
  },
} as any;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useRoute: () => ({ params: { profileId: 'p1' } }),
    // Keeps the latest focus callbacks so a test can simulate a re-focus
    // (back-nav from the chat screen) on an already-mounted profile.
    useFocusEffect: (cb: () => void) => {
      mockFocusCallbacks.push(cb);
      React.useEffect(cb, [cb]);
    },
  };
});

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: THEME }),
}));
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', display_name: 'Me' } }),
}));
jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: jest.fn() }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../../utils/haptics', () => ({
  hapticLightPress: jest.fn(),
}));

jest.mock('../../services/social/SocialService', () => ({
  getSavedCharacterEntries: jest.fn(async () => []),
  isCharacterLiked: jest.fn(async () => false),
  getCharacterLikesCount: jest.fn(async () => 0),
  getCharacterCreator: jest.fn(async () => null),
  isCharacterCreator: jest.fn(async () => false),
  isFollowing: jest.fn(async () => false),
  getImageLikesCount: jest.fn(async () => 0),
  getImageComments: jest.fn(async () => []),
}));

jest.mock('../../services/CharacterChatService', () => ({
  openCharacterChat: jest.fn(),
}));
jest.mock('../../services/marketplace/MarketplaceService', () => ({
  getListingForProfile: jest.fn(async () => null),
  isChatLocked: jest.fn(async () => false),
}));

jest.mock('../../services/ChatBackgroundService', () => ({
  __esModule: true,
  default: {
    getChatBackgroundRecord: jest.fn(),
    setChatBackgroundProfile: jest.fn(),
    clearChatBackground: jest.fn(),
  },
}));

jest.mock('../../database/repositories', () => ({
  getAICharacterProfile: jest.fn(),
  getCharacterImagesMetadata: jest.fn(),
  getPrimaryImage: jest.fn(async () => null),
  getSiblingCharacterProfiles: jest.fn(async () => []),
  getCharacterStats: jest.fn(async () => ({ likes: 0, chats: 0 })),
  // Gallery tiles / viewer resolve bytes through the app's cache (URL + headers
  // Image sources are blank under the Fabric loader).
  getCachedImageBytes: jest.fn(async () => ({
    data: 'IMG_BASE64',
    contentType: 'image/jpeg',
  })),
  imageToDataURL: jest.fn(() => null),
  shouldUseThumbnail: jest.fn(() => false),
  duplicateAIPartner: jest.fn(),
  getEntityByCharacterProfileId: jest.fn(),
  setEntityDisabled: jest.fn(),
  setEntityMuted: jest.fn(),
  createUserPersonaFromCard: jest.fn(),
  ReservedEntityNameError: class ReservedEntityNameError extends Error {},
}));

jest.mock('../../components/modals/ImageViewerModal', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    ImageViewerModal: ({ visible, backgroundAction, accentColor }: any) =>
      visible
        ? React.createElement(
            View,
            { testID: 'image-viewer-mock' },
            React.createElement(
              Text,
              { testID: 'viewer-background-label' },
              backgroundAction?.label ?? 'none',
            ),
            React.createElement(Text, { testID: 'viewer-accent' }, accentColor ?? 'none'),
            React.createElement(TouchableOpacity, {
              testID: 'viewer-background-button',
              onPress: backgroundAction?.onPress,
            }),
          )
        : null,
  };
});

/** Latest `useFocusEffect` callbacks, so tests can simulate a re-focus. */
const mockFocusCallbacks: Array<() => void> = [];

const {
  getAICharacterProfile,
  getCharacterImagesMetadata,
} = require('../../database/repositories');

const mockGetAICharacterProfile = getAICharacterProfile as jest.Mock;
const mockGetImages = getCharacterImagesMetadata as jest.Mock;
const mockGetEntity = getEntityByCharacterProfileId as jest.Mock;
const service = ChatBackgroundService as jest.Mocked<typeof ChatBackgroundService>;

const profile = {
  id: 'p1',
  name: 'Iris',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  alternate_greetings: '',
  post_history_instructions: '',
  creator_notes: '',
  creator: '',
  character_version: '',
  nickname: '',
  tags: '',
  group_only_greetings: '',
  extensions: '',
  assets: '',
  card_provenance: '',
  character_book: '',
  voice_characteristics: '',
  base_prompt: '',
  typing_speed_wpm: 0,
  audio_response_chance_percent: 0,
  vision_config_id: null,
  lifecycle_config: '{}',
  is_favorite: 0,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};

const galleryImage = {
  id: 'i1',
  character_profile_id: 'p1',
  image_data: '',
  mime_type: 'image/jpeg',
  description: '',
  is_primary: true,
  display_order: 0,
  vl_model: '',
  vl_model_interpretation: '',
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};

async function renderProfile() {
  const utils = await render(<AIProfileScreen />);
  await waitFor(() => expect(mockGetImages).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallbacks.length = 0;
  mockGetAICharacterProfile.mockResolvedValue(profile);
  mockGetImages.mockResolvedValue([galleryImage]);
  mockGetEntity.mockResolvedValue({ id: 'ent-1', is_disabled: 0, is_muted: 0 });
  service.getChatBackgroundRecord.mockResolvedValue({ ref: null, dim: 40 });
  service.setChatBackgroundProfile.mockResolvedValue(undefined);
  service.clearChatBackground.mockResolvedValue(undefined);
});

describe('AIProfileScreen — viewer background action', () => {
  it('sets the viewed profile image as the entity background', async () => {
    const { findByTestId, getByText } = await renderProfile();

    await fireEvent.press(await findByTestId('ai-image-tile-i1'));
    expect(getByText('setAsBackground')).toBeTruthy();

    await fireEvent.press(await findByTestId('viewer-background-button'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(service.setChatBackgroundProfile).toHaveBeenCalledWith('ent-1', 'p1', 'i1');
    expect(getByText('currentBackground')).toBeTruthy();
  });

  it('shows the current-background variant and removes it on tap', async () => {
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'i1' },
      dim: 40,
    });
    const { findByTestId, getByText } = await renderProfile();

    await fireEvent.press(await findByTestId('ai-image-tile-i1'));
    expect(getByText('currentBackground')).toBeTruthy();

    await fireEvent.press(await findByTestId('viewer-background-button'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(service.clearChatBackground).toHaveBeenCalledWith('ent-1');
    expect(getByText('setAsBackground')).toBeTruthy();
  });

  it('passes the live theme accent to the viewer modal', async () => {
    const { findByTestId } = await renderProfile();

    await fireEvent.press(await findByTestId('ai-image-tile-i1'));

    expect((await findByTestId('viewer-accent')).props.children).toBe('#b84fd0');
  });

  it('re-reads the entity background when the screen is focused again', async () => {
    // Mounted with no background (the viewer shows "Set as background").
    service.getChatBackgroundRecord.mockResolvedValue({ ref: null, dim: 40 });
    const { findByTestId, getByText } = await renderProfile();

    await fireEvent.press(await findByTestId('ai-image-tile-i1'));
    expect(getByText('setAsBackground')).toBeTruthy();

    // The user set this image as the background from the CHAT picker while
    // this profile stayed mounted underneath → back-nav must not show a stale ✓.
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'i1' },
      dim: 40,
    });
    const refocus = mockFocusCallbacks[mockFocusCallbacks.length - 1];
    expect(refocus).toBeDefined();
    await act(async () => {
      refocus();
      await Promise.resolve();
    });

    await waitFor(() => expect(getByText('currentBackground')).toBeTruthy());
  });
});
