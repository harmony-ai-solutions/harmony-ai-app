/**
 * DocumentDetailsSheet — RAG document details (tts-voice-ux Phase 6).
 *
 * The engine returns the stored embedding vector; this suite pins the invariant
 * that the UI only ever reports its DIMENSION — the vector values are never
 * rendered.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { getRagDocument } from '../../../services/engine/repositories/ragCollections';
import {
  ragDocumentDetailsFixture,
  ragDocumentLighthouseFixture,
} from '../../../services/engine/__fixtures__/managementContract.fixtures';
import { DocumentDetailsSheet } from '../DocumentDetailsSheet';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
        status: { error: '#ef4444', success: '#22c55e' },
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
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

jest.mock('../../../services/engine/repositories/ragCollections', () => ({
  getRagDocument: jest.fn(),
}));

const getDocumentMock = getRagDocument as jest.Mock;
const onClose = jest.fn();

function renderSheet(visible = true) {
  return render(
    <DocumentDetailsSheet
      visible={visible}
      onClose={onClose}
      entityId="ent-1"
      collectionName="lore"
      document={ragDocumentLighthouseFixture}
    />,
  );
}

describe('DocumentDetailsSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDocumentMock.mockResolvedValue(ragDocumentDetailsFixture);
  });

  it('renders nothing while closed', async () => {
    const { queryByTestId } = await renderSheet(false);
    expect(queryByTestId('document-details-sheet')).toBeNull();
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('shows full content, metadata and badges', async () => {
    const { getByTestId } = await renderSheet();
    await waitFor(() => expect(getByTestId('document-details-content')).toBeTruthy());

    expect(getByTestId('document-details-content').props.children).toBe(
      ragDocumentLighthouseFixture.content,
    );
    expect(getByTestId('document-archetype-badge')).toBeTruthy();
    expect(getByTestId('document-category-badge')).toBeTruthy();
    expect(getDocumentMock).toHaveBeenCalledWith('ent-1', 'lore', 'doc-1');
  });

  it('reports the embedding DIMENSION and never renders the vector', async () => {
    const { getByTestId, queryByText } = await renderSheet();

    await waitFor(() => expect(getByTestId('document-embedding-dim')).toBeTruthy());
    expect(getByTestId('document-embedding-dim').props.children).toBe('documentEmbeddingDim');

    // The stored vector values must not appear anywhere in the tree.
    expect(queryByText(/0\.012/)).toBeNull();
    expect(queryByText(/0\.034/)).toBeNull();
    expect(queryByText(/0\.056/)).toBeNull();
  });

  it('degrades to the row data when the details read fails', async () => {
    getDocumentMock.mockRejectedValueOnce(new Error('engine down'));
    const { getByTestId } = await renderSheet();

    await waitFor(() => expect(getByTestId('document-details-failed')).toBeTruthy());
    expect(getByTestId('document-details-content').props.children).toBe(
      ragDocumentLighthouseFixture.content,
    );
  });
});
