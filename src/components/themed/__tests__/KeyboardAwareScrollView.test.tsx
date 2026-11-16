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
import { KeyboardAwareScrollView, keyboardScrollOverflow } from '../KeyboardAwareScrollView';

let mockKeyboardHeight = 300;
jest.mock('../../../hooks/useKeyboardHeight', () => ({
  useKeyboardHeight: () => mockKeyboardHeight,
}));

afterEach(cleanup);

describe('KeyboardAwareScrollView', () => {
  describe('keyboardScrollOverflow', () => {
    it('scrolls by the overflow of the field BOTTOM, not its top edge', () => {
      // Field top 600, height 48 → bottom 648; keyboard top 500; gap 16.
      // The old helper scrolled to the top edge and stopped 48+16px short.
      expect(
        keyboardScrollOverflow({
          fieldBottom: 648,
          keyboardTop: 500,
          keyboardGap: 16,
        }),
      ).toBe(164);
    });

    it('does not scroll when the field bottom already clears the keyboard', () => {
      expect(
        keyboardScrollOverflow({
          fieldBottom: 480,
          keyboardTop: 500,
          keyboardGap: 16,
        }),
      ).toBe(0);
    });

    it('counts the gap as part of the required clearance', () => {
      expect(
        keyboardScrollOverflow({
          fieldBottom: 490,
          keyboardTop: 500,
          keyboardGap: 16,
        }),
      ).toBe(6);
    });
  });

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
