# Images and @file in the council composer

**Spec:** `docs/superpowers/specs/2026-11-02-council-attachments-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council ./pkg/consult ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs council-discussion`

Built on top of the add-chat run (`2026-11-02-council-add-chat-design.md`), which landed first: its `mentionPicker`
returns `{ start, seats, chats }`, its `CommandCouncilReplyData` has `Agents`, and its composer lists "Add a live
chat" under the seats. This plan adds the Files group between the two (Seats, Files, Add a live chat).

## Shared rules every task follows

**A file mention** (the one rule, written once in TS and once in Go, identical): an `@` that does not follow a
letter, digit or `_`, then the longest run of letters, digits, `_`, `-`, `.`, `/` and `~`; trailing `.` characters
are dropped from the run (sentence punctuation); the token is a file mention when what is left holds a `/` or a `.`.
A seat or a chat is never named by an `@` that starts a file mention. Both the TS and the Go tests use this one
example table:

| Text | File mention (path) | Names |
|---|---|---|
| `@ux/plan.md` | `ux/plan.md` | nothing (not UX) |
| `@ram.go` | `ram.go` | nothing (not RAM) |
| `@./x` | `./x` | nothing |
| `@~/x` | `~/x` | nothing |
| `@3e19c0d2-a/x.ts` | `3e19c0d2-a/x.ts` | nothing (not the chat keyed `3e19c0d2-a`) |
| `@UX` | none | UX |
| `@UX.` | none | UX |
| `@UX..` | none | UX |
| `@UX,` | none | UX |
| `@3e19c0d2-a` | none | the chat keyed `3e19c0d2-a` |

**The attachment block** a seat's prompt carries for a person's reply with attachments, after the reply's text:

```
Attachments (read these files):
- <absolute path>
```

one `- ` line per attachment, in the reply's order. Nothing is added for a reply with none. The block is written only
in a prompt whose call runs with tools (and the image folders, below); a no-tools prompt that quotes the person's
reply (`SynthesisPrompt` and the like) quotes its text alone and never says "read these files".

**Reading is forced**: a reply with `Attachments` or a file mention is stored and answered with `Tools` on, whatever
the client sent, by whichever call answers it: a follow-up's `answerCall`, or round 2 when it was sent at the pause.

### Task 1: The attachments wire field
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/wshrpc/wshrpctypes_council.go`, `frontend/types/gotypes.d.ts`, `pkg/council/types_test.go`

The interface the backend and the frontend tasks build on; no behaviour.

- `CouncilReply` gains `Attachments []string \`json:"attachments,omitempty"\`` (absolute image paths the person
  attached; only on the person's replies), with a doc comment.
- `CommandCouncilReplyData` gains the same field, and its doc comment says the paths must be files the composer kept
  under `~/.arc/attachments` (one per upload folder) and that a reply carrying any is answered with Tools on.
- Run `task generate`; commit only the generated diff it makes (expected: `frontend/types/gotypes.d.ts`). Never
  hand-edit generated files.

Acceptance: `go test ./pkg/council -run 'TestNewFieldsLeaveAnOldCouncilsJSONAlone'` passes and asserts an old
council's JSON round-trips with no `attachments` key; `gotypes.d.ts` shows `attachments?: string[]` on both types.

### Task 2: The backend carries, checks and reads attachments
**Depends on:** Task 1 (uses the `Attachments` fields it adds)
**Files:** `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/caller.go`, `pkg/consult/consult.go`, `pkg/consult/consult_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`

Design decisions this task makes:

- **Seat matcher.** `mentions` / `mentioned` in `runner.go` (and the chat-key reading beside it, if it shares the
  scan) stop counting an `@` that starts a file mention (shared rule above). Add one Go helper for the rule, e.g.
  `fileMentioned(text string) bool`, used both by the matcher and by the forcing below.
- **Reply.** `Runner.Reply` takes the attachments (extend its signature or pass the reply data; keep add-chat's
  `agents`) and `appendPersonReply` stores them on the `CouncilReply`. `Tools` is forced on when the reply has
  attachments or `fileMentioned(text)`, in a round and in a follow-up alike.
- **Prompt block.** One helper in `prompts.go` writes a person's reply as its text plus the attachment block (shared
  rule) when the prompt is for a tools call, its text alone otherwise. Every place a person's reply is written into a
  tools call's prompt uses it: `AnswersPrompt` (the replies owed and the ancestor person replies it prints,
  `prompts.go` ~920), `askLine` in `round2PromptFor` (the asks owed at the pause), and the agent prompts
  (`agentPrompt` / the first and later agent turns). An agent seat gets the same block as its next turn and reads with
  its own tools. No-tools prompts (`SynthesisPrompt` and the like) keep the text alone.
