# Chat: a worded summary line for a stretch of tools

Date: 2026-11-17. From the brainstorm `.superpowers/brainstorm/chat-compact-work/brainstorm.json`.

Sections 1 and 2 shipped in run d2391971 (`b0766bf`: `chatstepsummary.ts`, the fold's sentence, commands by their
description). Sections 3 and 4 are what is left; build them on top of that.

## Intent

Chat folds each stretch of tool calls into one line, "Worked for 38s · 5 tools". That line says how long and how
many, not what happened, so you open it to find out. Claude Desktop's chat words the same line as a sentence ("Edited
server.js, ran a command +5") and shows a command by its description instead of its shell text. Chat takes those two
things and nothing else from Desktop.

## Today

- A stretch of tools is a `work` part (`chatmodel.ts`, `compacttimeline.ts` `groupCompact`).
- `ChatSteps` (`frontend/app/view/agents/chatstepsview.tsx`, around line 518) draws its fold button as
  `workedFor(durationMs)` (or `workingFor(...)` while running) `· toolCountLabel(n)`. A running stretch opens by
  itself; a finished one opens on click into one row per call (`chatsteps.ts` `stepOf`, `stepRows`).
- Each row's verb comes from `KNOWN` in `chatsteps.ts` (Read, Edit, Write, Ran, Search, Find, Fetch, Web search,
  Spawned, Skill, Asked, Blocked); a verb not in the table is worded by `plainVerb`.
- A Bash row's chip is the command's first line: `firstLine(d.command ?? target)` once the result has landed, and
  `firstLine(target)` before that. The Claude projection already sets the action's `target` to the tool's
  `input.description` (`transcriptprojection.ts` around line 76), so the description is there; Chat does not show it.
- After the stretch, a `files` part shows one chip per edited file ("session.ts +4 −1").

## What Claude Desktop does (reference)

Screenshots in `.superpowers/design/chat-compact-work/ref/` (gitignored, local to the main checkout):
`cd-p01.png` folded, `cd-p02.png` and `cd-p08.png` a group opened, `cd-p06.png` a command opened,
`cd-p03.png` and `cd-p07.png` a file and a diff in the side panel.

- The summary is muted text with only the first verb capitalised, clauses joined by commas: "Read 3 files, searched
  for files, ran skill", "Created server.test.js, ran a command +21", "Ran 2 commands". `+N` is green, then a chevron.
- Clauses are not in the order they happened: creates and edits come before "ran a command".
- Desktop shows no time anywhere. **Chat differs here on purpose** (below).
- Desktop groups adjacent commands under "Ran N commands" and ends a turn with a "Changed N files" card.
  **Both are out of scope.**

## Design

### 1. The summary line (replaces "Worked for 38s · 5 tools")

A finished stretch reads as a sentence, the `+/−` counts, then the time, muted, at the end:

> Edited server.js, ran 2 commands, read 5 files +5 −2 · 38s

- **Clause order:** the clauses that change something come first (edit, write, run a command, spawn), in that order;
  then everything that only looked (read, search, find, fetch, web search) merged into one clause at the end.
  Not in the order the calls happened.
- **Counting:** one file names it ("Edited server.js"); several count ("Edited 3 files"). Commands always count
  ("ran a command", "ran 2 commands"). The look-only clause counts what it can ("read 5 files"; with searches mixed in
  the builder words it, e.g. "read 5 files and searched 3 times" or "explored 8 files").
- **Case:** only the sentence's first word is capitalised; the rest of the verbs are lower case, as Desktop does.
- **Counts:** the stretch's added and removed lines (`editCounts` summed over its edits): `+5` in the add colour,
  `−2` in the delete colour, `−` shown only when something was removed, nothing when the stretch edited nothing.
