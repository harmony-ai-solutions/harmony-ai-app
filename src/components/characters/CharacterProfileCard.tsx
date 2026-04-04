import React, { useRef } from 'react';
import {
  TouchableOpacity,
  View,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { CharacterProfile } from '../../database/models';

interface CharacterProfileCardProps {
  profile: CharacterProfile;
  imageUri: string | null; // base64 data URL or null for placeholder
  onPress: () => void;
  onLongPress: () => void;
}

export const CharacterProfileCard: React.FC<CharacterProfileCardProps> = ({
  profile,
  imageUri,
  onPress,
  onLongPress,
}) => {
  const { theme } = useAppTheme();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 20,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
    }).start();
  };

  if (!theme) return null;

  return (
    <Animated.View
      style={[styles.wrapper, { transform: [{ scale: scaleAnim }] }]}
    >
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.background.elevated,
            borderColor: theme.colors.border.default,
          },
        ]}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        delayLongPress={400}
      >
        {/* Image area — 3:4 aspect ratio */}
        <View
          style={[
            styles.imageContainer,
            { backgroundColor: theme.colors.background.base },
          ]}
        >
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={styles.image}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.placeholder}>
              <Icon
                name="account"
                size={48}
                color={theme.colors.text.disabled ?? theme.colors.text.muted}
              />
            </View>
          )}
        </View>

        {/* Text area */}
        <View style={styles.textContainer}>
          <ThemedText
            weight="bold"
            size={14}
            numberOfLines={1}
            style={[styles.name, { color: theme.colors.accent.primary }]}
          >
            {profile.name}
          </ThemedText>
          <ThemedText
            variant="muted"
            size={12}
            numberOfLines={2}
            style={styles.description}
          >
            {profile.description || 'No description provided.'}
          </ThemedText>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1, // fills one column in FlatList numColumns={2}
    maxWidth: '50%',
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageContainer: {
    aspectRatio: 3 / 4,
    width: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    padding: 10,
    gap: 4,
  },
  name: {
    letterSpacing: 0.1,
  },
  description: {
    lineHeight: 16,
    minHeight: 32, // reserve space for 2 lines even when empty
  },
});
