# Connecting Dots — Design System v2

## Philosophy
Plateforme de veille technologique pour centres de R&D. L'interface doit être **chaleureuse et lisible**, pas froide et austère.
Inspirée par Arc Browser, Linear, Craft — des outils qui ont du caractère tout en restant fonctionnels.
Dense en information, mais respirable. Chaque composant a de la **profondeur subtile**.

## Personality
- **Warm & approachable** — pas corporate, pas froid
- **Confident** — bords plus arrondis, ombres douces, transitions fluides
- **Data-rich but breathable** — marges généreuses entre les groupes, compact à l'intérieur

## Colors

### Backgrounds
- `zinc-950` (#09090B) — sidebar, overlay backgrounds (dark accent)
- `zinc-50` (#FAFAFA) — page background
- `white` (#FFFFFF) — cards, elevated surfaces
- `violet-50` (#F5F3FF) — subtle accent backgrounds

### Text
- `zinc-900` (#18181B) — primary text, headings
- `zinc-700` (#3F3F46) — body text
- `zinc-500` (#71717A) — secondary text
- `zinc-400` (#A1A1AA) — placeholder, subtle
- `zinc-300` (#D4D4D8) — ghost text

### Borders
- `zinc-200/60` — standard borders (slightly transparent for softness)
- `zinc-100` — inner dividers

### Accent
- `violet-600` (#7C3AED) — primary actions
- `violet-500` (#8B5CF6) — hover states
- `violet-100` (#EDE9FE) — tag backgrounds
- `violet-50` (#F5F3FF) — subtle hover

### Domain colors (richer, more saturated)
- AI/ML: `#7C3AED` (violet)
- Dev-tools: `#0891B2` (cyan)
- Web: `#2563EB` (blue)
- Crypto: `#059669` (emerald)
- Design: `#DB2777` (pink)
- Science: `#D97706` (amber)
- Business: `#EA580C` (orange)
- Culture: `#65A30D` (lime)

### Signal
- High signal: `emerald-500` with soft green glow
- Rising trend: `emerald-500`
- Declining: `zinc-400`
- Error: `red-500`

## Typography

Font: `"Inter", -apple-system, sans-serif` — Inter preferred for its warmth
Mono: `"JetBrains Mono", "SF Mono", monospace`

### Scale
- Hero: `text-xl` (20px), `font-bold`, `tracking-tight`
- Title: `text-[15px]`, `font-semibold`, `tracking-tight`
- Section: `text-[13px]`, `font-semibold`
- Body: `text-[13px]`, `leading-relaxed`
- Small: `text-[11px]`, `font-medium`
- Micro: `text-[10px]`

## Borders & Radius — KEY CHANGE
- Cards: `rounded-xl` (12px) — generously rounded
- Modals/panels: `rounded-2xl` (16px)
- Buttons: `rounded-lg` (8px)
- Inputs: `rounded-lg` (8px)
- Tags/chips: `rounded-full` (pill shape)
- Avatars: `rounded-full`
- Small elements: `rounded-md` (6px)

## Shadows — subtle depth
- Cards: `shadow-sm` — very subtle elevation
- Cards hover: `shadow-md` with slight scale
- Modals: `shadow-xl`
- Dropdowns: `shadow-lg`
- NO harsh shadows. Blur-heavy, low opacity.

## Components

### Cards
```
bg-white rounded-xl border border-zinc-200/60 p-4 shadow-sm
hover:shadow-md hover:border-zinc-300 transition-all duration-200
```
- High signal cards get a left border accent: `border-l-3` with domain color
- Cards have subtle `backdrop-blur` when overlapping

### Buttons
Primary: `bg-zinc-900 text-white rounded-lg px-4 py-2 font-medium shadow-sm hover:bg-zinc-800 hover:shadow-md transition-all`
Secondary: `bg-white border border-zinc-200/60 rounded-lg px-4 py-2 font-medium shadow-sm hover:bg-zinc-50 transition-all`
Ghost: `text-zinc-500 rounded-lg px-3 py-1.5 hover:text-zinc-900 hover:bg-zinc-100 transition-colors`
Accent: `bg-violet-600 text-white rounded-lg px-4 py-2 font-medium shadow-sm hover:bg-violet-500 transition-all`

### Inputs
```
bg-white border border-zinc-200/60 rounded-lg px-3 py-2 text-[13px] shadow-sm
placeholder:text-zinc-400
focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none
transition-all
```

### Tags/Chips (pill shape)
```
text-[11px] font-medium px-2.5 py-1 rounded-full
bg-zinc-100 text-zinc-600
hover:bg-zinc-200 transition-colors
```
- Active: `bg-violet-100 text-violet-700`
- Domain-colored: `bg-{color}/10 text-{color}`

### Navigation bar (CortexBar)
```
h-12 bg-white/80 backdrop-blur-xl border-b border-zinc-200/60
sticky top-0 z-50
```
- Glassmorphism effect for depth
- Logo: bold, tracking-tight
- Lens switcher: pill-shaped tabs with smooth transitions
- Worker dots: soft pulsing animation

### Signal indicators
- High: `bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]` — soft glow
- Rising cluster: green text + ▲
- Declining: muted zinc

### Detail panel
```
w-[440px] bg-white border-l border-zinc-200/60 rounded-l-2xl shadow-lg
```
- Slides in with spring animation
- Rounded left corners for panel feel

### Empty states
- Centered with subtle illustration or large icon
- `text-zinc-400` body, `text-zinc-600` title
- CTA button in accent style

### Loading
- Spinner: `w-5 h-5 border-2 border-zinc-200 border-t-violet-600 rounded-full animate-spin`
- Skeleton: `bg-zinc-100 rounded-lg animate-pulse`

## Layout
```
┌──────────────────────────────────────────────────────────────┐
│ CortexBar (h-12, glassmorphism, sticky)                      │
├──────────────────────────────────────────────────────────────┤
│ TopicRibbon (optional, pill filters)                         │
├──────────────────────────────────────────────────────────────┤
│  Main Content (flex-1, scrollable)       │ Detail Panel      │
│  max-w-4xl mx-auto                       │ (440px, slide-in) │
│  rounded-xl cards with shadows           │ rounded-l-2xl     │
└──────────────────────────────────────────────────────────────┘
```

## Transitions
- All interactions: `transition-all duration-200 ease-out`
- Panel open: `framer-motion` spring with `stiffness: 300, damping: 30`
- Card hover: subtle `scale(1.01)` + shadow increase
- Color transitions: `transition-colors duration-150`

## Principles
1. Rounded corners everywhere — `rounded-xl` is the default for containers
2. Subtle shadows create depth hierarchy
3. Glassmorphism on overlays and navigation
4. Pill-shaped tags and filters
5. Warm, approachable feel — not corporate gray
6. Animation adds life: hover scales, smooth transitions, spring panels
7. Domain colors are saturated and expressive
8. High-signal content gets visual prominence (glow, border accent)
