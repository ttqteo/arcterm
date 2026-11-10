# Chat: every slash command the session offers, grouped, and a + menu

**Verify:** `node scripts/verify.mjs ./pkg/claudecmds/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat`
**Prototype:** D:/work/arcterm/.superpowers/design/chat-slash-menu/project/

Runs after queue entry q-1876 (inline visuals in Chat) has landed: both edit `chatcomposer.tsx`.

The chat box's `/` menu lists too little: 22 built-ins copied by hand from Claude Code 2.1.319
(`slashcommands.ts` `BUILTIN_COMMANDS`, already missing `/effort`, `/release-notes`, `/review`…), plus what
`pkg/claudecmds` reads off disk; it never sees the skills bundled in the binary (`/code-review`, `/simplify`, `/loop`,
`/security-review`), the commands a mod registers at runtime (`/skim`) or MCP prompts, and it shows at most 8 rows
(`SLASH_LIMIT`). Claude Code's mod API answers the exact list its own typeahead shows: `$.command.list()` →
`CommandInfo[]` `{ name, description, source: "builtin" | "plugin" | "user" | "mcp", plugin? }`, in typeahead order
(`~/.arc/claude-mod/.claude-plugin/types/claude-code/index.d.ts`, `CommandInfo` ~1776, `command.list` ~3264). The arc
mod runs in every Claude session arcterm starts, so it publishes that list to wavesrv per agent block, and Chat reads
it. The canvas (Prototype) draws the result: the grouped, scrolling `/` menu with its footer ("Typing /"), the
filtered menu ("Typing /re") and the + menu that replaces the attach button ("The + menu"), borrowed from Claude
Desktop.

Decisions (the lead's calls, each with why):

- **Live list per block, held in wavesrv's memory.** `wsh claudecmds set` (hidden) reads the JSON list on stdin and
  sends it with its block id (`RpcContext.BlockId`); wavesrv keeps the newest list per block in a map
  (`pkg/claudecmds/live.go`). Memory only: a list is ~20 KB, and after a wavesrv restart the mod's next publish
  refills it. A list on stdin, not argv: 200 commands run past Windows' 32 K command line.
- **The mod publishes on change only**: after `session.start` (a `/clear` and a mod reload run it again), once more
  10 s later (MCP servers connect after the session starts), and after each `prompt.submit`, without waiting
  (`void`). Each compares the list's JSON with the last one sent and sends only when it differs.
- **Fallback is today's list.** No live list (an agent started before this lands, a sleeping agent, wavesrv just
  restarted, a non-arcterm mod) → the copied built-ins plus `ListClaudeCommandsCommand`, as now; the footer says
  which it is.
- **Chat asks again each time the menu opens**, not once per mount: the live lookup is a map read, and a skill or MCP
  server added mid-session then shows on the next `/`.
- **Groups, in this order**: Built-in (`builtin`, which includes the bundled skills), Skills (`user`; on the fallback,
  disk entries with no `:`), Plugins (`plugin`; on the fallback, names with a `:`), MCP (`mcp`). Each header shows its
  count; within a group the order is the list's, prefix matches first. No cap: the list scrolls (max 420 px).
- **"opens in Terminal" stays a hand list** (`TUI_NAMES`: the bare built-ins that draw a menu on Claude Code's own
  screen); the API does not say which do.
- **The + menu replaces the attach button**: Add files or photos (Ctrl+U, also bound in the box), Add folder (puts
  `/add-dir ` in the box), Slash commands (puts `/` in an empty box and opens the menu), MCP servers › and Plugins ›
  (send `/mcp` and `/plugin`, which open in Terminal as today). Submenus with toggles like Claude Desktop's are out of
  scope: they need a write path into Claude Code's settings. The button keeps `data-chat-attach`, so the existing
  asleep assertions (no attach while asleep) hold.

### Task 1: The live list in wavesrv, and `wsh claudecmds set`

**Depends on:** none

