import { Theme } from '../types';
import { hauteGoth } from './hauteGoth';
import { midnightRose } from './midnightRose';
import { classicHarmony } from './classicHarmony';
import { oceanBreeze } from './oceanBreeze';
import { forestNight } from './forestNight';
import { sunsetGlow } from './sunsetGlow';
import { pureDark } from './pureDark';
import { soulBitsDark } from './soulBitsDark';
import { soulBitsLight } from './soulBitsLight';

/**
 * All default themes — Haute Goth is the default.
 * Other themes remain available for user switching.
 */
export const defaultThemes: Theme[] = [
    hauteGoth,         // NEW DEFAULT — Dark Academia Glassmorphism
    midnightRose,
    classicHarmony,
    oceanBreeze,
    forestNight,
    sunsetGlow,
    pureDark,
    soulBitsDark,
    soulBitsLight,
];

/**
 * Default theme ID
 */
export const DEFAULT_THEME_ID = 'haute-goth';

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
    soulBitsDark,
    soulBitsLight,
};
