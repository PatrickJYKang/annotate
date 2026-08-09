# Visual / UI Refresh

> **Historical project.v1 UI plan.** It preserves visual rationale but its route/component inventory is obsolete. See the [current route reference](../../../technical_document.md#8-routes-and-user-visible-behavior).

> **Goal:** Modernise the look-and-feel of the entire app without changing any functionality. Every page and component should feel cohesive, polished, and comfortable to use for extended annotation sessions.

---

## 1  Current state audit

### 1.1  Pages (routes)

| Route | Purpose | Key observations |
|---|---|---|
| `/` (Home) | Project CRUD, video list | Plain `.panel` cards; `.toolbar` row of unstyled buttons; `<ul>` video list with button items; dev-only project-folder notice |
| `/player` | Video + tagging | Full-bleed two-pane layout; heavy inline `style={}` on every div; 300 px fixed tag-tree sidebar; monospace timestamp buttons; status-bar hotkey legend |
| `/stills` | Still capture + thumbnails | Thumbnail grid; mark list; export progress bar; same inline-style pattern |
| `/metadata` | Match info editing | Form inputs, team-grid panels, period editor, textarea; some CSS classes + lots of inline |
| `/annotate/[stillId]` | Canvas annotation editor | Konva/react-konva canvas; toolbar with tool buttons; minimal styling |
| `/player-legacy` | Old player (fallback) | Legacy layout — excluded from refresh |
| `/dropdown-test`, `/segmentation-test` | Dev test pages | Excluded from refresh |

### 1.2  Components

| Component | Location | Notes |
|---|---|---|
| `HeaderControls` | `components/HeaderControls.tsx` | Single "Fullscreen" button |
| `VideoPlayerUnit` | `components/player/VideoPlayerUnit.tsx` | Custom controls bar with play/pause, scrubber, frame-step; heavy inline styles |
| `TaggingMenu` | `components/tagging/TaggingMenu.tsx` | Popup hierarchical menu; inline styles |
| `TagFolderTree` | `components/tagging/TagFolderTree.tsx` | Collapsible tree; monospace; inline styles |
| `MatchDetailsForm` | `components/metadata/MatchDetailsForm.tsx` | Form fields; inline `CELL_INPUT` / `LABEL_STYLE` constants |
| `TeamPanel` | `components/metadata/TeamPanel.tsx` | Player table; inline style constants |
| `PeriodEditor` | `components/metadata/PeriodEditor.tsx` | Mini scrubber; inline styles |
| `TeamsheetImporter` | `components/metadata/TeamsheetImporter.tsx` | Modal; inline styles |
| `FootballDataImporter` | `components/metadata/FootballDataImporter.tsx` | Modal; inline `INPUT_STYLE` / `LABEL_STYLE` |
| `Editor` | `components/annotate/Editor.tsx` | Konva canvas wrapper; inline styles |

### 1.3  Styling approach today

- **`globals.css`** — ~35 lines: box-sizing reset, body colours, `.container`, `.panel`, `.toolbar`, `.toast`, `.overlay`, `.progress`, `.team-grid`, focus/disabled rules. No structure or sections.
- **Inline `style={}`** — The dominant pattern everywhere. Colour hex values, font sizes, padding, gaps are copy-pasted across components with minor variation.
- **Duplicated style constant objects** — `INPUT_STYLE`, `LABEL_STYLE`, `CELL_INPUT` defined separately in `FootballDataImporter`, `TeamsheetImporter`, `MatchDetailsForm`, `TeamPanel`, `PeriodEditor` with near-identical values.
- **No design tokens, no utility framework, no component library.**
- Colour palette is implicit (ad-hoc hex values: `#0f172a`, `#1f2937`, `#334155`, `#e5e7eb`, `#93c5fd`, etc.).

### 1.4  Inline style constants to consolidate

These are defined independently across components and need to be replaced by Tailwind classes:

| Constant | Found in | Typical value |
|---|---|---|
| `INPUT_STYLE` | `FootballDataImporter`, `TeamsheetImporter` | `{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #334155', borderRadius: 6, padding: '6px 8px', fontSize: 13 }` |
| `LABEL_STYLE` | `FootballDataImporter`, `TeamsheetImporter`, `MatchDetailsForm` | `{ fontSize: 12, color: '#9ca3af', display: 'flex', flexDirection: 'column', gap: 2 }` |
| `CELL_INPUT` | `TeamPanel`, `MatchDetailsForm` | `{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #334155', borderRadius: 4, padding: '4px 6px', fontSize: 13, width: '100%' }` |

---

## 2  Design principles

1. **Square and blocked-out** — Zero border-radius on every element: buttons, inputs, panels, modals, cards, badges, toasts, progress bars. Everything is rectangles.
2. **Space-filling** — Buttons stretch to fill their container height (e.g. header buttons match header height). Inputs fill available width. No small floating elements adrift in large empty regions. Toolbars, headers, and status bars are solid edge-to-edge blocks.
3. **Dark + monochrome** — Dark background palette, monochrome (white/grey) accent for interactive elements. Colour is reserved only for semantic meaning: red = error/danger, green = success, amber = warning. No blue accent buttons.
4. **Helvetica** — `'Helvetica Neue', Helvetica, Arial, sans-serif` everywhere. Monospace only for timestamps and code.
5. **Text sizing by context** — Structural areas with room (home page, empty states, panel headings) use larger text (`text-lg`+). Dense data areas (tables, tree views, status bars) stay compact (`text-xs`–`text-sm`).
6. **Keyboard-friendly** — Visible focus rings (square, 1px solid, monochrome), hotkey hints in status bars.
7. **Tailwind CSS** — Use Tailwind (build-time only) for all utility styling. `@layer components` for the few composite patterns (`.panel`, `.modal-overlay`). CSS custom properties only for semantic tokens that Tailwind's config can't express (e.g. component-level theming). No other CSS framework or runtime.

---

## 3  Tailwind configuration

All design decisions are encoded in `tailwind.config.ts`:

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    borderRadius: {
      DEFAULT: "0px",   // square everything globally
    },
    fontFamily: {
      sans: ["Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
      mono: ["SF Mono", "Cascadia Code", "Fira Code", "Menlo", "monospace"],
    },
    extend: {
      colors: {
        base:       "#0f172a",
        surface:    "#0b1220",
        raised:     "#1f2937",
        hover:      "#111827",
        selected:   "#334155",
        accent:     "#e5e7eb",
        "accent-hover": "#cbd5e1",
        "on-accent": "#0f172a",
        subtle:     "#1e293b",
        border:     "#334155",
        focus:      "#e5e7eb",
        muted:      "#64748b",
        secondary:  "#9ca3af",
        danger:     "#ef4444",
        success:    "#34d399",
        warning:    "#fbbf24",
      },
      fontSize: {
        xs:   "11px",
        sm:   "13px",
        base: "15px",
        lg:   "18px",
        xl:   "22px",
      },
    },
  },
  plugins: [],
};

