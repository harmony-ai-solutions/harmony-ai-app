import React from 'react';
import { ViewProps, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';
import { createLogger } from '../../utils/logger';

const log = createLogger('[ThemedGradient]');

interface ThemedGradientProps extends ViewProps {
    /** Which gradient from theme to use */
    gradient: 'primary' | 'secondary' | 'surface';
    /** Fallback to solid color if gradient parsing fails */
    fallbackColor?: string;
    /** Children to render inside gradient */
    children?: React.ReactNode;
}

/**
 * Themed gradient component
 * Wraps react-native-linear-gradient and uses theme gradients
 */
export const ThemedGradient: React.FC<ThemedGradientProps> = ({
    gradient,
    fallbackColor,
    children,
    style,
    ...props
}) => {
    const { theme } = useAppTheme();

    if (!theme) {
        // Loading state - use fallback
        return (
            <View style={[{ backgroundColor: fallbackColor || '#000' }, style]} {...props}>
                {children}
            </View>
        );
    }

    // Get gradient string from theme
    const gradientString = theme.colors.gradients[gradient];

    // Parse CSS gradient to React Native format
    const parsed = parseGradient(gradientString);

    if (!parsed) {
        // Failed to parse - use fallback
        const fallback = fallbackColor || theme.colors.accent.primary;
        return (
            <View style={[{ backgroundColor: fallback }, style]} {...props}>
                {children}
            </View>
        );
    }

    return (
        <LinearGradient
            colors={parsed.colors}
            start={{ x: parsed.start.x, y: parsed.start.y }}
            end={{ x: parsed.end.x, y: parsed.end.y }}
            style={style}
            {...props}
        >
            {children}
        </LinearGradient>
    );
};

/**
 * Parse CSS linear-gradient to React Native format
 * 
 * Example input: "linear-gradient(135deg, #ec4899 0%, #a78bfa 100%)"
 * Output: { colors: ['#ec4899', '#a78bfa'], start: {x:0, y:0}, end: {x:1, y:1} }
 */
function parseGradient(gradientString: string): {
    colors: string[];
    start: { x: number; y: number };
    end: { x: number; y: number };
} | null {
    try {
        // Extract angle and colors
        const match = gradientString.match(/linear-gradient\(([^,]+),(.+)\)/);
        if (!match) return null;

        const angleStr = match[1].trim();
        const colorsStr = match[2];

        // Parse angle (e.g., "135deg")
        const angle = parseInt(angleStr.replace('deg', ''), 10);

        // Parse colors (e.g., "#ec4899 0%, #a78bfa 100%")
        const colorMatches = colorsStr.matchAll(/(#[0-9a-fA-F]{6}|rgba?\([^)]+\))/g);
        const colors = Array.from(colorMatches).map(m => m[0]);

        if (colors.length < 2) return null;

        // Convert angle to start/end coordinates
        const coords = angleToCoords(angle);

        return {
            colors,
            start: coords.start,
            end: coords.end,
        };
    } catch (err) {
        log.error('Failed to parse gradient:', err);
        return null;
    }
}

/**
 * Convert CSS angle to React Native Linear Gradient coordinates
 */
function angleToCoords(angle: number): {
    start: { x: number; y: number };
    end: { x: number; y: number };
} {
    // Normalize angle to 0-360
    const normalized = ((angle % 360) + 360) % 360;

    // Convert to radians
    const radians = (normalized * Math.PI) / 180;

    // Calculate end point on unit circle
    const endX = Math.cos(radians);
    const endY = Math.sin(radians);

    // Map to 0-1 range for React Native
    return {
        start: { x: 0.5 - endX / 2, y: 0.5 - endY / 2 },
        end: { x: 0.5 + endX / 2, y: 0.5 + endY / 2 },
    };
}

/**
 * Helper: Commonly used gradient buttons
 */
export const GradientButton: React.FC<{
    children: React.ReactNode;
    onPress: () => void;
    style?: ViewProps['style'];
}> = ({ children, onPress, style }) => {
    return (
        <ThemedGradient
            gradient="primary"
            style={[
                {
                    borderRadius: 8,
                    paddingVertical: 12,
                    paddingHorizontal: 24,
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                style,
            ]}
        >
            {children}
        </ThemedGradient>
    );
};
