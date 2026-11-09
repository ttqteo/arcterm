# Agent chat view (GUI over the TUI) — design

Status: approved in brainstorm `agent-gui-view` (2026-11-09). Mockup: `.superpowers/design/agent-chat/project/B-bubbles.dc.html`.

## Intent

A running Claude agent shows up in its cell like a chat app (Claude desktop, Antigravity): the conversation as
messages and a message box underneath, instead of the Claude Code TUI in a terminal.

## Decisions

### Chat by default, the TUI one flip away

Every Claude agent opens in **Chat**. A two-way switch in the cell's header (`Chat | Terminal`) and a key flip the cell
to the real terminal and back. The TUI keeps running underneath: chat is a layer over the cell, exactly the way
`SleepingTranscript` lies over a sleeping agent's cell today (`frontend/app/view/agents/agentsurface.tsx:822`), so the
xterm stays mounted at its size and is never remounted or refit (AGENTS.md: the terminal stack is one always-rendered
grid; nothing re-parents a pane).

### What chat can do without flipping

- **Send a message** — the existing `AgentComposer` path (text + `\r` into the agent's PTY).
- **Approve permissions** — an Allow / Deny card in the conversation (below).
- **Answer the agent's questions** (`AskUserQuestion`) — drawn in the conversation as clickable choices. The question
  already reaches the cockpit through the `wsh ask` PreToolUse hook (`cmd/wsh/cmd/wshcmd-installhooks.go:48`) and the
  answer is already typed into the TUI by `agentask.injectAnswer` (`pkg/agentask/deliver.go:119`); chat only draws it.
- **Stop** — a Stop button that sends Esc to the terminal.
- **Slash commands and attachments** — `/compact`, `/model`… typed in the box are sent as text; images and files go
  through the existing `composerattachments`. A command that opens a TUI menu (`/model`, `/resume`) still needs a flip to
  Terminal.

### Permissions: the hook reports, a keystroke answers

Add Claude's `PermissionRequest` hook to `managedHooks` (`cmd/wsh/cmd/wshcmd-installhooks.go`), **async** (it does not
wait for the person). Its payload carries the `tool_name` and `tool_input` of the exact request on screen, which it
reports to the cockpit; chat draws the Allow / Deny card from it. Allow types `1` into the TUI, Deny types Esc — the same
"type the answer into the terminal" path AskUserQuestion uses. The real prompt still shows in the TUI, so flipping to
Terminal can always answer it. Typing `1` / Enter already flips the agent's state back to working
(`answersPrompt`, `pkg/wshrpc/wshserver/wshserver_promptanswer.go`).

The first version offers **Allow** and **Deny** only; "yes, and don't ask again" changes number by tool, so the card
links "More options in Terminal" instead.

Check the `PermissionRequest` payload against the installed Claude Code version before relying on field names.

**When a card goes away (Agent's call, builder question 1).** Claude has no "permission answered" hook, and requests can
queue (parallel tool calls and subagents all prompt through the main TUI, one at a time). So wavesrv keeps a
pending-permission record per agent, with a queue, the way `pkg/agentask` keeps AskUserQuestion's (claim → inject →
await clear, `pkg/agentask/deliver.go:69-165`). PostToolUse, Stop, UserPromptSubmit and an answering key typed in the
terminal (`answersPrompt`) clear it. Allow and Deny are one wshrpc command that refuses unless that exact request is
still the one pending, so a late click never types `1` into Claude's input box or Esc into a running turn. Chat draws
one card at a time, with "N more waiting" when the queue holds more. New wshrpc types and an event: run `task generate`.

