/**
 * DocumentDetailsSheet — one RAG document's full content + metadata
 * (tts-voice-ux Phase 6).
 *
 * The engine's `DocumentDetails` response includes the stored `embedding`
 * vector. It is displayed ONLY as its dimension (e.g. "dim 1536") — the vector
 * values are never rendered, stringified or relayed anywhere in the UI.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { DocumentDetailsDto, DocumentInfoDto } from '../../services/engine/EngineApiClient';
import { getRagDocument } from '../../services/engine/repositories/ragCollections';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { createLogger } from '../../utils/logger';

const log = createLogger('[DocumentDetailsSheet]');

function formatCreatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface DocumentDetailsSheetProps {
  visible: boolean;
  onClose: () => void;
  entityId: string | null;
  collectionName: string | null;
  /** The list row the user tapped; details are fetched for the embedding dim. */
  document: DocumentInfoDto | null;
}

export const DocumentDetailsSheet: React.FC<DocumentDetailsSheetProps> = ({
  visible,
  onClose,
  entityId,
  collectionName,
  document,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chatDetail');
  const { bottom: safeBottom } = useSafeAreaInsets();

  const [details, setDetails] = useState<DocumentDetailsDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible || !entityId || !collectionName || !document) {
      setDetails(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setDetails(null);
    getRagDocument(entityId, collectionName, document.id)
      .then(next => {
        if (!cancelled) setDetails(next);
      })
      .catch(err => {
        // The row already carries content + metadata; a failed detail read only
        // costs the embedding dimension, so degrade instead of blocking.
        log.warn(`Document details read failed for ${document.id}:`, err);
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, entityId, collectionName, document]);

  if (!theme) return null;

  const row = document;
  const content = details?.content ?? row?.content ?? '';
  const metadata = details?.metadata ?? row?.metadata ?? {};
  const embeddingDim = details?.embedding?.length ?? null;
  const title = row?.name || row?.id || '';

  return (
    <Modal
      visible={visible && row !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common:close')}
        />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: safeBottom + 16,
              backgroundColor: theme.colors.background.surface,
              borderColor: theme.colors.border.default,
            },
          ]}
          testID="document-details-sheet"
        >
          <View style={styles.grabber} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText size={16} weight="bold" numberOfLines={2} hierarchy="header">
                {title}
              </ThemedText>
              <ThemedText variant="muted" size={11}>
                {t('documentDetails')}
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('common:close')}
              testID="document-details-close"
            >
              <Icon name="close" size={20} color={theme.colors.text.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.badgeRow}>
              {row?.archetype ? (
                <View
                  style={[styles.badge, { backgroundColor: theme.colors.accent.primary + '22' }]}
                  testID="document-archetype-badge"
                >
                  <ThemedText size={10} variant="accent">
                    {row.archetype}
                  </ThemedText>
                </View>
              ) : null}
              {row?.category ? (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor:
                        (theme.colors.accent.secondary ?? theme.colors.accent.primary) + '22',
                    },
                  ]}
                  testID="document-category-badge"
                >
                  <ThemedText size={10} variant="secondary">
                    {row.category}
                  </ThemedText>
                </View>
              ) : null}
              {row?.createdAt ? (
                <ThemedText size={10} variant="muted">
                  {formatCreatedAt(row.createdAt)}
                </ThemedText>
              ) : null}
            </View>

            <ThemedText size={12} variant="muted" weight="medium" style={styles.sectionLabel}>
              {t('documentContent')}
            </ThemedText>
            <ThemedText size={13} testID="document-details-content" style={styles.content}>
              {content}
            </ThemedText>

            <ThemedText size={12} variant="muted" weight="medium" style={styles.sectionLabel}>
              {t('documentMetadata')}
            </ThemedText>
            <View style={styles.metadata}>
              {Object.keys(metadata).length === 0 ? (
                <ThemedText size={12} variant="muted" testID="document-metadata-empty">
                  {t('documentNoMetadata')}
                </ThemedText>
              ) : (
                Object.entries(metadata).map(([key, value]) => (
                  <View key={key} style={styles.metadataRow}>
                    <ThemedText size={11} variant="muted" style={styles.metadataKey}>
                      {key}
                    </ThemedText>
                    <ThemedText size={11} style={styles.metadataValue}>
                      {String(value)}
                    </ThemedText>
                  </View>
                ))
              )}
            </View>

            <View style={styles.embeddingRow}>
              {loading ? (
                <ActivityIndicator size="small" color={theme.colors.accent.primary} />
              ) : embeddingDim !== null ? (
                <ThemedText size={11} variant="muted" testID="document-embedding-dim">
                  {t('documentEmbeddingDim', { dim: embeddingDim })}
                </ThemedText>
              ) : null}
              {failed ? (
                <ThemedText size={11} variant="muted" testID="document-details-failed">
                  {t('documentDetailsUnavailable')}
                </ThemedText>
              ) : null}
              <ThemedText size={11} variant="muted">
                {t('documentEmbeddingHidden')}
              </ThemedText>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
  },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    paddingHorizontal: 20,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(148,163,184,0.4)',
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 8,
  },
  headerText: {
    flex: 1,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sectionLabel: {
    marginBottom: 4,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  content: {
    lineHeight: 20,
    marginBottom: 14,
  },
  metadata: {
    gap: 4,
    marginBottom: 12,
  },
  metadataRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metadataKey: {
    minWidth: 96,
  },
  metadataValue: {
    flex: 1,
  },
  embeddingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
  },
});

export default DocumentDetailsSheet;
