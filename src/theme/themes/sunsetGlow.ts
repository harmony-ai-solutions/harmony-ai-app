import { Theme } from '../types';

export const sunsetGlow: Theme = {
    id: 'sunset-glow',
    name: 'Sunset Glow',
    description: 'Warm inviting theme with amber sunset accents',
    version: '1.0.0',
    colors: {
        background: {
            base: '#292524',
            surface: '#3f3f46',
            elevated: '#52525b',
            hover: '#71717a',
        },
        accent: {
            primary: '#f59e0b',
            primaryHover: '#fbbf24',
            secondary: '#f97316',
            secondaryHover: '#fb923c',
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
            primary: '#fafaf9',
            secondary: '#e7e5e4',
            muted: '#d6d3d1',
            disabled: '#a8a29e',
        },
        border: {
            default: '#52525b',
            focus: '#f59e0b',
            hover: '#71717a',
            accent: '#f59e0b',
        },
        gradients: {
            primary: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
            secondary: 'linear-gradient(135deg, #292524 0%, #3f3f46 100%)',
            surface: 'linear-gradient(135deg, rgba(245, 158, 11, 0.05) 0%, rgba(249, 115, 22, 0.05) 100%)',
        },
    },
};
