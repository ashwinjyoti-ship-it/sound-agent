import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'eddy-beige': '#D4C4B9',
        'eddy-orange': '#E8944A',
        'eddy-grey': '#C9C7C1',
        'eddy-dark': '#1a1a1a',
        'eddy-cream': '#F5EDE0',
        'eddy-blue': '#7A8FA3',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
      },
      fontFamily: {
        lora: ['Lora', 'serif'],
      },
      animation: {
        'slide-up': 'slideUp 0.25s ease-out forwards',
        'think-swirl': 'thinkSwirl 3s ease-in-out infinite',
      },
      keyframes: {
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        thinkSwirl: {
          '0%, 100%': { transform: 'rotate(-5deg) translateY(0px)' },
          '25%': { transform: 'rotate(5deg) translateY(-4px)' },
          '50%': { transform: 'rotate(-3deg) translateY(-2px)' },
          '75%': { transform: 'rotate(4deg) translateY(-5px)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
