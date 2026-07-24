import React from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedGradient } from './ThemedGradient';
import { hapticLightPress } from '../../utils/haptics';

interface ThemedFabProps {
    icon: string;
    onPress: () => void;
    style?: ViewStyle;
    iconSize?: number;
    iconColor?: string;
    disabled?: boolean;
}

/**
 * Themed Floating Action Button — matches the primary button gradient-fill style.
 * 56x56 circle with brand gradient fill, glow shadow, and white icon.
 */
export const ThemedFab: React.FC<ThemedFabProps> = ({
    icon,
    onPress,
    style,
    iconSize = 24,
    iconColor = '#ffffff',
    disabled = false,
}) => {
    const { theme } = useAppTheme();

    if (!theme) return null;

    return (
        <TouchableOpacity
            onPress={() => {
                if (!disabled) {
                    hapticLightPress();
                }
                onPress();
            }}
            disabled={disabled}
            activeOpacity={0.8}
            style={[
                styles.container,
                styles.glowShadow,
                { shadowColor: theme.colors.accent.primary },
                style,
            ]}
        >
            <ThemedGradient gradient="primary" style={styles.gradientFill}>
                <Icon
                    name={icon}
                    size={iconSize}
                    color={iconColor}
                />
            </ThemedGradient>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    container: {
        width: 56,
        height: 56,
        borderRadius: 28,
        position: 'absolute',
        bottom: 24,
        right: 24,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
    },
    gradientFill: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 28,
    },
    glowShadow: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 6,
    },
});
