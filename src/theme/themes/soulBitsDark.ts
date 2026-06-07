import { Theme } from '../types';

export const soulBitsDark: Theme = {
    id: 'soulbits-dark',
    name: 'SoulBits Dark',
    description: 'Deep cosmic dark theme with indigo and electric purple accents — Where Soul Meets Code',
    version: '1.0.0',
    colors: {
        background: {
            base: '#13191c',      // Near-black base (#13191c)
            surface: '#282f42',   // Dark blue-gray panels (#282f42)
            elevated: '#182e67',  // Navy blue elevated elements (#182e67)
            hover: '#22318e',     // Medium navy blue hover (#22318e)
        },
        accent: {
            primary: '#8f3ba7',       // Electric purple CTA (#8f3ba7)
            primaryHover: '#b04dce',  // Lighter purple hover
            secondary: '#2d2370',     // Deep indigo secondary (#2d2370)
            secondaryHover: '#3a2d99', // Brighter indigo hover
        },
        status: {
            success: '#10b981',
            successBg: 'rgba(16, 185, 129, 0.1)',
            warning: '#f59e0b',
            warningBg: 'rgba(245, 158, 11, 0.1)',
            error: '#ef4444',
            errorBg: 'rgba(239, 68, 68, 0.1)',
            info: '#6fc0f7',
            infoBg: 'rgba(111, 192, 247, 0.1)',
        },
        text: {
            primary: '#ffffff',
            secondary: '#dee0ef',  // Soft lavender secondary text
            muted: '#9ca3af',
            disabled: '#6b7280',
        },
        border: {
            default: '#282f42',    // Dark blue-gray default border (#282f42)
            focus: '#8f3ba7',      // Purple focus border (#8f3ba7)
            hover: '#22318e',      // Navy hover border (#22318e)
            accent: '#8f3ba7',     // Purple accent border (#8f3ba7)
        },
        gradients: {
            primary: 'linear-gradient(135deg, #8f3ba7 0%, #2d2370 100%)',
            secondary: 'linear-gradient(135deg, #13191c 0%, #282f42 100%)',
            surface: 'linear-gradient(135deg, rgba(143, 59, 167, 0.08) 0%, rgba(45, 35, 112, 0.08) 100%)',
        },
    },
};