**Files:** `pkg/wshrpc/wshrpctypes_claudecmds.go`, `pkg/claudecmds/live.go`, `pkg/claudecmds/live_test.go`, `pkg/wshrpc/wshserver/wshserver_claudecmds.go`, `cmd/wsh/cmd/wshcmd-claudecmds.go`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/types/gotypes.d.ts`

**Step 1: Write the failing test** (`pkg/claudecmds/live_test.go`): `SetLive("b1", list)` then `Live("b1")` returns
an equal copy (mutating the returned slice does not change the stored one); `Live("nope")` is `nil, false`; a second
`SetLive` replaces; `SetLive` refuses an empty block id and a list over 2,000 entries; entries with an empty name are
dropped and a description is cut to 300 characters.

**Step 2:** `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/claudecmds -run 'Live'` → FAIL.

**Step 3: Implement.**
- `live.go`: a mutex-guarded `map[string][]LiveCommand` with `SetLive(blockID string, list []LiveCommand) error` and
  `Live(blockID string) ([]LiveCommand, bool)`; `LiveCommand{Name, Description, Source, Plugin string}`. Header comment:
  what it holds, who writes it (the arc mod through `wsh claudecmds set`), and that it is memory only.
- `wshrpctypes_claudecmds.go`: `ClaudeCommandInfo` gains `Plugin string \`json:"plugin,omitempty"\``; its comment
  names the live sources too. Two commands on `ClaudeCmdsCommands`: `SetClaudeLiveCommandsCommand(ctx,
  CommandSetClaudeLiveCommandsData{BlockId string; Commands []ClaudeCommandInfo}) error` and
  `GetClaudeLiveCommandsCommand(ctx, CommandGetClaudeLiveCommandsData{BlockId string}) ([]ClaudeCommandInfo, error)`
  (nil when none), each with a comment.
- `wshserver_claudecmds.go`: the two handlers, converting to and from `LiveCommand`.
- `wshcmd-claudecmds.go`: `claudecmds` (hidden parent) with `set` (hidden, `PreRunE: preRunSetupRpcClient`): fails
  with a clear error when `RpcContext.BlockId` is empty; reads stdin (cap 4 MiB), unmarshals
  `[]wshrpc.ClaudeCommandInfo`, calls `wshclient.SetClaudeLiveCommandsCommand` with a 5 s timeout. Follow
  `wshcmd-transcripttail.go`'s shape and `wshcmd-effort.go` `mutateOne` for the RPC call.

**Step 4:** `task generate`; check that only the generated files listed above changed besides yours (`git status`).

**Step 5:** the Step 2 command, then `go test ./pkg/claudecmds ./pkg/wshrpc/... ./cmd/wsh/cmd -run 'Live|Claudecmds'`
(same env) → PASS; `gofmt -l` on your Go files → nothing; `go build ./cmd/wsh ./cmd/server` → OK.

**Step 6:** Commit: `git commit -m "feat(claudecmds): wavesrv keeps each Claude agent's live slash command list, set
by wsh claudecmds set" -- <the eight paths>`

### Task 2: The arc mod publishes the list

**Depends on:** none

**Files:** `claude/arc-mod/hooks/commands-core.ts`, `claude/arc-mod/hooks/commands-core.test.ts`, `claude/arc-mod/hooks/register.ts`, `cmd/wsh/cmd/claude-mod/hooks/commands-core.ts`, `cmd/wsh/cmd/claude-mod/hooks/register.ts`

Read `AGENTS.md` on `claude/arc-mod/` (the source; `task sync:claudemod` copies it, minus tests, to
`cmd/wsh/cmd/claude-mod/`, which is tracked) and `register.ts`'s `session.start` and `prompt.submit` hooks first.

**Step 1: Write the failing test** (`commands-core.test.ts`, vitest, the pattern of the other `*-core.test.ts`):
`commandsPayload(list)` returns the JSON of `{ name, description, source, plugin? }` per entry in the given order
(extra fields dropped, `plugin` only when a non-empty string) and is the same string for the same list;
`claudecmdsArgs()` is `["claudecmds", "set"]`.

**Step 2:** `npx vitest run claude/arc-mod/hooks/commands-core.test.ts` → FAIL.

