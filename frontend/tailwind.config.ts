import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
                mono: ['var(--font-jetbrains-mono)', 'monospace'],
                display: ['var(--font-space-grotesk)', 'sans-serif'],
            },
                        colors: {
                brand: {
                    purple: '#2563EB',
                    purpleLight: '#3B82F6',
                    cyan: '#38BDF8',
                    cyanLight: '#0284C7',
                    emerald: '#10B981',
                    emeraldLight: '#059669',
                    darkBg: '#0F172A',
                    lightBg: '#F1F5F9',
                },
                primary: {
                    50: '#EEF2FF',
                    100: '#E0E7FF',
                    200: '#C7D2FE',
                    300: '#A5B4FC',
                    400: '#818CF8',
                    500: '#6366F1',
                    600: '#4F46E5',
                    700: '#4338CA',
                    800: '#3730A3',
                    900: '#312E81',
                },
            },
        },
    },
    plugins: [],
};

export default config;