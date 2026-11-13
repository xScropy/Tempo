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
        sans: ["var(--font-ui)", '"Segoe UI Variable Text"', '"Segoe UI"', "Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"Cascadia Mono"', '"JetBrains Mono"', "ui-monospace", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["var(--fs-2xs)", "var(--lh-2xs)"],
        xs: ["var(--fs-xs)", "var(--lh-xs)"],
        sm: ["var(--fs-sm)", "var(--lh-sm)"],
        base: ["var(--fs-base)", "var(--lh-base)"],
        lg: ["var(--fs-lg)", "var(--lh-lg)"],
        xl: ["20px", "28px"],
        "2xl": ["26px", "34px"],
      },
      borderRadius: { DEFAULT: "5px", md: "6px", lg: "8px" },
      boxShadow: { pop: "0 8px 28px rgb(0 0 0 / 0.16), 0 0 0 1px rgb(var(--line) / 1)" },
    },
  },
  plugins: [],
};
