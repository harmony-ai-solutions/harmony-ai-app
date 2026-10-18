/**
 * CatalogModelSelect — catalog-backed model picker (provider-registry 2-1).
 *
 * Covers the three behaviours the phase doc calls out for the model field:
 *  - the picker renders the catalog options (+ "Custom…");
 *  - the "Custom…" escape hatch keeps free text entry;
 *  - the value round-trips (selection updates the field; a manual value is kept).
 * Plus the context-window note chip (provenance label `catalog`) and the
 * no-catalog free-text fallback.
 */

import React, { useState } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  CatalogModelSelect,
  CUSTOM_MODEL_INPUT_TESTID,
  formatContextWindow,
} from '../CatalogModelSelect';

afterEach(cleanup);
beforeEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
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

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

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

describe('formatContextWindow', () => {
  it('formats token counts compactly', () => {
    expect(formatContextWindow(128000)).toBe('128K');
    expect(formatContextWindow(8192)).toBe('8.2K');
    expect(formatContextWindow(500000)).toBe('500K');
    expect(formatContextWindow(1000000)).toBe('1M');
    expect(formatContextWindow(1050000)).toBe('1.05M');
    expect(formatContextWindow(512)).toBe('512');
  });
});

describe('CatalogModelSelect — catalog-backed picker', () => {
  it('renders the catalog options plus a Custom… option', async () => {
    // STT's OpenAI catalog is short, so the trailing "Custom…" row is within
    // the FlatList's initial render window.
    const utils = await render(
      <CatalogModelSelect
        providerType="openai"
        moduleType="stt"
        value=""
        onChange={jest.fn()}
        label="Model"
      />,
    );

    // Picker row present (placeholder shown while empty)
    fireEvent.press(utils.getByLabelText('Model'));

    await waitFor(() => expect(utils.getByText('gpt-transcribe')).toBeTruthy());
    expect(utils.getByText('modelCustom')).toBeTruthy();
  });

  it('round-trips the selected value through onChange', async () => {
    const Harness = () => {
      const [value, setValue] = useState('');
      return (
        <CatalogModelSelect
          providerType="openai"
          moduleType="backend"
          value={value}
          onChange={setValue}
          label="Model"
        />
      );
    };

    const utils = await render(<Harness />);
    fireEvent.press(utils.getByLabelText('Model'));
    await waitFor(() => expect(utils.getByText('gpt-6-astra')).toBeTruthy());

    fireEvent.press(utils.getByText('gpt-6-astra'));

    // The picker row now displays the selected model id, and the modal closed.
    await waitFor(() => expect(utils.getByText('gpt-6-astra')).toBeTruthy());
    expect(utils.queryByText('modelCustom')).toBeNull();
  });

  it('keeps free text via the Custom… escape hatch', async () => {
    const onChange = jest.fn();
    const utils = await render(
      <CatalogModelSelect
        providerType="openai"
        moduleType="stt"
        value=""
        onChange={onChange}
        label="Model"
      />,
    );

    fireEvent.press(utils.getByLabelText('Model'));
    await waitFor(() => expect(utils.getByText('modelCustom')).toBeTruthy());
    fireEvent.press(utils.getByText('modelCustom'));

    const input = await waitFor(() => utils.getByTestId(CUSTOM_MODEL_INPUT_TESTID));
    fireEvent.changeText(input, 'my-private-model');

    expect(onChange).toHaveBeenCalledWith('my-private-model');
  });

  it('keeps a manual (non-catalog) value selectable in the picker', async () => {
    const utils = await render(
      <CatalogModelSelect
        providerType="openai"
        moduleType="backend"
        value="my-private-model"
        onChange={jest.fn()}
        label="Model"
      />,
    );

    // The saved value round-trips as the selected option (not a free-text box).
    expect(utils.getByText('my-private-model')).toBeTruthy();
    expect(utils.queryByTestId(CUSTOM_MODEL_INPUT_TESTID)).toBeNull();
  });

  it('falls back to free text when the catalog has no entries', async () => {
    const utils = await render(
      <CatalogModelSelect
        providerType="openrouter"
        moduleType="backend"
        value=""
        onChange={jest.fn()}
        label="Model"
      />,
    );

    expect(utils.getByTestId(CUSTOM_MODEL_INPUT_TESTID)).toBeTruthy();
    expect(utils.getByText('modelNoModels')).toBeTruthy();
  });

  it('renders a context-window chip (provenance catalog) for a known model', async () => {
    const utils = await render(
      <CatalogModelSelect
        providerType="openai"
        moduleType="backend"
        value="gpt-4o"
        onChange={jest.fn()}
        label="Model"
      />,
    );

    // gpt-4o carries a 128000-token context in the catalog.
    expect(utils.getByText(/modelContextChip/)).toBeTruthy();
    expect(utils.getByText(/128K/)).toBeTruthy();
  });

  it('renders no context chip when the selected model has no context', async () => {
    const utils = await render(
      <CatalogModelSelect
        providerType="openai"
        moduleType="imagination"
        value="gpt-image-2"
        onChange={jest.fn()}
        label="Model"
      />,
    );

    expect(utils.queryByText(/modelContextChip/)).toBeNull();
  });
});
