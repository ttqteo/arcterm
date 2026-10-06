# Changelog

What changed in arcterm for the person using it, newest first. Internals (tests, specs, plans, build
scripts) stay in `git log`.

Add one line in the same commit as any change a user would notice, under `Added`, `Changed` or
`Fixed` in the top section. The top section stays `Unreleased` until its build: on a bump, replace
`Unreleased` with the build date. If the top section already has a date, open a new
`## Unreleased` above it, and give it a version number at the bump.

## 0.15.1 — 2026-10-07

### Added

- **macOS on Apple silicon.** arcterm builds and runs as an ad-hoc signed `.app` and `.dmg` (macOS 13+),
  with the native traffic lights over the app bar.
- **Dock badge on macOS.** The app icon counts agents with a turn you haven't looked at plus what Jarvis is
  waiting on you for, and clears at zero.
- **Worker RAM capacity.** An app bar chip shows how many more workers free RAM holds. Each worker counts
  at its typical footprint, and one heavy job's extra (a `tsc` run, say) is held back once.
- The worker steppers in New run and on a run's lead card warn when the width you pick is more than
  fits in RAM; Jarvis says so too, and takes a "RAM full" state when there is no room left.
- **Comments on markdown in the Agent panel.** The File tab shows a `.md` file rendered, with a Preview /
  Source toggle. Select text and press `c`, click a block's `+` (Shift+click for a range), or hover an image
  and click Comment; the tray sends every comment to the agent as one message (`Ctrl`+`Enter`), or copies it.
- Code shows gitignored files in the tree, dimmed. A directory ignored as a whole is one entry that
  lists its contents on demand.
- In Jarvis's brief, an initiative with no chunks reads as an idea, under an "Ideas" label. Each row's
  `…` menu (or right-click) has rename, details, pause/resume, archive and delete without expanding
  the row.

### Changed

- **Usage is a compact dashboard.** The live limits and the historical totals share one row of tiles,
  Daily and Where it goes sit side by side, and the header no longer repeats the totals. With a single
  provider, the provider rail is dropped and the page takes the full width.
- In the Agent sidebar, double-click a run's lead row to fold or unfold its workers, or an agent's row to fold its
  subagents; a single click still selects it.
- Code blocks wrap long lines by default instead of scrolling sideways.
- Jarvis's peek approves a gate or retries a failed task in place, as the brief does, instead of only
  opening it.
- Hover tooltips fade in over 90 ms from the side facing their control.
- Code's header is one compact row, so the editor gets more height.
- The default terminal font size is 14.

### Fixed

- Typing with XKey and other macOS Vietnamese input methods no longer drops letters when a key replaces
  several at once ("mặc định" came out "mặ ị").
- Fast terminal input reaches the shell in the order it was typed.
- On macOS, Ctrl shortcuts show as ⌃, not ⌘.
- On macOS, Code, worktree diffs and skill files open the right paths instead of backslashed ones that
  don't exist; renaming a directory now carries its drafts with it.
- The app bar keeps room to drag the window beside the search at narrow widths.
- On macOS, a tooltip stays open through a screenshot shortcut (⌘⇧4, ⌘⇧5).
- Code's markdown preview shows a file's relative images instead of `[img:…]` text.

## 0.15.0 — 2026-10-06

- Renamed to arcterm. This changelog starts here; earlier history is in `git log`.
