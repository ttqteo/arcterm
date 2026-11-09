# Agent chat view (GUI over the TUI) Implementation Plan

**Goal:** A running Claude agent's cell opens in Chat — the conversation as bubbles with a message box, Allow / Deny
cards for permission prompts and clickable AskUserQuestion choices — with the real Claude Code TUI one flip away.

**Architecture:** Chat is a layer over the cell, the way `SleepingTranscript` lies over a sleeping agent today: the
xterm stays mounted at its size underneath, never remounted. Messages come from the transcript the rail already reads;
keys go into the PTY as today (`ControllerInputCommand`). A new `PermissionRequest` hook reports each permission prompt
into a per-agent queue in wavesrv (`pkg/agentperm`), published as the `agent:permission` event; chat draws the head of
the queue as a card whose Allow / Deny types `1` / Esc into the TUI through one wshrpc command that refuses a stale
request. Chat is one more option of the header's existing view control (`Chat | Terminal | Canvas | Review`).

**Tech Stack:** Go (wavesrv, wsh, wshrpc + `task generate`), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-09-agent-gui-view-design.md` — read its last section, "Builder's calls", first:
it fixes the queue rules (answered keys included), the payload fields (checked on Claude Code 2.1.319: no
`tool_use_id`), the flip key (`Mod`+`Shift`+`K`), how Chat joins the header's view control, the chat-mode module's names
and storage, and the shared send path.
**Verify:** `node scripts/verify.mjs ./pkg/agentperm ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Check:** `task check:ts && go vet ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat agent-sleep launcher-resume agent-grid canvas-swap brainstorm-mode doc-review-canvas agent-uploads agent-rail-sections`
**Prototype:** D:\src\arcterm\.superpowers\design\agent-chat\project\B-bubbles.dc.html

Conventions every task follows: pure logic in a `foo.ts` with `foo.test.ts` beside it, a thin `foo.tsx` over it (no
jsdom render tests); colors only from the `@theme` tokens in `frontend/tailwindsetup.css` (`surface-raised`,
`surface-code`, `asking`, `accent`, `edge-mid`, `diff-added`, `diff-removed`…), never raw hex; `DESIGN.md` for type,
spacing and motion. Never hand-edit a generated file (`task generate` writes them). Go tests on Windows need
`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in front of `go test` (Bash). **Names:** the existing
`agentview.ts` (`AgentView = terminal | canvas | review | brainstorm`, `setAgentView(id, view, now)`) keeps its meaning
and is not redefined; the chat mode is `ChatMode` in the new `chatmode.ts` / `chatmodestore.ts`. Key names in UI text
come from the registry's formatter (`formatChordString`), never a hard-coded `Ctrl`.

The `agent-chat` scenario (Task 9) has these steps; tasks name them in their acceptance:
1. a Claude cell opens in Chat: the header control reads `Chat | Terminal` with Chat selected; the user bubble is right,
   the agent's prose sits by the avatar, a "Worked for … · N tools" pill and a file chip show, a run's launch prompt and
   a pointer-line launch prompt are `sent` cards (not bubbles); a codex agent has no Chat option and shows its terminal;
2. typing "hello" and Enter sends `hello\r` to the block;
3. an attachment added through the box's paste path shows in the tray, and the send carries its path;
4. with the agent working, the working line shows its activity and Stop sends `\x1b`;
5. the work pill opens its tool lines; the file chip opens the diff;
6. picking Terminal: the chat layer is gone, the xterm is the same element as before, focus is in the xterm, the rail
   shows its Transcript tab; picking Chat brings the layer back and focus to the box;
7. `Mod`+`Shift`+`K` flips Chat → Terminal → Chat; `Alt`+`C` walks Chat → Terminal;
8. in a split of two Claude cells, each grid bar has its own switch, and flipping one leaves the other in Chat;
9. two queued Bash requests: the card shows the command, Allow, Deny, "More options in Terminal" and "1 more waiting";
   Allow sends the answer command with the head's id and `allow: true`, the buttons locked while it is in flight;
10. Deny sends `allow: false`; an answer the server refuses ("that request is no longer waiting") shows its message on
    the card;
11. an `ExitPlanMode` request shows only "Answer in Terminal", which flips the cell to Terminal;
12. an agent asking an AskUserQuestion shows its choices in the chat; clicking one sends the answer;
13. a Claude agent with no transcript yet shows an empty conversation and the box, no endless skeleton;
14. an asleep Claude agent draws bubbles with the wake box (`data-sleeping-transcript`, `data-sleeping-composer`,
    "…to wake it");
15. a run's ended Claude worker, read in the centre, draws bubbles;
16. a subagent opened in the cell draws bubbles.

---

### Task 1: The permission wire (types, event, command signatures)
**Depends on:** none
**Files:** `pkg/agentperm/doc.go`, `pkg/baseds/baseds.go`, `pkg/wps/wpstypes.go`, `pkg/wshrpc/wshrpctypes_agentperm.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_agentperm.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`

Land the interface Tasks 2 and 7 build on, so the frontend card does not wait for the queue's implementation.

- `pkg/agentperm/doc.go`: the package and its doc comment only (what the queue is, the clearing table from the spec).
- `pkg/baseds/baseds.go`:
  - `AgentPermissionRequest{Id "id"; ToolName "toolname"; Summary "summary"; Answerable bool "answerable"; Ts int64
    "ts"}` (json tags as quoted).
  - `AgentPermissionData{ORef "oref"; Requests []AgentPermissionRequest "requests"}` — the whole queue, head first;
    empty `requests` means nothing pending (always serialize the field, so an empty queue clears the card).
  - `AgentStatusData.ToolKey string "toolkey,omitempty"`: set only on a PostToolUse report.
- `pkg/wps/wpstypes.go`: `Event_AgentPermission = "agent:permission" // type: baseds.AgentPermissionData`, added to the
  event list beside `Event_AgentAsk`.
