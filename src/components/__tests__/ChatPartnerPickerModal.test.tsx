/**
 * ChatPartnerPickerModal — picker entity-row rendering tests.
 *
 * Locks the picker rulings: card rows and entity rows render side by side
 * (resolved labels: card → nickname||name, entity → alias||nickname||name),
 * search prefix-matches the RESOLVED label, `onChat` receives the full
 * ChatPickerRow payload, and the two empty states are distinguished — a truly
 * empty library shows `pickerEmpty`, a library whose every character already
 * has a chat shows `pickerAllChatted`.
 */

import React from 'react';
import {act, cleanup, fireEvent, render, waitFor} from '@testing-library/react-native';
import {ChatPartnerPickerModal} from '../chat/ChatPartnerPickerModal';
import type {ChatPickerRow} from '../../database/repositories/characters';

afterEach(cleanup);
beforeEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()}),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const {View} = require('react-native');
  return ({children, style, ...props}: any) =>
    React.createElement(View, {style, ...props}, children);
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: {primary: '#7c3aed', secondary: '#a78bfa', primaryHover: '#6d28d9'},
        background: {base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e'},
        border: {default: '#333333'},
        text: {primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555'},
        status: {success: '#22c55e', warning: '#f59e0b', error: '#ef4444'},
      },
    },
  }),
}));

jest.mock('../../utils/haptics', () => ({
  hapticLightPress: jest.fn(),
}));

jest.mock('../themed/ThemedText', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({children, style, ...props}: any) =>
      React.createElement(Text, {style, ...props}, children),
  };
});

jest.mock('../themed/ThemedEmptyState', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    __esModule: true,
    ThemedEmptyState: ({title, subtitle}: any) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Text, null, title),
        subtitle ? React.createElement(Text, null, subtitle) : null,
      ),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return ({name, ...props}: any) => React.createElement(Text, {...props}, name);
});

jest.mock('../profile/ProfileAvatar', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    __esModule: true,
    ProfileAvatar: ({name, uri}: any) =>
      React.createElement(
        View,
        null,
        React.createElement(Text, null, `avatar:${name}`),
        uri ? React.createElement(Text, null, `dataurl:${uri}`) : null,
      ),
  };
});

jest.mock('../../database/base64', () => ({
  createDataURL: jest.fn((data: string, mime: string) => `data:${mime};base64,${data}`),
  uint8ArrayToBase64: jest.fn(() => ''),
}));

// Real label helper, mocked async queries — the modal must resolve labels via
// the SHARED helper (repo ruling: modal and tests use one implementation).
jest.mock('../../database/repositories/characters', () => {
  const actual = jest.requireActual('../../database/repositories/characters');
  return {
    ...actual,
    getChatPickerRows: jest.fn(() => Promise.resolve([])),
    hasChatPickerLibrary: jest.fn(() => Promise.resolve(false)),
    getCharacterImages: jest.fn(() => Promise.resolve([])),
  };
});

import {
  getChatPickerRows,
  hasChatPickerLibrary,
  getCharacterImages,
} from '../../database/repositories/characters';

const mockGetChatPickerRows = getChatPickerRows as jest.Mock;
const mockHasChatPickerLibrary = hasChatPickerLibrary as jest.Mock;
const mockGetCharacterImages = getCharacterImages as jest.Mock;

const PROFILE_ARIA = {
  id: 'p-aria',
  name: 'Aria',
  nickname: '',
  description: 'The first AI',
};

const CARD_ROW: ChatPickerRow = {kind: 'card', profile: PROFILE_ARIA as any};

const ENTITY_ROW: ChatPickerRow = {
  kind: 'entity',
  entity: {id: 'e-alice', alias: 'Alice', character_profile_id: 'p-alicia'} as any,
  profile: {id: 'p-alicia', name: 'Alicia', nickname: '', description: 'The second AI'} as any,
};

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderModal(rows: ChatPickerRow[], libraryHasContent = true) {
  // Fresh per-test implementations (mockReset + mockResolvedValue) — no
  // global clearAllMocks, which poisons later renders in this suite.
  mockGetChatPickerRows.mockReset().mockResolvedValue(rows);
  mockHasChatPickerLibrary.mockReset().mockResolvedValue(libraryHasContent);
  const onChat = jest.fn();
  const onClose = jest.fn();
  const utils = await render(
    <ChatPartnerPickerModal
      visible
      impersonatedPersonaId="user"
      onClose={onClose}
      onChat={onChat}
    />,
  );
  await flush();
  return {...utils, onChat, onClose};
}

