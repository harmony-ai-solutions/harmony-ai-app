import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedGradient } from './ThemedGradient';

interface ThemedButtonProps {
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
    style?: ViewStyle;
    disabled?: boolean;
}

/**
 * Themed button with SoulBits Portal glassmorphism styling.
 * Primary: gradient fill with glow shadow (matches Portal .btn-primary)
 * Secondary: glass backdrop with accent border (matches Portal .btn-secondary)
 * Outline: transparent with accent border
 * Ghost: transparent, no border
 */
export const ThemedButton: React.FC<ThemedButtonProps> = ({
    label,
    onPress,
    variant = 'primary',
    style,
    disabled = false,
}) => {
    const { theme } = useAppTheme();

    if (!theme) return null;

    // Glass border color: accent-tinted translucent
    const glassBorder = theme.colors.accent.primary + '1F'; // ~12% opacity
    const glowColor = theme.colors.accent.primary;

    if (variant === 'primary') {
        return (
            <TouchableOpacity
                onPress={onPress}
                disabled={disabled}
                activeOpacity={0.8}
                style={[styles.container, styles.primaryShadow, { shadowColor: glowColor }, style]}
            >
                <ThemedGradient gradient="primary" style={styles.gradient}>
                    <Text style={[styles.label, { color: '#ffffff', letterSpacing: 0.5 }]}>{label}</Text>
                </ThemedGradient>
            </TouchableOpacity>
        );
    }

    if (variant === 'secondary') {
        return (
            <TouchableOpacity
                onPress={onPress}
                disabled={disabled}
                activeOpacity={0.7}
                style={[
                    styles.container,
                    styles.glassButton,
                    {
                        borderColor: glassBorder,
                        shadowColor: glowColor,
                    },
                    style,
                ]}
            >
                <Text style={[styles.label, { color: theme.colors.text.primary, letterSpacing: 0.5 }]}>
                    {label}
                </Text>
            </TouchableOpacity>
        );
    }

    const getStyles = () => {
        switch (variant) {
            case 'outline':
                return {
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderColor: glassBorder,
                    labelColor: theme.colors.accent.primary,
                };
            case 'ghost':
                return {
                    backgroundColor: 'transparent',
                    labelColor: theme.colors.text.secondary,
                };
            default:
                return {
                    backgroundColor: theme.colors.accent.primary,
                    labelColor: '#ffffff',
                };
        }
    };

    const currentStyles = getStyles();

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={disabled}
            activeOpacity={0.7}
            style={[
                styles.container,
                {
                    backgroundColor: currentStyles.backgroundColor,
                    borderWidth: (currentStyles as any).borderWidth || 0,
                    borderColor: (currentStyles as any).borderColor || 'transparent',
                },
                style,
            ]}
        >
            <Text style={[styles.label, { color: currentStyles.labelColor }]}>
                {label}
            </Text>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    container: {
        borderRadius: 14,
        overflow: 'hidden',
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    primaryShadow: {
        // Glow shadow matching SoulBits .btn-primary hover state
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 6,
    },
    glassButton: {
        // Glass secondary button matching SoulBits .btn-secondary
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        // Subtle glow
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 3,
    },
    gradient: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    label: {
        fontSize: 15,
        fontWeight: '600',
    },
});
