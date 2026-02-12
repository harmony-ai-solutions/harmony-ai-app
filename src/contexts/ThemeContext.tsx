import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MD3DarkTheme } from 'react-native-paper';
import { Theme, ThemeContextType, ThemeMode, ThemeSyncStatus, PaperThemeColors } from '../theme/types';
import { defaultThemes, DEFAULT_THEME_ID, getThemeById, getDefaultTheme } from '../theme/themes';
import { createLogger } from '../utils/logger';

const log = createLogger('[ThemeContext]');

// Storage keys
const STORAGE_KEY_CURRENT_THEME = '@harmony_current_theme';
const STORAGE_KEY_THEME_MODE = '@harmony_theme_mode';
const STORAGE_KEY_CUSTOM_THEMES = '@harmony_custom_themes';

// Create context
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Theme Provider Component
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setTheme] = useState<Theme | null>(null);
    const [availableThemes, setAvailableThemes] = useState<Theme[]>(defaultThemes);
    const [themeMode, setThemeModeState] = useState<ThemeMode>(DEFAULT_THEME_ID);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [syncStatus, setSyncStatus] = useState<ThemeSyncStatus>({
        pendingChanges: false,
        syncEnabled: false,
    });

    /**
     * Load custom themes from AsyncStorage
     */
    const loadCustomThemes = useCallback(async (): Promise<Theme[]> => {
        try {
            const customThemesJson = await AsyncStorage.getItem(STORAGE_KEY_CUSTOM_THEMES);
            if (customThemesJson) {
                const customThemes: Theme[] = JSON.parse(customThemesJson);
                return customThemes.map(t => ({ ...t, isCustom: true }));
            }
        } catch (err) {
            log.error('Failed to load custom themes:', err);
        }
        return [];
    }, []);

    /**
     * Save custom themes to AsyncStorage
     */
    const saveCustomThemes = useCallback(async (themes: Theme[]) => {
        try {
            const customThemes = themes.filter(t => t.isCustom);
            await AsyncStorage.setItem(STORAGE_KEY_CUSTOM_THEMES, JSON.stringify(customThemes));
        } catch (err) {
            log.error('Failed to save custom themes:', err);
            throw err;
        }
    }, []);

    /**
     * Get system color scheme
     */
    const getSystemColorScheme = (): ColorSchemeName => {
        return Appearance.getColorScheme() || 'light';
    };

    /**
     * Load theme based on mode
     */
    const loadTheme = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            // Load theme mode preference
            const savedMode = await AsyncStorage.getItem(STORAGE_KEY_THEME_MODE);
            const mode: ThemeMode = savedMode || DEFAULT_THEME_ID;
            setThemeModeState(mode);

            // Load custom themes
            const customThemes = await loadCustomThemes();
            const allThemes = [...defaultThemes, ...customThemes];
            setAvailableThemes(allThemes);

            // Determine which theme to use
            let selectedTheme: Theme;

            if (mode === 'system') {
                // Follow system appearance
                const systemScheme = getSystemColorScheme();
                // For now, just use default theme (can be enhanced to detect light/dark)
                selectedTheme = getDefaultTheme();
            } else {
                // Use specific theme
                selectedTheme = allThemes.find(t => t.id === mode) || getDefaultTheme();
            }

            setTheme(selectedTheme);

            // Cache theme for instant load on next startup
            await AsyncStorage.setItem(STORAGE_KEY_CURRENT_THEME, JSON.stringify(selectedTheme));

        } catch (err) {
            log.error('Failed to load theme:', err);
            setError(err as Error);

            // Fallback to default theme
            setTheme(getDefaultTheme());
        } finally {
            setLoading(false);
        }
    }, [loadCustomThemes]);

    /**
     * Switch to a specific theme
     */
    const switchTheme = useCallback(async (themeId: string) => {
        try {
            const selectedTheme = availableThemes.find(t => t.id === themeId);
            if (!selectedTheme) {
                throw new Error(`Theme not found: ${themeId}`);
            }

            setTheme(selectedTheme);
            setThemeModeState(themeId);

            await AsyncStorage.setItem(STORAGE_KEY_THEME_MODE, themeId);
            await AsyncStorage.setItem(STORAGE_KEY_CURRENT_THEME, JSON.stringify(selectedTheme));

        } catch (err) {
            log.error('Failed to switch theme:', err);
            setError(err as Error);
            throw err;
        }
    }, [availableThemes]);

    /**
     * Set theme mode (system or specific theme)
     */
    const setThemeMode = useCallback(async (mode: ThemeMode) => {
        try {
            setThemeModeState(mode);
            await AsyncStorage.setItem(STORAGE_KEY_THEME_MODE, mode);

            // Reload theme with new mode
            await loadTheme();
        } catch (err) {
            log.error('Failed to set theme mode:', err);
            setError(err as Error);
            throw err;
        }
    }, [loadTheme]);

    /**
     * Create a custom theme
     */
    const createCustomTheme = useCallback(async (newTheme: Theme) => {
        try {
            const customTheme: Theme = {
                ...newTheme,
                isCustom: true,
                lastModified: new Date().toISOString(),
            };

            const updatedThemes = [...availableThemes, customTheme];
            setAvailableThemes(updatedThemes);

            await saveCustomThemes(updatedThemes);

            setSyncStatus(prev => ({ ...prev, pendingChanges: true }));
        } catch (err) {
            log.error('Failed to create custom theme:', err);
            setError(err as Error);
            throw err;
        }
    }, [availableThemes, saveCustomThemes]);

    /**
     * Update a custom theme
     */
    const updateCustomTheme = useCallback(async (themeId: string, updatedTheme: Theme) => {
        try {
            const themeIndex = availableThemes.findIndex(t => t.id === themeId);
            if (themeIndex === -1) {
                throw new Error(`Theme not found: ${themeId}`);
            }

            const existingTheme = availableThemes[themeIndex];
            if (!existingTheme.isCustom) {
                throw new Error('Cannot update built-in theme');
            }

            const updated: Theme = {
                ...updatedTheme,
                isCustom: true,
                lastModified: new Date().toISOString(),
            };

            const updatedThemes = [...availableThemes];
            updatedThemes[themeIndex] = updated;

            setAvailableThemes(updatedThemes);
            await saveCustomThemes(updatedThemes);

            // If this was the active theme, update it
            if (theme?.id === themeId) {
                setTheme(updated);
            }

            setSyncStatus(prev => ({ ...prev, pendingChanges: true }));
        } catch (err) {
            log.error('Failed to update custom theme:', err);
            setError(err as Error);
            throw err;
        }
    }, [availableThemes, theme, saveCustomThemes]);

    /**
     * Delete a custom theme
     */
    const deleteCustomTheme = useCallback(async (themeId: string) => {
        try {
            const themeToDelete = availableThemes.find(t => t.id === themeId);
            if (!themeToDelete) {
                throw new Error(`Theme not found: ${themeId}`);
            }
            if (!themeToDelete.isCustom) {
                throw new Error('Cannot delete built-in theme');
            }

            const updatedThemes = availableThemes.filter(t => t.id !== themeId);
            setAvailableThemes(updatedThemes);

            await saveCustomThemes(updatedThemes);

            // If this was the active theme, switch to default
            if (theme?.id === themeId) {
                await switchTheme(DEFAULT_THEME_ID);
            }
        } catch (err) {
            log.error('Failed to delete custom theme:', err);
            setError(err as Error);
            throw err;
        }
    }, [availableThemes, theme, saveCustomThemes, switchTheme]);

    /**
     * Import theme from JSON string
     */
    const importTheme = useCallback(async (themeJson: string) => {
        try {
            const importedTheme: Theme = JSON.parse(themeJson);

            // Validate theme structure
            if (!importedTheme.id || !importedTheme.name || !importedTheme.colors) {
                throw new Error('Invalid theme format');
            }

            // Check for ID collision
            const existingTheme = availableThemes.find(t => t.id === importedTheme.id);
            if (existingTheme) {
                // Generate new ID
                importedTheme.id = `${importedTheme.id}-imported-${Date.now()}`;
                importedTheme.name = `${importedTheme.name} (Imported)`;
            }

            await createCustomTheme(importedTheme);
        } catch (err) {
            log.error('Failed to import theme:', err);
            setError(err as Error);
            throw err;
        }
    }, [availableThemes, createCustomTheme]);

    /**
     * Export theme as JSON string
     */
    const exportTheme = useCallback(async (themeId: string): Promise<string> => {
        try {
            const themeToExport = availableThemes.find(t => t.id === themeId);
            if (!themeToExport) {
                throw new Error(`Theme not found: ${themeId}`);
            }

            return JSON.stringify(themeToExport, null, 2);
        } catch (err) {
            log.error('Failed to export theme:', err);
            setError(err as Error);
            throw err;
        }
    }, [availableThemes]);

    /**
     * Sync themes with Harmony Link backend
     * TODO: Implement when Harmony Link API client is ready
     */
    const syncWithHarmonyLink = useCallback(async () => {
        try {
            // This will be implemented in Phase 3
            log.info('Theme sync with Harmony Link - not yet implemented');

            setSyncStatus(prev => ({
                ...prev,
                lastSync: new Date().toISOString(),
                pendingChanges: false,
            }));
        } catch (err) {
            log.error('Failed to sync with Harmony Link:', err);
            setError(err as Error);
            throw err;
        }
    }, []);

    /**
     * Refresh themes (reload from storage and backend)
     */
    const refreshThemes = useCallback(async () => {
        await loadTheme();
    }, [loadTheme]);

    /**
     * Initial load on mount
     */
    useEffect(() => {
        loadTheme();
    }, [loadTheme]);

    /**
     * Listen for system appearance changes
     */
    useEffect(() => {
        if (themeMode !== 'system') return;

        const subscription = Appearance.addChangeListener(() => {
            loadTheme();
        });

        return () => subscription.remove();
    }, [themeMode, loadTheme]);

    // Context value
    const value: ThemeContextType = {
        theme,
        availableThemes,
        themeMode,
        loading,
        error,
        syncStatus,
        switchTheme,
        setThemeMode,
        createCustomTheme,
        updateCustomTheme,
        deleteCustomTheme,
        importTheme,
        exportTheme,
        syncWithHarmonyLink,
        refreshThemes,
    };

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
};