- **Time:** `· 38s` at the end, muted, as `stepElapsed`/`workedFor` format it today.
- **Running:** while a call in the stretch is in flight the line says what it is doing and counts up:
  "Running npm test · 12s" (the in-flight call's verb in the present tense plus its row text, a command by its
  description, below). The timer is the one `workingFor` uses today. With several calls in flight at
  once (parallel reads, spawns, a background command), the line names the latest one to start and adds the rest as
  "+N": "Running npm test +2 · 12s". (Agent's call, builder question 2.)
- **Failed calls (builder question 1):** only calls that succeeded count in the sentence; a failed call (an Edit that
  missed, a refused command) stays out of it, and keeps its red on its own row once the stretch is opened. The folded
  line stays free of red. A stretch in which every call failed reads by what it tried: "Tried to edit server.js".
- **Too long:** one line, cut with `…` (CSS `truncate`), never wrapped. The counts and time stay visible: truncate the
  sentence span only.
- The auto-open while running stays. How the opened stretch looks changes (section 3), and the file chips after it go
  (section 4).

### 2. Commands by their description

A Bash row shows its description ("Confirmed the server is no longer running") as the row text instead of the command's
first line, both before and after the result lands. The real command shows when the row is opened, at the top of the
detail, as `ToolDetailBody` already does. A call with no description (the target is the command itself, or empty)
falls back to `firstLine` of the command as today. The running summary uses the same text.

### 3. The opened stretch: a bordered box, as in Claude Desktop

Built from the canvas `.superpowers/design/chat-compact-work/project/` (`Main.dc.html` the whole turn, clickable;
`States.dc.html` running, failed, all failed, too long, a command with no description, other tools). Desktop's
`cd-p02.png`, `cd-p06.png` and `cd-p08.png` are the reference.

- The summary line is the fold button: muted text at 13.5px, `+N` green and `−N` red, `· 38s` muted, then a chevron
  after it (`›` folded, `˅` open). No caret in front of the line. While running, a small spinner sits in front of it and
  its text is `text-secondary`, as `States.dc.html` draws. Where this spec and the canvas disagree on the line, the
  canvas wins. (Agent's call, builder question 3; this replaces the earlier `text-[12px] text-muted`.)
- Opened, the rows sit in one box under the line: 1px `border-edge-mid`, radius 10px, no background of its own, rows
  divided by 1px `border-border` hairlines, each row 9px × 12px padding, 13px. The box starts at the line's left edge
  (no 28px indent).
- A file-like row (read, edit, create, search, fetch, spawn, skill, an unknown tool) is the verb muted, then the target in
  `text-primary` as plain text (no chip frame, no file icon), then muted meta (`· 8 files`), then `+N` green, then a
  muted `›`. Rows have no tool icons and no per-row time.
- A command row is its description alone in `text-secondary` (a command with no description: the first line of the
  command in mono), then `›`. Opened (chevron `˅`), under it inside the box: `$ <command>` in a mono code block
  (`bg-surface-code`, radius 6px), then the output in a mono box that scrolls, capped at today's 320px. This is a
  renderer of Chat's own; `ToolDetailBody` and the live feed stay as they are. A nonzero exit keeps today's `ExitMark`
  at the row's end (a command row has no verb to turn red), and the opened detail keeps a small muted "Open full view"
  under the output, to `AgentToolDetailModal`. (Agent's call, builder question 2.)
- **Opening a file:** a file row's target is a `PathLink` that looks like the plain bright text the canvas draws
  (underline on hover only): clicking the name opens the file in the agent's File tab, as the file chip's arrow does
  today; clicking the rest of the row opens its detail in place (the diff for an edit), as today. With no opener (a
  transcript with no agent around it) the name is plain text. `FileChips`, the `files` part and CDP steps 5 and 5b go
  with section 4; a CDP step clicks a row's file name instead. (Agent's call, builder question 1: the File tab opens the
  file, not one call's diff, so making the whole row open it, as Desktop does, would lose the inline diff, and a
  transcript with no opener would have no way to open a row at all.)
- A running row ends in a small spinner instead of `›`. A failed row says so in red in its verb ("Edit failed") with the
  error as its muted meta; the summary line never turns red.
- Repeated calls on one file keep today's merging into one row (`stepRows`): the verb, the target, a muted `×4`, the
  summed `+N`, then `›`. Opened, its calls are sub-rows in the same box, indented 24px, divided by the same hairlines,
  each with its own chevron; no box inside the box. (Agent's call, builder question 4.)
- Row verbs are past tense, as the canvas draws: Read, Edited, Created, Searched, Found, Fetched, Searched the web,
  Spawned, Ran skill, Asked, Blocked, Used `<tool>`; a running row the present tense ("Reading"), a failed one
  "`<Verb>` failed" ("Edit failed"). `stepOf`/`foldOf`, their tests and the CDP text assertions change with them.
  (Agent's call, builder question 4.)
- Hover: a row's background goes to `bg-surface`; the summary line's text to `text-secondary`.

### 4. No file chips after a stretch

The `files` part's chips after each stretch ("session.ts +4 −1") go: the stretch's create and edit rows carry the
file and its `+N` already. The canvas's `fileChips` tweak is off. The time stays on the line (`showTime` on), unlike
Desktop.

### Left to the builder

- Put the sentence in a new pure function beside `chatsteps.ts` (for example `stepSummary(actions, live)`), with
  tests in `chatsteps.test.ts` or its own test file. `ChatSteps` calls it in place of `workedFor` + `toolCountLabel`;
  leave `compacttranscript.tsx` and any other user of those two helpers as they are.
- The past-tense verb for each `KNOWN` entry (Edited, Wrote/Created, Ran, Read, Searched, Found, Fetched, Searched the
  web, Spawned, Used skill, Asked, Blocked) and the present tense for the running line.
- Where `skill`, `asked`, `blocked` and verbs with no `KNOWN` entry go: a changing clause or a trailing one
  ("used 2 tools"). They must never drop out of the sentence silently.
- Telling a description from a command: `target !== command` (and non-empty) when the detail has `command`; with no
  detail yet, the Claude projection's target is the description. Check the pi/codex/agy/opencode projections' Bash
  targets so a projection whose target is the command still falls back to `firstLine`.
- Colours from the `@theme` tokens only (DESIGN.md); the line keeps today's `text-[12px] text-muted`.

## Testing

- Unit: the summary for a stretch of only reads, only one edit, edits plus commands plus reads (the clause order),
  one file versus several, a stretch with removed lines, a running stretch, an unknown verb, and the Bash row text
  with and without a description.
- CDP: the `agent-chat` scenario in `scripts/cdp/scenarios.mjs` asserts the fold reads `/^Worked for .+ · 2 tools$/`
  (around line 44105); change it to the new sentence for its fixture, and keep its screenshot of the fold, folded and
  opened. That scenario is the on-screen check for a Final.
- `CHANGELOG.md`: one `Changed` line ("Chat sums up each stretch of tools in words, and shows commands by their
  description").

- Sections 3 and 4 (CDP): the `agent-chat` scenario shows the opened box with a command opened (`$ cmd` and its
  output), matching `Main.dc.html`, and that no file chips follow a stretch; a step shows a running stretch and a
  stretch with a failed edit opened, matching `States.dc.html`.

## Out of scope

- Grouping adjacent commands under "Ran N commands".
- A "Changed N files" card at the end of a turn.
- Opening a read or an edit in a side panel instead of inline.