- `pkg/wshrpc/wshrpctypes_agentperm.go`: an `AgentPermCommands` interface composed into the server interface in
  `wshrpctypes.go` (as `AskCommands` is):
  - `AgentPermissionRaiseCommand(ctx, CommandAgentPermissionRaiseData{ORef "oref"; ToolName "toolname"; ToolInput
    json.RawMessage "toolinput"}) error`
  - `AgentPermissionAnswerCommand(ctx, CommandAgentPermissionAnswerData{ORef "oref"; Id "id"; Allow bool "allow"}) error`
  - `AgentPermissionPendingCommand(ctx, oref string) (baseds.AgentPermissionData, error)`
- `pkg/wshrpc/wshserver/wshserver_agentperm.go`: the three methods returning `errors.New("not implemented")` (Task 2
  replaces them).
- Run `task generate`; commit what it writes (the four generated files above). If it writes another file, add it to
  this task's commit and say so in the report.

Acceptance: a second `task generate` changes nothing; `go build ./cmd/... ./pkg/...` passes;
`frontend/types/waveevent.d.ts` has `{ event: "agent:permission"; data?: AgentPermissionData; }`; `RpcApi` has the
three commands; `task check:ts` passes. No view changes, so no scenario step.

### Task 2: The permission queue, its commands and the PermissionRequest hook
**Depends on:** Task 1
**Files:** `pkg/agentperm/agentperm.go`, `pkg/agentperm/agentperm_test.go`, `pkg/wshrpc/wshserver/wshserver_agentperm.go`, `pkg/wshrpc/wshserver/wshserver_agentperm_test.go`, `pkg/wshrpc/wshserver/wshserver.go`, `pkg/wshrpc/wshserver/wshserver_promptanswer.go`, `pkg/wshrpc/wshserver/wshserver_promptanswer_test.go`, `cmd/wsh/cmd/wshcmd-agenthook.go`, `cmd/wsh/cmd/wshcmd-agenthook_test.go`, `cmd/wsh/cmd/wshcmd-installhooks.go`, `cmd/wsh/cmd/wshcmd-installhooks_test.go`

Implement the queue exactly as the spec's "Builder's calls → The pending-permission queue" table says, answered keys
included. Model the registry on `pkg/agentask` (a mutex-guarded map keyed by oref, `sendInput` indirected for tests the
way `agentask.SetSendInputForTest` does).

`pkg/agentperm`:
- `ToolKey(toolName string, toolInput json.RawMessage) string`: tool name + `:` + hex sha256 of the input unmarshalled
  into `any` and re-marshalled (Go sorts map keys), so key order and whitespace do not matter; an input that does not
  parse hashes its raw bytes.