/**
 * Hook to use theme context
 */
export const useAppTheme = (): ThemeContextType => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useAppTheme must be used within ThemeProvider');
    }
    return context;
};

/**
 * Hook to get React Native Paper theme
 */
export const usePaperTheme = () => {
    const { theme } = useAppTheme();

    if (!theme) {
        return MD3DarkTheme;
    }

    // Transform to Paper theme
    return {
        ...MD3DarkTheme,
        colors: {
            ...MD3DarkTheme.colors,
            primary: theme.colors.accent.primary,
            onPrimary: '#ffffff',
            primaryContainer: theme.colors.accent.primary + '30',
            onPrimaryContainer: theme.colors.text.primary,

            secondary: theme.colors.accent.secondary,
            onSecondary: '#ffffff',
            secondaryContainer: theme.colors.accent.secondary + '30',
            onSecondaryContainer: theme.colors.text.primary,

            background: theme.colors.background.base,
            onBackground: theme.colors.text.primary,

            surface: theme.colors.background.surface,
            onSurface: theme.colors.text.primary,
            surfaceVariant: theme.colors.background.elevated,
            onSurfaceVariant: theme.colors.text.secondary,

            error: theme.colors.status.error,
            onError: '#ffffff',
            errorContainer: theme.colors.status.errorBg,
            onErrorContainer: theme.colors.status.error,

            outline: theme.colors.border.default,
            outlineVariant: theme.colors.border.hover,

            surfaceDisabled: theme.colors.background.elevated + '60',
            onSurfaceDisabled: theme.colors.text.disabled,

            backdrop: 'rgba(0, 0, 0, 0.5)',
        },
    };
};
