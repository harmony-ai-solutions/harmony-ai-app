/**
 * VoicePicker — ElevenLabs account voice picker (provider-registry 6-3).
 *
 * Covers the owner-reported gap: once the account catalogue is fetched the
 * picker only offered the dropdown, so a voice id from the ElevenLabs
 * dashboard (or a voice missing from a stale fetch) could not be entered.
 * The free-text "voice id" input must stay available in BOTH states:
 *  - not fetched / empty catalogue (already did), and
 *  - a populated catalogue.
 */

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { VOICE_INPUT_TESTID, VOICE_STALE_TESTID, VoicePicker } from '../VoicePicker';

afterEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${Object.values(vars).join(',')})` : key,
  }),
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
      },
    },
  }),
}));

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

// The real SelectPicker opens a Modal; render its value as a static row so the
// test stays focused on the free-text fallback.
jest.mock('../SelectPicker', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    SelectPicker: ({ value, options }: any) =>
      React.createElement(
        Text,
        { testID: 'select-picker-stub' },
        options.find((o: any) => o.id === value)?.name ?? 'none',
      ),
  };
});

const voices = [
  { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
  { voice_id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi' },
];

describe('VoicePicker — manual voice id entry', () => {
  it('offers free text before a catalogue has been fetched', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <VoicePicker label="Voice" value="" onChange={onChange} voices={null} />,
    );

    const input = getByTestId(VOICE_INPUT_TESTID);
    fireEvent.changeText(input, 'custom-voice-id');
    expect(onChange).toHaveBeenLastCalledWith('custom-voice-id');
  });

  it('keeps the free text input alongside a populated catalogue', async () => {
    const onChange = jest.fn();
    const { getByTestId, getByText } = await render(
      <VoicePicker
        label="Voice"
        value="21m00Tcm4TlvDq8ikWAM"
        onChange={onChange}
        voices={voices}
      />,
    );

    // Dropdown shows the saved voice…
    expect(getByText('Rachel')).toBeTruthy();
    // …and the manual id entry is still available.
    const input = getByTestId(VOICE_INPUT_TESTID);
    fireEvent.changeText(input, 'pasted-from-dashboard');
    expect(onChange).toHaveBeenLastCalledWith('pasted-from-dashboard');
  });

  it('flags a saved voice missing from the fetched catalogue', async () => {
    const { getByTestId } = await render(
      <VoicePicker
        label="Voice"
        value="deleted-voice"
        onChange={jest.fn()}
        voices={voices}
        stale
      />,
    );

    expect(getByTestId(VOICE_STALE_TESTID)).toBeTruthy();
  });
});
