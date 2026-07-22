/**
 * SearchScreen — Global exploration query tool
 *
 * Full-text search across personas, characters, conversations,
 * and configuration items within the Harmony ecosystem. Uses a
 * glass-immersive design with a prominent search bar and
 * reactive result-filtering interface.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { hexToRgba } from '../utils/colorUtils';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';

export const SearchScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { top: safeTop } = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;
  const inputBg = hexToRgba(baseHex, 0.55);

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: safeTop + 12, paddingBottom: TAB_BAR_CONTENT_PAD },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Page header — gradient stripe + title + subtitle */}
        <ScreenHeader
          title="Search"
          subtitle="Find characters, conversations, and configurations"
          style={{ paddingTop: 0 }}
        >
            {/* Search input */}
            <View style={[styles.searchBar, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25) }]}>
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={theme.colors.text.muted}
            style={styles.searchIcon}
          />
          <TextInput
            style={[styles.searchInput, { color: theme.colors.text.primary }]}
            placeholder="Search Harmony..."
            placeholderTextColor={theme.colors.text.disabled}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <MaterialCommunityIcons
              name="close-circle"
              size={18}
              color={theme.colors.text.muted}
              onPress={() => setQuery('')}
              style={styles.clearIcon}
            />
          )}
          </View>
        </ScreenHeader>

        {/* Empty state */}
        {query.length === 0 && (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="compass-outline"
              size={48}
              color={theme.colors.text.disabled}
            />
            <ThemedText variant="disabled" size={14} style={styles.emptyText}>
              Start typing to explore personas, chats, and settings
            </ThemedText>
          </View>
        )}

        {/* No results */}
        {query.length > 0 && (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="text-search"
              size={48}
              color={theme.colors.text.disabled}
            />
            <ThemedText variant="disabled" size={14} style={styles.emptyText}>
              No results found for "{query}"
            </ThemedText>
          </View>
        )}

      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 24,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  clearIcon: {
    marginLeft: 6,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 240,
  },
  results: {
    gap: 10,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  resultIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: {
    flex: 1,
    gap: 2,
  },
});

export default SearchScreen;
