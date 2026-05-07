/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{tsx,ts}', './public/index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'Menlo', 'monospace'],
      },
      colors: {
        okta: {
          navy: '#00297A',
          'navy-light': '#003AA5',
          blue: '#1662DD',
          'blue-light': '#4A8AF4',
          teal: '#00D4AA',
          'teal-dark': '#00B892',
          dark: '#1D1D21',
          gray: '#6B6B78',
          'gray-light': '#F4F4F4',
        },
        surface: {
          0: '#0B0E14',
          1: '#111520',
          2: '#161B27',
          3: '#1C2233',
          4: '#232A3D',
        },
        border: {
          DEFAULT: '#1E2836',
          subtle: '#161D2A',
          hover: '#2A3548',
        },
        text: {
          primary: '#E2E8F0',
          secondary: '#8B95A8',
          muted: '#4F5B6E',
        },
        accent: {
          teal: '#00D4AA',
          blue: '#3B82F6',
          amber: '#F59E0B',
          red: '#EF4444',
          green: '#10B981',
          purple: '#A855F7',
        },
      },
      boxShadow: {
        glow: '0 0 20px rgba(0, 212, 170, 0.15)',
        'glow-sm': '0 0 10px rgba(0, 212, 170, 0.1)',
        panel: '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
      },
    },
  },
  plugins: [],
};
