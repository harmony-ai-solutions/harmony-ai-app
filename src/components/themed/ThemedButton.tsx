import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet, ViewStyle, Platform } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedGradient } from './ThemedGradient';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';

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
    /** Optional testID forwarded to the underlying TouchableOpacity.
     *  Used by Maestro E2E flows to tap buttons by stable ID. */
    testID?: string;
    /** Optional accessibilityLabel forwarded for screen readers + Maestro. */
    accessibilityLabel?: string;
}

/**
 * Themed button — global standard matching "Create First Profile" design.
 *
 * Primary:    radiant gradient fill + ambient magenta glow shadow. Full-width, 16dp radius.
 * Secondary:  Obsidian Glass with 1dp hairline gradient border.
 * Outline:    transparent with 1dp gradient border.
 * Ghost:      transparent, no border, subdued text.
 *
 * NO wrapped boxes, NO dark frames. Buttons sit freely on the page background.
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
    testID,
    accessibilityLabel,
}) => {
    const { theme } = useAppTheme();

    if (!theme) return null;

    const { borderGradientStart, borderGradientEnd } = theme.colors.glass;
    const glowColor = theme.colors.accent.primary;
    const BUTTON_RADIUS = 16;

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

    // ── Primary: radiant gradient fill + ambient magenta glow ─────────────
    if (variant === 'primary') {
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
                testID={testID}
                accessibilityLabel={accessibilityLabel ?? label}
                accessibilityRole="button"
                style={[
                    styles.container,
                    styles.glowShadow,
                    { shadowColor: glowColor, borderRadius: BUTTON_RADIUS },
                    style,
                ]}
            >
                <ThemedGradient gradient="primary" style={[styles.gradientFill, { borderRadius: BUTTON_RADIUS }]}>
                    {renderContent('#ffffff')}
                </ThemedGradient>
            </TouchableOpacity>
        );
    }

    // ── Secondary: Obsidian Glass with 1dp gradient border ────────────────
    if (variant === 'secondary') {
        return (
            <TouchableOpacity
                onPress={onPress}
                disabled={disabled}
                activeOpacity={0.7}
                testID={testID}
                accessibilityLabel={accessibilityLabel ?? label}
                accessibilityRole="button"
                style={[styles.container, { borderRadius: BUTTON_RADIUS }, style]}
            >
                <LinearGradient
                    colors={[borderGradientStart, borderGradientEnd]}
                    start={{ x: 0.15, y: 0 }}
                    end={{ x: 0.85, y: 1 }}
                    style={[styles.borderOuter, { borderRadius: BUTTON_RADIUS }]}
                >
                    <LinearGradient
                        colors={[
                            hexToRgba(theme.colors.background.elevated, theme.colors.glass.cardOpacity),
                            hexToRgba(theme.colors.background.surface, theme.colors.glass.cardOpacity * 0.60),
                        ]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[styles.glassInnerBtn, { borderRadius: BUTTON_RADIUS - 1 }]}
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
                testID={testID}
                accessibilityLabel={accessibilityLabel ?? label}
                accessibilityRole="button"
                style={[styles.container, { borderRadius: BUTTON_RADIUS }, style]}
            >
                <LinearGradient
                    colors={[borderGradientStart, borderGradientEnd]}
                    start={{ x: 0.15, y: 0 }}
                    end={{ x: 0.85, y: 1 }}
                    style={[styles.borderOuter, { borderRadius: BUTTON_RADIUS }]}
                >
                    <LinearGradient
                        colors={[
                            hexToRgba(theme.colors.background.surface, 0.15),
                            hexToRgba(theme.colors.background.surface, 0.08),
                        ]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[styles.glassInnerBtn, { borderRadius: BUTTON_RADIUS - 1 }]}
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
            testID={testID}
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityRole="button"
            style={[
                styles.container,
                { backgroundColor: 'transparent', borderRadius: BUTTON_RADIUS },
                style,
            ]}
        >
            {renderContent(theme.colors.text.secondary)}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    container: {
        height: 52,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        // Stretch full-width by default — screen style overrides can constrain if needed
        alignSelf: 'stretch',
    },
    borderOuter: {
        padding: StyleSheet.hairlineWidth,
        width: '100%',
        height: '100%',
    },
    glassInnerBtn: {
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
    },
    contentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    glowShadow: {
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 22,
        elevation: 10,
    },
    icon: {},
    label: {
        fontSize: 16,
        fontWeight: '600',
    },
});