describe('ChatPartnerPickerModal — picker rows', () => {
  it('loads rows for the impersonated persona and renders card + entity rows with resolved labels', async () => {
    const utils = await renderModal([CARD_ROW, ENTITY_ROW]);

    expect(mockGetChatPickerRows).toHaveBeenCalledWith('user');

    // Card row keyed by the PROFILE id; entity row keyed by the ENTITY id.
    expect(utils.getByTestId('chat-picker-card:p-aria')).toBeTruthy();
    expect(utils.getByTestId('chat-picker-entity:e-alice')).toBeTruthy();

    // Labels: card → profile name; entity → alias (not the underlying name).
    expect(utils.getByText('Aria')).toBeTruthy();
    expect(utils.getByText('Alice')).toBeTruthy();
    expect(utils.queryByText('Alicia')).toBeNull();
  });

  it('loads one avatar per unique profile (entity rows reuse their linked profile)', async () => {
    // Isolate the avatar call count from earlier tests' renders.
    mockGetCharacterImages.mockClear();
    const sharedProfile = {id: 'p-twin', name: 'Twin', nickname: '', description: ''};
    await renderModal([
      {kind: 'card', profile: sharedProfile as any},
      {
        kind: 'entity',
        entity: {id: 'e-twin-1', alias: 'Twin 2', character_profile_id: 'p-twin'} as any,
        profile: sharedProfile as any,
      },
      {
        kind: 'entity',
        entity: {id: 'e-twin-2', alias: 'Twin 3', character_profile_id: 'p-twin'} as any,
        profile: sharedProfile as any,
      },
    ]);

    // Three rows but a single profile id → exactly one avatar load.
    expect(mockGetCharacterImages).toHaveBeenCalledTimes(1);
    expect(mockGetCharacterImages).toHaveBeenCalledWith('p-twin');
  });

  it('search filters by the RESOLVED label (alias prefix, not the profile name)', async () => {
    const utils = await renderModal([CARD_ROW, ENTITY_ROW]);

    // React 19 batches the controlled-input update — waitFor (RNTL's act-aware
    // polling) rides the re-render; a manual act() loop here poisons the
    // renders of subsequent tests in this file.
    fireEvent.changeText(utils.getByPlaceholderText('pickerSearch'), 'Al');
    await waitFor(() => {
      expect(utils.queryByTestId('chat-picker-card:p-aria')).toBeNull();
    });

    // Entity row resolves to alias 'Alice' — matches the 'Al' prefix…
    expect(utils.getByTestId('chat-picker-entity:e-alice')).toBeTruthy();
  });

  it('fires onChat with the ChatPickerRow payload and closes on tap', async () => {
    const utils = await renderModal([ENTITY_ROW]);

    fireEvent.press(utils.getByTestId('chat-picker-entity:e-alice'));

    expect(utils.onChat).toHaveBeenCalledTimes(1);
    const payload = utils.onChat.mock.calls[0][0] as ChatPickerRow;
    expect(payload.kind).toBe('entity');
    // Runtime kind assertion above; narrow for the property reads below.
    const entityPayload = payload as Extract<ChatPickerRow, { kind: 'entity' }>;
    expect(entityPayload.entity.id).toBe('e-alice');
    expect(entityPayload.profile.id).toBe('p-alicia');
    // The modal dismisses itself before handing the row to the parent.
    expect(utils.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows pickerAllChatted when the library has content but zero rows', async () => {
    const utils = await renderModal([], true);

    expect(utils.getByText('pickerAllChatted')).toBeTruthy();
    expect(utils.getByText('pickerAllChattedHint')).toBeTruthy();
    expect(utils.queryByText('pickerEmpty')).toBeNull();
  });

  it('shows pickerEmpty for a truly empty library', async () => {
    const utils = await renderModal([], false);

    expect(utils.getByText('pickerEmpty')).toBeTruthy();
    expect(utils.getByText('pickerEmptyHint')).toBeTruthy();
    expect(utils.queryByText('pickerAllChatted')).toBeNull();
  });
});