export default config;
```

### What stays in CSS custom properties

Only values that Tailwind config cannot express or that need runtime access:

```css
:root {
  --player-headroom: 114px;  /* existing layout variable */
}
```

Everything else (colours, radii, fonts, sizes) lives in the Tailwind config so that utility classes like `bg-surface`, `text-muted`, `border-border`, `font-sans`, `rounded` (= `0px`) work directly.

---

## 4  Component-level classes (`@layer components`)

A small set of composite classes defined in `globals.css` using `@apply`, for patterns that are too verbose to repeat inline:

| Class | Purpose |
|---|---|
| `.panel` | Card/section container: `bg-surface border border-subtle p-3` |
| `.modal-overlay` | Fixed full-viewport backdrop: `fixed inset-0 bg-base/60 flex items-center justify-center z-50` |
| `.modal-card` | Modal body: `bg-surface border border-border p-4 shadow-lg w-full max-w-xl` |

Everything else (buttons, inputs, labels, badges, dividers) uses Tailwind utilities directly on elements — no custom classes needed. For example:
- Button: `bg-raised border border-border text-sm px-3 py-2 hover:bg-hover self-stretch`
- Accent button: `bg-accent text-on-accent text-sm px-3 py-2 hover:bg-accent-hover self-stretch`
- Input: `bg-raised border border-border text-sm px-2 py-1.5 w-full focus-visible:outline-1 focus-visible:outline-focus`
- Label: `flex flex-col gap-0.5 text-secondary text-sm`

---

## 5  Implementation checklist

Work in thin vertical slices so the app is always in a working state.

### §0 — CSS audit + Tailwind setup
- [ ] Audit `globals.css`: catalogue every rule, flag dead/redundant ones
- [ ] Catalogue all inline style constant objects across components (see §1.4)
- [ ] Install `tailwindcss`, `postcss`, `autoprefixer` as dev dependencies
- [ ] Create `tailwind.config.ts` per §3
- [ ] Create `postcss.config.mjs`
- [ ] Rewrite `globals.css`: add `@tailwind base; @tailwind components; @tailwind utilities;` at top; move surviving rules into `@layer base` or `@layer components`; delete everything that Tailwind's Preflight already handles (box-sizing reset, body margin/padding)
- [ ] Add `@layer base` overrides: square focus-visible rings (`outline: 1px solid`), `::selection`, Webkit scrollbar styling
- [ ] Delete all inline style constant objects (`INPUT_STYLE`, `LABEL_STYLE`, `CELL_INPUT`) from components (replacement happens in later steps)
- [ ] Verify `npm run dev` and `npm run build` work — app should look roughly the same (Preflight may shift some defaults)

### §1 — Layout + Header (`layout.tsx`, `HeaderControls.tsx`)
- [ ] Restyle header as a solid edge-to-edge bar: `bg-surface border-b border-border`, Helvetica, `text-lg font-bold` for title
- [ ] Header buttons stretch to fill bar height (`self-stretch`), no floating gaps
- [ ] Remove `.container` max-width constraint from layout (or keep only for non-fullbleed pages) — audit whether it helps or hurts
- [ ] Remove the `D1–D3` badge or clarify its purpose

### §2 — Home page (`/`)
- [ ] Toolbar: flush button bar, all buttons square, `self-stretch`, no gaps
- [ ] Video list: replace `<ul>` + floating `<button>` items with full-width block rows; each row shows label, duration, resolution as secondary text
- [ ] Empty state: larger text (`text-lg`), centred
- [ ] "Set up match info": full-width block row, not a small floating button
- [ ] Gate project-folder dev notice behind `process.env.NODE_ENV === 'development'`
- [ ] Upload overlay: square container, larger text labels, square progress bar

### §3 — Modals (`FootballDataImporter`, `TeamsheetImporter`)
- [ ] Apply `.modal-overlay` + `.modal-card` classes
- [ ] Replace all inline styles with Tailwind utilities
- [ ] Buttons: monochrome accent for primary actions, standard for secondary
- [ ] Inputs/selects: Tailwind input pattern (see §4)
- [ ] Labels: Tailwind label pattern (see §4)

### §4 — Metadata page + components
- [ ] `MatchDetailsForm`: replace `LABEL_STYLE`/`CELL_INPUT` with Tailwind classes; inputs fill width
- [ ] `TeamPanel`: replace `CELL_INPUT` with Tailwind; square table cells, subtle row borders, inputs flush in cells; duplicate-number validation highlight stays red
- [ ] `PeriodEditor`: replace inline styles with Tailwind; consistent button and input sizing
- [ ] Notes `<textarea>`: Tailwind classes, full-width
- [ ] Page-level (`metadata/page.tsx`): replace inline styles on toolbar, grid, spacers

### §5 — Player page + `VideoPlayerUnit`
- [ ] `player/page.tsx`: replace all inline `style={}` with Tailwind classes
- [ ] Toolbar: buttons fill bar height, square, flush together
- [ ] Sidebar: solid `border-l border-border`, clear block separation
- [ ] `TagFolderTree`: square selection highlight, subtle row hover via Tailwind
- [ ] `TaggingMenu`: replace inline styles with Tailwind
- [ ] `VideoPlayerUnit`: replace inline styles on controls bar, buttons, scrubber
- [ ] Status bar: dense full-width block, `text-muted text-xs`

### §6 — Stills page (`/stills`)
- [ ] Replace all inline styles with Tailwind classes
- [ ] Thumbnail grid: square cards, consistent sizing, hover `border-focus` highlight
- [ ] Mark list: full-width block rows
- [ ] Export progress: square progress bar with Tailwind

### §7 — Annotate page (`/annotate/[stillId]`)
- [ ] Replace inline styles on toolbar and canvas wrapper with Tailwind classes
- [ ] Tool-active state: `bg-selected` or `border-focus` indicator
- [ ] `Editor` component: replace inline styles

### §8 — Polish pass
- [ ] Cross-page consistency review: verify every button, input, panel, modal looks identical across all pages
- [ ] Focus ring audit: tab through every interactive element on every page
- [ ] Toast: square, slightly larger text, fade-in/out CSS animation
- [ ] Scrollbar styling (Webkit): thin, dark track, lighter thumb
- [ ] `::selection` colour: monochrome accent
- [ ] Final visual QA: screenshot each page, compare before/after

---

## 6  Non-goals

- **No layout changes** — Panel arrangement, page structure, and navigation flow stay the same.
- **No new features** — This is purely cosmetic.
- **Minimal new dependencies** — Tailwind CSS (build-time only, plus PostCSS/Autoprefixer). No component libraries, no CSS-in-JS runtime.
- **No responsive redesign** — Keep existing responsive behaviour; just ensure it works with new styles.
- **Excluded pages** — `player-legacy`, `dropdown-test`, `segmentation-test`.
