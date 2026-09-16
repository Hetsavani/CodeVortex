# CodeVortex Design System — Single Source of Truth

> Mirrors `Cloud_IDE_frontend/` aesthetic (dark `gray-900` + `cyan-500` accent) but cleaned for TS + shadcn/ui. New code in `CodeVortex/frontend/src` must import from `src/lib/theme.ts` / `src/index.css`, never hardcode hex.

## 1. Philosophy — Old Frontend What We Keep

Old CRA (`Cloud_IDE_frontend/`) did 3 things right:
- **Hero**: `bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900` + `AnimatedBackground` SVG + `framer-motion` float, `text-cyan-500` brand, rotating quotes every 5s (`Hero.jsx:5`)
- **Login**: `bg-gray-900` moving `{}` background + `bg-gray-800` glass card `rounded-xl shadow-lg` + `border-gray-600` inputs `bg-gray-700` + Google button `bg-gray-700 hover:bg-gray-600` + `EyeIcon` toggle (`Login.js:314`)
- **Dashboard**: `Header` `Logo` SVG `w-8 h-8 text-cyan-500` + `Features` 6 cards `grid md:2 lg:3` `bg-white dark:bg-gray-900 p-6 rounded-lg shadow-lg` + icons `text-4xl text-cyan-500` (`Features.jsx:39`), `CodeFromPhoto`, `Testimonials`, `Footer` dark.

What we fix: inconsistent inline `style` in `Editor.js` (vs Tailwind), `height="400px"` wasted space, `prompt()` dialogs, duplicate Run buttons, scattered `console.log`, no `cn()` helper, no theme tokens — replaced by this system.

## 2. Tokens — `src/lib/theme.ts` + `src/index.css` + `tailwind.config.js`

### Colors — Tailwind shadcn + Custom Cyan
```ts
// src/lib/theme.ts — use everywhere, never literal "#06B6D4"
export const theme = {
  brand: { cyan500:"#06B6D4", cyan600:"#0891B2", cyan700:"#0E7490" },
  dark:  { bg:"#111827", bgSoft:"#1F2937", card:"#1E1E1E", border:"#3C3C3C", text:"#D4D4D4" },
  light: { bg:"#FFFFFF", bgSoft:"#F9FAFB", border:"#E5E7EB" },
  status:{ success:"#10B981", error:"#EF4444", warn:"#F59E0B" },
} as const;
```
CSS variables (shadcn) in `src/index.css` — `hsl(var(--*))` allows `dark` class toggle:
```
--background 0 0% 100% / 222.2 84% 4.9% (light/dark)
--foreground, --primary (cyan 221.2 83% 53%), --card, --border, --ring (cyan), --radius 0.625rem
--cyan-500 188 94% 43% → #06B6D4
```
`tailwind.config.js` extends `colors.border/input/ring/background/foreground/primary/cyan` + `borderRadius` + `tailwindcss-animate`. Do not add new hex without updating `theme.ts` + `index.css`.

### Typography
- **Sans**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu` (from old `index.css:5`) — weight 400/600/700/800
- **Mono** (editor/terminal): `Consolas, 'Courier New', monospace` 14px, or `JetBrains Mono` if available
- Scale: `h1 48/72 hero`, `h2 30/36 features`, `body 14-16`, `mono 14`, `caption 12`
- Headings `font-bold`, body `font-medium`

### Spacing & Radius
- `4px` (1) base, cards `p-6 rounded-lg shadow-lg`, inputs `px-3 py-2 rounded-md border`, buttons `px-4 py-2 / px-8 py-3 rounded-md / rounded-full`, gaps `4,6,8`, `radius lg var(--radius) md calc(var(--radius)-2px)`

## 3. Components — shadcn/ui (Radix + CVA)

Install: `class-variance-authority, clsx, tailwind-merge, tailwindcss-animate` (already `lucide-react`, `framer-motion`).

Required primitives in `src/components/ui/`:
- `button.tsx` — variants `default (bg-primary cyan) / ghost / outline`, sizes `default/lg/icon`, `whileHover 1.05 whileTap 0.95`
- `input.tsx` + `textarea.tsx` — `bg-gray-700 border-gray-600 focus:ring-blue-500 focus:border-blue-500` (dark) mirrors `Login.js:357`
- `card.tsx` — `bg-white dark:bg-gray-900 p-6 rounded-lg shadow-lg`
- `badge.tsx`, `dialog.tsx` for popups — replace old `CodeEditorPopup`

Helper: `src/lib/utils.ts:1` `cn(...classes)` = `twMerge(clsx(...))`.

### Patterns from old
- **Animated wrappers**: every card/button `motion.div initial opacity 0 y 50 → 1 y 0 duration 0.5 delay index*0.1` + hover `scale 1.05`
- **Background**: Hero uses `HeroAnimatedBackground` SVG linearGradient `#111827→#1F2937` + two `motion.circle` cyan/blue floating (see old `Hero.jsx:66`)
- **Login card**: `max-w-md w-full bg-gray-800 p-10 rounded-xl shadow-lg` centered on `min-h-screen bg-gray-900` with `MovingBackground` `{}` particles.
- **IDE**: header `bg-gray-100 dark:bg-gray-800 py-4 px-6` with `Logo` + `Header` nav, editor tabs `bg-[#252526]` dark / `#f5f5f5` light, `border-none`, `tab active` cyan underline, bottom panel `bg-[#1E1E1E]` `border-[#3C3C3C]`, status bar `bg-[#007acc] text-white text-xs` (from `frontend.md`).

## 4. Layout — `react-resizable-panels`

```
PanelGroup horizontal [18% FileTree][62% Editor+Bottom][20% AI]
PanelGroup vertical inside center [65% Monaco 100% height][35% BottomPanel Terminal|Output]
```
Persist sizes to `localStorage`. Old `Layout.js` used `15%/85%` flex — new keeps ratio but adds resizable handles `w-1 bg-gray-200 dark:bg-[#2d2d2d]`.

## 5. Dos / Don'ts

- ✅ `import { theme } from '@/lib/theme'` / `className={cn("bg-primary", ...)}` / `text-cyan-500 bg-gray-900`
- ❌ No inline `style={{backgroundColor:"#3c3c3c"}}` (use Tailwind or theme), no `class=` (use `className=`), no `prompt()`/`alert()` (use `Dialog` + `toast`), no new hex without updating `theme.ts`+`index.css`

## 6. File Map

```
CodeVortex/design.md (this file)
frontend/src/lib/theme.ts        → JS tokens
frontend/src/index.css           → CSS vars + tailwind base
frontend/tailwind.config.js      → extends colors
frontend/src/lib/utils.ts        → cn()
frontend/src/components/ui/*     → shadcn primitives
frontend/src/components/landing/*→ Hero, Header, Features (port from Cloud_IDE_frontend/src/Components/MainDashboardComponents/)
frontend/src/components/ide/*    → EditorPanel, FileExplorer, TerminalPanel, etc.
```
