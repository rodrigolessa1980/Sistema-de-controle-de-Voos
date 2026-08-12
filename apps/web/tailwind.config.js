/**
 * Paleta idêntica à do protótipo (`src/index.html` e `build/tailwind.config.js`).
 * A aparência do sistema não muda na migração — só o que está por baixo.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        bg: '#F7F9FC',
        ink: '#26303D',
        sub: '#6B7688',
        line: '#DDE3EC',
        soft: '#EEF2F7',
        primary: { DEFAULT: '#446A8D', dark: '#2E4C68', soft: '#E7EDF3' },
        success: { DEFAULT: '#3E9070', soft: '#E4F1EB' },
        warning: { DEFAULT: '#D9971B', soft: '#FBF0DC' },
        danger: { DEFAULT: '#D64545', soft: '#FBE6E6' },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)',
        pop: '0 8px 24px -6px rgb(16 24 40 / 0.12), 0 2px 6px -2px rgb(16 24 40 / 0.06)',
      },
      keyframes: {
        fade: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: { fade: 'fade .18s ease-out' },
    },
  },
  plugins: [],
};
