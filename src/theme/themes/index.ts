import { Theme } from '../types';
import { hauteGoth } from './hauteGoth';
import { midnightRose } from './midnightRose';
import { classicHarmony } from './classicHarmony';
import { oceanBreeze } from './oceanBreeze';
import { forestNight } from './forestNight';
import { sunsetGlow } from './sunsetGlow';
import { pureDark } from './pureDark';
import { soulBitsLight } from './soulBitsLight';

/**
 * SoulBits official themes — curated brand themes.
 * SoulBits Official Dark is the default.
 */
export const soulBitsThemes: Theme[] = [
    hauteGoth,       // DEFAULT — SoulBits Official Dark (Obsidian Glass Luminescence)
    soulBitsLight,   // SoulBits Official Light
];

/**
 * Other available themes for user switching.
 */
export const otherThemes: Theme[] = [
    midnightRose,
    classicHarmony,
    oceanBreeze,
    forestNight,
    sunsetGlow,
    pureDark,
];

/**
 * All default themes (flat array for theme context initialization).
 * SoulBits Official Dark is the default.
 */
export const defaultThemes: Theme[] = [
    ...soulBitsThemes,
    ...otherThemes,
];

/**
 * Default theme ID
 */
export const DEFAULT_THEME_ID = 'soulbits-official-dark';

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
    return hauteGoth;
}

export {
    hauteGoth,
    midnightRose,
    classicHarmony,
    oceanBreeze,
    forestNight,
    sunsetGlow,
    pureDark,
    soulBitsLight,
};
