# Agent chat view, round 3: what the TUI does that chat did not — Implementation Plan

**Goal:** Chat over a Claude agent draws a message sent while Claude works, shows a running tool as running, and gains
↑ recall, a `/` menu, a footer (model · context · permission mode), the permission card's "Yes, and don't ask again",
and Copy on bubbles and code blocks.

**Architecture:** Messages still come from the transcript (`transcriptprojection.ts` → `chatmodel.ts` →
`chatconversation.tsx`) and keys still go into the PTY. Two new read paths: the xterm that stays mounted under the chat
(a `lines()` on the term handle registry, `termpaste.ts`), parsed by a pure `tuiscreen.ts` for the mode line and the
permission dialog's options; and one new wshrpc command listing Claude Code's skills and commands (`pkg/claudecmds`).

**Tech Stack:** Go (wavesrv, wshrpc + `task generate`), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-09-agent-gui-view-design.md` — read "Round 3" (the last section) first; it
fixes every rule below. The rest of the spec is the chat view this builds on.

**Verify:** `node scripts/verify.mjs ./pkg/claudecmds ./pkg/agentperm ./pkg/wshrpc/...`
**Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts && go vet ./pkg/claudecmds ./pkg/agentperm ./pkg/wshrpc/...`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat agent-sleep agent-grid agent-uploads launcher-resume`

## Global Constraints

- Pure logic in `foo.ts` with `foo.test.ts` beside it, a thin `.tsx` over it; no jsdom render tests.
- Colours only from the `@theme` tokens in `frontend/tailwindsetup.css`; type, spacing and motion per `DESIGN.md`.
- Never hand-edit a generated file: change the Go types, run `task generate`, commit what it writes.
- Never commit `cmd/wsh/cmd/pi-tools-extension.ts` (every dev build rewrites it from `pi/`); restore it before each commit.
- Claude Code here is **2.1.319** (`claude --version`); every string read off its screen comes from a capture of that
  version, never from memory.
- Keep the existing data hooks the `agent-chat` scenario reads (`data-chat-item`, `data-chat-agent`, `data-chat-prose`,
  `data-chat-you`, `data-chat-work`, `data-fold`, `data-chat-tools`, `data-chat-working`, `data-agent-chat-composer`).

## Review Focus

- A message sent while a permission card or a question is up is held, never typed into Claude Code's dialog
  ("2 more things" must not pick option 2) — Task 3.
- A queued message carrying pasted images (a block-array `prompt`) draws as one bubble with its text and pictures —
  Task 3.
- A tool left with no result by a killed session never spins forever: it spins only while the agent is working — Task 4.
- `/` inside a sentence ("and/or", "src/app") never opens the menu; only `/` as the box's first character — Task 5.
- The footer keeps the last mode it read while a dialog covers the TUI's footer, instead of falling back to Default —
  Task 2 (the parser returns `null`) and Task 6 (the chip keeps the last non-null).

---

### Task 1: Go wire: the skills and commands list, and the permission answer's second choice

**Depends on:** none
**Files:** `pkg/claudecmds/claudecmds.go`, `pkg/claudecmds/claudecmds_test.go`, `pkg/wshrpc/wshrpctypes_claudecmds.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshrpctypes_agentperm.go`, `pkg/wshrpc/wshserver/wshserver_claudecmds.go`, `pkg/wshrpc/wshserver/wshserver_agentperm.go`, `pkg/wshrpc/wshserver/wshserver_agentperm_test.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces: `RpcApi.ListClaudeCommandsCommand(TabRpcClient, { cwd: string }): Promise<ClaudeCommandInfo[]>` with
  `ClaudeCommandInfo = { name: string; description?: string; source: "skill" | "command" }` (`name` without the slash;
  a plugin's as `<plugin>:<name>`).
- Produces: `CommandAgentPermissionAnswerData` gains `choice?: number` (Go `Choice int \`json:"choice,omitempty"\``).

- [ ] **Step 1: Write the failing tests for `claudecmds.List(home, cwd string) ([]Info, error)`** in
  `pkg/claudecmds/claudecmds_test.go`, each on a `t.TempDir()` home and cwd:
  - `TestListUserAndProjectSkills`: `<home>/.claude/skills/paper/SKILL.md` with frontmatter
    `name: paper` / `description: Write papers` and `<cwd>/.claude/skills/deploy/SKILL.md` (no `name:`) list
    `{paper, "Write papers", skill}` and `{deploy, …, skill}` (the folder names a skill with no `name:`).
  - `TestListCommandsWithSubfolders`: `<home>/.claude/commands/fix.md` and `<home>/.claude/commands/git/sync.md` list
    `fix` and `git:sync` as `command`; description from frontmatter `description:`, else the first non-empty line,
    cut at 120 characters.
  - `TestListEnabledPluginsOnly`: `installed_plugins.json`
    `{"version":2,"plugins":{"sp@mkt":[{"installPath":"<dir1>"}],"off@mkt":[{"installPath":"<dir2>"}]}}`, settings
    `{"enabledPlugins":{"sp@mkt":true,"off@mkt":false}}`, `<dir1>/.claude-plugin/plugin.json` `{"name":"superpowers"}`
    with `skills/brainstorming/SKILL.md` and `commands/plan.md` → `superpowers:brainstorming`, `superpowers:plan`;
    nothing from `<dir2>`.
  - `TestListPluginDirsFromEnv`: settings `{"env":{"CLAUDE_CODE_PLUGIN_DIRS":"<a><sep><b>"}}` (`sep` =
    `os.PathListSeparator`), `<a>/.claude-plugin/plugin.json` `{"name":"arc"}` + `skills/runs/SKILL.md` → `arc:runs`.
  - `TestListMissingDirsIsEmpty`: an empty home and cwd give `[]` and no error; an unreadable or malformed JSON file is
    skipped, not an error.
  - `TestListDedupesByName`: a project skill and a user skill both named `deploy` give one `deploy` (project first,
    then user, then plugins); the result is sorted by name.
- [ ] **Step 2: Run** `go test ./pkg/claudecmds` — expected FAIL (package does not exist).
- [ ] **Step 3: Implement `List`** in `pkg/claudecmds/claudecmds.go` (`type Info struct { Name, Description, Source
  string }`, JSON `name`, `description,omitempty`, `source`). Read frontmatter with a small `---` block parser (only
  `name:` and `description:`, quotes trimmed); no YAML dependency.
- [ ] **Step 4: Run** `go test ./pkg/claudecmds` — expected PASS.
- [ ] **Step 5: The command.** `pkg/wshrpc/wshrpctypes_claudecmds.go`: `ClaudeCmdsCommands` interface with
  `ListClaudeCommandsCommand(ctx context.Context, data CommandListClaudeCommandsData) ([]claudecmds.Info, error)`
  (`CommandListClaudeCommandsData{ Cwd string \`json:"cwd"\` }`; if importing `claudecmds` into `wshrpc` cycles, define
  `ClaudeCommandInfo` in `wshrpc` and convert in the server), embedded in `WshRpcInterface` (`wshrpctypes.go`, beside
  `AgentPermCommands`). Server in `wshserver_claudecmds.go`: `List(os.UserHomeDir(), data.Cwd)`.
- [ ] **Step 6: The second choice.** In `wshrpctypes_agentperm.go` add `Choice int \`json:"choice,omitempty"\`` to
  `CommandAgentPermissionAnswerData` and to the doc comment (Allow with `choice` 2 types `2`, "the prompt's second
  option"; 0 or 1 types `1`). In `wshserver_agentperm.go`: Allow with `Choice == 2` types `"2"` and is refused like
  Allow on a non-answerable head; `Choice` other than 0, 1, 2 is an error; the queue and status effects are Allow's.
  Tests in `wshserver_agentperm_test.go`: `TestAnswerSecondChoiceTypesTwo` (the input recorded is `2`, the head is
  dropped), `TestAnswerSecondChoiceRefusedWhenNotAnswerable`, `TestAnswerChoiceOutOfRange`.
- [ ] **Step 7: Run** `task generate`, then `node scripts/verify.mjs ./pkg/claudecmds ./pkg/agentperm ./pkg/wshrpc/...` —
  expected PASS; `git status` shows the three generated files changed.
- [ ] **Step 8: Commit** all the files above: `feat(chat): list Claude Code's skills and commands; the permission
  answer's second choice`.

### Task 2: Read the TUI under the chat: the mode line and the permission dialog's options

**Depends on:** none
**Files:** `frontend/app/view/term/termpaste.ts`, `frontend/app/view/term/termwrap.ts`, `frontend/app/view/agents/tuiscreen.ts`, `frontend/app/view/agents/tuiscreen.test.ts`

**Interfaces:**
- Produces: `readTermLines(blockId: string, count: number): string[] | null` in `termpaste.ts` (`null` when the block
  has no mounted, loaded terminal); `TermHandle` gains `lines: (count: number) => string[]`, wired in `termwrap.ts` to
  `this.recentLines(count)`.
- Produces: in `tuiscreen.ts`: `type ClaudeMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"`;
  `tuiMode(lines: string[]): ClaudeMode | null`; `interface TuiOption { n: number; label: string }`;
  `tuiPermissionOptions(lines: string[]): TuiOption[]`.

- [ ] **Step 1: Capture real screens** of Claude Code 2.1.319 in a scratch dir outside the repo: drive `claude --model
  haiku` through a PTY (Python `pty.fork` + `os.read`, 120×40), render the bytes to screen rows with `pyte` (a venv in
  the scratch dir; `pip install pyte`), and save the bottom 30 rows of: the idle prompt; after one, two and three
  Shift+Tab (`\x1b[Z`); the permission dialog for "run exactly: echo hi > x.txt"; the dialog for "replace the text of
  x.txt with bye" (an edit). Quit with `/exit`. These rows are the test fixtures, pasted into `tuiscreen.test.ts` as
  string arrays, trailing spaces trimmed. Report the exact mode and option strings in the task's report.
- [ ] **Step 2: Write the failing tests** in `tuiscreen.test.ts`:
  - `tuiMode` returns `"default"` for the idle capture, and the mode each Shift+Tab capture shows (`acceptEdits`,
    `plan`, and the third as captured).
  - `tuiMode` returns `null` for both dialog captures (the footer is covered) and for `[]`.
  - `tuiPermissionOptions` on the Bash capture returns the options numbered from 1 in screen order with their labels as
    shown, the cursor mark (`❯` or the captured one) stripped; on the edit capture likewise; `[]` on the idle capture.
  - an option label that wraps onto the next row comes back as one label.
- [ ] **Step 3: Run** `npx vitest run frontend/app/view/agents/tuiscreen.test.ts` — expected FAIL.
- [ ] **Step 4: Implement** `tuiscreen.ts` (pure; the markers are the captured strings, matched case-insensitively;
  `default` only when the input box the idle capture shows is on screen with no marker) and `readTermLines` +
  `TermHandle.lines`.
- [ ] **Step 5: Run** the test file — expected PASS. Run `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` —
  expected exit 0.
- [ ] **Step 6: Commit**: `feat(chat): read Claude Code's mode line and permission options off the terminal under the chat`.

### Task 3: A message sent while Claude works: the queued bubble, the pending bubble, the hold, ↑ recall

**Depends on:** none
**Files:** `frontend/app/view/agents/transcriptprojection.ts`, `frontend/app/view/agents/transcriptprojection.test.ts`, `frontend/app/view/agents/chatpending.ts`, `frontend/app/view/agents/chatpending.test.ts`, `frontend/app/view/agents/chatpendingstore.ts`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/agentcomposer.tsx`, `frontend/app/view/agents/chatcomposer.tsx`

**Interfaces:**
- Produces: `AgentSend` (`agentcomposer.tsx`) gains `message: string`, the exact text a send types.
- Produces: in `chatpending.ts`: `interface PendingMessage { id: string; text: string; sentAt: number; seen: number }`;
  `PENDING_MAX_MS = 120_000`; `userTextCount(entries: AgentEntry[], text: string): number`;
  `pendingStill(pending: PendingMessage[], entries: AgentEntry[], now: number): PendingMessage[]`;
  `pushSent(history: string[], text: string): string[]` (newest last, at most 20, no repeat of the newest);
  `recall(history: string[], at: number | null, dir: "up" | "down"): { at: number | null; text: string }`;
  `sendHold(permissionPending: boolean, asking: boolean): string | null`.
- Produces: in `chatpendingstore.ts`: `addPending(agentId: string, text: string, entries: AgentEntry[]): void`,
  `usePending(agentId: string): PendingMessage[]`, `sentHistory(agentId: string): string[]`,
  `noteSent(agentId: string, text: string): void`.

- [ ] **Step 1: Failing projection tests** in `transcriptprojection.test.ts`: the captured record
  `{"type":"attachment","attachment":{"type":"queued_command","prompt":"bị overlay kìa","commandMode":"prompt","origin":{"kind":"human"}},"timestamp":"2026-11-09T15:06:17.661Z"}`
  projects to `{ kind: "user", text: "bị overlay kìa" }` in order between the entries around it; a `prompt` of
  `[{"type":"text","text":"match this"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAA"}}]`
  projects to one user entry with that text and one image, as a `user` record with that content does; a
  `commandMode` of `task-notification` and a `queue-operation` record project to nothing new.
- [ ] **Step 2: Failing `chatpending.test.ts`**: `pendingStill` keeps a pending whose text the entries hold `seen`
  times, drops it at `seen + 1`, drops one older than `PENDING_MAX_MS`; `pushSent` caps at 20 and skips a repeat of the
  newest; `recall` from `null` going up gives the newest, up again the one before, down from the newest gives
  `{ at: null, text: "" }`, up at the oldest stays; `sendHold(true, false)` is
  `"Answer the permission prompt first"`, `sendHold(false, true)` `"Answer Claude's question first"`, `(false,false)`
  `null`.
- [ ] **Step 3: Run** both test files — expected FAIL.
- [ ] **Step 4: Implement** the projection case (reuse the `user` record's content path, so text rules, task
  notifications and images stay one code path), `chatpending.ts`, and `chatpendingstore.ts` (per-agent jotai atoms in
  `globalStore`, session-only, nothing persisted).
- [ ] **Step 5: Wire it.** `useAgentSend` returns `message`. `chatcomposer.tsx`: after a send of an awake agent returns
  true, `addPending(agent.id, message, entries)` — take `entries` as an optional prop `entries?: AgentEntry[]` the pane
  passes (the sleeping overlay passes none, so no pending there) — and `noteSent` for every send; the send is held while
  `sendHold(usePermission(oref).length > 0, agent.ask != null && !agent.ask.hold)` is non-null, the reason in the Send
  button's `title` and `aria-label` (oref is `block:<agent.blockId>`); ↑ with an empty box (or one still showing a
  recalled text, unedited) recalls, ↓ walks back, any edit ends recall. `chatpane.tsx`: pass `entries`; draw
  `pendingStill(usePending(agent.id), entries, now)` at the top of `data-chat-tail`, each a right-hand bubble with
  YouBubble's classes plus `opacity-60`, `data-chat-pending`, and a caption under it in `text-[11px] text-muted`:
  "Queued" while `agent.state !== "idle"`, else "Sending…"; re-evaluate each second while any is shown.
- [ ] **Step 6: Run** the two test files — PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` — exit 0.
- [ ] **Step 7: Commit**: `feat(chat): a message sent while Claude works shows as your bubble, queued until it lands; ↑ recalls`.

### Task 4: Tools in flight, Copy on bubbles and code blocks

**Depends on:** Task 3
**Files:** `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/transcriptprojection.ts`, `frontend/app/view/agents/transcriptprojection.test.ts`, `frontend/app/view/agents/compacttimeline.ts`, `frontend/app/view/agents/compacttimeline.test.ts`, `frontend/app/view/agents/chatmodel.ts`, `frontend/app/view/agents/chatmodel.test.ts`, `frontend/app/view/agents/narrationtimeline.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/codeblock.tsx`

**Interfaces:**
- Consumes: `chatpane.tsx` as Task 3 left it.
- Produces: the `action` `AgentEntry` gains `startedAt?: number` (UnixMilli of its `tool_use` record).
- Produces: `stretchMs(work: WorkItem, now: number, live: boolean): number` and `inFlight(action, live: boolean): boolean`
  in `compacttimeline.ts`; `workingText(state: AgentState, activity: string | undefined, entries: AgentEntry[]): string | null`
  in `chatmodel.ts`; `ToolLine` gains `running?: boolean` and `settled?: boolean`.

- [ ] **Step 1: Failing tests.** `transcriptprojection.test.ts`: a `tool_use` with a timestamp sets `startedAt`.
  `compacttimeline.test.ts`: `inFlight` is true for an action with no `outcome` only when `live`; `stretchMs` adds
  `now - startedAt` for in-flight actions when live and equals the finished durations otherwise. `chatmodel.test.ts`:
  `workingText("working", "running B=$(…", entries)` returns the last in-flight action's `target` when the last entry is
  one, else `workingLine(state, activity)` unchanged.
- [ ] **Step 2: Run** the three test files — expected FAIL.
- [ ] **Step 3: Implement.** `ToolLine({ action, inline, running, settled })`: `running` draws a spinner
  (`Loader2`, `animate-spin motion-reduce:animate-none`, `text-muted`) in the status square's place, no colour, and
  the elapsed time ticking from `startedAt`; an action with no `outcome` and not `running` draws a neutral square (no
  ✓, no ✗). In `chatconversation.tsx` the `WorkPill` passes `running={inFlight(action, live)}` where `live` is the
  `active` prop, and reads "Working for {workedFor(stretchMs(…))} · N tools" while one is in flight (ticking each
  second), "Worked for …" otherwise. `chatpane.tsx` shows `workingText(...)` in `data-chat-working`.
- [ ] **Step 4: Copy.** In `chatconversation.tsx`, the agent's prose bubble and `YouBubble` are `group relative`;
  a `CopyButton` (`@/app/element/copybutton`, `title="Copy"`, `content` the prose Markdown / your text) sits under the
  bubble's bottom edge (agent: left-aligned; yours: right-aligned), `opacity-0 group-hover:opacity-100
  focus-visible:opacity-100`, `data-chat-copy`. `codeblock.tsx`: a `CopyButton` (`title="Copy code"`,
  `data-code-copy`) in the block's top-right corner, outside the horizontal scroller.
- [ ] **Step 5: Run** the three test files — PASS; `task check:ts` (with the `NODE_OPTIONS` prefix) — exit 0.
- [ ] **Step 6: Commit**: `feat(chat): a running tool shows as running, not RAN; Copy on bubbles and code blocks`.

### Task 5: The `/` menu

**Depends on:** Task 1 (calls the ListClaudeCommandsCommand it adds), Task 3
**Files:** `frontend/app/view/agents/slashcommands.ts`, `frontend/app/view/agents/slashcommands.test.ts`, `frontend/app/view/agents/pickerlist.tsx`, `frontend/app/view/agents/filemention.tsx`, `frontend/app/view/agents/slashmenu.tsx`, `frontend/app/view/agents/chatcomposer.tsx`

**Interfaces:**
- Consumes: `RpcApi.ListClaudeCommandsCommand` (Task 1); `chatcomposer.tsx` as Task 3 left it.
- Produces: in `slashcommands.ts`: `interface SlashCommand { name: string; description?: string; tui?: boolean; source: "builtin" | "skill" | "command" }`;
  `BUILTIN_COMMANDS: SlashCommand[]`; `slashQueryAt(text: string, caret: number): string | null`;
  `slashMatches(query: string, all: SlashCommand[], limit = 8): SlashCommand[]`;
  `insertSlash(text: string, caret: number, name: string): { text: string; caret: number }`;
  `opensTui(text: string, all: SlashCommand[]): boolean`.
- Produces: `useSlashMenu({ text, setText, cwd, inputRef }): { list: ReactNode; onKeyDown; onCaret }` in `slashmenu.tsx`,
  the same shape as `useFileMention`.

- [ ] **Step 1: Failing `slashcommands.test.ts`**: `slashQueryAt("/comp", 5)` is `"comp"`; `slashQueryAt("/", 1)` is
  `""`; `null` for `"and/or"`, `" /x"`, `"/compact now"` with the caret after the space; `slashMatches("co", …)` puts
  name-prefix matches (`compact`, `config`, `context`, `cost`) before substring ones and caps at the limit;
  `insertSlash("/comp", 5, "compact")` is `{ text: "/compact ", caret: 9 }`; `opensTui("/model", all)` true,
  `opensTui("/model opus", all)` false, `opensTui("/compact", all)` false.
- [ ] **Step 2: Run** it — expected FAIL.
- [ ] **Step 3: Implement** `slashcommands.ts`. `BUILTIN_COMMANDS` (one-line descriptions in Claude Code's words;
  `tui: true` marks a menu): `add-dir`, `agents` (tui), `clear`, `compact`, `config` (tui), `context`, `cost`,
  `doctor` (tui), `export` (tui), `help` (tui), `hooks` (tui), `init`, `login` (tui), `logout`, `mcp` (tui),
  `memory` (tui), `model` (tui), `permissions` (tui), `plugin` (tui), `resume` (tui), `review`, `rewind` (tui),
  `status` (tui), `usage`. Ranking: prefix, then substring, then `rankPaths`-style fuzzy is not needed.
- [ ] **Step 4: Share the list chrome.** Move the portaled dropdown out of `filemention.tsx` into
  `pickerlist.tsx` (`PickerList({ anchor, shown, note, items, at, onPick, onHover, name, renderItem })`, the floating
  setup and classes as they are); `useFileMention` renders through it, unchanged on screen (its `data-<name>-mentions`
  hooks stay). `slashmenu.tsx`: `useSlashMenu` over it; each row shows `/name` (`text-[12px] text-primary`), the
  description (`text-[11px] text-muted`, truncated) and, for `tui`, a trailing `text-[10.5px] text-muted` "opens in
  Terminal"; built-ins first, then `ListClaudeCommandsCommand({ cwd })` fetched on the first `/` per mount (`cwd` the
  block's `cmd:cwd`, else `""`), a failed fetch leaving the built-ins; `data-chat-slash` on the list,
  `data-chat-slash-item=<name>` on a row.
- [ ] **Step 5: Wire it** in `chatcomposer.tsx` beside the `@` picker (one picker shows at a time: `/` only at the
  box's start, `@` never there). On a successful send whose text `opensTui`, `setChatMode(agent.id, "terminal")` and
  `focusTerm(agent.blockId)`.
- [ ] **Step 6: Run** `npx vitest run frontend/app/view/agents/slashcommands.test.ts frontend/app/view/agents/launchermention.test.ts`
  — PASS; `task check:ts` (with the prefix) — exit 0.
- [ ] **Step 7: Commit**: `feat(chat): the / menu: Claude Code's commands, skills and plugin commands`.

### Task 6: The footer: model, context, permission mode

**Depends on:** Task 2 (reads the mode through its readTermLines and tuiMode), Task 5
**Files:** `frontend/app/view/agents/chatfootermodel.ts`, `frontend/app/view/agents/chatfootermodel.test.ts`, `frontend/app/view/agents/chatfooter.tsx`, `frontend/app/view/agents/chatcomposer.tsx`

**Interfaces:**
- Consumes: `readTermLines`, `tuiMode`, `ClaudeMode` (Task 2); `chatcomposer.tsx` as Task 5 left it.
- Produces: `modeLabel(mode: ClaudeMode): string`, `contextLabel(pct: number | undefined): string | null`,
  `contextWarn(pct: number | undefined): boolean` in `chatfootermodel.ts`; `ChatFooter({ agent }: { agent: AgentVM })`.

- [ ] **Step 1: Failing tests**: `modeLabel` gives `Default`, `Accept edits`, `Plan`, `Bypass permissions`;
  `contextLabel(42.6)` is `"ctx 43%"`, `contextLabel(undefined)` `null`; `contextWarn(80)` true, `contextWarn(79.4)`
  false.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the model.
- [ ] **Step 4: `ChatFooter`** in the composer's bottom row after the attach button, `text-[11.5px] text-muted`,
  `data-chat-footer`: `agent.model`, then `contextLabel(agent.usage?.contextpct)` (`text-warning` when `contextWarn`),
  then a mode chip button (`data-chat-mode=<mode>`, `rounded-[6px] border border-edge-mid px-2 py-[2px]
  hover:border-edge-strong`, title "Cycles the mode, as Shift+Tab in the terminal") reading
  `modeLabel(mode)`. The mode is `tuiMode(readTermLines(blockId, 12))`, read on mount, every 1000 ms while
  `document.visibilityState === "visible"`, and 250 ms after a click; a `null` read keeps the last mode (none yet: the
  chip is not drawn). Click: `ControllerInputCommand` with `\x1b[Z`. Not drawn while the agent sleeps. Absent parts
  leave no separator behind.
- [ ] **Step 5: Run** the test file — PASS; `task check:ts` — exit 0.
- [ ] **Step 6: Commit**: `feat(chat): the box's footer: model, context use and the permission mode, which a click cycles`.

### Task 7: The permission card's "Yes, and don't ask again"

**Depends on:** Task 1 (answers with the choice it adds), Task 2 (reads the options through its readTermLines and tuiPermissionOptions)
**Files:** `frontend/app/view/agents/permissionmodel.ts`, `frontend/app/view/agents/permissionmodel.test.ts`, `frontend/app/view/agents/permissioncard.tsx`, `frontend/app/view/agents/permissionstore.ts`

**Interfaces:**
- Consumes: `choice` on the answer command (Task 1); `readTermLines`, `tuiPermissionOptions`, `TuiOption` (Task 2).
- Produces: `secondChoice(options: TuiOption[]): string | null` in `permissionmodel.ts`.

- [ ] **Step 1: Failing tests**: `secondChoice` returns option 2's label when there are at least 3 options and option 2
  starts with "Yes" (case-insensitive), using Task 2's two captured dialogs' parsed options; `null` for two options,
  for an option 2 that starts with "No", and for `[]`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** it, and the store's answer taking `{ allow: boolean; choice?: 2 }`.
- [ ] **Step 4: The card.** While a card for an answerable request is shown, read
  `tuiPermissionOptions(readTermLines(blockId, 30))` on show and each 1000 ms; when `secondChoice` is non-null, a third
  button between Allow and Deny in the secondary style (`data-perm-second`), its text the label (truncated to one line,
  full text in `title`); click answers with `{ allow: true, choice: 2 }`, errors shown as Allow's are.
- [ ] **Step 5: Run** the test file — PASS; `task check:ts` — exit 0.
- [ ] **Step 6: Commit**: `feat(chat): the permission card offers the prompt's own "Yes, and don't ask again"`.

### Task 8: The scenario steps, the changelog and the hand check

**Depends on:** Task 4 (its step 7 drives the running tool and Copy), Task 5 (its step 4 drives the / menu), Task 6 (its step 5 drives the footer), Task 7 (its step 6 drives the second choice)
**Files:** `scripts/cdp/scenarios.mjs`, `frontend/app/view/term/termwrap.ts`, `CHANGELOG.md`, `docs/hand-checks.md`

- [ ] **Step 1: Steps in `agent-chat`** (after its last step, a screenshot each, `cdp-shots/agent-chat-<n>-<topic>.png`):
  1. a `queued_command` attachment line appended to the fixture transcript draws a `data-chat-you` bubble with its
     text; with the agent working, a send draws a `data-chat-pending` bubble captioned "Queued", gone once a matching
     line is appended;
  2. with a permission request pending (the fixture the permission steps already use), the Send button is disabled
     with the hold's reason and nothing is sent to the block;
  3. ↑ in the empty box puts back the last sent text;
  4. `/` opens `data-chat-slash` listing `compact` and a skill from a mocked `ListClaudeCommandsCommand`; Enter puts
     `/compact ` in the box; sending `/model` flips the cell to Terminal (header shows Terminal pressed);
  5. the footer shows the model, `ctx N%`, and, after the fixture terminal shows the captured plan-mode screen, a chip
     with `data-chat-mode="plan"`; clicking it sends `\x1b[Z` to the block;
  6. with the captured Bash dialog on the fixture terminal and its request pending, `data-perm-second` shows option 2's
     label; clicking it calls the answer command with `choice: 2`;
  7. a `tool_use` with no result while the agent works draws a spinner, not ✓, and the stretch reads "Working for";
     hovering an agent bubble shows `data-chat-copy`; a fenced code block shows `data-code-copy`.
  To put a captured screen on a fixture terminal, use whatever the scenario already has for writing into a cell's xterm;
  if there is none, add a DEV-only `window.__arcTermWrite(blockId, text)` in `termwrap.ts`, behind
  `import.meta.env.DEV`.
- [ ] **Step 2: Run** `node scripts/cdp/final-verify.mjs agent-chat` (it starts and stops its own dev app) — expected
  every step PASS, the earlier steps included.
- [ ] **Step 3: `CHANGELOG.md`**, under the top section's `Added` (the chat line already there stays): one line for a
  message sent while Claude works showing as yours, queued; one for the `/` menu, the footer's mode switch and the
  card's "don't ask again"; under `Fixed`: a running tool in Chat no longer shows as done. Build each from
  `git show HEAD:CHANGELOG.md` plus these lines; grep that each appears once after the commit.
- [ ] **Step 4: `docs/hand-checks.md`**: extend the "(arcterm) Chat over a live Claude agent" entry: in a real session,
  send while Claude works (the bubble shows Queued, then lands where Claude took it), the footer's chip against Shift+Tab
  in the TUI, `/model` flipping to Terminal, and "don't ask again" on a real Bash prompt, naming what the scenario drove
  on fixtures and what is left to the hand check.
- [ ] **Step 5: Commit**: `test(cdp): agent-chat steps for queued messages, the / menu, the footer and the second choice; changelog`.
