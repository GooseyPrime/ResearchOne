/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark theme palette
        surface: {
          50: '#f8fafc',
          100: '#1a2433',
          200: '#141b26',
          300: '#101218',
          400: '#0d1117',
          500: '#090c11',
        },
        accent: {
          DEFAULT: '#7a8ea8',
          light: '#9fb0c6',
          dark: '#65778f',
        },
        research: {
          gold: '#9fb0c6',
          teal: '#7a8ea8',
          red: '#8b99ae',
          green: '#93a7c4',
          purple: '#8fa2bf',
          blue: '#a3b4ca',
        },
        tier: {
          established_fact: '#93a7c4',
          strong_evidence: '#a3b4ca',
          testimony: '#9fb0c6',
          inference: '#8fa2bf',
          speculation: '#8b99ae',
        },
        // Wave 5.3 — orthogonal source-class axis (retrieved sources), distinct from evidence tiers.
        sourceClass: {
          suppressed_and_recovered: '#6d28d9',
          actively_contested: '#ea580c',
          consensus_held: '#059669',
          consensus_collapsed: '#64748b',
        },
        'r1-bg': '#0d1117',
        'r1-bg-deep': '#090c11',
        'r1-text': '#eef3fb',
        'r1-text-muted': '#9eacc1',
        'r1-accent': '#7a8ea8',
        'r1-accent-deep': '#65778f',

        // Lab Notebook tokens — WO-V.
        // Synchronized with index.css :root and labNotebookTokens.ts.
        notebook: {
          bg: '#101218',
          body: '#d4deec',
          heading: '#eef3fb',
          muted: '#9eacc1',
          'rule-h': 'rgba(122, 142, 168, 0.12)',
          'rule-v': 'rgba(122, 142, 168, 0.18)',
        },
        // Sticklight vault palette — synced with src/theme.css
        r1: {
          canvas: '#0d1117',
          'canvas-deep': '#090c11',
          panel: '#101218',
          'panel-lift': '#141b26',
          'panel-hover': '#1a2433',
          border: '#7A8EA830',
          'border-strong': '#7A8EA84D',
          'border-glow': '#7A8EA852',
          text: '#d4deec',
          heading: '#eef3fb',
          muted: '#9eacc1',
          dim: '#75849b',
          cyan: '#7A8EA8',
          'cyan-dim': '#7A8EA880',
          'cyan-glow': '#7A8EA840',
          amber: '#9fb0c6',
          'amber-dim': '#9fb0c680',
          'amber-glow': '#9fb0c640',
          red: '#8b99ae',
          'red-margin': '#8b99ae3d',
          green: '#93a7c4',
          'green-dim': '#93a7c480',
          'blue-rule': '#7A8EA820',
          // Renamed from the older challenge-pass token. The operator's
          // instruction is that the old word is not one the product says, and
          // keeping it in generated utility names made the jargon gate fail
          // even when the string was invisible to readers. A gate you have to
          // argue with is worse than one you satisfy.
          challenge: '#8fa2bf',
          verified: '#a3b4ca',
        },
      },
      fontFamily: {
        serif: ['Fraunces', 'Fraunces Fallback', 'Georgia', 'Times New Roman', 'serif'],
        sans: [
          'IBM Plex Sans',
          'Plex Sans Fallback',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        display: ['Fraunces', 'Fraunces Fallback', 'Georgia', 'Times New Roman', 'serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(99, 102, 241, 0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(99, 102, 241, 0.8)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'grid-pattern': 'linear-gradient(rgba(99,102,241,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.05) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
    },
  },
  plugins: [],
};
