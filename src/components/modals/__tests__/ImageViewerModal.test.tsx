/**
 * ImageViewerModal — chat-background action pill.
 *
 * The caller owns the label so the same pill switches between
 * "Set as background" and the active "✓ Current background" state.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ImageViewerModal } from '../ImageViewerModal';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const { View } = require('react-native');
  return (props: any) => <View {...props} />;
});

jest.mock('../../themed/ThemedText', () => {
  const { Text } = require('react-native');
  return {
    ThemedText: ({ children, ...props }: any) => <Text {...props}>{children}</Text>,
  };
});

describe('ImageViewerModal background action', () => {
  it('renders "Set as background" and calls the handler', async () => {
    const onPress = jest.fn();
    const { getByText, getByTestId } = await render(
      <ImageViewerModal
        visible
        imageUri="data:image/jpeg;base64,AAAA"
        backgroundAction={{ label: 'Set as background', onPress }}
        onClose={jest.fn()}
      />,
    );

    expect(getByText('Set as background')).toBeTruthy();
    await fireEvent.press(getByTestId('image-viewer-background-action'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders the active "✓ Current background" variant when set', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(
      <ImageViewerModal
        visible
        imageUri="data:image/jpeg;base64,AAAA"
        backgroundAction={{
          label: '✓ Current background',
          active: true,
          onPress,
        }}
        onClose={jest.fn()}
      />,
    );

    expect(getByText('✓ Current background')).toBeTruthy();
  });

  it('renders no action pill when the prop is absent', async () => {
    const { queryByTestId } = await render(
      <ImageViewerModal visible imageUri="data:image/jpeg;base64,AAAA" onClose={jest.fn()} />,
    );

    expect(queryByTestId('image-viewer-background-action')).toBeNull();
  });
});
