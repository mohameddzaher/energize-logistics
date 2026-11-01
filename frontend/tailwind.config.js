/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html",
    "./index.html"
  ],
  theme: {
    extend: {
      fontFamily: {
      sans: ['var(--font-inter)', 'var(--font-arabic)', 'system-ui', 'sans-serif'],
      serif: ['Merriweather', 'serif'],
      mono: ['Fira Code', 'monospace'],
    },
  },
  },
  plugins: [],
}