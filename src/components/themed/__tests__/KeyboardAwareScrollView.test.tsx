/**
 * KeyboardAwareScrollView — the shared Android keyboard-avoidance container.
 *
 * The reported bug: on Android 15 edge-to-edge the module-config fields sat
 * underneath the soft keyboard (the window no longer resizes). The component
 * must reserve the IME height as extra bottom content padding so the focused
 * field can be scrolled above the keyboard.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import { KeyboardAwareScrollView } from '../KeyboardAwareScrollView';

let mockKeyboardHeight = 300;
jest.mock('../../../hooks/useKeyboardHeight', () => ({
  useKeyboardHeight: () => mockKeyboardHeight,
}));

afterEach(cleanup);

describe('KeyboardAwareScrollView', () => {
  it('adds the keyboard height to the caller bottom padding', async () => {
    mockKeyboardHeight = 300;
    const { getByTestId } = await render(
      <KeyboardAwareScrollView
        testID="form-scroll"
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {null}
      </KeyboardAwareScrollView>,
    );

    const flat = StyleSheet.flatten(
      getByTestId('form-scroll').props.contentContainerStyle,
    );
    expect(flat.paddingBottom).toBe(348);
  });

  it('keeps the caller padding untouched when no keyboard is shown', async () => {
    mockKeyboardHeight = 0;
    const { getByTestId } = await render(
      <KeyboardAwareScrollView
        testID="form-scroll"
        contentContainerStyle={{ paddingBottom: 16 }}
      >
        {null}
      </KeyboardAwareScrollView>,
    );

    const flat = StyleSheet.flatten(
      getByTestId('form-scroll').props.contentContainerStyle,
    );
    expect(flat.paddingBottom).toBe(16);
  });
});
