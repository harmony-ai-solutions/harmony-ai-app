/**
 * GreetingEditor + AlternateGreetingsManager — component tests (§3-5/§3-6).
 *
 * GreetingEditor:
 *  - live preview resolves macros via GreetingBubble ({{char}}→name/nickname,
 *    {{user}}→own entity).
 *  - raw field keeps macros visible + highlighted (MacroHighlighter), not
 *    resolved.
 *
 * AlternateGreetingsManager:
 *  - add / edit / delete / move callbacks.
 *  - "default" radio promotes via onPromoteToDefault.
 *  - count badge + empty hint.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { GreetingEditor } from '../GreetingEditor';
import { AlternateGreetingsManager } from '../AlternateGreetingsManager';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
        status: { error: '#ef4444', success: '#22c55e', warning: '#f59e0b' },
      },
    },
  }),
}));

jest.mock('../../themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedCard: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID, ...props }: any) =>
      React.createElement(
        View,
        {
          onPress: () => onPress(),
          accessibilityState: { disabled: !!disabled },
          testID,
          accessibilityRole: 'button',
          ...props,
        },
        React.createElement(Text, { testID: `${testID}-label` }, label),
      ),
  };
});

jest.mock('../../themed/SectionHeader', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    SectionHeader: ({ title, ...props }: any) =>
      React.createElement(Text, { ...props }, title),
  };
});

jest.mock('../../chat/GreetingShimmer', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    GreetingShimmer: () => React.createElement(View, { testID: 'greeting-shimmer-mock' }),
  };
});

jest.mock('../../chat/TypingIndicator', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    TypingIndicator: () => React.createElement(View, { testID: 'typing-indicator-mock' }),
  };
});

describe('GreetingEditor', () => {
  it('resolves macros in the live preview ({{char}}→nickname, {{user}}→own)', async () => {
    const { getByText } = await render(
      <GreetingEditor
        value={'Hello {{char}}, it\'s {{user}}!'}
        onChange={jest.fn()}
        charName="Nix"
        userName="Alex"
      />,
    );
    expect(getByText("Hello Nix, it's Alex!")).toBeTruthy();
  });

  it('keeps the raw field editable with macros visible (highlighted, not resolved)', async () => {
    const { getByTestId, getByText } = await render(
      <GreetingEditor
        value={'{{char}} waves at {{user}}.'}
        onChange={jest.fn()}
        charName="Nix"
        userName="Alex"
      />,
    );
    // The TextInput carries the raw text.
    expect(getByTestId('greeting-editor-input').props.value).toBe('{{char}} waves at {{user}}.');
    // The raw panel shows the macros unchanged (no resolution to Nix/Alex).
    expect(getByText('{{char}} waves at {{user}}.')).toBeTruthy();
  });

  it('forwards edits to onChange', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <GreetingEditor value="" onChange={onChange} charName="Nix" userName="Alex" />,
    );
    await fireEvent.changeText(getByTestId('greeting-editor-input'), 'A new opening');
    expect(onChange).toHaveBeenCalledWith('A new opening');
  });
});

describe('AlternateGreetingsManager', () => {
  const callbacks = {
    onAdd: jest.fn(),
    onRemove: jest.fn(),
    onMove: jest.fn(),
    onEdit: jest.fn(),
    onPromoteToDefault: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderManager = (greetings: string[], firstMes = 'Default opening') =>
    render(
      <AlternateGreetingsManager
        alternateGreetings={greetings}
        firstMes={firstMes}
        charName="Aria"
        userName="Alex"
        {...callbacks}
      />,
    );

  it('shows the count badge and empty hint when there are no alternates', async () => {
    const { getByTestId, queryByTestId } = await renderManager([]);
    expect(getByTestId('alternate-greetings-count').props.children).toBe(0);
    expect(getByTestId('alternate-greetings-empty')).toBeTruthy();
    expect(queryByTestId('alt-greeting-0')).toBeNull();
  });

  it('add → onAdd', async () => {
    const { getByTestId } = await renderManager([]);
    await fireEvent.press(getByTestId('alternate-greetings-add'));
    expect(callbacks.onAdd).toHaveBeenCalledTimes(1);
  });

  it('delete → onRemove(index); move → onMove(index, direction)', async () => {
    const { getByTestId } = await renderManager(['one', 'two', 'three']);
    await fireEvent.press(getByTestId('alt-greeting-delete-1'));
    expect(callbacks.onRemove).toHaveBeenCalledWith(1);

    await fireEvent.press(getByTestId('alt-greeting-move-up-2'));
    expect(callbacks.onMove).toHaveBeenCalledWith(2, -1);

    await fireEvent.press(getByTestId('alt-greeting-move-down-0'));
    expect(callbacks.onMove).toHaveBeenCalledWith(0, 1);
  });

  it('edit-inline commits the trimmed value via onEdit(index, value)', async () => {
    const { getByTestId } = await renderManager(['one', 'two']);
    await fireEvent.press(getByTestId('alt-greeting-edit-1'));
    await fireEvent.changeText(getByTestId('alt-greeting-input-1'), '  edited two  ');
    await fireEvent.press(getByTestId('alt-greeting-save-1'));
    expect(callbacks.onEdit).toHaveBeenCalledWith(1, 'edited two');
  });

  it('mark-default radio → onPromoteToDefault(greeting)', async () => {
    const { getByTestId } = await renderManager(['one', 'two']);
    await fireEvent.press(getByTestId('alt-greeting-default-1'));
    expect(callbacks.onPromoteToDefault).toHaveBeenCalledWith('two');
  });
});