**Step 3: Implement** `commands-core.ts` (pure, header comment) and, in `register.ts`, a module-level `lastCommands =
""` and `publishCommands($)`: return unless `active`; `payload = commandsPayload(await $.command.list())`; return when
it equals `lastCommands`; `$.process.run([WSH, ...claudecmdsArgs()], { stdin: payload, timeoutMs: 10_000 })`; on exit
0 set `lastCommands`, else log to debug (`$.ui.log(…, { to: "debug" })`, as the other wsh calls do); catch every
error into the same debug log. Call it: in `session.start` after `next(e)` (reset `lastCommands = ""` first, so a
`/clear` republishes), then `void $.clock.sleep(10_000).then(() => publishCommands($))` (check `$.clock.sleep`'s
signature in the types file); in `prompt.submit`, `void publishCommands($)` on the path that calls `next(e)`.

**Step 4:** `npx vitest run claude/arc-mod/hooks/commands-core.test.ts` → PASS; `claude plugin validate
claude/arc-mod` → no errors; `task sync:claudemod`, and check `git status` shows only the two copies above changed
under `cmd/wsh/cmd/claude-mod/`.

**Step 5:** Commit: `git commit -m "feat(claude-mod): publish the session's slash commands to arcterm when they
change" -- <the five paths>`

### Task 3: The menu's pure model

**Depends on:** none

**Files:** `frontend/app/view/agents/slashcommands.ts`, `frontend/app/view/agents/slashcommands.test.ts`

**Step 1: Write the failing tests** (extend `slashcommands.test.ts`; read it first): `fromLive` maps each source,
keeps `plugin`, marks `tui` only for a `builtin` in `TUI_NAMES`; `groupOf` for each live source and for the fallback's
`skill`/`command` with and without `:`; `slashGroups` keeps the group order Built-in, Skills, Plugins, MCP, drops
empty groups, counts each, and keeps the input order inside a group; `slashMatches` with no limit returns every match
(prefix ones first) and the old tests that pass a limit still hold.

**Step 2:** `npx vitest run frontend/app/view/agents/slashcommands.test.ts` → FAIL.

**Step 3: Implement** in `slashcommands.ts`, updating its header comment (the live list first, the copied built-ins
as the fallback):
- `SlashCommand.source` becomes `"builtin" | "user" | "plugin" | "mcp" | "skill" | "command"`; add `plugin?: string`.
- `TUI_NAMES`: the names `BUILTIN_COMMANDS` marks `tui` today, plus `effort`; `b()` reads it instead of its third
  argument.
- `fromLive(list: { name: string; description?: string; source: string; plugin?: string }[]): SlashCommand[]`: an
  unknown source reads as `user`.
- `export type SlashGroup = "Built-in" | "Skills" | "Plugins" | "MCP"`; `groupOf(c)`; `slashGroups(items):
  { title: SlashGroup; items: SlashCommand[] }[]`.
- `slashMatches`'s `limit` defaults to `Infinity`; remove `SLASH_LIMIT` (grep its users first; only this file and
  `slashmenu.tsx` import from here).

**Step 4:** the Step 2 command → PASS; eslint and prettier on both files → clean.

**Step 5:** Commit: `git commit -m "feat(chat): the slash menu's model groups the live command list" --
frontend/app/view/agents/slashcommands.ts frontend/app/view/agents/slashcommands.test.ts`

### Task 4: The grouped `/` menu and the + menu

**Depends on:** Task 1 (calls the generated `RpcApi.GetClaudeLiveCommandsCommand`), Task 3 (imports its model)

**Files:** `frontend/app/view/agents/pickerlist.tsx`, `frontend/app/view/agents/slashmenu.tsx`, `frontend/app/view/agents/chatplusmenu.tsx`, `frontend/app/view/agents/chatcomposer.tsx`

Read `DESIGN.md`, the Prototype's `Main.dc.html` (its three tabs) and `chatfooter.tsx`'s model chip menu (the upward
`PopoverReveal`, Escape, outside press, arrow keys, `data-owns-keys` while open) first. The canvas's hex colours are
placeholders: use the tokens named here.