**Which prompts the card answers (Agent's call, builder question 2).** Allow types `1` only for tools whose first option
is a plain "Yes": a pure table (with tests) listing Bash, Edit, Write, MultiEdit, NotebookEdit, WebFetch and WebSearch.
Any other tool, plan approval (ExitPlanMode) included, gets a card with only "Answer in Terminal", because its first
option can grant more than the person chose (auto-accept edits, bypass).

### Look: chat bubbles

Your messages are bubbles on the right (`surface-raised`, `rounded-lg`); the agent's on the left behind a small avatar.
Its work between two pieces of prose folds into one chip (`Worked for 38s · 5 tools`, opens the steps), and the files
it edited into a chip (`session.ts +4 −1`, opens the diff). The permission card sits in the agent's column: an
`asking`-tinted card with the command in mono on `surface-code`, Allow (primary) and Deny (secondary). See the board.

The transcript records an agent message only once it is complete, so a message appears whole, not token by token.
While the agent works and its next message has not landed, the agent's side shows a "working" line from the latest
PreToolUse report.

### Which agents

**Claude only** in this version, **run agents included**: leads and task workers an engine run starts open in Chat too
(builder question 1). Other agents (codex, pi, opencode, agy) open in the TUI as today.

Prompts arcterm types into a session (a run's launch prompt, a lead's goal, what the cockpit sends through the arc mod)
are not drawn as your right-hand bubbles. Chat recognizes them by their opening, as
`claude/arc-view-mod/hooks/prompt-core.ts` already does for the transcript rows it draws (fixtures in
`claude/arc-view-mod/testdata`, written by `pkg/orchestrate`'s `TestViewModFixtures`), and draws each as a card of its own
naming who sent it (the run, the cockpit). Share that parser rather than copy it. The CDP scenarios that look at a run
agent's terminal cell pin that cell to Terminal.

### Past conversations

A Claude agent's own cell, and the Agent surface's centre showing it, always draws bubbles:

- while it runs, and while it **sleeps** (the sleeping overlay, `SleepingTranscript`, switches to the bubble view, with
  its composer that wakes the agent);
- a run's **finished worker** read back in the centre (`EndedTranscript`, `agentsurface.tsx:852`), so a worker does not
  change look in place when it finishes;
- a **subagent opened in the cell** (`SubagentInterior`, `agentsurface.tsx:870`), instead of its step-by-step
  `NarrationTimeline`.

While the cell is in Chat, the details rail **hides its Transcript tab** (`RailTranscript`, `agentdetailsrail.tsx:1398`),
so the conversation is not drawn twice side by side; flipping to Terminal brings the tab back.

Unchanged (compact or their own look): an ended session in the centre (`SessionPane`), Conversation History
(`sessionsdetail.tsx`), Quick look (`sessionpeek.tsx`), the rail's Transcript tab in Terminal, the Cockpit's agent and
lead cards (`agentrow.tsx`, `leadcard.tsx`), the Office dialog (`officedialog.tsx`) and the New agent dialog's resume
peek (`launcherpeekpanel.tsx`).

The council discussion already draws speech bubbles (`councilchat.tsx`, `councilchatmodel.ts`); reuse its bubble
pieces where they fit rather than build a second bubble vocabulary.

## Left to the builder (confirmed)

- The flip key: the board shows `Ctrl+T` as a placeholder; pick a key that does not shadow the terminal's own keys and
  add it to `frontend/app/store/keybindings/bindings.ts` and `docs/keyboard-shortcuts.md`.
- Chat or Terminal is remembered per agent (a per-agent jotai atom); the default for a Claude agent is Chat.
- In a split grid, each Claude cell has its own switch; the xterm stays mounted underneath.
- Focus: in Chat, typing goes to the message box; flipping to Terminal focuses the xterm.
- The "working" line comes from the latest PreToolUse report.
- Stop sends Esc; slash commands go as text; attachments use `composerattachments`.
- The `PermissionRequest` hook is added to `managedHooks` (async); Allow types `1`, Deny types Esc.
- One `CHANGELOG.md` line, and a CDP scenario for the chat view (bubbles, the permission card, the flip to Terminal).

## Background (what exists)

- `CompactTranscript` (`compacttranscript.tsx`) draws the compact look for ended and sleeping agents, History and the
  rail; its grouping is `compacttimeline.ts`.
- `livetranscript.ts` streams a running agent's JSONL transcript (`StreamAgentTranscriptCommand`) and projects it with
  `transcriptprojection.ts` into `AgentEntry[]`.
- `AgentComposer` (`agentcomposer.tsx`) sends text into the agent's PTY.
- Claude reports a permission prompt today only as a `permission_prompt` Notification
  (`cmd/wsh/cmd/wshcmd-agenthook.go:81`), which sets waiting but carries no choices. Codex already has a
  `PermissionRequest` hook (`pkg/codexhook/codexhook.go:57`).

## Builder's calls (autonomous run, 2026-11-09)

Decisions the spec left open or that the code forced, made by the run's lead with nobody at the cockpit.

### The `PermissionRequest` payload, checked

Probed on the installed Claude Code **2.1.319** (a headless session with a `PermissionRequest` command hook that dumped
its stdin, asked to run a Bash command):

```json
{"session_id":"…","transcript_path":"…\\<session>.jsonl","cwd":"…","prompt_id":"…","permission_mode":"default",
 "effort":{"level":"medium"},"hook_event_name":"PermissionRequest","tool_name":"Bash",
 "tool_input":{"command":"echo probe-123 > out.txt","description":"Write probe-123 into out.txt"},
 "permission_suggestions":[{"type":"addDirectories","directories":["…"],"destination":"session"}]}
```

It carries **no `tool_use_id`**. So a request is matched to the PostToolUse of the tool it granted by a **tool key**:
the tool name plus a hash of its `tool_input` re-marshalled canonically (Go `encoding/json` sorts map keys). One Go
function computes it (`agentperm.ToolKey`), called by `wsh agent-hook` for PostToolUse and by wavesrv for a raise, so
the two sides cannot drift. A PostToolUse whose key matches nothing clears nothing: the key match is only a backup,
since Allow, Deny and the keys typed in the terminal clear the request themselves.

### The pending-permission queue (`pkg/agentperm`)

One queue per agent block (oref), in wavesrv memory, published whole on every change as the `agent:permission` event
(`baseds.AgentPermissionData{oref, requests[]}`, persisted, empty `requests` = nothing pending). Each request has an id,
the tool name, a one-line **summary** (Bash: the command; Edit, Write, MultiEdit, NotebookEdit: the file path;
WebFetch: the URL; WebSearch: the query; anything else: the tool name and its input as compact JSON, cut at 300
characters), whether it is **answerable**, and when it was raised.

| What happens | Effect on the queue |
|---|---|
| `PermissionRequest` hook (via `wsh agent-hook`) | append (no dedupe: two identical parallel calls are two prompts) |
| Allow in chat | refuse unless the id is the head and answerable; type `1`; drop the head, noting its key as answered |
| Deny in chat | refuse unless the id is the head; type Esc; drop **all** (Esc on Claude's prompt rejects and ends the turn) |
| `1`–`9` or Enter typed in the agent's terminal (`answersPrompt`) | drop the head, noting its key as answered |
| Esc typed alone in the agent's terminal | drop all |
| PostToolUse report with a tool key | if an answered key matches, consume that note and change nothing; else drop the first pending entry with that key |
| Stop, UserPromptSubmit, or SessionStart report | drop all, and forget every answered key |

The answered notes exist for two identical parallel calls (same tool, same input): Allow on the first drops the head,
and the first call's PostToolUse must not then take the second, still-pending entry, whose prompt is still in the TUI.
A note left by a typed "No" (a digit that is not Yes) is forgotten at the turn's Stop at the latest.

The **answerable** table (Bash, Edit, Write, MultiEdit, NotebookEdit, WebFetch, WebSearch) lives only in Go and rides
each request as a field, so the frontend never keeps a second copy. Allow and Deny are one command,
`AgentPermissionAnswerCommand{oref, id, allow}`, which answers `agentperm.ErrNotPending` ("that request is no longer
waiting") when the id is not the head. A chat Allow also flips the agent's retained status from waiting to working,
the way a typed `1` does (`answeredStatus`), without going through the typed-key path a second time.
`AgentPermissionPendingCommand(oref)` returns the current snapshot, for a pane that mounts after a reload.

The PostToolUse report carries the tool key in a new `AgentStatusData.toolkey` field (omitted otherwise), so the queue
is cleared from wavesrv's existing status intercept (`publishEvent`) with no extra RPC per tool call. The
`PermissionRequest` hook entry is `{Event: "PermissionRequest", Args: "agent-hook", Timeout: 10, Async: true}`; the
hook also reports waiting with the tool's detail line, as Codex's does.

The card is drawn only while the agent is awake and not idle, so a queue left over by a killed process (no Stop) never
shows.

### The flip key: `Mod`+`Shift`+`K`

`Ctrl`+`T` (the board's placeholder) is Claude Code's own todo-list key and bash's transpose, and the free
`Mod`+`Shift` letters that are not a terminal's copy or paste (`C`, `V`) are few. `Mod`+`Shift`+`K` is unused in the
registry, works from inside the terminal like the other `Mod` chords, acts on the agent in focus, and passes the key on
when that agent is not a Claude agent or is asleep. Binding id `agent:chat-toggle`, Agent group. From Chat it shows
Terminal; from Terminal, or from a canvas, review or brainstorm in the terminal's place, it shows Chat. Text names the
key as the registry formats it (`Ctrl+Shift+K` on Windows, `⌘⇧K` on a Mac), never one platform's spelling alone.

### Chat is one more option of the header's view control

The single-cell header already has a segmented control for what stands in the terminal's place
(`Terminal | Canvas | Review | Brainstorm`, `agentheader.tsx`, the `AgentView` of `agentview.ts`, `Alt`+`C` walking
it through `agent:view-cycle`). Chat does not get a second control beside it. For a Claude agent that is awake, the
control gains **Chat** as its first option and is always shown (Chat and Terminal are already two choices):
`Chat | Terminal | Canvas or Brainstorm | Review`, each extra only when the agent has it. Chat and Terminal are the same
`AgentView` slot, `"terminal"` (the cell stack is on screen); which of the two shows is the agent's chat mode. Picking
Chat or Terminal sets the chat mode and `setAgentView(id, "terminal", now)`; picking Canvas, Review or Brainstorm is
`setAgentView` as today and leaves the chat mode alone, so coming back to the cell shows Chat or Terminal as it was.
`Alt`+`C` walks the same order, Chat included. The module stays `agentview.ts` unchanged in meaning; the chat mode is
its own module (below), and one pure function, `nextCellView`, composes the two for the control and `Alt`+`C`.

In a split, a cell's grid bar (`gridcellbar.tsx`) carries a compact `Chat | Terminal` switch of its own: a canvas,
review or brainstorm takes the whole centre, not a cell, so a cell only ever chooses between those two.

### Chat or Terminal, remembered

The **chat mode** (`ChatMode = "chat" | "terminal"`) lives in new files, `chatmode.ts` (pure) and `chatmodestore.ts`
(`useChatMode`, `setChatMode`, `toggleChatMode`), so nothing collides with `agentview.ts`'s `AgentView` and
`setAgentView`. It is a per-agent jotai atom persisted in `localStorage` (`agent.chatmode`, a map of agent id to
`"terminal"`, storing only the non-default, pruned to the last 200). Chat-capable means a roster agent (not a plain
terminal, not a background agent) whose harness is Claude, an unset `agent` counting as Claude
(`agent.agent || "claude"`, as `claudeaccount.ts` reads it). Scenarios pin a cell with a DEV-only
`window.__arcChatMode`.

The sleeping overlay keeps its hooks and words (`data-sleeping-transcript`, `data-sleeping-composer`, "No transcript
found for this session.", the "…to wake it" placeholder), which the `agent-sleep` and `launcher-resume` scenarios read.

`Mod`+`Shift`+`F` (open the rail's Transcript) passes the key on while the focused agent shows Chat, as it does while
the agent sleeps: the conversation is already on screen.

### One send path

`AgentComposer`'s send-or-wake logic moves into a hook both composers use, so the chat composer and the old one cannot
diverge on how text reaches the PTY or how a sleeping agent is woken. The chat composer adds Stop (Esc, shown while the
agent works or asks) and attachments (`useComposerAttachments`, `appendAttachments`, `AttachmentTray`).

### One conversation model

`chatmodel.ts` builds the bubbles from `groupCompact` (`compacttimeline.ts`), so "Worked for 38s · 5 tools" and the
merged per-file `+a −d` counts are the compact view's own; markers (compaction, interruption, a background task's
notification) reuse `narrationtimeline.tsx`'s rows. A prompt arcterm typed is recognized with the arc view mod's own
`parseRunPrompt` / `parseStreamPrompt` (`prompt-core.ts`) and `parseWake` (`wake-core.ts`), imported from
`claude/arc-view-mod/hooks/` (both files are pure, with no imports), and drawn as a card naming the run or the cockpit.
A launch prompt too long for a command line reaches the transcript as the pointer line ("Your instructions are in the
file … (too long for a command line)…", `pointerPath`); chat draws it as a run card naming the file, without reading
it.
The agent's avatar is the council's `CouncilAvatar` and its prose `CouncilText`'s Markdown, so there is one bubble
vocabulary.

### Focus

`focusTerminalOf` in `agentsurface.tsx` focuses the chat box of a cell showing Chat instead of the xterm under it (which
`checkVisibility` still reports visible under the overlay); flipping to Terminal focuses the xterm, flipping to Chat
the box.

## Round 3: what the TUI does that chat did not (2026-11-09)

Asked for after the first live use: a message sent while Claude is still answering, and the upgrades listed after
round 2, all of them. Decided in the conversation; the plan is `docs/superpowers/plans/2026-11-09-agent-chat-upgrades.md`.

### A message sent while Claude works

The box already types it into the PTY, and Claude Code queues it, as in the TUI. What chat lacked is drawing it. Claude
Code 2.1.319 writes a queued message one of two ways: taken in **mid-turn**, as an `attachment` record
`{"type":"queued_command","prompt":…,"commandMode":"prompt","origin":{"kind":"human"}}` (the prompt a string, or text
and image blocks), next to `queue-operation` records; or, taken at the turn's end, as a plain `user` record. The
projection draws the first as your bubble too (only `commandMode` `prompt`). Between Send and the transcript line, a
**pending bubble** stands at the end of the conversation, dimmed, captioned "Queued" while the agent works and
"Sending…" otherwise; it goes when the transcript holds that text once more than when it was sent, or after 2 minutes.

A send is **held** while a permission card or an AskUserQuestion is up: typed into Claude Code's dialog, the text's
first digit would pick an option ("2 more things" picks option 2). The Send button says why.

### Tools in flight

A tool call whose result has not landed is drawn as running in a live session (a spinner where the ✓ goes, no colour),
and the stretch reads "Working for 38s · 7 tools", counting up to now; the working line names the running tool's own
description when the transcript has it. In a session that is not working, a tool with no result is drawn neutral (no ✓,
no ✗). Before this, a running tool read "RAN ✓" and the stretch counted only finished tools, so chat and the TUI
disagreed at the same moment. Claude Code's own group summaries ("Searched for 4 patterns, ran 8 shell commands") are
drawn by the TUI process and never reach the transcript; chat keeps its own "N tools" wording.

### Recall, the `/` menu, the footer

- **↑** in an empty box puts back the last message sent from this box to this agent (the last 20, this session only);
  ↓ walks forward and back to empty.
- **`/`** as the box's first character opens a picker like the `@` one: Claude Code's built-in commands (a list kept in
  the frontend), then skills and commands from a new `ListClaudeCommandsCommand{cwd}`: `~/.claude/skills`,
  `<cwd>/.claude/skills`, `~/.claude/commands`, `<cwd>/.claude/commands`, and the skills and commands of each enabled
  installed plugin (`~/.claude/plugins/installed_plugins.json`, `enabledPlugins` in `~/.claude/settings.json`) and each
  folder in that file's `env.CLAUDE_CODE_PLUGIN_DIRS`, named `<plugin>:<name>`. Sending a built-in that opens a TUI
  menu with nothing after it (`/model`, `/resume`, `/config`…) flips the cell to Terminal so the menu is seen.
- **Footer** in the box's bottom row: the model, the context use (`ctx 43%`, from `agent.usage`), and the permission
  mode as a chip. The mode is read off the TUI's own footer line in the xterm under the chat (the cell keeps it mounted
  and fed); clicking the chip types Shift+Tab (`\x1b[Z`), which cycles it. While a dialog covers the TUI's footer the
  chip keeps the last mode it read.

### The permission card's second choice

The card reads the dialog's numbered options off the same xterm. When option 2 starts with "Yes" (Bash's "Yes, and
don't ask again for … commands in …", an edit's "Yes, allow all edits during this session"), the card shows it as a
third button in the TUI's own words, and it types `2` through `AgentPermissionAnswerCommand`, which gains `choice`
(`2`; `0` or `1` is Yes). Only for an answerable request, as Allow.

### Copy

Hovering a bubble (Claude's or yours) shows Copy, which copies its text (Claude's as Markdown). Every fenced code block
in Markdown gets a copy button (`codeblock.tsx`, so the council and the rail have it too).

### Not done

- **Todo checklist:** none of the 103 Claude transcripts of the last three days calls `TodoWrite` or a `Task*` tool, so
  Claude Code 2.1.319 here keeps no todo list to draw.
- **Jump to latest:** already there (`JumpToLatestPill`, `sticktobottom.tsx`).
