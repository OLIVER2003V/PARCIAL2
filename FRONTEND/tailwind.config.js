/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#020617',         // Slate-950
          surface: '#0f172a',    // Slate-900
          border: '#1e293b',     // Slate-800
          muted: '#64748b',      // Slate-500
          primary: {
            DEFAULT: '#2563eb',  // Blue-600
            hover: '#3b82f6',
          },
          accent: '#6366f1',     // Indigo-500
        },
      },
    },
  },
  plugins: [],
}