**Step 1: PickerList** (`pickerlist.tsx`) takes two optional props, its other callers unchanged: `groups?: { title:
string; count: number; start: number }[]` (a header before the item at index `start`: `px-2 pb-1 pt-2 text-[11.5px]
text-muted`, the count `text-ink-faint tabular-nums` after a 6 px gap; headers are not options and the keys skip
them), and `footer?: ReactNode` (drawn under the scroller, outside it). With either set, the list's own box is
`max-h-[420px]` with the scroller `overflow-y-auto` inside and the footer fixed under it; keep the highlighted row
scrolled into view as it does now.

**Step 2: The menu** (`slashmenu.tsx`): `useSlashMenu` takes `blockId?: string`. Each time `open` turns true, ask
`RpcApi.GetClaudeLiveCommandsCommand(TabRpcClient, { blockid })` (field name as generated) when there is a block id;
a non-empty answer → `fromLive(answer)` and `live = true`; else the fallback as today (`mergeCommands(BUILTIN_COMMANDS,
ListClaudeCommandsCommand…)`), `live = false`. Keep the last list between opens so it shows at once. Items are
`slashGroups(slashMatches(query, commands))` flattened, `groups` its headers. Rows (the canvas's): the name
`w-[210px] shrink-0 truncate text-[13px] text-ink-hi` (`/name`), the description `min-w-0 flex-1 truncate
text-[12px] text-muted`, a plugin chip when `plugin` is set and the name does not already start with `<plugin>:`
(`shrink-0 rounded-[6px] border border-edge-mid px-1.5 text-[11px] text-muted`), and "opens in Terminal" for `tui`
(`text-[11px] text-ink-faint`, `title="Opens a menu on Claude Code's own screen"`). Footer: `flex gap-3.5 border-t
border-edge-faint px-3.5 py-[7px] text-[11.5px] text-ink-faint`, `↑↓ move`, `Tab complete`, `Enter run` with the key
in `font-mono text-muted`, a spacer, then `N commands in this session` (live) or `N commands found on disk`
(fallback), N being every command, not the matches. `commands` (the returned field `opensTui` reads) is the current
list. `data-chat-slash` stays on the list, `data-chat-slash-item` on rows; add `data-chat-slash-group` on headers and
`data-chat-slash-live="true|false"` on the list.

**Step 3: The + menu** (`chatplusmenu.tsx`, header comment): `ChatPlusMenu({ onAttach, onText, onSend, disabled })`
draws the 28×28 button (lucide `Plus` 16px, `rounded-[8px] text-ink-mid hover:bg-surface-hover`, `aria-label="Add
files, a folder or a command"`, `aria-haspopup="menu"`, `aria-expanded`, `data-chat-plus`, `data-chat-attach`) and an
upward menu `w-[260px] rounded-[12px] border border-edge-mid bg-surface-raised p-1.5` with the chip menus' shadow and
reveal, `role="menu"`, `data-chat-plus-menu`, `data-owns-keys` while open. Rows `role="menuitem"`, `flex w-full
items-center gap-2.5 rounded-[6px] px-2 py-[7px] text-[13px] text-ink-hi`, highlighted `bg-surface-hover`, icon 15px
in an 18 px slot `text-ink-mid`, label `flex-1 text-left`, key hint `font-mono text-[11.5px] text-ink-faint`, and
`ChevronRight` 12px on the two that lead on; `data-chat-plus-item="files|folder|slash|mcp|plugins"`:
Paperclip "Add files or photos" `Ctrl+U` → `onAttach()`; Folder "Add folder" `/add-dir` → `onText("/add-dir ")`;
SquareSlash "Slash commands" `/` → `onText("/")`; Blocks "MCP servers" → `onSend("/mcp")`; Plug "Plugins" →
`onSend("/plugin")`. Escape and an outside press close it and give focus back to the box; ↑↓ move, Enter picks.

**Step 4: The composer** (`chatcomposer.tsx`): replace `<AttachButton onClick={attach} />` with `<ChatPlusMenu …/>` in
the same fold (it folds out while asleep exactly as attach did). `onText(t)`: an empty box becomes `t`; a box that
already starts with `/` is left as it is; any other text gets `t` put before it. Then focus the box with the caret
right after `t`, so the slash menu opens on a lone `/`. `onSend(t)`: send `t` through the same path as a typed message (it reaches
`opensTui`, which flips to Terminal). Pass `blockId: agent.blockId` to `useSlashMenu`. Ctrl+U (Cmd+U on a Mac) in the
box calls `attach()` and is prevented, unless the slash menu or a mention list is open.

**Step 5:** `npx vitest run frontend/app/view/agents/slashcommands.test.ts` → PASS; eslint and prettier on the four
files → clean apart from what HEAD already fails (compare with `git show HEAD:<file> | npx prettier --stdin-filepath
<file>`).

**Step 6:** Commit: `git commit -m "feat(chat): the slash menu lists every command the session offers, grouped, and a
+ menu replaces attach" -- <the four paths>`

### Task 5: Scenario steps, changelog, hand checks

**Depends on:** Task 4 (asserts the menus it draws), Task 1 (mocks the RPC it adds), Task 2 (the hand check exercises its publish)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

**Step 1: Scenario steps** in `agent-chat` (`scripts/cdp/scenarios.mjs`; read the scenario's header and its mock
layer, which answers `ListClaudeCommandsCommand` with `AC_COMMANDS`; never run prettier on this file). Make the mock
answer `GetClaudeLiveCommandsCommand` for the main agent's block with a fixed list: 12 `builtin` (among them `clear`,
`compact`, `model`, `release-notes`, `resume`, `review`, `code-review`), 2 `user`, 4 `plugin` (`arc:council` with
`plugin: "arc"`, `skim` with `plugin: "skim"`), 1 `mcp`; and nothing for other blocks. Update the existing `/` menu
step to the new rows (find it by `data-chat-slash`). Steps 50-53, each with its shot, one per canvas tab plus the
fallback:

