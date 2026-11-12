/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        raised: v("raised"),
        hover: v("hover"),
        line: v("line"),
        "line-strong": v("line-strong"),
        ink: v("ink"),
        "ink-2": v("ink-2"),
        "ink-3": v("ink-3"),
        accent: v("accent"),
        "accent-ink": v("accent-ink"),
        danger: v("danger"),
        warn: v("warn"),
        ok: v("ok"),
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', "Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"Cascadia Mono"', '"JetBrains Mono"', "ui-monospace", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", "14px"],
        xs: ["12px", "16px"],
        sm: ["13px", "18px"],
        base: ["14px", "20px"],
        lg: ["16px", "22px"],
        xl: ["20px", "26px"],
        "2xl": ["26px", "32px"],
      },
      borderRadius: { DEFAULT: "5px", md: "6px", lg: "8px" },
      boxShadow: { pop: "0 8px 28px rgb(0 0 0 / 0.16), 0 0 0 1px rgb(var(--line) / 1)" },
    },
  },
  plugins: [],
};
