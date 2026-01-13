import { Theme } from '../types';

export const midnightRose: Theme = {
    id: 'midnight-rose',
    name: 'Midnight Rose',
    description: 'Modern dark theme with blue tones and vibrant pink accents',
    version: '1.0.0',
    colors: {
        background: {
            base: '#0f172a',      // Deep blue-black
            surface: '#1e293b',   // Slate surface
            elevated: '#334155',  // Elevated slate
            hover: '#475569',     // Lighter slate for hover
        },
        accent: {
            primary: '#ec4899',          // Vibrant pink
            primaryHover: '#f472b6',     // Lighter pink
            secondary: '#a78bfa',        // Soft purple
            secondaryHover: '#c4b5fd',   // Lighter purple
        },
        status: {
            success: '#10b981',
            successBg: 'rgba(16, 185, 129, 0.1)',
            warning: '#f59e0b',
            warningBg: 'rgba(245, 158, 11, 0.1)',
            error: '#ef4444',
            errorBg: 'rgba(239, 68, 68, 0.1)',
            info: '#3b82f6',
            infoBg: 'rgba(59, 130, 246, 0.1)',
        },
        text: {
            primary: '#f1f5f9',      // Near white
            secondary: '#cbd5e1',    // Light slate
            muted: '#94a3b8',        // Muted slate
            disabled: '#64748b',     // Disabled slate
        },
        border: {
            default: '#334155',
            focus: '#ec4899',        // Pink for focus
            hover: '#475569',
            accent: '#ec4899',
        },
        gradients: {
            primary: 'linear-gradient(135deg, #ec4899 0%, #a78bfa 100%)',
            secondary: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            surface: 'linear-gradient(135deg, rgba(236, 72, 153, 0.05) 0%, rgba(167, 139, 250, 0.05) 100%)',
        },
    },
};
