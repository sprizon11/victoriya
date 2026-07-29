/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
    theme: {
        extend: {
            fontFamily: {
                outfit: ["Outfit", "system-ui", "sans-serif"],
                body: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
                mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
                xl: 'calc(var(--radius) + 4px)',
                '2xl': 'calc(var(--radius) + 10px)',
            },
            colors: {
                // Victoria brand, sampled from the logo artwork
                brand: {
                    DEFAULT: 'hsl(var(--brand))',
                    50: 'hsl(var(--brand-50))',
                    100: 'hsl(var(--brand-100))',
                    600: 'hsl(var(--brand-600))',
                    700: 'hsl(var(--brand-700))',
                },
                leaf: {
                    DEFAULT: 'hsl(var(--leaf))',
                    50: 'hsl(var(--leaf-50))',
                    100: 'hsl(var(--leaf-100))',
                },
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
                popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
                primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
                secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
                muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
                accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
                destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
                success: 'hsl(var(--success))',
                warning: 'hsl(var(--warning))',
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                chart: {
                    '1': 'hsl(var(--chart-1))', '2': 'hsl(var(--chart-2))',
                    '3': 'hsl(var(--chart-3))', '4': 'hsl(var(--chart-4))',
                    '5': 'hsl(var(--chart-5))',
                },
            },
            transitionTimingFunction: {
                'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
                'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            },
            keyframes: {
                'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
                'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
            },
            animation: {
                'accordion-down': 'accordion-down 0.2s ease-out',
                'accordion-up': 'accordion-up 0.2s ease-out',
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
};
