# Agent rail tabs (Overview, Review, File), path links, and a regrouped nav rail — design

Status: approved design 2026-10-06, not implemented. Phase 1 is everything below except the last section; phase 2 is
the Terminal tab. Mockups (gitignored, deleted when each phase ships): `.superpowers/design/agent-rail-tabs/` (phase
1), `.superpowers/design/agent-rail-terminal/` (phase 2).

## Problem

Reading what an agent changed or opening a file it names means leaving the Agent surface:
- A file in the rail's Files changed section opens the Diff surface.
- A file path printed in a terminal or a transcript is plain text. Only `http(s)` URLs are links in the terminal
  (`termwrap.ts`, where Ctrl+click opens a browser).
- Every "open file" route (`openInCode`: the command palette, the Diff surface, Radar) switches to the Code surface.

VS Code and Antigravity keep this next to the conversation, in a side panel. The user wants the same:
- The Agent surface's right rail becomes a tabbed panel: **Overview**, **Review** and, while a file is open, **File**.
- A file path anywhere an agent's work shows up opens there.

With that panel, Code and Diff become tools you reach for now and then, beside Radar. The surfaces used all day are
Cockpit, Jarvis, Agent and Usage, so the nav rail is regrouped to say so.

Out of scope:
- The Code and Diff surfaces' content. They stay reachable unchanged, and the panel links out to them for anything it
  does not do.
- Showing the rail in canvas, Doc review, History or session mode.
- Editing in the panel. The File tab is read-only; "Open in Code" edits.
- More than one open file per agent. The File tab has back/forward instead.
- Line comments on a diff, and a side-by-side diff in the panel.
- Path links in the folded "edited N files" row and in the tool-detail modal; a session read from disk with no live
  agent (its paths stay text).
- New global key chords for the tabs.

## The panel

1. **The rail is a tab strip.**
   - Overview (`LayoutList`) and Review (`FileDiff`, followed by the changed-file count) are icons with no text label.
     The header's `Terminal | Canvas | Review` switch already uses "Review" for Doc review. Each has an `aria-label` and
     a tooltip.
   - The File tab, present only while a file is open, is shaped like an editor tab: a file icon, the file name (Inter,
     truncated at 190px) and a close button.
   - The strip replaces today's bare collapse row, keeps its 44px height and bottom rule, and ends with the collapse
     chevron.
   - The selected tab is marked by a 2px `primary` underline and `primary` ink, the others `muted`: the same treatment
     as the Cockpit's status tabs.
2. **Only agents get tabs.** A focused plain terminal keeps today's `TerminalRail` (its Terminals section alone).
3. **Overview is today's rail.** It keeps the same sections, order and persistence (`agentrailsections.ts`). One change:
   a row in Files changed, and its footer link (now "Review ›" instead of "View diff ↗"), open the Review tab with that
   file selected instead of leaving for the Diff surface.
4. **Review is line review, scoped to the agent.** The Diff surface is getting a Review mode
   (`docs/superpowers/specs/2026-10-06-line-review-design.md`): every changed file in one scroll, unified rows rendered
   by `reviewlist.tsx`, line and range comments, and a tray that sends them to the agent as one message. The panel's
   Review tab renders that same list and tray, not a second diff view.
   - Scope: the agent's uncommitted changes, `GitReviewPatchCommand` with the agent's working directory (the worktree,
     for a worktree agent) and no hash. The tray sends to this agent.
   - Drafts are line review's, keyed by repository (`lineReviewAtom(repoKey)`). A comment drafted in the panel is still
     there in the Diff surface's Review mode for the same repository, and the reverse.
   - Above the list, a toolbar: `N files · +A −D` and "Open in Diff ↗". That opens the Diff surface on the agent's scope
     in Review mode (`openDiff(model, agentDiffScope(…))`).
   - A file header's name opens the file in the File tab.
   - The tab's count is the number of changed files (Files changed's count).
   - An ended worker has no live working tree: Review lists its sealed files (`SealedFiles`) and a row opens the Diff
     surface, as Overview does today.
   - With a subagent open, Review shows the parent agent's changes.
   - **Order:** this tab is built after line review has landed, and it reuses that work without changing it. Everything
     else in phase 1 (the strip, Overview, File, path links, the nav) does not wait for it. Until it lands, the Review
     icon is not shown and Files changed keeps opening the Diff surface.
5. **File is a read-only view of one file, at a line.** It appears as a tab when a file is opened into the panel and
   goes away when you close it, returning to the tab you were on before.
   - Header: Back/Forward over the files opened into this agent's panel, the path (directory muted, name, `:line`) and
     "Open in Code ↗" (`openInCode` with the line).
   - Body: a read-only Monaco editor (model URIs prefixed `file/`), scrolled to the line. The line gets a grey fill
     (`surface-hover`) and a 2px accent marker on its left edge.
   - The file is read with `FileReadCommand`, capped at `MAX_DIFF_BYTES`. A binary or larger file shows its size and
     "Open in Code" instead.
   - One file per agent, held in memory with its history. Opening another file replaces it and pushes the old one onto
     Back.
