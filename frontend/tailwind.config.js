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
      // Fira Code is never loaded and no monospace font has Arabic letters: without the Arabic font here, a plate in Arabic fell to the phone's own font (Urdu Nastaliq on an Urdu phone).
      mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'var(--font-arabic)', 'monospace'],
    },
  },
  },
  plugins: [],
}