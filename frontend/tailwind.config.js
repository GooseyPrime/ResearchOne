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
          100: '#161A22',
          200: '#11141A',
          300: '#0B0D11',
          400: '#07090C',
          500: '#020305',
        },
        accent: {
          DEFAULT: '#6366f1',
          light: '#818cf8',
          dark: '#4f46e5',
        },
        research: {
          gold: '#f59e0b',
          teal: '#14b8a6',
          red: '#ef4444',
          green: '#22c55e',
          purple: '#a855f7',
          blue: '#3b82f6',
        },
        tier: {
          established_fact: '#22c55e',
          strong_evidence: '#3b82f6',
          testimony: '#f59e0b',
          inference: '#a855f7',
          speculation: '#ef4444',
        },
        // Wave 5.3 — orthogonal source-class axis (retrieved sources), distinct from evidence tiers.
        sourceClass: {
          suppressed_and_recovered: '#6d28d9',
          actively_contested: '#ea580c',
          consensus_held: '#059669',
          consensus_collapsed: '#64748b',
        },
        'r1-bg': '#050608',
        'r1-bg-deep': '#020305',
        'r1-text': '#F5F7FA',
        'r1-text-muted': '#94A3B8',
        'r1-accent': '#5BCEFA',
        'r1-accent-deep': '#3AA8E0',

        // Lab Notebook tokens — WO-V.
        // Synchronized with index.css :root and labNotebookTokens.ts.
        notebook: {
          bg: '#0A0E1A',
          body: '#E0E0E0',
          heading: '#F0F2F5',
          muted: '#94A3B8',
          'rule-h': 'rgba(140, 171, 217, 0.08)',
          'rule-v': 'rgba(167, 51, 43, 0.15)',
        },
        // Sticklight vault palette — synced with src/theme.css
        r1: {
          canvas: '#050608',
          'canvas-deep': '#020305',
          panel: '#0B0D11',
          'panel-lift': '#11141A',
          'panel-hover': '#161A22',
          border: '#FFFFFF17',
          'border-strong': '#FFFFFF2E',
          'border-glow': '#63E6FF33',
          text: '#E2E6EC',
          heading: '#F7F8FA',
          muted: '#9AA3B2',
          dim: '#6F7886',
          cyan: '#63E6FF',
          'cyan-dim': '#63E6FF80',
          'cyan-glow': '#63E6FF40',
          amber: '#F6B451',
          'amber-dim': '#F6B45180',
          'amber-glow': '#F6B45140',
          red: '#A7332B',
          'red-margin': '#A7332B2E',
          green: '#2ECC71',
          'green-dim': '#2ECC7180',
          'blue-rule': '#8CABD914',
          // Renamed from the older challenge-pass token. The operator's
          // instruction is that the old word is not one the product says, and
          // keeping it in generated utility names made the jargon gate fail
          // even when the string was invisible to readers. A gate you have to
          // argue with is worse than one you satisfy.
          challenge: '#FF6B6B',
          verified: '#4ECDC4',
        },
      },
      fontFamily: {
        serif: ['Fraunces', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        display: ['Inter', 'system-ui', 'sans-serif'],
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
