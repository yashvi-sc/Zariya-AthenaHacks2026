/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Syne"', 'DM Sans', 'system-ui', 'sans-serif'],
      },
      animation: {
        'streak': 'streak-shift 18s ease-in-out infinite',
        'streak-slow': 'streak-shift 28s ease-in-out infinite reverse',
        'float-drift': 'float-drift 16s ease-in-out infinite',
        'float-y': 'float-y 5s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
      },
      keyframes: {
        'streak-shift': {
          '0%, 100%': { transform: 'translateX(-4%)' },
          '50%': { transform: 'translateX(4%)' },
        },
        'float-drift': {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '33%': { transform: 'translate(8px, -6px)' },
          '66%': { transform: 'translate(-6px, 4px)' },
        },
        'float-y': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}