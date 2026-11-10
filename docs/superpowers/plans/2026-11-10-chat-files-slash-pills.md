# Chat: the full slash menu and + menu, file cards and pills, folded pasted and tagged content, and an @ that walks folders

**Verify:** `node scripts/verify.mjs ./pkg/claudecmds/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat agent-sleep launcher`
**Prototype:** D:/work/arcterm/.superpowers/design/chat-slash-menu/project/

Runs after run b539a1af (inline visuals in Chat) has landed: it edits `chatcomposer.tsx`, `chatpane.tsx` and
`markdownmessage.tsx` too. One run for three plans the person asked to merge (2026-11-10): Part A (the slash menu),
Part B (files and tagged content in your bubble) and Part C (pills in the box, the folder walk). Part C's box
rewrite comes after Part A's menus (Task 12 depends on Task 4); the three scenario tasks run last, one after another,
since they share `scripts/cdp/scenarios.mjs`, `CHANGELOG.md` and `docs/hand-checks.md`.

**Part A: every slash command, grouped, and the + menu (tasks 1-4, 13)**

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

**Part B: your sent files as cards, mentions as pills, pasted and tagged content folded (tasks 5-8, 14)**

Your bubble in Chat shows a sent file as text: the composer sends attachments as a trailing block
(`composerattachments.ts:49-58`, `Attachments (read these files):` then `- <path>` lines), and the bubble prints it
as is; an `@path` you mentioned is plain text too. Images are already drawn as pictures (`chatconversation.tsx:85-95`,
`splitAttachedImages`, `launcherimages.ts:65-81`). This plan draws the files the way the canvas
`.superpowers/design/chat-file-mentions/project/Main.dc.html` ("Sent" and "Edge cases" tabs) shows: a mention is a
pill in the text, and attached files are cards under the bubble. The pills in the box while you type are Part C;
both read mentions with `filementiontokens.ts` (`mentionTokens`,
`mentionBaseName`), which is on `main` already: do not change its rule.

Decisions:

- **Parse the text you sent, do not change what is sent.** The agent reads the same message as before; only your
  bubble draws it differently. The pending bubble (`chatpane.tsx` `PendingBubble`) draws the same way, so nothing
  jumps when the transcript's copy replaces it.
- **A card opens the file in the File tab**, as a path link does (`PathLink`, `pathlinkcontext.tsx:27`); a pill
  too. A relative mention resolves against the agent's folder, as `PathLink` already does.
- **Size and "Not found" come from `FileInfoCommand`**, one call per card when it mounts; failure or `notfound`
  draws the missing card. No watcher.
- **Five cards, then "+N more"**, which unfolds in place (per bubble, not persisted).

**Part C: file pills in the message box, and an @ that walks folders (tasks 9-12, 15)**

Two things the person asked for, both in the canvas `.superpowers/design/chat-file-mentions/project/Main.dc.html`
("Typing" tab, and the Backspace case under "Edge cases"):

1. **A file you `@`-mention shows as a pill in the box** (file icon and the short name, the full path on hover),
   not as `@docs/notes/related.tex`. A `<textarea>` cannot draw a pill, so the box becomes a small rich
   editor on **Lexical 0.53.0**, which `main` already depends on (`10859ad8f`; installed in the main checkout, which
   every run worktree junctions: never run `npm install` in a run). Lexical handles IME composition, which the
   person relies on (Vietnamese Telex), better than a hand-rolled `contenteditable`.
2. **`@` walks folders**: `@../`, `@./`, `@~/`, `@D:/` or `@/` list that folder's entries, folders first, and a
   folder pick steps into it. Today `@` only ranks the project's own file list (`launchermention.ts`
   `fileMentionMatches`, `filemention.tsx` `reloadFileIndex`), and an agent outside a registered project gets no
   picker at all (`chatFilesRoot` returns `""`).

