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

export const ThemedButton: React.FC<ThemedButtonProps> = ({
    label,
    onPress,
    variant = 'primary',
    style,
    disabled = false,
}) => {
    const { theme } = useAppTheme();

    if (!theme) return null;

    if (variant === 'primary') {
        return (
            <TouchableOpacity
                onPress={onPress}
                disabled={disabled}
                activeOpacity={0.8}
                style={[styles.container, style]}
            >
                <ThemedGradient gradient="primary" style={styles.gradient}>
                    <Text style={[styles.label, { color: '#ffffff' }]}>{label}</Text>
                </ThemedGradient>
            </TouchableOpacity>
        );
    }

    const getStyles = () => {
        switch (variant) {
            case 'secondary':
                return {
                    backgroundColor: theme.colors.background.elevated,
                    labelColor: theme.colors.text.primary,
                };
            case 'outline':
                return {
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderColor: theme.colors.accent.primary,
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
        borderRadius: 8,
        overflow: 'hidden',
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    gradient: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
    },
});
