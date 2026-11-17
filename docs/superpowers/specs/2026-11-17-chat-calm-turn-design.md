# Chat: a calmer turn, a file card at its end, and a one-line box

Follow-up to `2026-11-17-chat-compact-work-design.md` (shipped in `39dd6cd91`). The person looked at the result next to
Claude Desktop and found a working turn "rất rối": "Ran a command · 5s" four times between paragraphs, the running call's
words three times on screen, a running stretch opened as a growing box, and a time on every line.

Canvases (gitignored, main checkout):

- `.superpowers/design/chat-compact-work/project/`: `Calm.dc.html` is this turn redrawn (sections 1 to 5);
  `States.dc.html` was updated to the new running and time rules; `Main.dc.html` stands as built.
- `.superpowers/design/chat-compact-composer/project/Main.dc.html`: the one-line box (section 6), four states.

Where a board and this text disagree on a look, the board wins.

## 1. A stretch of one command reads by its description

A stretch whose only call is a command with a description reads as that description, as the agent wrote it:
"Checked the working tree after the restart", not "Ran a command". It is what Desktop does ("Typechecked the frontend";
a stretch of several calls stays counted: "Ran 2 commands, edited hand-checks.md +5"). A command with no description
keeps "Ran a command". The line stays muted when the command failed (the earlier rule: no red on a folded line); the row
inside keeps its exit mark. In `chatstepsummary.ts` `stepSummary`; the description is the row text `chipsOf` already
gives (`kind === "description"`).

## 2. A running stretch stays folded, and says the description as written

- A running stretch is one line with the spinner in front and the time counting up, folded (`›`). It no longer opens on
  its own while the agent works: `autoOpen` in `chatconversation.tsx` (the `case "work"` branch) goes, so
  `burstRenderMode` only follows the person's click. A click opens it as today, the running row ending in its spinner.
- The running line says a described command's description as written: `doingText` drops its rewrite of a leading
  Run/Ran to "Running" ("Running verify on packages…" was broken English for an imperative description). A call
  with no description keeps the present-tense verb ("Reading server.js", "Running npm test").

## 3. The Working line does not repeat the running call

The line under the conversation (`data-chat-working`, `chatpane.tsx`) reads "Working" and its stats
("Working (4m 8s · ↓ 6k tokens)"), without " · <activity>" or " · <running tool's target>": the stretch's own running
line names it. `workingLine` / `workingText` in `chatmodel.ts`; "Compacting…" stays as it is.

## 4. No time under 10 seconds on a finished line

A finished stretch's line shows `· time` only from 10 s up; under that it shows none. A running line always counts
("· 3s"). `stretchTime` gets the threshold (or `ChatSteps` applies it); the row-level rules are unchanged.

## 5. A card of the files the turn changed, at its end

When a turn has finished (its item is no longer the live last one) and its calls changed files, one card follows the
turn's last part, as Desktop's "Changed N files" card (the earlier spec's out-of-scope item, now wanted; the per-stretch
chips stay gone).

- **Content:** every file a successful edit or create in the turn touched, once, in the order first touched, with its
  `+N −N` summed over the turn (`editCounts`). Failed or refused calls add nothing. Reads, commands and other tools add
  nothing (a command that wrote a file is not seen; that is fine).
- **Look** (`Calm.dc.html`, bottom): the box of section 3 of the earlier spec (1px `border-edge-mid`, radius 10px,
  hairline rows, 9px × 12px, 13px). Two files or more: a header row "Edited N files" in `text-secondary`, one row per
  file (a code or file icon, muted; the name in `text-primary`; its folder muted; `+N` green and `−N` red at the right),
  then a "See all" row with the turn's totals. One file: the single row alone, no header and no See all.
- **Clicks:** a file row opens the Diff on that file, `openDiff(model, agentDiffScope(agent.id, agent.name), path)`
  (`agentdiffnav.ts`); See all opens it on the agent's scope with no file, as the box's Show the diff chip does. The
  Diff shows the agent's working tree now, not this turn alone; the card's numbers are the turn's. With no agent around
  (a transcript of an ended session) the rows are plain text and See all is left out.
- **Undo** (Desktop has it on each row) is out of scope.
- A pure `turnFiles(parts)` (beside `chatsteps.ts` or in `chatmodel.ts`) with tests; `chatitemeq.ts` keeps the card
  from redrawing a finished turn.

## 6. The box: one line, with its controls outside

`chatcomposer.tsx` / `chatfooter.tsx`, drawn in `chat-compact-composer/Main.dc.html`:

- **Empty or one line of text:** one row 44px high: the round `+` menu at the left, the text in the middle, Send (Stop
  while the agent works) at the right. The placeholder is today's ("Reply to <name>"; "…; it waits for the turn to
  end" while working).
- **Several lines, an attachment, bash mode:** the box grows as today; the text and the attachments take the top and
  `+` and Send/Stop sit in a row at the bottom (the board's fourth state). The height spring stays.
- **The footer moves out of the box**, under it, right-aligned, as plain text with no pill borders: the model and
  effort ("Opus 5.5 High", effort muted), the permission mode, the context ring with its %. Each opens the same menu as
  today. The asleep words (Asleep / Falling asleep) go on that line too, at its left.
- **The chip line moves above the box:** the action chips (Show the diff, Open the terminal) while the agent works,
  the suggested replies after a turn (Tab, the picked chip's ↵, Replace & send all as today). The background-work line
  (`chatbgline.tsx`) stays at the box's top.
- Unchanged: the `/` and `@` menus, the drop zone, Esc, the send and wake paths, the Lexical editor.

## Left to the builder

- How the one-line row becomes the grown layout: measure the editor's height (one line vs more) or switch on
  attachments/bash mode; no jump when the second line starts (the spring covers it).
- The icon for a file row in the card (lucide `FileCode` for source, `FileText` otherwise, or one icon for all).
- Colours from the `@theme` tokens only (DESIGN.md); the boards' hex values map to the tokens the earlier build used.

## Testing

- Unit: `stepSummary` for a one-command stretch with and without a description, failed; `doingText` keeps a description
  as written; `stretchTime` / the line under and over 10 s; `workingText` without the activity tail; `turnFiles` (one
  file, several, a file edited twice, a failed edit, a create).
- CDP `agent-chat` (`scripts/cdp/scenarios.mjs`): a one-command stretch reads its description; the running stretch is
  folded with its spinner; the Working line has no " · …" tail (the step near line 44220 asserts the activity in it
  today and changes); a finished turn ends in the file card, and a click on a row opens the Diff on that file. Matching
  `Calm.dc.html` and `States.dc.html`.
- CDP `chat-redesign` (`scripts/cdp/scenarios-chat-redesign.mjs`): the empty box is one row 44px high with `+`, text and
  Send; the model, mode and context sit under the box; the action chips and suggested replies sit above it; a
  multi-line text moves `+` and Send to the bottom row. Matching `chat-compact-composer/Main.dc.html`. (Steps 14c and 15
  of this scenario already fail on `main`; leave them or fix them, but say which.)
- `CHANGELOG.md`, `Changed`: one line for the calmer turn and the file card, one for the one-line box.

## Out of scope

- Undo on the file card; a mic button; image thumbnails on a line; red "Failed" on a folded line.
- Grouping adjacent one-command stretches across the agent's paragraphs.