- `Answerable(toolName string) bool`: true only for Bash, Edit, Write, MultiEdit, NotebookEdit, WebFetch, WebSearch.
- `Summary(toolName string, toolInput json.RawMessage) string`: Bash → the command; Edit/Write/MultiEdit → `file_path`;
  NotebookEdit → `notebook_path`; WebFetch → `url`; WebSearch → `query`; anything else (or a missing field) →
  `<ToolName> <compact JSON>` cut at 300 runes.
- A `Registry` per oref holding the pending queue and the answered keys: `Raise(oref, toolName, toolInput, ts)`
  (append; id = a new uuid), `Snapshot(oref)`, `ClaimHead(oref, id) (req, ok)`, `AnswerHead(oref)` (drop the head and
  note its key as answered), `DropAll(oref)` (queue and answered keys), `NoteToolDone(oref, key)` (consume a matching
  answered key and change nothing, else drop the first pending entry with that key). Each mutating call reports whether
  the queue changed, so the caller publishes only on a change. `ErrNotPending = errors.New("that request is no longer
  waiting")`.
- `NoteStatus(data *baseds.AgentStatusData) (changed bool)`: Hook `Stop`, `UserPromptSubmit` or `SessionStart` →
  `DropAll`; a non-empty `ToolKey` → `NoteToolDone`. `NoteKey(oref string, input []byte) (changed bool)`: a single
  `1`–`9` or `\r` → `AnswerHead`; a single `\x1b` → `DropAll`; anything else → nothing.

wavesrv (`wshserver_agentperm.go`, `wshserver.go`, `wshserver_promptanswer.go`):
- Raise: refuse an empty oref or tool name; append; publish the snapshot as `Event_AgentPermission` (scope oref,
  `Persist: 1`).
- Answer: claim the head only if its id matches (else `ErrNotPending`); Allow on a non-answerable tool is refused with
  its own error and changes nothing; type `1` (Allow) or `\x1b` (Deny) into the oref's block; Allow → `AnswerHead`,
  Deny → `DropAll`; publish the snapshot; on Allow also publish the waiting → working status the way `noteBlockInput`
  does (reuse `answeredStatus`; do not route the key through `noteBlockInput`, which would answer the head a second
  time). A send failure leaves the queue as it was and returns the error.
- Pending: the snapshot.
- In `publishEvent`'s `agent:status` branch (after the stale checks, beside `retireAskOnResume`), call
  `agentperm.NoteStatus` and publish the snapshot when it changed. In `noteBlockInput`, call `NoteKey` for every input
  (before the `answersPrompt` gate, since Esc is not an answering key) and publish when it changed.

wsh (`wshcmd-agenthook.go`, `wshcmd-installhooks.go`):
- `managedHooks` gets `{Event: "PermissionRequest", Args: "agent-hook", Timeout: 10, Async: true}`; update the comment
  on `Async` to cover the permission report.
- `planEmission`: `PermissionRequest` → `AgentState_Waiting` with `detailForTool(...)` as Detail.
- `agentHookRun`: for a claude `PermissionRequest`, after the status publish, call `AgentPermissionRaiseCommand` with
  the resolved target oref, `tool_name` and the raw `tool_input` (best effort: `hookDebugLine` on error, never fail the
  turn). For a claude `PostToolUse`, set `data.ToolKey = agentperm.ToolKey(ev.ToolName, ev.ToolInput)` before
  publishing.

Tests (focused; run each with `go test <pkg> -run '<names>'`):
- `pkg/agentperm`: `TestToolKeyIgnoresKeyOrder`, `TestAnswerableTable` (every listed tool true; `ExitPlanMode`, `Read`,
  `mcp__x__y` false), `TestSummaryByTool`, `TestQueueRaiseClaimAnswer` (append order, claim by head id, a wrong id
  refused), `TestNoteStatusClears` (Stop / UserPromptSubmit / SessionStart drop all and forget answered keys; a
  matching ToolKey drops only its entry; a non-matching key drops nothing), `TestIdenticalParallelCalls` (two raises
  with the same key; `AnswerHead`; the first PostToolUse consumes the answered note and the second entry stays; the
  second PostToolUse with no note drops it), `TestNoteKey` (`1`, `\r` answer the head; `\x1b` drops all; `a`,
  `\x1b[A` nothing).
