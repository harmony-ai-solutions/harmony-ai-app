/**
 * AccountForm — shared account form (provider-registry 6-2).
 *
 * Renders the per-type account fields, validates inline per the §3.1 matrix,
 * emits the account write body, and renders managed types read-only.
 */

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccountForm } from '../AccountForm';

afterEach(async () => {
  await cleanup();
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
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
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

// ThemedButton → a plain pressable so the test can tap by testID.
jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, testID, disabled }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, testID, disabled },
        React.createElement(Text, null, label),
      ),
  };
});

describe('AccountForm — validation per matrix', () => {
  it('blocks submit and flags the missing api_key', async () => {
    const onSubmit = jest.fn();
    const utils = await render(<AccountForm type="openai" onSubmit={onSubmit} />);

    await fireEvent.changeText(utils.getByTestId('account-field-name'), 'Personal');
    await fireEvent.press(utils.getByTestId('account-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(utils.getByTestId('account-error-api_key')).toBeTruthy());
  });

  it('emits the account write body once valid', async () => {
    const onSubmit = jest.fn();
    const utils = await render(<AccountForm type="openai" onSubmit={onSubmit} />);

    await fireEvent.changeText(utils.getByTestId('account-field-name'), 'Personal');
    await fireEvent.changeText(utils.getByTestId('account-field-api_key'), 'sk-1234567890');
    await fireEvent.changeText(utils.getByTestId('account-field-org'), 'org-1');
    await fireEvent.press(utils.getByTestId('account-submit'));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Personal',
        api_key: 'sk-1234567890',
        extra: { org: 'org-1' },
      }),
    );
  });

  it('requires base_url for self-hosted types', async () => {
    const onSubmit = jest.fn();
    const utils = await render(<AccountForm type="ollama" onSubmit={onSubmit} />);

    await fireEvent.changeText(utils.getByTestId('account-field-name'), 'Home server');
    await fireEvent.press(utils.getByTestId('account-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(utils.getByTestId('account-error-base_url')).toBeTruthy());
  });

  it('clears a field error once the value is entered', async () => {
    const utils = await render(<AccountForm type="openai" onSubmit={jest.fn()} />);

    await fireEvent.press(utils.getByTestId('account-submit'));
    await waitFor(() => expect(utils.getByTestId('account-error-name')).toBeTruthy());

    await fireEvent.changeText(utils.getByTestId('account-field-name'), 'x');
    await waitFor(() => expect(utils.queryByTestId('account-error-name')).toBeNull());
  });

  it('seeds values from an existing account (edit mode)', async () => {
    const utils = await render(
      <AccountForm
        type="openai"
        initialValues={{ name: 'Work', api_key: 'sk-existing' }}
        onSubmit={jest.fn()}
      />,
    );
    expect(utils.getByDisplayValue('Work')).toBeTruthy();
    expect(utils.getByDisplayValue('sk-existing')).toBeTruthy();
  });
});

describe('AccountForm — managed + read-only fields', () => {
  it('renders soulbitscloud read-only with no submit action', async () => {
    const utils = await render(<AccountForm type="soulbitscloud" onSubmit={jest.fn()} />);

    expect(utils.getByTestId('account-managed-hint')).toBeTruthy();
    expect(utils.queryByTestId('account-submit')).toBeNull();
    expect(utils.getByTestId('account-field-api_key').props.editable).toBe(false);
  });

  it('renders the engine-persisted comfyui_mode read-only', async () => {
    const utils = await render(<AccountForm type="comfyui" onSubmit={jest.fn()} />);

    expect(utils.getByTestId('account-field-comfyui_mode').props.editable).toBe(false);
    // Auth style select is present (query by its label).
    expect(utils.getByLabelText('Auth Style')).toBeTruthy();
  });
});
