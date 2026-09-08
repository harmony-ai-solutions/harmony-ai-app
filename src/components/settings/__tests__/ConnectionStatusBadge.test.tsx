/**
 * ConnectionStatusBadge — 3-3/D57 `serverUpdateRequired` state tests.
 *
 * Verifies the sticky server-update-required gate surfaces in the badge:
 *  - a dedicated error-style dot with testID
 *    `connection-status-dot-server-update-required` + matching a11y label
 *  - the gate takes PRECEDENCE over every other connection state (it is
 *    active even while the WebSocket is up — syncs are suppressed by the
 *    SyncService choke point, not by the connection)
 *  - with the gate off, the badge renders exactly as before
 */
import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
import { ConnectionStatusBadge } from '../ConnectionStatusBadge';

afterEach(cleanup);
beforeEach(cleanup);

const mockUseSyncConnection = jest.fn();
jest.mock('../../../contexts/SyncConnectionContext', () => ({
  useSyncConnection: () => mockUseSyncConnection(),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        status: { success: '#4caf50', warning: '#ff9800', error: '#f44336' },
      },
    },
  }),
}));

const connectedState = { isConnected: true, isPaired: true, isReconnecting: false };
const notPairedState = { isConnected: false, isPaired: false, isReconnecting: false };

describe('ConnectionStatusBadge — serverUpdateRequired gate', () => {
  it('renders the error dot + a11y label when the gate is active, even while connected', async () => {
    // Key regression: the gate can be active while the WS is up (the ~10-min
    // re-probe keeps the connection alive while syncs are suppressed) — the
    // badge must NOT show "connected" in that state.
    mockUseSyncConnection.mockReturnValue(connectedState);

    const utils = await render(<ConnectionStatusBadge serverUpdateRequired />);

    const dot = utils.getByTestId('connection-status-dot-server-update-required');
    expect(dot.props.accessibilityLabel).toBe('Harmony Link update required');
    expect(dot.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: '#f44336' })]),
    );
    // The connected testID must NOT be shown while the gate is active.
    expect(utils.queryByTestId('connection-status-dot-connected')).toBeNull();
  });

  it('does not render the serverUpdateRequired dot when the gate is off', async () => {
    mockUseSyncConnection.mockReturnValue(connectedState);

    const utils = await render(<ConnectionStatusBadge serverUpdateRequired={false} />);

    expect(utils.queryByTestId('connection-status-dot-server-update-required')).toBeNull();
    const dot = utils.getByTestId('connection-status-dot-connected');
    expect(dot.props.accessibilityLabel).toBe('Connected');
  });

  it('gate takes precedence over the notPaired state', async () => {
    mockUseSyncConnection.mockReturnValue(notPairedState);

    const utils = await render(<ConnectionStatusBadge serverUpdateRequired />);

    expect(utils.queryByTestId('connection-status-dot-not-paired')).toBeNull();
    expect(utils.getByTestId('connection-status-dot-server-update-required')).toBeTruthy();
  });
});