- `pkg/wshrpc/wshserver`: `TestAgentPermissionAnswer` — Allow types exactly `1` into the block, Deny types `\x1b`; a
  stale id types nothing and returns `ErrNotPending`; Allow on `ExitPlanMode` types nothing; each change publishes a
  snapshot. `TestNoteBlockInputClearsPermission` in `wshserver_promptanswer_test.go`.
- `cmd/wsh/cmd`: `TestPlanEmissionPermissionRequest`, `TestManagedHooksPermissionRequestAsync` (the entry is present
  and async), and the install test that pins the written settings still passes with the new event.

Acceptance: the focused tests above pass; the spec's clearing table holds row by row. No view changes, so no scenario
step (the card is Task 7's).

### Task 3: The conversation model (pure)
**Depends on:** none
**Files:** `frontend/app/view/agents/chatmodel.ts`, `frontend/app/view/agents/chatmodel.test.ts`

`chatItems(entries: AgentEntry[]): ChatItem[]`, built on `groupCompact` (`compacttimeline.ts`) so the work folding and
per-file merge are the compact view's own:
- `{ kind: "you"; key; text; images? }` — a `user` entry arcterm did not type; a `command` entry (a slash command the
  person typed) is `{ kind: "you"; key; command: "/name args" }`.
- `{ kind: "sent"; key; from: "run" | "cockpit"; header: string; lines: string[] }` — a `user` entry arcterm typed:
  `parseRunPrompt` → `"run"`; `pointerPath` (the "too long for a command line" pointer line) → `"run"` with header
  "run prompt · from a file" and the file path as its line, the file not read; `parseWake` or `parseStreamPrompt` →
  `"cockpit"`. Import them from `claude/arc-view-mod/hooks/prompt-core.ts` and `wake-core.ts` by relative path (both
  pure with no imports; never copy them). `header` is `cardHeader(card)` (a wake: `wakeSummary(wake)`); `lines` its
  fields as `label value` and its body, at most 6.
- `{ kind: "agent"; key; parts: AgentPart[] }` — every agent-side item between two of the above joins one group:
  `{ kind: "prose"; text }` for a message, `{ kind: "work"; work: WorkItem }` for a stretch of tools, followed by
  `{ kind: "files"; files; adds; dels }` when that work edited files.
- `{ kind: "marker"; key; item }` for a compaction, an interruption or a background task's notification (the
  `CompactItem` as is).
- Keys are stable across appends (the first entry's index, as `WorkItem.startIndex` is).
- `workingLine(state, activity): string | null` — "Working…" or "Working · <activity>" while `working`, else null.
- `CHAT_RENDER_STEP = 120` and `shownItems(items, shown)`: the last `shown` items.

Tests (`npx vitest run frontend/app/view/agents/chatmodel.test.ts`): a plain exchange (you → prose → work → prose)
gives one "you" and one "agent" with parts [prose, work, files, prose]; a run's launch prompt (fixture text from
`claude/arc-view-mod/testdata/plan-lead.txt`, read as `prompt-core.test.ts` reads it), a pointer line, and a cockpit
message (`agent-message.txt`) become `sent` items with `from` run / run / cockpit and are never `you`; a slash command
becomes a `you` with `command`; keys stay the same when entries are appended; `workingLine` for each state.

Acceptance: the tests above; the model is what scenario step 1 shows (drawn by Tasks 6 and 8).

### Task 4: Chat mode per agent: the store, the header control, the grid-bar switch, the keys, the rail
**Depends on:** none
**Files:** `frontend/app/view/agents/chatmode.ts`, `frontend/app/view/agents/chatmode.test.ts`, `frontend/app/view/agents/chatmodestore.ts`, `frontend/app/view/agents/chatswitch.tsx`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/gridcellbar.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `docs/keyboard-shortcuts.md`

Follow the spec's "Chat is one more option of the header's view control" and "Chat or Terminal, remembered". Do not
edit `agentview.ts`; compose it.

