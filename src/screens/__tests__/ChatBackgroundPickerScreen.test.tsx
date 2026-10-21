/**
 * ChatBackgroundPickerScreen — two source tabs with FULL-scan counts, current
 * ✓ overlay, "No background" clearing, stay-open apply (✓ moves, no goBack),
 * the live dim preview strip, the failed-history-write toast, and the lazy
 * per-tile fetch of chat-history bytes (metadata-only list).
 */

import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { ChatBackgroundPickerScreen } from '../ChatBackgroundPickerScreen';
import ChatBackgroundService from '../../services/ChatBackgroundService';
import {
  getEntity,
  getCharacterImagesMetadata,
  getCachedImageBytes,
  getConversationImageMessages,
  getConversationMessageImageBase64,
} from '../../database/repositories';
import type { CharacterImage } from '../../database/models';
import type { ConversationImageMessageRef } from '../../services/engine/repositories/conversation_messages';

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
const mockShowToast = jest.fn();

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

jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
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
    onValueChange,
    value,
  }: any) =>
    React.createElement(View, {
      testID,
      value,
      onSlidingComplete,
      onValueChange,
    });
});

jest.mock('../../database/repositories', () => ({
  getEntity: jest.fn(),
  getCharacterImagesMetadata: jest.fn(),
  // Display bytes come from the app's byte cache as a data URL (URL + headers
  // Image sources are blank under the Fabric loader).
  getCachedImageBytes: jest.fn(async () => ({
    data: 'IMG_BASE64',
    contentType: 'image/jpeg',
  })),
  shouldUseThumbnail: jest.fn(() => false),
  getConversationImageMessages: jest.fn(),
  getConversationMessageImageBase64: jest.fn(),
}));

jest.mock('../../services/ChatBackgroundService', () => ({
  __esModule: true,
  default: {
    getChatBackgroundRecord: jest.fn(),
    setChatBackgroundProfile: jest.fn(),
    setChatBackgroundFromBase64: jest.fn(),
    setChatBackgroundDim: jest.fn(),
    setChatBackgroundTransparency: jest.fn(),
    clearChatBackground: jest.fn(),
  },
  DEFAULT_CHAT_BACKGROUND_DIM: 40,
  DEFAULT_CHAT_BACKGROUND_TRANSPARENCY: 100,
  chatBackgroundFileUri: (path: string) =>
    path.startsWith('file://') ? path : `file://${path}`,
}));

const mockGetEntity = getEntity as jest.Mock;
const mockGetImages = getCharacterImagesMetadata as jest.Mock;
const mockGetCachedImageBytes = getCachedImageBytes as jest.Mock;
const mockScanImages = getConversationImageMessages as jest.Mock;
const mockFetchImage = getConversationMessageImageBase64 as jest.Mock;
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

/** Metadata-only history ref (exactly what the full scan returns). */
function historyRef(
  messageId: string,
  mimeType = 'image/jpeg',
): ConversationImageMessageRef {
  return {
    messageId,
    mimeType,
    byteLength: 0,
    createdAt: new Date('2026-10-12T09:00:00Z'),
  };
}

