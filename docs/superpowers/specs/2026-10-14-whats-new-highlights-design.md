# What's new: highlights as cards, the rest folded

## Problem

A release carries 25 to 77 notes, all drawn alike, so a reader cannot tell the release's big features from its small
tweaks. Headlines alone (the bold lead) did not fix it: 74 headlines is still a wall.

## Design

**CHANGELOG.md marks the big lines.** A note a user would open the app to try ends with `<!-- big -->` (beside its
`<!-- try: … -->`, either order). Hidden on GitHub, like the try comment. At most **5** per release;
`whatsnew.test.ts` fails a release with more, so the cards stay a short list. The writer of the line decides, in the
same commit; the header of CHANGELOG.md and AGENTS.md's CHANGELOG rule say when.

**What's new, per release:**

- **Highlights as cards**, one full-width column (not a grid: long titles, and a card opened to its full note would
  pull its neighbour out of line). A card is `bg-surface border-edge-mid rounded-md` (the modal is already
  `surface-raised`): the bold lead as its title, the rest of the note under it cut at 2 lines, and **Try it →** at its
  bottom right when the note has one. A cut card opens to the whole note on click; a card whose note fits shows no
  click affordance. A note with no bold lead shows its text as the title, cut at 3 lines.
- **One fold line under the cards**, `› 58 more changes · 12 fixes`: it opens every other note, Added and Changed
  under their labels, then Fixed. A release with no big lines shows only this line (`› 62 changes · 12 fixes`).
- Inside the fold, notes keep today's rows: a bold lead alone until clicked, a chevron only on a note with more to
  read.

**Backfill.** The five releases the sheet shows (0.15.8 to 0.15.12) get their big lines picked from their Added notes.

## Parts

- `whatsnew.ts`: `Entry.big`; `parseChangelog` lifts `<!-- big -->` out of the text; `splitHighlights(release)` returns
  the big entries (Added, Changed, Fixed order) and the sections left without them (empty ones dropped); `entryBody`
  is a note's text after its bold lead; `MAX_HIGHLIGHTS = 5`.
- `whatsnewsheet.tsx`: `HighlightCard`, the fold line, and a `useClamped` hook shared by cards and rows.
- `scripts/cdp/scenarios.mjs` `whats-new`: cards show per release (1 to 5), the fold opens the rest, Try it inside a
  fold still lands.