- `chatmode.ts` (pure): `type ChatMode = "chat" | "terminal"`; `chatCapable(agent)` — a roster agent (`kind` unset or
  `"agent"`, never `"terminal"` or `"background"`) whose `(agent.agent || "claude")` is `claude` (case-insensitive), run
  leads and workers included; `shownChatMode(agent, stored)` — `"terminal"` for an agent that is not chat-capable,
  else `stored ?? "chat"`; `type CellView = "chat" | AgentView`; `cellView(agentView, chatMode)` (Chat when the slot
  is `"terminal"` and the mode is chat); `cellViewOptions(capable, hasCanvas, hasReview, hasBrainstorm)` — the
  control's order, `["chat", "terminal", "brainstorm" | "canvas", "review"]`, Chat only when capable;
  `nextCellView(current, options)` for `Alt`+`C` (null with fewer than two options, so the key passes);
  `parseChatModes(raw)` / `withChatMode(map, id, mode)` for the stored map (only `"terminal"` stored; `"chat"` deletes
  the key; at most 200 ids, oldest dropped).
- `chatmodestore.ts`: the map in `localStorage` key `agent.chatmode` (every access in try/catch, as `railappsstore.ts`
  does), a per-agent atom, `useChatMode(agent): ChatMode`, `setChatMode(id, mode)`, `toggleChatMode(agent)`, and
  `selectCellView(agentId, view, now)`: Chat or Terminal set the chat mode and call `setAgentView(id, "terminal", now)`;
  any other view calls `setAgentView` and leaves the chat mode; a DEV-only `window.__arcChatMode = { get(id),
  set(id, mode) }` for scenarios.
- `agentheader.tsx`: for a chat-capable awake agent the existing `Segmented` is always drawn, with Chat first; its
  value is `cellView(view, chatMode)` and its change goes through `selectCellView`; titles name `Mod`+`Shift`+`K` for
  Chat / Terminal and keep the existing ones for the rest. Every other agent's control is exactly as today. Keep the
  `Alt`+`C` KeyCap beside it.
- `chatswitch.tsx` + `gridcellbar.tsx`: a compact `Chat | Terminal` switch in each split cell's bar (before the x),
  `data-agent-chat-switch={agent.id}`, `data-chat-mode={mode}`, drawn only for a chat-capable awake agent.
- `bindings.ts` (`buildAgentBindings`): `agent:chat-toggle`, keys `Mod:Shift:k`, group Agent, label "Switch the agent
  between Chat and Terminal", live inside the terminal (the `fullscreenChordActive` gate); from Chat → Terminal, from
  Terminal or a canvas / review / brainstorm → Chat (via `selectCellView`); passes the key (`false`) when the focused
  agent is not chat-capable or is asleep. `agent:view-cycle` (`Alt`+`C`) walks `nextCellView` over
  `cellViewOptions`. `agent:transcript` (`Mod:Shift:f`) passes the key while the focused agent shows Chat, as it does
  while it sleeps. Add `bindings.test.ts` cases for all three.
- `agentdetailsrail.tsx`: while the agent shows Chat, call `visibleTabs` / `shownTab` / `selectTab` with
  `hasTranscript` false, so the Transcript tab hides and a panel left on it falls back to Overview.
- `docs/keyboard-shortcuts.md`: the new row in the Agent table; the `Alt`+`C` and `Mod`+`Shift`+`F` rows' notes.

