# Theme System Overview

This project centralises its theming primitives around a single set of CSS tokens and helpers. The checklist below explains how things fit together and how to extend them without reintroducing drift.

## Entry points
- `src/main.css` is the only global stylesheet imported by both `index.html` and `src/main.tsx`. It loads the shared tokens first, then Tailwind and animation utilities to ensure utility classes resolve against the latest variable values.
- The legacy `src/index.css` entry has been removed. When migrating older sparks, point any remaining imports at `src/main.css` instead of re‑adding `index.css`.

## Design tokens
- `src/styles/tokens.css` defines all colour, typography, radii, spacing, and elevation tokens. Light and dark values live side by side via the `.dark` selector so the Tailwind `darkMode: "class"` strategy remains the single source of truth.
- Contrast helpers (for example `--blue-contrast`) are declared explicitly because the Radix colour imports do not expose them. These map to high-contrast text values that satisfy WCAG AA against the `*-9` surfaces.
- Semantic status tokens (`--color-status-*`) expose both background and foreground slots. Use them through Tailwind via utilities like `bg-status-warning` and `text-status-warning-foreground` rather than hard-coded hex codes.

## Tailwind configuration
- `tailwind.config.js` re-exports the token scales with `var(--token, fallback)` so missing variables gracefully degrade to sensible defaults. Extend new tokens by adding to the helper arrays near the top of the config.
- The `status` colour group mirrors the semantic tokens: if you introduce a new status, add both the CSS variable in `tokens.css` and its Tailwind alias in the `status` map.
- Spacing, radii, and focus ring tokens include fallbacks and stay in sync with Tailwind’s defaults. Adjust the fallback arrays if the base values ever change.

## Dark mode
- Dark mode is controlled exclusively via the `.dark` class. Do not use `[data-appearance="dark"]` or other selectors, otherwise variable overrides can get out of sync with Tailwind.
- Components should rely on semantic classes (`bg-background`, `text-foreground`, `text-status-error`, etc.) so the same JSX renders appropriately in both themes.
- If you encounter legacy code using `[data-appearance="dark"]`, remove the selector and rely on the `.dark` class (or wrap the React root with `className="dark"` when forcing the theme) before adding new tokens.

## Component guidance
- When adding icons or badges that reflect state, prefer the `status` palette classes (e.g. `text-status-success`) to avoid mismatched hues between components.
- Tabs and headers now follow a shared typographic scale; match new sections to the existing `text-3xl sm:text-4xl` + `text-base sm:text-lg` pattern to preserve hierarchy.

Following these conventions keeps the UI aligned with the brand palette and prevents regressions when tokens evolve.
