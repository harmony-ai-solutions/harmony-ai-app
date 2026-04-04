import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Appbar, FAB } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedButton } from '../components/themed/ThemedButton';
import { SettingsMenu } from '../components/navigation/SettingsMenu';
import { CharacterProfileCard } from '../components/characters/CharacterProfileCard';
import {
  getAllCharacterProfiles,
  getCharacterImages,
  deleteCharacterProfile,
} from '../database/repositories/characters';
import { createDataURL } from '../database/base64';
import { CharacterProfile } from '../database/models';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const CharactersScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { theme } = useAppTheme();

  const [menuVisible, setMenuVisible] = useState(false);
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [primaryImages, setPrimaryImages] = useState<
    Record<string, string | null>
  >({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Reload on focus (handles return from edit screen)
  useFocusEffect(
    useCallback(() => {
      loadProfiles();
    }, []),
  );

  const loadProfiles = async () => {
    setIsLoading(true);
    try {
      const data = await getAllCharacterProfiles();
      setProfiles(data);

      // Load primary images for all profiles in parallel
      const imageMap: Record<string, string | null> = {};
      await Promise.all(
        data.map(async profile => {
          try {
            const images = await getCharacterImages(profile.id);
            const primary = images.find(img => img.is_primary === true);
            imageMap[profile.id] = primary
              ? createDataURL(primary.image_data, primary.mime_type)
              : null;
          } catch {
            imageMap[profile.id] = null;
          }
        }),
      );
      setPrimaryImages(imageMap);
    } catch (err) {
      console.error('Failed to load profiles:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredProfiles = profiles.filter(
    p =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.description?.toLowerCase().includes(searchQuery.toLowerCase()) ??
        false),
  );

  const handleEdit = (profile: CharacterProfile) => {
    navigation.navigate('CharacterProfileEdit', { profileId: profile.id });
  };

  const handleLongPress = (profile: CharacterProfile) => {
    Alert.alert(
      'Delete Profile',
      `Delete "${profile.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCharacterProfile(profile.id);
              setProfiles(prev => prev.filter(p => p.id !== profile.id));
              setPrimaryImages(prev => {
                const next = { ...prev };
                delete next[profile.id];
                return next;
              });
            } catch {
              Alert.alert('Error', 'Failed to delete profile.');
            }
          },
        },
      ],
    );
  };

  const handleCreateNew = () => {
    navigation.navigate('CharacterProfileEdit', {}); // no profileId = create mode
  };

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      {/* Appbar */}
      <Appbar.Header
        style={[
          styles.header,
          { backgroundColor: theme.colors.background.surface },
        ]}
      >
        <Appbar.BackAction
          color={theme.colors.text.primary}
          onPress={() => navigation.goBack()}
        />
        <Appbar.Content
          title="AI Characters"
          titleStyle={{ color: theme.colors.text.primary, fontWeight: 'bold' }}
        />
        <Appbar.Action
          icon="menu"
          color={theme.colors.text.primary}
          onPress={() => setMenuVisible(true)}
        />
      </Appbar.Header>

      {/* Search bar */}
      <View
        style={[
          styles.searchContainer,
          { backgroundColor: theme.colors.background.surface },
        ]}
      >
        <Icon
          name="magnify"
          size={20}
          color={theme.colors.text.muted}
          style={styles.searchIcon}
        />
        <TextInput
          style={[styles.searchInput, { color: theme.colors.text.primary }]}
          placeholder="Search characters..."
          placeholderTextColor={theme.colors.text.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Icon
              name="close-circle"
              size={18}
              color={theme.colors.text.muted}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : filteredProfiles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon
            name="account-outline"
            size={72}
            color={theme.colors.text.muted}
          />
          <ThemedText weight="bold" size={18} style={styles.emptyTitle}>
            {searchQuery ? 'No results found' : 'No character profiles yet'}
          </ThemedText>
          <ThemedText variant="muted" size={14} style={styles.emptySubtext}>
            {searchQuery
              ? 'Try a different search term.'
              : 'Create a character profile to start chatting.'}
          </ThemedText>
          {!searchQuery && (
            <ThemedButton
              variant="primary"
              label="Create First Profile"
              onPress={handleCreateNew}
              style={styles.emptyButton}
            />
          )}
        </View>
      ) : (
        <FlatList
          data={filteredProfiles}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <CharacterProfileCard
              profile={item}
              imageUri={primaryImages[item.id] ?? null}
              onPress={() => handleEdit(item)}
              onLongPress={() => handleLongPress(item)}
            />
          )}
        />
      )}

      {/* FAB */}
      {!isLoading && (
        <FAB
          icon="plus"
          style={[styles.fab, { backgroundColor: theme.colors.accent.primary }]}
          onPress={handleCreateNew}
          color="#fff"
        />
      )}

      <SettingsMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onNavigate={screen => navigation.navigate(screen as any)}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { elevation: 4 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
  },
  searchIcon: { marginRight: 4 },
  searchInput: { flex: 1, fontSize: 15 },
  listContent: { padding: 12, paddingBottom: 80 },
  columnWrapper: { gap: 12, marginBottom: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: { textAlign: 'center', marginTop: 12 },
  emptySubtext: { textAlign: 'center' },
  emptyButton: { marginTop: 8, width: '100%' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
});