Tests: `npx vitest run frontend/app/view/agents/chatmode.test.ts frontend/app/store/keybindings/bindings.test.ts`
(`chatCapable` for claude / unset / codex / pi / a terminal / a background agent / a run worker; default Chat; the
options' order with and without canvas, review, brainstorm; `nextCellView` wraps and passes with one option; the
stored map round-trips and caps at 200; the bindings' ids, keys and pass-through).

Acceptance: `agent-chat` steps 1 (the control reads `Chat | Terminal`, Chat selected; none on codex), 6 (picking
Terminal and Chat; the rail's Transcript tab comes back), 7 (`Mod`+`Shift`+`K`, `Alt`+`C`) and 8 (the split cells'
own switches); `canvas-swap`, `doc-review-canvas` and `brainstorm-mode` still pass (the control they click keeps its
options and labels).

### Task 5: The chat composer
**Depends on:** none
**Files:** `frontend/app/view/agents/agentcomposer.tsx`, `frontend/app/view/agents/agentcomposer.test.ts`, `frontend/app/view/agents/chatcomposer.tsx`

- `agentcomposer.tsx`: move the send-or-wake logic out of `AgentComposer` into an exported hook
  `useAgentSend(blockId, agent)` returning `{ text, setText, canSend, waking, send }` (the draft per sleeping agent
  through `wakingstore`, the `\r`-terminated `ControllerInputCommand`, the wake path and its error toast, all as
  today); `AgentComposer` uses it and behaves exactly as before. Export a pure `canStop(state, sleeping)` — true while
  the agent is `working` or `asking` and awake.
- `chatcomposer.tsx`: `ChatComposer({ agent, placeholder, dataAttrs? })` drawn as the board's box (`max-w-[760px]`,
  `rounded-[12px]`, `border-edge-mid`, `bg-surface-raised`): a textarea that grows like `AgentComposer`'s, Enter sends
  (Shift+Enter a newline), Esc in the box blurs it (not Stop); attachments through `useComposerAttachments` (paste,
  drop and the attach button's native picker), the existing `AttachmentTray` above the text, `appendAttachments` into
  what is sent, `attachmentBlocker` disabling Send; Stop (`data-chat-stop`, sends `\x1b` through
  `ControllerInputCommand`, shown when `canStop`); Send (`data-chat-send`, accent, disabled when it cannot send). The
  box carries `data-agent-chat-composer={agent.id}` (Task 8's focus routing finds the textarea by it); a caller can add
  data attributes to the box (the sleeping overlay keeps `data-sleeping-composer`). Text starting with `/` goes as
  typed.

Tests: `npx vitest run frontend/app/view/agents/agentcomposer.test.ts` (`canSendComposer` unchanged; `canStop` for
each state and asleep).

Acceptance: `agent-chat` steps 2 (Enter sends `hello\r`), 3 (a pasted attachment shows in the tray and its path rides
the send) and 4 (Stop sends `\x1b`).

### Task 6: The conversation view, and the read-only places that draw it
**Depends on:** Task 3 (renders its `ChatItem`s)
**Files:** `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/endedtranscript.tsx`, `frontend/app/view/agents/subagentinterior.tsx`

- `chatconversation.tsx`: `ChatConversation({ entries, placeId, onLoadEarlier? })` draws `chatItems(entries)` in a
  `max-w-[760px]` column with 16px gaps, as the board:
  - `you`: a right-aligned bubble (`bg-surface-raised`, `rounded-lg`, max 70% wide), pasted images under it
    (`PromptImages`), a long message clamped as `userNeedsClamp` says; a slash command in mono.
  - `sent`: a right-aligned outlined card with its `header` and "from the run" / "from the cockpit", lines in mono,
    folded past 3 lines.
  - `agent`: the council's `CouncilAvatar` (one neutral tone, the letter `C`) and a column of parts: prose through
    `CouncilText` (Markdown, its `==…==` highlighted); work as the pill "Worked for 38s · 5 tools" (`workedFor`,
    `toolCountLabel`) that opens to the tool lines (`ToolLine`); files as a chip per file (`name +a −d`) that opens
    `<ToolDetailBody detail={{ kind: "edit", files: [file] }} variant="inline" />`, the diff the compact view's files
    bar opens (`compacttranscript.tsx`).
  - `marker`: the existing `CompactionDivider`, `InterruptedDivider`, `TaskNotificationRow`.
  - Only the last `CHAT_RENDER_STEP` items at first; a "Show earlier" button grows it and, once all are drawn, calls
    `onLoadEarlier` when given.
  - Rows carry `data-chat-you`, `data-chat-sent`, `data-chat-agent`, `data-chat-work`, `data-chat-files`.
- `endedtranscript.tsx`: a Claude worker's (`(agent.agent || "claude")` is claude) transcript draws `ChatConversation`
  instead of `CompactTranscript`; others keep the compact look; the header strip and "↑ run" stay.
- `subagentinterior.tsx`: draws `ChatConversation` instead of `NarrationTimeline` (a subagent is Claude's); the
  breadcrumb stays.

Acceptance: `agent-chat` steps 1 (bubbles, avatar, pill, file chip, sent cards), 5 (the pill opens its tool lines,
the chip the diff), 15 (an ended Claude worker in the centre) and 16 (a subagent in the cell).

### Task 7: The permission card
**Depends on:** Task 1 (the generated `AgentPermissionData` type, the `agent:permission` event and the RPCs)
**Files:** `frontend/app/view/agents/permissionmodel.ts`, `frontend/app/view/agents/permissionmodel.test.ts`, `frontend/app/view/agents/permissionstore.ts`, `frontend/app/view/agents/permissioncard.tsx`

- `permissionmodel.ts` (pure): `permissionTitle(toolName)` — Bash "Wants to run a command", Edit / MultiEdit "Wants to
  edit a file", Write "Wants to write a file", NotebookEdit "Wants to edit a notebook", WebFetch "Wants to fetch a
  page", WebSearch "Wants to search the web", else "Wants to use <tool>"; `waitingFor(ts, now)` ("waiting 4s",
  "waiting 2m"); `moreWaiting(n)` ("1 more waiting", "N more waiting", "" for 0); `cardShown(agent)` — awake and not
  idle.
- `permissionstore.ts`: a per-oref atom of the snapshot, subscribed to `agent:permission` once on first use (the
  `agentaskstore.ts` pattern, set up lazily by the hook, so no startup file changes); `usePermission(oref)` loads
  `AgentPermissionPendingCommand` once when its atom is empty; `answerPermission(oref, id, allow)` with a per-request
  in-flight flag (the card's buttons lock while it is set) and a per-request error (a refusal's message, shown on the
  card, after which the snapshot reloads). A DEV-only `window.__arcAgentPermission = { set(oref, requests) }` for
  scenarios.
- `permissioncard.tsx`: `PermissionCard({ agent, onOpenTerminal })`, the board's card: `asking`-tinted, a dot and
  "<title> · waiting 4s", the summary in mono on `bg-surface-code` (Bash prefixed `$ `); when the head is answerable,
  Allow (primary, `data-permission-allow`), Deny (secondary, `data-permission-deny`) and "More options in Terminal";
  when it is not, only "Answer in Terminal"; "N more waiting" under it; the error line (`data-permission-error`) when a
  refusal came back. The card carries `data-permission-card={agent.id}`. Draws nothing when the queue is empty or
  `cardShown` is false.

Tests: `npx vitest run frontend/app/view/agents/permissionmodel.test.ts`.

Acceptance: `agent-chat` steps 9 (the card, Allow, the lock, "1 more waiting"), 10 (Deny; a refusal's message) and
11 (`ExitPlanMode` → only "Answer in Terminal").

### Task 8: The live chat pane over the cell
**Depends on:** Task 4 (the chat mode store and control), Task 5 (the composer), Task 6 (the conversation), Task 7 (the card)
**Files:** `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/sleepingtranscript.tsx`, `frontend/app/view/agents/railtranscript.tsx`

- `railtranscript.tsx`: export `useTranscriptWindow` unchanged (the chat pane reads the same windowed transcript; no
  second reader).
- `chatpane.tsx`: `ChatPane({ model, agent, barred })`, an absolute layer over the cell exactly as `SleepingTranscript`
  is (`absolute inset-x-0 bottom-0 z-20`, `top-[26px]` when barred, `bg-background`), carrying
  `data-agent-chat={agent.id}`: the conversation through `useTranscriptWindow(agent.transcriptPath, agent.agent)` plus a
  live stream id `chat:<agentId>:<path>` that calls `requestAppend` on each stamp (the `RailTranscript` pattern), into
  `ChatConversation` with `onLoadEarlier`; stick-to-bottom and the jump pill (`useStickToBottom`, `JumpToLatestPill`);
  under the last message the working line (`workingLine(agent.state, agent.activity)`, `data-chat-working`), the
  permission card (its Terminal links call `setChatMode(agent.id, "terminal")`), and the AskUserQuestion drawn as the
  existing `AskRow` (`channelsprimitives.tsx`, `alert`) while `agent.ask` is set (`data-chat-ask`); then `ChatComposer`
  with "Reply to <name>, / for commands". With no transcript path yet, or an empty one, an empty column with a quiet
  "No messages yet" (`data-chat-empty`) and the composer, never a skeleton that never ends. Paths in prose link through
  `AgentPathLinks`, as in `SleepingTranscript`.
- `agentsurface.tsx`: in each cell, after the pane wrapper: an asleep agent keeps its sleeping overlay; an awake agent
  whose `shownChatMode` is `"chat"` gets `ChatPane` (`cell != null`, never the docked terminal). The pane under it
  stays mounted and is never re-parented or conditionally rendered (AGENTS.md: the terminal stack). `focusTerminalOf(id)`
  focuses the cell's chat textarea (`[data-agent-chat-composer] textarea`) when the cell shows Chat, else the xterm as
  now; when the agent in focus flips, focus follows (Terminal → its xterm, Chat → its box).
- `sleepingtranscript.tsx`: for a Claude agent, draw `ChatConversation` and `ChatComposer` (the existing wake
  placeholder, no Stop) instead of `CompactTranscript` and `AgentComposer`; other agents unchanged. Keep every hook and
  word the scenarios read: `data-sleeping-transcript` on the layer, `data-sleeping-composer` on the box, "No transcript
  found for this session." when there is none, the "…to wake it… (Enter)" placeholder.

Acceptance: `agent-chat` steps 1–4 and 6–13 run in this pane over a live cell; step 6 also checks the xterm is the same
element before and after two flips and where focus lands; steps 12 (an AskUserQuestion's choices; clicking one sends
the answer), 13 (no transcript: empty column and box) and 14 (asleep: bubbles with the wake box); `agent-sleep` and
`launcher-resume` still pass.

### Task 9: The `agent-chat` CDP scenario, existing scenarios pinned to Terminal, CHANGELOG
**Depends on:** Task 2 (its hand-check line names the hook it installs), Task 8 (the scenario drives the whole chat pane)
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

- `scripts/cdp/scenarios.mjs`: a new `agent-chat` scenario on the Agent surface with the 16 steps listed at the top of
  this plan, each with a screenshot, following the fixture-roster pattern of `agent-sleep` (write the roster fixture,
  `ahReload`, a mock RPC client like `installAgentSleepMock` that records `controllerinput`, `agentpermissionanswer`
  and the ask answer and answers them — refusing one on purpose for step 10 — restore everything in teardown). Its
  roster: a Claude agent with a fixture block and a transcript JSONL written to a temp dir (a user prompt, prose, tools
  with an Edit carrying a diff, prose again, a run's launch prompt from `claude/arc-view-mod/testdata`, a pointer
  line), a second Claude agent for the split, a codex agent, an asking Claude agent, a Claude agent with no
  transcript, an asleep Claude agent; for step 15 an ended worker through the run-fixture helpers
  (`docs/reference/cdp-run-fixtures.md`), and for step 16 a subagent transcript opened in the cell (the way the
  existing subagent scenarios open one). Permission requests are set through `window.__arcAgentPermission`, chat
  modes through `window.__arcChatMode`.
- Existing scenarios that look at a Claude agent's terminal cell (an `.xterm`, `xterm-helper-textarea`,
  `data-agent-terminal` contents, keystrokes into a Claude agent's pane, a run lead's or worker's terminal) pin that
  agent to Terminal in their arrange (`window.__arcChatMode.set(id, "terminal")` after the reload, or the
  `agent.chatmode` localStorage key before it) and clear it in teardown. A fixture row with no `agent` is Claude.
  Start with the ones Final runs — `agent-grid`, `canvas-swap`, `brainstorm-mode`, `doc-review-canvas`,
  `agent-uploads`, `agent-rail-sections` (and `agent-sleep`, `launcher-resume`, which must pass unchanged) — then
  search the file for the rest. Run each one you touch (`CDP_PORT=<port> node scripts/cdp/verify.mjs <name>` against a
  dev app started the way `scripts/cdp/final-verify.mjs` starts one) and list in the report every scenario you pinned
  and any you could not run, with why.
- `CHANGELOG.md`: under `Unreleased → Added`, one line for the person: a Claude agent opens as a chat (bubbles, a
  message box with Stop and attachments, Allow / Deny for permission prompts, its questions as choices), with the
  terminal one click away in the header or by its shortcut — name the key as `Ctrl`/`Cmd`+`Shift`+`K` or not at all,
  never `Ctrl` alone; end it with `<!-- big -->` and check `npx vitest run frontend/app/cockpit/whatsnew.test.ts`.
- `docs/hand-checks.md`: a `- [ ]` line: in a real Claude session (not bypass), a Bash permission prompt shows the
  card; Allow runs the command; Deny stops the turn; answering in the terminal instead clears the card; two parallel
  identical prompts show "1 more waiting", and Allow on the first leaves the second's card up until it is answered.

Acceptance: `task verify:ui -- agent-chat agent-sleep launcher-resume agent-grid canvas-swap brainstorm-mode
doc-review-canvas agent-uploads agent-rail-sections` passes; every other scenario touched passes or is named in the
report with why it could not run.