6. **File paths become links.** A pure tokenizer (`pathlinks.ts`) finds path candidates in a line of text: absolute or
   relative, with an optional `:line`, `:line:col` or `(line,col)`. It strips surrounding quotes, brackets and trailing
   punctuation. Each source resolves a relative path against a directory and opens the result:
   - **Terminal output.** An xterm link provider (`registerLinkProvider`, beside the existing `WebLinksAddon`) offers
     the candidates of a hovered line, resolved against the block's `cmd:cwd`. In a shell, OSC 7 keeps `cmd:cwd`
     current (`osc-handlers.ts`). It checks each candidate once with `FileInfoCommand` (cached), and only files that
     exist underline.
     - Ctrl+click (Cmd on macOS) opens a file, as it does a URL. Hovering shows "Ctrl + click to open <name> at line N".
     - An agent's TUI opens the file in that agent's panel. A plain terminal has no panel, so it opens the file in the
       Code surface at the line (`openInCode`, or `openFileInCode` with a line for a file outside the terminal's
       directory).
   - **Transcripts and Cockpit cards.** The path in a file tool's row (Edited, Read, Wrote) is a link of its own; a click
     on the rest of the row still opens the tool detail. The projectors keep the tool's full path beside the base name
     they show, for the file tools only: a directory-taking tool (ls, grep, find, glob) has no link. Inline code in an agent's message is a link when the tokenizer
     accepts it as a path. Both resolve against the agent's working directory and check the file on click.
     - From a Cockpit card, the click selects the agent and switches to the Agent surface the way `openref.ts`'s agent
       route does (`jumpToAgent`), then opens the file.
   - **Review.** A file header's name (decision 4).
   - **Command palette.** A file pick while the Agent surface shows a focused agent whose working directory holds the
     file opens it in that agent's panel. Anywhere else it opens the Code surface, as today.
   - A link to a file that does not exist never opens a tab. A toast says "File not found: <path>" (`pushToast`).
7. **Widths.** Overview stays 300px. Review and File share one width.
   - The width defaults to 520px and is dragged on the panel's left edge.
   - It is clamped between 360px and whatever leaves the centre `stage-min` (640px), and persisted as
     `agent.rail.wideWidth`.
   - The width change between Overview and a wide tab is not animated: one layout commit is one PTY resize for the
     centre's terminal.
8. **Persistence.**
   - The selected tab is per agent, so returning to an agent finds the tab you left it on. Overview is the default.
     Selections live in a jotai atom keyed by agent id, and the last choice is persisted (`agent.rail.tab`) as the
     default for agents not seen yet.
   - File is never restored after a restart.
   - The selected file in Review, and the open file with its history, are kept in memory per agent.
9. **Collapsed strip.** The 44px strip shows the tab icons above today's needs badge and context gauge. Review carries
    its count as a badge, and File appears while a file is open. An icon opens the panel on that tab. `d` still toggles
    the panel.
10. **Keyboard.**
    - The strip is a WAI-ARIA tablist: Left/Right (and Home/End) move between tabs while it has focus, and Enter or
      Space selects.
    - In Review, the comment keys are line review's own: inside a comment box, Ctrl+Enter adds and Esc cancels. With
      focus in the panel and outside a box, Ctrl+Enter sends when the tray can send.
    - Escape in the File tab closes the file.
    - The cockpit's key dispatcher runs on window capture, before any component, and the Agent surface's own bindings
      (the arrows and j/k between agents, Esc back to the Cockpit, `d`) would take these keys first. So the tab strip,
      the File tab and the resize grip are marked `data-owns-keys`, and focus inside one counts as `editable` for the
      dispatcher, as a text field does. The Agent bindings stand down there.

### States

| Tab | State | What shows |
|---|---|---|
| Review | rail state not loaded | skeleton lines |
| Review | not a git repository | "Not a git repository" and the directory |
| Review | no changes | "No uncommitted changes" and "History in Diff ↗" |
| Review | line review not landed yet | no Review icon; Files changed opens the Diff surface |
| Review | binary, too large, renamed without changes | line review's reason for that file (`FileView`) |
| Review | ended worker | its sealed files; rows open the Diff surface |
| File | reading | skeleton lines under the header |
| File | binary or too large | its size, "The panel shows text files up to 2 MB.", and "Open in Code" |
| File | deleted since it was opened | "This file no longer exists" and Close |
| any | panel collapsed | the 44px strip of tab icons |

## The nav rail

11. **Two groups.**
    - The core surfaces, Cockpit, Jarvis, Agent and Usage, keep today's 56px items.
    - A 1px `edge-mid` separator follows them, then the tools: Code, Diff and Radar. Tool items are shorter (8px vertical
      padding instead of 11, about 46px) with a 16px icon; their labels keep today's size.
    - Setup and Settings stay at the bottom, unchanged.
    - On the narrow rail (56px) the separator stays and labels are hidden, as today.
