# Changelog

What changed in arcterm for the person using it, newest first. Internals (tests, specs, plans, build
scripts) stay in `git log`.

Add one line in the same commit as any change a user would notice, under `Added`, `Changed` or
`Fixed` in the top section. The top section stays `Unreleased` until its build: on a bump, replace
`Unreleased` with the build date. If the top section already has a date, open a new
`## Unreleased` above it, and give it a version number at the bump.

## Unreleased

### Added

- LaTeX and BibTeX files are highlighted on Code and in the agent panel's File tab, and a **Wrap** toggle (`Alt+Z` on
  Code) wraps long lines; `.tex`, `.bib`, `.md` and `.txt` wrap by default. A `.pdf` now opens in a viewer instead of
  "Binary file".
- A `.tex` file opens on Code as a readable preview: its title and authors, numbered headings, and the prose with
  `\cite`/`\ref` keys and rendered math. Double-click a sentence to edit it in Source. When the paper has a built PDF
  (Doc review's build, or the one beside the main file), a **PDF** mode shows it with how old it is.
- The Diff surface has a **Wrap** toggle (`Alt+Z`) too, shared per file with Code and the agent panel's File tab.
- A background task's output in the agent panel has a **Live** toggle: while the task runs the output follows along as
  it grows, staying at the end unless you scroll up.
- A file in the agent panel's **Files changed** opens beside the agent as a diff against where the session started,
  with **Source** to see the whole file and a button to the Diff surface; **View diff** still opens Diff.

### Changed

- Added and removed lines in a diff are a softer green and red; a new file no longer reads as a solid block of green.
- Opening an idea in Jarvis no longer shows an empty initiative plan. It shows the whole title and when you jotted it,
  with **Plan it** (an agent breaks the idea into chunks) and **Add first chunk**, which turns it into an initiative card.
- An agent notification says what it is at a glance: an amber question tile and **Needs you**, a green check and
  **Finished**, with the project and the agent's harness on the right, instead of tacking "finished" onto the name.
  A toast stays while the pointer is on it, and one that needs you stays 15 seconds instead of 6.

### Fixed

- An agent that has just finished its turn no longer shows as asking for about a minute, or sends a false
  **Needs you** notification.
- A notification toast in the corner is no longer covered by Jarvis's pet; the pet walks off the stretch below it.
- Code no longer fails with "Could not list files: exit status 1" the first time it opens a large project;
  a listing that really does run out of time now says so.
- Shortcuts work with a Vietnamese input method such as EVKey or Unikey left on Telex: outside a text field or the
  terminal, a letter it rewrites ("đ" for `dd`, "ư" for `w`, "á" for `a` `s`) acts as the key you pressed.

## 0.15.2 — 2026-10-07

### Added

- The New agent dialog warns when free RAM can't hold another agent, with how much is free, so you can close one
  before the machine starts to lag. It still lets you launch. The "No terminal running" screen shows the same
  warning, since resuming a recent session there launches at once.
- An agent that stops on one part of a walk-through, such as "Part 1/3", shows `1/3` at the end of its row in
  place of the unread count, and keeps it until you reply, so a half-reviewed design is not forgotten.
- **Claude Code updates.** arcterm checks for a newer Claude Code every 6 hours and Jarvis says once when one is out.
  Settings → About lists each installed harness with its version, and Update installs the new one; open sessions keep
  theirs until they restart. Turn the check off with "Check for harness updates".
- Notifications when an agent needs you or finishes its turn: a system notification while arcterm is in the
  background (click it to open the agent), a toast while it is in front. Settings → Notifications turns each off.
- The keyboard hints bar shows the running arcterm version at its right end; hover it for the backend version and
  build time.

### Changed

- A run a session starts with `wsh runs start` is listed under that session in the sidebar, one level in with a guide
  line, both while they run and in Conversations once they end, so you can tell which conversation launched it. Runs started before this update keep their old place.
- Unread counts (the Agent badge in the nav rail, the Dock badge on macOS, a bold row) come only from top-level
  agents: a run's workers report to their lead, so their finished turns no longer count as unread.
- An agent waiting on a permission prompt now shows amber, like one asking a question.
- `g` `j` now goes to Jarvis (it was `g` `c`).
- On Windows, shortcuts are spelled out in words, `ctrl+shift+p` and `shift+g`, instead of `^⇧P` and `⇧G`; macOS
  keeps its ⌘ ⌃ ⌥ ⇧ symbols.
- Jarvis shows each initiative as a card with a bar of its chunks and the one to do next, and lists ideas in
  their own column beside the cards; an initiative's menu is always shown, and Waiting on you is hidden while
  nothing waits.
- An Active agent's row shows its session's token total after the model, as a Conversations row does, updated each
  time a turn ends.
- In an agent's card and a conversation's transcript, your prompt pins to the top once its turn's reply scrolls it
  away, so you can see what the reply answers; click it to scroll back.
- A conversation's header is one compact row: title, status and project, branch, time and tokens on one line, with
  the way back to the terminal at its start.
- The agent pane's header is one row: the name, the harness's mark, its state, model and context, then the project,
  which truncates first; the harness's name is in the mark's tooltip.
- The Agent sidebar's Conversations lists only the projects you have added to arcterm; conversations from other
  folders stay in Conversation History, and a row under the list counts them and opens it.
- Conversation History has no page-wide header any more: the list column heads itself with the way back, the title,
  the live count and the status filter, beside the conversation's own header, so the transcript starts higher.
- Conversation History always lists every project, whichever one the app bar has chosen; the project choice narrows
  the sidebar's Conversations only.
- Clicking a pinned prompt scrolls the transcript smoothly back to it instead of jumping, unless reduced motion is
  on, and a conversation's header buttons share one height, so the row is shorter.
- Clicking a pinned prompt while the agent is still writing scrolls back to it and stays there, instead of being
  pulled back to the newest output on every streamed line.
- Choosing a terminal while an agent is on screen opens it in a panel under the agent instead of in its place. Drag
  the panel's top edge to resize it, between 120 px and 60% of the column; its maximize button (or a double-click on
  its bar) gives it the whole area and back, and its x hides it while the shell keeps running.
  The right panel no longer lists terminals: the sidebar's Terminals section is where you switch between them.
