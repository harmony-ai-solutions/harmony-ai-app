/**
 * EntityModuleSelectorWithActions — entity-context threading (persona-modules
 * 5-1).
 *
 * Verifies that when an `entityId` prop is provided (edit-mode CreateAI) it is
 * threaded into the ModuleConfigEdit navigation params for BOTH the edit action
 * and the "Create new config…" sheet action; and that it is OMITTED when no
 * entity context exists (create mode). The child EntityModuleSelector + theme +
 * navigation are mocked; the component under test is real.
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { EntityModuleSelectorWithActions } from '../EntityModuleSelectorWithActions';

afterEach(cleanup);
beforeEach(cleanup);

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

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, style, ...props }: any) =>
    React.createElement(Text, { style, ...props }, children) };
});

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// Child selector — render a button that triggers the "Create new config…" row
// via the injected onCreateNew, and a status line for the selected id.
jest.mock('../EntityModuleSelector', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    EntityModuleSelector: ({ label, selectedId, onCreateNew }: any) =>
      React.createElement(View, null,
        React.createElement(Text, null, `selected:${selectedId}`),
        React.createElement(TouchableOpacity, {
          testID: 'create-new-config',
          onPress: () => onCreateNew?.(),
          accessibilityRole: 'button',
        }, React.createElement(Text, null, 'create-new')),
      ),
  };
});

const baseProps = {
  label: 'AI model',
  moduleType: 'backend',
  configs: [{ id: 'cfg-1', name: 'GPT-4' }],
  selectedId: 'cfg-1',
  onChange: jest.fn(),
};

describe('EntityModuleSelectorWithActions — entityId threading', () => {
  it('threads entityId into the edit-action navigation params when present', async () => {
    const utils = await render(<EntityModuleSelectorWithActions {...baseProps} entityId="ai-entity-1" />);
    await act(async () => {});

    // Edit pencil (only rendered when a config is selected).
    await fireEvent.press(utils.getByLabelText('Edit AI model configuration'));
    await act(async () => {});

    expect(mockNavigate).toHaveBeenCalledWith('ModuleConfigEdit', {
      moduleType: 'backend',
      configId: 'cfg-1',
      entityId: 'ai-entity-1',
    });
  });

  it('threads entityId into the create-action navigation params when present', async () => {
    const utils = await render(<EntityModuleSelectorWithActions {...baseProps} entityId="ai-entity-1" />);
    await act(async () => {});

    // "Create new config…" row inside the child selector sheet.
    await fireEvent.press(utils.getByTestId('create-new-config'));
    await act(async () => {});

    expect(mockNavigate).toHaveBeenCalledWith('ModuleConfigEdit', {
      moduleType: 'backend',
      entityId: 'ai-entity-1',
    });
  });

  it('omits entityId from navigation params when no entity context exists (create mode)', async () => {
    const utils = await render(<EntityModuleSelectorWithActions {...baseProps} />);
    await act(async () => {});

    await fireEvent.press(utils.getByLabelText('Edit AI model configuration'));
    await act(async () => {});

    expect(mockNavigate).toHaveBeenCalledWith('ModuleConfigEdit', {
      moduleType: 'backend',
      configId: 'cfg-1',
    });
  });
});