- `agent-chat-50-slash-all` ("Typing /"): type `/` in the main agent's box → `[data-chat-slash-live="true"]`, four
  `[data-chat-slash-group]` headers in order Built-in, Skills, Plugins, MCP with counts 12, 2, 4, 1, all 19 rows
  present (no cap), the list's height at most 420 px with its scroller scrollable, the footer reads "19 commands in
  this session", the `skim` row shows the `skim` chip and the `model` row "opens in Terminal".
- `agent-chat-51-slash-filter` ("Typing /re"): type `re` → only rows holding `re`, `release-notes`, `resume` and
  `review` before names that only contain it, groups with no match gone; ↓ then Tab puts the second row's
  `/<name> ` in the box.
- `agent-chat-52-plus` ("The + menu"): click `[data-chat-plus]` → `[data-chat-plus-menu]` with the five items in
  order; Escape closes it and focus is back in the box; open again, pick `slash` → the box holds `/` and the slash
  list is open; open again, pick `mcp` → the mock records `/mcp` typed and the cell flips to Terminal (flip back in
  the step's cleanup).
- `agent-chat-53-slash-fallback`: in the second agent's box (no live list) type `/` →
  `[data-chat-slash-live="false"]` and the footer reads "… commands found on disk".

**Step 2:** `node scripts/cdp/final-verify.mjs agent-chat` → every step PASS.

**Step 3: Changelog** (`CHANGELOG.md`, top `Unreleased` section; read its header first): under `Changed`: `- The /
menu in Chat lists every command Claude Code offers in that session (built-ins, its own skills, plugins, MCP),
grouped and scrolling, and the + button opens a menu: add files or a folder, slash commands, MCP servers, plugins.`

**Step 4: Hand checks** (`docs/hand-checks.md`, at the top, `(arcterm)` title): start a new Claude agent after this
build → in its Chat, `/` lists `/code-review`, `/simplify` and `/skim` and the footer says "in this session", matching
Claude Code's own `/` typeahead in the terminal; connect an MCP server mid-session → its prompts show on the next `/`
after a message; an agent started before the build shows the "found on disk" fallback; Ctrl+U opens the file picker.

**Step 5:** Commit: `git commit -m "test(chat): scenario steps for the grouped slash menu and the + menu" --
scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md`
