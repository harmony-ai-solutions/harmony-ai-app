/**
 * AccountPicker — managed/single/multi account states (Phase 2-3).
 *
 * Covers:
 *  - managed provider types never render "+ Add account…" and instead show a
 *    compact single-line status bar with an Active / Sign in required badge;
 *  - one unmanaged account renders a compact single-row bar with an inline add;
 *  - no accounts render the create prompt; several render selectable chips.
 */

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { AccountPicker } from '../AccountPicker';

afterEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${Object.values(vars).join(',')})` : key,
  }),
}));

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

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
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

const account = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  type: 'openai',
  name: 'Work key',
  api_key: 'sk-abcdefgh1234',
  base_url: '',
  extra: '{}',
  created_at: null,
  updated_at: null,
  deleted_at: null,
  ...over,
});

const baseProps = {
  slot: 'provider',
  accounts: [],
  selectedId: null,
  onSelect: jest.fn(),
  onAddAccount: jest.fn(),
};

async function renderPicker(overrides: Record<string, unknown> = {}) {
  const props = { ...baseProps, ...overrides };
  return render(<AccountPicker {...(props as any)} />);
}

describe('AccountPicker — managed accounts', () => {
  it('hides + Add account… and shows the system-managed status bar', async () => {
    const utils = await renderPicker({
      providerType: 'soulbitscloud',
      accounts: [account({ id: 'cloud', type: 'soulbitscloud', name: 'Soulbits Cloud', api_key: 'paseto' })],
    });

    expect(utils.getByTestId('account-managed-provider')).toBeTruthy();
    expect(utils.queryByTestId('account-add-provider')).toBeNull();
    expect(utils.getByText('Account: Soulbits Cloud')).toBeTruthy();
    expect(utils.getByText('(system-managed)')).toBeTruthy();
    expect(utils.getByText('Active')).toBeTruthy();
  });

  it('shows Sign in required when the managed account has no token', async () => {
    const utils = await renderPicker({
      providerType: 'soulbitscloud',
      accounts: [account({ id: 'cloud', type: 'soulbitscloud', name: 'Soulbits Cloud', api_key: '' })],
    });

    expect(utils.getByText('Sign in required')).toBeTruthy();
    expect(utils.queryByText('Active')).toBeNull();
  });

  it('still shows the managed bar (no add) when the managed account is absent', async () => {
    const utils = await renderPicker({
      providerType: 'soulbitscloud',
      accounts: [],
    });

    expect(utils.getByTestId('account-managed-provider')).toBeTruthy();
    expect(utils.getByText('Account: Soulbits Cloud')).toBeTruthy();
    expect(utils.getByText('Sign in required')).toBeTruthy();
    expect(utils.queryByTestId('account-add-provider')).toBeNull();
  });
});

describe('AccountPicker — unmanaged accounts', () => {
  it('renders the create prompt plus add button when no account exists', async () => {
    const utils = await renderPicker({ providerType: 'openai' });

    expect(utils.getByTestId('account-none-provider')).toBeTruthy();
    expect(utils.getByTestId('account-add-provider')).toBeTruthy();
  });

  it('collapses one account to a compact single row with an inline add', async () => {
    const utils = await renderPicker({
      providerType: 'openai',
      accounts: [account({ name: 'Personal key' })],
    });

    expect(utils.getByTestId('account-single-provider')).toBeTruthy();
    // Back-compat caption test id used by the module-config screen suite.
    expect(utils.getByTestId('account-collapse-provider')).toBeTruthy();
    expect(utils.getByText(/Account: Personal key ·/)).toBeTruthy();
    expect(utils.getByTestId('account-add-provider')).toBeTruthy();
  });

  it('renders selectable chips for several accounts', async () => {
    const onSelect = jest.fn();
    const utils = await renderPicker({
      providerType: 'openai',
      accounts: [
        account({ id: 'a1', name: 'Personal' }),
        account({ id: 'a2', name: 'Work' }),
      ],
      onSelect,
    });

    expect(utils.getByTestId('account-option-provider-a1')).toBeTruthy();
    expect(utils.getByTestId('account-option-provider-a2')).toBeTruthy();
    expect(utils.queryByTestId('account-single-provider')).toBeNull();

    await fireEvent.press(utils.getByTestId('account-option-provider-a2'));
    expect(onSelect).toHaveBeenCalledWith('a2');
  });
});