- A row under Background tasks shows the command it runs, and a click opens the command's output in the panel's File
  tab; clicking again reads it afresh while the command is still running.

### Fixed

- Picking an answer in Claude's own question dialog in the terminal no longer comes back to Claude as "The user
  dismissed the question."
- A file path too long for its line in the terminal, such as a report path an agent prints, now opens with Ctrl+click
  instead of being split in two at the line break.
- A turn an agent finishes while arcterm is in the background now stays unread, even when that agent is the one on
  screen.
- A finished conversation's "done" mark sits level with its title in the header instead of above it.
- A run in Jarvis no longer repeats an agent's name ("X · X") when the agent has no task of its own.
- A question's option previews keep the agent's mockups as drawn: each line and space in a monospace box, below the
  options in a narrow pane and beside them in a wide one, where they had wrapped into a paragraph.
- A pasted image is listed in the right panel's Uploads as `Image #N`, the number Claude Code shows in its
  prompt, as soon as you paste it, on any surface, instead of as Pasted image until the prompt is sent.
- A prompt sent with a pasted image shows the image, in an agent's card and in a conversation's transcript, instead
  of only its `[Image #N]` label; click it to see it full width.
- A Claude Code conversation's token total counted a reply once per block it wrote (text, each tool call), often
  two or three times too high; it now matches the Usage numbers.
- Terminal text a TUI draws on its own background, such as your past prompts in Claude Code, is lifted to
  a readable contrast instead of grey on grey.
- `Ctrl`+`Tab` pressed while typing in an agent's terminal keeps you typing in the next agent's terminal, instead of
  dropping the keyboard until you click it.
- `↑` / `↓` move between agents on the Agent surface, as the hints bar always said; `←` / `→` and `j` / `k` still work.
- `Ctrl`+`Tab` and the agent keys step through the Active list as it reads, top to bottom. They used to follow the
  Cockpit's order, which was stale until you opened the Cockpit, so an agent started since then was skipped.
- An image you paste into an agent's prompt and then delete before sending leaves Uploads once the prompt goes out
  with images, instead of staying listed.

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
- The Agent panel's details rail counts its lists (subagents, files changed, artifacts, uploads, background
  tasks) in the tab strip, each count opening its section, and opens on one status line: context, tokens
  and the session's spend.
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
