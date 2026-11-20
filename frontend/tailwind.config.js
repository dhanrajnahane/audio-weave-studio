/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        studio: {
          950: '#090a0f',
          900: '#10121a',
          850: '#161924',
          800: '#1e2230',
          750: '#262c3e',
          700: '#2e354a',
          600: '#3e4764',
          accent: '#3b82f6',
          waveform: '#60a5fa',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}
