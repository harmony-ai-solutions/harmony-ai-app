/**
 * EmojiSearchBar - Debounced search input
 */
import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Theme } from '../../theme/types';

interface EmojiSearchBarProps {
  onSearch: (query: string) => void;
  theme: Theme;
}

const DEBOUNCE_MS = 200;

export const EmojiSearchBar: React.FC<EmojiSearchBarProps> = memo(({
  onSearch,
  theme,
}) => {
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      onSearch(query);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, onSearch]);

  const handleClear = useCallback(() => {
    setQuery('');
    onSearch('');
  }, [onSearch]);

  const hasQuery = query.length > 0;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.background.surface,
          borderColor: theme.colors.border.default,
        },
      ]}
    >
      {/* Search icon */}
      <View style={styles.searchIcon}>
        <TouchableOpacity disabled>
          <View style={styles.iconPlaceholder}>
            <SearchIcon theme={theme} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Input */}
      <TextInput
        style={[
          styles.input,
          { color: theme.colors.text.primary },
        ]}
        value={query}
        onChangeText={setQuery}
        placeholder="Search emoji..."
        placeholderTextColor={theme.colors.text.muted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      {/* Clear button */}
      {hasQuery && (
        <TouchableOpacity
          onPress={handleClear}
          style={styles.clearButton}
        >
          <ClearIcon theme={theme} />
        </TouchableOpacity>
      )}
    </View>
  );
});

// Simple search icon component
const SearchIcon: React.FC<{ theme: Theme }> = ({ theme }) => (
  <View style={styles.searchIconContainer}>
    <View
      style={[
        styles.searchCircle,
        { borderColor: theme.colors.text.muted },
      ]}
    />
    <View
      style={[
        styles.searchHandle,
        { backgroundColor: theme.colors.text.muted },
      ]}
    />
  </View>
);

// Clear icon component
const ClearIcon: React.FC<{ theme: Theme }> = ({ theme }) => (
  <View style={styles.clearIconContainer}>
    <View
      style={[
        styles.clearLine,
        { backgroundColor: theme.colors.text.muted },
      ]}
    />
    <View
      style={[
        styles.clearLine,
        styles.clearLineRotated,
        { backgroundColor: theme.colors.text.muted },
      ]}
    />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  iconPlaceholder: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchIconContainer: {
    width: 16,
    height: 16,
    position: 'relative',
  },
  searchCircle: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    position: 'absolute',
    top: 2,
    left: 2,
  },
  searchHandle: {
    width: 2,
    height: 6,
    position: 'absolute',
    bottom: 0,
    right: 2,
    transform: [{ rotate: '45deg' }],
    borderRadius: 1,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
  },
  clearIconContainer: {
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearLine: {
    position: 'absolute',
    width: 12,
    height: 2,
    borderRadius: 1,
  },
  clearLineRotated: {
    transform: [{ rotate: '45deg' }],
  },
});

export default EmojiSearchBar;