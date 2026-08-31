/**
 * PersonaSwitcherModal — 5-4 §2 default-row + A3 list tests.
 *
 * Verifies:
 *  - the default "chat as my own profile" row renders the built-in `user`
 *    entity's real profile name + avatar (from getUserEntities — the
 *    engine-seeded "You" profile once synced)
 *  - the built-in `user` is EXCLUDED from the persona list (no duplicate row)
 */

import React from 'react';
import { act, cleanup, render } from '@testing-library/react-native';
import { PersonaSwitcherModal } from '../modals/PersonaSwitcherModal';
import type { Persona } from '../../database/repositories/userEntities';

afterEach(cleanup);
beforeEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../utils/logger', () => ({
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

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('../../contexts/ThemeContext', () => ({
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

jest.mock('../../utils/haptics', () => ({
  hapticLightPress: jest.fn(),
}));

// Themed components — render plain RN primitives so theme internals (headerOpacity
// etc.) don't leak into the test.
jest.mock('../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

// Expose name + avatar uri on the avatar so the default row is assertable.
jest.mock('../profile/ProfileAvatar', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ProfileAvatar: ({ name, uri }: any) =>
      React.createElement(
        View,
        null,
        React.createElement(Text, null, `avatar:${name}`),
        uri ? React.createElement(Text, null, `dataurl:${uri}`) : null,
      ),
  };
});

jest.mock('../../database/repositories/userEntities', () => ({
  getUserEntities: jest.fn(),
}));

import { getUserEntities } from '../../database/repositories/userEntities';

const mockGetUserEntities = getUserEntities as jest.Mock;

const USER_ENTITY: Persona = {
  id: 'user',
  name: 'You',
  description: 'Your default persona',
  personality: '',
  avatarUri: 'data:image/png;base64,YWJj',
  isActive: true,
};
const MARA: Persona = {
  id: 'Mystic Mara',
  name: 'Mystic Mara',
  description: 'A mystic healer',
  personality: 'Calm, wise',
  avatarUri: null,
  isActive: false,
};

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderModal(activePersonaId: string | null) {
  const utils = await render(
    <PersonaSwitcherModal
      visible
      activePersonaId={activePersonaId}
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  await flush();
  return utils;
}

describe('PersonaSwitcherModal — default row (5-4 §2)', () => {
  it('renders the built-in user entity profile name + avatar in the default row', async () => {
    mockGetUserEntities.mockResolvedValue([USER_ENTITY, MARA]);

    const utils = await renderModal('user');

    // Default row (testID persona-switcher-user) shows the real profile name.
    expect(utils.getByText('avatar:You')).toBeTruthy();
    expect(utils.getByText('dataurl:data:image/png;base64,YWJj')).toBeTruthy();
    // The row title uses the profile name (no fallback key text).
    const userRow = utils.getByTestId('persona-switcher-user');
    expect(userRow).toBeTruthy();
  });

  it('excludes the built-in user from the persona list (no duplicate)', async () => {
    mockGetUserEntities.mockResolvedValue([USER_ENTITY, MARA]);

    const utils = await renderModal(null);

    // Only the create-able persona appears as a list row — the built-in user is
    // dedicated to the default row above (A3: never duplicated).
    const rows = utils.getAllByTestId('persona-switcher-row');
    expect(rows).toHaveLength(1);
    expect(utils.getByText('avatar:Mystic Mara')).toBeTruthy();
  });
});
