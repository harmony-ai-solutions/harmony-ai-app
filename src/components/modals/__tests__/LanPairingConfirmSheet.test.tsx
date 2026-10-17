/**
 * LanPairingConfirmSheet — post-scan LAN confirmation sheet (plan 7-15 §A3).
 *
 * Presentational component; covers the per-state rendering (name / mode /
 * short fingerprint / dataset) and the enrollment offer line (present only when
 * an `enrollment` block exists AND the phone is signed out), plus the
 * confirm/cancel wiring and the `shortFingerprint` helper.
 */

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';

afterEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
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
      },
    },
  }),
}));

jest.mock('../../themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...p }: any) => React.createElement(View, { style, ...p }, children) };
});
jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, style, ...p }: any) => React.createElement(Text, { style, ...p }, children) };
});
jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID }: any) =>
      React.createElement(TouchableOpacity, { testID, onPress, disabled, accessibilityRole: 'button' }, React.createElement(Text, null, label)),
  };
});

import {
  LanPairingConfirmSheet,
  shortFingerprint,
} from '../LanPairingConfirmSheet';
import type { LanSyncPairingPayload } from '../../../services/sync/syncCloudTypes';

const BASE: LanSyncPairingPayload = {
  v: 1,
  kind: 'soulbits-lan',
  ws: '192.168.1.10:28080',
  wss: '192.168.1.10:28443',
  mode: 'secure',
  fingerprint: 'sha256:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
  dataset_id: 'engine-8f0a1b3c5d7e9f02',
  name: 'Studio-PC',
  secret: 'sekret',
  ttl: 300,
};

const ENROLLED: LanSyncPairingPayload = {
  ...BASE,
  enrollment: {
    relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
    grant: 'grant-1',
    account_hint: 'u***@example.com',
  },
};

describe('shortFingerprint', () => {
  it('strips the sha256: prefix and separators, keeping the first 8 hex chars', () => {
    expect(shortFingerprint('sha256:AB:CD:EF:01:23:45:67:89')).toBe('ABCDEF01');
  });
  it('returns an empty string when absent', () => {
    expect(shortFingerprint(undefined)).toBe('');
  });
});

describe('LanPairingConfirmSheet', () => {
  it('renders the desktop name, mode label, short fingerprint and dataset', async () => {
    const utils = await render(
      <LanPairingConfirmSheet
        visible
        payload={BASE}
        signedIn
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(utils.getByTestId('lan-confirm-name').props.children).toBe(
      'lanConfirmTitle:{"name":"Studio-PC"}',
    );
    expect(utils.getByTestId('lan-confirm-mode').props.children).toBe('modeLabelSecure');
    expect(utils.getByTestId('lan-confirm-fingerprint').props.children).toBe('ABCDEF01');
    expect(utils.getByTestId('lan-confirm-dataset').props.children).toBe('engine-8f0a1b3c5d7e9f02');
  });

  it('hides the fingerprint row when the payload has no fingerprint', async () => {
    const { fingerprint, ...noTls } = BASE;
    const utils = await render(
      <LanPairingConfirmSheet visible payload={noTls} signedIn onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(utils.queryByTestId('lan-confirm-fingerprint')).toBeNull();
  });

  it('renders the plain-language label for an unencrypted payload', async () => {
    const utils = await render(
      <LanPairingConfirmSheet
        visible
        payload={{ ...BASE, mode: 'unencrypted', fingerprint: undefined }}
        signedIn
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(utils.getByTestId('lan-confirm-mode').props.children).toBe('modeLabelUnencrypted');
  });

  it('offers enrollment when the desktop is signed in AND the phone is signed out', async () => {
    const signedOut = await render(
      <LanPairingConfirmSheet visible payload={ENROLLED} signedIn={false} onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(signedOut.getByTestId('lan-confirm-enroll-offer')).toBeTruthy();
  });

  it('does not offer enrollment when the phone is already signed in', async () => {
    const signedIn = await render(
      <LanPairingConfirmSheet visible payload={ENROLLED} signedIn onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(signedIn.queryByTestId('lan-confirm-enroll-offer')).toBeNull();
  });

  it('offers nothing when there is no enrollment block', async () => {
    const utils = await render(
      <LanPairingConfirmSheet visible payload={BASE} signedIn={false} onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(utils.queryByTestId('lan-confirm-enroll-offer')).toBeNull();
  });

  it('fires confirm and cancel callbacks', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const utils = await render(
      <LanPairingConfirmSheet visible payload={BASE} signedIn onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.press(utils.getByTestId('lan-confirm-button'));
    fireEvent.press(utils.getByTestId('lan-confirm-cancel'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a payload', async () => {
    const utils = await render(
      <LanPairingConfirmSheet visible payload={null} signedIn onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(utils.queryByTestId('lan-confirm-sheet')).toBeNull();
  });
});
