/**
 * KnowledgeTab — RAG collection browser (tts-voice-ux Phase 6).
 *
 * Verifies the collection list, stats breakdown chips, document rows with
 * archetype/category filters, the similarity test-query and the graceful
 * "no knowledge" empty state when the engine has no RAG module.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  getRagCollection,
  getRagDocuments,
  listRagCollections,
  testRagQuery,
} from '../../../services/engine/repositories/ragCollections';
import {
  ragCollectionLoreFixture,
  ragCollectionStatsFixture,
  ragDocumentHarborFixture,
  ragDocumentLighthouseFixture,
  ragQueryResultFixture,
} from '../../../services/engine/__fixtures__/managementContract.fixtures';
import { KnowledgeTab } from '../KnowledgeTab';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
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

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('../../../services/engine/repositories/ragCollections', () => ({
  listRagCollections: jest.fn(),
  getRagCollection: jest.fn(),
  getRagDocuments: jest.fn(),
  getRagDocument: jest.fn(),
  testRagQuery: jest.fn(),
}));

jest.mock('../DocumentDetailsSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    DocumentDetailsSheet: ({ visible, document }: any) =>
      visible && document
        ? React.createElement(View, {
            testID: 'document-details-mock',
            documentId: document.id,
          })
        : null,
  };
});

const listMock = listRagCollections as jest.Mock;
const collectionMock = getRagCollection as jest.Mock;
const documentsMock = getRagDocuments as jest.Mock;
const testQueryMock = testRagQuery as jest.Mock;

const COLLECTIONS = [ragCollectionLoreFixture];
const DOCUMENTS = [ragDocumentLighthouseFixture, ragDocumentHarborFixture];

describe('KnowledgeTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listMock.mockResolvedValue(COLLECTIONS);
    collectionMock.mockResolvedValue({
      info: ragCollectionLoreFixture,
      stats: ragCollectionStatsFixture,
    });
    documentsMock.mockResolvedValue(DOCUMENTS);
    testQueryMock.mockResolvedValue([ragQueryResultFixture]);
  });

  it('lists collections, selects the first and shows its documents + stats', async () => {
    const { getByTestId } = await render(<KnowledgeTab entityId="ent-1" />);

    await waitFor(() => expect(getByTestId('knowledge-collection-lore')).toBeTruthy());
    expect(getByTestId('knowledge-stats')).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId('knowledge-document-doc-1')).toBeTruthy(),
    );
    expect(getByTestId('knowledge-document-doc-2')).toBeTruthy();
    expect(collectionMock).toHaveBeenCalledWith('ent-1', 'lore');
    expect(documentsMock).toHaveBeenCalledWith('ent-1', 'lore');
  });

  it('filters documents by archetype', async () => {
    const { getByTestId, queryByTestId } = await render(<KnowledgeTab entityId="ent-1" />);

    await waitFor(() => expect(getByTestId('knowledge-document-doc-1')).toBeTruthy());
    expect(getByTestId('knowledge-document-doc-2')).toBeTruthy();

    await fireEvent.press(getByTestId('knowledge-archetype-character'));
    expect(getByTestId('knowledge-document-doc-1')).toBeTruthy();
    expect(queryByTestId('knowledge-document-doc-2')).toBeNull();
  });

  it('opens the document details sheet for a tapped row', async () => {
    const { getByTestId } = await render(<KnowledgeTab entityId="ent-1" />);
    await waitFor(() => expect(getByTestId('knowledge-document-doc-1')).toBeTruthy());

    await fireEvent.press(getByTestId('knowledge-document-doc-1'));
    expect(getByTestId('document-details-mock').props.documentId).toBe('doc-1');
  });

  it('runs the similarity test query with a 5-result window', async () => {
    const { getByTestId } = await render(<KnowledgeTab entityId="ent-1" />);
    await waitFor(() => expect(getByTestId('knowledge-query-input')).toBeTruthy());

    // An empty query is never sent.
    await fireEvent.press(getByTestId('knowledge-query-run'));
    expect(testQueryMock).not.toHaveBeenCalled();

    await fireEvent.changeText(
      getByTestId('knowledge-query-input'),
      'who keeps the lighthouse?',
    );
    await fireEvent.press(getByTestId('knowledge-query-run'));

    await waitFor(() => expect(getByTestId('knowledge-query-results')).toBeTruthy());
    expect(testQueryMock).toHaveBeenCalledWith(
      'ent-1',
      'lore',
      'who keeps the lighthouse?',
      { limit: 5 },
    );
    expect(getByTestId('knowledge-similarity-doc-1').props.children).toBe('0.91');
  });

  it('degrades to the "no knowledge" state when the RAG module is absent', async () => {
    listMock.mockRejectedValue(
      Object.assign(new Error('not found'), { status: 404 }),
    );
    const { getByTestId } = await render(<KnowledgeTab entityId="ent-1" />);

    await waitFor(() => expect(getByTestId('knowledge-tab-empty')).toBeTruthy());
    expect(getByTestId('knowledge-retry')).toBeTruthy();
    expect(documentsMock).not.toHaveBeenCalled();
  });
});
