import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TouchableOpacity,
  RefreshControl
} from 'react-native';
import { Appbar, Avatar, List, Divider, ActivityIndicator } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { SettingsMenu } from '../components/navigation/SettingsMenu';
import { getAllEntities } from '../database/repositories/entities';
import { getLastChatMessage } from '../database/repositories/chat_messages';
import { getPrimaryImage, getCharacterProfile, imageToDataURL } from '../database/repositories/characters';
import { useSyncConnection } from '../contexts/SyncConnectionContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { EntitySelectionModal } from '../components/modals/EntitySelectionModal';
import { createLogger } from '../utils/logger';

const log = createLogger('[ChatListScreen]');

interface ChatListItem {
  entityId: string;
  characterId: string | null;
  characterName: string;
  lastMessage: string;
  lastMessageTime: Date | null;
  avatarUri: string | null;
}

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const ChatListScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const navigation = useNavigation<NavigationProp>();
  const { isPaired } = useSyncConnection();
  const [menuVisible, setMenuVisible] = useState(false);
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entityModalVisible, setEntityModalVisible] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<ChatListItem | null>(null);

  // Default impersonated entity is "user" (fallback)
  const defaultImpersonatedEntityId = 'user';
  
  const loadChatList = useCallback(async () => {
    try {
      const entities = await getAllEntities();
      const listItems: ChatListItem[] = [];

      for (const entity of entities) {
        // Skip entities without a character profile linked
        if (!entity.character_profile_id) continue;

        // Get preferred impersonated entity for this partner
        const preferredEntityId = await ChatPreferencesService.getPreferredEntity(entity.id) || defaultImpersonatedEntityId;

        // Get last message for preview using the preferred impersonated entity
        const lastMsg = await getLastChatMessage(preferredEntityId, entity.id);

        // Get avatar
        let avatarUri: string | null = null;
        let characterName = entity.id;
        if (entity.character_profile_id) {
          const profile = await getCharacterProfile(entity.character_profile_id);
          if (profile) {
            characterName = profile.name;
          }
          const primaryImage = await getPrimaryImage(entity.character_profile_id);
          if (primaryImage) {
            avatarUri = imageToDataURL(primaryImage);
          }
        }
        
        listItems.push({
          entityId: entity.id,
          characterId: entity.character_profile_id,
          characterName,
          lastMessage: lastMsg?.content || 'No messages yet',
          lastMessageTime: lastMsg?.created_at || null,
          avatarUri
        });
      }
      
      // Sort by last message time (newest first)
      listItems.sort((a, b) => {
        if (!a.lastMessageTime) return 1;
        if (!b.lastMessageTime) return -1;
        return b.lastMessageTime.getTime() - a.lastMessageTime.getTime();
      });
      
      setChatList(listItems);
    } catch (error) {
      console.error('Failed to load chat list:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  
  useFocusEffect(
    useCallback(() => {
      loadChatList();
    }, [loadChatList])
  );
  
  const onRefresh = () => {
    setRefreshing(true);
    loadChatList();
  };

  const handleChatPress = async (item: ChatListItem) => {
    try {
      // Check for existing preference
      const preferredEntity = await ChatPreferencesService.getPreferredEntity(item.entityId);

      if (preferredEntity) {
        // Navigate directly with saved preference
        log.info(`Using saved entity preference: ${preferredEntity} for ${item.entityId}`);
        navigation.navigate('ChatDetail', {
          partnerEntityId: item.entityId,
          partnerCharacterId: item.characterId || undefined,
          impersonatedEntityId: preferredEntity,
        });
      } else {
        // Show entity selection modal
        log.info(`No entity preference found for ${item.entityId}, showing modal`);
        setSelectedPartner(item);
        setEntityModalVisible(true);
      }
    } catch (error) {
      log.error('Failed to handle chat press:', error);
    }
  };

  const handleEntitySelected = async (entityId: string) => {
    if (!selectedPartner) return;

    try {
      // Save preference
      await ChatPreferencesService.setPreferredEntity(selectedPartner.entityId, entityId);
      log.info(`Saved entity preference: ${entityId} for ${selectedPartner.entityId}`);

      // Navigate to chat
      navigation.navigate('ChatDetail', {
        partnerEntityId: selectedPartner.entityId,
        partnerCharacterId: selectedPartner.characterId || undefined,
        impersonatedEntityId: entityId,
      });

      // Cleanup
      setEntityModalVisible(false);
      setSelectedPartner(null);
    } catch (error) {
      log.error('Failed to save entity preference:', error);
      // Still navigate even if save failed
      navigation.navigate('ChatDetail', {
        partnerEntityId: selectedPartner.entityId,
        partnerCharacterId: selectedPartner.characterId || undefined,
        impersonatedEntityId: entityId,
      });
      setEntityModalVisible(false);
      setSelectedPartner(null);
    }
  };

  const handleEntitySelectionCancel = () => {
    log.info('Entity selection cancelled');
    setEntityModalVisible(false);
    setSelectedPartner(null);
  };

  const renderItem = ({ item }: { item: ChatListItem }) => (
    <TouchableOpacity onPress={() => handleChatPress(item)}>
      <List.Item
        title={item.characterName}
        description={item.lastMessage}
        descriptionNumberOfLines={1}
        left={() => (
          item.avatarUri ? (
            <Avatar.Image size={48} source={{ uri: item.avatarUri }} />
          ) : (
            <Avatar.Text 
              size={48} 
              label={item.characterName.substring(0, 2).toUpperCase()} 
            />
          )
        )}
        right={() => item.lastMessageTime && (
          <ThemedText variant="muted" size={12}>
            {formatTime(item.lastMessageTime)}
          </ThemedText>
        )}
        style={styles.listItem}
      />
      <Divider />
    </TouchableOpacity>
  );
  
  if (loading) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }
  
  return (
    <ThemedView style={styles.container}>
      <Appbar.Header style={{ backgroundColor: theme?.colors.background.surface }}>
        <Appbar.Content
          title="Chats"
          titleStyle={{ color: theme?.colors.text.primary, fontWeight: 'bold' }}
        />
        <Appbar.Action
          icon={() => <Icon name="menu" size={24} color={theme?.colors.text.primary} />}
          onPress={() => setMenuVisible(true)}
        />
      </Appbar.Header>
      
      {!isPaired ? (
        <View style={styles.notPairedContainer}>
          <Icon name="connection" size={64} color={theme?.colors.text.muted} />
          <ThemedText style={styles.notPairedText}>
            Not connected to Harmony Link
          </ThemedText>
          <TouchableOpacity
            style={[styles.connectButton, { backgroundColor: theme?.colors.accent.primary }]}
            onPress={() => navigation.navigate('ConnectionSetup' as any)}
          >
            <ThemedText variant="primary">Connect Now</ThemedText>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={chatList}
          renderItem={renderItem}
          keyExtractor={(item) => item.entityId}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="chat-outline" size={64} color={theme?.colors.text.muted} />
              <ThemedText variant="secondary" style={styles.emptyText}>
                No conversations yet
              </ThemedText>
              <ThemedText variant="muted" size={12}>
                Sync with Harmony Link to load your entities
              </ThemedText>
            </View>
          }
        />

      )}
      
      <SettingsMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onNavigate={(screen) => navigation.navigate(screen as any)}
      />

      <EntitySelectionModal
        visible={entityModalVisible}
        partnerEntityId={selectedPartner?.entityId || ''}
        onSelect={handleEntitySelected}
        onCancel={handleEntitySelectionCancel}
      />
    </ThemedView>
  );
};

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  listItem: { paddingHorizontal: 16 },
  notPairedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32
  },
  notPairedText: { marginTop: 16, marginBottom: 24 },
  connectButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    marginTop: 100
  },
  emptyText: { marginTop: 16, marginBottom: 8 }
});
