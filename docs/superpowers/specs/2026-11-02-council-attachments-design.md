# Images and @file in the council composer

Status: design, 2026-11-02. Brainstorm: `.superpowers/brainstorm/council-attachments/brainstorm.json`.

## Intent

The council's message boxes (the channel's and a thread's) can send images (paste, drop) and name project files
with `@`, as the New dialog's Task box already can.

## What exists today

- The New dialog's Task box takes a pasted or dropped image through `launcherstore.ts` `addTaskImages`, which writes
  it with `createTempFileFromBlob` / `createTempFileFromFile(f, true)` (`termutil.ts`, `WriteTempFileCommand` with
  `Keep` → `~/.arc/attachments`), into `launcherImagesAtom` (`TaskImage`, pure helpers in `launcherimages.ts`:
  `imageFilesOf`, `imageRoom`, `imagesPending`, `MAX_TASK_IMAGES`).
- `frontend/app/view/agents/composerattachments.ts` (`useComposerAttachments`, used by no view today) writes without
  `Keep`, to the OS temp dir the 24-hour sweep empties; its `isOversize` / `MAX_ATTACHMENT_BYTES` hold the 10 MB limit,
  and `appendAttachments` adds an "Attachments (read these files):" block of paths to a text.
- `frontend/app/view/agents/launcheragentfields.tsx` `useFileMention`: the New dialog's `@` lists the project's files
  (`reloadFileIndex` in `view/code/codestore.ts`; `fileMentionAt` / `fileMentionMatches` / `insertFileMention` in
  `launchermention.ts`).
- The council composer (`councilchat.tsx` `Composer`) already uses `@` to name a seat (`mentionPicker` /
  `insertMention`, `councilchatmodel.ts:833`), which narrows who answers.
- Expert seats are `claude -p` with Read/Grep/Glob only when the call has Tools on (`pkg/council/caller.go:73`). The
  person's reply carries `Tools`; the composer sets it only in a follow-up with the "Let them read files" switch on.
  Agent seats get the text as their next turn and have their own tools (`pkg/council/agentcaller.go:33`).
- `CouncilReply` (`pkg/council/types.go:119`) has no attachments field.
- The seat matcher counts an `@` followed by `/` or `.` as naming a seat: `@ux/x.tsx` or `@ram.go` narrows who answers
  to UX or RAM, in the frontend (`mentions`, `councilmodel.ts:366`) and in Go (`mentions`,
  `pkg/council/runner.go:1488`), whose end check only looks for a letter, digit or `_`.

## Design

### 1. Who can read an attachment

A message that carries an image or an @file is sent with Tools on, in a round or a follow-up, so every expert seat
that answers it can Read the file. While something is attached, the follow-up "Let them read files" switch shows on
and cannot be turned off, and the cost estimate counts the reading. Agent seats read with their own tools as before.

### 2. `@` for seats and files

`@` opens one list with the matching seats in a Seats group on top and the matching project files (the council's
project folder, `Council.project`) in a Files group under it; the arrow keys move across both groups. Picking a seat
narrows who answers, as today; picking a file inserts its path (`@<path relative to the project>`).

The seat matcher, in the frontend (`councilmodel.ts` `mentions`) and in Go (`pkg/council/runner.go` `mentions`),
stops counting an `@` followed by `/` or `.` as naming a seat, so `@ux/plan.md` never narrows who answers to UX. Both
sides change together: the frontend's `answerers` must keep predicting the Go `To`.

**Agent's call (builder question 1): one grouped picker shared with the add-chat spec.**
`2026-11-02-council-add-chat-design.md` (not built yet) adds "Add a live chat" to the same `@` list. Whichever of the
two plans runs first builds the picker model as an ordered list of groups (each a kind and its rows) with one cursor
across them; the other adds its group. The groups run **Seats, then Files, then Add a live chat** (builder question
1, the person's answer): naming a file is the common act, and seating a new chat, which spends a turn, is the
furthest from the cursor. The two runs go one after the other (`wsh runs start --after`), since both
change `CommandCouncilReplyData` and regenerate the bindings.

**Agent's call: the two matcher changes do not overlap.** An `@` token holding `/` or `.` is a file and never a seat;
add-chat's rule (`@` and a whole word of 8+ characters that starts a seated chat's tab id) only ever sees hex ids,
which hold neither.

### 3. The box while composing

Both council boxes take a pasted or dropped image, as the New dialog's Task box does (`addTaskImages`, `TaskImage`): it
uploads with `Keep` to `~/.arc/attachments` and waits as a thumbnail chip above the text, with an x to remove it, a
spinner while it uploads and the error on a failed one (over 10 MB is refused before upload). Send waits while one is
still uploading. The placeholder adds "paste an image · @ for a file". The draft keeps its attachments with its text
(`councilChatDraftAtom`) when you leave the council and come back.

### 4. How an attachment reaches the seats

- The person's reply gets an `attachments` list of absolute paths beside its text: `Attachments []string` on
  `pkg/council` `CouncilReply` and on `wshrpc.CommandCouncilReplyData`, then `task generate`. No text parsing is
  needed to draw them.
- An @file stays in the text as `@<path relative to the project>`.
- The prompt a seat gets for that reply ends with "Attachments (read these files):" and the image paths; an @file's
  path is read relative to the project, the expert's cwd.
- A reply with attachments or an @file is sent with Tools on, and the backend forces it too
  (`CouncilReplyCommand`), so an older client or `wsh` cannot send one a seat cannot read. "Has an @file" uses the
  same rule as the matcher: an `@` token holding `/` or `.`.
- **What an expert may read (builder question 2, the person's answer): only that image's own folder.** Each kept
  paste already gets its own folder, `~/.arc/attachments/<date>-<random>/<name>` (`WriteTempFileCommand`,
  `wshserver_files.go:97`). An expert call with attachments adds `--add-dir` for each attached image's own folder,
  nothing wider (`consult.CallOpts` / `ClaudeArgs` grow an `AddDirs` list; `CallReq` carries it from the reply). Without
  it a `claude -p` run with the project as cwd is refused a Read outside it. `CouncilReplyCommand` accepts an
  attachment only when it is an existing file directly in an upload folder under `~/.arc/attachments`, and refuses the
  reply otherwise. Test: a reply naming a path elsewhere is refused; the expert call's args hold exactly the attached
  images' folders.
- An agent seat gets the same text, block included, as its next turn. **Agent's call:** it reads the paths with its
  own permissions, so a chat started in another folder may ask in its own terminal before reading one.

### 5. How the sent message shows them

Images show as small thumbnails under the message's text; a click opens one full size. Each @file shows as a chip,
drawn in place of its `@path` in the text, that opens the file (as the evidence chips under a seat's message do). The
image paths stay out of the bubble.

## Left to the builder

- Thumbnail size and how many show before a +N.
- The two-group picker: the group headings, which group the cursor starts in (Seats when any match), Tab and Enter
  picking the row under the cursor.
- Reusing `launchermention.ts` and `composerattachments.ts` as they are, or lifting shared parts out of the launcher.
- Tests: the seat matcher on `@ux/x.tsx` and `@ram.go` in `councilmodel.test.ts` and the Go runner tests; the picker
  model; the prompt's attachment block; the backend forcing Tools; a CDP scenario that pastes an image into the
  council box, sends it, and shows the thumbnail in the bubble.
