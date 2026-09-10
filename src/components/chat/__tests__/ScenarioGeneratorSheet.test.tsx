/**
 * ScenarioGeneratorSheet — RNTL render tests (§2-4).
 *
 * Verifies:
 *  - open/close (paper Modal visible prop; onClose on dismiss).
 *  - "Surprise me" clears all inputs and emits `null` (random / no guided).
 *  - Generate emits the guided payload shape (mood[], setting, relationship,
 *    timeOfDay, whoFirst, premise) when any input is filled; `null` when all
 *    inputs are empty.
 *  - generating label while in flight.
 *  - reduced-motion → static content (cross-fade via paper Modal's fade — no
 *    slide wrapper); default → slide wrapper present.
 *
 * NOTE: RNTL v14 `fireEvent` is async — every interaction must be awaited so
 * the act() flush completes (unawaited events bleed into later tests).
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ScenarioGeneratorSheet } from '../ScenarioGeneratorSheet';

// Controllable reduced-motion flag (plain function mock — no jest.fn reset
// dance, which proved to leave state behind across tests).
let mockReduceMotionFlag = false;

jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotionFlag,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
      },
    },
  }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
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

jest.mock('../../config/SelectPicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SelectPicker: ({ value, onChange }: any) =>
      React.createElement(View, {
        testID: 'scenario-relationship-picker',
        value,
        onChange,
      }),
  };
});

// jest.setup.js mocks react-native-paper without Modal/Portal — override it here.
jest.mock('react-native-paper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Provider: ({ children }: any) => children,
    Portal: ({ children }: any) => React.createElement(View, null, children),
    Modal: ({ children, ...props }: any) =>
      props.visible ? React.createElement(View, { ...props }, children) : null,
  };
});

const onGenerate = jest.fn();
const onClose = jest.fn();

async function renderSheet(overrides: Partial<{ open: boolean }> = {}) {
  return render(
    <ScenarioGeneratorSheet
      open={overrides.open ?? true}
      onClose={onClose}
      onGenerate={onGenerate}
    />,
  );
}

describe('ScenarioGeneratorSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReduceMotionFlag = false;
  });

  it('renders the sheet when open and nothing when closed', async () => {
    const { getByTestId, queryByTestId } = await renderSheet({ open: true });
    expect(getByTestId('scenario-sheet')).toBeTruthy();
    expect(getByTestId('scenario-sheet').props.visible).toBe(true);

    const closed = await renderSheet({ open: false });
    expect(closed.queryByTestId('scenario-sheet')).toBeNull();
  });

  it('dismiss → onClose', async () => {
    const { getByTestId } = await renderSheet();
    await act(async () => {
      getByTestId('scenario-sheet').props.onDismiss();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Surprise me clears all inputs and emits null (random)', async () => {
    const { getByTestId } = await renderSheet();
    // Fill the form.
    await fireEvent.press(getByTestId('scenario-sheet-mood-Warm'));
    await fireEvent.press(getByTestId('scenario-sheet-mood-Mysterious'));
    await fireEvent.changeText(getByTestId('scenario-sheet-setting-input'), 'Cafe');
    await fireEvent.changeText(getByTestId('scenario-sheet-premise-input'), 'We meet again');

    await act(async () => {
      getByTestId('scenario-sheet-surprise').props.onPress();
    });

    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith(null);

    // Inputs cleared.
    expect(
      getByTestId('scenario-sheet-mood-Warm').props.accessibilityState.selected,
    ).toBe(false);
    expect(getByTestId('scenario-sheet-setting-input').props.value).toBe('');
    expect(getByTestId('scenario-sheet-premise-input').props.value).toBe('');
  });

  it('Generate emits the guided payload shape when inputs are filled (directed)', async () => {
    const { getByTestId } = await renderSheet();
    await fireEvent.press(getByTestId('scenario-sheet-mood-Warm'));
    await fireEvent.press(getByTestId('scenario-sheet-mood-Playful'));
    await fireEvent.changeText(getByTestId('scenario-sheet-setting-input'), 'Cafe at midnight');
    await act(async () => {
      getByTestId('scenario-relationship-picker').props.onChange('old-friends');
    });
    await fireEvent.press(getByTestId('scenario-sheet-time-Night'));
    await fireEvent.press(getByTestId('scenario-sheet-who-user'));
    await fireEvent.changeText(getByTestId('scenario-sheet-premise-input'), 'We meet again');

    await fireEvent.press(getByTestId('scenario-sheet-generate'));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith({
      mood: ['Warm', 'Playful'],
      setting: 'Cafe at midnight',
      relationship: 'old-friends',
      timeOfDay: 'Night',
      whoFirst: 'user',
      premise: 'We meet again',
    });
  });

  it('Generate emits null (random) when all guided inputs are empty', async () => {
    const { getByTestId } = await renderSheet();
    await fireEvent.press(getByTestId('scenario-sheet-generate'));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith(null);
  });

  it('shows the generating label while in flight', async () => {
    const { getByTestId } = await renderSheet();
    expect(getByTestId('scenario-sheet-generate-label').props.children).toBe('generate');
    await fireEvent.press(getByTestId('scenario-sheet-generate'));
    expect(getByTestId('scenario-sheet-generate-label').props.children).toBe('generating');
  });

  it('default → slide wrapper present', async () => {
    const { getByTestId, queryByTestId } = await renderSheet();
    expect(getByTestId('scenario-sheet-content-slide')).toBeTruthy();
    expect(queryByTestId('scenario-sheet-content-static')).toBeNull();
  });

  it('reduced-motion → cross-fade (no slide wrapper)', async () => {
    mockReduceMotionFlag = true;
    const { getByTestId, queryByTestId } = await renderSheet();
    expect(getByTestId('scenario-sheet-content-static')).toBeTruthy();
    expect(queryByTestId('scenario-sheet-content-slide')).toBeNull();
  });

  it('resets the form when reopened', async () => {
    const first = await renderSheet();
    await fireEvent.press(first.getByTestId('scenario-sheet-mood-Warm'));
    await fireEvent.changeText(first.getByTestId('scenario-sheet-setting-input'), 'Cafe');
    expect(
      first.getByTestId('scenario-sheet-mood-Warm').props.accessibilityState.selected,
    ).toBe(true);

    // Reopen (open=false → open=true). Each rerender commits separately so the
    // sheet's reset-on-open effect actually observes the open transition.
    await first.rerender(
      <ScenarioGeneratorSheet open={false} onClose={onClose} onGenerate={onGenerate} />,
    );
    await act(async () => {
      first.rerender(
        <ScenarioGeneratorSheet open={true} onClose={onClose} onGenerate={onGenerate} />,
      );
    });

    expect(
      first.getByTestId('scenario-sheet-mood-Warm').props.accessibilityState.selected,
    ).toBe(false);
    expect(first.getByTestId('scenario-sheet-setting-input').props.value).toBe('');
  });
});
