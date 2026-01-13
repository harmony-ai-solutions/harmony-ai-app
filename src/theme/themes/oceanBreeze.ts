import { Theme } from '../types';

export const oceanBreeze: Theme = {
    id: 'ocean-breeze',
    name: 'Ocean Breeze',
    description: 'Cool professional theme with cyan accents',
    version: '1.0.0',
    colors: {
        background: {
            base: '#0c4a6e',
            surface: '#075985',
            elevated: '#0369a1',
            hover: '#0284c7',
        },
        accent: {
            primary: '#06b6d4',
            primaryHover: '#22d3ee',
            secondary: '#0ea5e9',
            secondaryHover: '#38bdf8',
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
            primary: '#f0f9ff',
            secondary: '#e0f2fe',
            muted: '#bae6fd',
            disabled: '#7dd3fc',
        },
        border: {
            default: '#0369a1',
            focus: '#06b6d4',
            hover: '#0284c7',
            accent: '#06b6d4',
        },
        gradients: {
            primary: 'linear-gradient(135deg, #06b6d4 0%, #0ea5e9 100%)',
            secondary: 'linear-gradient(135deg, #0c4a6e 0%, #075985 100%)',
            surface: 'linear-gradient(135deg, rgba(6, 182, 212, 0.05) 0%, rgba(14, 165, 233, 0.05) 100%)',
        },
    },
};