Decisions (the lead's calls, each with why):

- **The plain text stays the source of truth.** `useAgentSend`'s `text` keeps the message as the agent receives it,
  pills written as `@<path>` (quoted `@"…"` when the path holds a space). The editor is a view of that text: it
  splits it into text and pills with `mentionTokens(text, caret)` (`filementiontokens.ts`, on `main`; the bubble's
  pills use the same rule), and every edit serialises back to text and a caret. So the slash menu, the `@` picker,
  ↑ recall, the insert registries and the send path keep working on a string and offsets.
- **A pill is a Lexical `DecoratorNode`**, inline and keyboard-selectable: Backspace beside it selects it (the
  canvas's accent ring), a second Backspace deletes it whole; arrows step over it.
- **The editor looks like a textarea to its callers.** `EditorLike` is the part of `HTMLTextAreaElement` they use
  (`value`, `selectionStart`, `selectionEnd`, `readOnly`, `focus`, `setSelectionRange`, `getBoundingClientRect`), so
  the New launcher's Task box (a textarea) passes as is, and floating-ui anchors the pickers to it as a virtual
  element. Key handlers take a `KeyLike` (the fields they read), which a React keyboard event satisfies.
- **Never rebuild while composing.** An outside change to the text (a pick, recall, an insert) rebuilds the editor
  only when `editor.isComposing()` is false and the text differs from what the editor last emitted.
- **Folder walking reads the disk through wavesrv** (`RemoteListEntriesCommand`, the pattern in `canvassend.ts:80-87`),
  from the agent's folder (`cmd:cwd`), also when it is not a registered project; the project-wide ranking stays as it
  is for a bare query.

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

### Task 5: The pure parts

**Depends on:** none

**Files:** `frontend/app/view/agents/chatfiles.ts`, `frontend/app/view/agents/chatfiles.test.ts`

**Step 1: Write the failing tests** for each export below: `splitAttachments` on a message with only text, with the
files block, with the images block, with both (files block, blank line, images block, as `messageWithAttachments`
writes them), with a files block whose lines are not absolute paths (left as text), and with text only before
neither; `fileTag` for `.pdf`, `.tex`, `.ts`, `.md`, `.csv`, a name with no extension, a long extension (cut to 4);
`foldCards` under, at and over the limit, open and closed.

**Step 2:** `npx vitest run frontend/app/view/agents/chatfiles.test.ts` → FAIL.

**Step 3: Implement** (pure, header comment):

```ts
export const FILES_HEADER = "Attachments (read these files):"; // composerattachments.ts writes it; import it from there if exported, else export it there
export function splitAttachments(text: string): { text: string; files: string[]; images: string[] };
// images: splitAttachedImages first (the images block is always last); then a trailing FILES_HEADER block of "- <abs path>" lines
export type FileTone = "pdf" | "code" | "doc" | "data" | "other";
export function fileTag(name: string): { tag: string; tone: FileTone }; // tag: the extension upper-cased, at most 4, "FILE" with none
// pdf → pdf; ts tsx js jsx go rs py tex sh json yaml toml css html → code; md txt docx → doc; csv tsv xlsx parquet → data
export const CARD_LIMIT = 5;
export function foldCards<T>(items: T[], open: boolean): { shown: T[]; more: number };
```

**Step 4:** the Step 2 command → PASS; eslint and prettier on both → clean.

**Step 5:** Commit: `git commit -m "feat(chat): read the files and images a sent message carries" --
frontend/app/view/agents/chatfiles.ts frontend/app/view/agents/chatfiles.test.ts`

### Task 6: Mention pills in markdown

**Depends on:** none

**Files:** `frontend/app/view/agents/remarkfilemention.ts`, `frontend/app/view/agents/remarkfilemention.test.ts`, `frontend/app/view/agents/chatfilepill.tsx`, `frontend/app/view/agents/markdownmessage.tsx`

Read `frontend/app/element/remark-mark.ts` (the pattern: a remark plugin turning text into a custom node) first.

**Step 1: Write the failing test** (`remarkfilemention.test.ts`, run the plugin through `unified().use(remarkParse)
.use(remarkFileMention)` as remark-mark's own test does, if it has one; else on a hand-built mdast): a paragraph
`see @src/app.ts and @alice` gives a `filemention` node with `data.hName = "filemention"`, `data.hProperties.path =
"src/app.ts"`, its text kept, and `@alice` stays text; nothing changes inside inline code, a code block or a link.

**Step 2:** `npx vitest run frontend/app/view/agents/remarkfilemention.test.ts` → FAIL.

**Step 3: Implement.**
- `remarkfilemention.ts`: split each text node by `mentionTokens(value)` (no caret) into text and `filemention` nodes
  (`children: [{ type: "text", value: <the @ token as written> }]`), skipping `inlineCode`, `code` and `link`
  ancestors.
- `chatfilepill.tsx`: `FilePill({ path })`, the canvas's pill: a `PathLink` (path, no line) wrapping `<span
  data-chat-file-pill={path} title={path} className="inline-flex h-5 max-w-full items-center gap-1 rounded-[6px]
  border border-edge-mid bg-surface px-1.5 align-middle text-[12.5px] leading-none text-ink-hi hover:bg-surface-hover">`
  with lucide `File` 12px `text-muted` `aria-hidden` and `<span className="max-w-[220px] truncate">
  {mentionBaseName(path)}</span>`. `align-middle` and `leading-none` matter: an inline-flex box whose first child is
  an icon aligns on the icon's bottom edge otherwise and rides high (the person's review of the canvas).
- `markdownmessage.tsx`: `MarkdownExtras.mentions?: boolean`; with it, add `remarkFileMention` to the plugins and a
  `filemention` component drawing `FilePill`; extend `componentsFor`'s key and the plugin choice (`renderMd`) so
  marks, diagrams and mentions combine; say so in the extras comment.

**Step 4:** the Step 2 command → PASS; eslint and prettier on the four → clean apart from what HEAD already fails.

**Step 5:** Commit: `git commit -m "feat(chat): an @path in markdown can draw as a file pill" -- <the four paths>`

### Task 7: Cards and pills in your bubble

**Depends on:** Task 5 (`splitAttachments`, `fileTag`, `foldCards`), Task 6 (`mentions` and `FilePill`)

**Files:** `frontend/app/view/agents/chatfilecards.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/narrationtimeline.tsx`, `frontend/app/view/agents/chatpane.tsx`

**Step 1: The cards** (`chatfilecards.tsx`, header comment): `ChatFileCards({ paths })`, a `flex flex-wrap justify-end
gap-2` row, `data-chat-file-cards`. Each card, the canvas's: a `button` (open the file as `PathLink` does: use the
same opener it calls) `data-chat-file-card={path}`, `title={path}`, `flex h-[46px] w-[236px] items-center gap-2.5
rounded-[8px] border border-edge-mid bg-surface px-2.5 text-left hover:bg-surface-hover`; a 30×30 tile `flex-none
rounded-[6px] bg-surface-hover font-mono text-[9.5px] font-semibold` centred, its colour by tone (pdf `text-error`,
code `text-accent-soft`, data `text-accent-soft`, doc and other `text-muted`), holding `fileTag(name).tag`; then the
name `max-w-[168px] truncate text-[12.5px] text-ink-hi` over the sub line `max-w-[168px] truncate text-[11px]
text-ink-faint`: the parent folder's name, then ` · ` and the size once `FileInfoCommand` answers (format it as the
tray does, `attachmenttray.tsx` `fmtSize`; export it from there if it is not). Missing (`notfound` or an error):
`opacity-60`, the name `line-through`, the sub line `Not found` in `text-error`, `data-chat-file-missing`; still a
button (the path can be copied from its title). `foldCards(paths, open)`: past `CARD_LIMIT` a `+N more` button
`h-[22px] rounded-[6px] border border-edge-mid px-2 text-[12px] text-muted hover:text-secondary`,
`data-chat-file-more`, unfolds.

