/**
 * CloudProvisioningCard — RNTL component render tests (Phase 9 gap).
 *
 * These tests verify the actual component renders for each CloudSessionStatus,
 * that the Retry button appears only on 'failed', that pressing it calls
 * onRetry, and that the elapsed counter renders for 'provisioning'.
 *
 * Uses @testing-library/react-native (RNTL) for render, query, and fireEvent.
 * ThemedText and ThemedButton are mocked as light wrappers so we can assert
 * on text content and button presses without pulling in the full theme +
 * gradient dependency tree.
 *
 * NOTE: RNTL v14's render() is async (returns Promise<RenderResult>), so
 * every render call must be awaited.
 *
 * The existing pure-function tests (classifyCloudStage, calcElapsedSeconds)
 * remain in CloudProvisioningCard.test.tsx alongside these renders.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CloudProvisioningCard } from '../CloudProvisioningCard';
import type { CloudSessionStatus, CloudSessionInfo } from '../../../services/cloud/CloudSessionService';

// ── Module-level mocks for child component dependencies ──────────────────
// NOTE: jest.mock factories are hoisted before imports, so they CANNOT
// reference outer-scope variables.  Use require() for any module needed
// inside the factory.

// Mock ThemedText to render children in a <Text> so getByText works.
jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

// Mock ThemedButton to render a TouchableOpacity wrapping the label so
// fireEvent.press(findByText('Retry')) triggers onPress.
jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, style, ...props }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, disabled, style, accessibilityRole: 'button', ...props },
        React.createElement(Text, null, label),
      ),
  };
});

// Mock StatusPulseDot to render nothing (it uses Animated which can be
// noisy in test environments; we verify stage labels via ThemedText).
jest.mock('../StatusPulseDot', () => {
  const React = require('react');
  return { StatusPulseDot: () => React.createElement(React.Fragment, null) };
});

// ── Test suite ──────────────────────────────────────────────────────────

describe('CloudProvisioningCard — RNTL render', () => {
  const baseProps = {
    accentColor: '#7c3aed',
    isConnected: false,
    isRetrying: false,
    onRetry: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Stage labels ────────────────────────────────────────────────────

  it('renders idle label', async () => {
    const { getByText } = await render(
      <CloudProvisioningCard status="idle" {...baseProps} />,
    );
    expect(getByText('Disconnected')).toBeTruthy();
  });

  it('renders requesting label', async () => {
    const { getByText } = await render(
      <CloudProvisioningCard status="requesting" {...baseProps} />,
    );
    expect(getByText('Requesting secure session\u2026')).toBeTruthy();
  });

  it('renders provisioning label with elapsed counter', async () => {
    const { getByText } = await render(
      <CloudProvisioningCard
        status="provisioning"
        info={{ requestedAt: Date.now() } as CloudSessionInfo}
        {...baseProps}
      />,
    );
    expect(getByText('Preparing secure session\u2026')).toBeTruthy();
    // Elapsed counter should show "Preparing for 0s" (just requested)
    expect(getByText(/Preparing for \d+s/)).toBeTruthy();
  });

  it('renders ready + connected label', async () => {
    const { getByText } = await render(
      <CloudProvisioningCard
        status="ready"
        {...baseProps}
        isConnected={true}
      />,
    );
    expect(getByText('Connected \u2713')).toBeTruthy();
  });

  it('renders ready + not-connected label', async () => {
    const { getByText } = await render(
      <CloudProvisioningCard status="ready" {...baseProps} />,
    );
    expect(getByText('Establishing secure connection\u2026')).toBeTruthy();
  });

  it('renders failed label with failure reason', async () => {
    const { getByText } = await render(
      <CloudProvisioningCard
        status="failed"
        info={{ failureReason: 'circuit open' } as CloudSessionInfo}
        {...baseProps}
      />,
    );
    expect(getByText(/Couldn't start session/)).toBeTruthy();
    expect(getByText(/circuit open/)).toBeTruthy();
  });

  // ── Retry button behaviour ──────────────────────────────────────────

  it('shows Retry button only for failed status', async () => {
    const nonFailed: CloudSessionStatus[] = ['idle', 'requesting', 'provisioning', 'ready'];
    for (const status of nonFailed) {
      const { queryByText, unmount } = await render(
        <CloudProvisioningCard status={status} {...baseProps} />,
      );
      expect(queryByText('Retry')).toBeNull();
      await unmount();
    }
  });

  it('shows Retry button on failed', async () => {
    const { getByText } = await render(
      <CloudProvisioningCard status="failed" {...baseProps} />,
    );
    expect(getByText('Retry')).toBeTruthy();
  });

  it('calls onRetry when Retry is pressed', async () => {
    const onRetry = jest.fn();
    const { getByText } = await render(
      <CloudProvisioningCard
        status="failed"
        isRetrying={false}
        onRetry={onRetry}
        accentColor="#7c3aed"
        isConnected={false}
      />,
    );
    fireEvent.press(getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // ── Elapsed counter ─────────────────────────────────────────────────

  it('shows elapsed counter for provisioning status', async () => {
    const fiveSecAgo = Date.now() - 5000;
    const { getByText } = await render(
      <CloudProvisioningCard
        status="provisioning"
        info={{ requestedAt: fiveSecAgo } as CloudSessionInfo}
        {...baseProps}
      />,
    );
    // Elapsed counter rendered with the template "Preparing for Xs"
    expect(getByText(/Preparing for \d+s/)).toBeTruthy();
  });

  it('shows elapsed counter for ready status when elapsed > 0', async () => {
    const fiveSecAgo = Date.now() - 5000;
    const { getByText } = await render(
      <CloudProvisioningCard
        status="ready"
        {...baseProps}
        isConnected={true}
        info={{ requestedAt: fiveSecAgo, readyAt: Date.now() } as CloudSessionInfo}
      />,
    );
    // The done template: "Ready in Xs"
    expect(getByText(/Ready in \d+s/)).toBeTruthy();
  });
});
