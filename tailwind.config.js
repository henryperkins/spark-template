/** @type {import('tailwindcss').Config} */

const cssVar = (name, fallback) => (fallback ? `var(${name}, ${fallback})` : `var(${name})`);

const createNumericScale = (prefix, values) =>
  values.reduce((scale, value, index) => {
    scale[index + 1] = cssVar(`--${prefix}-${index + 1}`, value);
    return scale;
  }, {});

const createAlphaScale = (prefix, values) =>
  values.reduce((scale, value, index) => {
    scale[`a${index + 1}`] = cssVar(`--${prefix}-a${index + 1}`, value);
    return scale;
  }, {});

const neutralScale = createNumericScale("color-neutral", [
  "#fcfcfd",
  "#f9f9fb",
  "#f0f0f3",
  "#e8e8ec",
  "#e0e1e6",
  "#d9d9e0",
  "#cdced6",
  "#b9bbc6",
  "#8b8d98",
  "#80838d",
  "#60646c",
  "#1c2024",
]);

const neutralAlphaScale = createAlphaScale("color-neutral", [
  "#00005503",
  "#00005506",
  "#0000330f",
  "#00002d17",
  "#0009321f",
  "#00002f26",
  "#00062e32",
  "#00083046",
  "#00051d74",
  "#00071b7f",
  "#0007149f",
  "#000509e3",
]);

const accentScale = createNumericScale("color-accent", [
  "#fbfdff",
  "#f4faff",
  "#e6f4fe",
  "#d5efff",
  "#c2e5ff",
  "#acd8fc",
  "#8ec8f6",
  "#5eb1ef",
  "#0090ff",
  "#0588f0",
  "#0d74ce",
  "#113264",
]);

const accentSecondaryScale = createNumericScale("color-accent-secondary", [
  "#fdfcfe",
  "#faf8ff",
  "#f4f0fe",
  "#ebe4ff",
  "#e1d9ff",
  "#d4cafe",
  "#c2b5f5",
  "#aa99ec",
  "#6e56cf",
  "#654dc4",
  "#6550b9",
  "#2f265f",
]);

const spacingFallbacks = {
  px: "1px",
  0: "0px",
  "0.5": "0.125rem",
  1: "0.25rem",
  "1.5": "0.375rem",
  2: "0.5rem",
  "2.5": "0.625rem",
  3: "0.75rem",
  "3.5": "0.875rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  7: "1.75rem",
  8: "2rem",
  9: "2.25rem",
  10: "2.5rem",
  11: "2.75rem",
  12: "3rem",
  14: "3.5rem",
  16: "4rem",
  20: "5rem",
  24: "6rem",
  28: "7rem",
  32: "8rem",
  36: "9rem",
  40: "10rem",
  44: "11rem",
  48: "12rem",
  52: "13rem",
  56: "14rem",
  60: "15rem",
  64: "16rem",
  72: "18rem",
  80: "20rem",
  96: "24rem",
};

const sizeVarName = (token) => {
  if (token === "px") return "--size-px";
  if (token === "0") return "--size-0";
  return `--size-${token.replace(".", "-")}`;
};

const spacing = Object.fromEntries(
  Object.entries(spacingFallbacks).map(([token, fallback]) => [
    token,
    cssVar(sizeVarName(token), fallback),
  ]),
);

const defaultTheme = {
  container: {
    center: true,
    padding: "2rem",
    // Ensure container breakpoints use numeric widths only.
    // This prevents Tailwind's container plugin from generating invalid media/max-width
    // rules for raw screens like (display-mode: standalone) or (pointer: coarse/fine).
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
  },
  extend: {
    keyframes: {
      "accordion-down": {
        from: { height: "0" },
        to: { height: "var(--radix-accordion-content-height)" },
      },
      "accordion-up": {
        from: { height: "var(--radix-accordion-content-height)" },
        to: { height: "0" },
      },
    },
    animation: {
      "accordion-down": "accordion-down 0.2s ease-out",
      "accordion-up": "accordion-up 0.2s ease-out",
    },
    colors: {
      neutral: {
        ...neutralScale,
        ...neutralAlphaScale,
        contrast: cssVar("--color-neutral-contrast", "#111820"),
      },
      accent: {
        ...accentScale,
        contrast: cssVar("--color-accent-contrast", "#113264"),
      },
      "accent-secondary": {
        ...accentSecondaryScale,
        contrast: cssVar("--color-accent-secondary-contrast", "#2f265f"),
      },
      status: {
        success: cssVar("--color-status-success", "#30a46c"),
        "success-foreground": cssVar("--color-status-success-foreground", "#193b2d"),
        warning: cssVar("--color-status-warning", "#ffc53d"),
        "warning-foreground": cssVar("--color-status-warning-foreground", "#2f1b00"),
        error: cssVar("--color-status-error", "#e5484d"),
        "error-foreground": cssVar("--color-status-error-foreground", "#641723"),
        info: cssVar("--color-status-info", "#0090ff"),
        "info-foreground": cssVar("--color-status-info-foreground", "#113264"),
        processing: cssVar("--color-status-processing", "#8e4ec6"),
        "processing-foreground": cssVar("--color-status-processing-foreground", "#2f265f"),
      },
      fg: {
        DEFAULT: cssVar("--color-fg", "#1c2024"),
        secondary: cssVar("--color-fg-secondary", "#0007149f"),
      },
      bg: {
        DEFAULT: cssVar("--color-bg", "#ffffff"),
        inset: cssVar("--color-bg-inset", "#f0f0f3"),
        overlay: cssVar("--color-bg-overlay", "#ffffff"),
      },
      "focus-ring": cssVar("--color-focus-ring", "#0090ff"),
    },
    borderRadius: {
      sm: cssVar("--radius-sm", "0.125rem"),
      md: cssVar("--radius-md", "0.375rem"),
      lg: cssVar("--radius-lg", "0.5rem"),
      xl: cssVar("--radius-xl", "0.75rem"),
      "2xl": cssVar("--radius-2xl", "1rem"),
      full: cssVar("--radius-full", "9999px"),
    },
    spacing,
  },
};

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: defaultTheme,
  darkMode: "class",
};
