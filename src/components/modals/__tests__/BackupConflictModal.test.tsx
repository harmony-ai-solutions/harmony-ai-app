/**
 * BackupConflictModal — cloud-backup generation-guard conflict sheet
 * (owner ruling 2026-10-17).
 *
 * Presentational component; covers the conflict-data rendering (device label /
 * formatted sync time / generation), the sync-group awareness hint (present
 * only when a fingerprint is set) and the push/pull/cancel wiring.
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

import { BackupConflictModal } from '../BackupConflictModal';
import type { PendingConflict } from '../../../services/backup/backupTypes';

const CONFLICT: PendingConflict = {
  remoteGeneration: 7,
  remoteDataVersion: 'remote-dv',
  remoteDeviceLabel: 'Other Phone',
  remoteSyncedAt: '2026-10-01T12:00:00Z',
  remoteSyncGroupFingerprint: 'fp-1',
  detectedAt: '2026-10-17T00:00:00Z',
};

describe('BackupConflictModal', () => {
  it('renders the conflict device, time and generation', async () => {
    const utils = await render(
      <BackupConflictModal
        visible
        conflict={CONFLICT}
        onPushMine={jest.fn()}
        onPullTheirs={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    const body = String(utils.getByTestId('backup-conflict-body').props.children);
    expect(body).toContain('conflictBody:');
    expect(body).toContain('Other Phone');
    expect(body).toContain('"generation":7');
  });

  it('falls back to a generic label when the device is unknown', async () => {
    const utils = await render(
      <BackupConflictModal
        visible
        conflict={{ ...CONFLICT, remoteDeviceLabel: undefined }}
        onPushMine={jest.fn()}
        onPullTheirs={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(String(utils.getByTestId('backup-conflict-body').props.children)).toContain(
      'conflictDeviceUnknown',
    );
  });

  it('shows the sync-group hint when a fingerprint is present', async () => {
    const utils = await render(
      <BackupConflictModal visible conflict={CONFLICT} onPushMine={jest.fn()} onPullTheirs={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(utils.getByTestId('backup-conflict-syncgroup')).toBeTruthy();
  });

  it('hides the sync-group hint when no fingerprint is present', async () => {
    const utils = await render(
      <BackupConflictModal
        visible
        conflict={{ ...CONFLICT, remoteSyncGroupFingerprint: undefined }}
        onPushMine={jest.fn()}
        onPullTheirs={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(utils.queryByTestId('backup-conflict-syncgroup')).toBeNull();
  });

  it('fires push, pull and cancel callbacks', async () => {
    const onPushMine = jest.fn();
    const onPullTheirs = jest.fn();
    const onCancel = jest.fn();
    const utils = await render(
      <BackupConflictModal
        visible
        conflict={CONFLICT}
        onPushMine={onPushMine}
        onPullTheirs={onPullTheirs}
        onCancel={onCancel}
      />,
    );
    fireEvent.press(utils.getByTestId('backup-conflict-push'));
    fireEvent.press(utils.getByTestId('backup-conflict-pull'));
    fireEvent.press(utils.getByTestId('backup-conflict-cancel'));
    expect(onPushMine).toHaveBeenCalledTimes(1);
    expect(onPullTheirs).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a conflict', async () => {
    const utils = await render(
      <BackupConflictModal
        visible
        conflict={null}
        onPushMine={jest.fn()}
        onPullTheirs={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(utils.queryByTestId('backup-conflict-modal')).toBeNull();
  });
});
