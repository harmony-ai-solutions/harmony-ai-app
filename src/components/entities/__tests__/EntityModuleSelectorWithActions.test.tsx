/**
 * EntityModuleSelectorWithActions — the partner-STT confirm gate (4-4).
 *
 * The partner's STT slot does NOT drive the user's chat voice input (the
 * global user config in Settings › Voice input does), so a gated row must:
 *  - render LOCKED by default: no "✎ Edit config", muted selector, hint;
 *  - open the explainer modal on tap, and stay locked on Cancel;
 *  - become a normal editable row (edit link back, selector ungated) only
 *    after the explicit confirm — for this screen visit, nothing persisted.
 * Rows without a gate keep the old behavior.
 *
 * NOTE on `fireEvent`: in @testing-library/react-native v14 `fireEvent.press`
 * is ASYNC and wraps the handler in `act`. Every press MUST be awaited —
 * a floating press promise leaves React's act scope un-flushed, which poisons
 * every later render in the same file.
 */

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { EntityModuleSelectorWithActions } from '../EntityModuleSelectorWithActions';

afterEach(cleanup);

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
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

jest.mock('../../../utils/haptics', () => ({
  setHapticFeedbackEnabled: jest.fn(),
  hapticLightPress: jest.fn(),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

// The inner selector is covered by its own tests; expose the lock state and a
// tap target so the GATE wiring (this component) is what's under test.
jest.mock('../EntityModuleSelector', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    EntityModuleSelector: ({
      locked,
      onLockedPress,
      onChange,
      onCreateNew,
    }: any) =>
      React.createElement(
        TouchableOpacity,
        {
          testID: 'ems',
          onPress: () => (locked ? onLockedPress?.() : onChange?.('c2')),
        },
        React.createElement(Text, { testID: 'ems-locked' }, `locked:${Boolean(locked)}`),
        onCreateNew
          ? React.createElement(Text, { testID: 'ems-create' })
          : null,
      ),
  };
});

const configs = [
  { id: 'c1', name: 'Persona voice input', subtitle: 'ElevenLabs + VAD: Silero' },
  { id: 'c2', name: 'FasterWhisper Local' },
];

const gate = {
  title: "Change Nova's STT config?",
  message:
    "When you chat, your speech is transcribed with the global user Voice input config (Settings › Voice input) — not this one. Nova's STT wiring only handles audio received by Nova directly, e.g. via Game Plugin.",
  confirmLabel: 'Change anyway',
  cancelLabel: 'Cancel',
  lockedHint: 'Your chat voice input is set in Settings › Voice input.',
};

const baseProps = {
  label: 'Speech-to-Text (STT)',
  moduleType: 'stt',
  configs,
  selectedId: 'c1',
  onChange: jest.fn(),
};

beforeEach(() => {
  mockNavigate.mockClear();
});

describe('confirmGate — locked until explicitly confirmed', () => {
  it('renders locked by default: no edit link, muted selector, hint', async () => {
    const { getByTestId, queryByTestId, getByText } = await render(
      <EntityModuleSelectorWithActions {...baseProps} confirmGate={gate} />,
    );

    expect(getByTestId('ems-locked').props.children).toBe('locked:true');
    expect(queryByTestId('edit-module-config-stt')).toBeNull();
    expect(getByText(gate.lockedHint as string)).toBeTruthy();
  });

  it('stays locked when the explainer is cancelled', async () => {
    const { getByTestId, queryByTestId, queryByText } = await render(
      <EntityModuleSelectorWithActions {...baseProps} confirmGate={gate} />,
    );

    await fireEvent.press(getByTestId('ems'));
    expect(queryByText(gate.title)).toBeTruthy();

    await fireEvent.press(getByTestId('gate-cancel-stt'));

    expect(getByTestId('ems-locked').props.children).toBe('locked:true');
    expect(queryByTestId('edit-module-config-stt')).toBeNull();
    expect(queryByText(gate.lockedHint as string)).toBeTruthy();
    expect(queryByText(gate.title)).toBeNull();
  });

  it('unlocks on confirm: edit link back, selector ungated, hint gone', async () => {
    const { getByTestId, queryByText } = await render(
      <EntityModuleSelectorWithActions {...baseProps} confirmGate={gate} />,
    );

    await fireEvent.press(getByTestId('ems'));
    await fireEvent.press(getByTestId('gate-confirm-stt'));

    expect(getByTestId('ems-locked').props.children).toBe('locked:false');
    expect(getByTestId('edit-module-config-stt')).toBeTruthy();
    expect(queryByText(gate.lockedHint as string)).toBeNull();
    expect(queryByText(gate.title)).toBeNull();
  });

  it('keeps the modal copy verbatim (the owner-specified wording)', async () => {
    const { getByTestId, getByText } = await render(
      <EntityModuleSelectorWithActions {...baseProps} confirmGate={gate} />,
    );

    await fireEvent.press(getByTestId('ems'));

    expect(getByText(gate.title)).toBeTruthy();
    expect(getByText(gate.message)).toBeTruthy();
    expect(getByText(gate.confirmLabel)).toBeTruthy();
    expect(getByText(gate.cancelLabel)).toBeTruthy();
  });
});

describe('ungated rows — unchanged behavior', () => {
  it('shows the edit link immediately when a config is selected', async () => {
    const { getByTestId, queryByText } = await render(
      <EntityModuleSelectorWithActions {...baseProps} />,
    );

    expect(getByTestId('ems-locked').props.children).toBe('locked:false');
    expect(getByTestId('edit-module-config-stt')).toBeTruthy();
    expect(queryByText(gate.lockedHint as string)).toBeNull();
  });

  it('navigates to the detail editor from the edit link', async () => {
    const { getByTestId } = await render(
      <EntityModuleSelectorWithActions {...baseProps} />,
    );

    await fireEvent.press(getByTestId('edit-module-config-stt'));

    expect(mockNavigate).toHaveBeenCalledWith('ModuleConfigEdit', {
      moduleType: 'stt',
      configId: 'c1',
    });
  });
});