**Step 2: The bubble** (`chatconversation.tsx` `YouBubble`): `splitAttachments(item.text)` in place of
`splitAttachedImages`; the bubble draws `said.text` with mentions (Step 3) and the pictures as now; the bubble and a
`ChatFileCards` of `said.files` (when any) stack in a `flex flex-col items-end gap-2` wrapper that keeps the bubble's
`max-w-[75%] self-end`; copy and the context menu keep the whole original text. A message that is only files draws
the cards with no empty bubble.

**Step 3: Mentions in the bubble** (`narrationtimeline.tsx` `PromptText`): an optional `mentions` prop passed to
`MarkdownMessage` as the `mentions` extra; only Chat's bubble and pending bubble pass it, so the narration timeline
and the other callers draw as before.

**Step 4: The pending bubble** (`chatpane.tsx` `PendingBubble`): the same split, pills and cards, so the bubble does
not change when the transcript's copy replaces it.

**Step 5:** eslint and prettier on the four → clean apart from what HEAD already fails (compare with `git show
HEAD:<file> | npx prettier --stdin-filepath <file>`).

**Step 6:** Commit: `git commit -m "feat(chat): your sent files show as cards and your @mentions as pills" -- <the
four paths>`

### Task 8: Pasted and tagged content as folded cards

