# Christmas nav rail icons

A follow-up to the Christmas theme (`docs/superpowers/specs/2026-11-05-christmas-theme-design.md`, built by run
`1a544042`). While the Christmas decor shows, every nav rail icon wears a Santa hat. Build it only after that run has
landed: it uses that run's decor gate (`useChristmasDecor` / `hasChristmasDecor`, `christmasstore.ts` /
`christmas.ts`) and its `--color-xmas-bulb` token.

Brainstorm: `.superpowers/brainstorm/christmas-nav-icons/brainstorm.json`. Board:
`.superpowers/design/christmas-nav-icons/project/A-rail-hats.dc.html`.

## Background

- The nav rail is `frontend/app/view/agents/navrail.tsx`. `renderItem` draws each surface as a lucide icon in a
  `relative z-[1]` span: 20px for the core items (Cockpit, Jarvis, Agent, Usage) and for Setup (`FileCog`) and
  Settings (the gear), and 16px for the tools (Code, Diff, Radar). Translate (16px) and the pinned apps (`AppWindow`,
  16px, in `RailAppItem`) are drawn separately. From the top, the order is the core items, the tools, the pinned apps,
  then a spacer, Translate, Setup and Settings (`navrail.tsx:299-317`).
- The count badge sits at the icon's top right (`absolute -right-2 -top-1.5`); the working count sits at its bottom
  right. The rail is 78px wide, or 56px when narrow, with no labels.
- The Christmas theme gates its decor with `hasChristmasDecor` (`christmas.ts`), read in the views through
  `useChristmasDecor` (`christmasstore.ts`): the preset is Christmas and effects are not turned off. Static decor
  shows under reduced motion too.

## Decisions

### The hat

While the Christmas decor shows (`useChristmasDecor`), every nav rail icon wears a red and white Santa hat over its top-left corner, tilted about
-18°, as board A draws it. The covered icons are Cockpit, Jarvis, Agent, Usage, Code, Diff, Radar, the pinned
apps, Translate, Setup and Settings. *(Agent's call, builder question 2: "every icon" includes Settings, so
`renderItem` hats every key with no opt-out.)* The lucide icons themselves stay unchanged. The hat sits at the top left so it never covers the
count badge at the top right or the working count at the bottom right.

The hat is one shared static SVG component (`aria-hidden`, `pointer-events-none`), sized from the icon: about 70% of
the icon's size, offset about 28% left and 42% up. It is drawn in the Christmas theme's lit-bulb red, `--color-xmas-bulb` (`#d0283c`), as
board A draws it, never in raw hex. The fill crimson `--color-xmas-crimson` (`#a0061b`) reaches only 1.85:1 on the
rail's `bg-surface` and would read as a dark smudge at 11px. *(Agent's call, builder question 1.)* The brim and
pom are in the snow/text colour. It has no motion. It also shows on the narrow rail.

The `t>` mark and the agents' runtime marks stay as they are.

## Left to the builder

- Put the hat component next to the Christmas decor views and render it inside `renderItem`'s icon span, the
  Translate button and the pinned-app button in `navrail.tsx`.
- Gate it on the Christmas theme's `useChristmasDecor`. When the theme or its effects are off, the rail is identical to today.
- Add a step to the Christmas CDP scenario that captures the nav rail with hats, the Cockpit badge and a selected
  item, at both the wide and the narrow width.
- Add one `CHANGELOG.md` line.
