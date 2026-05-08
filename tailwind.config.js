/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#111827",
          800: "#1f2937",
          600: "#4b5563",
          500: "#6b7280",
        },
        line: "#e5e7eb",
        surface: "#f8fafc",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.05)",
      },
    },
  },
  plugins: [],
};
