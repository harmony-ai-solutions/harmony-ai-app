import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedGradient } from './ThemedGradient';
import { hexToRgba } from '../../utils/colorUtils';

interface ThemedButtonProps {
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
    /** MaterialCommunityIcons name to show before the label */
    icon?: string;
    iconSize?: number;
    iconColor?: string;
    style?: ViewStyle;
    disabled?: boolean;
}

/**
 * Themed button.
 *
 * Primary:    gradient fill + glow shadow (brand CTA). Stretches full-width by default.
 * Secondary:  glass backdrop with 1dp hairline gradient border.
 * Outline:    transparent with 1dp gradient border.
 * Ghost:      transparent, no border, subdued text.
 */
export const ThemedButton: React.FC<ThemedButtonProps> = ({
    label,
    onPress,
    variant = 'primary',
    icon,
    iconSize = 18,
    iconColor,
    style,
    disabled = false,
}) => {
    const { theme } = useAppTheme();

    if (!theme) return null;

    const { borderGradientStart, borderGradientEnd } = theme.colors.glass;
    const glowColor = theme.colors.accent.primary;

    const renderContent = (textColor: string, textLetterSpacing: number = 0.5) => (
        <View style={styles.contentRow}>
            {icon && (
                <Icon
                    name={icon}
                    size={iconSize}
                    color={iconColor ?? textColor}
                    style={styles.icon}
                />
            )}
            <Text style={[styles.label, { color: textColor, letterSpacing: textLetterSpacing }]}>
                {label}
            </Text>
        </View>
    );

    // ── Primary: gradient fill + glow shadow ─────────────────────────────────
    if (variant === 'primary') {
        return (
            <TouchableOpacity
                onPress={onPress}
                disabled={disabled}
                activeOpacity={0.8}
                style={[styles.container, styles.glowShadow, { shadowColor: glowColor }, style]}
            >
                <ThemedGradient gradient="primary" style={styles.gradientFill}>
                    {renderContent('#ffffff')}
                </ThemedGradient>
            </TouchableOpacity>
        );
    }

    // ── Secondary: glass with 1dp gradient border ────────────────────────────
    if (variant === 'secondary') {
        return (
            <TouchableOpacity
                onPress={onPress}
                disabled={disabled}
                activeOpacity={0.7}
                style={[styles.container, style]}
            >
                <LinearGradient
                    colors={[borderGradientStart, borderGradientEnd]}
                    start={{ x: 0.2, y: 0 }}
                    end={{ x: 0.85, y: 1 }}
                    style={styles.borderOuter}
                >
                    <LinearGradient
                        colors={[
                            hexToRgba(theme.colors.background.elevated, theme.colors.glass.cardOpacity),
                            hexToRgba(theme.colors.background.surface, theme.colors.glass.cardOpacity * 0.55),
                        ]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.glassInnerBtn}
                    >
                        {renderContent(theme.colors.text.primary)}
                    </LinearGradient>
                </LinearGradient>
            </TouchableOpacity>
        );
    }

    // ── Outline: transparent with 1dp gradient border ────────────────────────
    if (variant === 'outline') {
        return (
            <TouchableOpacity
                onPress={onPress}
                disabled={disabled}
                activeOpacity={0.7}
                style={[styles.container, style]}
            >
                <LinearGradient
                    colors={[borderGradientStart, borderGradientEnd]}
                    start={{ x: 0.2, y: 0 }}
                    end={{ x: 0.85, y: 1 }}
                    style={styles.borderOuter}
                >
                    <LinearGradient
                        colors={[
                            hexToRgba(theme.colors.background.surface, 0.15),
                            hexToRgba(theme.colors.background.surface, 0.08),
                        ]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.glassInnerBtn}
                    >
                        {renderContent(theme.colors.accent.primary)}
                    </LinearGradient>
                </LinearGradient>
            </TouchableOpacity>
        );
    }

    // ── Ghost: no border, subtle text ────────────────────────────────────────
    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={disabled}
            activeOpacity={0.7}
            style={[
                styles.container,
                { backgroundColor: 'transparent' },
                style,
            ]}
        >
            {renderContent(theme.colors.text.secondary)}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    container: {
        borderRadius: 14,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        // Stretch full-width by default — screen style overrides can constrain if needed
        alignSelf: 'stretch',
    },
    borderOuter: {
        borderRadius: 14,
        padding: StyleSheet.hairlineWidth,
        width: '100%',
        height: '100%',
    },
    glassInnerBtn: {
        borderRadius: 13,
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    gradientFill: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
        borderRadius: 14,
    },
    contentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    glowShadow: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 6,
    },
    icon: {},
    label: {
        fontSize: 15,
        fontWeight: '600',
    },
});
