/**
 * AppAlertContext — tests for the imperative alert lifecycle.
 *
 * Regression test for a race that broke the sync name-clash popup:
 * when a clash is resolved WITHOUT "apply to all", the next clash's alert is
 * shown synchronously (resolveNameClash → emit → showAlert). The PREVIOUS
 * alert's dismiss had scheduled a delayed `setConfig(null)` (200ms fade
 * cleanup) which then clobbered the newly-shown config — the modal rendered
 * `null`, the popup vanished, and the sync hung waiting for a decision that
 * could never be made.
 */

import React from 'react';
import { fireEvent, render, act } from '@testing-library/react-native';
import { Text, TouchableOpacity, View } from 'react-native';
import { AppAlertProvider, useAppAlert } from '../AppAlertContext';

// ── Stub AppAlertModal ───────────────────────────────────────────────────────
// Mirrors the real modal's button semantics: onDismiss() runs BEFORE the
// button's onPress (and onPress receives the checkbox state). Rendered from
// `config` (not `visible`) so tests can assert the config lifecycle precisely.
jest.mock('../../components/modals/AppAlertModal', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppAlertModal: ({ config, onDismiss }: any) => {
      if (!config) return null;
      return (
        <View testID="alert">
          <Text testID="alert-title">{config.title}</Text>
          {config.buttons.map((b: any, i: number) => (
            <TouchableOpacity
              key={i}
              testID={`alert-button-${i}`}
              onPress={() => {
                onDismiss();
                b.onPress?.(false);
              }}
            >
              <Text>{b.text}</Text>
            </TouchableOpacity>
          ))}
        </View>
      );
    },
  };
});

// ── Harnesses ────────────────────────────────────────────────────────────────

/** Shows an alert whose button SYNCHRONOUSLY re-shows a second alert —
 *  mirrors the sync name-clash flow without "apply to all". */
function ReShowHarness() {
  const { showAlert } = useAppAlert();
  return (
    <TouchableOpacity
      testID="show-first"
      onPress={() =>
        showAlert('First clash', 'first message', [
          {
            text: 'Overwrite',
            onPress: () => {
              showAlert('Second clash', 'second message', [
                { text: 'Overwrite', onPress: () => {} },
              ]);
            },
          },
        ])
      }
    />
  );
}

/** Shows an alert whose button dismisses WITHOUT re-showing. */
function PlainHarness() {
  const { showAlert } = useAppAlert();
  return (
    <TouchableOpacity
      testID="show-plain"
      onPress={() =>
        showAlert('Plain alert', 'message', [{ text: 'OK', onPress: () => {} }])
      }
    />
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AppAlertContext', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a re-shown alert visible after the previous dismiss cleanup fires', async () => {
    jest.useFakeTimers();
    const { getByTestId } = await render(
      <AppAlertProvider>
        <ReShowHarness />
      </AppAlertProvider>,
    );

    await act(async () => {
      fireEvent.press(getByTestId('show-first'));
    });
    expect(getByTestId('alert-title').props.children).toBe('First clash');

    // Pressing the button dismisses the first alert and SYNCHRONOUSLY shows
    // the second (the multi-clash flow without "apply to all").
    await act(async () => {
      fireEvent.press(getByTestId('alert-button-0'));
    });
    expect(getByTestId('alert-title').props.children).toBe('Second clash');

    // The first dismiss scheduled a setConfig(null) after 200ms — it must NOT
    // clobber the freshly shown second alert (regression: popup vanished and
    // the sync got stuck).
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(getByTestId('alert-title').props.children).toBe('Second clash');
  });

  it('clears the config after dismissing an alert that is not re-shown', async () => {
    jest.useFakeTimers();
    const { getByTestId, queryByTestId } = await render(
      <AppAlertProvider>
        <PlainHarness />
      </AppAlertProvider>,
    );

    await act(async () => {
      fireEvent.press(getByTestId('show-plain'));
    });
    expect(getByTestId('alert-title').props.children).toBe('Plain alert');

    await act(async () => {
      fireEvent.press(getByTestId('alert-button-0'));
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    // No newer alert was shown → the delayed cleanup may clear the config.
    expect(queryByTestId('alert')).toBeNull();
  });
});
