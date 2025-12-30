import { MD3DarkTheme as DefaultTheme } from 'react-native-paper';
import { colors } from './colors';

/**
 * React Native Paper theme configuration
 * Matches Harmony Link design
 */
export const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    surface: colors.surface,
    surfaceVariant: colors.gray[300],
    onSurface: colors.text.primary,
    onSurfaceVariant: colors.text.secondary,
    onSurfaceDisabled: colors.text.disabled,
    outline: colors.border,
    outlineVariant: colors.divider,
    error: colors.error,
    errorContainer: colors.error,
    onError: colors.text.primary,
    onErrorContainer: colors.text.primary,
  },
  dark: true,
};

export type AppTheme = typeof theme;
