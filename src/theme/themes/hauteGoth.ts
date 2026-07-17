import { Theme } from '../types';

/**
 * Haute Goth — Dark Academia Glassmorphism
 * Extracted from SoulBits Portal design system.
 * Deep goth blue-black backgrounds with neon magenta/indigo accents,
 * layered glass surfaces, and soft accent glows.
 */
export const hauteGoth: Theme = {
    id: 'haute-goth',
    name: 'Haute Goth',
    description: 'Dark academia glassmorphism — deep goth blue-black with neon magenta and indigo accents',
    version: '1.0.0',
    colors: {
        background: {
            base: '#0b0f19',      // Deep goth blue-black — page canvas
            surface: '#0f1525',    // Secondary surface — panels
            elevated: '#1a2236',   // Card backgrounds / elevated panels
            hover: '#282f42',      // Elevated panels / hover state
        },
        accent: {
            primary: '#8f3ba7',        // Neon magenta — primary CTA
            primaryHover: '#b04fce',   // Lighter magenta hover
            secondary: '#22318e',      // Deep indigo — secondary
            secondaryHover: '#3a2d99', // Brighter indigo hover
        },
        status: {
            success: '#4caf82',
            successBg: 'rgba(76, 175, 130, 0.12)',
            warning: '#f0a23b',
            warningBg: 'rgba(240, 162, 59, 0.12)',
            error: '#ef5350',
            errorBg: 'rgba(239, 83, 80, 0.12)',
            info: '#4d9bf0',
            infoBg: 'rgba(77, 155, 240, 0.12)',
        },
        text: {
            primary: '#e8e6f0',      // Warm lavender-white
            secondary: '#c8c3dc',    // Muted lavender
            muted: '#8c87a8',        // Dim purple-grey
            disabled: '#6b6780',     // Disabled purple-grey
        },
        border: {
            default: '#2a2147',      // Dark purple boundary
            focus: '#8f3ba7',        // Neon magenta focus
            hover: '#3a2159',        // Darker purple hover
            accent: '#8f3ba7',       // Neon magenta accent border
        },
        gradients: {
            primary: 'linear-gradient(135deg, #8f3ba7 0%, #22318e 50%, #2d2370 100%)',
            secondary: 'linear-gradient(135deg, #0b0f19 0%, #0f1525 100%)',
            surface: 'linear-gradient(135deg, rgba(143, 59, 167, 0.08) 0%, rgba(34, 49, 142, 0.08) 100%)',
        },
    },
};
