/**
 * ConnectionStatusBadge — engine connection state tests (task 3-4).
 *
 * Verifies the badge reflects the engine connection state:
 *  - connected (green, `connection-status-dot-connected`)
 *  - reconnecting (amber, `connection-status-dot-reconnecting`)
 *  - paired-but-disconnected (amber, `connection-status-dot-disconnected`)
 *  - not paired (red, `connection-status-dot-not-paired`)
 *
 * The legacy sticky server-update-required gate is gone with the sync stack.
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
const reconnectingState = { isConnected: false, isPaired: true, isReconnecting: true };
const pairedDisconnectedState = { isConnected: false, isPaired: true, isReconnecting: false };
const notPairedState = { isConnected: false, isPaired: false, isReconnecting: false };

describe('ConnectionStatusBadge — engine connection states', () => {
  it('renders the connected dot when the engine WS is up', async () => {
    mockUseSyncConnection.mockReturnValue(connectedState);
    const utils = await render(<ConnectionStatusBadge />);
    const dot = utils.getByTestId('connection-status-dot-connected');
    expect(dot.props.accessibilityLabel).toBe('Connected');
  });

  it('renders the reconnecting dot while a reconnect is in flight', async () => {
    mockUseSyncConnection.mockReturnValue(reconnectingState);
    const utils = await render(<ConnectionStatusBadge />);
    expect(utils.getByTestId('connection-status-dot-reconnecting')).toBeTruthy();
  });

  it('renders the disconnected dot when paired but not connected', async () => {
    mockUseSyncConnection.mockReturnValue(pairedDisconnectedState);
    const utils = await render(<ConnectionStatusBadge />);
    expect(utils.getByTestId('connection-status-dot-disconnected')).toBeTruthy();
  });

  it('renders the not-paired dot when the engine connection is unavailable', async () => {
    mockUseSyncConnection.mockReturnValue(notPairedState);
    const utils = await render(<ConnectionStatusBadge />);
    expect(utils.getByTestId('connection-status-dot-not-paired')).toBeTruthy();
  });
});
