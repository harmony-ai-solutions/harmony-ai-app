import { Theme } from '../types';

export const classicHarmony: Theme = {
    id: 'classic-harmony',
    name: 'Classic Harmony',
    description: 'Familiar warm theme with Harmony orange accents',
    version: '1.0.0',
    colors: {
        background: {
            base: '#282828',
            surface: '#383838',
            elevated: '#484848',
            hover: '#585858',
        },
        accent: {
            primary: '#fb923c',
            primaryHover: '#fdba74',
            secondary: '#fbbf24',
            secondaryHover: '#fcd34d',
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
            primary: '#f5f5f5',
            secondary: '#d4d4d4',
            muted: '#a3a3a3',
            disabled: '#737373',
        },
        border: {
            default: '#484848',
            focus: '#fb923c',
            hover: '#585858',
            accent: '#fb923c',
        },
        gradients: {
            primary: 'linear-gradient(135deg, #fb923c 0%, #fbbf24 100%)',
            secondary: 'linear-gradient(135deg, #282828 0%, #383838 100%)',
            surface: 'linear-gradient(135deg, rgba(251, 146, 60, 0.05) 0%, rgba(251, 191, 36, 0.05) 100%)',
        },
    },
};