**Depends on:** Task 7 (edits the same bubble code after it)

**Files:** `frontend/app/view/agents/chattagblocks.ts`, `frontend/app/view/agents/chattagblocks.test.ts`, `frontend/app/view/agents/chattagblock.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`

A user message often carries XML-tagged blocks the person never typed as such: `<pasted_content …>…</pasted_content>`
(a paste the harness wraps), `<system-reminder>`, `<task-notification>` (already a marker, leave it),
`<command-name>` / `<command-message>` / `<command-args>`, `<local-command-stdout>`, `<local-command-caveat>`, and any
other `<tag>…</tag>` a hook or tool adds. Chat prints them raw in your bubble today. The person asked for a custom UI
for pasted content and all XML content: each block draws as a folded card.

**Step 1: Write the failing tests** (`chattagblocks.test.ts`): `splitTagged` keeps plain text as one text part; finds
a block whose open tag starts a line (attributes allowed: `<pasted_content id="a1b2">`) and whose matching close tag
ends one, returning text before, the block (`tag`, `attrs` as a record, `body` trimmed of one leading and trailing
newline) and text after; handles two blocks and a block of a tag nested in another tag's body (only the outer one
is split); leaves an unclosed tag, a tag that does not start a line, a closing tag of another name, and anything
inside a ``` fence as text; `tagLabel` maps `pasted_content` → `Pasted`, `system-reminder` → `System reminder`,
`local-command-stdout` → `Command output`, `local-command-caveat` → `Note`, `command-name` → `Command`, and any other
tag to its words capitalised (`foo_bar-baz` → `Foo bar baz`); `lineCount` counts lines.

**Step 2:** `npx vitest run frontend/app/view/agents/chattagblocks.test.ts` → FAIL.

**Step 3: Implement** `chattagblocks.ts` (pure, header comment naming the tags it was written for and that any tag
folds) with `splitTagged(text): ({ kind: "text"; text: string } | { kind: "tag"; tag: string; attrs: Record<string,
string>; body: string })[]`, `tagLabel(tag)`, `lineCount(body)`. Tag names `[A-Za-z][\w-]{0,63}`; `task-notification`
is never split (the projection turns it into a marker before it reaches a bubble).

**Step 4: The card** (`chattagblock.tsx`): `ChatTagBlock({ tag, attrs, body })`, `data-chat-tag={tag}`, a `<details>`
-like toggle drawn with a button (keyboard and `aria-expanded`), closed at first: `w-full rounded-[8px] border
border-edge-mid bg-surface`; the header `flex h-8 w-full items-center gap-2 px-3 text-[12px] text-muted
hover:text-secondary`: lucide `ClipboardPaste` 13px for `pasted_content`, `Terminal` for the `command-*` and
`local-command-*` tags, `Braces` for any other; `tagLabel(tag)`; for a paste, ` · N lines` (`lineCount`); a `flex-1`
spacer; `ChevronRight` 12px turning to `ChevronDown` when open. Open, the body under a `border-t border-edge-faint`:
`max-h-[320px] overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap text-ink-mid
[overflow-wrap:anywhere]`, with a `CopyButton` (`@/app/element/copybutton`) in its top-right corner copying `body`.
A `command-name` block whose sibling blocks are `command-message` / `command-args` draws as one card labelled with the
command (`/name args`), its body the message.

**Step 5: Wire it** in `YouBubble` and `PendingBubble`: `splitTagged(said.text)`; text parts draw as `PromptText` with
mentions as now, tag parts as `ChatTagBlock` inside the bubble, full width of the bubble, `my-1.5`. A message that is
only tag blocks keeps the bubble.

**Step 6:** the Step 2 command → PASS; eslint and prettier on the five → clean apart from what HEAD already fails.

**Step 7:** Commit: `git commit -m "feat(chat): pasted and XML-tagged content in your messages folds into cards" --
<the five paths>`

### Task 9: The editor's text model

**Depends on:** none

**Files:** `frontend/app/view/agents/chateditormodel.ts`, `frontend/app/view/agents/chateditormodel.test.ts`

**Step 1: Write the failing tests** for each export: `segmentsOf("see @src/a.ts now", 17)` → text, pill
(`src/a.ts`), text; the caret inside a still-typed token keeps it text; `mentionText` quotes a path with a space;
`plainOffset` and `locate` round-trip every offset of a text with two pills, and an offset inside a pill's text snaps
to its end.

**Step 2:** `npx vitest run frontend/app/view/agents/chateditormodel.test.ts` → FAIL.

**Step 3: Implement** (pure, header comment):

```ts
export type Segment = { kind: "text"; text: string } | { kind: "pill"; path: string };
export function mentionText(path: string): string; // `@path`, or `@"path"` when it holds whitespace
export function segmentsOf(text: string, caret?: number): Segment[]; // mentionTokens(text, caret), merged text runs
export function segmentLength(s: Segment): number; // text length, or mentionText(path).length
export function plainOffset(segments: Segment[], index: number, offset: number): number; // offset 0|1 for a pill: before|after
export function locate(segments: Segment[], plain: number): { index: number; offset: number };
```

**Step 4:** the Step 2 command → PASS; eslint and prettier → clean.

**Step 5:** Commit: `git commit -m "feat(chat): the message box's text model: text runs and file pills" --
frontend/app/view/agents/chateditormodel.ts frontend/app/view/agents/chateditormodel.test.ts`

### Task 10: `@` walks folders

**Depends on:** none

**Files:** `frontend/app/view/agents/launchermention.ts`, `frontend/app/view/agents/launchermention.test.ts`, `frontend/app/view/agents/filemention.tsx`

**Step 1: Write the failing tests** (extend `launchermention.test.ts`): `browseQuery` → `{ dir: "../", leaf: "" }`
for `../`, `{ dir: "../src/", leaf: "ap" }` for `../src/ap`, the same shapes for `./`, `~/`, `D:/x/`, `D:\x\`, `/etc/`,
and `null` for `src/ap` and `foo`; `resolveBrowseDir(base, dir, home)` joins and normalises (`..` steps up, `~` is home,
an absolute dir ignores base; forward slashes); `browseMatches(entries, leaf)` lists folders first then files, each
alphabetical case-insensitively, prefix matches before contains, hides dot-names unless `leaf` starts with `.`, at
most 50; `insertBrowsePick(text, start, caret, dir, entry)`: a folder → `@<dir><name>/` with no space and the caret
after it (the picker stays open), a file → `@<dir><name> ` as `insertFileMention` does.

**Step 2:** `npx vitest run frontend/app/view/agents/launchermention.test.ts` → FAIL.

**Step 3: Implement** the four in `launchermention.ts`. `fileMentionAt`'s pattern already stops at whitespace and
allows `/`, `\`, `.`, `~` and `:`; check it keeps `D:/` (widen it if not).

**Step 4: The picker** (`filemention.tsx`): an optional `cwd` (the agent's `cmd:cwd`); when `browseQuery(query)` is
not null, list `resolveBrowseDir(filesRoot || cwd, dir, home)` with `RemoteListEntriesCommand` (one listing per
directory, kept in state while the picker is open), and show `browseMatches`; a folder row draws lucide `Folder`, its
name with a trailing `/`, a file row `File`; Tab or Enter on a folder calls `insertBrowsePick` and keeps the list open
on the new folder; Esc closes. A listing error shows the picker's note `Cannot read <dir>`. When `filesRoot` is `""`
but `cwd` is set, browse mode works and a bare query lists nothing (as today). Pass `cwd` from the chat box
(`chatcomposer.tsx` reads `block.meta["cmd:cwd"]` already) in Task 12, not here.

**Step 5:** the Step 2 command → PASS; eslint and prettier on the three → clean apart from what HEAD already fails.

**Step 6:** Commit: `git commit -m "feat(chat): @ walks folders: ../, ~/, a drive, and into a picked folder" -- <the
three paths>`

### Task 11: The Lexical editor and its pill

**Depends on:** Task 9 (its text model)

**Files:** `frontend/app/view/agents/chateditor.tsx`, `frontend/app/view/agents/chateditorpill.tsx`

Read `node_modules/lexical` and `node_modules/@lexical/react` docs or types for `LexicalComposer`,
`PlainTextPlugin`, `ContentEditable`, `HistoryPlugin`, `DecoratorNode`, `KEY_DOWN_COMMAND`, `PASTE_COMMAND`,
`registerUpdateListener`, `isComposing`.

**Step 1: The pill node** (`chateditorpill.tsx`): `FileMentionNode extends DecoratorNode<JSX.Element>`, inline,
`isKeyboardSelectable() → true`, `getTextContent() → mentionText(path)`, JSON import/export, and `decorate()` →
`<span data-chat-pill={path} title={path} className="mx-px inline-flex h-5 max-w-[240px] items-center gap-1
rounded-[6px] border px-1.5 align-middle text-[12.5px] leading-none text-ink-hi">`: unselected `border-edge-mid
bg-surface`, selected (the node is in a `NodeSelection`) `border-accent bg-accent/12` with the icon `text-accent-soft`;
lucide `File` (or `Folder` for a path ending in a separator) 12px `text-muted` `aria-hidden`, then `<span
className="truncate">{mentionBaseName(path)}</span>`. `align-middle leading-none` keeps it centred on the text line
(the person's canvas review). `$createFileMentionNode(path)`, `$isFileMentionNode`.

**Step 2: The editor** (`chateditor.tsx`, header comment saying it is a view of plain text and why):
`ChatEditor` as a `forwardRef<EditorLike>` with props `{ value: string; onChange(text: string, caret: number): void;
onKeyDown?(e: KeyLike): void; onPasteFiles?(e: ClipboardEvent): boolean; placeholder: string; readOnly?: boolean;
className?: string; minHeight: number; maxHeight: number; dataAttrs?: Record<string, string> }`:

- `LexicalComposer` with the node, `PlainTextPlugin` with a `ContentEditable` (`data-chat-input`, `role="textbox"`,
  `aria-multiline="true"`, `aria-label="Message"`, `className` + `overflow-y-auto outline-none whitespace-pre-wrap
  [overflow-wrap:anywhere]`, `style={{ minHeight, maxHeight }}`, `leading-[1.9]` so a pill fits the line) and its
  placeholder drawn where the textarea's was, `HistoryPlugin`.
- An update listener: unless the update is tagged `"external"` or the editor is composing, read the root as
  `Segment[]` (a text node's text, a pill's path, a paragraph break as `\n`), compute the caret with `plainOffset`
  from the selection, remember the text as last emitted, call `onChange`.
- When `value` differs from the last emitted text and the editor is not composing: `editor.update(() => rebuild
  (segmentsOf(value, caretRequest)), { tag: "external" })`, the caret put back with `locate`.
- `KEY_DOWN_COMMAND` at high priority: call `onKeyDown` with a `KeyLike` wrapping the native event; return `true`
  when it called `preventDefault` (so Enter sends instead of breaking the line, and the menus get their arrows).
- `PASTE_COMMAND`: when the clipboard holds files, `onPasteFiles?.(e)` and return its answer; otherwise let
  `PlainTextPlugin` paste plain text.
- `readOnly` → `editor.setEditable(!readOnly)`.
- The `EditorLike` handle: `value` (last emitted text), `selectionStart`/`selectionEnd` (plain offsets of the current
  selection), `readOnly`, `focus(opts)`, `setSelectionRange(a, b)` (via `locate`), `getBoundingClientRect()` of the
  content-editable root.
- Export `EditorLike` and `KeyLike` types from here.

**Step 3:** eslint and prettier on both → clean.

**Step 4:** Commit: `git commit -m "feat(chat): a Lexical message editor that draws @mentions as file pills" --
frontend/app/view/agents/chateditor.tsx frontend/app/view/agents/chateditorpill.tsx`

### Task 12: The chat box uses it

**Depends on:** Task 11 (the editor), Task 10 (edits `filemention.tsx` before this task retypes it), Task 4 (rewrites the box, `slashmenu.tsx` and `pickerlist.tsx` after Part A's menus)

**Files:** `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/slashmenu.tsx`, `frontend/app/view/agents/filemention.tsx`, `frontend/app/view/agents/pickerlist.tsx`, `frontend/app/view/agents/chatinsert.ts`

**Step 1: Retype the pickers.** `pickerlist.tsx` (`usePickerFloating`, `PickerList`) takes `RefObject<EditorLike |
null>` as its anchor (floating-ui's `setReference` accepts a virtual element with `getBoundingClientRect`);
`useSlashMenu` and `useFileMention` take `inputRef: RefObject<EditorLike | null>`, `onKeyDown(e: KeyLike)`,
`onCaret(el: EditorLike)`. A textarea satisfies both types, so the New launcher's Task box compiles unchanged: check it
with `task check:ts`.

**Step 2: Swap the textarea** in `chatcomposer.tsx` for `<ChatEditor ref={editorRef} value={text} onChange={(t, c)
=> { setText(t); slash.onCaret(editorRef.current!); mention.onCaret(editorRef.current!); }} …/>`, keeping every
handler the textarea had (the menus' keys, recall, Enter to send and Shift+Enter for a new line, Ctrl+U, paste of
files through `att.onPaste`, drop on the container) and its classes for size and type; `useGrowingTextarea` goes (the
editor grows itself between `ChatMinH` and `ChatMaxH`). Every `taRef` use becomes `editorRef`: the insert registry
(`chatinsert.ts` stays a string API; `insertAt` works on `editorRef.current.value` and its selection), the visuals
run's submit and text registries, `caretAfter`, focus calls, `readOnly` checks. Pass `cwd` to `useFileMention`.
The box keeps `data-sleeping-composer` and `data-agent-chat-composer` on its wrapper.

**Step 3:** `npx vitest run frontend/app/view/agents` (the agents folder's unit tests) → PASS; `task check:ts` → exit
0; eslint and prettier on the five → clean apart from what HEAD already fails.

**Step 4:** Commit: `git commit -m "feat(chat): the message box draws @mentions as pills" -- <the five paths>`

### Task 13: Scenario steps, changelog, hand checks

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
### Task 14: Scenario steps, changelog, hand check

**Depends on:** Task 7 (asserts the cards and pills), Task 8 (asserts the folded tag cards), Task 13 (edits the same scenario, changelog and hand-check files after it)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

**Step 1: Scenario steps** in `agent-chat` (read its header and fixture transcript writer; never run prettier on
this file), numbered 60-62. Arrange, in the scenario's temp dir: `notes.md` (a few bytes) and `paper.pdf` (a few
bytes); append to the main agent's fixture transcript one user entry: `Compare @src/app.ts with the notes\n\n
Attachments (read these files):\n- <tmp>/notes.md\n- <tmp>/paper.pdf\n- <tmp>/gone.md`, and one with eight files
(seven `<tmp>/f<N>.txt` written, one missing). Each step takes its shot:

- `agent-chat-60-file-cards`: the first bubble's text holds no "Attachments (read these files)"; `[data-chat-file-pill
  ="src/app.ts"]` reads `app.ts` and its vertical centre is within 2 px of the text line's centre (compare with a
  sibling text range's `getBoundingClientRect`); three `[data-chat-file-card]` with tags `MD`, `PDF`, `MD`, and the
  `paper.pdf` card's sub line holds a size.
- `agent-chat-61-file-missing`: the `gone.md` card has `data-chat-file-missing` and reads `Not found`.
- `agent-chat-62-file-more`: the eight-file bubble shows five cards and `+3 more`; a click shows all eight.
- `agent-chat-63-tag-blocks`: a third user entry `Look at this\n<pasted_content id="p1">\nline one\nline two\nline
  three\n</pasted_content>\n<system-reminder>\nkeep it short\n</system-reminder>` → no `<pasted_content` or
  `<system-reminder` text in the bubble; `[data-chat-tag="pasted_content"]` reads `Pasted · 3 lines`, closed; a click
  opens it and shows `line two`; `[data-chat-tag="system-reminder"]` reads `System reminder`.

**Step 2:** `node scripts/cdp/final-verify.mjs agent-chat` → every step PASS.

**Step 3: Changelog** under `Changed`: `- In Chat, the files you send show as cards under your message (type, name,
folder and size; click to open), the files you @mention as pills, and pasted or tagged content (a paste, a system
reminder, command output) as a folded card, instead of raw paths and tags.`

**Step 4: Hand check** (`docs/hand-checks.md`, top, `(arcterm)` title): send a message with a dropped PDF, a picked
`.ts` file and an `@` mention in a live Claude agent's Chat → pill and cards as the canvas draws them; a card and a
pill open the file in the File tab; delete one file → its card reads Not found after a reload.

**Step 5:** Commit: `git commit -m "test(chat): scenario steps for file cards and mention pills" --
scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md`
### Task 15: Scenario steps, changelog, hand checks

**Depends on:** Task 12 (the box the steps type into), Task 10 (the folder walk they assert), Task 14 (edits the same scenario, changelog and hand-check files after it)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

**Step 1: Retarget the box.** Every `agent-chat` and `agent-sleep` step that finds the box as a `textarea` (`[data-sleeping-composer] textarea`, `[data-agent-chat-composer] textarea`,
or sets `.value`) now targets `[data-chat-input]`: focus it and type with CDP `Input.insertText`, read it with
`innerText`. Keep each step's meaning; never run prettier on this file.

**Step 2: New steps** in `agent-chat`, numbered 70-73, each with its shot:

- `agent-chat-70-pill`: type `@` then part of a fixture file's name, Enter → `[data-chat-pill]` reads its base name and
  sits centred on the line (its vertical centre within 2 px of the caret line's); send → the mock records `@<path>`
  in the typed text, then `\r`.
- `agent-chat-71-pill-backspace`: with the caret after a pill, Backspace → the pill shows the selected look
  (`border-accent`); Backspace again → no pill and the box's text has no `@`.
- `agent-chat-72-at-folders`: in the scenario's temp dir as the agent's `cmd:cwd` (or a folder the fixture already
  uses), type `@../` → rows for the parent's entries, folders first with a trailing `/`; Tab on a folder → the box reads
  `@../<folder>/` and the list shows that folder's entries.
- `agent-chat-73-recall-pills`: ↑ in the empty box after step 70's send → the recalled text shows the pill again.

**Step 3:** `node scripts/cdp/final-verify.mjs agent-chat agent-sleep launcher` → every step PASS.

**Step 4: Changelog** under `Changed`: `- Chat's message box shows a file you @mention as a pill, and @ walks folders:
type @../ or @D:/ to browse, Tab to step into a folder.`

**Step 5: Hand checks** (`docs/hand-checks.md`, top, `(arcterm)` titles): (a) type Vietnamese with Telex in the box,
before and after a pill, and with the `/` and `@` menus open: no lost or doubled letters, the caret stays put; (b)
paste a screenshot (an attachment chip), paste text (plain, no formatting), Alt-drop a file from the tree (its
`@mention` lands as a pill); (c) a long message scrolls inside the box past its max height, Shift+Enter breaks a line,
undo and redo work; (d) a sleeping agent's box wakes it with a pill in the message.

**Step 6:** Commit: `git commit -m "test(chat): scenario steps for file pills and the folder walk" --
scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md`
