import { Theme } from '../types';
import { midnightRose } from './midnightRose';
import { classicHarmony } from './classicHarmony';
import { oceanBreeze } from './oceanBreeze';
import { forestNight } from './forestNight';
import { sunsetGlow } from './sunsetGlow';
import { pureDark } from './pureDark';

/**
 * All default themes
 */
export const defaultThemes: Theme[] = [
    midnightRose,      // Default theme
    classicHarmony,
    oceanBreeze,
    forestNight,
    sunsetGlow,
    pureDark,
];

/**
 * Default theme ID
 */
export const DEFAULT_THEME_ID = 'midnight-rose';

/**
 * Get theme by ID
 */
export function getThemeById(themeId: string): Theme | undefined {
    return defaultThemes.find(theme => theme.id === themeId);
}

/**
 * Get default theme
 */
export function getDefaultTheme(): Theme {
    return midnightRose;
}

export {
    midnightRose,
    classicHarmony,
    oceanBreeze,
    forestNight,
    sunsetGlow,
    pureDark,
};
