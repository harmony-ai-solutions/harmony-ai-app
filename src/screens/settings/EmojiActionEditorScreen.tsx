/**
 * EmojiActionEditorScreen - Full screen editor for emoji actions
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { Appbar } from 'react-native-paper';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { createLogger } from '../../utils/logger';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedAppbar } from '../../components/themed/ThemedAppbar';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { ThemedFab } from '../../components/themed/ThemedFab';
import { EmojiActionCard } from '../../components/settings/EmojiActionCard';
import { EmojiActionEditModal } from '../../components/settings/EmojiActionEditModal';
import { EntityEmojiActionService } from '../../services/EntityEmojiActionService';
import { useAppTheme } from '../../contexts/ThemeContext';
import { EmojiAction } from '../../database/models';

const log = createLogger('[EmojiActionEditorScreen]');

type RouteParams = {
  EmojiActionEditor: {
    entityId: string;
    entityName: string;
  };
};

export const EmojiActionEditorScreen: React.FC = () => {
  const route = useRoute<RouteProp<RouteParams, 'EmojiActionEditor'>>();
  const navigation = useNavigation();
  const { theme } = useAppTheme();
  const { entityId, entityName } = route.params;

  // State
  const [actions, setActions] = useState<EmojiAction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAction, setEditingAction] = useState<EmojiAction | null>(null);

  // Load actions
  const loadActions = useCallback(async () => {
    try {
      const loaded = await EntityEmojiActionService.getAllActions(entityId);
      setActions(loaded);
    } catch (error) {
      log.error('Failed to load emoji actions:', error);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  // Initial load
  useEffect(() => {
    loadActions();
  }, [loadActions]);

  // Pull to refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadActions();
    setRefreshing(false);
  }, [loadActions]);

  // Handle reset to defaults
  const handleResetToDefaults = useCallback(async () => {
    try {
      await EntityEmojiActionService.seedDefaults(entityId, true);
      await loadActions();
      log.info('Reset emoji actions to defaults');
    } catch (error) {
      log.error('Failed to reset to defaults:', error);
    }
  }, [entityId, loadActions]);

  // Handle add new
  const handleAddNew = useCallback(() => {
    setEditingAction(null);
    setModalVisible(true);
  }, []);

  // Handle edit
  const handleEdit = useCallback((action: EmojiAction) => {
    setEditingAction(action);
    setModalVisible(true);
  }, []);

  // Handle delete
  const handleDelete = useCallback(async (action: EmojiAction) => {
    try {
      await EntityEmojiActionService.removeAction(action.id, entityId);
      await loadActions();
      log.debug('Deleted emoji action:', action.id);
    } catch (error) {
      log.error('Failed to delete action:', error);
    }
  }, [entityId, loadActions]);

  // Handle save from modal
  const handleSave = useCallback(
    async (action: Omit<EmojiAction, 'createdAt' | 'updatedAt'>) => {
      try {
        await EntityEmojiActionService.saveAction(action);
        await loadActions();
        setModalVisible(false);
        log.debug('Saved emoji action:', action.id);
      } catch (error) {
        log.error('Failed to save action:', error);
        throw error;
      }
    },
    [loadActions]
  );

  // Handle close modal
  const handleCloseModal = useCallback(() => {
    setModalVisible(false);
    setEditingAction(null);
  }, []);

  if (!theme) {
    return null;
  }

  const { colors } = theme;

  // Render item
  const renderItem = ({ item }: { item: EmojiAction }) => (
    <EmojiActionCard
      action={item}
      onPress={() => handleEdit(item)}
      onDelete={() => handleDelete(item)}
      theme={theme}
    />
  );

  // Empty component
  const ListEmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <ThemedText variant="muted" size={16} style={styles.emptyText}>
        No emoji actions yet
      </ThemedText>
      <ThemedText variant="secondary" size={13} style={styles.emptySubtext}>
        Tap + to add your first action
      </ThemedText>
    </View>
  );

  // Header component
  const ListHeaderComponent = () => (
    <View style={styles.listHeader}>
      {/* Summary bar */}
      <View style={[styles.summaryBar, { backgroundColor: colors.background.surface }]}>
        <ThemedText variant="secondary" size={14}>
          {actions.length} action{actions.length !== 1 ? 's' : ''}
        </ThemedText>
        <ThemedButton
          label="Add Action"
          icon="plus"
          iconSize={18}
          onPress={handleAddNew}
          style={styles.addButton}
        />
      </View>
    </View>
  );

  return (
    <ThemedView variant="base" style={styles.container}>
      <ThemedAppbar style={styles.header}>
        <Appbar.BackAction
          color={colors.text.primary}
          onPress={() => navigation.goBack()}
        />
        <Appbar.Content
          title={`${entityName}'s Actions`}
          titleStyle={{ color: colors.text.primary, fontWeight: 'bold' }}
        />
        <TouchableOpacity
          onPress={handleResetToDefaults}
          style={styles.headerButton}
        >
          <ThemedText size={14} style={{ color: colors.accent.primary }}>
            Reset
          </ThemedText>
        </TouchableOpacity>
      </ThemedAppbar>

      {/* Actions list */}
      <FlatList
        data={actions}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent.primary}
          />
        }
      />

      {/* FAB - only show when list has items */}
      {actions.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.accent.primary }]}
          onPress={handleAddNew}
        >
          <Icon name="plus" size={28} color={colors.background.base} />
        </TouchableOpacity>
      )}

      {/* Edit Modal */}
      <EmojiActionEditModal
        entityId={entityId}
        existingAction={editingAction}
        existingActions={actions}
        visible={modalVisible}
        onSave={handleSave}
        onClose={handleCloseModal}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    elevation: 4,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100, // Space for FAB
  },
  listHeader: {
    marginBottom: 8,
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    marginBottom: 8,
  },
  emptySubtext: {
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  headerButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});

export default EmojiActionEditorScreen;