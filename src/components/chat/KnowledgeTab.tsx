/**
 * KnowledgeTab — the AI's RAG collection browser (tts-voice-ux Phase 6).
 *
 * Read-only in v1: lists the entity's collections (`CollectionInfo` + stats
 * breakdown chips), the documents of the selected collection (archetype /
 * category badges + client-side filter chips) and runs the engine's similarity
 * test-query (limit 5) so RAG relevance can be inspected.
 *
 * A missing RAG module (or any failed read) degrades to the "no knowledge"
 * empty state — never a crash, never a fabricated collection.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type {
  CollectionInfoDto,
  CollectionStatsDto,
  DocumentInfoDto,
  QueryResultDto,
} from '../../services/engine/EngineApiClient';
import {
  getRagCollection,
  getRagDocuments,
  listRagCollections,
  testRagQuery,
} from '../../services/engine/repositories/ragCollections';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';
import { DocumentDetailsSheet } from './DocumentDetailsSheet';

const log = createLogger('[KnowledgeTab]');

/** The browser always asks for the same small result window. */
const TEST_QUERY_LIMIT = 5;
const ALL = '';

function formatUpdated(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export interface KnowledgeTabProps {
  entityId: string | null;
  /** Bumped by the sheet when this tab is (re)focused. */
  refreshToken?: number;
}

export const KnowledgeTab: React.FC<KnowledgeTabProps> = ({ entityId, refreshToken }) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chatDetail');

  const [collections, setCollections] = useState<CollectionInfoDto[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [stats, setStats] = useState<CollectionStatsDto | null>(null);
  const [documents, setDocuments] = useState<DocumentInfoDto[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [archetypeFilter, setArchetypeFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);

  const [query, setQuery] = useState('');
  const [querying, setQuerying] = useState(false);
  const [queryResults, setQueryResults] = useState<QueryResultDto[] | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [detailDoc, setDetailDoc] = useState<DocumentInfoDto | null>(null);

  const loadCollections = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
      if (!entityId) {
        setCollections([]);
        setListLoading(false);
        return;
      }
      if (mode === 'initial') setListLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await listRagCollections(entityId);
        setCollections(next);
        setListError(null);
        setSelectedName(prev =>
          prev && next.some(collection => collection.name === prev)
            ? prev
            : next[0]?.name ?? null,
        );
      } catch (err) {
        // 404/503 = no RAG module for this character. Any other failure is
        // logged and degraded to the same non-crashing empty state.
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`RAG collection list failed for ${entityId}:`, err);
        setListError(message);
        setCollections([]);
        setSelectedName(null);
      } finally {
        setListLoading(false);
        setRefreshing(false);
      }
    },
    [entityId],
  );

  useEffect(() => {
    void loadCollections('initial');
  }, [loadCollections, refreshToken]);

  const loadCollection = useCallback(
    async (name: string) => {
      if (!entityId) return;
      setDetailLoading(true);
      setDetailError(null);
      try {
        const [detail, docs] = await Promise.all([
          getRagCollection(entityId, name),
          getRagDocuments(entityId, name),
        ]);
        setStats(detail.stats);
        setDocuments(docs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`RAG collection read failed for ${name}:`, err);
        setDetailError(message);
        setStats(null);
        setDocuments([]);
      } finally {
        setDetailLoading(false);
        setLoadedName(name);
      }
    },
    [entityId],
  );

  useEffect(() => {
    if (!selectedName) {
      setStats(null);
      setDocuments([]);
      setLoadedName(null);
      return;
    }
    setArchetypeFilter(ALL);
    setCategoryFilter(ALL);
    setQueryResults(null);
    setQueryError(null);
    void loadCollection(selectedName);
  }, [selectedName, loadCollection]);

  const archetypes = useMemo(() => {
    const set = new Set<string>();
    for (const doc of documents) if (doc.archetype) set.add(doc.archetype);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [documents]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const doc of documents) {
      if (archetypeFilter !== ALL && doc.archetype !== archetypeFilter) continue;
      if (doc.category) set.add(doc.category);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [documents, archetypeFilter]);

  const filteredDocuments = useMemo(
    () =>
      documents.filter(
        doc =>
          (archetypeFilter === ALL || doc.archetype === archetypeFilter) &&
          (categoryFilter === ALL || doc.category === categoryFilter),
      ),
    [documents, archetypeFilter, categoryFilter],
  );

  const runQuery = useCallback(async () => {
    if (!entityId || !selectedName || query.trim().length === 0 || querying) return;
    hapticLightPress();
    setQuerying(true);
    setQueryError(null);
    try {
      const results = await testRagQuery(entityId, selectedName, query, {
        limit: TEST_QUERY_LIMIT,
      });
      setQueryResults(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`RAG test query failed for ${selectedName}:`, err);
      setQueryError(message);
      setQueryResults(null);
    } finally {
      setQuerying(false);
    }
  }, [entityId, selectedName, query, querying]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const accentSecondary = theme.colors.accent.secondary ?? accent;

  const renderFilterChip = (
    label: string,
    selected: boolean,
    onPress: () => void,
    testID: string,
    tone: 'primary' | 'secondary',
    a11yPrefix?: string,
  ) => {
    const color = tone === 'primary' ? accent : accentSecondary;
    return (
      <TouchableOpacity
        key={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={a11yPrefix ? `${a11yPrefix}: ${label}` : label}
        testID={testID}
        style={[
          styles.chip,
          {
            borderColor: selected ? color : theme.colors.border.default,
            backgroundColor: selected ? color + '1A' : 'transparent',
          },
        ]}
      >
        <ThemedText size={11} variant={selected ? 'accent' : 'primary'}>
          {label}
        </ThemedText>
      </TouchableOpacity>
    );
  };

  if (listLoading) {
    return (
      <View style={styles.centered} testID="knowledge-tab-loading">
        <ActivityIndicator color={accent} />
      </View>
    );
  }

  if (collections.length === 0) {
    return (
      <View style={styles.centered} testID="knowledge-tab-empty">
        <ThemedText variant="muted" size={13} style={styles.emptyText}>
          {t('knowledgeEmpty')}
        </ThemedText>
        {listError ? (
          <TouchableOpacity
            onPress={() => void loadCollections('initial')}
            accessibilityRole="button"
            testID="knowledge-retry"
          >
            <ThemedText size={13} variant="accent">
              {t('common:retry')}
            </ThemedText>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  const selected = collections.find(collection => collection.name === selectedName) ?? null;
  const archetypeBreakdown = stats?.archetypeBreakdown ?? {};

  return (
    <View style={styles.container} testID="knowledge-tab">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadCollections('refresh')}
            colors={[accent]}
            tintColor={accent}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
      >
        <View style={styles.sectionHeaderRow}>
          <ThemedText size={12} variant="muted" weight="medium" style={styles.sectionLabel}>
            {t('collections')}
          </ThemedText>
          <TouchableOpacity
            onPress={() => void loadCollections('refresh')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('knowledgeRefresh')}
            testID="knowledge-refresh"
          >
            <Icon name="refresh" size={16} color={theme.colors.text.muted} />
          </TouchableOpacity>
        </View>

        <View style={styles.collectionRow}>
          {collections.map(collection => {
            const isSelected = collection.name === selectedName;
            return (
              <TouchableOpacity
                key={collection.name}
                onPress={() => {
                  hapticLightPress();
                  setSelectedName(collection.name);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={collection.name}
                testID={`knowledge-collection-${collection.name}`}
                style={[
                  styles.collectionCard,
                  {
                    borderColor: isSelected ? accent : theme.colors.border.default,
                    backgroundColor: isSelected
                      ? accent + '14'
                      : theme.colors.background.base + '44',
                  },
                ]}
              >
                <ThemedText size={13} weight="medium" numberOfLines={1}>
                  {collection.name}
                </ThemedText>
                <ThemedText size={10} variant="muted">
                  {t('documentsCount', { count: collection.documentCount })} ·{' '}
                  {t('embeddingDimShort', { dim: collection.embeddingDim })}
                </ThemedText>
                <ThemedText size={10} variant="muted">
                  {formatUpdated(collection.lastUpdated)}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        {Object.keys(archetypeBreakdown).length > 0 ? (
          <View style={styles.breakdownRow} testID="knowledge-stats">
            {Object.entries(archetypeBreakdown).map(([archetype, count]) => (
              <View
                key={archetype}
                style={[styles.breakdownChip, { backgroundColor: accentSecondary + '1A' }]}
              >
                <ThemedText size={10} variant="secondary">
                  {archetype} {count}
                </ThemedText>
              </View>
            ))}
          </View>
        ) : null}

        {archetypes.length > 0 ? (
          <View style={styles.filterRow}>
            {renderFilterChip(
              t('filterAll'),
              archetypeFilter === ALL,
              () => {
                setArchetypeFilter(ALL);
                setCategoryFilter(ALL);
              },
              'knowledge-archetype-all',
              'primary',
              t('filterArchetype'),
            )}
            {archetypes.map(archetype =>
              renderFilterChip(
                archetype,
                archetypeFilter === archetype,
                () => {
                  setArchetypeFilter(archetype);
                  setCategoryFilter(ALL);
                },
                `knowledge-archetype-${archetype}`,
                'primary',
                t('filterArchetype'),
              ),
            )}
          </View>
        ) : null}

        {categories.length > 1 ? (
          <View style={styles.filterRow}>
            {renderFilterChip(
              t('filterAll'),
              categoryFilter === ALL,
              () => setCategoryFilter(ALL),
              'knowledge-category-all',
              'secondary',
              t('filterCategory'),
            )}
            {categories.map(category =>
              renderFilterChip(
                category,
                categoryFilter === category,
                () => setCategoryFilter(category),
                `knowledge-category-${category}`,
                'secondary',
                t('filterCategory'),
              ),
            )}
          </View>
        ) : null}

        <ThemedText size={12} variant="muted" weight="medium" style={styles.sectionLabel}>
          {t('documentsHeader', { count: filteredDocuments.length })}
        </ThemedText>

        {detailLoading || loadedName !== selectedName ? (
          <ActivityIndicator color={accent} style={styles.inlineSpinner} />
        ) : filteredDocuments.length === 0 ? (
          <ThemedText
            size={12}
            variant="muted"
            style={styles.emptyText}
            testID="knowledge-documents-empty"
          >
            {detailError ? t('knowledgeLoadFailed') : t('knowledgeNoDocuments')}
          </ThemedText>
        ) : (
          filteredDocuments.map(doc => (
            <TouchableOpacity
              key={doc.id}
              onPress={() => {
                hapticLightPress();
                setDetailDoc(doc);
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={doc.name || doc.id}
              testID={`knowledge-document-${doc.id}`}
              style={[
                styles.documentRow,
                {
                  backgroundColor: theme.colors.background.base + '66',
                  borderColor: theme.colors.border.default + '66',
                },
              ]}
            >
              <View style={styles.documentText}>
                <ThemedText size={13} weight="medium" numberOfLines={1}>
                  {doc.name || doc.id}
                </ThemedText>
                <ThemedText size={11} variant="muted" numberOfLines={2}>
                  {doc.content}
                </ThemedText>
                <View style={styles.documentBadges}>
                  {doc.archetype ? (
                    <View style={[styles.breakdownChip, { backgroundColor: accent + '1A' }]}>
                      <ThemedText size={9} variant="accent">
                        {doc.archetype}
                      </ThemedText>
                    </View>
                  ) : null}
                  {doc.category ? (
                    <View
                      style={[styles.breakdownChip, { backgroundColor: accentSecondary + '1A' }]}
                    >
                      <ThemedText size={9} variant="secondary">
                        {doc.category}
                      </ThemedText>
                    </View>
                  ) : null}
                  <ThemedText size={9} variant="muted">
                    {formatUpdated(doc.createdAt)}
                  </ThemedText>
                </View>
              </View>
              <Icon name="chevron-right" size={16} color={theme.colors.text.muted} />
            </TouchableOpacity>
          ))
        )}

        <View
          style={[
            styles.queryBox,
            {
              borderColor: theme.colors.border.default,
              backgroundColor: theme.colors.background.base + '44',
            },
          ]}
        >
          <ThemedText size={12} variant="muted" weight="medium" style={styles.sectionLabel}>
            {t('testKnowledge')}
          </ThemedText>
          <View style={styles.queryRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('queryPlaceholder')}
              placeholderTextColor={theme.colors.text.disabled}
              style={[
                styles.queryInput,
                {
                  color: theme.colors.text.primary,
                  borderColor: theme.colors.border.default,
                  backgroundColor: theme.colors.background.base,
                },
              ]}
              onSubmitEditing={() => void runQuery()}
              returnKeyType="search"
              testID="knowledge-query-input"
            />
            <TouchableOpacity
              onPress={() => void runQuery()}
              disabled={query.trim().length === 0 || querying}
              accessibilityRole="button"
              accessibilityState={{
                disabled: query.trim().length === 0 || querying,
                busy: querying,
              }}
              testID="knowledge-query-run"
              style={[
                styles.queryButton,
                {
                  backgroundColor: query.trim().length === 0 ? accent + '33' : accent,
                },
              ]}
            >
              <ThemedText size={11} weight="medium" style={styles.queryButtonLabel}>
                {querying ? t('querying') : t('runQuery')}
              </ThemedText>
            </TouchableOpacity>
          </View>

          {queryError ? (
            <ThemedText size={11} variant="muted" testID="knowledge-query-error">
              {t('queryFailed')}
            </ThemedText>
          ) : null}

          {queryResults !== null ? (
            queryResults.length === 0 ? (
              <ThemedText size={11} variant="muted" testID="knowledge-query-empty">
                {t('queryNoResults')}
              </ThemedText>
            ) : (
              <View testID="knowledge-query-results" style={styles.queryResults}>
                {queryResults.map(result => (
                  <View key={result.documentId} style={styles.queryResultRow}>
                    <ThemedText
                      size={11}
                      weight="medium"
                      style={{ color: accent }}
                      accessibilityLabel={`${t('similarity')} ${result.similarity.toFixed(2)}`}
                      testID={`knowledge-similarity-${result.documentId}`}
                    >
                      {result.similarity.toFixed(2)}
                    </ThemedText>
                    <View style={styles.queryResultText}>
                      <ThemedText size={12} numberOfLines={1}>
                        {result.name || result.documentId}
                      </ThemedText>
                      <ThemedText size={10} variant="muted" numberOfLines={2}>
                        {result.content}
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </View>
            )
          ) : null}
        </View>
      </ScrollView>

      <DocumentDetailsSheet
        visible={detailDoc !== null}
        onClose={() => setDetailDoc(null)}
        entityId={entityId}
        collectionName={selected?.name ?? null}
        document={detailDoc}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexShrink: 1,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  centered: {
    paddingHorizontal: 20,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    textAlign: 'center',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionLabel: {
    marginBottom: 6,
    marginTop: 4,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  collectionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  collectionCard: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 132,
    gap: 2,
  },
  breakdownRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  breakdownChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  inlineSpinner: {
    marginVertical: 16,
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  documentText: {
    flex: 1,
    gap: 2,
  },
  documentBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  queryBox: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  queryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  queryInput: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 12,
  },
  queryButton: {
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queryButtonLabel: {
    color: '#ffffff',
  },
  queryResults: {
    marginTop: 10,
    gap: 8,
  },
  queryResultRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  queryResultText: {
    flex: 1,
    gap: 1,
  },
});

export default KnowledgeTab;
