/**
 * ChatBackgroundPickerScreen — two source tabs, counts, current ✓ overlay,
 * "No background" clearing, instant apply + close, dim persistence.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ChatBackgroundPickerScreen } from '../ChatBackgroundPickerScreen';
import ChatBackgroundService from '../../services/ChatBackgroundService';
import {
  getEntity,
  getCharacterImagesMetadata,
  characterImageSource,
  getRecentConversationMessages,
} from '../../database/repositories';
import type { CharacterImage, ConversationMessage } from '../../database/models';

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

const mockGoBack = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({
    params: { entityId: 'ent-1', participantKey: 'pk', povEntityId: 'user-1' },
  }),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: THEME }),
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

jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({
    testID,
    onSlidingComplete,
    value,
  }: any) =>
    React.createElement(View, { testID, value, onSlidingComplete });
});

jest.mock('../../database/repositories', () => ({
  getEntity: jest.fn(),
  getCharacterImagesMetadata: jest.fn(),
  characterImageSource: jest.fn((profileId: string, imageId: string) => ({
    uri: `http://127.0.0.1:2/api/character-profiles/${profileId}/images/${imageId}`,
    headers: {},
  })),
  shouldUseThumbnail: jest.fn(() => false),
  getRecentConversationMessages: jest.fn(),
}));

jest.mock('../../services/ChatBackgroundService', () => ({
  __esModule: true,
  default: {
    getChatBackgroundRecord: jest.fn(),
    setChatBackgroundProfile: jest.fn(),
    setChatBackgroundFromBase64: jest.fn(),
    setChatBackgroundDim: jest.fn(),
    clearChatBackground: jest.fn(),
  },
  DEFAULT_CHAT_BACKGROUND_DIM: 40,
}));

const mockGetEntity = getEntity as jest.Mock;
const mockGetImages = getCharacterImagesMetadata as jest.Mock;
const mockGetMessages = getRecentConversationMessages as jest.Mock;
const service = ChatBackgroundService as jest.Mocked<typeof ChatBackgroundService>;

function image(id: string, over: Partial<CharacterImage> = {}): CharacterImage {
  return {
    id,
    character_profile_id: 'p1',
    image_data: '',
    mime_type: 'image/jpeg',
    description: '',
    is_primary: id === 'img-1',
    display_order: 0,
    vl_model: '',
    vl_model_interpretation: '',
    created_at: new Date('2026-10-12T09:00:00Z'),
    updated_at: new Date('2026-10-12T09:00:00Z'),
    deleted_at: null,
    ...over,
  };
}

function message(
  id: string,
  imageData: string | null,
  mimeType = 'image/jpeg',
): ConversationMessage {
  return {
    id,
    entity_id: 'user-1',
    sender_entity_id: 'ent-1',
    interaction_id: 'ix',
    content: imageData ? '' : 'hello',
    audio_duration: null,
    message_type: imageData ? 'image' : 'text',
    image_data: imageData,
    image_mime_type: imageData ? mimeType : null,
    emotional_state_bits: 0,
    is_recon_followup: false,
    is_edited: false,
    created_at: new Date('2026-10-12T09:00:00Z'),
    updated_at: new Date('2026-10-12T09:00:00Z'),
    deleted_at: null,
  } as ConversationMessage;
}

async function renderPicker() {
  const utils = await render(<ChatBackgroundPickerScreen />);
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEntity.mockResolvedValue({
    id: 'ent-1',
    character_profile_id: 'p1',
    is_disabled: 0,
    is_muted: 0,
  });
  mockGetImages.mockResolvedValue([image('img-1'), image('img-2')]);
  mockGetMessages.mockResolvedValue([
    message('m1', 'BASE64_A'),
    message('m2', null),
    message('m3', 'BASE64_A'), // duplicate bytes — must not appear twice
    message('m4', 'BASE64_B', 'image/png'),
  ]);
  service.getChatBackgroundRecord.mockResolvedValue({ ref: null, dim: 40 });
  service.setChatBackgroundProfile.mockResolvedValue(undefined);
  service.setChatBackgroundFromBase64.mockResolvedValue('/docs/bg.png');
  service.setChatBackgroundDim.mockResolvedValue(undefined);
  service.clearChatBackground.mockResolvedValue(undefined);
});

describe('ChatBackgroundPickerScreen', () => {
  it('renders both source tabs with counts from the loaded data', async () => {
    const { findByText, findByTestId } = await renderPicker();

    expect(await findByText('profileSource (2)')).toBeTruthy();
    expect(await findByText('chatHistorySource (2)')).toBeTruthy();
    expect(await findByTestId('background-profile-tile-img-1')).toBeTruthy();
    expect(await findByTestId('background-profile-tile-img-2')).toBeTruthy();
  });

  it('marks the current background tile with a check overlay', async () => {
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'img-2' },
      dim: 40,
    });
    const { getAllByTestId, findByTestId } = await renderPicker();

    // Profile tab is the default; the overlay only lives on the active tile.
    await findByTestId('background-profile-tile-img-2');
    expect(getAllByTestId('background-current-check')).toHaveLength(1);
  });

  it('applies a profile image instantly and closes', async () => {
    const { findByTestId } = await renderPicker();

    await fireEvent.press(await findByTestId('background-profile-tile-img-1'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(service.setChatBackgroundProfile).toHaveBeenCalledWith(
      'ent-1',
      'p1',
      'img-1',
    );
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('applies a chat-history image by writing it to a file, then closes', async () => {
    const { findByTestId, findByText } = await renderPicker();

    await fireEvent.press(await findByTestId('background-source-history'));
    expect(await findByText('chatHistorySource (2)')).toBeTruthy();

    await fireEvent.press(await findByTestId('background-history-tile-m4'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(service.setChatBackgroundFromBase64).toHaveBeenCalledWith(
      'ent-1',
      'BASE64_B',
      'image/png',
      'm4',
    );
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('clears the background from the dashed "No background" tile', async () => {
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'img-2' },
      dim: 40,
    });
    const { findByTestId } = await renderPicker();

    await fireEvent.press(await findByTestId('background-none-tile'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(service.clearChatBackground).toHaveBeenCalledWith('ent-1');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('persists the dim on slider release', async () => {
    const { findByTestId } = await renderPicker();

    await fireEvent(await findByTestId('background-dim-slider'), 'slidingComplete', 72);
    await act(async () => {
      await Promise.resolve();
    });

    expect(service.setChatBackgroundDim).toHaveBeenCalledWith('ent-1', 72);
  });

  it('shows an empty state for a chat with no image messages', async () => {
    mockGetMessages.mockResolvedValue([message('m1', null)]);
    const { findByTestId, findByText } = await renderPicker();

    await fireEvent.press(await findByTestId('background-source-history'));
    expect(await findByTestId('background-history-empty')).toBeTruthy();
    expect(await findByText('chatHistorySource (0)')).toBeTruthy();
  });
});