- **Which person replies count.** One helper returns, for a call, every person reply its prompt carries (owed and
  ancestors alike). From those: `tools` is on when any has `Tools` (stored true when it had attachments or a file
  mention), and `AddDirs` is the attached images' own folders (`filepath.Dir(path)`), deduplicated, nothing wider. A
  call carrying none gets no folders.
- **Round 2.** `round2` (`runner.go` ~1115) calls `r.call(..., false)` today; it takes `tools` and `AddDirs` from the
  person replies its prompt carries (the asks owed, `unansweredFor`), and when tools are on, `round2Task` lets it read
  the attached files. A round 2 call with no such ask stays exactly as today.
- **What an expert may read.** `consult.CallOpts` gains `AddDirs []string`; `ClaudeArgs` appends one
  `--add-dir <dir>` per entry (after `--model`, before `--tools`), nothing when empty. `CallReq` gains `AddDirs`;
  `ConsultCaller.Call` passes it into `CallOpts`.
- **The server check.** `CouncilReplyCommand` passes `data.Attachments` on only after checking each one: an absolute
  path to an existing regular file whose parent folder sits directly in `keptAttachmentsDir()` (so
  `~/.arc/attachments/<folder>/<name>`, symlinks resolved before comparing, case-insensitive on Windows). Any other
  path refuses the whole reply with an error naming it. Keep the check a small pure function taking the root, so the
  test needs no home dir.

Acceptance (focused tests, all new unless named):
- `go test ./pkg/council -run 'TestMentionsSkipFileMentions|TestFileMentioned'`: every row of the shared example
  table, for `fileMentioned`, the seats reached and the chat seat reached.
- `go test ./pkg/council -run 'TestReplyForcesToolsForAttachments|TestReplyForcesToolsForFileMention|TestReplyStoresAttachments'`:
  a reply with attachments, or with `@a/b.md` in its text, is stored with `Tools: true` even when sent with false; the
  stored reply holds the paths.
- `go test ./pkg/council -run 'TestAnswersPromptAttachmentBlock|TestAgentPromptAttachmentBlock|TestRound2PromptAttachmentBlock|TestSynthesisPromptNoAttachmentBlock'`:
  a tools prompt ends the reply with the exact block, an ancestor person reply's included; a reply without attachments
  has none; the synthesis prompt quotes the text and holds no "read these files".
- `go test ./pkg/council -run 'TestCallAddDirsFromAttachments|TestCallAddDirsFromAncestorReply|TestRound2ReadsAttachedAsk'`
  (with the fake caller): the `CallReq` answering a reply with two images in two folders holds exactly those two
  folders and `Tools: true`; an answer whose prompt prints an ancestor person reply with an image holds that folder
  too; a round 2 call owing an ask with an image (sent at the pause) has `Tools: true` and its folder; a call with none
  holds none and round 2 without such an ask keeps `Tools: false`.
- `go test ./pkg/council -run 'TestConsultCallerPassesAddDirs'`: through the `runClaude` seam, `ConsultCaller.Call`
  hands `CallOpts.AddDirs` exactly the request's folders.
- `go test ./pkg/consult -run 'TestClaudeArgsWithModelAndTools|TestClaudeArgsAddDirs'`: `--add-dir` once per dir;
  absent when empty.
- `go test ./pkg/wshrpc/wshserver -run 'TestCheckCouncilAttachments'`: a file in `<root>/<folder>/` passes; a path
  outside the root, a file directly in the root, one two folders deep, a folder, a missing file and a relative path
  are refused.

### Task 3: The composer's pure model: file mentions, the Files group, the forced switch, the bubble's segments
**Depends on:** Task 1 (uses the generated `CouncilReply.attachments` in `replyPost`)
**Files:** `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`, `frontend/app/view/agents/councilchatmodel.ts`, `frontend/app/view/agents/councilchatmodel.test.ts`

Pure TS only; no view. Interfaces Task 4 relies on (names may be refined, shapes kept):

