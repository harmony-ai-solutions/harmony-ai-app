import { Theme } from '../types';

export const soulBitsLight: Theme = {
    id: 'soulbits-light',
    name: 'SoulBits Light',
    description: 'Airy light theme with periwinkle lavender and electric blue accents — Where Soul Meets Code',
    version: '1.0.0',
    colors: {
        background: {
            base: '#dee0ef',      // Soft lavender-white base (#dee0ef)
            surface: '#f0f2ff',   // Near-white surface panels
            elevated: '#ffffff',  // Pure white elevated elements
            hover: '#aaa0e8',     // Muted violet hover (#aaa0e8)
        },
        accent: {
            primary: '#558af2',       // Sky blue primary CTA (#558af2)
            primaryHover: '#6fc0f7',  // Bright light blue hover (#6fc0f7)
            secondary: '#796ce4',     // Medium purple secondary (#796ce4)
            secondaryHover: '#5c5be7', // Stronger blue-purple hover (#5c5be7)
        },
        status: {
            success: '#10b981',
            successBg: 'rgba(16, 185, 129, 0.12)',
            warning: '#f59e0b',
            warningBg: 'rgba(245, 158, 11, 0.12)',
            error: '#ef4444',
            errorBg: 'rgba(239, 68, 68, 0.12)',
            info: '#558af2',
            infoBg: 'rgba(85, 138, 242, 0.12)',
        },
        text: {
            primary: '#1a1a2e',    // Deep dark indigo for primary text
            secondary: '#2d2370',  // Dark indigo for secondary text
            muted: '#5c5be7',      // Medium blue-purple muted text (#5c5be7)
            disabled: '#aaa0e8',   // Soft violet disabled text (#aaa0e8)
        },
        border: {
            default: '#aaa0e8',    // Muted violet default border (#aaa0e8)
            focus: '#558af2',      // Blue focus border (#558af2)
            hover: '#796ce4',      // Medium purple hover border (#796ce4)
            accent: '#5c5be7',     // Strong blue-purple accent border (#5c5be7)
        },
        gradients: {
            primary: 'linear-gradient(135deg, #558af2 0%, #796ce4 100%)',
            secondary: 'linear-gradient(135deg, #dee0ef 0%, #f0f2ff 100%)',
            surface: 'linear-gradient(135deg, rgba(85, 138, 242, 0.07) 0%, rgba(121, 108, 228, 0.07) 100%)',
        },
        glass: {
            cardOpacity: 0.85,
            glowOpacity: 0.16,
            glowRadius: 16,
            borderGradientStart: 'rgba(255, 255, 255, 0.40)',
            borderGradientEnd: 'rgba(85, 138, 242, 0.22)',
        },
        typography: {
            headerOpacity: 1.0,
            subtextOpacity: 0.70,
            captionOpacity: 0.50,
        },
    },
};
