# Settings redesign

**Status:** approved 2026-10-08. Prototype: `D:/work/arcterm/.superpowers/design/settings-redesign/project/` (gitignored; deleted once this ships).

## Problem

The Settings surface reads as cluttered rather than wrong:

- Every row is three tiers tall: title, description, then a mono config key with a scope dot. Across 45 rows that third tier is the most repeated thing on screen.
- Content spans the whole pane (~1100px at 1600 wide), so a row's text sits at the left edge and its control at the far right.
- The accent is everywhere: uppercase group headers, `CHANGED` badges, the selected index item's border. DESIGN.md keeps selection grey and the accent for signal.
- The index is 340px wide and every item repeats "N settings".
- Eleven pages, five of them one to three rows (Run defaults 1, General 2, Vault 2, Fonts 3, Notifications 3).
- Complex controls each invent a shape: full-width radio cards (Headless runtime), a full-width account card, a boxed table (About harnesses).

The structure of what can be set does not change. No setting is added or removed, and every value keeps its store and key.

## Pages

Six pages, one flat index, no group headers. Each page is a stack of labelled cards.

| Page | Cards (rows, by current row id) |
|---|---|
| **General** | Startup: `general.startup`, `general.rail` · Notifications: `notifications.os`, `notifications.toast`, `notifications.reply` · Vault & sync: `memory.vaultpath`, `memory.remote`, then the sync status as the card's footer |
| **Appearance** | Theme: `appearance.theme` · Colors: `appearance.accent`, `.success`, `.warning`, `.error` · Fonts: `fonts.sans`, `fonts.mono` · Jarvis: `appearance.petoutfit` |
| **Terminal** | Text: `fonts.term`, `terminal.fontsize` · Cursor: `terminal.cursor`, `terminal.cursorblink` · Behavior: `terminal.scrollback`, `terminal.copyonselect` |
| **Agents** | Claude account (the account list) · Runs: `run.route` · Launch flags: runtime tabs, then `newagent.remember`, then the runtime's flag rows |
| **Background AI** (was Headless AI) | Runtime: `headless.runtime` · OpenRouter: `headless.apikey`, `headless.cheap` · Radar: `headless.radaraudit` |
| **About** | Versions: `about.app`, `.server`, `.buildtime`, `.platform` · Coding agents: `about.harnesses`, then `about.updatecheck` |

Row ids stay as they are (they are the search index and the CDP hooks). Section ids become `general`, `appearance`, `terminal`, `agents`, `headless`, `about`. A pending deep link (`pendingSettingsSectionAtom`) naming a retired section id (`fonts`, `notifications`, `newagent`, `run`, `claudeaccount`, `memory`) resolves to the page that now holds it. The model gains a card level: a section is a list of cards, a card a label plus rows.

## Frame

- **Index**: 240px. A search field at the top, then six items, 32px tall, 13px. The selected item is a `surface-selected` fill, no border. An item with changed rows shows a 5px accent dot and the count in `muted` at its right. No "N settings" count, no group headers, and the synced/local legend at the foot of the pane is removed.
- **Content**: the page scrolls inside a column capped at 720px, padded 28px 40px. The header is the page name at 18px bold and the blurb at 12.5px `muted`. Reset section is a small secondary button at the header's right, shown only when the page has a changed row.
- **Card**: a label above it (12px semibold `ink-mid`), then `bg-surface-raised border border-edge-mid rounded` (8px), rows divided by `edge-mid`. A card may lead with a warning band (`askingbg` fill, a warning icon, `warning-soft` text) or a tab strip, and may end with a footer line.

## Row

- Two tiers: the title (13px medium `primary`), then the description (12px `muted`), 12px 16px padding. A compact row (versions, colors, flags) is one line at 9px vertical padding; a flag row puts its description on the title line after the mono flag name.
- The control sits at the card's right edge, never the pane's.
- **Changed**: a 5px accent dot before the title and an icon-only revert button (rotate-ccw, `aria-label="Revert to default"`) after the control. The `CHANGED` text badge goes.
- **Key**: no longer drawn at rest. On row hover or focus-within, the row takes `surface-hover` and a pill appears after the title: the key in mono 10.5px `muted` with a copy icon, then `synced` or `this machine` in `ink-faint`. Clicking the pill copies the key. Its title says where the value lives (`Copy term:scrollback · synced in settings.json`). Rows without a key (versions, the vault remote) show no pill.

## Controls

- **Segmented**: a `surface` track with `edge-mid` border; the selected option is a `surface-selected` fill with `primary` text (grey, no accent tint). The font rows draw each option in its own face.
- **Toggle**, **stepper**, **inputs**: the existing primitives, restyled to the 28–30px control height. The toggle stays accent when on.
- **Select** (dropdown button + popover menu): `general.startup` moves from a seven-option segmented row to a select. Its menu lists "Last opened" (with "the one you left" in `muted`) above a divider, then the surfaces; the current choice has a check. `run.route` and `headless.radaraudit` keep their selects in the same style.
- **Choice list** (one shape for every pick-one-of-many inside a card): Theme as a three-column grid of chips (four swatches, name, check on the selected one); Background AI runtime, Claude accounts and coding agents as card rows. The selected row is a `surface-selected` fill with a check. A runtime that is not installed draws its name in `muted`. Status is a dot plus a word (`installed`, `not installed`, `default · key missing`).
- **Claude account row**: the email, a method tag (`/login` or `token`), "new agents use this" on the active one, then 5h and Week meters (a 64px bar plus the percent, the bar in `warning` from 80%), last seen, and a ⋯ menu. "+ Add account" is the card's footer and opens the existing Add account dialog.
- **About, coding agents**: name, an "N available" pill (`accentbg`, `accent-soft`) when a newer release is out, the version right-aligned in `tabular-nums`.

## Out of scope

- No new settings, no change to a value's store, key or default.
- The Claude account dialogs (add, rename, remove, restart) keep their current design.
- No change to how search matches; it now finds rows across six pages instead of eleven.

## Testing

- `settingsmodel.test.ts`: the six sections and their order, every current row id present exactly once, card membership, and the legacy section-id mapping.
- The pure helpers that gain logic (legacy id resolution, changed counts per page) get unit tests beside them.
- CDP: scenarios that click `[data-section=…]` for a retired section id move to the new id (`settings-claude-account`, `settings-radar-audit`, the run-route and flag steps, notifications, about). A new `settings-pages` scenario opens each of the six pages and screenshots it, the General select with its menu open, and one hovered row showing its key pill.