- `councilmodel.ts`: `fileMentions(text: string): { start: number; end: number; path: string }[]`, the shared rule
  above (path without the `@`). The seat matcher `mentions` (and `mentionsChat` if it would otherwise read the same
  `@`) skips an `@` that starts a file mention, so `answerers` / `replyReach` keep predicting the Go `To`.
- `councilchatmodel.ts`:
  - `mentionPicker(c, text, caret, chats = [], files: readonly string[] = [])` returns
    `{ start, seats, files: string[], chats }`. `files` are the project paths matching the query, by
    `fileMentionMatches` from `launchermention.ts` (reuse it, and its `MENTION_FILE_LIMIT`). A query holding `/` or
    `.` matches files only. The `MENTION` query regex lets a file query through (it already takes any non-`@`
    characters). The picker closes after a picked path and a space, as after a seat.
  - `pickerRows(picker)`: the one list the arrow keys walk, in order Seats, Files, Add a live chat, each row
    `{ kind: "seat", seat } | { kind: "file", path } | { kind: "chat", chat: ChatPick }`; the cursor starts on the
    first row (a seat when any match).
  - `insertFileMention` from `launchermention.ts` (or a thin wrapper) puts `@<relative path> ` in place of the `@…`.
  - `readsFiles(choice, text, attached = 0)` returns `{ on, why, locked }`: `locked` and `on` are true when
    `attached > 0` or `fileMentions(text)` is not empty (`why` names the first file, or "an image"); otherwise as
    today.
  - `messageSegments(text): ({ kind: "text"; text: string } | { kind: "file"; path: string })[]`: the sent message's
    text cut at its file mentions, for the bubble's chips.
  - `ReplyPost` (and whatever builds it from a `CouncilReply`) carries `attachments: string[]` (empty when none).

Acceptance: `npx vitest run frontend/app/view/agents/councilmodel.test.ts frontend/app/view/agents/councilchatmodel.test.ts`
with new cases: every row of the shared example table, for `fileMentions`, the seats reached (`answerers`) and the
chat reached (`mentionsChat`); the picker with seats, files and chats lists them in that order through `pickerRows`, a `foo/` query lists
only files, the picker closes after an inserted path and a space; `readsFiles` locks on for an attachment and for a file
mention; `messageSegments` cuts `see @ux/plan.md now` into text, file, text; a reply with attachments builds a
`ReplyPost` holding them. The existing picker and add-chat cases still pass unchanged; the existing `readsFiles`
`toEqual` cases (`councilchatmodel.test.ts` ~1377) change only to add `locked: false`.

### Task 4: The council boxes take images and @files, and the bubble shows them
**Depends on:** Task 1 (sends the `attachments` field it adds), Task 3 (uses the picker, `readsFiles`, `messageSegments` and `ReplyPost.attachments`)
**Files:** `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/councilstore.test.ts`, `scripts/cdp/council/discussion.mjs`, `scripts/cdp/council/fixtures.mjs`, `scripts/cdp/council/fixtures.test.mjs`, `scripts/cdp/council/rail-apps-room-attached.json`, `CHANGELOG.md`

Design decisions this task makes:

- **Images.** Both `Composer`s (channel and thread) take a pasted or dropped image the way the New dialog's Task box
  does: reuse `imageFilesOf`, `imageRoom`, `imagesPending`, `MAX_TASK_IMAGES` and `TaskImage` from
  `launcherimages.ts`, and write with `createTempFileFromBlob` / `createTempFileFromFile(f, true)` (`termutil.ts`,
  `Keep`). Refuse a file over 10 MB before upload (`isOversize` / `MAX_ATTACHMENT_BYTES` from
  `composerattachments.ts`), as an error chip. An image waits as a thumbnail chip above the text with an x, a spinner
  while it uploads and its error when it failed. Send is disabled while one is uploading. A drop of files with no image
  is ignored but never lets the webview navigate (`preventDefault` when the drag holds files).
- **Draft.** `CouncilChatDrafts` (`councilstore.ts`) keeps each box's images beside its text, keyed the same way as
  `texts` (`""` the channel, else the idea id), so leaving the council and coming back keeps them. A sent message
  clears its box's images. Pure draft helpers (add, patch, remove, clear) live in `councilstore.ts` with tests in
  `councilstore.test.ts`; preview object URLs are revoked on remove and clear.
