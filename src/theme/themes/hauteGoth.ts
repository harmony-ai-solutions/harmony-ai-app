import { Theme } from '../types';

/**
 * SoulBits Official Dark — Obsidian Glass Luminescence
 * Deep goth blue-black canvas with radiant neon magenta and indigo accents,
 * 50% opacity Obsidian Glass cards, vivid hairline gradient borders,
 * and ambient magenta glow shadows.
 */
export const hauteGoth: Theme = {
    id: 'soulbits-official-dark',
    name: 'SoulBits Official Dark',
    description: 'The official SoulBits dark theme — deep goth blue-black with neon magenta and indigo accents',
    version: '1.1.0',
    colors: {
        background: {
            base: '#0b0f19',      // Deep goth blue-black — page canvas
            surface: '#0f1525',    // Secondary surface — panels
            elevated: '#151d30',   // Card backgrounds / elevated panels — slightly lighter for glow contrast
            hover: '#1e2842',      // Elevated panels / hover state
        },
        accent: {
            primary: '#b84fd0',         // Radiant neon magenta — primary CTA
            primaryHover: '#cf6be5',    // Brighter magenta hover
            secondary: '#4a5fcf',       // Vivid indigo — secondary
            secondaryHover: '#6b7de8',  // Brighter indigo hover
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
            primary: '#f0edf6',      // Bright lavender-white
            secondary: '#d2cde3',    // Soft lavender
            muted: '#9692b0',        // Muted purple-grey
            disabled: '#6b6780',     // Disabled purple-grey
        },
        border: {
            default: '#2e2355',      // Dark purple boundary
            focus: '#b84fd0',        // Radiant magenta focus
            hover: '#3e2a6b',        // Darker purple hover
            accent: '#b84fd0',       // Radiant magenta accent border
        },
        gradients: {
            primary: 'linear-gradient(135deg, #b84fd0 0%, #4a5fcf 50%, #3a2d99 100%)',
            secondary: 'linear-gradient(135deg, #0b0f19 0%, #0f1525 100%)',
            surface: 'linear-gradient(135deg, rgba(184, 79, 208, 0.10) 0%, rgba(74, 95, 207, 0.10) 100%)',
        },
        glass: {
            /** Obsidian Glass: 48% opacity for rich, tangible glass presence */
            cardOpacity: 0.48,
            /** Ambient neon glow shadow opacity — 25% for dramatic radiant halo */
            glowOpacity: 0.25,
            /** Ambient glow shadow blur — 24dp wide radiant aura */
            glowRadius: 24,
            /** Thick polished edge — top-left specular hit: bright silver-white at 45% */
            borderGradientStart: 'rgba(255, 255, 255, 0.45)',
            /** Thick polished edge — fades to vivid neon magenta at 30% */
            borderGradientEnd: 'rgba(184, 79, 208, 0.30)',
        },
        typography: {
            headerOpacity: 1.0,
            subtextOpacity: 0.70,
            captionOpacity: 0.50,
        },
    },
};
