# Cockpit design rules (decision: UI-1, 31 Oct)

Binding brief: `.superpowers/sdd/ui/design-brief.md`. This is the short version for page work.

## Dials
DESIGN_VARIANCE 3, MOTION_INTENSITY 4, VISUAL_DENSITY 7. Calm ops dashboard, projected at 3 m.

## Stack
shadcn/ui (`radix-nova`, base `radix`, Phosphor icons via `@phosphor-icons/react`), Tailwind v4,
Geist Sans/Mono from the `geist` package (never `next/font/google`), `motion/react`, `sonner`.
Add components with `npx shadcn@latest add <name>`; do not hand-write what exists.

## Tokens (`app/globals.css`, `:root` and `.dark`)
- `primary` navy `#002E6E` (dark: `#8DB3EC`). Use `bg-primary`, `text-primary`.
- Cyan accent: `bg-highlight` (fill), `text-highlight-foreground` (text on fill),
  `text-highlight-text` (cyan text on page bg, AA). Raw `#00BAF2` text on light fails AA.
- Neutrals are slate: `background` (off-white / off-black), `card`, `muted`, `muted-foreground`, `border`.
- Status: `--status-{resolved,processing,awaiting,new,routed,incident,failed,closed}`.
  Pills go through `toneBadge({ tone })` in `components/status-tone.ts` (`STATUS_TONE`,
  `GATE_TONE`, `PRIORITY_TONE`). No purple anywhere; INCIDENT_LINKED is teal.
- Charts: `--chart-1` cyan, `--chart-2` navy, `--chart-3` slate, `--chart-4` emerald, `--chart-5` amber.
- Legacy `bg-navy`/`text-cyan`/`bg-light`/`text-ink` exist only until pages migrate. Do not add new uses.

## Radius and type
- `--radius: 0.625rem` for cards/inputs; badges and pills `rounded-full`. Nothing else.
- Numbers, ids, amounts, timers: `font-mono tabular-nums`. KPI values `text-3xl`, pills `text-sm font-medium`,
  ids mono `text-sm`, body `text-sm`/`text-base`.
- The header (`AppHeader`) owns the page title. Pages MUST NOT render their own page-level `h1`.

## Motion
Only motivated motion, 150 to 300 ms, springs or `[0.16, 1, 0.3, 1]`, all collapsed under
`useReducedMotion()`: status pill change, new row enter, `AnimatedNumber` for counts,
approval card exit (AnimatePresence), timeline stagger (30 ms, max 12), route fade (`app/template.tsx`).
No infinite loops except the KPI "Live" pulse.

## Anti-slop
- No em-dash or en-dash in any visible string.
- No decorative dots (a dot only for real live state), no eyebrow labels, no "01 /" numbering,
  no fake numbers, no three equal feature cards, no gradients, glow, glassmorphism or emoji.
- Plain functional copy ("Awaiting approval", "Send notice").
- Loading = `Skeleton` shaped like the final layout. Empty = `Empty`. Errors inline (`Alert`), transient
  feedback via `toast()` from `sonner`.
- shadcn rules: semantic tokens only, `gap-*` not `space-*`, `size-*`, `cn()`, full Card composition,
  `data-icon` on icons in buttons, no sizing classes on icons inside components.
- Cards only where elevation means hierarchy; tables are rows with one bottom border.

## Contract
Every `data-testid` / `data-*` handle in `.superpowers/sdd/ui/contract.md` MUST survive, on an element with
the same meaning, visible without extra clicks. `ticket-status` text stays the raw enum. One `kpi-<metric>`
per metric. The notifications rail and the `?demo=1` drawer stay visible on load.
