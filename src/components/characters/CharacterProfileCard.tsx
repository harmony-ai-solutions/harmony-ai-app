import React, { useRef } from 'react';
import {
  TouchableOpacity,
  View,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { CharacterProfile } from '../../database/models';

interface CharacterProfileCardProps {
  profile: CharacterProfile;
  imageUri: string | null; // base64 data URL or null for placeholder
  imageCount?: number;     // total images this profile has
  onPress: () => void;
  onLongPress: () => void;
}

export const CharacterProfileCard: React.FC<CharacterProfileCardProps> = ({
  profile,
  imageUri,
  imageCount = 0,
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
        style={styles.card}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        delayLongPress={400}
        testID="character-profile-card"
        accessibilityLabel={`Character profile: ${profile.name}`}
      >
        {/* Gradient card background */}
        <LinearGradient
          colors={[
            theme.colors.background.elevated,
            theme.colors.background.surface,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

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

          {/* Image count badge */}
          {imageCount > 1 && (
            <View
              style={[
                styles.imageBadge,
                { backgroundColor: 'rgba(0,0,0,0.58)' },
              ]}
            >
              <Icon name="image-multiple-outline" size={10} color="#fff" />
              <ThemedText
                size={10}
                weight="medium"
                style={styles.imageBadgeText}
              >
                {imageCount}
              </ThemedText>
            </View>
          )}

          {/* Gradient overlay at bottom of image */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.35)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.imageOverlay}
            pointerEvents="none"
          />
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

        {/* Left accent stripe */}
        {/* <LinearGradient
          colors={[
            theme.colors.accent.primary,
            theme.colors.accent.secondary ?? theme.colors.accent.primaryHover,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.accentStripe}
          pointerEvents="none"
        /> */}
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
  imageOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 40,
  },
  imageBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 3,
  },
  imageBadgeText: {
    color: '#fff',
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
  // accentStripe: {
  //   position: 'absolute',
  //   top: 0,
  //   left: 0,
  //   bottom: 0,
  //   width: 3,
  // },
});