12. **The order is the shortcut order.** `SURFACE_ORDER` becomes cockpit, jarvis, agent, usage, code, files, radar.
    `Ctrl+1..7` and `[` / `]` follow it, so Usage moves from Ctrl+7 to Ctrl+4, and Code, Diff and Radar to Ctrl+5..7.
    `docs/keyboard-shortcuts.md` and the surface-order tests follow. The `g` chords do not change.
13. **Code and Diff in the nav are re-measured around 2026-10-20.** That is two weeks of the panel, and comes after the
    brief's 2026-10-15 re-measure of Code's "Send to agent" (`docs/superpowers/briefs/2026-10-01-antigravity-adk-feature-scan.md`).
    If they are reached almost only through the panel's "Open in…" buttons, the palette and `g b` / `g f`, they leave
    the nav rail. The item goes in `docs/deferred.md`.

## Code shape

- `agentrailtabs.ts` (pure, tested): the tab type, the per-agent selection with its fallback, the wide-width clamp, the
  Review count, and the File tab's history (open, back, forward, close).
- `pathlinks.ts` (pure, tested): the path tokenizer and resolution against a directory.
- `agentrailpanel.tsx`: the tab strip and the per-tab bodies. Overview renders today's `AgentDetailsRail` sections.
  `filetab.tsx` renders File. `reviewtab.tsx` renders line review's list and tray on the agent's scope.
- `termwrap.ts`: the path link provider. Narration tool rows and markdown inline code: the path links.
  `command-palette.tsx`: the file pick routes to the panel.
- `navrail.tsx` and `agents.tsx` (`SURFACE_ORDER`): the two groups.
- `dispatcher.ts`: `ownsKeys`, so a marked region's keys reach it. `openfilestore.ts`: `openFileInCode` takes a line.

## Verification

Unit tests:
- the pure modules above;
- the tokenizer, on real output shapes: `tsc` (`file.ts(12,5)`), `vitest`, `go test` (`file.go:12:5`), `eslint`, and
  Claude Code's tool lines;
- the new surface order and its Ctrl+N mapping.

A CDP scenario, `agent-rail-tabs`, run on the dev app by the session that started the engine run, after the run lands
(the user's choice: no Final line, so no cold build inside the run).

Its fixture:
- a temp git repo, registered as a project, with `a.txt` modified;
- three files outside the repo: a 3 MB text file, a binary and one that is deleted mid-scenario;
- an agent whose transcript edited `a.txt`, names `a.txt:3` in a message, and read the three files;
- a plain terminal. Its shell starts in `~`, because a shell in a temp dir locks it until the app exits. It prints
  `a.txt`'s absolute path, with forward slashes, followed by `:2`.

The scenario checks:
- Overview: the strip alone, at 300px, and Files changed listing `a.txt`.
- Links from a Cockpit card: the tool row's `a.txt`, then the inline `a.txt:3`, each opening the File tab, at the wide
  width and on the line.
- The File tab's states: too large, binary, and deleted since it was opened. Back and Forward.
- The tab strip's → and the File tab's Esc, with the surface left where it was.
- The grip: a 100px drag left, then Home and End.
- The collapsed strip's icons, and reopening on File from one.
- A palette pick of `a.txt` on the Agent surface.
- The plain terminal. A real mouse hover over the printed path shows its hint, and a real Ctrl+click opens the Code
  surface at line 2. A DEV-only hook (`window.__arcTermPathLinks.locate`) gives the link's screen position, because
  the terminal draws to a canvas.
- The nav: its order, the divider, the tool items' shorter height, and Ctrl+4 opening Usage.

Not covered: the File tab's loading skeleton, which lasts one read. The Review tab's checks come with its own plan.

## Phase 2: the Terminal tab

Kept here so phase 1 leaves room for it. Not designed further until phase 1 has shipped.

- A third icon tab, Terminal (`SquareTerminal`), showing **side terminals**: a shell of the panel's own. Every
  terminal and agent with a block already has a pane mounted in the centre stack, and two term views on one block
  would fight over the PTY size, so the panel never shows a centre terminal.
- A side terminal is an ordinary shell block in a workspace tab, created like a terminal launch (`cockpit-actions.ts`).
  Its tab carries a new meta key, `session:sidepanel` (the cwd string), which keeps it out of the roster and the tree's
  Terminals section (`deriveTerminalVMs` skips it). This needs the key in the Go meta types and
  `task generate`.
- Side terminals are keyed by the agent's working directory. Opening the tab for a directory with none starts one; `+`
  starts another; the bin icon closes the selected one.
  - Pills name each by the command it is running (`shell:lastcmd` while `shell:state` is `running-command`), else by its
    shell.
  - An exit shows "Exited with code N" with Restart (`ControllerResyncCommand` with `forcerestart`).
- Side terminal panes never remount: every one keeps a `CockpitFocusPane` under a stable key in an always-rendered
  stack in `AgentSurface`. The stack sits outside `CollapsibleRail`'s `AnimatePresence` and outside the conditions that
  drop the rail; there it is hidden by CSS, never unmounted. It follows the grid's `min-w-0 min-h-0` rules.
- Terminal shares the wide width. A path Ctrl+clicked in a side terminal opens in the panel it sits in.