- **@ list.** The composer passes the project's file list to `mentionPicker`: load it with `reloadFileIndex` from
  `view/code/codestore.ts` for `Council.project`, as `useFileMention` in `launcheragentfields.tsx` does (once per
  project; a failed load leaves the Files group empty, logged, never thrown). The list renders `pickerRows` in three
  groups with headings Seats, Files, Add a live chat; arrows move across all of them; Enter and Tab pick the row under
  the cursor; a file row inserts `@<relative path> `.
- **Send.** `replyCouncil` gets `attachments` (the ready images' paths) and `tools: true` whenever `readsFiles(...)`
  is on, in a round as in a follow-up. While `readsFiles(...).locked`, the follow-up "Let them read files" switch
  shows on and disabled, and the cost estimate is asked with `tools: true`. The placeholder adds
  "paste an image · @ for a file".
- **Bubble.** A person's message with attachments shows them as thumbnails under its text through `PromptImages`
  (`narrationtimeline.tsx`, `paths`), whose click opens one full size; the paths never appear in the text. Each file
  mention in the text renders as a chip in place of its `@path` (from `messageSegments`), opening the file the way
  the evidence chips under a seat's message open theirs.
- **CHANGELOG.** One `Added` line under `Unreleased`: images and @file in the council's message boxes.

Acceptance: `npx vitest run frontend/app/view/agents/councilstore.test.ts` (the draft helpers keep images per box,
clear them on send, revoke previews). `task check:ts` clean. The `council-discussion` CDP scenario gains steps, each a
named step in its shots, all driven through the rendered controls.

How the scenario stays off the person's disk and off wavesrv: `WriteTempFileCommand` is stubbed with `stubRpc`
(`fixtures.mjs`), so nothing is written to the real `~/.arc/attachments`; it answers a path under the scenario's own
temp folder where the step has written the PNG (so a thumbnail can load it), or stays `pending` / rejects where a step
says. `CouncilReplyCommand` is stubbed as the existing steps do, so a Send writes no council: the sent-message steps
open a seeded fixture council instead (below). The existing hooks the add-chat steps read (`data-council-mention`,
`data-council-mentions`, `data-council-add-chat`, `data-council-chat-row`, `data-selected`; `discussion.mjs` ~1067,
~1229) keep their names and meaning; the Files rows get their own (`data-council-file-row="<path>"`).

Steps:
- `attach-paste`: dispatch a paste carrying a small PNG into the channel box; a thumbnail chip appears, reaches its
  ready state, and the placeholder reads "paste an image · @ for a file".
- `attach-uploading`: with `WriteTempFileCommand` pending, a pasted image's chip shows its spinner and Send is
  disabled; resolving the stub turns it ready and enables Send.
- `attach-oversize`: a paste of a file over 10 MB shows the error chip and makes no `WriteTempFileCommand` call; a
  paste whose upload rejects shows the error chip with its message.
- `attach-remove`: the chip's x removes it.
- `attach-drop`: dropping an image on the box adds a chip; dropping a non-image file adds none and the page stays on
  the council (no navigation).
- `attach-thread`: a paste into an idea thread's box adds a chip there, not in the channel's box.
- `attach-draft-kept`: with a chip in the channel box, leave the council (another surface or council) and reopen it;
  the chip and the text are still there.
- `attach-file-picker`: type `@` then a few letters of a fixture project file; the list shows the Seats group, then a
  Files heading with that file (then Add a live chat when a chat is joinable); the arrow keys cross the groups; Enter
  inserts `@<path> `, and Tab on a file row does the same.
- `attach-locked-switch` (a follow-up fixture): with an image attached, or with an `@<file>` in the text, the
  "Let them read files" switch is on and disabled.
- `attach-send-call`: Send; the stubbed `CouncilReplyCommand` received `attachments` holding the image's path and
  `tools: true`, and the box (text and chips) is empty after.
- `attach-sent-bubble`: open the seeded council `rail-apps-room-attached.json` (registered in `COUNCIL_FIXTURES`, placed
  with `placeCouncil`), whose person reply has `attachments` (patched at arrange to the PNG the step writes) and
  `@<fixture file>` in its text; shoot it: the thumbnail under the text, no attachment path in the bubble's text, the
  file chip in place of `@path`.
- `attach-bubble-open`: clicking that thumbnail opens it full size; clicking the file chip opens the file.

Add the fixture and any mock change in `fixtures.mjs` / `discussion.mjs` (a `fixtures.test.mjs` case for the new
fixture's placement).
