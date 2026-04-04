import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import {
  Appbar,
  Avatar,
  FAB,
  List,
  Divider,
  ActivityIndicator,
} from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { SettingsMenu } from '../components/navigation/SettingsMenu';
import { getAllEntities } from '../database/repositories/entities';
import { getLastConversationMessage } from '../database/repositories/conversation_messages';
import {
  getPrimaryImage,
  getCharacterProfile,
  imageToDataURL,
} from '../database/repositories/characters';

import { useSyncConnection } from '../contexts/SyncConnectionContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ChatPreferencesService from '../services/ChatPreferencesService';
import { ImpersonationSelectorModal } from '../components/modals/ImpersonationSelectorModal';
import { InfoModal } from '../components/modals/InfoModal';
import { createLogger } from '../utils/logger';

const log = createLogger('[ChatListScreen]');

interface ChatListItem {
  entityId: string;
  characterId: string | null;
  characterName: string;
  lastMessage: string;
  lastMessageSender: string; // Name of who sent the last message (e.g., "You:" or character name)
  lastMessageTime: Date | null;
  avatarUri: string | null;
}

const getEntityDisplayName = (
  alias: string | null,
  characterProfileName: string | null,
  entityId: string,
): string => {
  if (alias) return alias;
  if (characterProfileName) return characterProfileName;
  return entityId;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const ChatListScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const navigation = useNavigation<NavigationProp>();
  const { isPaired } = useSyncConnection();
  const [menuVisible, setMenuVisible] = useState(false);
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  // Global impersonation state
  const [impersonatedEntityId, setImpersonatedEntityId] = useState<string>('user');
  const [impersonatedEntityDisplay, setImpersonatedEntityDisplay] = useState<{
    name: string;
    avatarUri: string | null;
  }>({ name: 'User', avatarUri: null });
  const [selectorModalVisible, setSelectorModalVisible] = useState(false);

  const loadChatList = useCallback(async (activeEntityId: string) => {
    try {
      const entities = await getAllEntities();
      const listItems: ChatListItem[] = [];

      for (const entity of entities) {
        // Skip the entity we're currently chatting as (can't chat with yourself)
        if (entity.id === activeEntityId) continue;

        // Get last message for preview using the global impersonated entity
        const lastMsg = await getLastConversationMessage(activeEntityId, entity.id);

        // Determine who sent the last message
        let lastMessageSender = '';
        if (lastMsg) {
          if (lastMsg.sender_entity_id === activeEntityId) {
            // We sent the last message
            lastMessageSender = 'You';
          } else {
            // Partner sent the last message - use their character name
            lastMessageSender = entity.id;
            if (entity.character_profile_id) {
              const profile = await getCharacterProfile(
                entity.character_profile_id,
              );
              if (profile) {
                lastMessageSender = profile.name;
              }
            }
          }
        }

        // Get character profile and avatar
        let avatarUri: string | null = null;
        let characterProfileName: string | null = null;
        if (entity.character_profile_id) {
          const profile = await getCharacterProfile(
            entity.character_profile_id,
          );
          characterProfileName = profile?.name ?? null;
          const primaryImage = await getPrimaryImage(
            entity.character_profile_id,
          );
          if (primaryImage) {
            avatarUri = imageToDataURL(primaryImage);
          }
        }

        // Use alias → character profile name → truncated UUID
        const characterName = getEntityDisplayName(
          entity.alias,
          characterProfileName,
          entity.id,
        );

        listItems.push({
          entityId: entity.id,
          characterId: entity.character_profile_id,
          characterName,
          lastMessage: lastMsg?.content || 'No messages yet',
          lastMessageSender,
          lastMessageTime: lastMsg?.created_at || null,
          avatarUri,
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

  // Load global impersonated entity on mount
  const loadImpersonatedEntity = useCallback(async () => {
    try {
      const allEntities = await getAllEntities();
      const storedId =
        await ChatPreferencesService.getGlobalImpersonatedEntity();

      // Pick best default: stored > 'user' entity > first entity
      let resolvedId = storedId;
      if (!resolvedId || !allEntities.some(e => e.id === resolvedId)) {
        const userEntity = allEntities.find(e => e.id === 'user');
        resolvedId = userEntity
          ? userEntity.id
          : (allEntities[0]?.id ?? 'user');
      }

      setImpersonatedEntityId(resolvedId);

      // Load display info for banner
      const entity = allEntities.find(e => e.id === resolvedId);
      if (entity?.character_profile_id) {
        const profile = await getCharacterProfile(entity.character_profile_id);
        const image = await getPrimaryImage(entity.character_profile_id);
        setImpersonatedEntityDisplay({
          name: profile?.name ?? resolvedId,
          avatarUri: image ? imageToDataURL(image) : null,
        });
      } else {
        setImpersonatedEntityDisplay({ name: resolvedId, avatarUri: null });
      }
    } catch (error) {
      log.error('Failed to load impersonated entity:', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadImpersonatedEntity();
    }, [loadImpersonatedEntity]),
  );

  // Re-run loadChatList when impersonatedEntityId changes
  useEffect(() => {
    if (impersonatedEntityId) {
      loadChatList(impersonatedEntityId);
    }
  }, [impersonatedEntityId, loadChatList]);

  const onRefresh = () => {
    setRefreshing(true);
    loadChatList(impersonatedEntityId);
  };

  const handleChatPress = (item: ChatListItem) => {
    // Safety check: don't allow chatting with yourself
    if (item.entityId === impersonatedEntityId) {
      log.warn('Cannot chat with yourself');
      return;
    }

    navigation.navigate('ChatDetail', {
      partnerEntityId: item.entityId,
      partnerCharacterId: item.characterId || undefined,
      impersonatedEntityId,
    });
  };

  const handleImpersonationSelect = async (entityId: string) => {
    try {
      await ChatPreferencesService.setGlobalImpersonatedEntity(entityId);
      setImpersonatedEntityId(entityId);

      // Also update the display info for the banner
      const allEntities = await getAllEntities();
      const entity = allEntities.find(e => e.id === entityId);
      if (entity?.character_profile_id) {
        const profile = await getCharacterProfile(entity.character_profile_id);
        const image = await getPrimaryImage(entity.character_profile_id);
        setImpersonatedEntityDisplay({
          name: profile?.name ?? entityId,
          avatarUri: image ? imageToDataURL(image) : null,
        });
      } else {
        setImpersonatedEntityDisplay({ name: entityId, avatarUri: null });
      }

      setSelectorModalVisible(false);
      // loadChatList will re-run via the useEffect that watches impersonatedEntityId
    } catch (error) {
      log.error('Failed to save global entity preference:', error);
      setSelectorModalVisible(false);
    }
  };

  const renderItem = ({ item }: { item: ChatListItem }) => (
    <TouchableOpacity onPress={() => handleChatPress(item)}>
      <List.Item
        title={item.characterName}
        description={
          item.lastMessageSender
            ? `${item.lastMessageSender}: ${item.lastMessage}`
            : item.lastMessage
        }
        descriptionNumberOfLines={1}
        left={() =>
          item.avatarUri ? (
            <Avatar.Image size={48} source={{ uri: item.avatarUri }} />
          ) : (
            <Avatar.Text
              size={48}
              label={item.characterName.substring(0, 2).toUpperCase()}
            />
          )
        }
        right={() =>
          item.lastMessageTime ? (
            <ThemedText variant="muted" size={12} style={styles.timeText}>
              {formatTime(item.lastMessageTime)}
            </ThemedText>
          ) : null
        }
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
      <Appbar.Header
        style={{
          backgroundColor: theme?.colors.background.surface,
          zIndex: 10,
        }}
      >
        <Appbar.BackAction
          color={theme?.colors.text.primary}
          onPress={() => navigation.navigate('Landing')}
        />
        <Appbar.Content
          title={
            <View style={styles.titleContainer}>
              <ThemedText variant="primary" style={styles.titleText}>
                Chats
              </ThemedText>
              <TouchableOpacity
                onPress={() => setInfoModalVisible(true)}
                style={styles.infoButton}
              >
                <Icon
                  name="information-outline"
                  size={20}
                  color={theme?.colors.text.muted}
                />
              </TouchableOpacity>
            </View>
          }
        />
        <TouchableOpacity
          style={styles.impersonationHeaderAction}
          onPress={() => setSelectorModalVisible(true)}
        >
          <View style={styles.impersonationBannerText}>
            <ThemedText variant="muted" size={11}>
              Chatting as
            </ThemedText>
            <ThemedText
              variant="primary"
              size={14}
              style={{ fontWeight: '600' }}
            >
              {impersonatedEntityDisplay.name}
            </ThemedText>
          </View>
          {impersonatedEntityDisplay.avatarUri ? (
            <Avatar.Image
              size={28}
              source={{ uri: impersonatedEntityDisplay.avatarUri }}
            />
          ) : (
            <Avatar.Text
              size={28}
              label={impersonatedEntityDisplay.name
                .substring(0, 2)
                .toUpperCase()}
            />
          )}
        </TouchableOpacity>
        <Appbar.Action
          icon={() => (
            <Icon name="menu" size={24} color={theme?.colors.text.primary} />
          )}
          onPress={() => setMenuVisible(true)}
        />
      </Appbar.Header>

      {!isPaired ? (
        <View style={styles.notPairedContainer}>
          <Icon name="connection" size={64} color={theme?.colors.text.muted} />
          <ThemedText style={styles.notPairedText}>Not connected</ThemedText>
          <ThemedText variant="muted" size={13} style={styles.notPairedSubText}>
            Connect to Harmony Link or cloud to load your entities.
          </ThemedText>
          <TouchableOpacity
            style={[
              styles.connectButton,
              { backgroundColor: theme?.colors.accent.primary },
            ]}
            onPress={() => navigation.navigate('ConnectionSetup')}
          >
            <ThemedText variant="primary">Connect Now</ThemedText>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={chatList}
          renderItem={renderItem}
          keyExtractor={item => item.entityId}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon
                name="chat-outline"
                size={64}
                color={theme?.colors.text.muted}
              />
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

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme?.colors.accent.primary }]}
        onPress={() => navigation.navigate('CreateAI', {})}
        color="#fff"
      />

      <SettingsMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onNavigate={screen => navigation.navigate(screen as any)}
      />

      <ImpersonationSelectorModal
        visible={selectorModalVisible}
        onSelect={handleImpersonationSelect}
        onCancel={() => setSelectorModalVisible(false)}
        preSelectedEntityId={impersonatedEntityId}
      />

      <InfoModal
        visible={infoModalVisible}
        onClose={() => setInfoModalVisible(false)}
        title="About Chats & Roleplay"
        message="Select an AI Entity from the list below to start chatting with. Each entity represents a unique AI personality you can interact with.\n\nUse the 'Chatting as' banner at the top to choose which persona you want to use. This determines how each AI entity relates to you — for example, you could chat as yourself, or adopt a fictional character.\n\nAI Entities learn individual relationships during interaction and may behave very differently depending on the Persona you are using."
        icon="chat-processing"
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
    padding: 32,
  },
  notPairedText: { marginTop: 16, marginBottom: 8 },
  notPairedSubText: { marginBottom: 24, textAlign: 'center' },
  connectButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    marginTop: 100,
  },
  emptyText: { marginTop: 16, marginBottom: 8 },
  titleContainer: { flexDirection: 'row', alignItems: 'center' },
  titleText: { fontWeight: 'bold', fontSize: 24 },
  infoButton: { marginLeft: 8 },
  descriptionContainer: { marginTop: 2 },
  descriptionText: { fontSize: 12 },
  impersonationHeaderAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  impersonationBannerText: {
    alignItems: 'flex-end',
  },
  timeText: {
    alignSelf: 'center',
    marginRight: 8,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
});
