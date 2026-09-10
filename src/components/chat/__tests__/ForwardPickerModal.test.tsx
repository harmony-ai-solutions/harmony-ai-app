/**
 * ForwardPickerModal — §9-A3 leak test (user entities are never forward targets).
 *
 * Post-5-3 every user entity has a linked `character_profiles` row, so the old
 * `character_profile_id` presence check would LEAK user entities into the
 * forward picker. This test pins the `entity_type !== 'user'` guard: a user
 * entity that appears as a partner in an interaction is filtered out, while an
 * AI partner is offered.
 */

import React from 'react';
import { act, cleanup, render } from '@testing-library/react-native';
import { ForwardPickerModal } from '../ForwardPickerModal';

afterEach(cleanup);
beforeEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
      },
    },
  }),
}));

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, style, ...props }: any) =>
    React.createElement(Text, { style, ...props }, children) };
});

jest.mock('../../profile/ProfileAvatar', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return { __esModule: true, ProfileAvatar: ({ name }: any) =>
    React.createElement(View, null, React.createElement(Text, null, `avatar:${name}`)) };
});

jest.mock('../../../database/repositories/entities', () => ({
  getAllEntities: jest.fn(),
}));
jest.mock('../../../database/repositories/interactions', () => ({
  getRecentPhoneInteractions: jest.fn(),
}));
jest.mock('../../../database/repositories/characters', () => ({
  getCharacterProfile: jest.fn(),
  getPrimaryImage: jest.fn().mockResolvedValue(null),
  imageToDataURL: jest.fn().mockReturnValue(null),
}));

import { getAllEntities } from '../../../database/repositories/entities';
import { getRecentPhoneInteractions } from '../../../database/repositories/interactions';

const mockGetAllEntities = getAllEntities as jest.Mock;
const mockGetInteractions = getRecentPhoneInteractions as jest.Mock;

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('ForwardPickerModal — A3 user-entity leak (5-4 §4)', () => {
  it('excludes a user-entity partner but keeps an AI partner', async () => {
    mockGetAllEntities.mockResolvedValue([
      { id: 'ai-partner', alias: 'AI Partner', character_profile_id: 'cp-ai', entity_type: 'ai' },
      { id: 'self-persona', alias: 'My Persona', character_profile_id: 'cp-self', entity_type: 'user' },
    ]);
    // Own identity is `user`; a persona (user entity) is never a forward target.
    mockGetInteractions.mockResolvedValue([
      {
        id: 'int-1',
        interaction_scope: 'private',
        participant_key: 'pk-ai',
        participant_ids: '["user","ai-partner"]',
      },
      {
        id: 'int-2',
        interaction_scope: 'private',
        participant_key: 'pk-self',
        participant_ids: '["user","self-persona"]',
      },
    ]);

    const utils = await render(
      <ForwardPickerModal
        visible
        ownEntityId="user"
        messageText="hi"
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    await flush();

    // Only the AI partner is offered — the user-entity partner is filtered out
    // by the entity_type !== 'user' guard.
    const rows = utils.getAllByTestId('forward-target-row');
    expect(rows).toHaveLength(1);
    expect(utils.getByText('AI Partner')).toBeTruthy();
  });
});
