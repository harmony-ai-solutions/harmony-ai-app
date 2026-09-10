/**
 * PersonaRow — richer persona row (My Profile, recreates the 5-4-deleted
 * component with review fixes).
 *
 * Verifies:
 *  - renders the persona name + description
 *  - renders the "Active" accent chip ONLY when isActive
 *  - tapping the ROW fires the activate callback (settings-side switch)
 *  - tapping the trailing pencil fires the edit callback
 */

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { PersonaRow } from '../profile/PersonaRow';

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

// Themed text — plain RN primitive.
jest.mock('../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
    ThemedView: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

// Expose the avatar name for assertion.
jest.mock('../profile/ProfileAvatar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ProfileAvatar: ({ name }: any) => React.createElement(Text, null, `avatar:${name}`),
  };
});

describe('PersonaRow', () => {
  const onPress = jest.fn();
  const onEditPress = jest.fn();

  beforeEach(() => {
    onPress.mockClear();
    onEditPress.mockClear();
  });

  it('renders the persona name and description', async () => {
    const { getByText } = await render(
      <PersonaRow
        name="Mystic Mara"
        description="A mystic healer"
        onPress={onPress}
        onEditPress={onEditPress}
      />,
    );

    expect(getByText('Mystic Mara')).toBeTruthy();
    expect(getByText('A mystic healer')).toBeTruthy();
    expect(getByText('avatar:Mystic Mara')).toBeTruthy();
  });

  it('renders the Active chip only when isActive', async () => {
    const active = await render(
      <PersonaRow name="Mara" description="d" isActive onPress={onPress} onEditPress={onEditPress} />,
    );
    // i18n is mocked to return the key, so the chip text is the key itself.
    expect(active.getByText('personaActiveChip')).toBeTruthy();

    const inactive = await render(
      <PersonaRow name="Mara" description="d" onPress={onPress} onEditPress={onEditPress} />,
    );
    expect(inactive.queryByText('personaActiveChip')).toBeNull();
  });

  it('tapping the row fires the activate callback', async () => {
    const { getByTestId } = await render(
      <PersonaRow name="Mara" description="d" onPress={onPress} onEditPress={onEditPress} />,
    );

    fireEvent.press(getByTestId('persona-row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('tapping the pencil fires the edit callback', async () => {
    const { getByTestId } = await render(
      <PersonaRow name="Mara" description="d" onPress={onPress} onEditPress={onEditPress} />,
    );

    fireEvent.press(getByTestId('persona-row-edit'));
    expect(onEditPress).toHaveBeenCalledTimes(1);
  });
});