async function renderPicker() {
  const utils = await render(<ChatBackgroundPickerScreen />);
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

function flattenedOpacity(style: any): number | undefined {
  const { StyleSheet } = require('react-native');
  const flat = StyleSheet.flatten(style) ?? {};
  return flat.opacity;
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
  mockScanImages.mockResolvedValue([
    historyRef('m4', 'image/png'),
    historyRef('m1'),
  ]);
  mockFetchImage.mockImplementation(async (messageId: string) =>
    messageId === 'm4' ? 'BASE64_B' : 'BASE64_A',
  );
  service.getChatBackgroundRecord.mockResolvedValue({
    ref: null,
    dim: 40,
    transparency: 100,
  });
  service.setChatBackgroundProfile.mockResolvedValue(undefined);
  service.setChatBackgroundFromBase64.mockResolvedValue('/docs/bg.png');
  service.setChatBackgroundDim.mockResolvedValue(undefined);
  service.setChatBackgroundTransparency.mockResolvedValue(undefined);
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

  it('renders profile tiles and the preview from byte-cache data URLs', async () => {
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'img-2' },
      dim: 40,
      transparency: 100,
    });
    const { findByTestId } = await renderPicker();

    const tileImage = await findByTestId('background-profile-image-img-1');
    expect(tileImage.props.source).toEqual({
      uri: 'data:image/jpeg;base64,IMG_BASE64',
    });
    expect(mockGetCachedImageBytes).toHaveBeenCalledWith(
      'p1',
      'img-1',
      'original',
      expect.anything(),
    );
    // The current-background strip uses the ORIGINAL bytes, also as a data URL.
    const preview = await findByTestId('background-dim-preview-image');
    expect(preview.props.source).toEqual({
      uri: 'data:image/jpeg;base64,IMG_BASE64',
    });
  });

  it('keeps the placeholder tile when the byte fetch fails', async () => {
    mockGetCachedImageBytes.mockRejectedValueOnce(new Error('offline'));
    const { findByTestId, queryByTestId } = await renderPicker();

    await findByTestId('background-profile-tile-img-1');
    expect(queryByTestId('background-profile-image-img-1')).toBeNull();
  });

  it('marks the current background tile with a check overlay', async () => {
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'img-2' },
      dim: 40,
      transparency: 100,
    });
    const { getAllByTestId, findByTestId } = await renderPicker();

    // Profile tab is the default; the overlay only lives on the active tile.
    await findByTestId('background-profile-tile-img-2');
    expect(getAllByTestId('background-current-check')).toHaveLength(1);
  });

  it('applies a profile image but STAYS OPEN, moving the ✓ overlay', async () => {
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'img-2' },
      dim: 40,
      transparency: 100,
    });
    const { findByTestId, getAllByTestId } = await renderPicker();

    await fireEvent.press(await findByTestId('background-profile-tile-img-1'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(service.setChatBackgroundProfile).toHaveBeenCalledWith(
      'ent-1',
      'p1',
      'img-1',
    );
    // Stay-open: no navigation back, and exactly one ✓ — now on the new tile.
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(getAllByTestId('background-current-check')).toHaveLength(1);
    expect(
      within(await findByTestId('background-profile-tile-img-1')).getByTestId(
        'background-current-check',
      ),
    ).toBeTruthy();
  });

  it('scans the FULL chat history and fetches visible tiles lazily', async () => {
    const { findByTestId, findByText } = await renderPicker();

    // The tab count comes from the full-scan metadata, not a 200-message window.
    expect(await findByText('chatHistorySource (2)')).toBeTruthy();
    expect(mockScanImages).toHaveBeenCalledWith('user-1', 'pk');

    await fireEvent.press(await findByTestId('background-source-history'));
    // The visible tile asks for ITS bytes only — by message id.
    await findByTestId('background-history-tile-m4');
    expect(mockFetchImage).toHaveBeenCalledWith('m4');
  });

  it('does not gate the picker on the full history scan', async () => {
    let resolveScan: (refs: ConversationImageMessageRef[]) => void = () => {};
    mockScanImages.mockReturnValue(
      new Promise<ConversationImageMessageRef[]>(resolve => {
        resolveScan = resolve;
      }),
    );
    const { findByTestId, findByText } = await renderPicker();

    // The profile tab is already interactive while the scan is in flight.
    expect(await findByTestId('background-profile-tile-img-1')).toBeTruthy();
    await fireEvent.press(await findByTestId('background-source-history'));
    expect(await findByTestId('background-history-scanning')).toBeTruthy();

    await act(async () => {
      resolveScan([historyRef('m9')]);
      await Promise.resolve();
    });

    expect(await findByText('chatHistorySource (1)')).toBeTruthy();
    expect(await findByTestId('background-history-tile-m9')).toBeTruthy();
  });

  it('only fetches bytes for tiles inside the list window', async () => {    // 40 image messages: the grid is windowed, so the tail must not be loaded.
    mockScanImages.mockResolvedValue(
      Array.from({ length: 40 }, (_unused, i) => historyRef(`m${i + 1}`)),
    );
    const { findByTestId } = await renderPicker();

    await fireEvent.press(await findByTestId('background-source-history'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetchImage.mock.calls.length).toBeGreaterThan(0);
    expect(mockFetchImage.mock.calls.length).toBeLessThan(40);
    expect(mockFetchImage).not.toHaveBeenCalledWith('m40');
  });

  it('applies a chat-history image from its lazily fetched bytes, staying open', async () => {
    const { findByTestId, getAllByTestId } = await renderPicker();

    await fireEvent.press(await findByTestId('background-source-history'));
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
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(getAllByTestId('background-current-check')).toHaveLength(1);
    expect(
      within(await findByTestId('background-history-tile-m4')).getByTestId(
        'background-current-check',
      ),
    ).toBeTruthy();
  });

  it('shows the standard error toast when the history write returns null', async () => {
    service.setChatBackgroundFromBase64.mockResolvedValue(null);
    const { findByTestId, queryAllByTestId } = await renderPicker();

    await fireEvent.press(await findByTestId('background-source-history'));
    await fireEvent.press(await findByTestId('background-history-tile-m4'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockShowToast).toHaveBeenCalledWith('backgroundSetFailed');
    // A failed write must not claim the tile is the background.
    expect(queryAllByTestId('background-current-check')).toHaveLength(0);
  });

  it('clears the background from the dashed "No background" tile without closing', async () => {
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'img-2' },
      dim: 40,
      transparency: 100,
    });
    const { findByTestId, queryAllByTestId } = await renderPicker();

    await fireEvent.press(await findByTestId('background-none-tile'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(service.clearChatBackground).toHaveBeenCalledWith('ent-1');
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(queryAllByTestId('background-current-check')).toHaveLength(0);
  });

  it('previews the current background with a scrim at the live dim value', async () => {
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'img-2' },
      dim: 40,
      transparency: 100,
    });
    const { findByTestId, getByTestId } = await renderPicker();

    expect(await findByTestId('background-dim-preview-image')).toBeTruthy();
    expect(
      flattenedOpacity(getByTestId('background-dim-preview-scrim').props.style),
    ).toBeCloseTo(0.4);

    // Dragging the slider updates the preview live (before release persists).
    await fireEvent(getByTestId('background-dim-slider'), 'valueChange', 85);
    expect(
      flattenedOpacity(getByTestId('background-dim-preview-scrim').props.style),
    ).toBeCloseTo(0.85);
  });

  it('previews a just-applied file background', async () => {
    const { findByTestId, getByTestId } = await renderPicker();

    await fireEvent.press(await findByTestId('background-source-history'));
    await fireEvent.press(await findByTestId('background-history-tile-m4'));
    await act(async () => {
      await Promise.resolve();
    });

    const preview = await findByTestId('background-dim-preview-image');
    expect(preview.props.source).toEqual({ uri: 'file:///docs/bg.png' });
    expect(
      flattenedOpacity(getByTestId('background-dim-preview-scrim').props.style),
    ).toBeCloseTo(0.4);
  });

  it('shows the muted placeholder strip when no background is set', async () => {
    const { findByTestId, queryByTestId } = await renderPicker();

    expect(await findByTestId('background-dim-preview-empty')).toBeTruthy();
    expect(queryByTestId('background-dim-preview-image')).toBeNull();
  });

  it('persists the dim on slider release', async () => {
    const { findByTestId } = await renderPicker();

    await fireEvent(await findByTestId('background-dim-slider'), 'slidingComplete', 72);
    await act(async () => {
      await Promise.resolve();
    });

    expect(service.setChatBackgroundDim).toHaveBeenCalledWith('ent-1', 72);
  });

  it('renders the transparency slider at the stored value', async () => {
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'img-2' },
      dim: 40,
      transparency: 35,
    });
    const { findByTestId, getByText } = await renderPicker();

    expect(await findByTestId('background-transparency-slider')).toBeTruthy();
    expect(getByText('35%')).toBeTruthy();
    // The preview starts at the stored image opacity.
    expect(
      flattenedOpacity(
        (await findByTestId('background-dim-preview-image')).props.style,
      ),
    ).toBeCloseTo(0.35);
  });

  it('previews transparency on the image itself, live, and persists on release', async () => {
    service.getChatBackgroundRecord.mockResolvedValue({
      ref: { kind: 'profile', profileId: 'p1', imageId: 'img-2' },
      dim: 40,
      transparency: 100,
    });
    const { findByTestId, getByTestId } = await renderPicker();

    const previewImage = await findByTestId('background-dim-preview-image');
    expect(flattenedOpacity(previewImage.props.style)).toBeCloseTo(1);

    // Dragging fades the IMAGE (not a new scrim) before anything is persisted.
    await fireEvent(getByTestId('background-transparency-slider'), 'valueChange', 30);
    expect(flattenedOpacity(getByTestId('background-dim-preview-image').props.style)).toBeCloseTo(0.3);
    expect(service.setChatBackgroundTransparency).not.toHaveBeenCalled();

    await fireEvent(
      getByTestId('background-transparency-slider'),
      'slidingComplete',
      30,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(service.setChatBackgroundTransparency).toHaveBeenCalledWith('ent-1', 30);
  });

  it('shows an empty state for a chat with no image messages', async () => {
    mockScanImages.mockResolvedValue([]);
    const { findByTestId, findByText } = await renderPicker();

    await fireEvent.press(await findByTestId('background-source-history'));
    expect(await findByTestId('background-history-empty')).toBeTruthy();
    expect(await findByText('chatHistorySource (0)')).toBeTruthy();
  });
});
