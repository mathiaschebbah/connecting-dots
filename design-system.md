# Connecting Dots — Design System

## Philosophy
Tool-for-thought. Dense, scannable, keyboard-driven. Every pixel earns its place.
No decoration. No marketing. No gradients. Information-first.
Inspired by Linear, Raycast, Notion — tools that disappear behind the data.

## Colors

### Backgrounds
- `white` (#FFFFFF) — main content, cards
- `zinc-50` (#FAFAFA) — page background, secondary surfaces
- `zinc-100` (#F4F4F5) — hover states, input backgrounds

### Text
- `zinc-900` (#18181B) — primary text, headings
- `zinc-700` (#3F3F46) — body text, descriptions
- `zinc-500` (#71717A) — secondary text, metadata
- `zinc-400` (#A1A1AA) — placeholder, disabled, tertiary
- `zinc-300` (#D4D4D8) — very subtle labels

### Borders
- `zinc-200` (#E4E4E7) — standard borders, dividers, card outlines
- `zinc-100` (#F4F4F5) — inner dividers, very subtle separators

### Accent (single color, used sparingly)
- `violet-600` (#7C3AED) — primary actions, active states, links
- `violet-100` (#EDE9FE) — accent backgrounds (tags, badges)
- `violet-50` (#F5F3FF) — subtle accent hover

### Status
- `emerald-600` (#059669) — active/syncing indicator
- `red-500` (#EF4444) — errors only

## Typography

Font: system stack — `-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif`
Mono: `"SF Mono", "Fira Code", "Consolas", monospace` (for IDs, counts, code)

### Scale (refined)
- Page title: `text-lg` (18px), `font-semibold`, `tracking-tight`, zinc-900
- Section header: `text-[13px]`, `font-semibold`, zinc-900
- Section label: `text-[11px]`, `font-medium`, `uppercase`, `tracking-widest`, zinc-500
- Body: `text-[13px]`, `leading-relaxed`, zinc-700
- Small/meta: `text-[11px]`, zinc-500
- Tiny: `text-[10px]`, zinc-400

## Spacing
- Page padding: `px-6 py-5`
- Card padding: `p-4`
- Section gap: `space-y-6` or `gap-6`
- Inner gap: `gap-3` or `gap-2`
- Compact gap: `gap-1.5`

## Borders & Radius
- Cards: `border border-zinc-200 rounded-lg`
- Inputs: `border border-zinc-200 rounded-md`
- Tags/chips: `rounded-full` or `rounded-md`
- Buttons: `rounded-md`
- NO shadows on cards. Rely on borders.
- Exception: focused inputs get `ring-1 ring-violet-600/20`

## Components

### Sidebar (narrow, 56px or 200px)
```
bg-zinc-50 border-r border-zinc-200
```
- Nav items: icon + label, `text-[13px]`
- Active: `bg-white text-zinc-900 font-medium` with left `border-l-2 border-violet-600`
- Inactive: `text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100`
- Logo: simple text, `font-semibold text-[15px] tracking-tight`

### Cards (tweet cards, stat cards)
```
bg-white border border-zinc-200 rounded-lg p-4
hover:border-zinc-300 transition-colors cursor-pointer
```
- NO shadows, NO hover shadows
- Content: author line → content → metadata → engagement
- Compact: reduce padding to p-3

### Inputs
```
bg-zinc-50 border border-zinc-200 rounded-md px-3 py-1.5 text-[13px]
placeholder:text-zinc-400
focus:bg-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/20 focus:outline-none
```

### Buttons
Primary: `bg-zinc-900 text-white text-[12px] font-medium px-3 py-1.5 rounded-md hover:bg-zinc-800`
Secondary: `border border-zinc-200 text-zinc-700 text-[12px] font-medium px-3 py-1.5 rounded-md hover:bg-zinc-50`
Ghost: `text-zinc-500 text-[12px] hover:text-zinc-900 hover:bg-zinc-100 px-2 py-1 rounded-md`
Accent: `text-violet-600 text-[12px] font-medium hover:bg-violet-50 px-2 py-1 rounded-md`

### Tags/Chips
```
text-[11px] font-medium px-2 py-0.5 rounded-md
border border-zinc-200 text-zinc-600 bg-white
hover:border-violet-300 hover:text-violet-700
```
- Active/selected: `bg-violet-100 text-violet-700 border-violet-200`

### Stat cards
```
border border-zinc-200 rounded-lg p-4 bg-white
```
- Label: `text-[11px] uppercase tracking-widest text-zinc-500 font-medium`
- Value: `text-xl font-semibold tabular-nums tracking-tight text-zinc-900`
- Trend: `text-[11px] text-emerald-600 font-medium` (inline, no badge)

### Engagement metrics (tweet footer)
```
flex items-center gap-4 text-[11px] text-zinc-400
```
- Each: icon (14px) + count, `hover:text-zinc-700 cursor-pointer`
- Heart hover: `hover:text-red-500`
- Retweet hover: `hover:text-emerald-600`
- Reply hover: `hover:text-violet-600`

### Search bar
```
relative group
icon: absolute left-3 center, zinc-400, group-focus-within:text-violet-600
input: w-full pl-9 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-[13px]
focus:bg-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/20
```
- Keyboard hint (right side): `kbd` elements, `text-[10px] text-zinc-400 font-mono border border-zinc-200 bg-white px-1 py-0.5 rounded`

### Toggle (fulltext/semantic)
```
flex bg-zinc-100 rounded-md p-0.5 border border-zinc-200
```
- Each option: `px-3 py-1 text-[11px] font-medium rounded`
- Active: `bg-white text-zinc-900 shadow-sm`
- Inactive: `text-zinc-400 hover:text-zinc-600`

### Empty states
- Centered, `text-[13px] text-zinc-400`
- Minimal: just text, maybe one icon above
- No illustrations

### Loading
- Spinner: `w-4 h-4 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin`
- Pulse dot: `w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse`

### Detail panel (right sidebar)
```
w-[400px] border-l border-zinc-200 bg-white overflow-y-auto shrink-0
```
- Header: section label style
- Close: ghost button, `text-zinc-400 hover:text-zinc-900`

### Scrollbar
```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #E4E4E7; border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: #D4D4D8; }
```

## Layout
```
┌─────────────────────────────────────────────────────┐
│ Sidebar (200px)  │  Main content (flex-1)  │ Detail │
│ bg-zinc-50       │  bg-white or zinc-50    │ (400px)│
│ border-r         │                         │ cond.  │
└─────────────────────────────────────────────────────┘
```
- Sidebar: fixed left, full height
- Main: scrollable content area, max-width constrained for readability
- Detail panel: conditional, slides from right

## Principles
1. No gradients. No glows. No decorative elements.
2. Single accent color (violet) used only for interactive elements.
3. Information density over whitespace — this is a power tool.
4. Every hover state communicates affordance, not decoration.
5. Text hierarchy through weight and opacity, not size variations.
6. Monospace for data (counts, IDs, timestamps), sans for prose.
7. Borders define structure. Shadows are not used on cards.
8. Light mode only. Pure white surfaces, zinc-50 backgrounds.
