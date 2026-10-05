# Agent + Sessions merge (Antigravity-style layout), 2x2 agent grid, and Uploads — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md` — read it in full before your task.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement your task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Agent surface replaces Agent + Sessions: a sidebar of projects with running and recent conversations,
the live TUI in the middle, a counted right rail (Subagents, Files Changed, Artifacts, Uploads, Background Tasks,
Terminals), a drag-and-drop grid of up to 2x2 live terminals, and an Uploads list fed by paste, drop and Attach.

**Architecture:** Pure models with a `.test.ts` beside each (`agentsidebarmodel.ts`, `agentgrid.ts`,
`uploadsstore.ts`, `uploadfile.ts`, the rail planner); thin React wiring on top; state in module-level jotai atoms
(`agentcenter.ts`, `gridstore.ts`, `uploadsstore.ts`). The terminal stack in `agentsurface.tsx` keeps every
`CockpitFocusPane` mounted under one parent with stable keys and becomes a CSS grid, so no xterm remounts. The
Sessions surface is removed and its master-detail is embedded as `ConversationHistory`.

**Tech Stack:** React 19, jotai, TypeScript, vitest, Tailwind 4, HTML5 drag and drop, `@tauri-apps/plugin-dialog`,
CDP scenarios (`scripts/cdp/scenarios.mjs`). No Go changes, so no `task generate`.

## How to work this plan

- **Work on `main`.** No branches, no worktrees. Each task ends with a commit step.
- **No builds while developing** (the machine lags). Do not run `task build:*`, `cargo ...`, the whole vitest
  suite, or `scripts/cdp/final-verify.mjs`. Test with one file at a time: `npx vitest run <file>`. UI checks are
  CDP scenarios against an already-running `task dev` app (`task verify:ui -- <scenario>`). The plan therefore has
  no `**Verify:**`, `**Check:**` or `**Final:**` line: `Final` cold-builds its own dev app. One `task check:ts`
  (about 2 minutes) is still wanted once at the very end; get the user's go-ahead before running it.
- **Other work lands on `main` while this runs** (the doc-review plan edits `agentsurface.tsx` and the canvas
  area too). Edits here are anchored by symbol or quoted text, not line numbers; re-read the file before editing
  and treat a mismatch with a `> NOTE:` as a reason to adapt, not to force the snippet in.
- **Stage order:** Tasks 1-9 (Stage 1) -> 10-16 (Stage 2) -> 17-22 (Stage 3) -> 23-29 (Stage 4). Each stage
  leaves the app working. Within a stage, tasks with no dependency between them can run together.

## Decisions to confirm (each is also a `> NOTE:` where it bites)

1. **Ctrl+Tab and the grid (Task 21).** Landing on an agent with no cell rewrites the focused cell, so cycling five
   agents through four cells keeps changing which four show. That is the spec's "same rule" taken literally; the
   alternative is to cycle only among agents already in the grid.
2. **History and the project filter (Stage 1 risks).** History keeps the app-bar project filter and Space scope,
   but the Agent surface is a "subject" surface, so the app-bar copy reads "Default · X" while History still
   filters by it.
3. **Sidebar crowding (Stage 1 risks).** A project with only ended sessions still gets a folder.
4. **`cycle-agent-prev` (Ctrl+Shift+Tab)** already means "asking agents only, forward" in the code, not "previous".
   Left as is.
5. **`agent:split` palette action (Task 21).** Added as a keyboard route for the grid; drop it if unwanted.
6. **A terminal's canvas (Task 13).** With the Terminals group gone from the tree, it is reached by focusing the
   terminal and using the header's Terminal/Canvas swap; `canvas-swap` and `canvas-tabs` are retargeted.
7. **Uploads are keyed by terminal block id, not agent id (Stage 4).** The paste hook cannot learn the agent;
   one live agent owns one block, so the effect is the same.


## Stages

## Stage 1: Sidebar merge, Conversation History, remove the Sessions surface

Goal: the Agent surface absorbs Sessions. Its sidebar lists, under each project, the live agents and then up to five ended
sessions (`Show more` +5); `Conversation History` and an ended session open in the centre column (`centerModeAtom`:
`terminal | session | history`); the Sessions surface, its nav item and its key slot are gone (`SURFACE_ORDER` 8 -> 7, Radar
becomes `Ctrl+6`, Usage `Ctrl+7`). The `Terminals` group stays in the tree (Stage 2 moves it). Spec:
`docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`, decisions 1-5, "Architecture notes", "Removal and retargeting".

All paths are relative to `D:\projects\arcterm`. Tests run one file at a time (`npx vitest run <file>`); no `tsc`, no builds.
UI checks are CDP scenarios against the already-running dev app (`task verify:ui -- <name>`, "requires `task dev` running").
When this was drafted the tree was clean at `2d5a33b7`; every edit below is anchored by symbol or by the quoted text, so
re-read the file before editing if HEAD has moved.

Tasks, in order (the tree compiles after each one):

- **Task 1** Pure modules `agentcenter.ts` (centre-mode atom + openers) and `agentsidebarmodel.ts` (merge live agents and ended
  sessions per project, dedupe, 5-row limit, Show more, title, age label, scan timing), each with its test.
- **Task 2** Move the Sessions master-detail into an embeddable `ConversationHistory` (`git mv`), give History its own Space
  reveal key; the old surface keeps working through the moved component until Task 7.
- **Task 3** Centre modes in `AgentSurface` (terminal stack stays mounted, hidden), a `SessionPane`, every route that chooses an
  agent returns the centre to the terminal, and a History link on the zero-agent hero.
- **Task 4** Keys: agent keys stand down while History/a session is open, `Esc` returns to the terminal, `g s` opens History.
- **Task 5** Sidebar UI in `AgentTree`: `Conversation History` button, ended-session rows, `Show more`, and the post-paint session
  scan (on entering the surface and on agent exit, never at boot, no polling).
- **Task 6** Retarget the palette's `session:open` action and the two user-facing strings that name the Sessions surface.
- **Task 7** Remove the surface: `SurfaceKey`, `SURFACE_ORDER`, nav rail, shell, `surfacecontext`, startup coercion, `Esc`-home set,
  `wsh ui` addresses, and every test that hard-codes the order.
- **Task 8** Docs and skill text: shortcuts, architecture, `AGENTS.md`, `README.md`, `skills/cockpit-ui/SKILL.md`, `scripts/cdp/attach.mjs`.
- **Task 9** CDP scenario `agent-history` (+ a settle step for `agent-tree-quick-return`).

> NOTE: spec decision 3 says status filters "and search" live in History. The old Sessions surface has no search box (only the
> All/Live/Needs you/Done chips), and decision 5 says History renders "unchanged", so no search is added here.

> NOTE: not in the spec but required: (a) with zero agents the Agent surface shows only `AgentLaunchHero` (no tree), so History
> would be unreachable; Task 3 keeps the tree and History reachable when a centre mode other than `terminal` is set, and adds a
> History link to the hero. (b) `cockpit/cockpitrail.tsx` uses `ICON.sessions` (the Events rail icon); Task 7 gives it its own icon.
> (c) `store/keybindings/whenstate.ts` `PREDICATE_ATOMS` must list `centerModeAtom` once a `when()` reads it (Task 4). (d) the
> session pane and History both hide the details rail (the rail describes the focused live agent, not the transcript on screen);
> the spec only says it for History.

---

## Stage 2: Rail sections (Artifacts, Uploads placeholder, Terminals) and the new order

Spec: `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`, decision 6 and the Terminals part of
decision 3. Assumes Stage 1 is done (Sessions surface gone, `centerModeAtom` exists, sidebar rebuilt). Every
edit below is anchored by symbol name; Stage 1 rewrote `agenttree.tsx` and touched `agentsurface.tsx`, so
where a snippet quotes the pre-Stage-1 text and Stage 1 changed the surroundings, find the symbol with
`Grep`, keep any new conjunct Stage 1 added, and change only the part the task names.

Task ids differ from the brief's Task 10..Task 15: the brief's "Task 12 Terminals" is split in two (data, then UI) so
neither is more than ~90 minutes, which shifts Uploads to Task 14, the default to Task 15 and the CDP scenario to Task 16.

| Task | Purpose |
|---|---|
| Task 10 | `planAgentRail` carries the new section ids and order (`artifacts`, `uploads`, `terminals`), `planTerminalRail`, and the `emptyOpenable` header flag; the rail lists the three sections as inert stubs so nothing breaks. |
| Task 11 | Artifacts section: the agent's canvas boards, click opens the canvas on that board. Pure `railartifacts.ts`. |
| Task 12 | Terminals data: `deriveTerminalVMs` carries a project, pure `railTerminals` (scope + show all), `railTerminalsAllAtom`. No UI. |
| Task 13 | Terminals section UI, a terminals-only rail for a focused terminal, the Terminals group leaves `agenttree.tsx`, `canvas-swap` and `canvas-tabs` retargeted. |
| Task 14 | Uploads section: the counted placeholder (empty text, disabled `+ Attach`) S4 wires. |
| Task 15 | Rail visible by default (`railVisibleAtom`, Settings row), with a test. |
| Task 16 | CDP: `agent-rail-sections` scenario, and `agent-tree-rail` step 10 on the new order. |

> NOTE (spec vs code, decision 6 "Terminals ... filtered to the selected agent's project when a terminal carries a
> project"): a terminal tab does carry `session:project` (`launchAgent` in `frontend/app/cockpit/cockpit-actions.ts`
> writes `{ "session:project": opts.projectName }` for a terminal too, and the session sidebar row has
> `projectLabel` and `cwd`). But `liveTerminalsAtom` elements are `AgentVM`s built by `deriveTerminalVMs`, which
> drops both, so `projectOf(terminal)` is `""` today. Task 12 makes the VM carry the project (registry project for the
> cwd first, then the launch label, exactly how `liveAgentBaseAtom` does it for agents). A terminal that names no
> project (made some other way) shows under every agent.

> NOTE (rail is hidden for terminals today): `agentsurface.tsx` renders `AgentDetailsRail` only when
> `agent.kind !== "terminal"`, and `cycleFocus`/`step` (Ctrl+Tab, arrows, j/k) walk `agentsAtom`/`orderAtom`, which
> hold no terminals. Once the Terminals group leaves the tree, the rail section is the only way to reach a
> terminal; hiding the rail while a terminal is focused would strand the user on it. Decision (Task 13): when a
> terminal is focused the surface renders `TerminalRail`, the same `CollapsibleRail` carrying the Terminals
> section alone (a terminal has no tools, files, run or usage), so you can hop terminal to terminal and back to an
> agent from the tree. A terminal's canvas loses its tree-row `canvas` tag (the row is gone); it stays one click
> away through the header's Terminal/Canvas swap once the terminal is focused.

> NOTE (shared element): a counted section at `count: 0` is inert today (`sectionExpandable` is `count !== 0`) and
> its body never renders, so a "counted empty-state placeholder with a disabled Attach" cannot show at count 0
> as the brief describes. Task 10 adds an optional `emptyOpenable` flag to `RailSectionHeader`
> (`frontend/app/element/railsections.ts`, optional so Jarvis/Channels rails are unaffected). Uploads uses it
> (so S4's `+ Attach` is reachable with no uploads yet), and Terminals uses it when only other projects have
> terminals.

---

## Stage 3: The 2x2 agent grid with drag and drop

Spec: `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`, decision 8. Assumes Stages 1 and 2 are done
(`centerModeAtom` exists in `agentcenter.ts`, the sidebar is the merged tree, the rail has its new sections, the
Terminals group left the tree). Every edit below is anchored by symbol name. Stages 1 and 2 changed
`agentsurface.tsx` and `agenttree.tsx` after the text this stage was drafted against, so where a snippet quotes
pre-Stage-1 text, find the symbol with `Grep`, keep any conjunct Stage 1 or 2 added, and change only the part the
task names. Snippets are shown indented relative to their code block's left edge; match on content, not on the
leading whitespace of the surrounding file.

| Task | Purpose |
|---|---|
| Task 17 | `agentgrid.ts`: the pure grid model (add, swap, remove, replace, focus, prune, reconcile, placements, collapse), exhaustively tested. |
| Task 18 | `gridstore.ts`: the `agent.grid` atom over that model, and the grid operations that keep `focusIdAtom` in step. |
| Task 19 | `agentsurface.tsx`: the terminal stack becomes a CSS grid parent, cell bars with `x`, collapse rules, boot-time hold. |
| Task 20 | Drag and drop: draggable live-agent rows, cell bars as handles, the drop overlay, `zoneFromPoint`, `Open in split` menu item. |
| Task 21 | One focus rule for clicks, cell clicks, Ctrl+Tab, arrows and j/k; a palette `Open in split`; docs. |
| Task 22 | CDP `agent-grid` scenario: drag to 2, 3, 4 cells, swap, `x`, fullscreen collapse, reload; no remount, refit proof. |

### Key decisions (the tasks below rely on them)

- **`focusIdAtom` stays the one source of "the selected agent".** The header, the rail, the tree highlight, the
  Diff surface and `wsh ui` already read it. The grid does not get its own focus input: `AgentSurface` reconciles
  the saved grid against whatever `focusIdAtom` says (`reconcileGrid`, pure, idempotent), so *every* writer of
  `focusIdAtom` (tree rows, Ctrl+Tab, arrows, j/k, the palette, `openref.ts`, notifications, a click in a cell)
  obeys the same rule without per-call-site code: the agent's cell takes focus if it has one, otherwise the agent
  replaces the focused cell. The grid's own `focused` field is persisted so a reload resumes on the same cell.
- **Only live agents with a terminal are grid cells** (`AgentVM.blockId != null`, from `model.agentsAtom`). A plain
  terminal, a done worker's transcript or a pending launch with no block is shown alone, the grid state untouched,
  and the grid returns when an agent is focused again. Flip `eligible` in `AgentSurface` to include
  `model.terminalsAtom` if terminals should become cells.
- **Terminals never remount.** The terminal stack becomes one grid parent that is *always rendered* (hidden with
  `hidden`, never conditionally mounted); every pane keeps its `key={a.id}`; the cell bar and the drop overlay are
  siblings of `CockpitFocusPane` in fixed child positions.
- **Fixed 2x2 template, spans for the shape.** `grid-cols-2 grid-rows-2` (Tailwind 4: `repeat(2, minmax(0, 1fr))`)
  never changes; `placementFor(count)` gives each cell `{row, col, rowSpan, colSpan}`.

> NOTE (xterm fit, verified in `frontend/app/view/term/term.tsx` and `termwrap.ts`; no change needed in either):
> `TerminalView` observes `.term-connectelem` with a `ResizeObserver` that calls `TermWrap.handleResize_debounced`
> (50 ms trailing). `handleResize` returns early while `connectElem.offsetParent == null` or its client size is 0
> (a `display:none` pane), then `fitAddon.fit()` and, only if rows or cols changed, a `ControllerInputCommand` with
> the new `termsize`; the first real fit also calls `resyncController("initial resize")`. So a pane that goes
> hidden -> shown (a cell that just appeared), or whose cell changes size (2 -> 3 cells, `x`, fullscreen), refits by
> itself: the observer fires on the content-box change and the 0-size skip means a hidden pane never shrinks its
> PTY. A pane that moves to a cell of the *same* size needs no fit. Three things keep that true and are
> requirements of this stage: (1) the tracks are `minmax(0, 1fr)` and every cell has `min-w-0 min-h-0` (a track whose
> minimum is `auto` could not shrink below the xterm's fixed pixel width, so the box would never change and the
> observer would never fire); (2) nothing animates a cell's size or placement (a transition would fire the observer
> every frame and resize the PTY repeatedly; one layout commit per shape change gives one resize); (3) the stack
> container is never unmounted, so `terminal.open` is never re-run. Ink-based TUIs redraw on SIGWINCH and can leave
> stale lines in scrollback after a narrowing; that cannot be asserted from the DOM, so the scenario proves refit by
> geometry and leaves garbling to the screenshots.

> NOTE (DESIGN.md says "grid only for card grids"): the grid parent is a deliberate exception, required by spec
> decision 8. It is a 2x2 of terminals, not a card grid; AGENTS.md gets a one-bullet rule in Task 21 so nobody
> "fixes" it back to flex.

> NOTE (spec vs code, `Ctrl+Tab`): `cycle-agent-prev` (`Ctrl+Shift+Tab`) in `bindings.ts` calls
> `model.cycleFocus(true)`, which is "asking agents only, forward", not "previous". Untouched here; the rule below
> applies to whichever agent it lands on.

> NOTE (spec vs code, `window.term`): older CDP scenarios read `window.term`, which nothing assigns any more, so
> a scenario cannot read an xterm buffer. Task 22 therefore asserts refit from geometry
> (`.xterm-screen` against `.term-connectelem`) and identity from DOM marks.

---

## Stage 4: Uploads (paste, drop, Attach)

Spec decision 7. An agent's Uploads rail section lists what went into its terminal as a file: an image pasted
(`pasteHandler` already writes it to a temp file and pastes the path; now it also records it), OS files dropped on the
terminal (copied to a temp file, 5 MB cap, path pasted), and files picked with `Attach` (the real path pasted, no
copy). Every way inserts a bracketed paste with no Enter, one paste per file, and records the file in one store.

Assumes stages 1 to 3 are done. From Stage 2 it takes the `uploads` section (`planAgentRail`'s `uploads` count, the
`emptyOpenable` header, and `railuploads.tsx`'s placeholder with its disabled Attach button); from Stage 3 the
`AGENT_DRAG_MIME` / `isAgentDrag` exports of `griddrop.ts` and the grid rendering every cell's terminal through
`CockpitFocusPane`.

Tasks, in order:

- **Task 23** `uploadsstore.ts`: the per-agent records, dedupe, expiry, storage without thumbnails, the in-memory
  thumbnail map, path quoting. Pure, fully tested.
- **Task 24** `uploadfile.ts` (pure rules: 5 MB cap, folders, temp file names, the OS-drag test, toast text, thumbnail
  size), `createTempFileFromFile` in `termutil.ts`, and the canvas thumbnail in `uploadthumb.ts`.
- **Task 25** Record on paste: `termpaste.ts` (reach a mounted terminal by block id), the hook in `TermWrap.pasteHandler`,
  and `uploadsingest.ts` (the glue, first function).
- **Task 26** Drop OS files on a terminal: the drop handler and hint in `CockpitFocusPane`, `ingestFiles`.
- **Task 27** Attach: `attachPaths` / `pickAndAttach`, S2's disabled button made real in `railuploads.tsx`, and the real
  count wired into `AgentDetailsRail`.
- **Task 28** The Uploads list (rows, `expired` badge) and the lightbox, in `uploadslist.tsx`.
- **Task 29** The `agent-uploads` CDP scenario.

> NOTE (the owner key is the terminal block id, not the agent id): the spec says "per agent", and the paste hook
> in `termwrap.ts` only knows its block. `TermWrap.tabId` cannot stand in for the agent: `CockpitRoot` hands down
> `atoms.staticTabId` (`CockpitShell` -> `AgentSurface tabId` -> `CockpitFocusPane tabId` -> `getTabModelByTabId` ->
> `new TermWrap(tabModel.tabId, blockId, ...)` in `term.tsx`), the same cockpit tab for every agent. An agent's id is its
> own tab id (`id: row.tabId` in `liveAgentBaseAtom`, `liveagents.ts`) and its terminal is `AgentVM.blockId`
> (`termBlockOref.split(":")[1]`). So records are keyed by `agent.blockId`, which every reader (rail, drop, Attach) has.
> One live agent owns exactly one block, so this is the same key in effect. A Resume opens a new tab and block, so
> uploads do not follow it to the new tab (they would not with the agent id either).

> NOTE (no import cycle, no injected callback needed): `termwrap.ts` already imports from `view/agents/`
> (`session-models/agentresumestore`). The new imports are leaves: `uploadsstore.ts` imports only `jotai` and
> `jotaiStore`; `termpaste.ts` imports nothing; `uploadfile.ts` imports only Stage 3's pure `griddrop.ts`; `uploadthumb.ts`
> only `uploadfile.ts`. The glue (`uploadsingest.ts`) imports `termutil`, `termpaste`, `notificationstore`, `localimage` and
> those leaves, none of which reach `termwrap`, `term-model`, `blockregistry` or `agents.tsx`. `CockpitFocusPane` already
> imports `blockregistry` (and through it `term-model` and `termwrap`), so importing the glue adds no edge into `agents.tsx`.
> Drop and Attach reach the terminal through a registry (`termpaste.ts`; each `TermWrap` registers itself) instead of a
> callback on the view model: `makeViewModel` builds the model inside `CockpitFocusPane` with fixed arguments, so there is
> nowhere to pass one.

> NOTE (how a path reaches the TUI, verified): `TermWrap.pasteHandler` calls `terminal.paste(text)`. In
> `@xterm/xterm` 6.0.0 (`src/browser/Clipboard.ts`) that turns `\n` into `\r`, wraps the text in `ESC[200~ ... ESC[201~`
> only when the program enabled bracketed paste (DECSET 2004) and `ignoreBracketedPasteMode` is not set (the
> `term:allowbracketedpaste` setting), and never appends Enter. The data then goes `onData` -> `handleTermData` ->
> `sendDataToController` -> `ControllerInputCommand` unchanged. Claude Code's embedded terminal layer has a
> `BRACKETED_PASTE` mode and parses `ESC[200~` and `ESC[201~` as paste-start and paste-end (strings read from the installed
> `claude.exe`). Without bracketed paste the path arrives as typed text, which still contains no Enter; `quotePath` strips
> control characters so a file name cannot add one.

> NOTE (Claude Code and quoted paths, read from the installed binary): `claude.exe` 2.1.286 on this machine, which
> embeds its JS: a pasted text goes through `e.trim()`, then one pair of surrounding `"` or `'` is removed, then it is
> tested with `/\.(png|jpe?g|gif|webp)$/i` and, if the file exists, read and attached as `[Image #N]`. So a quoted path with
> spaces and a trailing space work for an image, and **several paths in one paste do not** (the quote strip leaves
> `a.png" "b.png`, which is not a file). That is why every file gets its own paste, 150 ms apart, the gap
> `pasteHandler` already leaves between images. A non-image file is just text in the prompt. The other harnesses (pi,
> opencode, codex) were not checked.

> NOTE (the temp file side needs no Go change): `WriteTempFileCommand` (`pkg/wshrpc/wshserver/wshserver_files.go`) makes a
> fresh `waveterm-attach-*` directory per call and writes `filepath.Base(filename)` into it, so a dropped file can keep its
> own name and two files of the same name never collide. The server sweeps those directories after
> `tempAttachRetention` (24h) at startup and every `TempAttachmentSweepInterval` (4h, `cmd/server/main-server.go`), so
> a file flagged `expired` may still be on disk for up to four more hours. That is the safe direction.

> NOTE (no test file exists for `termutil.ts`): it imports `RpcApi` and `TabRpcClient`, so a test would need the mock
> set `term-model.test.ts` carries. The rules `createTempFileFromFile` applies are pure and live in `uploadfile.ts` with
> their tests; the wrapper stays thin.

> NOTE (Stage 2 already made the empty Uploads section openable): `sectionExpandable` is false for `count: 0`, so a counted
> section with nothing in it is inert and its body never renders. Task 10 added `emptyOpenable` for exactly this and gives the
> `uploads` section `{ count, emptyOpenable: true, defaultOpen: count > 0 }`. So Attach stays where S2's placeholder put it,
> in the section body, and this stage changes no shared rail code. One consequence: at count 0 the section is closed until
> the user opens it (one click), then shows the hint and Attach.

> NOTE (Task 27 changes one S2 scenario step): Task 16's `agent-rail-sections` step 4 asserts that the fixture agent's Attach button
> is disabled. That agent has a (fake) block id, so once Attach is wired it is enabled. Task 27 flips that step.

> NOTE (drafting checks, against HEAD `22c1cdaa`): the pure modules and their tests below were run in a scratch copy with the
> repo's vitest (`uploadsstore` 40 tests, `uploadfile` 27, `termpaste` 6) with a stand-in for S3's `griddrop.ts`; the new and
> edited modules were type-checked with `tsc` over a scratch `tsconfig` that mirrors the repo's (clean); every file the plan
> creates passes `prettier --check` with the repo config; the `termwrap.ts`, `termutil.ts` and `focus-pane.tsx` edit snippets
> were applied to scratch copies of the real files (each "replace this" text matched exactly once); `termwrap.ts` with the new
> imports still loads under vitest's node environment; and the scenario block parses and its page-side expressions are valid
> JS. The `agentdetailsrail.tsx`, `railuploads.tsx` and S2-scenario edits sit on Stage 2's output (read from its draft, not from
> the repo), so they could not be applied.

## Risks by stage

### Stage 1 risks

- **Nothing here was type-checked, built or run.** The brief forbids `tsc`/builds, and the snippets were written against the files as read at `2d5a33b7`
  (`tsconfig` is `strict: false`, `isolatedModules: true`). Removing `"sessions"` from `SurfaceKey` (Task 7) is the step most likely to surface a
  compile error somewhere unlisted; Task 7 step 4's `git grep` is the manual substitute, and `task check:ts` (~2 min) is the real gate when the user allows one.
- **Interim state Task 2-Task 6:** the Sessions nav item still exists and renders `ConversationHistory navSurface="sessions"`; its header reads "Conversation
  History" and `g s` already opens the Agent surface's History. Fine for review order, wrong as an end state; Task 7 closes it.
- **History keeps the project filter and Space scope** the Sessions surface applied (decision 5, "unchanged"). `SURFACE_CONTEXT.agent` is a "subject"
  surface, so `projectControlCopy` makes the app bar read "Default · X ... this surface keeps its explicit target" while History is open and
  filtering by it. Needs a call: leave the copy, or drop the filter from History.
- **Session-only project folders.** `buildSidebarRows` adds a folder for every project that has ended sessions but no live agent. The archive is the
  last 30 days, 100 sessions: on a busy machine that is many folders (each collapsible, remembered in `collapsedProjectsAtom`). A cap or a "recent
  projects only" rule is a one-line change in `buildSidebarRows`; none was specified.
- **A just-launched agent has no `transcriptPath` for a moment.** If its resumed session is already in the archive, it can appear as both a live row and
  an ended row until its transcript path registers (the join is path-only, as in `overlayLive`).
- **Agent-exit refresh is untested end to end.** `agentExited` and `scanDue` are unit-tested and the hook is simple, but `agent-history` cannot make
  the fixture agent exit; step 13 only proves the re-entry rescan. Check it by hand: close an agent and watch its session appear under its project.
- **`agent-history` depends on dev-only mechanics:** the in-page `RpcApi` mock needs the Vite dev module URL (`performance.getEntriesByType`), the key
  steps dispatch synthetic `keydown`s at `document.activeElement` (like `docReviewEscape`), and `g s` uses the `Ctrl+g` alias because the effect that
  returns focus to the terminal can make bare `g` inert. If the dispatcher semantics differ, steps 8, 10, 11 and 12 are the ones to adjust.
- **`agent-tree-quick-return` was edited** (a settle wait) to stay deterministic once rows arrive after a scan; the assertion itself is unchanged.
- **The session pane and History hide the details rail** (spec: only History). Reverting the session pane to show it is the `centerMode === "terminal"`
  term in `AgentSurface`'s rail guard.
- **Concurrent edits.** Other work is landing on `main` (HEAD moved during drafting). Every edit is anchored by symbol or quoted text; if an anchor does
  not match, re-read the file rather than forcing the replacement.

### Stage 2 risks

- **Stage 1 coupling.** Task 13 edits `agenttree.tsx` and `agentsurface.tsx` by symbol, but Stage 1 rebuilt the tree
  around merged live-agent/session rows. If Stage 1 moved or changed `RenameBox`/`startRowRename`, the `terminals-header`
  block, `TerminalRow`, or the rail condition in `AgentSurface`, the Task 13 steps still say what must end up true (greps in
  step 7); the exact before-snippets may need adjusting. If Stage 1 extracted the sidebar into a new file, the "tree"
  edits apply there.
- **Terminals are only reachable from the rail now.** The tree group is deleted and Ctrl+Tab, arrows and j/k walk
  agents only. That is why a focused terminal gets `TerminalRail` (Task 13) rather than no rail, and why the Terminals
  section has the "Show N from other projects" toggle (a project with terminals but no agent). If the rail is toggled
  off (`d`), terminals are unreachable until it is on again; default-on (Task 15) mitigates, but a user who stored
  `false` has no terminal list in view. Not addressed in this stage.
- **Behaviour changes that follow from giving terminals a project.** `DivergenceBanner` in `AgentSurface` can now say
  "Showing X · project is Y" for a focused terminal in another project (before it never diverged). Unverified how
  this reads for the terminal case; acceptable, same rule as agents.
- **A terminal's canvas loses its tree tag.** The `canvas` chip lived on the terminal's tree row. After Task 13 a
  terminal's canvas is reached by focusing the terminal (rail row) and using the header's Terminal/Canvas swap
  (shown for any focused item with a canvas). `canvas-swap` and `canvas-tabs` are retargeted to that path and could
  not be run while drafting.
- **`emptyOpenable` touches a shared element** (`railsections.ts`). It is optional and defaults to the old
  behaviour, and `railsections.test.ts` pins both, but `CollapsibleRail` is also used by Jarvis/Channels
  (`cockpitrail.tsx`), so a visual glance at one of those rails is worthwhile.
- **Rename inside a rail row.** The terminal row reuses `RenameBox` (now in `rowrename.tsx`) and the global
  `renamingRowAtom`, which the Escape bindings read; verified by reading `bindings.ts` and `whenstate.ts`, not run.
  The rail row is a `div` with `onClick`, like the tree rows, so it is not keyboard-focusable (parity, not a
  regression).
- **`agent-rail-sections` assumptions not verifiable from the code alone.** (a) `uireveal canvas:<topic>` with
  `callerblockid` set to a *fixture* agent's block: `loadCanvas` matches it against `agentsAtom`
  (the dev roster in DEV) and the backend only forwards `callerblockid`, so it should attach; if the backend
  validates the block, step 2/3 fail in arrange and the canvas part should move to a real terminal. (b) The terminals'
  `row.label` and whether the session sidebar appends a service label were not checked, so the scenario matches
  terminals by tab id, not by name. (c) `uireveal agent:<id>` for a fixture agent id with hyphens: the address parser
  accepts any non-empty id, the roster check is the only gate.
- **`railstore.test.ts` imports `railstore.ts` with `window` stubbed** (same pattern as `briefingstore.test.ts`) and
  mocks `RpcApi`, `TabRpcClient`, `agentcwdresolve` and `agentsessionstore` to keep the import chain light; if a
  transitive import still touches something missing in the node environment, mock that module the same way.
- **First paint with the rail on by default.** The terminal and the rail are laid out together at 300px; xterm
  refits when the rail opens. `getOnInit: true` avoids a slide-open for users who stored `false`, but a profile with
  no stored value now always starts with the 300px rail. `tui-fullscreen` is the nearest existing check; not run here.
- **S3/S4 interplay.** S3's "click a row replaces the focused cell" rule is about agents; a Terminals row still just
  sets `focusIdAtom` (and `focusReplyAtom` false). S4 replaces `UploadsSection`'s body and passes the real count to
  `planAgentRail`'s `uploads` input (currently the literal `0`); it may flip the Uploads `defaultOpen` once the section
  has content.
- **Formatting.** HEAD is not formatter-clean; only the three new `.tsx` files are run through `prettier --write`
  (Task 13, Task 14), never the modified ones. The prettier config uses `organize-imports`, so the import order in the new
  files may be rewritten by it; harmless.

### Stage 3 risks

- **Stage 1 and 2 are not in the repo yet.** HEAD's `agentsurface.tsx` and `agenttree.tsx` were read, not the post-Stage-1
  versions. Task 19 names `centerMode`/`centerModeAtom` from the shared contract but cannot show Stage 1's real
  hide-the-terminal code; Task 20 anchors on `ParentRow`, `WorkerRow`, `StageRow` and their menu snippets as they are at
  HEAD (Stage 1 says live-agent rows are "today's rows, unchanged", and Stage 2 only deletes the Terminals group). If a
  before-snippet no longer matches, the end state is what matters: every live-agent row has `data-agent-row` +
  `dragSource(...)` + `splitMenuItem(...)`; the terminal stack is one always-rendered grid parent.
- **No typecheck was run (builds are forbidden).** Typed by reading, not compiling. The spots most likely to need a
  touch-up when the dev overlay or an editor flags them: `new Map(cells.map((c) => [c.id, c] as const))`,
  `React.HTMLAttributes<HTMLDivElement>` returned from `dragSource` and spread on a `motion`-free `div`,
  `GridModel` being satisfied structurally by `AgentsViewModel` (`agentsAtom: Atom<AgentVM[]>` against
  `Atom<ReadonlyArray<{ id: string; blockId?: string }>>`), and `atomWithStorage<unknown>` with the `getOnInit`
  options argument. A full typecheck (about 2 minutes, the repo's `check:ts` task) is the user's call, not a step here.
- **A real WebView2 drag was not exercised.** The scenario dispatches drag events with a script-built `DataTransfer`;
  that proves the handlers, the overlay, the zone logic and the grid, not Chromium's own drag start. Known pitfall: if
  Chromium cancels a drag the instant it starts (it does that when the *source* is re-rendered or removed in
  `dragstart`), defer the `agentDragAtom` write in `beginAgentDrag` with `setTimeout(0)`. If the scripted drag needs to be
  replaced by a real one, CDP's `Input.dispatchDragEvent` (experimental) is the route. The failsafe in
  `agentdragstore.ts` (window `dragend`/`drop` in bubble phase, `pointermove`/`keydown` after 300 ms) covers a source that
  unmounts mid-drag, unobserved.
- **xterm refit is reasoned, not run.** The analysis (see the NOTE at the top) found no change needed in `term.tsx` or
  `termwrap.ts`. What can still go wrong: an ancestor with `overflow: visible` and `min-width: auto` inside the cell
  (the cell wrapper has `min-w-0`, the pane `.cockpit-focus-pane` has `min-width: 0; overflow: hidden`, `.view-term` has
  `overflow: hidden`), or WebView2 coalescing observer callbacks while a pane goes from `display:none`. The `b` steps of
  `agent-grid` are the check. Ink-based TUIs (Claude Code) can leave stale lines in scrollback after a narrowing; the
  scenario cannot see that, only the shots can.
- **Saved-grid hold at boot.** `holdForGrid` keeps the skeleton up while `rosterSeededAtom` is false and none of a
  saved grid's agents has arrived; it relies on `rosterSeededAtom` latching true soon after boot (it does for the
  roster itself, `liveagents.ts`). If a stored grid names agents that will never come back and the latch is slow, the
  Agent surface sits on its skeleton until it fires. The reconcile also prunes an agent that drops out of
  `agentsAtom` even for a moment (a status gap); the tree has the same blink, but here it is a lost cell, not a
  flicker. Not mitigated; a grace period would be the fix if it shows up.
- **Ctrl+Tab shuffles the grid.** Per the spec's "same rule", cycling the roster rewrites the focused cell whenever it
  lands on an agent with no cell. Five agents in a four-cell grid, cycled, keep swapping which four show. The
  alternative (cycle only the cells when there are two or more) is a few lines in `cycleFocus` but contradicts the
  spec's wording; left as is. There is also no keyboard-only way to move between cells without replacing one (a
  `Ctrl+Alt+Arrow` style binding would do it; not added because `Alt+Arrow` is a readline word jump inside the TUI).
- **`Open in split` from the keyboard is the palette action only.** Added in Task 21 beyond the spec's literal text (a
  right-click menu is not a keyboard route). Easy to drop: remove the `agent:split` action and its test.
- **Terminals are not cells.** A terminal focused from the rail shows alone and leaves the grid as it was; an agent
  click then brings the grid back. If terminals should be cells, add `terminals` to `eligible` in `AgentSurface` and to
  `liveIds` in `gridstore.ts`, and give their rows a drag source (they have none today).
- **Scenario assumptions.** (a) `eventpublish` of `agent:status` with `persist: 1` is accepted from the page and the
  retained read after the reload seeds the same agents (it is what `wsh agentstatus` does server-side; not run).
  (b) Agent rows are found by `data-agent-row`, added in Task 20. (c) The header buttons are found by their `title`
  prefixes `Fullscreen terminal` / `Exit fullscreen` (`agentheader.tsx`). (d) A real mouse movement by the user during a
  drag step (a 300 ms window) can end the drag early through the failsafe; the scenario says "do not move the mouse".
  (e) Teardown restores the user's `agent.grid` after a 1.5 s settle; if the roster has not caught up by then the
  surface's prune can write over the restored value once, and the next reload would show the pruned grid.
- **DESIGN.md and AGENTS.md.** DESIGN.md says "grid only for card grids"; the grid parent is a deliberate exception and
  is recorded in AGENTS.md (Task 21). DESIGN.md itself is not edited.
- **Four live WebGL terminals.** Every agent's pane is already mounted (hidden) with its own WebGL context, so four
  visible is not a new context count, but four visible TUIs repaint at once; not measured.

### Stage 4 risks

- **Stage 2's and Stage 3's output was read from their drafts, not from the repo.** S4 edits S2's `railuploads.tsx` (replaced
  whole), the `uploads: 0, // ...` count line, the `uploads: () => <UploadsSection />,` entry and step 4 of `agent-rail-sections`,
  and imports `AGENT_DRAG_MIME` and `isAgentDrag` from S3's `griddrop.ts`. If those landed differently, the replacements in Task 27 and
  Task 28 and the two imports in Task 24 need the same change by hand. `uploadfile.ts` now depends on S3's `griddrop.ts` (which imports
  `agentgrid.ts`, pure by S3's plan); if either ever imported something that reaches `termwrap`, `termutil` importing `uploadfile`
  would form a cycle.
- **Quoted paths and one paste per file were verified for Claude Code only**, by reading strings out of the installed
  `claude.exe` 2.1.286 on this machine (outer `"` or `'` stripped after `trim()`, then the `png|jpe?g|gif|webp` test, then the file
  is read). That is the source of "several paths in one paste are not attached", which is why Attach and drop paste one file at
  a time. pi, opencode and codex were not checked; what they do with a pasted path (attach it, or leave it as text) is unknown.
- **Bracketed paste is only as bracketed as the TUI asks.** If the program has not enabled DECSET 2004, or `term:allowbracketedpaste`
  is off, the path arrives as plain typed text. There is still no Enter. A path with a double quote in it (POSIX only) is
  not escaped.
- **The Uploads section is closed at 0.** That is S2's design (`defaultOpen: count > 0`, `emptyOpenable`): a fresh agent shows a
  dimmed `Uploads 0` row, and Attach is one click away. It opens itself after the first upload unless the user toggled it
  before. Nothing in the rail's collapsed strip (the 44px one) mentions uploads.
- **A real OS drag is not automated.** `agent-uploads` dispatches synthetic `ClipboardEvent` and `DragEvent` objects. What it cannot
  show is a drop from Explorer: that `webkitGetAsEntry` really reports a folder in WebView2, that a multi-file drop arrives
  with every file, and that the webview does not navigate to a dropped file. A manual smoke check is worth doing once: drag a
  folder, a 6 MB file and two small files from Explorer onto an agent's terminal, and expect one toast naming the first two and
  two pasted paths.
- **The key is the block id, not the agent id** (see the first NOTE). Uploads do not follow an agent across a Resume (new tab,
  new block). Plain terminals (`kind: "terminal"`) record too, if pasted into, but their rail is not shown, so those records
  are inert and bounded by the caps (50 per owner, 40 owners).
- **`expired` is a guess at the sweep.** A paste or drop is flagged after 24h from the record's own timestamp; the server sweeps
  by directory modification time at startup and every 4h, so the file can outlive the flag by up to four hours, and a record
  made before a clock change is only as accurate as the clock.
- **Thumbnails are best effort.** Over 10 MB, HEIC, a broken file, or an SVG that `createImageBitmap` will not decode gives the
  generic icon. An attached image's thumbnail is read back through wavesrv, which is an HTTP fetch per attached image.
- **No keybinding was added** (the spec has none). The Attach button and every enlargeable row are real buttons, so they take Tab
  and Enter; the lightbox is a `ModalShell`, so Escape and focus handling come with it. If a shortcut for Attach is wanted
  later it belongs in `buildAgentBindings` (`bindings.ts`) and `docs/keyboard-shortcuts.md`.
- **A big drop is slow by design:** each file waits 150 ms after the previous paste, so 30 files take about 4.5 seconds, and the
  copies are sequential.
- **The scenario depends on the roster accepting a fixture agent.** It publishes `agent:status` for a new shell tab
  (`state: "idle"`, `agent: "claude"`, a `title`) and clicks its tree row by that label. If Stage 1's sidebar relabels a live
  agent's row, or the roster hides agents with no transcript, the arrange step reports a SKIP that names it. Steps 1c and 3c depend on
  the shell echoing the paste into the block's `term` file; PSReadLine redraws are handled by stripping escape sequences, but a
  shell that does not echo bracketed pastes would make them SKIP.
- **Nothing here was type-checked inside the repo** (the brief forbids `task check:ts`). The pure modules, `termutil.ts`,
  `uploadsingest.ts`, `uploadslist.tsx`, `railuploads.tsx` (both versions) and `focus-pane.tsx` were checked in a scratch `tsc` run
  against the repo's real modules; the `termwrap.ts` and `agentdetailsrail.tsx` edits were not. One `task check:ts` at the end of
  the whole plan, when the machine can take it, is the proper gate.

## Tasks

### Task 1: Pure modules `agentcenter.ts` and `agentsidebarmodel.ts`

**Depends on:** none
**Files:**
- Create: `frontend/app/view/agents/agentcenter.ts`
- Create: `frontend/app/view/agents/agentsidebarmodel.ts`
- Test: `frontend/app/view/agents/agentcenter.test.ts`
- Test: `frontend/app/view/agents/agentsidebarmodel.test.ts`

> NOTE: the dedupe is not re-implemented. `endedSessionsByProject` calls the existing `overlayLive`
> (`sessionsarchivestore.ts`), which joins a roster agent to its session by normalized transcript path (backslashes to `/`,
> lower-cased) and sets `live`. Ended = `!live && !runid`. That makes the sidebar and History agree by construction.
> `agentsidebarmodel.ts` therefore imports a module that imports `RpcApi`; that is fine under vitest (`session.test.ts` already does).

- [ ] **Step 1: Write the failing test for the centre-mode module**
  Create `frontend/app/view/agents/agentcenter.test.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0

  import { globalStore } from "@/app/store/jotaiStore";
  import { atom } from "jotai";
  import { beforeEach, describe, expect, it } from "vitest";
  import { centerForSelection, centerModeAtom, showHistory, showSession, showTerminal } from "./agentcenter";
  import type { AgentsViewModel, SurfaceKey } from "./agents";

  const stub = () =>
      ({
          surfaceAtom: atom<SurfaceKey>("cockpit"),
          sessionsSelAtom: atom("all"),
          sessionsMemberAtom: atom("lead"),
      }) as unknown as AgentsViewModel;

  beforeEach(() => globalStore.set(centerModeAtom, "terminal"));

  describe("centerModeAtom", () => {
      it("starts on the terminal", () => {
          expect(globalStore.get(centerModeAtom)).toBe("terminal");
      });
  });

  describe("centerForSelection", () => {
      it("reads one session in the session pane", () => {
          expect(centerForSelection("claude:abc")).toBe("session");
          expect(centerForSelection("pi:s9")).toBe("session");
      });
      it("leaves a run and the merged feed to History, which draws their detail", () => {
          expect(centerForSelection("run:r1")).toBe("history");
          expect(centerForSelection("all")).toBe("history");
      });
  });

  describe("openers", () => {
      it("showTerminal returns the centre to the terminal", () => {
          globalStore.set(centerModeAtom, "history");
          showTerminal();
          expect(globalStore.get(centerModeAtom)).toBe("terminal");
      });

      it("showHistory opens History and switches to the Agent surface", () => {
          const model = stub();
          showHistory(model);
          expect(globalStore.get(centerModeAtom)).toBe("history");
          expect(globalStore.get(model.surfaceAtom)).toBe("agent");
      });

      it("showSession selects the session and opens the session pane", () => {
          const model = stub();
          showSession(model, "claude:abc");
          expect(globalStore.get(model.sessionsSelAtom)).toBe("claude:abc");
          expect(globalStore.get(model.sessionsMemberAtom)).toBe("lead");
          expect(globalStore.get(centerModeAtom)).toBe("session");
          expect(globalStore.get(model.surfaceAtom)).toBe("agent");
      });

      it("showSession sends a run's session to History with its member in view", () => {
          const model = stub();
          showSession(model, "run:r1", "t-2");
          expect(globalStore.get(model.sessionsSelAtom)).toBe("run:r1");
          expect(globalStore.get(model.sessionsMemberAtom)).toBe("t-2");
          expect(globalStore.get(centerModeAtom)).toBe("history");
      });
  });
  ```

- [ ] **Step 2: Write the failing test for the sidebar model**
  Create `frontend/app/view/agents/agentsidebarmodel.test.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0

  import { describe, expect, it } from "vitest";
  import type { AgentVM } from "./agentsviewmodel";
  import { buildAgentTree, foldCollapsedProjects, UNGROUPED_PROJECT } from "./agenttreemodel";
  import {
      agentExited,
      buildSidebarRows,
      endedSessionsByProject,
      scanDue,
      SESSION_PAGE,
      sessionAgeLabel,
      sessionTitle,
      showMore,
      UNTITLED_SESSION,
      visibleCount,
      type EndedSessionRow,
      type SidebarRow,
  } from "./agentsidebarmodel";

  const MIN = 60_000;
  const NOW = 1_800_000_000_000;

  const session = (id: string, over: Partial<SessionActivity> = {}): SessionActivity => ({
      id,
      runtime: "claude",
      projectpath: "/p",
      projectname: "waveterm",
      branch: "main",
      task: `prompt ${id}`,
      model: "opus",
      tokenstotal: 0,
      lastactivets: NOW - MIN,
      resumecommand: `claude --resume ${id}`,
      transcriptpath: `/home/u/.claude/projects/home-u-waveterm/${id}.jsonl`,
      status: "done",
      startedts: 0,
      durationms: 0,
      events: [],
      ...over,
  });

  // n sessions of one project, "<prefix>1" the newest and "<prefix>n" the oldest
  const solos = (n: number, project = "waveterm", prefix = "s") =>
      Array.from({ length: n }, (_, i) =>
          session(`${prefix}${i + 1}`, { projectname: project, lastactivets: NOW - (i + 1) * MIN })
      );

  const agent = (id: string, path?: string, project = "waveterm"): AgentVM => ({
      id,
      name: id,
      task: "",
      state: "working",
      project,
      transcriptPath: path,
  });

  const label = (r: SidebarRow): string => {
      switch (r.kind) {
          case "group":
              return `group:${r.project}`;
          case "session":
              return `session:${r.session.id}`;
          case "more":
              return `more:${r.project}:${r.hidden}`;
          default:
              return r.kind;
      }
  };
  const labels = (rows: SidebarRow[]) => rows.map(label);

  const treeOf = (agents: AgentVM[]) =>
      buildAgentTree(
          agents,
          agents.map((a) => a.id)
      );
  const endedOf = (list: SessionActivity[], roster: AgentVM[] = []) => endedSessionsByProject(list, roster);

  describe("sessionTitle", () => {
      it("is the first prompt with its whitespace collapsed", () => {
          expect(sessionTitle("  fix the\n  race   condition ")).toBe("fix the race condition");
      });
      it("falls back for a blank prompt", () => {
          expect(sessionTitle("")).toBe(UNTITLED_SESSION);
          expect(sessionTitle("\n  \n")).toBe(UNTITLED_SESSION);
      });
  });

  describe("sessionAgeLabel", () => {
      it("reads minutes, days, and under a minute", () => {
          expect(sessionAgeLabel(NOW - 16 * MIN, NOW)).toBe("16m");
          expect(sessionAgeLabel(NOW - 3 * 24 * 60 * MIN, NOW)).toBe("3d");
          expect(sessionAgeLabel(NOW - 10_000, NOW)).toBe("<1m");
      });
      it("never reads a clock-skewed future stamp as negative", () => {
          expect(sessionAgeLabel(NOW + 5 * MIN, NOW)).toBe("<1m");
      });
  });

  describe("endedSessionsByProject", () => {
      it("is empty until the scan has loaded", () => {
          expect(endedSessionsByProject(null, []).size).toBe(0);
      });

      it("groups ended sessions by project, newest first", () => {
          const out = endedOf([
              session("old", { lastactivets: NOW - 9 * MIN }),
              session("new", { lastactivets: NOW - MIN }),
              session("other", { projectname: "loom", lastactivets: NOW - 2 * MIN }),
          ]);
          expect([...out.keys()].sort()).toEqual(["loom", "waveterm"]);
          expect(out.get("waveterm")!.map((r) => r.session.id)).toEqual(["new", "old"]);
      });

      it("leaves out a session a live agent is running, joined by normalized transcript path", () => {
          const ended = session("w", { transcriptpath: "C:\\Users\\U\\.claude\\projects\\home-u-waveterm\\w.jsonl" });
          const liveAgent = agent("t1", "c:/users/u/.claude/projects/home-u-waveterm/w.jsonl");
          expect(endedOf([ended], [liveAgent]).size).toBe(0);
          // the same session with that agent gone is ended again
          expect(endedOf([ended], []).get("waveterm")).toHaveLength(1);
      });

      it("leaves out a session an orchestrator run launched", () => {
          const out = endedOf([session("a"), session("b", { runid: "r1", role: "worker", taskid: "t-1" })]);
          expect(out.get("waveterm")!.map((r) => r.session.id)).toEqual(["a"]);
      });

      it("files a session with no project under ungrouped, like a live agent with none", () => {
          expect([...endedOf([session("a", { projectname: "" })]).keys()]).toEqual([UNGROUPED_PROJECT]);
      });

      it("titles a row with the first prompt and keeps the full text for the tooltip", () => {
          const [row] = endedOf([session("a", { task: "fix the\n  race" })]).get("waveterm")!;
          expect(row).toMatchObject({
              kind: "session",
              project: "waveterm",
              key: "claude:a",
              title: "fix the race",
              tooltip: "fix the\n  race",
          });
      });
  });

  describe("buildSidebarRows", () => {
      const noPages = {};
      const noneCollapsed = new Set<string>();

      it("lists a project's ended sessions after its live agents and before the next project", () => {
          const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
          const ended = endedOf([...solos(2), ...solos(1, "loom", "l")]);
          expect(labels(buildSidebarRows(tree, ended, noneCollapsed, noPages))).toEqual([
              "group:waveterm",
              "parent",
              "session:s1",
              "session:s2",
              "group:loom",
              "parent",
              "session:l1",
          ]);
      });

      it("shows five sessions then a Show more row counting the rest", () => {
          const rows = buildSidebarRows(treeOf([agent("a")]), endedOf(solos(7)), noneCollapsed, noPages);
          expect(labels(rows)).toEqual([
              "group:waveterm",
              "parent",
              "session:s1",
              "session:s2",
              "session:s3",
              "session:s4",
              "session:s5",
              "more:waveterm:2",
          ]);
          expect(SESSION_PAGE).toBe(5);
      });

      it("shows five more per press and drops the row once nothing is hidden", () => {
          const ended = endedOf(solos(12));
          const once = buildSidebarRows(treeOf([agent("a")]), ended, noneCollapsed, { waveterm: 1 });
          expect(labels(once).filter((l) => l.startsWith("session:"))).toHaveLength(10);
          expect(labels(once)[labels(once).length - 1]).toBe("more:waveterm:2");
          const twice = buildSidebarRows(treeOf([agent("a")]), ended, noneCollapsed, { waveterm: 2 });
          expect(labels(twice).filter((l) => l.startsWith("session:"))).toHaveLength(12);
          expect(labels(twice).some((l) => l.startsWith("more:"))).toBe(false);
      });

      it("pages each project on its own", () => {
          const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
          const ended = endedOf([...solos(7), ...solos(6, "loom", "l")]);
          const rows = labels(buildSidebarRows(tree, ended, noneCollapsed, { waveterm: 1 }));
          expect(rows).toContain("more:loom:1");
          expect(rows.some((l) => l.startsWith("more:waveterm"))).toBe(false);
      });

      it("hides a collapsed project's agents and sessions together, keeping its folder row", () => {
          const rows = buildSidebarRows(treeOf([agent("a")]), endedOf(solos(3)), new Set(["waveterm"]), noPages);
          expect(labels(rows)).toEqual(["group:waveterm"]);
      });

      it("gives a project with ended sessions and no live agent a folder of its own, after the live ones", () => {
          const rows = buildSidebarRows(treeOf([agent("a")]), endedOf([...solos(1), ...solos(2, "loom", "l")]), noneCollapsed, noPages);
          expect(labels(rows)).toEqual([
              "group:waveterm",
              "parent",
              "session:s1",
              "group:loom",
              "session:l1",
              "session:l2",
          ]);
          expect(rows.find((r) => r.kind === "group" && r.project === "loom")).toMatchObject({ count: 0, attn: 0 });
      });

      it("orders agentless projects by their newest session", () => {
          const ended = endedOf([
              session("a", { projectname: "aaa", lastactivets: NOW - 9 * MIN }),
              session("z", { projectname: "zzz", lastactivets: NOW - MIN }),
          ]);
          expect(labels(buildSidebarRows([], ended, noneCollapsed, noPages))).toEqual([
              "group:zzz",
              "session:z",
              "group:aaa",
              "session:a",
          ]);
      });

      it("keeps a collapsed agentless project's folder row and hides its sessions", () => {
          const ended = endedOf(solos(2, "loom", "l"));
          expect(labels(buildSidebarRows([], ended, new Set(["loom"]), noPages))).toEqual(["group:loom"]);
      });

      it("is exactly the folded tree when there are no sessions", () => {
          const tree = treeOf([agent("a"), agent("b", undefined, "loom")]);
          const collapsed = new Set(["loom"]);
          expect(buildSidebarRows(tree, new Map<string, EndedSessionRow[]>(), collapsed, noPages)).toEqual(
              foldCollapsedProjects(tree, collapsed)
          );
      });
  });

  describe("paging", () => {
      it("shows one page more per press", () => {
          expect(visibleCount("p", {})).toBe(5);
          expect(visibleCount("p", { p: 2 })).toBe(15);
          expect(showMore({}, "p")).toEqual({ p: 1 });
          expect(showMore({ p: 1, q: 3 }, "p")).toEqual({ p: 2, q: 3 });
      });
      it("does not mutate the map it was given", () => {
          const pages = { p: 1 };
          showMore(pages, "p");
          expect(pages).toEqual({ p: 1 });
      });
  });

  describe("agentExited", () => {
      it("is true when an id left the roster", () => {
          expect(agentExited(new Set(["a", "b"]), new Set(["a"]))).toBe(true);
      });
      it("is false for a roster that only grew or stayed", () => {
          expect(agentExited(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
          expect(agentExited(new Set(), new Set())).toBe(false);
      });
  });

  describe("scanDue", () => {
      it("scans on the first arrival", () => {
          expect(scanDue(0, 10_000, "enter")).toBe(true);
      });
      it("does not rescan on a quick re-entry", () => {
          expect(scanDue(8_000, 10_000, "enter")).toBe(false);
          expect(scanDue(4_000, 10_000, "enter")).toBe(true);
      });
      it("rescans soon after an exit, since the ended session just landed", () => {
          expect(scanDue(8_000, 10_000, "exit")).toBe(true);
          expect(scanDue(9_500, 10_000, "exit")).toBe(false);
      });
  });
  ```

- [ ] **Step 3: Run both tests; expect failures**
  Run `npx vitest run frontend/app/view/agents/agentcenter.test.ts` then `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts`.
  Expected: each fails with `Failed to resolve import "./agentcenter"` / `"./agentsidebarmodel"`.

- [ ] **Step 4: Implement `agentcenter.ts`**
  Create `frontend/app/view/agents/agentcenter.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // What the Agent surface's centre column shows, in one module-level atom (like railstore.ts) so the mode survives
  // the surface being hidden (it stays mounted) and any opener can set it without holding the model.
  //   terminal  the focused agent's live TUI, or an ended worker's transcript: the centre as it was
  //   session   one ended session's transcript with a Resume button; which session is the model's sessionsSelAtom
  //             ("<runtime>:<id>"), the atom History's list and detail already use
  //   history   Conversation History: the old Sessions surface's master-detail, embedded
  // The terminal stack stays mounted, hidden, in the other two, so a live xterm is never torn down and re-fitted.
  // "session" is already overloaded in this codebase (workspace tab sessions, the Brief region), so the sessions*Atoms
  // on the model keep their names rather than churn a rename.

  import { globalStore } from "@/app/store/jotaiStore";
  import { atom, type PrimitiveAtom } from "jotai";
  import type { AgentsViewModel } from "./agents";

  export type CenterMode = "terminal" | "session" | "history";

  export const centerModeAtom = atom<CenterMode>("terminal") as PrimitiveAtom<CenterMode>;

  type CenterOpener = Pick<AgentsViewModel, "surfaceAtom" | "sessionsSelAtom" | "sessionsMemberAtom">;

  /** Pure: where a value written to sessionsSelAtom is read. A run ("run:<id>") and the merged feed ("all") have a
   *  detail only History draws; any other value is one session, which the session pane reads. */
  export function centerForSelection(sel: string): Exclude<CenterMode, "terminal"> {
      return sel === "all" || sel.startsWith("run:") ? "history" : "session";
  }

  /** Back to the focused agent's terminal. Every route that chooses an agent calls this, so choosing one never
   *  leaves a transcript over it. */
  export function showTerminal(): void {
      globalStore.set(centerModeAtom, "terminal");
  }

  /** Open Conversation History in the Agent surface. */
  export function showHistory(model: Pick<AgentsViewModel, "surfaceAtom">): void {
      globalStore.set(centerModeAtom, "history");
      globalStore.set(model.surfaceAtom, "agent");
  }

  /** Open one session in the Agent surface: its own transcript, or its run in History. `member` is the run member in
   *  view, as sessionSelection (sessionsruns.ts) names it for a run's session. */
  export function showSession(model: CenterOpener, sel: string, member?: string): void {
      globalStore.set(model.sessionsSelAtom, sel);
      if (member != null) {
          globalStore.set(model.sessionsMemberAtom, member);
      }
      globalStore.set(centerModeAtom, centerForSelection(sel));
      globalStore.set(model.surfaceAtom, "agent");
  }
  ```
  Run `npx vitest run frontend/app/view/agents/agentcenter.test.ts`. Expected: all tests pass.

- [ ] **Step 5: Implement `agentsidebarmodel.ts`**
  Create `frontend/app/view/agents/agentsidebarmodel.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // Pure model for the Agent surface's sidebar once it carries conversations as well as live agents. Each project is
  // a folder: its live agents (agenttreemodel.ts), then up to five ended sessions, then "Show more" (five per press).
  // A live agent and its session record are one row, joined by normalized transcript path (overlayLive); a session an
  // orchestrator run launched is not listed, since the run's own done fold already holds it (History still shows it,
  // grouped by run). Status filters live in History only. No React, no jotai.

  import { formatAgeShort, type AgentVM } from "./agentsviewmodel";
  import { UNGROUPED_PROJECT, type AgentTreeRow } from "./agenttreemodel";
  import { overlayLive, type LiveSession } from "./sessionsarchivestore";
  import { sessionKey } from "./sessionsruns";

  export const SESSION_PAGE = 5;
  export const UNTITLED_SESSION = "(untitled session)";

  // an ended session under its project
  export interface EndedSessionRow {
      kind: "session";
      project: string;
      key: string; // sessionKey: the value sessionsSelAtom takes to read it
      title: string; // the first human prompt, on one line
      tooltip: string; // the full prompt, for the row's title attribute
      lastactivets: number;
      session: LiveSession;
  }

  // "Show more" under a project whose ended sessions do not all fit yet
  export interface MoreSessionsRow {
      kind: "more";
      project: string;
      hidden: number;
  }

  export type SidebarRow = AgentTreeRow | EndedSessionRow | MoreSessionsRow;

  /** Pure: a session's title, its first prompt (the scan already trims it) with whitespace collapsed to one line. */
  export function sessionTitle(task: string): string {
      return task.replace(/\s+/g, " ").trim() || UNTITLED_SESSION;
  }

  /** Pure: how long ago a session last moved, as the tree's other rows read ("<1m", "16m", "3h", "3d"). */
  export function sessionAgeLabel(lastactivets: number, now: number): string {
      return formatAgeShort(Math.max(0, now - lastactivets));
  }

  /** Pure: the archive's ended, non-run sessions by project (an agent's own project name, else "ungrouped"), newest
   *  first. `base` is null until the scan loads. A session a roster agent is writing the transcript of is live, so it
   *  is that agent's row and not an ended one. */
  export function endedSessionsByProject(
      base: SessionActivity[] | null,
      roster: AgentVM[]
  ): Map<string, EndedSessionRow[]> {
      const out = new Map<string, EndedSessionRow[]>();
      if (base == null) {
          return out;
      }
      for (const s of overlayLive(base, roster, 0)) {
          if (s.live || s.runid) {
              continue;
          }
          const project = s.projectname || UNGROUPED_PROJECT;
          const row: EndedSessionRow = {
              kind: "session",
              project,
              key: sessionKey(s),
              title: sessionTitle(s.task),
              tooltip: s.task.trim() || UNTITLED_SESSION,
              lastactivets: s.lastactivets,
              session: s,
          };
          const list = out.get(project);
          if (list == null) {
              out.set(project, [row]);
          } else {
              list.push(row);
          }
      }
      for (const list of out.values()) {
          list.sort((a, b) => b.lastactivets - a.lastactivets);
      }
      return out;
  }

  /** Pure: how many ended sessions a project shows, given how many times "Show more" was pressed under it. */
  export function visibleCount(project: string, pages: Readonly<Record<string, number>>): number {
      return SESSION_PAGE * (1 + (pages[project] ?? 0));
  }

  /** Pure: the pages map after one more "Show more" press under `project`. */
  export function showMore(pages: Readonly<Record<string, number>>, project: string): Record<string, number> {
      return { ...pages, [project]: (pages[project] ?? 0) + 1 };
  }

  function sessionRowsOf(
      project: string,
      list: EndedSessionRow[],
      pages: Readonly<Record<string, number>>
  ): SidebarRow[] {
      const shown = list.slice(0, visibleCount(project, pages));
      const hidden = list.length - shown.length;
      return hidden > 0 ? [...shown, { kind: "more", project, hidden }] : shown;
  }

  /** Pure: the sidebar's rows. `rows` is buildAgentTree's output (a group row, then that project's agent rows);
   *  each project's ended sessions follow its last agent row, and a project with ended sessions but no live agent
   *  gets a folder of its own after the live ones, newest conversation first. A collapsed project keeps its group
   *  row and loses everything under it, agents and sessions alike. */
  export function buildSidebarRows(
      rows: AgentTreeRow[],
      ended: ReadonlyMap<string, EndedSessionRow[]>,
      collapsed: ReadonlySet<string>,
      pages: Readonly<Record<string, number>>
  ): SidebarRow[] {
      const out: SidebarRow[] = [];
      const placed = new Set<string>();
      let project: string | null = null;
      const flush = () => {
          if (project != null && !collapsed.has(project)) {
              out.push(...sessionRowsOf(project, ended.get(project) ?? [], pages));
          }
      };
      for (const r of rows) {
          if (r.kind === "group") {
              flush();
              project = r.project;
              placed.add(r.project);
              out.push(r);
          } else if (project != null && !collapsed.has(project)) {
              out.push(r);
          }
      }
      flush();
      const agentless = [...ended.entries()]
          .filter(([p]) => !placed.has(p))
          .sort(([, a], [, b]) => b[0].lastactivets - a[0].lastactivets);
      for (const [p, list] of agentless) {
          out.push({ kind: "group", project: p, count: 0, attn: 0 });
          if (!collapsed.has(p)) {
              out.push(...sessionRowsOf(p, list, pages));
          }
      }
      return out;
  }

  /** Pure: did an agent leave the roster between two snapshots of its ids? Its session just ended, so the sidebar
   *  rescans. */
  export function agentExited(prev: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
      for (const id of prev) {
          if (!next.has(id)) {
              return true;
          }
      }
      return false;
  }

  export type ScanReason = "enter" | "exit";

  // the scan reads 30 days of transcripts across four runtimes: a quick re-entry must not repeat it
  const SCAN_MIN_GAP_MS: Record<ScanReason, number> = { enter: 5_000, exit: 1_000 };

  /** Pure: is a sidebar scan due, `lastAt` being when the previous one started (0 for none)? */
  export function scanDue(lastAt: number, now: number, reason: ScanReason): boolean {
      return now - lastAt >= SCAN_MIN_GAP_MS[reason];
  }
  ```
  Run `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts`. Expected: all tests pass.

- [ ] **Step 6: Commit**
  ```bash
  git add frontend/app/view/agents/agentcenter.ts frontend/app/view/agents/agentcenter.test.ts frontend/app/view/agents/agentsidebarmodel.ts frontend/app/view/agents/agentsidebarmodel.test.ts
  git commit -m "feat(agent): centre-mode atom and the sidebar's merged session model" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 2: Move the Sessions master-detail into `ConversationHistory`

**Depends on:** Task 1
**Files:**
- Rename + modify: `frontend/app/view/agents/sessionssurface.tsx` -> `frontend/app/view/agents/conversationhistory.tsx` (`SessionsSurface` -> `ConversationHistory`)
- Modify: `frontend/app/view/agents/focusstore.ts` (`focusRevealAtom`, `revealSurface`, `concealSurface`, new `RevealKey`)
- Modify: `frontend/app/view/agents/focusbanner.tsx` (`FocusBanner` prop type)
- Modify: `frontend/app/view/agents/cockpitshell.tsx` (the `surface === "sessions"` branch, temporary until Task 7)

> NOTE: `focusRevealAtom` is `Set<SurfaceKey>` and the Cockpit already uses the key `"agent"` for its own roster reveal
> (`cockpitsurface.tsx`, `focusRevealAtom.has("agent")`). Reusing `"agent"` for History would tie the two "Show all" toggles
> together, so History gets its own key `"history"` through a widened `RevealKey = SurfaceKey | "history"`.

> NOTE: `ConversationHistory` keeps the project filter (`projectFilterAtom`) and the Space scope the Sessions surface applied,
> as decision 5 says "unchanged". The Agent surface is a "subject" surface in `SURFACE_CONTEXT`, so the app bar's project control
> reads "Default · X" there while History still filters by it. See Stage 1 risks.

> NOTE: until Task 7 the shell still renders this component for `surface === "sessions"`. `navSurface` is the surface whose keys the
> list cursor answers on: `"agent"` (default), or `"sessions"` for that interim branch. Task 7 removes the prop.

- [ ] **Step 1: Move the file with history**
  ```bash
  git mv frontend/app/view/agents/sessionssurface.tsx frontend/app/view/agents/conversationhistory.tsx
  ```
  (`git mv` stages the rename; do not `git add` the old path afterwards, it no longer exists.)

- [ ] **Step 2: Edit `conversationhistory.tsx` (header comment and imports)**
  Replace the file's leading comment block
  ```tsx
  // Merged Sessions surface (absorbs the old Activity tab). Master-detail: a recency-grouped list with a pinned
  // "All activity" entry. An orchestrator run is one entry, with a row under it only for the members that need
  // you; its detail lists the lead and every task and reads the one in view. Every other session is its own
  // entry. Live agents are overlaid (matched by transcript path) so the primary action is Jump (live) or Resume
  // (ended). @theme tokens only — no hardcoded colors.
  ```
  with
  ```tsx
  // Conversation History: the old Sessions surface's master-detail, now the Agent surface's `history` centre mode
  // (agentcenter.ts). A recency-grouped list with a pinned "All activity" entry. An orchestrator run is one entry, with
  // a row under it only for the members that need you; its detail lists the lead and every task and reads the one in
  // view. Every other session is its own entry. Live agents are overlaid (matched by transcript path) so the primary
  // action is Jump (live) or Resume (ended). @theme tokens only — no hardcoded colors.
  ```
  Replace `import { Activity, Check, Workflow } from "lucide-react";` with
  `import { Activity, ArrowLeft, Check, Workflow } from "lucide-react";`
  Replace `import type { AgentsViewModel } from "./agents";` with
  ```tsx
  import { showTerminal } from "./agentcenter";
  import type { AgentsViewModel, SurfaceKey } from "./agents";
  ```

- [ ] **Step 3: Edit `conversationhistory.tsx` (component, scope key, list cursor)**
  Replace
  ```tsx
  export function SessionsSurface({ model }: { model: AgentsViewModel }) {
  ```
  with
  ```tsx
  // navSurface is the surface whose keys the list cursor answers on. History lives in the Agent surface; the prop exists only
  // for the Sessions surface the shell still renders this for until it is removed.
  export function ConversationHistory({
      model,
      navSurface = "agent",
  }: {
      model: AgentsViewModel;
      navSurface?: SurfaceKey;
  }) {
  ```
  Replace `const spaceRevealed = useAtomValue(focusRevealAtom).has("sessions");` with
  `const spaceRevealed = useAtomValue(focusRevealAtom).has("history");`
  Replace the list-nav controller
  ```tsx
        () => ({
            surface: "sessions",
            navigableIds: navIds,
            cursorId,
            setCursor: (id) => selectRef.current(id),
            activate: () => actRef.current(),
        }),
        [navIds, cursorId]
  ```
  with
  ```tsx
        () => ({
            surface: navSurface,
            navigableIds: navIds,
            cursorId,
            setCursor: (id) => selectRef.current(id),
            activate: () => actRef.current(),
        }),
        [navSurface, navIds, cursorId]
  ```

- [ ] **Step 4: Edit `conversationhistory.tsx` (header, banner, empty-state action, root marker)**
  Replace
  ```tsx
            <div className="flex h-full min-h-0 flex-col bg-background">
                <SurfaceHeader
                    title="Sessions"
  ```
  with
  ```tsx
            <div data-agent-history className="flex h-full min-h-0 flex-col bg-background">
                {navSurface === "agent" ? (
                    <button
                        type="button"
                        data-history-close
                        onClick={showTerminal}
                        className="ml-[28px] mt-3 flex w-fit flex-none cursor-pointer items-center gap-[6px] rounded-[6px] px-[6px] py-[3px] text-[12px] text-muted hover:bg-surface-hover hover:text-secondary"
                    >
                        <ArrowLeft size={13} aria-hidden />
                        Back to terminal
                    </button>
                ) : null}
                <SurfaceHeader
                    title="Conversation History"
  ```
  Replace `surface="sessions"` (the `<FocusBanner` prop) with `surface="history"`.
  Replace `onClick: () => revealSurface("sessions"),` with `onClick: () => revealSurface("history"),`.

- [ ] **Step 5: Widen the reveal key in `focusstore.ts` and `focusbanner.tsx`**
  In `focusstore.ts` replace
  ```ts
  export const focusRevealAtom = atom<Set<SurfaceKey>>(new Set<SurfaceKey>());
  ```
  with
  ```ts
  // a surface, or the Agent surface's Conversation History pane, which is scoped on its own
  export type RevealKey = SurfaceKey | "history";
  export const focusRevealAtom = atom<Set<RevealKey>>(new Set<RevealKey>());
  ```
  Replace both `globalStore.set(focusRevealAtom, new Set<SurfaceKey>());` (in `enterFocus` and `exitFocus`) with
  `globalStore.set(focusRevealAtom, new Set<RevealKey>());`
  Replace `export function revealSurface(key: SurfaceKey): void {` with `export function revealSurface(key: RevealKey): void {`
  and `export function concealSurface(key: SurfaceKey): void {` with `export function concealSurface(key: RevealKey): void {`.
  In `focusbanner.tsx` replace
  ```tsx
  import type { SurfaceKey } from "./agents";
  import type { FocusBannerCopy } from "./focusscope";
  import { concealSurface, exitFocus, focusRestoredAtom, revealSurface } from "./focusstore";
  ```
  with
  ```tsx
  import type { FocusBannerCopy } from "./focusscope";
  import { concealSurface, exitFocus, focusRestoredAtom, revealSurface, type RevealKey } from "./focusstore";
  ```
  and `surface: SurfaceKey;` (in `FocusBanner`'s props) with `surface: RevealKey;`.

- [ ] **Step 6: Keep the old surface alive on the moved component (until Task 7)**
  In `cockpitshell.tsx` replace `import { SessionsSurface } from "./sessionssurface";` with
  `import { ConversationHistory } from "./conversationhistory";` and replace `<SessionsSurface model={model} />` with
  `<ConversationHistory model={model} navSurface="sessions" />`.

- [ ] **Step 7: Verify**
  Run `npx vitest run frontend/app/view/agents/focusscope.test.ts` (unchanged logic; guards the banner copy the component feeds).
  Expected: passes. Then, requires `task dev` running: `task verify:ui -- surface-smoke` (nothing blanks), and open the Sessions
  nav item once by hand: the header reads "Conversation History" and the list/detail behave as before.

- [ ] **Step 8: Commit**
  ```bash
  git add frontend/app/view/agents/conversationhistory.tsx frontend/app/view/agents/focusstore.ts frontend/app/view/agents/focusbanner.tsx frontend/app/view/agents/cockpitshell.tsx
  git commit -m "refactor(sessions): move the Sessions master-detail into ConversationHistory" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 3: Centre modes in `AgentSurface`, the session pane, and "choosing an agent returns to the terminal"

**Depends on:** Task 1, Task 2
**Files:**
- Create: `frontend/app/view/agents/sessionpane.tsx`
- Modify: `frontend/app/view/agents/agentsurface.tsx` (`AgentSurface`, new `AgentCenterPane`)
- Modify: `frontend/app/view/agents/agents.tsx` (`AgentsViewModel.openTerminal`, `cycleFocus`)
- Modify: `frontend/app/cockpit/cockpit-actions.ts` (`launchAgent`)
- Modify: `frontend/app/view/agents/channelsprimitives.tsx` (`jumpToAgent`)
- Modify: `frontend/app/view/agents/cockpitsurface.tsx` (`openFocus`)
- Modify: `frontend/app/view/agents/sessionsdetail.tsx` (`runSessionPrimary`)
- Modify: `frontend/app/view/agents/agentlaunchhero.tsx` (`AgentLaunchHero`)

> NOTE: the session pane reuses `SoloDetail` (`sessionsdetail.tsx`), which already is "one session read as its transcript with a
> primary button": `useTranscript` feeding `NarrationTimeline`, and a `Resume →` button on `runSessionPrimary` (`launchAgent` with
> the session's resume command; a new tab on the same transcript). It also carries History's Transcript/Activity toggle, which is
> harmless here. `useTranscript` is not exported and does not need to be.

> NOTE: `launchAgent` already sets `focusIdAtom` and `surfaceAtom = "agent"` for a non-terminal launch, so Resume lands in the new
> agent's terminal once `launchAgent` also calls `showTerminal()`.

- [ ] **Step 1: Create the session pane**
  Create `frontend/app/view/agents/sessionpane.tsx`:
  ```tsx
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The Agent surface's `session` centre mode: one ended session read as its transcript, with Resume. It is SoloDetail
  // (sessionsdetail.tsx) in the centre column, so it is the same read History gives a solo session: useTranscript feeding
  // NarrationTimeline, and a primary button on runSessionPrimary, which resumes through launchAgent into a new tab on the
  // same transcript. Which session is the model's sessionsSelAtom.

  import { useAtomValue } from "jotai";
  import { ArrowLeft } from "lucide-react";
  import { useMemo } from "react";
  import { showTerminal } from "./agentcenter";
  import type { AgentsViewModel } from "./agents";
  import { overlayLive, resolveSelectedSession, sessionsArchiveAtom } from "./sessionsarchivestore";
  import { SoloDetail } from "./sessionsdetail";
  import { TranscriptSkeleton } from "./transcriptskeleton";

  export function SessionPane({ model }: { model: AgentsViewModel }) {
      const sel = useAtomValue(model.sessionsSelAtom);
      const archive = useAtomValue(sessionsArchiveAtom);
      const roster = useAtomValue(model.agentsAtom);
      // the overlay never reads the clock, so the 1s now-tick is not a dependency
      const session = useMemo(
          () => (archive == null ? undefined : resolveSelectedSession(overlayLive(archive, roster, 0), sel)),
          [archive, roster, sel]
      );
      return (
          <div data-agent-session className="flex min-h-0 min-w-0 flex-1 flex-col px-8 py-[22px]">
              <button
                  type="button"
                  data-session-back
                  onClick={showTerminal}
                  className="mb-3 flex w-fit flex-none cursor-pointer items-center gap-[6px] rounded-[6px] px-[6px] py-[3px] text-[12px] text-muted hover:bg-surface-hover hover:text-secondary"
              >
                  <ArrowLeft size={13} aria-hidden />
                  Back to terminal
              </button>
              <div className="flex min-h-0 flex-1 flex-col">
                  {archive == null ? (
                      <TranscriptSkeleton className="pt-3" />
                  ) : session == null ? (
                      <div className="py-4 text-[13px] text-muted">This session is no longer in the archive.</div>
                  ) : (
                      <SoloDetail model={model} session={session} />
                  )}
              </div>
          </div>
      );
  }
  ```

- [ ] **Step 2: `AgentSurface` — imports, mode, focus handoff**
  In `agentsurface.tsx`, replace `import type { AgentsViewModel } from "./agents";` with
  ```tsx
  import { centerModeAtom, type CenterMode } from "./agentcenter";
  import type { AgentsViewModel } from "./agents";
  ```
  and after `import { AgentTree } from "./agenttree";` add
  ```tsx
  import { ConversationHistory } from "./conversationhistory";
  ```
  and after `import { rosterSeededAtom } from "./liveagents";` add
  ```tsx
  import { SessionPane } from "./sessionpane";
  ```
  Replace `const seeded = useAtomValue(rosterSeededAtom);` with
  ```tsx
    const seeded = useAtomValue(rosterSeededAtom);
    // what the centre column shows: the terminal, one session's transcript, or Conversation History (agentcenter.ts).
    // The terminal stack below stays mounted, hidden, in the other two.
    const centerMode = useAtomValue(centerModeAtom);
  ```
  Insert this effect immediately before the comment that begins `// the surface stays mounted, so the effects above never run on a switch back to it`:
  ```tsx
    // History and a session's transcript cover the terminal as canvas mode does, and a hidden xterm can still hold focus
    // and eat the surface's keys (Esc, j/k): leaving the terminal pulls focus to the wrapper, and returning to it hands
    // focus back to the focused agent's xterm
    const lastCenter = useRef<CenterMode>(centerMode);
    useEffect(() => {
        const prev = lastCenter.current;
        lastCenter.current = centerMode;
        if (centerMode !== "terminal" && prev === "terminal") {
            wrapRef.current?.focus();
        } else if (centerMode === "terminal" && prev !== "terminal" && agent != null && !canvasMode) {
            wrapRef.current
                ?.querySelector<HTMLElement>(`[data-agent-terminal="${agent.id}"] .xterm-helper-textarea`)
                ?.focus();
        }
    }, [centerMode]);

  ```

- [ ] **Step 3: `AgentSurface` — the zero-agent branch and the layout**
  Replace
  ```tsx
    if (!agent) {
        return rosterLoadPhase(seeded, agents.length) === "loading" ? (
            <AgentSurfaceSkeleton />
        ) : (
            <AgentLaunchHero model={model} />
        );
    }
  ```
  with
  ```tsx
    if (!agent) {
        if (rosterLoadPhase(seeded, agents.length) === "loading") {
            return <AgentSurfaceSkeleton />;
        }
        if (centerMode === "terminal") {
            return <AgentLaunchHero model={model} />;
        }
        // History and a session read without an agent: the tree is where they are opened from
        return (
            <MotionConfig reducedMotion="user">
                <div
                    ref={wrapRef}
                    tabIndex={0}
                    data-cockpit-surface-wrap
                    className="flex h-full w-full bg-background outline-none"
                >
                    <AgentTree model={model} />
                    <div className="flex min-w-0 flex-1 flex-col">
                        <AgentCenterPane model={model} mode={centerMode} />
                    </div>
                </div>
            </MotionConfig>
        );
    }
  ```
  Replace `{!fullscreen ? <AgentTree model={model} /> : null}` with
  `{!fullscreen || centerMode !== "terminal" ? <AgentTree model={model} /> : null}`.
  Replace
  ```tsx
                    <div className={cn("flex min-h-0 flex-1 flex-col", showSub && "hidden")}>
  ```
  with
  ```tsx
                    <div className={cn("flex min-h-0 flex-1 flex-col", (showSub || centerMode !== "terminal") && "hidden")}>
  ```
  and update the comment above it (`terminal stack stays mounted (hidden) while a subagent interior is shown, so`) to read
  `terminal stack stays mounted (hidden) while a subagent interior, a session or History is shown, so`.
  Replace `{showSub ? <SubagentInterior sub={focusSub!} parentName={agent.name} /> : null}` with
  ```tsx
                    {showSub && centerMode === "terminal" ? (
                        <SubagentInterior sub={focusSub!} parentName={agent.name} />
                    ) : null}
                    {centerMode !== "terminal" ? <AgentCenterPane model={model} mode={centerMode} /> : null}
  ```
  Replace `{!fullscreen && !canvasMode && agent.kind !== "terminal" ? (` (the `AgentDetailsRail` guard) with
  `{!fullscreen && centerMode === "terminal" && !canvasMode && agent.kind !== "terminal" ? (`.
  Insert, between the end of `AgentSurface` and the `// the tree column and the terminal pane, so the first agent lands` comment:
  ```tsx
  // History and a session's transcript take the centre column; the terminal stack stays mounted beside them
  function AgentCenterPane({ model, mode }: { model: AgentsViewModel; mode: Exclude<CenterMode, "terminal"> }) {
      return (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {mode === "history" ? <ConversationHistory model={model} /> : <SessionPane model={model} />}
          </div>
      );
  }

  ```

- [ ] **Step 4: Every route that chooses an agent brings the terminal back**
  `agents.tsx`: add `import { showTerminal } from "./agentcenter";` next to the other local imports. Replace
  ```ts
    openTerminal(agentId: string) {
        globalStore.set(this.focusIdAtom, agentId);
        globalStore.set(this.surfaceAtom, "agent");
    }
  ```
  with
  ```ts
    openTerminal(agentId: string) {
        globalStore.set(this.focusIdAtom, agentId);
        globalStore.set(this.surfaceAtom, "agent");
        showTerminal();
    }
  ```
  and in `cycleFocus` replace
  ```ts
        if (next != null) {
            globalStore.set(this.focusIdAtom, next);
        }
  ```
  with
  ```ts
        if (next != null) {
            globalStore.set(this.focusIdAtom, next);
            showTerminal();
        }
  ```
  `cockpit-actions.ts`: add `import { showTerminal } from "@/app/view/agents/agentcenter";` and in `launchAgent` replace
  ```ts
    if (!isTerminal) {
        globalStore.set(model.focusIdAtom, tabId);
        globalStore.set(model.surfaceAtom, "agent");
    }
  ```
  with
  ```ts
    if (!isTerminal) {
        globalStore.set(model.focusIdAtom, tabId);
        globalStore.set(model.surfaceAtom, "agent");
        // a resumed session opens its new tab over the transcript it was resumed from
        showTerminal();
    }
  ```
  `channelsprimitives.tsx`: add `import { showTerminal } from "./agentcenter";` and replace `jumpToAgent`'s body
  ```ts
    globalStore.set(model.focusIdAtom, id);
    globalStore.set(model.surfaceAtom, "agent");
  ```
  with
  ```ts
    globalStore.set(model.focusIdAtom, id);
    globalStore.set(model.surfaceAtom, "agent");
    showTerminal();
  ```
  `cockpitsurface.tsx`: add `import { showTerminal } from "./agentcenter";` and in `openFocus` replace
  ```tsx
        globalStore.set(model.focusReplyAtom, reply);
        globalStore.set(model.surfaceAtom, "agent");
  ```
  with
  ```tsx
        globalStore.set(model.focusReplyAtom, reply);
        globalStore.set(model.surfaceAtom, "agent");
        showTerminal();
  ```
  `sessionsdetail.tsx`: add `import { showTerminal } from "./agentcenter";` and in `runSessionPrimary` replace
  ```ts
        globalStore.set(model.focusIdAtom, session.liveId);
        globalStore.set(model.surfaceAtom, "agent");
        return;
  ```
  with
  ```ts
        globalStore.set(model.focusIdAtom, session.liveId);
        globalStore.set(model.surfaceAtom, "agent");
        showTerminal();
        return;
  ```

- [ ] **Step 5: A way into History from the zero-agent hero**
  In `agentlaunchhero.tsx` add `import { showHistory } from "./agentcenter";` and, directly after the `Launch new terminal` button
  ```tsx
                    Launch new terminal
                </button>
  ```
  add
  ```tsx
                <button
                    type="button"
                    data-hero-history
                    onClick={() => showHistory(model)}
                    className="mt-3 cursor-pointer text-[12.5px] font-semibold text-accent-soft hover:underline"
                >
                    Conversation History
                </button>
  ```

- [ ] **Step 6: Verify**
  Run `npx vitest run frontend/app/view/agents/agentcenter.test.ts` and `npx vitest run frontend/app/cockpit/cockpit-actions.test.ts`.
  Expected: both pass (`launchAgent`'s extra `showTerminal()` only sets a module atom).
  Requires `task dev` running: `task verify:ui -- surface-smoke` (the Agent step still finds a terminal or skips), and
  `task verify:ui -- tui-fullscreen` (nearest existing check that the terminal stack is not remounted or resized).

- [ ] **Step 7: Commit**
  ```bash
  git add frontend/app/view/agents/sessionpane.tsx frontend/app/view/agents/agentsurface.tsx frontend/app/view/agents/agents.tsx frontend/app/cockpit/cockpit-actions.ts frontend/app/view/agents/channelsprimitives.tsx frontend/app/view/agents/cockpitsurface.tsx frontend/app/view/agents/sessionsdetail.tsx frontend/app/view/agents/agentlaunchhero.tsx
  git commit -m "feat(agent): session and History centre modes in the Agent surface" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 4: Keys for the centre modes

**Depends on:** Task 1, Task 3
**Files:**
- Modify: `frontend/app/store/keybindings/bindings.ts` (`GO_TARGETS`, `buildGlobalBindings` `goBindings`, `agentNav`, `agentNavStrict`, `buildAgentBindings`)
- Modify: `frontend/app/store/keybindings/whenstate.ts` (`PREDICATE_ATOMS`)
- Modify: `frontend/app/cockpit/footerhints.ts` (`SURFACE_HINTS.agent`)
- Test: `frontend/app/store/keybindings/bindings.test.ts`
- Test: `frontend/app/store/keybindings/store.test.ts`

> NOTE: History publishes a list cursor (`useSurfaceListNav`) with `surface: "agent"`, because the rich surfaces own their keys
> and the registry's `list:*` bindings are active when `controller.surface === ctx.surface`. `j`/`k` would then belong to both
> `list:next-j` and `agent:next-j`. The fix mirrors canvas mode: every Agent-surface key (`agentNav`, `agentNavStrict`) stands
> down unless the centre is on the terminal. `Esc` gets a new binding that returns to the terminal; it is exclusive with
> `agent:back` (`Esc` to the Cockpit) and with `subagent:back` (it requires no focused subagent).

> NOTE: `PREDICATE_ATOMS` (`whenstate.ts`) must list every atom a `when()` reads, or the "PREDICATE_ATOMS completeness" test in
> `store.test.ts` fails and the hints footer goes stale. `centerModeAtom` is read from `agentNav`, `agentNavStrict` and the new binding.

- [ ] **Step 1: Write the failing tests**
  In `bindings.test.ts` add to the imports `import { centerModeAtom } from "@/app/view/agents/agentcenter";` and append:
  ```ts
  describe("Agent centre modes", () => {
      const agentCtx: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
      const find = (id: string) => buildAgentBindings(stubModel()).find((b) => b.id === id)!;

      afterEach(() => {
          globalStore.set(centerModeAtom, "terminal");
          globalStore.set(focusSubagentAtom, null);
      });

      it("keeps the agent keys live on the terminal and stands them down while History or a session is open", () => {
          const next = find("agent:next-j");
          const rail = find("agent:toggle-rail");
          expect(next.when!(agentCtx)).toBe(true);
          expect(rail.when!(agentCtx)).toBe(true);
          for (const mode of ["history", "session"] as const) {
              globalStore.set(centerModeAtom, mode);
              expect(next.when!(agentCtx)).toBe(false);
              expect(rail.when!(agentCtx)).toBe(false);
          }
      });

      it("gives Escape to the terminal while History or a session is open, and to the Cockpit otherwise", () => {
          const back = find("agent:back");
          const leave = find("agent:leave-center");
          expect(leave.keys).toBe("Escape");
          expect(back.when!(agentCtx)).toBe(true);
          expect(leave.when!(agentCtx)).toBe(false);
          for (const mode of ["history", "session"] as const) {
              globalStore.set(centerModeAtom, mode);
              expect(back.when!(agentCtx)).toBe(false);
              expect(leave.when!(agentCtx)).toBe(true);
          }
      });

      it("lets a focused subagent's Escape close it before leaving the centre mode", () => {
          globalStore.set(centerModeAtom, "session");
          globalStore.set(focusSubagentAtom, { parentId: "p", agentId: "s" } as any);
          expect(find("agent:leave-center").when!(agentCtx)).toBe(false);
          expect(find("subagent:back").when!(agentCtx)).toBe(true);
      });

      it("leaves Escape inside a text field to the field", () => {
          globalStore.set(centerModeAtom, "history");
          expect(find("agent:leave-center").when!({ ...agentCtx, editable: true })).toBe(false);
      });

      it("returns to the terminal when run", () => {
          globalStore.set(centerModeAtom, "history");
          find("agent:leave-center").run(agentCtx);
          expect(globalStore.get(centerModeAtom)).toBe("terminal");
      });
  });

  describe("g s: Conversation History", () => {
      it("opens History in the Agent surface and leaves g a on the Agent surface itself", () => {
          const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
          const bindings = buildGlobalBindings(model);
          const history = bindings.find((b) => b.id === "go:history")!;
          expect(history.keys).toBe("g s");
          expect(bindings.find((b) => b.id === "go:agent")!.keys).toBe("g a");
          history.run(ctx());
          expect(globalStore.get(model.surfaceAtom)).toBe("agent");
          expect(globalStore.get(centerModeAtom)).toBe("history");
          globalStore.set(centerModeAtom, "terminal");
      });
  });
  ```
  In `store.test.ts` add `import { centerModeAtom } from "@/app/view/agents/agentcenter";` and, after the test
  `"global + list-nav + agent bindings do not conflict (no controller)"`, add:
  ```ts
      // History publishes a list cursor for the Agent surface; j/k must belong to the list alone while it is open
      it("global + list-nav + agent bindings do not conflict while History is open with its cursor published", () => {
          const model = stubModel();
          globalStore.set(centerModeAtom, "history");
          globalStore.set(listNavAtom, { surface: "agent", navigableIds: ["all"], cursorId: "all", setCursor() {} });
          try {
              expect(() =>
                  assertNoConflicts([
                      ...buildGlobalBindings(model),
                      ...buildListNavBindings(model),
                      ...buildAgentBindings(model),
                  ])
              ).not.toThrow();
              // not vacuous: the list's j is live on the Agent surface and the agent's j is not
              const ctx = { surface: "agent" as const, editable: false, modalOpen: false, leader: null };
              expect(buildListNavBindings(model).find((b) => b.id === "list:next-j")!.when!(ctx)).toBe(true);
              expect(buildAgentBindings(model).find((b) => b.id === "agent:next-j")!.when!(ctx)).toBe(false);
          } finally {
              globalStore.set(centerModeAtom, "terminal");
              globalStore.set(listNavAtom, null);
          }
      });

  ```

- [ ] **Step 2: Run the tests; expect failures**
  `npx vitest run frontend/app/store/keybindings/bindings.test.ts` (fails: `agent:leave-center` / `go:history` undefined) and
  `npx vitest run frontend/app/store/keybindings/store.test.ts` (fails: `j` conflict).

- [ ] **Step 3: Implement in `bindings.ts`**
  Add `import { centerModeAtom, showHistory, showTerminal } from "@/app/view/agents/agentcenter";` beside the other
  `@/app/view/agents/...` imports.
  Replace
  ```ts
  // g-leader surface teleports (collision-free letters; see design spec).
  const GO_TARGETS: { letter: string; surface: SurfaceKey; label: string }[] = [
  ```
  with
  ```ts
  // g-leader surface teleports (collision-free letters; see design spec). Conversation History is a mode of the Agent
  // surface, not a surface, so its target carries its own id and opens History.
  const GO_TARGETS: { letter: string; surface: SurfaceKey; label: string; id?: string; history?: boolean }[] = [
  ```
  Replace `    { letter: "s", surface: "sessions", label: "Sessions" },` with
  `    { letter: "s", surface: "agent", label: "Conversation History", id: "go:history", history: true },`
  Replace
  ```ts
    const goBindings: Binding[] = GO_TARGETS.map((t) => ({
        id: `go:${t.surface}`,
        keys: `g ${t.letter}`,
        group: "Go to",
        label: t.label,
        when: navigate,
        run: () => globalStore.set(model.surfaceAtom, t.surface),
    }));
  ```
  with
  ```ts
    const goBindings: Binding[] = GO_TARGETS.map((t) => ({
        id: t.id ?? `go:${t.surface}`,
        keys: `g ${t.letter}`,
        group: "Go to",
        label: t.label,
        when: navigate,
        run: () => (t.history ? showHistory(model) : globalStore.set(model.surfaceAtom, t.surface)),
    }));
  ```
  Replace
  ```ts
  const agentNav = (ctx: KeyContext) => navigate(ctx) && ctx.surface === "agent";
  const agentNavStrict = (ctx: KeyContext) => navigateStrict(ctx) && ctx.surface === "agent";
  ```
  with
  ```ts
  // History and a session's transcript cover the terminal, so the keys that act on the focused agent (j/k, the arrows, d, f,
  // r, c) stand down there: History publishes its own list cursor on this surface, and j/k must belong to it alone
  const centerAtRest = () => globalStore.get(centerModeAtom) === "terminal";
  const agentNav = (ctx: KeyContext) => navigate(ctx) && ctx.surface === "agent" && centerAtRest();
  const agentNavStrict = (ctx: KeyContext) => navigateStrict(ctx) && ctx.surface === "agent" && centerAtRest();
  ```
  In `buildAgentBindings`, insert before the object whose `id: "agent:prev",` (right after the `agent:back` object):
  ```ts
        {
            id: "agent:leave-center",
            keys: "Escape",
            group: "Agent",
            label: "Back to the terminal (from History or a session)",
            paletteHidden: true, // a posture: Escape while reading
            // exclusive with agent:back (which needs the centre at rest) and with subagent:back (which needs a focused
            // subagent), so Escape never means two things
            when: (ctx) =>
                navigateStrict(ctx) &&
                ctx.surface === "agent" &&
                !centerAtRest() &&
                globalStore.get(focusSubagentAtom) == null,
            run: () => showTerminal(),
        },
  ```
  (`agent:back`'s own `when`, `agentNavStrict(ctx) && ... && noCanvas()`, needs no edit: it now includes `centerAtRest()` through `agentNavStrict`.)

- [ ] **Step 4: Register the predicate atom and the footer chip**
  In `whenstate.ts` add `import { centerModeAtom } from "@/app/view/agents/agentcenter";` with the other `@/app/view/agents/...` imports and, as the last
  entry of `PREDICATE_ATOMS`, after `focusSubagentAtom, // buildAgentBindings: subagent:back, agent:back`:
  ```ts
    centerModeAtom, // buildAgentBindings: agentNav / agentNavStrict (every Agent key), agent:back, agent:leave-center
  ```
  In `footerhints.ts`, in `SURFACE_HINTS.agent`, after the `agent:back` chip add
  ```ts
        { ids: ["agent:leave-center"], glyph: "esc", label: "terminal" }, // History or a session only, via its binding
  ```

- [ ] **Step 5: Run the tests**
  `npx vitest run frontend/app/store/keybindings/bindings.test.ts`, `npx vitest run frontend/app/store/keybindings/store.test.ts`,
  `npx vitest run frontend/app/cockpit/footerhints.test.ts`. Expected: all pass (`store.test.ts` includes the PREDICATE_ATOMS
  completeness test, which now sees `centerModeAtom` read and registered).

- [ ] **Step 6: Commit**
  ```bash
  git add frontend/app/store/keybindings/bindings.ts frontend/app/store/keybindings/whenstate.ts frontend/app/cockpit/footerhints.ts frontend/app/store/keybindings/bindings.test.ts frontend/app/store/keybindings/store.test.ts
  git commit -m "feat(keys): Esc leaves History or a session, agent keys stand down there, g s opens History" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 5: Sidebar UI — History button, ended-session rows, Show more, post-paint scan

**Depends on:** Task 1, Task 3
**Files:**
- Create: `frontend/app/view/agents/usesessionsscan.ts`
- Modify: `frontend/app/view/agents/agenttree.tsx` (`AgentTree`, `ParentRow`, `WorkerRow`, `StageRow`, `TerminalRow`, `CanvasTag`, new `SessionRow`, `MoreSessionsRow`)
- Modify: `frontend/app/view/agents/agentsurface.tsx` (`AgentSurface`: scan hook)
- Modify: `frontend/app/view/agents/sessionsarchivestore.ts` (`loadSessionsArchive`)

> NOTE: the `Terminals` group (header and `TerminalRow`s after the project rows) is left exactly as it is; Stage 2 moves it.

> NOTE: `AgentTree` is `memo`ed on purpose (its comment: a render in the surface-switch commit makes motion slide the rows). It
> must not subscribe to `surfaceAtom`, so the scan trigger that depends on "is the Agent surface showing" lives in
> `AgentSurface`, which already subscribes to it.

> NOTE: `loadSessionsArchive` drops a call made while a scan is running (`loading` guard). An agent exiting during the History
> mount's scan would then never refresh, so the guard now records the request and re-runs once.

> NOTE: scenarios that must keep passing and what they read in the tree: `agent-tree-rail` selects group buttons with
> `button[aria-expanded]:not([aria-label])` (the new header buttons and `Show more` carry no `aria-expanded`), looks for a button whose
> text is exactly `New agent`, treats `.cursor-pointer` rows containing a `span.rounded-full` as plain agent rows (session rows have
> no dot), and requires text >= 10.5px (session text is 11px/13px). `canvas-*` find `button[aria-pressed]` by text starting `canvas`.

- [ ] **Step 1: The session scan hook**
  Create `frontend/app/view/agents/usesessionsscan.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The sidebar's ended sessions come from a 30-day scan over four runtimes' transcript folders (GetSessionsActivity), so it
  // never runs at boot: AgentSurface is mounted from the first render, and the scan waits for the Agent surface to be showing
  // and for a first paint. It re-runs on each arrival and when an agent leaves the roster (its session just ended), within the
  // gaps scanDue allows. No timer: nothing here polls.

  import { fireAndForget } from "@/util/util";
  import { useEffect, useRef } from "react";
  import { agentExited, scanDue, type ScanReason } from "./agentsidebarmodel";
  import type { AgentVM } from "./agentsviewmodel";
  import { loadSessionsArchive } from "./sessionsarchivestore";

  // after the frame that mounted or revealed the surface has painted
  function afterPaint(run: () => void): () => void {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const raf = requestAnimationFrame(() => {
          timer = setTimeout(run, 0);
      });
      return () => {
          cancelAnimationFrame(raf);
          if (timer !== undefined) {
              clearTimeout(timer);
          }
      };
  }

  export function useSessionsScan(onAgentSurface: boolean, agents: AgentVM[]): void {
      const lastAt = useRef(0);
      const ids = useRef<Set<string>>(new Set(agents.map((a) => a.id)));
      const scan = (reason: ScanReason): (() => void) => {
          const now = Date.now();
          if (!scanDue(lastAt.current, now, reason)) {
              return () => {};
          }
          lastAt.current = now;
          return afterPaint(() => fireAndForget(loadSessionsArchive));
      };

      // arriving on the surface (including the first render, when it is the startup surface)
      useEffect(() => {
          if (!onAgentSurface) {
              return;
          }
          return scan("enter");
      }, [onAgentSurface]);

      // an agent exited: the transcript it was writing is now an ended session
      const idsKey = agents.map((a) => a.id).join(",");
      useEffect(() => {
          const next = new Set(agents.map((a) => a.id));
          const exited = agentExited(ids.current, next);
          ids.current = next;
          if (exited && onAgentSurface) {
              return scan("exit");
          }
      }, [idsKey]);
  }
  ```

- [ ] **Step 2: Call it from `AgentSurface`**
  In `agentsurface.tsx` add `import { useSessionsScan } from "./usesessionsscan";` and, directly after
  `const surface = useAtomValue(model.surfaceAtom);` (the one that follows the comment `// a lead's Spec/Plan review opens by itself`), add
  ```tsx
    // the sidebar's ended sessions: scanned after first paint on arriving here and when an agent exits, never at boot
    useSessionsScan(surface === "agent", agents);
  ```

- [ ] **Step 3: Let a refresh asked for mid-scan run**
  In `sessionsarchivestore.ts` replace
  ```ts
  let loading = false;

  export async function loadSessionsArchive(): Promise<void> {
      if (loading) {
          return;
      }
  ```
  with
  ```ts
  let loading = false;
  // a refresh asked for while a scan is running (an agent just exited) would be dropped, and the scan under way may have
  // read the transcripts before that session ended: it runs once more when this one finishes
  let again = false;

  export async function loadSessionsArchive(): Promise<void> {
      if (loading) {
          again = true;
          return;
      }
  ```
  and replace
  ```ts
      } finally {
          loading = false;
      }
  }
  ```
  (the end of `loadSessionsArchive`) with
  ```ts
      } finally {
          loading = false;
          if (again) {
              again = false;
              void loadSessionsArchive();
          }
      }
  }
  ```

- [ ] **Step 4: `agenttree.tsx` — imports and module helpers**
  Replace the lucide import list
  ```tsx
    Folder,
    FolderOpen,
    Pencil,
    Plus,
  ```
  with
  ```tsx
    Folder,
    FolderOpen,
    History as HistoryIcon,
    MessageSquare,
    Pencil,
    Play,
    Plus,
  ```
  Replace `import { useAtomValue } from "jotai";` with `import { atom, useAtomValue } from "jotai";`.
  Replace `import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";` with
  `import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";`.
  Replace the `./agenttreemodel` import
  ```tsx
  import {
      buildAgentTree,
      foldCollapsedProjects,
      stageSubline,
      treeAgentCount,
      type StageOutcome,
  } from "./agenttreemodel";
  ```
  with
  ```tsx
  import { buildAgentTree, stageSubline, type StageOutcome } from "./agenttreemodel";
  ```
  After `import { renamingRowAtom } from "./rowrenameatom";` add
  ```tsx
  import { centerModeAtom, showHistory, showSession, showTerminal } from "./agentcenter";
  import {
      buildSidebarRows,
      endedSessionsByProject,
      sessionAgeLabel,
      showMore,
      type EndedSessionRow,
  } from "./agentsidebarmodel";
  import { sessionsArchiveAtom } from "./sessionsarchivestore";
  import { runSessionPrimary } from "./sessionsdetail";
  ```
  After `endRowRename` (before `// The inline rename editor, shared by both row kinds`) add
  ```tsx
  // how many times "Show more" was pressed under each project (five more ended sessions per press); session-scoped, and
  // module-level so it survives the tree re-rendering
  const sessionPagesAtom = atom<Record<string, number>>({});

  // choosing an agent's row brings its terminal back from a session or History
  function selectAgentRow(model: AgentsViewModel, id: string): void {
      globalStore.set(model.focusIdAtom, id);
      globalStore.set(model.focusReplyAtom, false);
      showTerminal();
  }

  // the row that reads as selected: the focused agent's, unless the centre is showing a session or History instead
  function useSelectedRowId(model: AgentsViewModel): string | undefined {
      const focusId = useAtomValue(model.focusIdAtom);
      const mode = useAtomValue(centerModeAtom);
      return mode === "terminal" ? focusId : undefined;
  }

  ```

- [ ] **Step 5: `agenttree.tsx` — the row components pick their selection and select through the helpers**
  In `CanvasTag`, replace
  ```tsx
              globalStore.set(model.focusIdAtom, id);
              setCanvasMode(id, showing ? "terminal" : "canvas", Date.now());
  ```
  with
  ```tsx
              globalStore.set(model.focusIdAtom, id);
              showTerminal();
              setCanvasMode(id, showing ? "terminal" : "canvas", Date.now());
  ```
  `ParentRow`: replace
  ```tsx
      const focusId = useAtomValue(model.focusIdAtom);
      const now = useAtomValue(model.nowAtom);
      const oref = `block:${agent.blockId}`;
  ```
  with
  ```tsx
      const focusId = useSelectedRowId(model);
      const now = useAtomValue(model.nowAtom);
      const oref = `block:${agent.blockId}`;
  ```
  and replace
  ```tsx
      const renaming = useAtomValue(renamingRowAtom) === agent.id;

      const select = () => {
          globalStore.set(model.focusIdAtom, agent.id);
          globalStore.set(model.focusReplyAtom, false);
      };
  ```
  with
  ```tsx
      const renaming = useAtomValue(renamingRowAtom) === agent.id;

      const select = () => selectAgentRow(model, agent.id);
  ```
  In `ParentRow`'s subagent child row, replace
  ```tsx
                                      globalStore.set(model.focusIdAtom, agent.id);
                                      globalStore.set(focusSubagentAtom, {
  ```
  with
  ```tsx
                                      globalStore.set(model.focusIdAtom, agent.id);
                                      showTerminal();
                                      globalStore.set(focusSubagentAtom, {
  ```
  `WorkerRow`: replace
  ```tsx
      const focusId = useAtomValue(model.focusIdAtom);
      const now = useAtomValue(model.nowAtom);
      // the task's state and question belong to its worker's row, not to the tabs nested under it
  ```
  with
  ```tsx
      const focusId = useSelectedRowId(model);
      const now = useAtomValue(model.nowAtom);
      // the task's state and question belong to its worker's row, not to the tabs nested under it
  ```
  and replace
  ```tsx
          if (focusKey == null) {
              return;
          }
          globalStore.set(model.focusIdAtom, focusKey);
          globalStore.set(model.focusReplyAtom, false);
      };
  ```
  with
  ```tsx
          if (focusKey == null) {
              return;
          }
          selectAgentRow(model, focusKey);
      };
  ```
  `StageRow`: replace
  ```tsx
      const focusId = useAtomValue(model.focusIdAtom);
      const now = useAtomValue(model.nowAtom);
      const selected = focusId === agent.id;
      const select = () => {
          globalStore.set(model.focusIdAtom, agent.id);
          globalStore.set(model.focusReplyAtom, false);
      };
  ```
  with
  ```tsx
      const focusId = useSelectedRowId(model);
      const now = useAtomValue(model.nowAtom);
      const selected = focusId === agent.id;
      const select = () => selectAgentRow(model, agent.id);
  ```
  `TerminalRow`: replace
  ```tsx
      const focusId = useAtomValue(model.focusIdAtom);
      const selected = focusId === terminal.id;
      const renaming = useAtomValue(renamingRowAtom) === terminal.id;
      const select = () => {
          globalStore.set(model.focusIdAtom, terminal.id);
          globalStore.set(model.focusReplyAtom, false);
      };
  ```
  with
  ```tsx
      const focusId = useSelectedRowId(model);
      const selected = focusId === terminal.id;
      const renaming = useAtomValue(renamingRowAtom) === terminal.id;
      const select = () => selectAgentRow(model, terminal.id);
  ```

- [ ] **Step 6: `agenttree.tsx` — the two new row components**
  Insert immediately before the comment `// memo: a surface switch re-renders AgentSurface in the same commit that flips it to display:none`:
  ```tsx
  // An ended session under its project: its first prompt and how long ago it last moved. A click reads its transcript in
  // the centre, where Resume lives. It is not a live row, so it carries no state dot; the title is the prompt on one line
  // and the row's tooltip holds all of it.
  function SessionRow({ model, row }: { model: AgentsViewModel; row: EndedSessionRow }) {
      const now = useAtomValue(model.nowAtom);
      const mode = useAtomValue(centerModeAtom);
      const sel = useAtomValue(model.sessionsSelAtom);
      const selected = mode === "session" && sel === row.key;
      const onContextMenu = (e: React.MouseEvent) => {
          const items: ContextMenuItem[] = [];
          if (row.session.resumecommand) {
              items.push({
                  label: "Resume",
                  icon: <Play size={15} />,
                  click: () => runSessionPrimary(model, row.session),
              });
          }
          items.push({
              label: "Copy title",
              icon: <Copy size={15} />,
              click: () => void navigator.clipboard.writeText(row.title),
          });
          ContextMenuModel.getInstance().showContextMenu(items, e);
      };
      return (
          <div
              data-agent-session-row={row.key}
              data-agent-session-project={row.project}
              onClick={() => showSession(model, row.key)}
              onContextMenu={onContextMenu}
              title={row.tooltip}
              className={cn(
                  "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                  selected ? "bg-surface-selected" : "hover:bg-surface-hover"
              )}
          >
              <Slot>
                  <MessageSquare size={12} aria-hidden className="text-ink-faint" />
              </Slot>
              <div className={cn("min-w-0 flex-1 truncate text-[13px]", selected ? "text-primary" : "text-muted")}>
                  {row.title}
              </div>
              <span
                  data-agent-session-age
                  className="whitespace-nowrap text-[11px] tabular-nums text-ink-faint"
              >
                  {sessionAgeLabel(row.lastactivets, now)}
              </span>
          </div>
      );
  }

  // Five more ended sessions under a project, with how many are still hidden
  function MoreSessionsRow({ project, hidden }: { project: string; hidden: number }) {
      return (
          <button
              type="button"
              data-agent-sessions-more={project}
              onClick={() => globalStore.set(sessionPagesAtom, (pages) => showMore(pages, project))}
              className="relative flex w-full cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[5px] text-left text-[11.5px] text-ink-mid transition-colors duration-[140ms] hover:bg-surface-hover hover:text-secondary"
          >
              <Slot>
                  <ChevronDown size={11} aria-hidden />
              </Slot>
              Show more
              <span className="ml-auto tabular-nums text-ink-faint">{hidden}</span>
          </button>
      );
  }

  ```

- [ ] **Step 7: `agenttree.tsx` — `AgentTree` itself**
  Replace
  ```tsx
      const focusId = useAtomValue(model.focusIdAtom);
      const collapsedList = useAtomValue(collapsedProjectsAtom);
      const collapsed = new Set(collapsedList);
      const rows = buildAgentTree(agents, order, lineage, folds, focusId);
      // every project is a folder row; the count comes off the unfolded rows so a collapsed project still counts
      const total = treeAgentCount(rows);
      const visibleRows = foldCollapsedProjects(rows, collapsed);
  ```
  (the first `focusId` line here is the one inside `AgentTree`, the one followed by `collapsedList`) with
  ```tsx
      const focusId = useAtomValue(model.focusIdAtom);
      const collapsedList = useAtomValue(collapsedProjectsAtom);
      const archive = useAtomValue(sessionsArchiveAtom);
      const pages = useAtomValue(sessionPagesAtom);
      const center = useAtomValue(centerModeAtom);
      const collapsed = new Set(collapsedList);
      const rows = buildAgentTree(agents, order, lineage, folds, focusId);
      // every project is a folder: its live agents, then its ended sessions (agentsidebarmodel.ts). A collapsed project
      // hides both; the archive is null until the post-paint scan lands, so the first paint is the agents alone
      const ended = useMemo(() => endedSessionsByProject(archive, agents), [archive, agents]);
      const visibleRows = buildSidebarRows(rows, ended, collapsed, pages);
  ```
  Replace the header
  ```tsx
            <div className="px-[8px] pt-[10px]">
                <button
                    type="button"
                    onClick={() => globalStore.set(model.newAgentOpenAtom, true)}
                    className="flex w-full cursor-pointer items-center gap-[8px] rounded-[8px] border border-edge-mid bg-surface-raised px-[10px] py-[7px] text-[13px] text-secondary hover:bg-surface-hover hover:text-primary"
                >
                    <Plus size={14} aria-hidden />
                    New agent
                </button>
            </div>
            <div className="flex items-center justify-between px-[12px] pb-[4px] pt-[14px]">
                <h3 className="text-[12px] font-medium text-muted">Agents</h3>
                <span className="text-[11px] tabular-nums text-ink-faint">{total}</span>
            </div>
  ```
  with
  ```tsx
            <div className="flex flex-col gap-[4px] px-[8px] pb-[4px] pt-[10px]">
                <button
                    type="button"
                    onClick={() => globalStore.set(model.newAgentOpenAtom, true)}
                    className="flex w-full cursor-pointer items-center gap-[8px] rounded-[8px] border border-edge-mid bg-surface-raised px-[10px] py-[7px] text-[13px] text-secondary hover:bg-surface-hover hover:text-primary"
                >
                    <Plus size={14} aria-hidden />
                    New agent
                </button>
                <button
                    type="button"
                    data-agent-history-open
                    aria-pressed={center === "history"}
                    onClick={() => showHistory(model)}
                    className={cn(
                        "flex w-full cursor-pointer items-center gap-[8px] rounded-[8px] px-[10px] py-[7px] text-[13px] hover:bg-surface-hover hover:text-primary",
                        center === "history" ? "bg-surface-selected text-primary" : "text-secondary"
                    )}
                >
                    <HistoryIcon size={14} aria-hidden />
                    Conversation History
                </button>
            </div>
  ```
  In the `visibleRows.map` callback, directly after the closing of the `if (r.kind === "group") { ... }` block and before
  `// an agent's row keeps the agent's key wherever it moves`, insert
  ```tsx
                        if (r.kind === "session" || r.kind === "more") {
                            // no entrance animation (initial={false}): the rows arrive after the post-paint scan, and the
                            // rows already on screen must not be seen to move for them
                            return (
                                <motion.div
                                    key={r.kind === "session" ? `ended-${r.key}` : `more-${r.project}`}
                                    layout="position"
                                    className="pl-[14px]"
                                    variants={cardVariants}
                                    initial={false}
                                    animate="animate"
                                    exit="exit"
                                >
                                    {r.kind === "session" ? (
                                        <SessionRow model={model} row={r} />
                                    ) : (
                                        <MoreSessionsRow project={r.project} hidden={r.hidden} />
                                    )}
                                </motion.div>
                            );
                        }
  ```
  (`treeAgentCount` and `foldCollapsedProjects` stay exported from `agenttreemodel.ts` and tested there; the tree no longer imports them.)

- [ ] **Step 8: Verify**
  Run `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts` and `npx vitest run frontend/app/view/agents/agenttreemodel.test.ts`
  (unchanged logic, both pass). Requires `task dev` running: `task verify:ui -- agent-tree-rail` (steps 13 and 14 read the header and the fold
  against the new rows; every step must still pass), then open the Agent surface by hand once: with a populated archive each project shows up
  to five session rows, `Show more`, and the `Conversation History` button.

- [ ] **Step 9: Commit**
  ```bash
  git add frontend/app/view/agents/usesessionsscan.ts frontend/app/view/agents/agenttree.tsx frontend/app/view/agents/agentsurface.tsx frontend/app/view/agents/sessionsarchivestore.ts
  git commit -m "feat(agent): ended sessions and Conversation History in the Agent sidebar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 6: Retarget the palette's `session:open` and the strings that name the Sessions surface

**Depends on:** Task 1, Task 3
**Files:**
- Modify: `frontend/app/cockpit/actions/session.ts` (`SESSION_KIND`, `session:open`)
- Test: `frontend/app/cockpit/actions/session.test.ts`
- Modify: `frontend/app/cockpit/command-palette.tsx` (focus-task echo text, archive-load comment)
- Modify: `frontend/app/view/agents/focusswitcher.tsx` (the "Focus on" helper line)

> NOTE: the palette's "Sessions" scope stays (decision in "Architecture notes"): its rows still `launchAgent` through the resume
> command (`command-palette.tsx` `sessionItems`), and `session:resume` still goes through `runSessionPrimary`. Only `session:open`
> wrote the Sessions surface.

> NOTE: `session:open` for a session an orchestrator run launched passes `sessionSelection`'s `run:<id>` selection and member to
> `showSession`, which opens History (the run detail only exists there); a solo session opens the session pane.

- [ ] **Step 1: Write the failing test**
  In `session.test.ts` add to the imports
  ```ts
  import { globalStore } from "@/app/store/jotaiStore";
  import { centerModeAtom } from "@/app/view/agents/agentcenter";
  import type { SurfaceKey } from "@/app/view/agents/agents";
  ```
  and replace the test
  ```ts
      it("open in Sessions always applies", () => {
          expect(action("session:open").applies(thing(mk({ resumecommand: "" })))).toBe(true);
      });
  ```
  with
  ```ts
      it("open session always applies", () => {
          expect(action("session:open").applies(thing(mk({ resumecommand: "" })))).toBe(true);
      });
      it("open session reads a solo session in the Agent surface's centre", () => {
          const model = {
              surfaceAtom: atom<SurfaceKey>("cockpit"),
              sessionsSelAtom: atom("all"),
              sessionsMemberAtom: atom("lead"),
          } as unknown as AgentsViewModel;
          globalStore.set(centerModeAtom, "terminal");
          action("session:open").run(thing(mk({ id: "s9", runtime: "pi" })), { model });
          expect(globalStore.get(model.sessionsSelAtom)).toBe("pi:s9");
          expect(globalStore.get(centerModeAtom)).toBe("session");
          expect(globalStore.get(model.surfaceAtom)).toBe("agent");
          globalStore.set(centerModeAtom, "terminal");
      });
      it("open session sends a run's session to History with its member in view", () => {
          const model = {
              surfaceAtom: atom<SurfaceKey>("cockpit"),
              sessionsSelAtom: atom("all"),
              sessionsMemberAtom: atom("lead"),
          } as unknown as AgentsViewModel;
          action("session:open").run(thing(mk({ runid: "r1", role: "worker", taskid: "t-2" })), { model });
          expect(globalStore.get(model.sessionsSelAtom)).toBe("run:r1");
          expect(globalStore.get(model.sessionsMemberAtom)).toBe("t-2");
          expect(globalStore.get(centerModeAtom)).toBe("history");
          globalStore.set(centerModeAtom, "terminal");
      });
  ```
  Run `npx vitest run frontend/app/cockpit/actions/session.test.ts`. Expected: the two new tests fail (the action still writes `surfaceAtom = "sessions"`).

- [ ] **Step 2: Implement**
  In `session.ts`: remove `import { globalStore } from "@/app/store/jotaiStore";`, add `import { showSession } from "@/app/view/agents/agentcenter";`,
  change the comment `// the session as the Sessions surface builds it, with the roster agent a live one is running in` to
  `// the session as Conversation History builds it, with the roster agent a live one is running in`, and replace the `session:open` action
  ```ts
          {
              id: "session:open",
              label: "Open in Sessions",
              group: "open",
              applies: () => true,
              // the Sessions surface has no router target, so this writes its own selection as its list does
              run: (t, { model }) => {
                  const to = sessionSelection(t.session);
                  globalStore.set(model.sessionsSelAtom, to.sel);
                  if (to.member != null) {
                      globalStore.set(model.sessionsMemberAtom, to.member);
                  }
                  globalStore.set(model.surfaceAtom, "sessions");
              },
          },
  ```
  with
  ```ts
          {
              id: "session:open",
              label: "Open session",
              group: "open",
              applies: () => true,
              // a session reads in the Agent surface's centre; one a run launched reads in History, where the run detail is.
              // Neither has a router target, so this writes the selection as the sidebar's rows and History's list do
              run: (t, { model }) => {
                  const to = sessionSelection(t.session);
                  showSession(model, to.sel, to.member);
              },
          },
  ```
  Run `npx vitest run frontend/app/cockpit/actions/session.test.ts`. Expected: all pass.

- [ ] **Step 3: The two strings**
  In `command-palette.tsx` replace `` : `Narrows Cockpit and Sessions to “${fi.title}”`, `` with `` : `Narrows Cockpit and History to “${fi.title}”`, `` and the comment
  `// Lazy-load the sessions archive on first open (as SessionsSurface does).` with
  `// Lazy-load the sessions archive on first open (the Agent sidebar and History load it on their own).`
  In `focusswitcher.tsx` replace
  `Cockpit and Sessions hide everything outside it. Agent, Diff and Code open on it.` with
  `Cockpit and History hide everything outside it. Agent, Diff and Code open on it.`

- [ ] **Step 4: Commit**
  ```bash
  git add frontend/app/cockpit/actions/session.ts frontend/app/cockpit/actions/session.test.ts frontend/app/cockpit/command-palette.tsx frontend/app/view/agents/focusswitcher.tsx
  git commit -m "feat(agent): open a session in the Agent surface from the palette" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 7: Remove the Sessions surface

**Depends on:** Task 2, Task 3, Task 4, Task 6
**Files:**
- Modify: `frontend/app/view/agents/agents.tsx` (`SurfaceKey`, `SURFACE_ORDER`, comments on the `sessions*Atom`s)
- Modify: `frontend/app/view/agents/navrail.tsx` (`ICON`, `ITEMS`, lucide import)
- Modify: `frontend/app/view/agents/cockpitshell.tsx` (`CockpitShell`)
- Modify: `frontend/app/view/agents/conversationhistory.tsx` (`ConversationHistory`: drop the interim `navSurface` prop)
- Modify: `frontend/app/view/agents/surfacecontext.ts` (`SURFACE_CONTEXT`)
- Modify: `frontend/app/view/agents/cockpitprefsstore.ts` (`coerceStartupSurface`)
- Modify: `frontend/app/view/agents/cockpitrail.tsx` (`CockpitRail`)
- Modify: `frontend/app/store/keybindings/bindings.ts` (`ESC_HOME_SURFACES`)
- Modify: `frontend/app/cockpit/uiapi.ts` (`parseSurfaceAddress`), `frontend/app/cockpit/uiclient.ts` (`handle_uireveal`)
- Test: `frontend/app/view/agents/surfaceorder.test.ts`, `radarnav.test.ts`, `surfacecontext.test.ts`, `cockpitprefsstore.test.ts`,
  `frontend/app/store/keybindings/bindings.test.ts`, `store.test.ts`, `frontend/app/cockpit/uiapi.test.ts`

> NOTE: `focusscope.test.ts` hard-codes no surface: its `"sessions"` strings are the `noun` argument of `focusBannerCopy` (the plural a
> list names), which History still uses. It needs no edit, whatever the spec's list of tests says.

> NOTE: new expected values. `SURFACE_ORDER` = `cockpit, jarvis, agent, code, files, radar, usage` (7). Chords: `Ctrl+1` Cockpit,
> `Ctrl+2` Jarvis, `Ctrl+3` Agent, `Ctrl+4` Code, `Ctrl+5` Diff (`files`), `Ctrl+6` Radar, `Ctrl+7` Usage. `[`/`]` cycle that order; from `files`,
> `]` lands on `radar` (it used to be from `sessions`). Radar sits directly after `files`.

- [ ] **Step 1: Update the tests first (they now describe the 7-surface world)**
  `surfaceorder.test.ts`: replace the first test with
  ```ts
      it("has exactly 7 entries so Ctrl+1..7 covers every one — no surface is unreachable by chord", () => {
          expect(SURFACE_ORDER).toHaveLength(7);
      });

      it("has no Sessions surface: past conversations are a centre mode of Agent", () => {
          expect(SURFACE_ORDER).not.toContain("sessions");
      });

      it("puts Radar on Ctrl+6 and Usage on Ctrl+7", () => {
          expect(SURFACE_ORDER.indexOf("radar") + 1).toBe(6);
          expect(SURFACE_ORDER.indexOf("usage") + 1).toBe(7);
      });
  ```
  `radarnav.test.ts`: replace `for (const key of ["cockpit", "agent", "jarvis", "sessions", "files", "usage"]) {` with
  `for (const key of ["cockpit", "agent", "jarvis", "files", "usage"]) {` and replace the test `places radar between sessions and usage` with
  ```ts
      it("places radar between diff and usage", () => {
          expect(SURFACE_ORDER.indexOf("radar")).toBe(SURFACE_ORDER.indexOf("files") + 1);
          expect(SURFACE_ORDER.indexOf("usage")).toBe(SURFACE_ORDER.indexOf("radar") + 1);
      });
  ```
  `surfacecontext.test.ts`: delete `    "sessions",` from `ALL_SURFACES`, delete `            sessions: { project: "filter", space: "filter" },`
  from the expected object, and in the last test replace `projectControlCopy("sessions", "waveterm")` with `projectControlCopy("cockpit", "waveterm")`.
  `store.test.ts`: delete `    "sessions",` from `SURFACES`.
  `bindings.test.ts`: replace
  ```ts
          globalStore.set(model.surfaceAtom, "sessions");
          next.run(ctx()); // sessions -> radar (radar is in SURFACE_ORDER)
          expect(globalStore.get(model.surfaceAtom)).toBe("radar");
  ```
  with
  ```ts
          globalStore.set(model.surfaceAtom, "files");
          next.run(ctx()); // files (Diff) -> radar (radar follows it in SURFACE_ORDER)
          expect(globalStore.get(model.surfaceAtom)).toBe("radar");
  ```
  and inside `describe("surface switch [ / ]"` add
  ```ts
      it("binds Ctrl+1..7 to SURFACE_ORDER, so Radar is Ctrl+6 and Usage is Ctrl+7", () => {
          const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
          const chords = buildGlobalBindings(model).filter((b) => /^Ctrl:\d$/.test(b.keys) && b.id.startsWith("surface:"));
          expect(chords.map((b) => b.keys)).toEqual(["Ctrl:1", "Ctrl:2", "Ctrl:3", "Ctrl:4", "Ctrl:5", "Ctrl:6", "Ctrl:7"]);
          chords.find((b) => b.keys === "Ctrl:6")!.run(ctx());
          expect(globalStore.get(model.surfaceAtom)).toBe("radar");
          chords.find((b) => b.keys === "Ctrl:7")!.run(ctx());
          expect(globalStore.get(model.surfaceAtom)).toBe("usage");
      });
  ```
  `cockpitprefsstore.test.ts`: add `coerceStartupSurface` to the import list from `./cockpitprefsstore` and append
  ```ts
  describe("coerceStartupSurface", () => {
      it("sends a stored sessions or activity startup surface to the Agent surface", () => {
          expect(coerceStartupSurface("sessions")).toBe("agent");
          expect(coerceStartupSurface("activity")).toBe("agent");
      });
      it("leaves a current surface alone", () => {
          expect(coerceStartupSurface("radar")).toBe("radar");
          expect(coerceStartupSurface("cockpit")).toBe("cockpit");
      });
  });
  ```
  `uiapi.test.ts`: inside `describe("parseSurfaceAddress"` add
  ```ts
      it("takes surface:history, and its old name sessions, to Conversation History in the Agent surface", () => {
          expect(parseSurfaceAddress("surface:history")).toEqual({ surface: "agent", center: "history" });
          expect(parseSurfaceAddress("surface:sessions")).toEqual({ surface: "agent", center: "history" });
      });

      it("lists history among the valid surfaces in its error", () => {
          const r = parseSurfaceAddress("surface:nope");
          expect(r != null && "error" in r && r.error).toMatch(/, history$/);
      });
  ```
  Run each: `npx vitest run frontend/app/view/agents/surfaceorder.test.ts`, `.../radarnav.test.ts`, `.../surfacecontext.test.ts`,
  `.../cockpitprefsstore.test.ts`, `npx vitest run frontend/app/store/keybindings/bindings.test.ts`, `.../store.test.ts`,
  `npx vitest run frontend/app/cockpit/uiapi.test.ts`. Expected: failures where the code still has `sessions` (order length 8, missing
  `center`, `coerceStartupSurface("sessions")` returns `"sessions"`, ...).

- [ ] **Step 2: Remove the surface key and its order slot**
  `agents.tsx`: delete `    | "sessions"` from `SurfaceKey`; replace the comment and array
  ```ts
  // Ordered to match the NavRail (navrail.tsx ITEMS) so Ctrl+1..8 line up with what the user sees. All 8
  // entries are chorded — there is no unchorded remainder.
  export const SURFACE_ORDER: SurfaceKey[] = [
      "cockpit",
      "jarvis",
      "agent",
      "code",
      "files",
      "sessions",
      "radar",
      "usage",
  ];
  ```
  with
  ```ts
  // Ordered to match the NavRail (navrail.tsx ITEMS) so Ctrl+1..7 line up with what the user sees. All 7
  // entries are chorded — there is no unchorded remainder. Conversation History is not a surface: it is a centre
  // mode of "agent" (agentcenter.ts).
  export const SURFACE_ORDER: SurfaceKey[] = ["cockpit", "jarvis", "agent", "code", "files", "radar", "usage"];
  ```
  and rename the four `// Sessions surface:` comments above `sessionsStatusFilterAtom`, `sessionsSelAtom`, `sessionsMemberAtom`,
  `sessionsViewAtom` to start `// Conversation History:` (text otherwise unchanged).
  `navrail.tsx`: delete `    SquareStack,` from the lucide import, delete `    sessions: <SquareStack {...iconProps} />,` from `ICON`, and delete
  `    { key: "sessions", label: "Sessions" },` from `ITEMS`.
  `cockpitshell.tsx`: delete `import { ConversationHistory } from "./conversationhistory";` and replace
  ```tsx
                        ) : surface === "sessions" ? (
                            <ConversationHistory model={model} navSurface="sessions" />
                        ) : surface === "usage" ? (
  ```
  with
  ```tsx
                        ) : surface === "usage" ? (
  ```
  `conversationhistory.tsx`: remove the interim prop. Replace
  ```tsx
  // navSurface is the surface whose keys the list cursor answers on. History lives in the Agent surface; the prop exists only
  // for the Sessions surface the shell still renders this for until it is removed.
  export function ConversationHistory({
      model,
      navSurface = "agent",
  }: {
      model: AgentsViewModel;
      navSurface?: SurfaceKey;
  }) {
  ```
  with `export function ConversationHistory({ model }: { model: AgentsViewModel }) {`, change `import type { AgentsViewModel, SurfaceKey } from "./agents";` to
  `import type { AgentsViewModel } from "./agents";`, change the list-nav controller back to `surface: "agent",` with deps `[navIds, cursorId]`, and
  replace `{navSurface === "agent" ? (` ... `) : null}` around the back button with the bare button (drop the conditional, keep the button as is).
  `surfacecontext.ts`: delete `    sessions: { project: "filter", space: "filter" },`.
  `cockpitprefsstore.ts`: replace
  ```ts
  // A persisted "activity" (the retired surface) coerces to "sessions" — its successor. Callers that seed
  // surfaceAtom from the stored value must route through this so a stale key never renders a blank surface.
  export function coerceStartupSurface(k: SurfaceKey | "activity"): SurfaceKey {
      return (k as string) === "activity" ? "sessions" : (k as SurfaceKey);
  }
  ```
  with
  ```ts
  // A persisted "activity" or "sessions" (retired surfaces: Activity folded into Sessions, Sessions into Agent's Conversation
  // History) coerces to "agent". Callers that seed surfaceAtom from the stored value must route through this so a stale key
  // never renders a blank surface.
  export function coerceStartupSurface(k: SurfaceKey | "activity" | "sessions"): SurfaceKey {
      return (k as string) === "activity" || (k as string) === "sessions" ? "agent" : (k as SurfaceKey);
  }
  ```
  `cockpitrail.tsx`: replace `import { ICON } from "./navrail";` with `import { SquareStack } from "lucide-react";` and `icon: ICON.sessions,` with
  `icon: <SquareStack size={20} strokeWidth={1.8} aria-hidden />,` (the Events rail keeps the icon the Sessions nav item had).
  `bindings.ts`: replace `const ESC_HOME_SURFACES = new Set<SurfaceKey>(["jarvis", "radar", "sessions", "files", "usage", "code"]);` with
  `const ESC_HOME_SURFACES = new Set<SurfaceKey>(["jarvis", "radar", "files", "usage", "code"]);`.

- [ ] **Step 3: `wsh ui` addresses**
  `uiapi.ts`: replace `parseSurfaceAddress` and its comment
  ```ts
  // null = not a surface address; the shared router (openAddress) owns every other kind
  export function parseSurfaceAddress(address: string): { surface: SurfaceKey } | { error: string } | null {
      if (!address.startsWith(SURFACE_PREFIX)) {
          return null;
      }
      const key = address.slice(SURFACE_PREFIX.length) as SurfaceKey;
      if (!SURFACES.includes(key)) {
          return { error: `unknown surface "${key}"; one of ${SURFACES.join(", ")}` };
      }
      return { surface: key };
  }
  ```
  with
  ```ts
  // null = not a surface address; the shared router (openAddress) owns every other kind. Conversation History is a mode of the
  // Agent surface rather than a surface, so its address names the Agent surface and the mode; "sessions" is the old name of
  // the surface it replaced, kept so a worker following an old instruction still lands somewhere sensible.
  export function parseSurfaceAddress(
      address: string
  ): { surface: SurfaceKey; center?: "history" } | { error: string } | null {
      if (!address.startsWith(SURFACE_PREFIX)) {
          return null;
      }
      const key = address.slice(SURFACE_PREFIX.length);
      if (key === "history" || key === "sessions") {
          return { surface: "agent", center: "history" };
      }
      if (!SURFACES.includes(key as SurfaceKey)) {
          return { error: `unknown surface "${key}"; one of ${[...SURFACES, "history"].join(", ")}` };
      }
      return { surface: key as SurfaceKey };
  }
  ```
  `uiclient.ts`: add `import { showHistory } from "@/app/view/agents/agentcenter";` and in `handle_uireveal` replace
  ```ts
              globalStore.set(this.model.surfaceAtom, surfaceTarget.surface);
  ```
  with
  ```ts
              if (surfaceTarget.center === "history") {
                  showHistory(this.model);
              } else {
                  globalStore.set(this.model.surfaceAtom, surfaceTarget.surface);
              }
  ```

- [ ] **Step 4: Run the tests**
  Run, one file per command: `npx vitest run frontend/app/view/agents/surfaceorder.test.ts`, `npx vitest run frontend/app/view/agents/radarnav.test.ts`,
  `npx vitest run frontend/app/view/agents/surfacecontext.test.ts`, `npx vitest run frontend/app/view/agents/cockpitprefsstore.test.ts`,
  `npx vitest run frontend/app/store/keybindings/bindings.test.ts`, `npx vitest run frontend/app/store/keybindings/store.test.ts`,
  `npx vitest run frontend/app/cockpit/uiapi.test.ts`, `npx vitest run frontend/app/cockpit/footerhints.test.ts`. Expected: all pass.
  Then `git grep -n '"sessions"' -- frontend/app ':!*.test.ts' ':!*briefsurface.tsx'` must show only `palette-scope.ts` (the
  palette's scope id), `focusscope.ts` (a noun), `agenttree.tsx` (the "N sessions" fold-chip label) and `cockpitprefsstore.ts` / `uiapi.ts` (the
  coercion and alias): any other hit is a
  leftover `SurfaceKey` use that the type checker would reject.

- [ ] **Step 5: Verify in the app**
  Requires `task dev` running: `task verify:ui -- surface-smoke agent-tree-quick-return`. Look at the rail by hand: seven items (Cockpit,
  Jarvis, Agent, Code, Diff, Radar, Usage) above Setup/Settings, and `Ctrl+6` opens Radar.

- [ ] **Step 6: Commit**
  ```bash
  git add frontend/app/view/agents/agents.tsx frontend/app/view/agents/navrail.tsx frontend/app/view/agents/cockpitshell.tsx frontend/app/view/agents/conversationhistory.tsx frontend/app/view/agents/surfacecontext.ts frontend/app/view/agents/cockpitprefsstore.ts frontend/app/view/agents/cockpitrail.tsx frontend/app/store/keybindings/bindings.ts frontend/app/cockpit/uiapi.ts frontend/app/cockpit/uiclient.ts frontend/app/view/agents/surfaceorder.test.ts frontend/app/view/agents/radarnav.test.ts frontend/app/view/agents/surfacecontext.test.ts frontend/app/view/agents/cockpitprefsstore.test.ts frontend/app/store/keybindings/bindings.test.ts frontend/app/store/keybindings/store.test.ts frontend/app/cockpit/uiapi.test.ts
  git commit -m "refactor(surfaces): remove the Sessions surface (Radar is Ctrl+6, Usage Ctrl+7)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 8: Docs and skill text

**Depends on:** Task 7
**Files:**
- Modify: `docs/keyboard-shortcuts.md`
- Modify: `docs/reference/architecture.md`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `skills/cockpit-ui/SKILL.md`
- Modify: `scripts/cdp/attach.mjs` (`SURFACE_LABEL`)

> NOTE: `skills/cockpit-ui/SKILL.md` lists a `vault` surface that was removed earlier; the corrected list below drops it too.
> `skills/` is embedded into `wavesrv` by `skills/skills.go` and is the source for the vault copies: edit it here, never the vault.

- [ ] **Step 1: `docs/keyboard-shortcuts.md`**
  Five line edits (each old line is unique in the file):
  ```md
  | `Ctrl`+`1`…`8` | Jump to surface by position — in order: Cockpit, Jarvis, Agent, Code, Diff, Sessions, Radar, Usage |
  ```
  becomes
  ```md
  | `Ctrl`+`1`…`7` | Jump to surface by position — in order: Cockpit, Jarvis, Agent, Code, Diff, Radar, Usage |
  ```
  ```md
  Setup and Settings have no `Ctrl`+number slot — the nine positions are bound to `SURFACE_ORDER`
  ```
  becomes
  ```md
  Setup and Settings have no `Ctrl`+number slot — the positions are bound to `SURFACE_ORDER`
  ```
  ```md
  | `g` `s` | Sessions |
  ```
  becomes
  ```md
  | `g` `s` | Conversation History (in the Agent surface) |
  ```
  ```md
  | `Esc` | On a deep surface (Jarvis, Radar, Sessions, Files, Usage, Code), return to the Cockpit. In a composer or text field, leave Type posture first. |
  ```
  becomes
  ```md
  | `Esc` | On a deep surface (Jarvis, Radar, Files, Usage, Code), return to the Cockpit. In a composer or text field, leave Type posture first. |
  ```
  and, in the `### Agent` table,
  ```md
  | `Esc` | Back to Cockpit, or exit fullscreen first |
  ```
  becomes
  ```md
  | `Esc` | Back to Cockpit, or exit fullscreen first; from Conversation History or a session transcript, back to the terminal |
  ```
  Then add this section after the `### Agent` table, before `### Agent: canvas mode`:
  ```md
  ### Agent: Conversation History

  Opened with `g` `s` or the sidebar's Conversation History button. The agent keys (`j` / `k`, the arrows, `d`, `f`, `r`, `c`) stand down while it
  is open: `j` / `k` (or `↓` / `↑`) move the list cursor, `Enter` jumps to a live session or resumes an ended one, and `Esc` returns to the terminal.
  `Ctrl`+`Tab` still cycles agents and brings the terminal back. An ended session opened from the sidebar reads the same way: `Esc` leaves it.
  ```

- [ ] **Step 2: `docs/reference/architecture.md`**
  In the Scanners bullet, the tail
  ```md
  that feed the Usage / Sessions / Files surfaces.
  ```
  becomes
  ```md
  that feed the Usage and Files surfaces and the Agent surface's sidebar and Conversation History.
  ```
  In the "The cockpit is one window with N surfaces" paragraph, the sentence
  ```md
  is cockpit, jarvis, agent, code, files, sessions, radar, usage — ordered to match the NavRail so `Ctrl+1..8` line up with what the user sees; `setup` and `settings` are `SurfaceKey`s deliberately outside that order. Two consequences:
  ```
  becomes
  ```md
  is cockpit, jarvis, agent, code, files, radar, usage — ordered to match the NavRail so `Ctrl+1..7` line up with what the user sees; `setup` and `settings` are `SurfaceKey`s deliberately outside that order. Past conversations are not a surface: the Agent surface's centre column has three modes in `centerModeAtom` (`view/agents/agentcenter.ts`) — the live terminal, one ended session's transcript, and Conversation History (the old Sessions master-detail) — and its sidebar lists each project's live agents then its ended sessions (`agentsidebarmodel.ts`, scanned after first paint, never at boot). Two consequences:
  ```

- [ ] **Step 3: `AGENTS.md`**
  Replace the sentence ending the Frontend bullet
  ```
    their labels: `files` renders as "Diff"; the order is
    `SURFACE_ORDER` in `frontend/app/view/agents/agents.tsx`.
  ```
  with
  ```
    their labels: `files` renders as "Diff"; the order is
    `SURFACE_ORDER` in `frontend/app/view/agents/agents.tsx`. Past conversations are not a surface: Conversation History and an
    ended session's transcript are centre modes of Agent (`centerModeAtom`, `view/agents/agentcenter.ts`; open them with
    `showHistory` / `showSession`, and `showTerminal` whenever a route chooses an agent).
  ```

- [ ] **Step 4: `README.md`**
  Delete the row `| **Sessions** | Browse recorded agent sessions.                               |` from "The rest of the workspace" table.
  In "Supervise agents", after the paragraph `The terminal is interactive—not just a transcript viewer. ...` add
  `Past conversations live in the same place: each project in the **Agent** sidebar lists its recent sessions under its live agents, an ended session opens as a readable transcript with **Resume**, and **Conversation History** shows them all.`

- [ ] **Step 5: `skills/cockpit-ui/SKILL.md`**
  Replace
  ```
    `surface:<cockpit|jarvis|agent|radar|sessions|files|vault|usage|code|settings>`.
  ```
  with
  ```
    `surface:<cockpit|jarvis|agent|code|files|radar|usage|setup|settings|history>` (`history` is Conversation History, a mode of the Agent surface).
  ```

- [ ] **Step 6: `scripts/cdp/attach.mjs`**
  Delete `    sessions: "Sessions",` from `SURFACE_LABEL` (the comment above it mirrors `navrail.tsx` ITEMS, which no longer has it). `scenarios.mjs` only reads
  `SURFACE_LABEL` by keys that remain (`code`, `agent`, ...), and `SMOKE_SURFACES` never listed `sessions`.

- [ ] **Step 7: Commit**
  ```bash
  git add docs/keyboard-shortcuts.md docs/reference/architecture.md AGENTS.md README.md skills/cockpit-ui/SKILL.md scripts/cdp/attach.mjs
  git commit -m "docs: Sessions merged into the Agent surface" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 9: CDP scenario `agent-history`

**Depends on:** Task 5, Task 7
**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (new `agentHistory`, helpers, a `settleTree` step in `agentTreeQuickReturn`, `SCENARIOS`)

> NOTE: how neighbouring scenarios arrange: `agent-tree-rail` writes `public/cockpit-fixtures/active.json` (a JSON array of `AgentVM`; read once at boot by
> `loadDevMockRoster`, so a reload follows), drives the nav by clicking its buttons (`h.goto`), and tears down by deleting the fixture and reloading.
> The Setup scenarios (`scripts/cdp/setup-fixtures.mjs`) answer RPCs in-page by importing the app's own `wshclientapi.ts` module (found through
> `performance.getEntriesByType("resource")`) and calling `RpcApi.setMockRpcClient`. This scenario does both: one live fixture agent in project
> `waveterm` gives the tree a project, and `getsessionsactivity` is answered in-page, so the rows asserted are the rows seeded and not whatever is in
> the developer's transcript folders. Nothing is resumed (that would start a real agent): the scenario asserts the Resume button is present.

> NOTE: the new sidebar rows arrive after a post-paint scan, so `agent-tree-quick-return` (which samples row transforms for 600ms after a quick return)
> could read the rows sliding aside for them as a slide. Its first step now waits until the tree has stopped growing.

- [ ] **Step 1: Make `agent-tree-quick-return` wait for the tree to settle**
  After `const QUICK_RETURN_SAMPLE_MS = 600;` add
  ```js
  // the sidebar's session rows arrive after a scan that starts when the surface is entered: wait until the tree has stopped growing
  // before sampling it, or rows sliding aside for them read as a slide on return
  const settleTree = (h) =>
      h.ev(`(async () => {
          const count = () => document.querySelectorAll("[data-agent-tree] .overflow-y-auto > div").length;
          let last = count();
          const t0 = performance.now();
          let since = t0;
          while (performance.now() - since < 900 && performance.now() - t0 < 8000) {
              await new Promise((r) => setTimeout(r, 100));
              const n = count();
              if (n !== last) {
                  last = n;
                  since = performance.now();
              }
          }
          return last;
      })()`);
  ```
  and in `agentTreeQuickReturn.assert`, before
  ```js
        const rows = await h.ev(`document.querySelectorAll("[data-agent-tree] .overflow-y-auto > div").length`);
  ```
  add `await settleTree(h);`.

- [ ] **Step 2: Add the scenario**
  Insert after the `agentTreeQuickReturn` object (before the `// A lead's Spec review ask opens as the review dialog` comment):
  ```js
  // The Agent surface after the Sessions merge (docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md): the sidebar's ended sessions
  // under each project, Show more, the session pane with Resume, Conversation History, Esc back to the terminal, `g s`, and a rail with no
  // Sessions item (Radar on Ctrl+6). One live fixture agent gives the tree a project to hang sessions under; GetSessionsActivity is answered
  // in-page (see installAhMock). Resume is asserted present, never clicked: it would start a real agent.
  const AH_LIVE_ID = "fx-ah-live";
  const AH_PROJECT = "waveterm";
  const AH_GHOST = "ah-ghost";
  const AH_ANSWER = "history seed answer";
  const AH_MOCK_KEY = "__arcAgentHistoryMock";
  const AH_SCAN_GAP_MS = 5400; // the sidebar rescans on re-entry at most every 5s (agentsidebarmodel.ts scanDue)

  const ahNap = (ms) => new Promise((r) => setTimeout(r, ms));

  // polls a page expression to truthy; resolves to its last value
  const ahWait = (h, expr, ms = 6000) =>
      h.ev(`(async () => {
          const t0 = performance.now();
          for (;;) {
              const v = !!(${expr});
              if (v || performance.now() - t0 > ${ms}) return v;
              await new Promise((r) => setTimeout(r, 150));
          }
      })()`);

  // a keydown where the user's focus is, so the dispatcher's window-capture listener sees it as a keypress
  const ahKey = (h, key, code, mods = {}) =>
      h.ev(
          `(document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify({ key, code, ...mods, bubbles: true, cancelable: true })}))`
      );

  const ahTurn = (type, content) => JSON.stringify({ type, message: { role: type, content } }) + "\n";

  // ended solo sessions ah-1 (newest) .. ah-7 under AH_PROJECT, one more page than the sidebar shows at first; ah-live is the live
  // fixture agent's own transcript (matched by normalized path, so it must not list as ended); ah-run was launched by a run (excluded
  // from the sidebar); ah-g1 belongs to a project with no live agent
  function ahSessions(cwd, livePath, now) {
      const base = {
          runtime: "claude",
          projectpath: "C:/ah/waveterm",
          projectname: AH_PROJECT,
          branch: "main",
          model: "opus",
          tokenstotal: 1200,
          status: "done",
          startedts: now - 3_600_000,
          durationms: 60_000,
          events: [],
      };
      const solo = (n) => ({
          ...base,
          id: `ah-${n}`,
          task: `history seed ${n}`,
          lastactivets: now - n * 600_000,
          resumecommand: `claude --resume ah-${n}`,
          transcriptpath: join(cwd, `ah-${n}.jsonl`),
      });
      return [
          ...[1, 2, 3, 4, 5, 6, 7].map(solo),
          {
              ...base,
              id: "ah-live",
              task: "ah live prompt",
              lastactivets: now - 30_000,
              resumecommand: "claude --resume ah-live",
              // the same file the fixture agent reports, spelled differently: forward slashes, lower case
              transcriptpath: livePath.replace(/\\/g, "/").toLowerCase(),
          },
          {
              ...base,
              id: "ah-run",
              task: "ah run worker",
              lastactivets: now - 45_000,
              resumecommand: "claude --resume ah-run",
              transcriptpath: join(cwd, "ah-run.jsonl"),
              runid: "ah-run-1",
              channelid: "ah-ch",
              taskid: "t-1",
              role: "worker",
          },
          {
              ...base,
              id: "ah-g1",
              projectname: AH_GHOST,
              projectpath: "C:/ah/ghost",
              task: "ghost prompt",
              lastactivets: now - 120_000,
              resumecommand: "claude --resume ah-g1",
              transcriptpath: join(cwd, "ah-g1.jsonl"),
          },
      ];
  }

  // the dev server's URL for the app's own wshclientapi module (setup-fixtures.mjs finds it the same way)
  const AH_DISCOVER = `(() => {
      const hits = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\\/wshclientapi\\.ts(\\?|$)/.test(n));
      return hits.length ? hits[hits.length - 1] : null;
  })()`;

  // answers getsessionsactivity with the seeded sessions (counting calls) and delegates every other command to what was there
  async function installAhMock(h, sessions) {
      const url = await h.ev(AH_DISCOVER);
      if (!url) return "no-module-url";
      return h.ev(`(async () => {
          const mod = await import(${JSON.stringify(url)});
          const api = mod.RpcApi;
          if (!api || typeof api.setMockRpcClient !== "function") return "no-api";
          if (window.${AH_MOCK_KEY}) return "already-installed";
          const prev = api.mockClient ?? null;
          const state = { calls: 0 };
          const sessions = ${JSON.stringify(sessions)};
          const mock = {
              mockWshRpcCall(client, command, data, opts) {
                  if (command === "getsessionsactivity") {
                      state.calls++;
                      return Promise.resolve({ sessions });
                  }
                  return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
              },
              mockWshRpcStream(client, command, data, opts) {
                  return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
              },
          };
          window.${AH_MOCK_KEY} = { api, prev, mock, state };
          api.setMockRpcClient(mock);
          const probe = await api.GetSessionsActivityCommand(window.TabRpcClient, { windowdays: 30, limit: 100 });
          state.calls = 0;
          return (probe.sessions ?? []).some((s) => s.id === "ah-1") ? "ok" : "not-intercepted";
      })()`);
  }

  const removeAhMock = (h) =>
      h.ev(`(() => {
          const f = window.${AH_MOCK_KEY};
          if (!f) return "absent";
          f.api.setMockRpcClient(f.prev);
          delete window.${AH_MOCK_KEY};
          return "restored";
      })()`);

  // the ended-session rows of one project, and whether it offers Show more
  const ahRows = (h, project) =>
      h.ev(`(() => ({
          keys: [...document.querySelectorAll('[data-agent-session-row][data-agent-session-project=${JSON.stringify(project)}]')]
              .map((r) => r.getAttribute("data-agent-session-row")),
          more: document.querySelector('[data-agent-sessions-more=${JSON.stringify(project)}]') != null,
      }))()`);

  const ahMockCalls = (h) => h.ev(`window.${AH_MOCK_KEY}?.state.calls ?? -1`);

  const agentHistory = {
      name: "agent-history",
      surface: "agent",
      async arrange(h) {
          const cwd = mkdtempSync(join(tmpdir(), "verify-agent-history-"));
          const ctx = {
              cwd,
              prevCollapsed: await h.ev(`localStorage.getItem(${JSON.stringify(TREE_COLLAPSED_KEY)})`),
          };
          // a throw past this point still returns ctx, so teardown removes whatever was already made
          try {
              const livePath = join(cwd, "live.jsonl");
              writeFileSync(livePath, ahTurn("user", "live prompt"));
              // ah-1's transcript is what the session pane reads
              writeFileSync(
                  join(cwd, "ah-1.jsonl"),
                  ahTurn("user", "history seed 1") + ahTurn("assistant", [{ type: "text", text: AH_ANSWER }])
              );
              const sessions = ahSessions(cwd, livePath, Date.now());
              mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
              writeFileSync(
                  TREE_RAIL_FIXTURE,
                  JSON.stringify(
                      [
                          {
                              id: AH_LIVE_ID,
                              name: "ah live",
                              project: AH_PROJECT,
                              task: "verify agent history",
                              state: "working",
                              agent: "claude",
                              model: "opus",
                              activeMs: 60_000,
                              blockId: "fx-blk-ah-live",
                              transcriptPath: livePath,
                          },
                      ],
                      null,
                      2
                  )
              );
              ctx.wroteFixture = true;
              await h.ev(`localStorage.removeItem(${JSON.stringify(TREE_COLLAPSED_KEY)})`);
              // the fixture roster is read once at boot
              await h.ev("location.reload()");
              await h.ev(`(async () => {
                  for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
                      await new Promise((r) => setTimeout(r, 500));
                  }
              })()`);
              ctx.mock = await installAhMock(h, sessions);
          } catch (e) {
              ctx.arrangeError = String(e?.message ?? e);
          }
          return ctx;
      },
      async assert(h, ctx) {
          const steps = [];
          const rec = (step, ok, detail) => steps.push({ step, ok, detail });
          rec(
              "0. the fixture agent, the transcripts and the sessions mock are in place",
              ctx.arrangeError == null && ctx.mock === "ok",
              ctx.arrangeError ?? `mock=${ctx.mock}`
          );

          // the runner has entered Agent, which starts the scan; if the rows are not there, enter again once the scan gap has passed
          let loaded = await ahWait(h, `document.querySelectorAll('[data-agent-session-row]').length > 0`, 8000);
          if (!loaded) {
              await h.goto("cockpit");
              await ahNap(AH_SCAN_GAP_MS);
              await h.goto("agent");
              loaded = await ahWait(h, `document.querySelectorAll('[data-agent-session-row]').length > 0`, 8000);
          }
          rec("1. the first scan filled the sidebar's session rows", loaded === true, `loaded=${loaded}`);

          const head = await h.ev(`(() => {
              const tree = document.querySelector("[data-agent-tree]");
              return tree ? [...tree.querySelectorAll("button")].slice(0, 2).map((b) => b.textContent.trim()) : null;
          })()`);
          rec(
              "2. the tree opens with New agent, then Conversation History",
              JSON.stringify(head) === JSON.stringify(["New agent", "Conversation History"]),
              JSON.stringify(head)
          );

          const first = await ahRows(h, AH_PROJECT);
          rec(
              "3. the live project lists five ended sessions newest first, not the live agent's own session nor a run's, and offers Show more",
              JSON.stringify(first.keys) === JSON.stringify(["ah-1", "ah-2", "ah-3", "ah-4", "ah-5"].map((id) => `claude:${id}`)) &&
                  first.more === true,
              JSON.stringify(first)
          );

          const ghost = await h.ev(`(() => ({
              rows: document.querySelectorAll('[data-agent-session-project="${AH_GHOST}"]').length,
              folder: [...document.querySelectorAll("[data-agent-tree] button[aria-expanded]")]
                  .some((b) => (b.textContent || "").includes(${JSON.stringify(AH_GHOST)})),
          }))()`);
          rec(
              "4. a project with ended sessions and no live agent is a folder of its own",
              ghost.rows === 1 && ghost.folder === true,
              JSON.stringify(ghost)
          );

          const age = await h.ev(
              `document.querySelector('[data-agent-session-row="claude:ah-1"] [data-agent-session-age]')?.textContent?.trim() ?? null`
          );
          rec("5. a row carries its relative time (ah-1 moved 10 minutes ago)", /^\d+m$/.test(age ?? ""), `age=${age}`);

          await h.ev(`document.querySelector('[data-agent-sessions-more=${JSON.stringify(AH_PROJECT)}]')?.click()`);
          await ahNap(600);
          const all = await ahRows(h, AH_PROJECT);
          rec(
              "6. Show more lists the other two and the button goes",
              all.keys.length === 7 && all.more === false,
              JSON.stringify(all)
          );

          await h.ev(`document.querySelector('[data-agent-session-row="claude:ah-1"]')?.click()`);
          const sessionShown = await ahWait(h, `document.querySelector('[data-agent-session]')`);
          const answered = await ahWait(h, `document.querySelector('[data-agent-session]')?.textContent?.includes(${JSON.stringify(AH_ANSWER)})`);
          const pane = await h.ev(`(() => {
              const t = document.querySelector("[data-agent-terminal]");
              return {
                  resume: [...(document.querySelector("[data-agent-session]")?.querySelectorAll("button") ?? [])].some((b) => /^Resume/.test((b.textContent || "").trim())),
                  terminalMounted: t != null,
                  terminalVisible: t?.checkVisibility() ?? null,
                  rail: document.querySelector('aside[aria-label="Agent details"]') != null,
                  selected: document.querySelector('[data-agent-session-row="claude:ah-1"]')?.className.includes("bg-surface-selected") ?? false,
              };
          })()`);
          rec(
              "7. clicking an ended session reads its transcript with Resume, over a terminal that stays mounted but hidden, with no rail",
              sessionShown && answered === true && pane.resume && pane.terminalMounted && pane.terminalVisible === false && !pane.rail && pane.selected,
              JSON.stringify({ sessionShown: !!sessionShown, answered, ...pane })
          );
          await h.shot("cdp-shots/agent-history-session.png");

          await ahKey(h, "Escape", "Escape");
          await ahNap(500);
          const back = await h.ev(`(() => {
              const t = document.querySelector("[data-agent-terminal]");
              return { session: document.querySelector("[data-agent-session]") != null, terminalVisible: t?.checkVisibility() ?? null };
          })()`);
          rec(
              "8. Esc returns from the session to the terminal",
              back.session === false && back.terminalVisible === true,
              JSON.stringify(back)
          );

          await h.ev(`document.querySelector("[data-agent-history-open]")?.click()`);
          await ahNap(800);
          const hist = await h.ev(`(() => {
              const root = document.querySelector("[data-agent-history]");
              return {
                  open: root != null,
                  title: root?.querySelector("h1")?.textContent ?? null,
                  feed: root?.textContent?.includes("All activity") ?? false,
                  oldest: root?.textContent?.includes("history seed 7") ?? false,
                  rail: document.querySelector('aside[aria-label="Agent details"]') != null,
                  terminalVisible: document.querySelector("[data-agent-terminal]")?.checkVisibility() ?? null,
              };
          })()`);
          rec(
              "9. Conversation History lists every session (beyond the sidebar's rows), hides the rail, and keeps the terminal mounted",
              hist.open && hist.title === "Conversation History" && hist.feed && hist.oldest && !hist.rail && hist.terminalVisible === false,
              JSON.stringify(hist)
          );
          await h.shot("cdp-shots/agent-history-history.png");

          await ahKey(h, "Escape", "Escape");
          await ahNap(500);
          const closed = await h.ev(`document.querySelector("[data-agent-history]") == null`);
          rec("10. Esc closes History", closed === true, `closed=${closed}`);

          // Ctrl+g is the leader alias that works wherever focus is, even if the terminal took it back
          await ahKey(h, "g", "KeyG", { ctrlKey: true });
          await ahNap(150);
          await ahKey(h, "s", "KeyS");
          const viaLeader = await ahWait(h, `document.querySelector("[data-agent-history]")`, 3000);
          rec("11. g s opens Conversation History in the Agent surface", !!viaLeader, `history=${!!viaLeader}`);
          await ahKey(h, "Escape", "Escape");
          await ahNap(400);

          const nav = await h.ev(`[...document.querySelectorAll("nav button")].map((b) => b.getAttribute("aria-label"))`);
          await ahKey(h, "6", "Digit6", { ctrlKey: true });
          await ahNap(800);
          const afterChord = await h.activeSurfaceLabel();
          rec(
              "12. the rail has seven surfaces and no Sessions, and Ctrl+6 opens Radar",
              !nav.includes("Sessions") &&
                  JSON.stringify(nav.slice(0, 7)) === JSON.stringify(["Cockpit", "Jarvis", "Agent", "Code", "Diff", "Radar", "Usage"]) &&
                  afterChord === "Radar",
              JSON.stringify({ nav, afterChord })
          );

          // coming back after the scan gap rescans (the mock counts the calls)
          const before = await ahMockCalls(h);
          await h.goto("cockpit");
          await ahNap(AH_SCAN_GAP_MS);
          await h.goto("agent");
          await ahNap(1500);
          const after = await ahMockCalls(h);
          rec(
              "13. entering the Agent surface again rescans, and nothing polls in between",
              before >= 0 && after > before,
              `calls ${before} -> ${after}`
          );
          return steps;
      },
      async teardown(h, ctx) {
          const step = async (what, fn) => {
              try {
                  await fn();
              } catch (e) {
                  console.error(`agent-history teardown: ${what} failed: ${e?.message ?? e}`);
              }
          };
          await step("remove the sessions mock", () => removeAhMock(h));
          if (ctx.wroteFixture) await step("remove the fixture roster", () => rmSync(TREE_RAIL_FIXTURE, { force: true }));
          await step("restore the tree fold preference", () => h.ev(restoreStorageKey(TREE_COLLAPSED_KEY, ctx.prevCollapsed)));
          await step("reload onto the live roster", async () => {
              await h.ev("location.reload()");
              await new Promise((r) => setTimeout(r, 2500));
          });
          await step("remove the temp dir", () => rmSync(ctx.cwd, { recursive: true, force: true }));
          await step("leave on the Cockpit", () => h.goto("cockpit"));
      },
  };

  ```

- [ ] **Step 3: Register it**
  In `SCENARIOS`, after `agentTreeQuickReturn,` add `agentHistory,`.

- [ ] **Step 4: Run it**
  Requires `task dev` running: `task verify:ui -- agent-history agent-tree-quick-return agent-tree-rail`. Expected: all steps PASS (or SKIP with a
  named reason); contact sheet at `cdp-shots/index.html` includes `agent-history-session.png` and `agent-history-history.png`: look at both once
  (the sidebar and centre should read as one surface; the session pane and History must not overlap the tree). Then the rest of the Agent-surface
  scenarios the spec lists must still pass: `task verify:ui -- tui-fullscreen tui-leader canvas-swap canvas-tabs agent-terminal-on-arrival doc-review doc-review-canvas`.

- [ ] **Step 5: Commit**
  ```bash
  git add scripts/cdp/scenarios.mjs
  git commit -m "test(cdp): agent-history scenario for the merged Agent surface" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 10: Plan the new section order

**Depends on:** Task 9
**Files:**
- Modify: `frontend/app/element/railsections.ts` (`RailSectionHeader`, `sectionExpandable`)
- Modify: `frontend/app/element/railsections.test.ts`
- Modify: `frontend/app/view/agents/agentrailsections.ts` (`AgentRailSectionId`, `AgentRailInput`, `planAgentRail`, new `planTerminalRail`)
- Modify: `frontend/app/view/agents/agentrailsections.test.ts`
- Modify: `frontend/app/view/agents/railicons.tsx` (`RAIL_ICON`)
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx` (`AgentDetailsRail`: the `planAgentRail` call, `LABEL`, `ICON`, `CONTENT`)

- [ ] **Step 1: Failing test for `emptyOpenable`**
  In `frontend/app/element/railsections.test.ts`, inside `describe("rail section open state", ...)`, after the
  `"an empty counted section never opens and is not expandable"` case, add:
  ```ts
      it("an empty counted section whose empty state has something to do stays expandable", () => {
          const h = { count: 0, emptyOpenable: true };
          expect(sectionExpandable(h)).toBe(true);
          expect(sectionOpen({}, "uploads", h)).toBe(true);
          expect(sectionOpen({}, "uploads", { ...h, defaultOpen: false })).toBe(false);
          expect(sectionOpen({ uploads: true }, "uploads", { ...h, defaultOpen: false })).toBe(true);
          expect(toggleSection({}, "uploads", { ...h, defaultOpen: false })).toEqual({ uploads: true });
      });
      it("emptyOpenable changes nothing for a section that has something in it", () => {
          expect(sectionExpandable({ count: 2, emptyOpenable: true })).toBe(true);
          expect(sectionExpandable({ count: 0, emptyOpenable: false })).toBe(false);
      });
  ```
- [ ] **Step 2: Run it, expect FAIL**
  `npx vitest run frontend/app/element/railsections.test.ts`
  Expected: the first new case fails (`expected false to be true` on `sectionExpandable(h)`); the other cases pass.
- [ ] **Step 3: Implement `emptyOpenable`**
  In `frontend/app/element/railsections.ts` replace the `RailSectionHeader` interface and `sectionExpandable`:
  ```ts
  export interface RailSectionHeader {
      count?: number; // shown beside the label; 0 makes the row inert unless emptyOpenable
      defaultOpen?: boolean; // open state before the user has toggled it; default true
      // a section whose empty state carries something to do (an Attach button, a "show more" toggle) stays openable at
      // count 0 instead of going inert
      emptyOpenable?: boolean;
  }
  ```
  ```ts
  export function sectionExpandable(h: RailSectionHeader): boolean {
      return h.count !== 0 || h.emptyOpenable === true;
  }
  ```
  Leave `sectionOpen` and `toggleSection` as they are (they already ask `sectionExpandable`).
- [ ] **Step 4: Run it, expect PASS**
  `npx vitest run frontend/app/element/railsections.test.ts` -> all cases pass.
- [ ] **Step 5: Replace the planner's test with the full new cases (failing)**
  Overwrite `frontend/app/view/agents/agentrailsections.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { sectionExpandable, sectionOpen } from "@/app/element/railsections";
  import { bgTaskStatusLabel, planAgentRail, planTerminalRail, type AgentRailInput } from "./agentrailsections";

  const base: AgentRailInput = {
      inSubagent: false,
      needsYou: 0,
      subagents: 0,
      files: 3,
      artifacts: 0,
      uploads: 0,
      bgTasks: 1,
      terminals: 0,
      terminalsOther: 0,
      tools: 4,
      hasRun: false,
  };
  const ids = (i: AgentRailInput) => planAgentRail(i).map((s) => s.id);
  const header = (i: AgentRailInput, id: string) => planAgentRail(i).find((s) => s.id === id)?.header;

  describe("planAgentRail", () => {
      it("lists attention first, then what the agent holds, then the facts last, keeping empty counted sections", () => {
          expect(ids(base)).toEqual([
              "subagents",
              "files",
              "artifacts",
              "uploads",
              "bgtasks",
              "terminals",
              "tools",
              "details",
              "usage",
          ]);
          expect(header(base, "subagents")).toEqual({ count: 0 });
      });
      it("needs-you leads, uncounted, only when something waits", () => {
          expect(ids({ ...base, needsYou: 2 })[0]).toBe("needs");
          expect(planAgentRail({ ...base, needsYou: 2 })[0].header).toBeUndefined();
      });
      it("the run section sits after the counted ones and the tools", () => {
          expect(ids({ ...base, hasRun: true })).toEqual([
              "subagents",
              "files",
              "artifacts",
              "uploads",
              "bgtasks",
              "terminals",
              "tools",
              "run",
              "details",
              "usage",
          ]);
      });
      it("details and token usage start closed", () => {
          expect(header(base, "details")).toEqual({ defaultOpen: false });
          expect(header(base, "usage")).toEqual({ defaultOpen: false });
      });
      it("files with no count (loading, not a repo) has a header but no number", () => {
          expect(header({ ...base, files: null }, "files")).toEqual({});
      });
      it("a subagent interior shows its head, tools, details and usage only", () => {
          expect(
              ids({ ...base, inSubagent: true, needsYou: 1, hasRun: true, artifacts: 2, uploads: 1, terminals: 3 })
          ).toEqual(["subagent", "tools", "details", "usage"]);
      });
      it("artifacts counts the agent's boards, and goes inert at zero", () => {
          expect(header({ ...base, artifacts: 2 }, "artifacts")).toEqual({ count: 2 });
          expect(sectionExpandable(header(base, "artifacts")!)).toBe(false);
      });
      it("uploads stays openable when empty (Attach lives in its body) and starts closed until it has records", () => {
          expect(header(base, "uploads")).toEqual({ count: 0, emptyOpenable: true, defaultOpen: false });
          expect(header({ ...base, uploads: 3 }, "uploads")).toEqual({ count: 3, emptyOpenable: true, defaultOpen: true });
          expect(sectionExpandable(header(base, "uploads")!)).toBe(true);
          expect(sectionOpen({}, "uploads", header(base, "uploads")!)).toBe(false);
          expect(sectionOpen({}, "uploads", header({ ...base, uploads: 3 }, "uploads")!)).toBe(true);
      });
      it("terminals counts what the rail lists", () => {
          expect(header({ ...base, terminals: 2 }, "terminals")).toEqual({ count: 2 });
          expect(header({ ...base, terminals: 1, terminalsOther: 4 }, "terminals")).toEqual({ count: 1 });
      });
      it("terminals with none in this project stays openable only when other projects have some to show", () => {
          expect(header(base, "terminals")).toEqual({ count: 0 });
          expect(sectionExpandable(header(base, "terminals")!)).toBe(false);
          expect(header({ ...base, terminalsOther: 2 }, "terminals")).toEqual({ count: 0, emptyOpenable: true });
          expect(sectionExpandable(header({ ...base, terminalsOther: 2 }, "terminals")!)).toBe(true);
      });
  });

  describe("planTerminalRail", () => {
      it("a focused terminal's rail is the Terminals section alone", () => {
          expect(planTerminalRail({ terminals: 2, terminalsOther: 0 })).toEqual([
              { id: "terminals", header: { count: 2 } },
          ]);
      });
      it("it follows the same openable rule as an agent's Terminals section", () => {
          expect(planTerminalRail({ terminals: 0, terminalsOther: 3 })).toEqual([
              { id: "terminals", header: { count: 0, emptyOpenable: true } },
          ]);
      });
  });

  describe("bgTaskStatusLabel", () => {
      it("a running task of a session that is no longer live is unknown", () => {
          expect(bgTaskStatusLabel("running", true)).toBe("running");
          expect(bgTaskStatusLabel("running", false)).toBe("unknown");
          expect(bgTaskStatusLabel("completed", false)).toBe("completed");
      });
  });
  ```
- [ ] **Step 6: Run it, expect FAIL**
  `npx vitest run frontend/app/view/agents/agentrailsections.test.ts`
  Expected: the order cases fail (no `artifacts`/`uploads`/`terminals` ids) and `planTerminalRail` is not a function.
- [ ] **Step 7: Implement the planner**
  Replace the body of `frontend/app/view/agents/agentrailsections.ts` above `BgTaskLabel` (keep `BgTaskLabel` and
  `bgTaskStatusLabel` as they are, and the two imports):
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The Agent details rail's sections: which show, in what order, with which counts. Attention first (needs you,
  // subagents, changed files), then what the agent holds (artifacts, uploads, background tasks, terminals), then what
  // it did (tools), its run, and the facts last, closed by default. Counted sections stay listed at 0 so the rail
  // keeps one shape from agent to agent. Rendered by agentdetailsrail.tsx; a focused terminal's rail is
  // planTerminalRail, rendered by terminalsrail.tsx.

  import type { RailSectionHeader } from "@/app/element/railsections";
  import type { BackgroundTaskStatus } from "./transcriptprojection";

  export type AgentRailSectionId =
      | "subagent"
      | "needs"
      | "subagents"
      | "files"
      | "artifacts"
      | "uploads"
      | "bgtasks"
      | "terminals"
      | "tools"
      | "run"
      | "details"
      | "usage";

  export interface AgentRailInput {
      inSubagent: boolean; // a subagent's interior is open in place of the parent
      needsYou: number; // the lead's asks owned by the user
      subagents: number;
      files: number | null; // null: not known (loading, or not a git repo)
      artifacts: number; // the agent's canvas boards
      uploads: number; // files attached to the agent (paste, drop, Attach)
      bgTasks: number;
      terminals: number; // plain terminals the rail lists: the agent's project's, or all of them on request
      terminalsOther: number; // plain terminals that belong to another project
      tools: number;
      hasRun: boolean; // the agent leads or works a run
  }

  export interface AgentRailSectionPlan {
      id: AgentRailSectionId;
      header?: RailSectionHeader; // absent: the section draws its own heading and does not collapse
  }

  // Uploads is the one counted section whose empty state carries an action (Attach), so it stays openable at 0;
  // it starts closed until it has something in it
  function uploadsHeader(uploads: number): RailSectionHeader {
      return { count: uploads, emptyOpenable: true, defaultOpen: uploads > 0 };
  }

  // Terminals goes inert at 0 like any counted section, unless other projects have terminals: its empty state then
  // offers to show them
  function terminalsHeader(terminals: number, other: number): RailSectionHeader {
      return terminals === 0 && other > 0 ? { count: terminals, emptyOpenable: true } : { count: terminals };
  }

  export function planAgentRail(i: AgentRailInput): AgentRailSectionPlan[] {
      const out: AgentRailSectionPlan[] = [];
      if (i.inSubagent) {
          out.push({ id: "subagent" });
      } else {
          if (i.needsYou > 0) {
              out.push({ id: "needs" });
          }
          out.push({ id: "subagents", header: { count: i.subagents } });
          out.push({ id: "files", header: i.files == null ? {} : { count: i.files } });
          out.push({ id: "artifacts", header: { count: i.artifacts } });
          out.push({ id: "uploads", header: uploadsHeader(i.uploads) });
          out.push({ id: "bgtasks", header: { count: i.bgTasks } });
          out.push({ id: "terminals", header: terminalsHeader(i.terminals, i.terminalsOther) });
      }
      out.push({ id: "tools", header: { count: i.tools } });
      if (!i.inSubagent && i.hasRun) {
          out.push({ id: "run" });
      }
      out.push({ id: "details", header: { defaultOpen: false } });
      out.push({ id: "usage", header: { defaultOpen: false } });
      return out;
  }

  // A focused terminal has no tools, files, run or usage of its own: its rail is the list that gets you to another
  // terminal, so the Terminals section is all of it
  export function planTerminalRail(i: { terminals: number; terminalsOther: number }): AgentRailSectionPlan[] {
      return [{ id: "terminals", header: terminalsHeader(i.terminals, i.terminalsOther) }];
  }
  ```
- [ ] **Step 8: Run it, expect PASS**
  `npx vitest run frontend/app/view/agents/agentrailsections.test.ts` -> all cases pass.
- [ ] **Step 9: Icons for the new sections**
  In `frontend/app/view/agents/railicons.tsx` replace the lucide import block and add two entries to `RAIL_ICON`.
  Both icons exist in the installed lucide-react (0.542.0: `layout-template`, `paperclip`).
  ```tsx
  import {
      BarChart3,
      Bell,
      Coins,
      Diamond,
      FileText,
      Folder,
      GitBranch,
      Info,
      LayoutTemplate,
      Paperclip,
      Settings,
      SquareTerminal,
      Users,
      Wrench,
  } from "lucide-react";
  ```
  and inside `RAIL_ICON`, after `folder: <Folder {...iconProps} />,`:
  ```tsx
      artifacts: <LayoutTemplate {...iconProps} />,
      attach: <Paperclip {...iconProps} />,
  ```
- [ ] **Step 10: Keep the rail compiling, with the three new sections as inert stubs**
  The three records in `AgentDetailsRail` are typed `Record<AgentRailSectionId, ...>`, so the new ids need entries or
  `CONTENT[p.id]()` throws. In `frontend/app/view/agents/agentdetailsrail.tsx`:
  1. In the `planAgentRail({ ... })` call, between `files: fileCount,` and `bgTasks: bgTasks.length,` and again after
     `bgTasks`, so the call reads:
     ```tsx
         const plan = planAgentRail({
             inSubagent: sub != null,
             needsYou: !sub && roleRun && role?.kind === "lead" ? yours.length : 0,
             subagents: subs.length,
             files: fileCount,
             artifacts: 0,
             uploads: 0, // no upload records exist yet; the Uploads work feeds this
             bgTasks: bgTasks.length,
             terminals: 0,
             terminalsOther: 0,
             tools: tools.length,
             hasRun: role != null && roleRun != null,
         });
     ```
  2. In `LABEL`, after `files: "Files changed",` add `artifacts: "Artifacts",` and `uploads: "Uploads",`; after
     `bgtasks: "Background tasks",` add `terminals: "Terminals",`.
  3. In `ICON`, after `files: RAIL_ICON.files,` add `artifacts: RAIL_ICON.artifacts,` and
     `uploads: RAIL_ICON.attach,`; after `bgtasks: RAIL_ICON.terminal,` add `terminals: RAIL_ICON.terminal,`.
  4. In `CONTENT`, after the `files: () => ...` entry add `artifacts: () => null,` and `uploads: () => null,`; after
     the `bgtasks: () => (...)` entry add `terminals: () => null,`. (Later tasks replace these.)
- [ ] **Step 11: Re-run both test files**
  `npx vitest run frontend/app/element/railsections.test.ts` and
  `npx vitest run frontend/app/view/agents/agentrailsections.test.ts` -> both pass.
- [ ] **Step 12: Commit**
  ```
  git add frontend/app/element/railsections.ts frontend/app/element/railsections.test.ts frontend/app/view/agents/agentrailsections.ts frontend/app/view/agents/agentrailsections.test.ts frontend/app/view/agents/railicons.tsx frontend/app/view/agents/agentdetailsrail.tsx
  git commit -m "feat(agents): plan the rail's Artifacts, Uploads and Terminals sections" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 11: Artifacts section

**Depends on:** Task 10
**Files:**
- Create: `frontend/app/view/agents/railartifacts.ts`
- Create: `frontend/app/view/agents/railrow.ts`
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx` (`AgentDetailsRail`)
- Test: `frontend/app/view/agents/railartifacts.test.ts`

Facts used (all read from the code): the agent's canvas is `canvasStateAtom(agent.id)` in `canvasstore.ts`, a
`CanvasState | null` whose `boards: CanvasBoard[]` (`{ name, x, y, w, h, title? }`, from `canvasmodel.ts`) the poller
(`useCanvasPoller`, which `agentsurface.tsx` runs for the focused item, and the rail shows the focused item) keeps
current; `status: "removed"` means the design folder is gone. Canvas mode and the board selection are set today with
`selectCanvasTab(agentId, boardName)` (shows that board alone: `all: false`, `board: name`) and
`setCanvasMode(agentId, "canvas", Date.now())`, which is what `CanvasPane`'s tabs, `CanvasTag` and the header swap
use. `AgentSurface` hides the rail in canvas mode, so a row click makes the rail disappear behind the canvas; the
header's Terminal/Canvas swap and `c` bring it back.

> NOTE: `openref.ts` has a canvas route (`openTarget(model, { kind: "canvas", topic, board })`), but its
> caller-less path finds the owner by topic (`canvasOwner`, the first agent holding that topic) and uses
> `selectCanvasBoard`, which keeps the All view. The rail row belongs to this agent and should show that board alone,
> so it uses the two canvasstore primitives directly; it stays on the same surface, so the "one router" rule for
> cross-surface opens does not apply.

- [ ] **Step 1: Failing test for the pure list shaping**
  Create `frontend/app/view/agents/railartifacts.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { artifactsView } from "./railartifacts";
  import type { CanvasState } from "./canvasstore";

  const canvas = (over: Partial<CanvasState> = {}): CanvasState => ({
      topic: "login-flow",
      dir: "/p/.superpowers/design/login-flow",
      projectDir: "/p",
      mode: "terminal",
      board: null,
      all: false,
      boards: [],
      base: null,
      status: "ready",
      lastModifiedMs: null,
      lastViewedMs: 0,
      marking: false,
      marks: [],
      reloadKey: 0,
      ...over,
  });

  describe("artifactsView", () => {
      it("an agent with no canvas has none", () => {
          expect(artifactsView(null)).toEqual({ topic: "", unseen: false, rows: [] });
      });
      it("lists the boards in canvas.json order, named as the canvas tabs name them", () => {
          const view = artifactsView(
              canvas({
                  boards: [
                      { name: "Main.dc.html", x: 0, y: 0, w: 640, h: 480 },
                      { name: "Cards.dc.html", x: 720, y: 0, w: 640, h: 480 },
                  ],
              })
          );
          expect(view.topic).toBe("login-flow");
          expect(view.rows.map((r) => [r.name, r.label])).toEqual([
              ["Main.dc.html", "Main"],
              ["Cards.dc.html", "Cards"],
          ]);
      });
      it("a board's own title is its tooltip, else its file name is", () => {
          const view = artifactsView(
              canvas({
                  boards: [
                      { name: "Main.dc.html", x: 0, y: 0, w: 1, h: 1, title: "Sign-in screen" },
                      { name: "Cards.dc.html", x: 0, y: 0, w: 1, h: 1 },
                  ],
              })
          );
          expect(view.rows.map((r) => r.title)).toEqual(["Sign-in screen", "Cards.dc.html"]);
      });
      it("a removed design folder lists nothing, even with the boards it last read", () => {
          const boards = [{ name: "Main.dc.html", x: 0, y: 0, w: 1, h: 1 }];
          expect(artifactsView(canvas({ boards, status: "removed" })).rows).toEqual([]);
      });
      it("a probing or unreachable server keeps the boards it last read", () => {
          const boards = [{ name: "Main.dc.html", x: 0, y: 0, w: 1, h: 1 }];
          expect(artifactsView(canvas({ boards, status: "probing" })).rows).toHaveLength(1);
          expect(artifactsView(canvas({ boards, status: "server-down" })).rows).toHaveLength(1);
      });
      it("flags a canvas updated since it was last looked at, only while the terminal shows", () => {
          expect(artifactsView(canvas({ lastModifiedMs: 20, lastViewedMs: 10 })).unseen).toBe(true);
          expect(artifactsView(canvas({ lastModifiedMs: 5, lastViewedMs: 10 })).unseen).toBe(false);
          expect(artifactsView(canvas({ lastModifiedMs: null })).unseen).toBe(false);
          expect(artifactsView(canvas({ mode: "canvas", lastModifiedMs: 20, lastViewedMs: 10 })).unseen).toBe(false);
      });
  });
  ```
- [ ] **Step 2: Run it, expect FAIL**
  `npx vitest run frontend/app/view/agents/railartifacts.test.ts` -> fails to resolve `./railartifacts`.
- [ ] **Step 3: Implement the helper**
  Create `frontend/app/view/agents/railartifacts.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The details rail's Artifacts section: the boards of the agent's canvas, as rows. Pure; the rail (agentdetailsrail.tsx)
  // draws them and a click enters canvas mode on the board.

  import { boardLabel, isUnseen } from "./canvasmodel";
  import type { CanvasState } from "./canvasstore";

  export interface ArtifactRow {
      name: string; // the board's file name: what selectCanvasTab takes
      label: string; // the board's name as the canvas tabs show it
      title: string; // the tooltip: the title canvas.json gives it, else the file name
  }

  export interface ArtifactsView {
      topic: string; // the design-local topic folder the boards live in
      unseen: boolean; // a board changed since the canvas was last on screen
      rows: ArtifactRow[];
  }

  const NONE: ArtifactsView = { topic: "", unseen: false, rows: [] };

  export function artifactsView(s: CanvasState | null): ArtifactsView {
      // a removed folder keeps the boards the poller last read, but there is nothing left to open
      if (s == null || s.status === "removed") {
          return NONE;
      }
      return {
          topic: s.topic,
          unseen: isUnseen(s),
          rows: s.boards.map((b) => ({ name: b.name, label: boardLabel(b.name), title: b.title ?? b.name })),
      };
  }
  ```
- [ ] **Step 4: Run it, expect PASS**
  `npx vitest run frontend/app/view/agents/railartifacts.test.ts` -> 6 cases pass.
- [ ] **Step 5: The rail's shared list-row skin**
  Create `frontend/app/view/agents/railrow.ts` (the Artifacts and Terminals rows share it; `FileRow` keeps its own):
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The details rail's list-row skin for rows that are not files: one line, 11.5px, a hover fill when the row acts.

  export const RAIL_ROW =
      "flex w-full items-center gap-[8px] rounded-sm px-[5px] py-[3px] text-left text-[11.5px] font-medium text-secondary";
  export const RAIL_ROW_ACTION = "cursor-pointer hover:bg-surface-hover hover:text-primary";
  ```
- [ ] **Step 6: Wire the section into `AgentDetailsRail`**
  In `frontend/app/view/agents/agentdetailsrail.tsx`:
  1. Imports. Extend the lucide import to `import { ArrowLeft, ArrowUpRight, ChevronLeft, LayoutTemplate } from "lucide-react";`.
     Add (keeping the file's alphabetical order of relative imports):
     ```tsx
     import { canvasStateAtom, selectCanvasTab, setCanvasMode } from "./canvasstore";
     import { artifactsView } from "./railartifacts";
     import { RAIL_ROW, RAIL_ROW_ACTION } from "./railrow";
     ```
     (`./canvasstore` goes after `./cachestatusstore`; `./railartifacts` goes before `./railicons`; `./railrow` goes
     between `./railicons` and `./railstore`.)
  2. Data. After `const ended = endedWorker?.agent.id === agent.id ? endedWorker : undefined;` add:
     ```tsx
         const artifacts = artifactsView(useAtomValue(canvasStateAtom(agent.id)));
     ```
  3. Handler. After the `const drive = (data: string) => driveAgent(agent.blockId, data);` line add:
     ```tsx
         // a board's row opens the agent's canvas on that board alone (its own tab, not the All view)
         const openArtifact = (board: string) => {
             selectCanvasTab(agent.id, board);
             setCanvasMode(agent.id, "canvas", Date.now());
         };
     ```
  4. In the `planAgentRail({...})` call change `artifacts: 0,` to `artifacts: artifacts.rows.length,`.
  5. In `CONTENT` replace `artifacts: () => null,` with:
     ```tsx
         artifacts: () => (
             <div className="flex flex-col gap-[7px]">
                 <div className="flex min-w-0 items-center gap-[6px]">
                     <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted">{artifacts.topic}</span>
                     {artifacts.unseen ? (
                         <span
                             aria-label="updated since you last looked"
                             className="h-[5px] w-[5px] shrink-0 rounded-full bg-accent"
                         />
                     ) : null}
                 </div>
                 {artifacts.rows.map((r) => (
                     <button
                         key={r.name}
                         type="button"
                         title={r.title}
                         onClick={() => openArtifact(r.name)}
                         className={cn(RAIL_ROW, RAIL_ROW_ACTION)}
                     >
                         <LayoutTemplate size={13} aria-hidden className="shrink-0 text-muted" />
                         <span className="min-w-0 flex-1 truncate">{r.label}</span>
                     </button>
                 ))}
             </div>
         ),
     ```
- [ ] **Step 7: Re-run the helper's test**
  `npx vitest run frontend/app/view/agents/railartifacts.test.ts` -> still passes.
- [ ] **Step 8: Commit**
  ```
  git add frontend/app/view/agents/railartifacts.ts frontend/app/view/agents/railartifacts.test.ts frontend/app/view/agents/railrow.ts frontend/app/view/agents/agentdetailsrail.tsx
  git commit -m "feat(agents): Artifacts section in the agent rail" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 12: Terminals data (project on terminal VMs, scope helper)

**Depends on:** Task 9
**Files:**
- Modify: `frontend/app/view/agents/agentsviewmodel.ts` (`TerminalRowInput`, `deriveTerminalVMs`)
- Modify: `frontend/app/view/agents/agentsviewmodel.test.ts` (`describe("deriveTerminalVMs")`)
- Modify: `frontend/app/view/agents/liveagents.ts` (`liveTerminalsAtom`)
- Create: `frontend/app/view/agents/railterminals.ts`
- Modify: `frontend/app/view/agents/railstore.ts` (new `railTerminalsAllAtom`)
- Test: `frontend/app/view/agents/railterminals.test.ts`

Behaviour change to know: with a `project` on terminal VMs, `AgentSurface`'s `DivergenceBanner` (it compares
`projectOf(agent)` with the app-bar project filter) will say "Showing X · project is Y" for a focused terminal in
another project, where before a terminal (project `""`) never diverged. That is the same rule agents follow and is
accepted.

- [ ] **Step 1: Failing tests for `deriveTerminalVMs`**
  In `frontend/app/view/agents/agentsviewmodel.test.ts`, inside `describe("deriveTerminalVMs", ...)`:
  1. Replace the local `type Row = {...}` line with:
     ```ts
         type Row = {
             tabId: string;
             label: string;
             termBlockOref?: string;
             isAgentsTab?: boolean;
             agent?: string;
             projectLabel?: string;
             cwd?: string;
         };
     ```
  2. After the last `it(...)` of the describe add:
     ```ts
         it("carries the launch-time project (session:project) onto the terminal", () => {
             const rows: Row[] = [{ tabId: "t1", label: "SIEM", termBlockOref: "block:b1", projectLabel: "siem-platform" }];
             expect(deriveTerminalVMs(rows, none)[0].project).toBe("siem-platform");
         });

         it("prefers the registry's project for the terminal's cwd over the launch-time label", () => {
             const rows: Row[] = [
                 { tabId: "t1", label: "SIEM", termBlockOref: "block:b1", cwd: "C:\\code\\siem", projectLabel: "old-name" },
             ];
             const out = deriveTerminalVMs(rows, none, (cwd) => (cwd === "C:\\code\\siem" ? "SIEM Platform" : ""));
             expect(out[0].project).toBe("SIEM Platform");
         });

         it("leaves project unset when neither the registry nor the launch label names one", () => {
             const rows: Row[] = [
                 { tabId: "t1", label: "sh", termBlockOref: "block:b1", cwd: "~" },
                 { tabId: "t2", label: "sh", termBlockOref: "block:b2", projectLabel: "   " },
             ];
             const out = deriveTerminalVMs(rows, none, () => "");
             expect(out.map((t) => t.project)).toEqual([undefined, undefined]);
         });
     ```
- [ ] **Step 2: Run, expect FAIL**
  `npx vitest run frontend/app/view/agents/agentsviewmodel.test.ts -t "deriveTerminalVMs"`
  Expected: the three new cases fail (`project` is `undefined`), the existing ones pass.
- [ ] **Step 3: Implement**
  In `frontend/app/view/agents/agentsviewmodel.ts`:
  ```ts
  /** A session-sidebar row, narrowed to the fields terminal-derivation needs. */
  export interface TerminalRowInput {
      tabId: string;
      label: string;
      termBlockOref?: string;
      isAgentsTab?: boolean;
      agent?: string; // session:agent runtime, set at launch for agent tabs (never for terminals)
      projectLabel?: string; // session:project, stamped at launch (launchAgent writes it for a terminal too)
      cwd?: string; // the session terminal's cwd: the registered project it sits in names its project first
  }
  ```
  and change `deriveTerminalVMs` (signature and the pushed object; the loop's `continue` guard is unchanged):
  ```ts
  export function deriveTerminalVMs(
      rows: TerminalRowInput[],
      hasAgentStatus: (termBlockOref: string) => boolean,
      // the registry's project for a cwd; the launch-time label covers a terminal outside every registered project
      registeredProject: (cwd: string) => string = () => ""
  ): AgentVM[] {
      const out: AgentVM[] = [];
      for (const row of rows) {
          // An agent tab (session:agent set) is never a terminal, even in the window before its status
          // reporter fires — otherwise a just-launched agent renders as BOTH a pending agent and a terminal.
          const isAgentSession = row.agent != null && row.agent !== "terminal";
          if (row.isAgentsTab || isAgentSession || !row.termBlockOref || hasAgentStatus(row.termBlockOref)) {
              continue;
          }
          const project = registeredProject(row.cwd ?? "") || row.projectLabel?.trim() || undefined;
          out.push({
              id: row.tabId,
              name: row.label,
              task: "",
              state: "idle",
              kind: "terminal",
              agent: "terminal", // selects the "Terminal" pill in the header (runtimeMeta)
              blockId: row.termBlockOref.split(":")[1],
              ...(project != null ? { project } : {}),
          });
      }
      return out;
  }
  ```
  The guard is unchanged from today's code; the edits are the new `registeredProject` parameter, the `project`
  line and the spread in the pushed object (keep the function's doc comment).
- [ ] **Step 4: Run, expect PASS**
  `npx vitest run frontend/app/view/agents/agentsviewmodel.test.ts -t "deriveTerminalVMs"` -> all pass.
- [ ] **Step 5: Feed the registry into `liveTerminalsAtom`**
  In `frontend/app/view/agents/liveagents.ts` (`projectsAtom` and `registeredProjectFor` are already imported there)
  replace the atom body:
  ```ts
  export const liveTerminalsAtom: Atom<AgentVM[]> = atom((get) => {
      const vm = get(sessionSidebarViewModelAtom);
      const projects = get(projectsAtom);
      return deriveTerminalVMs(
          flattenVisualOrder(vm),
          (oref) => !!get(getAgentStatusAtom(oref))?.state,
          (cwd) => registeredProjectFor(cwd, projects)
      );
  });
  ```
  Also update the comment above it: "Rendered by the Agent surface separately from the roster (the details rail's
  Terminals section + focus pane)".
- [ ] **Step 6: Failing test for the scope helper**
  Create `frontend/app/view/agents/railterminals.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import type { AgentVM } from "./agentsviewmodel";
  import { railTerminals } from "./railterminals";

  const term = (id: string, project?: string): AgentVM => ({
      id,
      name: id,
      task: "",
      state: "idle",
      kind: "terminal",
      agent: "terminal",
      project,
  });
  const ids = (r: { rows: AgentVM[] }) => r.rows.map((t) => t.id);
  const all = [term("a1", "alpha"), term("b1", "beta"), term("a2", "alpha"), term("loose")];

  describe("railTerminals", () => {
      it("narrows to the agent's project, keeping the roster's order and the terminals that name no project", () => {
          const r = railTerminals(all, "alpha", false);
          expect(ids(r)).toEqual(["a1", "a2", "loose"]);
          expect(r).toMatchObject({ other: 1, scoped: true });
      });
      it("lists every terminal on request, still counting the other project's", () => {
          const r = railTerminals(all, "alpha", true);
          expect(ids(r)).toEqual(["a1", "b1", "a2", "loose"]);
          expect(r).toMatchObject({ other: 1, scoped: false });
      });
      it("lists every terminal when the focused item's project is unknown", () => {
          const r = railTerminals(all, "", false);
          expect(ids(r)).toEqual(["a1", "b1", "a2", "loose"]);
          expect(r).toMatchObject({ other: 0, scoped: false });
      });
      it("a project with no terminals of its own is empty, with the others counted", () => {
          const r = railTerminals([term("b1", "beta")], "alpha", false);
          expect(r).toMatchObject({ rows: [], other: 1, scoped: true });
      });
      it("no terminals at all", () => {
          expect(railTerminals([], "alpha", false)).toEqual({ rows: [], other: 0, scoped: true });
      });
  });
  ```
- [ ] **Step 7: Run, expect FAIL** -> `npx vitest run frontend/app/view/agents/railterminals.test.ts` fails to resolve `./railterminals`.
- [ ] **Step 8: Implement the helper**
  Create `frontend/app/view/agents/railterminals.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // Which terminals the details rail's Terminals section lists. A terminal belongs to the project it was launched in
  // (session:project); the rail shows the focused item's project's, and a toggle shows the rest, so a project that
  // has terminals but no agent is never unreachable. A terminal that names no project shows everywhere. Pure.

  import { projectOf, type AgentVM } from "./agentsviewmodel";

  export interface RailTerminals {
      rows: AgentVM[]; // what the section lists, in the roster's order
      other: number; // terminals that belong to another project, whether or not they are listed
      scoped: boolean; // rows is narrowed to the project
  }

  export function railTerminals(terminals: AgentVM[], project: string, showAll: boolean): RailTerminals {
      if (project === "") {
          return { rows: terminals, other: 0, scoped: false };
      }
      const mine = terminals.filter((t) => {
          const p = projectOf(t);
          return p === "" || p === project;
      });
      const other = terminals.length - mine.length;
      return showAll ? { rows: terminals, other, scoped: false } : { rows: mine, other, scoped: true };
  }
  ```
- [ ] **Step 9: Run, expect PASS** -> `npx vitest run frontend/app/view/agents/railterminals.test.ts` -> 5 cases pass.
- [ ] **Step 10: The "show all" atom**
  In `frontend/app/view/agents/railstore.ts`, after the `usageBreakdownAtom` declaration add:
  ```ts
  // whether the rail's Terminals section lists every terminal rather than the focused item's project's. Session-scoped,
  // not persisted, like usageBreakdownAtom: it is a look at the others, not a preference.
  export const railTerminalsAllAtom = atom(false);
  ```
- [ ] **Step 11: Commit**
  ```
  git add frontend/app/view/agents/agentsviewmodel.ts frontend/app/view/agents/agentsviewmodel.test.ts frontend/app/view/agents/liveagents.ts frontend/app/view/agents/railterminals.ts frontend/app/view/agents/railterminals.test.ts frontend/app/view/agents/railstore.ts
  git commit -m "feat(agents): terminals carry their project; scope helper for the rail" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 13: Terminals section, terminal rail, and the Terminals group leaves the tree

**Depends on:** Task 10, Task 11, Task 12
**Files:**
- Create: `frontend/app/view/agents/rowrename.tsx`
- Create: `frontend/app/view/agents/terminalsrail.tsx`
- Modify: `frontend/app/view/agents/agenttree.tsx` (`startRowRename`, `endRowRename`, `RenameBox` move out; `TerminalRow` and the `terminals-header` block in `AgentTree` go)
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx` (`AgentDetailsRail`)
- Modify: `frontend/app/view/agents/agentsurface.tsx` (`AgentSurface`)
- Modify: `frontend/app/view/agents/agents.tsx` (comment on `terminalsAtom`)
- Modify: `frontend/app/cockpit/cockpit-actions.ts` (comment in `launchAgent`)
- Modify: `scripts/cdp/scenarios.mjs` (`canvasSwap`, `canvasTabsScenario`, `CANVAS_TREE_TAG`)

Decisions made here (see the stage NOTEs): a click on a Terminals row focuses that terminal with the same two sets
the old tree row made (`focusIdAtom`, `focusReplyAtom` false); a focused terminal gets `TerminalRail`; Rename,
Duplicate, Copy name and Close terminal move from the tree row's menu to the rail row's menu.

> NOTE: S3 (grid) decides what "focus" means for terminals once cells exist; this task keeps the single-focus
> behaviour, and a terminal is never a grid cell (the spec's grid is agents only).

- [ ] **Step 1: Move the rename box out of the tree**
  Create `frontend/app/view/agents/rowrename.tsx` with the three symbols cut verbatim from `agenttree.tsx`
  (`startRowRename`, `endRowRename`, `RenameBox`); only `startRowRename` and `RenameBox` are exported:
  ```tsx
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The inline rename editor of a session row (a tab). Shared by the Agent tree's agent rows and the rail's terminal
  // rows: a session is a tab either way, so both rename through the same `session:label` meta.

  import { globalStore } from "@/app/store/jotaiStore";
  import { useEffect, useRef, useState } from "react";
  import { renamingRowAtom } from "./rowrenameatom";
  import { renameSession, sessionCustomLabel } from "./session-models/sessionsidebarmodel";
  import { labelChanged } from "./session-models/sessionviewmodel";

  export function startRowRename(tabId: string): void {
      globalStore.set(renamingRowAtom, tabId);
  }

  // Scoped to one row on purpose: starting a rename on a second row has already moved the atom, and the
  // first box unmounting must not then cancel the box that replaced it.
  function endRowRename(tabId: string): void {
      if (globalStore.get(renamingRowAtom) === tabId) {
          globalStore.set(renamingRowAtom, null);
      }
  }

  // Mounted in place of the row's name while renaming, which is why the seed is read on mount: this component's
  // whole lifetime IS the edit.
  export function RenameBox({ tabId }: { tabId: string }) {
      const [initial] = useState(() => sessionCustomLabel(tabId));
      const [draft, setDraft] = useState(initial);
      // Enter and blur both mean commit and Escape means cancel, but removing a focused input also
      // fires blur — so without this latch, cancelling would immediately commit the draft it discarded.
      const settled = useRef(false);
      const finish = (save: boolean) => {
          if (settled.current) {
              return;
          }
          settled.current = true;
          if (save && labelChanged(draft, initial)) {
              renameSession(tabId, draft);
          }
          endRowRename(tabId);
      };
      // The row can vanish under an open box — its session closed, or the agent exited — and React does
      // not deliver blur to an unmounting input. Without this the atom would keep naming a dead tab and
      // the Escape guard in bindings.ts would go on yielding to a box nobody can see.
      useEffect(() => () => endRowRename(tabId), [tabId]);
      return (
          <input
              autoFocus
              value={draft}
              // the row itself is a click target (select/focus); a click meant for the caret is not one
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                  if (e.key === "Enter") {
                      e.preventDefault();
                      finish(true);
                  }
                  if (e.key === "Escape") {
                      e.preventDefault();
                      finish(false);
                  }
              }}
              onBlur={() => finish(true)}
              placeholder="Name this session"
              aria-label="Session name"
              className="w-full min-w-0 rounded-[5px] border border-accent bg-surface px-[5px] text-[13px] font-medium text-primary focus:outline-none"
          />
      );
  }
  ```
  Compare against the original in `agenttree.tsx` before deleting it: if Stage 1 changed `RenameBox`, copy Stage 1's
  version instead of the one above.
- [ ] **Step 2: Point `agenttree.tsx` at it**
  In `frontend/app/view/agents/agenttree.tsx`:
  1. Delete `function startRowRename`, `function endRowRename` and `function RenameBox` (the block from
     `function startRowRename(tabId: string): void {` through the closing brace of `RenameBox`).
  2. Add `import { RenameBox, startRowRename } from "./rowrename";` (after the `./runlineagestore`/`./rowrenameatom`
     imports, alphabetical).
  3. Prune imports that only the moved code used:
     - react: `import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";` -> `import { memo, useLayoutEffect, useRef } from "react";`
     - `import { duplicateSession, renameSession, sessionCustomLabel } from "./session-models/sessionsidebarmodel";` -> `import { duplicateSession } from "./session-models/sessionsidebarmodel";`
     - in the `./session-models/sessionviewmodel` import list remove `labelChanged,`.
     Keep `renamingRowAtom` (the agent row reads it).
- [ ] **Step 3: The Terminals section and the terminal rail**
  Create `frontend/app/view/agents/terminalsrail.tsx`:
  ```tsx
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The details rail's Terminals section: the plain shells launched beside the agents. They have no group in the Agent
  // tree any more, so this is where they are reached. A row focuses its terminal, which the surface then shows in the
  // centre. A focused terminal has no tools, files or run of its own, so its rail is this section alone (TerminalRail),
  // which keeps the way to the next terminal in reach.

  import { CollapsibleRail, type RailSection } from "@/app/element/collapsiblerail";
  import { ContextMenuModel } from "@/app/store/contextmenu";
  import { globalStore } from "@/app/store/jotaiStore";
  import { cn } from "@/util/util";
  import { useAtomValue } from "jotai";
  import { Copy, CopyPlus, Pencil, SquareTerminal, X } from "lucide-react";
  import { confirmCloseSession } from "./agentactions";
  import { planTerminalRail } from "./agentrailsections";
  import type { AgentsViewModel } from "./agents";
  import { projectOf, type AgentVM } from "./agentsviewmodel";
  import { RAIL_ICON } from "./railicons";
  import { RAIL_ROW, RAIL_ROW_ACTION } from "./railrow";
  import { railTerminalsAllAtom, railVisibleAtom } from "./railstore";
  import { railTerminals, type RailTerminals } from "./railterminals";
  import { RenameBox, startRowRename } from "./rowrename";
  import { renamingRowAtom } from "./rowrenameatom";
  import { agentProject } from "./runlineage";
  import { duplicateSession } from "./session-models/sessionsidebarmodel";

  // the terminals this rail lists for the focused item: its project's, or all of them on request
  export function useRailTerminals(model: AgentsViewModel, agent: AgentVM): RailTerminals {
      const terminals = useAtomValue(model.terminalsAtom);
      const lineage = useAtomValue(model.lineageAtom);
      const agents = useAtomValue(model.agentsAtom);
      const showAll = useAtomValue(railTerminalsAllAtom);
      return railTerminals(terminals, agentProject(lineage, agents, agent), showAll);
  }

  function TerminalRailRow({
      model,
      terminal,
      selected,
      showProject,
  }: {
      model: AgentsViewModel;
      terminal: AgentVM;
      selected: boolean;
      showProject: boolean;
  }) {
      const renaming = useAtomValue(renamingRowAtom) === terminal.id;
      const project = projectOf(terminal);
      const select = () => {
          globalStore.set(model.focusIdAtom, terminal.id);
          globalStore.set(model.focusReplyAtom, false);
      };
      // The actions an agent row offers, minus the agent-only wording: a terminal duplicates into a fresh shell in the
      // same cwd. Rename matters more here than on an agent row: a terminal has no ai-title to name it, so without a
      // rename it is stuck on the launch-time label it shares with every other shell in the repo.
      const onContextMenu = (e: React.MouseEvent) => {
          const items: ContextMenuItem[] = [
              { label: "Rename", icon: <Pencil size={15} />, click: () => startRowRename(terminal.id) },
              { label: "Duplicate", icon: <CopyPlus size={15} />, click: () => duplicateSession(model, terminal.id) },
              {
                  label: "Copy name",
                  icon: <Copy size={15} />,
                  click: () => void navigator.clipboard.writeText(terminal.name),
              },
              { type: "separator" },
              {
                  label: "Close terminal",
                  icon: <X size={15} />,
                  danger: true,
                  click: () => confirmCloseSession(terminal),
              },
          ];
          ContextMenuModel.getInstance().showContextMenu(items, e);
      };
      return (
          <div
              data-rail-terminal={terminal.id}
              aria-current={selected ? "true" : undefined}
              onClick={select}
              onContextMenu={onContextMenu}
              className={cn(RAIL_ROW, RAIL_ROW_ACTION, selected && "bg-surface-selected text-primary")}
          >
              <SquareTerminal size={13} aria-hidden className="shrink-0 text-muted" />
              {renaming ? (
                  <RenameBox tabId={terminal.id} />
              ) : (
                  <span className="min-w-0 flex-1 truncate">{terminal.name}</span>
              )}
              {showProject && project ? (
                  <span className="max-w-[88px] shrink-0 truncate text-[10.5px] text-muted">{project}</span>
              ) : null}
          </div>
      );
  }

  export function TerminalsSection({
      model,
      view,
      focusId,
  }: {
      model: AgentsViewModel;
      view: RailTerminals;
      focusId?: string;
  }) {
      return (
          <div className="flex flex-col gap-[7px]">
              {view.rows.length === 0 ? (
                  <div className="text-[11.5px] text-muted">No terminals in this project</div>
              ) : (
                  view.rows.map((t) => (
                      <TerminalRailRow
                          key={t.id}
                          model={model}
                          terminal={t}
                          selected={focusId === t.id}
                          showProject={!view.scoped && view.other > 0}
                      />
                  ))
              )}
              {view.other > 0 ? (
                  <button
                      type="button"
                      // scoped means the list is narrowed, so the click widens it; widened, it narrows again
                      onClick={() => globalStore.set(railTerminalsAllAtom, view.scoped)}
                      className="w-fit cursor-pointer rounded-[7px] px-[6px] py-[3px] text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover"
                  >
                      {view.scoped ? `Show ${view.other} from other projects` : "Only this project"}
                  </button>
              ) : null}
          </div>
      );
  }

  // The rail of a focused terminal: the Terminals section alone, in the same rail (same aside, same toggle) as an
  // agent's, so `d` and the header button behave the same.
  export function TerminalRail({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
      const view = useRailTerminals(model, agent);
      const sections: RailSection[] = planTerminalRail({
          terminals: view.rows.length,
          terminalsOther: view.other,
      }).map((p) => ({
          id: p.id,
          label: "Terminals",
          icon: RAIL_ICON.terminal,
          header: p.header,
          content: <TerminalsSection model={model} view={view} focusId={agent.id} />,
      }));
      return <CollapsibleRail openAtom={railVisibleAtom} ariaLabel="Agent details" sections={sections} />;
  }
  ```
  `ContextMenuItem` is the ambient global type `agenttree.tsx` uses without importing.
- [ ] **Step 4: Fill the agent rail's Terminals section**
  In `frontend/app/view/agents/agentdetailsrail.tsx`:
  1. Add `import { TerminalsSection, useRailTerminals } from "./terminalsrail";` (between `./subagentsstore` and `./tokenusagesection`).
  2. After the `const artifacts = artifactsView(...)` line add `const terminalsView = useRailTerminals(model, agent);`
  3. In the `planAgentRail({...})` call replace `terminals: 0,` and `terminalsOther: 0,` with
     `terminals: terminalsView.rows.length,` and `terminalsOther: terminalsView.other,`.
  4. In `CONTENT` replace `terminals: () => null,` with
     `terminals: () => <TerminalsSection model={model} view={terminalsView} />,`.
- [ ] **Step 5: Show the terminal rail for a focused terminal**
  In `frontend/app/view/agents/agentsurface.tsx` add `import { TerminalRail } from "./terminalsrail";` and replace
  the rail line in `AgentSurface`'s return. Before:
  ```tsx
                {!fullscreen && !canvasMode && agent.kind !== "terminal" ? (
                    <AgentDetailsRail model={model} agent={agent} />
                ) : null}
  ```
  After (keep any extra conjunct Stage 1 put in the condition, such as one for History mode):
  ```tsx
                {!fullscreen && !canvasMode ? (
                    agent.kind === "terminal" ? (
                        <TerminalRail model={model} agent={agent} />
                    ) : (
                        <AgentDetailsRail model={model} agent={agent} />
                    )
                ) : null}
  ```
- [ ] **Step 6: Remove the Terminals group from the tree**
  In `frontend/app/view/agents/agenttree.tsx`:
  1. Delete the whole `function TerminalRow(...)` and the comment above it (`// A background terminal row: no agent chrome ...`).
  2. In `AgentTree`, delete the `const terminals = useAtomValue(model.terminalsAtom);` line, and change
     ```tsx
         const rowIds = [...agents.map((a) => a.id), ...terminals.map((t) => t.id)];
     ```
     to `const rowIds = agents.map((a) => a.id);` and, in the comment above it, "only agents/terminals that arrive after
     mount fade in" to "only agents that arrive after mount fade in".
  3. In the `AnimatePresence`, delete the two trailing blocks after the `visibleRows.map(...)`:
     ```tsx
                     {terminals.length > 0 ? (
                         <motion.div key="terminals-header" ...>
                             ...
                         </motion.div>
                     ) : null}
                     {terminals.map((t) => (
                         <motion.div key={t.id} ...>
                             <TerminalRow model={model} terminal={t} />
                         </motion.div>
                     ))}
     ```
  4. Remove `SquareTerminal,` from the lucide import list (nothing else in the file uses it; `Copy`, `CopyPlus`,
     `Pencil`, `X` stay, the agent row's menu uses them).
  If Stage 1 rebuilt `AgentTree` around a different row model, the target is the same: no `terminalsAtom`,
  `TerminalRow`, `terminals-header` or `SquareTerminal` left in the file.
- [ ] **Step 7: Check nothing was left dangling**
  Use Grep (no builds): in `frontend/app/view/agents/agenttree.tsx` the pattern
  `terminalsAtom|TerminalRow|terminals-header|SquareTerminal|useState|labelChanged|renameSession|sessionCustomLabel|useEffect\b`
  must return no matches. In `frontend/app/view/agents/` the pattern `startRowRename|RenameBox` must show
  definitions only in `rowrename.tsx` and uses in `agenttree.tsx` and `terminalsrail.tsx`.
- [ ] **Step 8: Stale comments**
  - `frontend/app/view/agents/agents.tsx`, the comment on `terminalsAtom`: replace "kept separate from the agent
    roster (own tree group + focus pane)" with "kept separate from the agent roster (listed in the details rail's
    Terminals section, with their own focus pane)".
  - `frontend/app/cockpit/cockpit-actions.ts`, in `launchAgent`, the comment "The terminal appears under the Agent
    tree's \"Terminals\" group and starts when first opened": replace with "The terminal appears in the details
    rail's Terminals section and starts when first opened".
- [ ] **Step 9: Retarget the two canvas scenarios that clicked a terminal's tree tag**
  `canvas-swap` and `canvas-tabs` open a plain terminal tab, reveal a canvas as that terminal's, then clicked the
  terminal's tree-row `canvas` tag (`CANVAS_TREE_TAG`). That row is gone. They now focus the terminal with
  `uireveal agent:<tabId>` (the address parser takes `agent:<id>`; `loadAgent` accepts a terminal) and use the
  header's swap, which exists for any focused item that has a canvas. In `scripts/cdp/scenarios.mjs`:
  1. Delete the `CANVAS_TREE_TAG` constant (the line starting `const CANVAS_TREE_TAG = ...`).
  2. `canvasSwap.arrange`: after the `ctx.inRoster = await polishWaitFor(...)` statement and before `return ctx;`
     add (a populated store may have an agent focused, so the terminal is focused explicitly):
     ```js
         if (ctx.inRoster) {
             await h.rpc("uireveal", { address: `agent:${ctx.tabId}` }, UI_ROUTE);
         }
     ```
  3. `canvasSwap.assert`, step 1 and 1b. Before:
     ```js
         // an agent's reveal only attaches; the user opens the canvas from the row's tag
         const attached = await polishWaitFor(h, `!!${CANVAS_TREE_TAG}`, 3000);
         const paneAfterReveal = await h.ev(`!!${CANVAS_PANE}`);
         rec(
             "1. uireveal canvas:<topic> from the terminal attaches the canvas without switching to it",
             revealError == null && attached && !paneAfterReveal,
             `tag=${attached} pane=${paneAfterReveal} error=${revealError}`
         );
         await h.ev(`${CANVAS_TREE_TAG}?.click()`);
         const paneUp = await polishWaitFor(h, `!!${CANVAS_PANE}`, 3000);
     ```
     After:
     ```js
         // an agent's reveal only attaches; the user opens the canvas from the header's swap
         const attached = await polishWaitFor(h, `!!${CANVAS_SWAP}`, 3000);
         const paneAfterReveal = await h.ev(`!!${CANVAS_PANE}`);
         rec(
             "1. uireveal canvas:<topic> from the terminal attaches the canvas without switching to it",
             revealError == null && attached && !paneAfterReveal,
             `swap=${attached} pane=${paneAfterReveal} error=${revealError}`
         );
         await clickCanvasSwap(h, "Canvas");
         const paneUp = await polishWaitFor(h, `!!${CANVAS_PANE}`, 3000);
     ```
     and rename step 1b's text to `"1b. the header's Canvas button shows the canvas pane in the terminal's place"`.
  4. `canvasSwap.assert`, step 6. Before:
     ```js
         const tag = await h.ev(`!!${CANVAS_TREE_TAG}`);
         rec("6. the agent tree tags the terminal's row canvas", tag === true, `tag=${tag}`);
     ```
     After:
     ```js
         const treeTerminals = await h.ev(
             `[...document.querySelectorAll("[data-agent-tree] span")].some((s) => (s.textContent || "").trim() === "Terminals")`
         );
         rec(
             "6. the agent tree has no Terminals group (terminals live in the details rail)",
             treeTerminals === false,
             `treeTerminals=${treeTerminals}`
         );
     ```
  5. `canvasTabsScenario.arrange`: the same `if (ctx.inRoster) { await h.rpc("uireveal", ...) }` block as in 2.
  6. `canvasTabsScenario.assert`. Before:
     ```js
         await polishWaitFor(h, `!!${CANVAS_TREE_TAG}`, 3000);
         await h.ev(`${CANVAS_TREE_TAG}?.click()`);
     ```
     After:
     ```js
         await polishWaitFor(h, `!!${CANVAS_SWAP}`, 3000);
         await clickCanvasSwap(h, "Canvas");
     ```
  (`UI_ROUTE`, `CANVAS_SWAP` and `clickCanvasSwap` are module-level in the same file and defined before use.)
- [ ] **Step 10: Format the new files and run the two scenarios**
  `npx prettier --write frontend/app/view/agents/rowrename.tsx frontend/app/view/agents/terminalsrail.tsx` (new files
  only; never the tree). Then, **requires `task dev` running** (the user's app):
  `task verify:ui -- canvas-swap canvas-tabs` -> both PASS (a SKIP with "could not verify" means the terminal launch
  failed, not that the retarget is wrong).
- [ ] **Step 11: Commit**
  ```
  git add frontend/app/view/agents/rowrename.tsx frontend/app/view/agents/terminalsrail.tsx frontend/app/view/agents/agenttree.tsx frontend/app/view/agents/agentdetailsrail.tsx frontend/app/view/agents/agentsurface.tsx frontend/app/view/agents/agents.tsx frontend/app/cockpit/cockpit-actions.ts scripts/cdp/scenarios.mjs
  git commit -m "feat(agents): Terminals move from the tree to the details rail" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 14: Uploads section placeholder

**Depends on:** Task 13
**Files:**
- Create: `frontend/app/view/agents/railuploads.tsx`
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx` (`AgentDetailsRail`)

The plan (Task 10) already lists `uploads` with `{ count: 0, emptyOpenable: true, defaultOpen: false }`: a counted row
that is closed until it has records and can still be opened empty, so S4's `+ Attach` is reachable before the first
upload. No pure logic here beyond the planner cases already tested in Task 10, so no new test file.

> NOTE: S4 replaces `UploadsSection`'s body with the record list and wires the button; the `data-rail-uploads` and
> `data-rail-attach` hooks are for it and for CDP. S4 may flip `defaultOpen` once the section has real content.

- [ ] **Step 1: The placeholder**
  Create `frontend/app/view/agents/railuploads.tsx`:
  ```tsx
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The details rail's Uploads section. For now only its shape: the empty state and the Attach slot the uploads work
  // (paste, drop, Attach) fills, so the rail already lists Uploads between Artifacts and Background tasks.

  import { Plus } from "lucide-react";

  export function UploadsSection() {
      return (
          <div data-rail-uploads className="flex flex-col gap-[8px]">
              <div className="text-[11.5px] text-muted">Nothing attached yet</div>
              <button
                  type="button"
                  data-rail-attach
                  disabled
                  title="Attach files"
                  className="inline-flex w-fit items-center gap-[5px] rounded-[7px] border border-edge-mid px-[9px] py-[4px] text-[11px] font-semibold text-secondary disabled:cursor-default disabled:opacity-50"
              >
                  <Plus size={12} aria-hidden />
                  Attach
              </button>
          </div>
      );
  }
  ```
- [ ] **Step 2: Render it**
  In `frontend/app/view/agents/agentdetailsrail.tsx` add `import { UploadsSection } from "./railuploads";` (after
  `./railstore`, before `./runlineage`) and in `CONTENT` replace `uploads: () => null,` with `uploads: () => <UploadsSection />,`.
- [ ] **Step 3: Format the new file**
  `npx prettier --write frontend/app/view/agents/railuploads.tsx`
- [ ] **Step 4: Commit**
  ```
  git add frontend/app/view/agents/railuploads.tsx frontend/app/view/agents/agentdetailsrail.tsx
  git commit -m "feat(agents): Uploads section placeholder in the agent rail" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 15: Rail visible by default

**Depends on:** Task 12, Task 13
**Files:**
- Modify: `frontend/app/view/agents/railstore.ts` (`DEFAULT_RAIL_VISIBLE`, `railVisibleAtom`)
- Modify: `frontend/app/view/agents/settingsmodel.ts` (`general.rail` row)
- Modify: `frontend/app/view/agents/agentsurface.tsx` (header comment)
- Test: `frontend/app/view/agents/railstore.test.ts` (new)
- Test: `frontend/app/view/agents/settingsmodel.test.ts`

Facts: `railVisibleAtom = atomWithStorage("agent.rail.visible", DEFAULT_RAIL_VISIBLE)` is read by
`CollapsibleRail` (via `AgentDetailsRail`/`TerminalRail`), `AgentHeader`, `endedtranscript.tsx`, the `d` binding
(`agent:toggle-rail` in `bindings.ts`) and the Settings toggle. `settingssurface.tsx` computes "changed from default"
from `DEFAULT_RAIL_VISIBLE`, so flipping the constant updates the Settings row's revert state with no further edit.
No test touched either before. `atomWithStorage` without `getOnInit` renders the default for one frame and applies
the stored value afterwards, so a user who stored `false` would see the rail slide open then shut on every launch;
`getOnInit: true` (jotai 2.9.3 supports it; `focusstore.ts`, `codestore.ts` already use it) reads storage when the
atom is created.

- [ ] **Step 1: Failing test for the default and for stored values winning**
  Create `frontend/app/view/agents/railstore.test.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0

  import { beforeEach, describe, expect, it, vi } from "vitest";

  vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
  vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
  vi.mock("./agentcwdresolve", () => ({ resolveCwd: vi.fn() }));
  vi.mock("./agentsessionstore", () => ({ ensureSessionStart: vi.fn() }));

  const lsMock = vi.hoisted(() => {
      const store = new Map<string, string>();
      const mock = {
          store,
          getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
          clear: () => store.clear(),
      };
      (globalThis as any).localStorage = mock;
      (globalThis as any).window = { localStorage: mock };
      return mock;
  });

  const KEY = "agent.rail.visible";

  // the atom reads storage once, when the module creates it (getOnInit), so each case stores first and imports a
  // fresh copy of the module
  async function railVisibleAtStartup(stored?: string): Promise<boolean> {
      lsMock.clear();
      if (stored != null) {
          lsMock.store.set(KEY, stored);
      }
      vi.resetModules();
      const { createStore } = await import("jotai");
      const { railVisibleAtom } = await import("./railstore");
      return createStore().get(railVisibleAtom);
  }

  describe("railVisibleAtom", () => {
      beforeEach(() => lsMock.clear());

      it("is on for a profile that never stored a choice", async () => {
          expect(await railVisibleAtStartup()).toBe(true);
      });
      it("keeps a stored off: anyone who turned the rail off still has it off", async () => {
          expect(await railVisibleAtStartup("false")).toBe(false);
      });
      it("keeps a stored on", async () => {
          expect(await railVisibleAtStartup("true")).toBe(true);
      });
      it("the default is on", async () => {
          vi.resetModules();
          const { DEFAULT_RAIL_VISIBLE } = await import("./railstore");
          expect(DEFAULT_RAIL_VISIBLE).toBe(true);
      });
  });
  ```
- [ ] **Step 2: Failing test for the Settings row**
  In `frontend/app/view/agents/settingsmodel.test.ts` add a describe after the `"vault sync rows"` one:
  ```ts
  describe("details rail row", () => {
      it("is a local pref on agent.rail.visible whose copy says the rail is on unless turned off", () => {
          const row = sections()
              .find((s) => s.id === "general")!
              .rows.find((r) => r.id === "general.rail")!;
          expect(row.key).toBe("agent.rail.visible");
          expect(row.scope).toBe("local");
          expect(row.title).toBe("Show details rail by default");
          expect(row.desc).toBe(
              "The per-agent rail on the Agent surface: changed files, artifacts, uploads and terminals. On unless you turn it off."
          );
      });
  });
  ```
- [ ] **Step 3: Run both, expect FAIL**
  `npx vitest run frontend/app/view/agents/railstore.test.ts` -> the "never stored a choice" and "default is on" cases
  fail (`false`). `npx vitest run frontend/app/view/agents/settingsmodel.test.ts -t "details rail row"` -> fails on `desc`.
- [ ] **Step 4: Flip the default**
  In `frontend/app/view/agents/railstore.ts` replace the comment, constant and atom:
  ```ts
  // First persisted FE pref in frontend/app: the rail is global and on by default (localStorage key
  // "agent.rail.visible"). A stored value, on or off, wins over the default: it was off by default until 2026-10, so a
  // stored "false" is a choice, and a profile that never toggled it just gets the new default. getOnInit reads the
  // stored value when the atom is created, so a user who closed the rail does not see it open for the render before
  // storage arrives.
  export const DEFAULT_RAIL_VISIBLE = true;

  export const railVisibleAtom = atomWithStorage("agent.rail.visible", DEFAULT_RAIL_VISIBLE, undefined, {
      getOnInit: true,
  });
  ```
- [ ] **Step 5: The Settings row copy**
  In `frontend/app/view/agents/settingsmodel.ts`, in the `general.rail` row, replace
  `desc: "The per-agent git/details rail on the Agent surface.",` with
  `desc: "The per-agent rail on the Agent surface: changed files, artifacts, uploads and terminals. On unless you turn it off.",`.
  The title and `key` stay.
- [ ] **Step 6: Stale comment**
  In `frontend/app/view/agents/agentsurface.tsx`, in the header comment replace
  "The rail is toggleable (railVisibleAtom, default off, `d` key) so the surface is normally 2 panes, 3 with the rail
  open." with "The rail is toggleable (railVisibleAtom, default on, `d` key): the surface is normally 3 panes, 2 with
  the rail closed." (If Stage 1 reworded that paragraph, change only the "default off"/2-panes claim.)
- [ ] **Step 7: Run both, expect PASS**
  `npx vitest run frontend/app/view/agents/railstore.test.ts` and
  `npx vitest run frontend/app/view/agents/settingsmodel.test.ts` -> pass.
- [ ] **Step 8: Commit**
  ```
  git add frontend/app/view/agents/railstore.ts frontend/app/view/agents/railstore.test.ts frontend/app/view/agents/settingsmodel.ts frontend/app/view/agents/settingsmodel.test.ts frontend/app/view/agents/agentsurface.tsx
  git commit -m "feat(agents): the details rail is visible by default" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 16: CDP scenario for the rail sections

**Depends on:** Task 11, Task 13, Task 14
**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (`agentTreeRail` step 10; new `agentRailSections`; `SCENARIOS`)

`agent-tree-rail` step 10 filters the rail's `[data-rail-section]` ids to the six it lists, so it still passes
after Task 10, but it no longer says what the rail shows; it moves to the full order. The new `agent-rail-sections`
scenario is separate from Stage 1's `agent-history` so it does not depend on that scenario's shape. It uses a
one-agent dev fixture roster (the fixture file `agent-tree-rail` already writes, `TREE_RAIL_FIXTURE`), two real
plain terminals in two projects (so the Terminals scope has something to hide), and a temp canvas with two boards
revealed as the fixture agent's (`uireveal canvas:<topic>` with `callerblockid` set to the fixture agent's block,
which `loadCanvas` matches against the roster). The final-verify store has no agents, so the scenario brings its own.

- [ ] **Step 1: `agent-tree-rail` step 10 on the new order**
  In `agentTreeRail.assert`, replace
  ```js
      const order = ["subagents", "files", "bgtasks", "tools", "details", "usage"];
  ```
  with
  ```js
      const order = ["subagents", "files", "artifacts", "uploads", "bgtasks", "terminals", "tools", "details", "usage"];
  ```
  and its step text
  `"10. the lead's rail lists Subagents, Files changed, Background tasks, Tools used, Details, Token usage in order"`
  with
  `"10. the lead's rail lists Subagents, Files changed, Artifacts, Uploads, Background tasks, Terminals, Tools used, Details, Token usage in order"`.
  (Its comment "the rail is off by default and persisted" in `arrangeTreeRail` becomes "the rail is persisted"; the
  scenario still sets the key explicitly.)
- [ ] **Step 2: The new scenario**
  Insert after `canvasTabsScenario` (it reuses `canvasTabFrames`, `CANVAS_PANE`, `clickCanvasSwap`, `waveService`,
  `UI_ROUTE`, `polishWaitFor`, `polishNap`, `polishSweep`, `sweptOk`, `restoreStorageKey`, `teardownFixtureRun`,
  `TREE_RAIL_FIXTURE`, `RAIL_VISIBLE_KEY`, `RAIL_SECTIONS_KEY`, all module-level in this file):
  ```js
  // --- the details rail's sections: Artifacts, Uploads and Terminals, in the order the spec gives ---------------------
  // docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md, decision 6. The roster is one dev fixture agent;
  // the terminals are two real plain tabs in two projects; the agent owns a temp canvas with two boards.
  const RAIL_SECTIONS_AGENT_ID = "fx-rail-sections";
  const RAIL_SECTIONS_AGENT_BLOCK = "fx-blk-rail-sections";
  const RAIL_SECTIONS_PROJECT_A = "verify-rail-a";
  const RAIL_SECTIONS_PROJECT_B = "verify-rail-b";
  const RAIL_SECTIONS_TOPIC = "verify-rail-sections";
  const RAIL_SECTIONS_ORDER = [
      "subagents",
      "files",
      "artifacts",
      "uploads",
      "bgtasks",
      "terminals",
      "tools",
      "details",
      "usage",
  ];
  const RAIL_ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
  const RAIL_SECTION_IDS = `(() => {
      const rail = ${RAIL_ASIDE};
      return rail ? [...rail.querySelectorAll("[data-rail-section]")].map((s) => s.dataset.railSection) : null;
  })()`;
  const railSection = (id) => `${RAIL_ASIDE}?.querySelector('[data-rail-section="${id}"]')`;
  // the number after a section's label
  const railCount = (id) => `(() => {
      const t = ${railSection(id)}?.querySelector("h3")?.textContent ?? "";
      const m = /(\\d+)$/.exec(t.trim());
      return m ? Number(m[1]) : null;
  })()`;
  const railTerminalIds = `[...document.querySelectorAll('aside[aria-label="Agent details"] [data-rail-terminal]')]
      .map((r) => r.getAttribute("data-rail-terminal"))`;

  // a plain terminal tab in a project, the way launchAgent makes one (CreateTab, then the terminal meta)
  async function openRailTerminal(h, workspaceId, project) {
      const tabId = await waveService(h, "workspace", "CreateTab", [workspaceId, project, false]);
      const tab = await waveService(h, "object", "GetObject", [`tab:${tabId}`]);
      const blockId = tab?.blockids?.[0];
      if (!blockId) throw new Error("the new tab has no block");
      await h.rpc("setmeta", { oref: `block:${blockId}`, meta: { view: "term", controller: "shell", "cmd:cwd": "~" } });
      await h.rpc("setmeta", { oref: `tab:${tabId}`, meta: { "session:project": project } });
      return { tabId, blockId, project };
  }

  async function arrangeRailSections(h, ctx) {
      const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
      const wslist = await h.rpc("workspacelist", null);
      const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
      ctx.workspaceId = ws.workspacedata.oid;
      for (const project of [RAIL_SECTIONS_PROJECT_A, RAIL_SECTIONS_PROJECT_B]) {
          ctx.terminals.push(await openRailTerminal(h, ctx.workspaceId, project));
      }
      mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
      writeFileSync(
          TREE_RAIL_FIXTURE,
          JSON.stringify(
              [
                  {
                      id: RAIL_SECTIONS_AGENT_ID,
                      name: "rail sections agent",
                      project: RAIL_SECTIONS_PROJECT_A,
                      task: "verify the rail sections",
                      state: "idle",
                      agent: "claude",
                      model: "opus",
                      idleSince: Date.now() - 60_000,
                      blockId: RAIL_SECTIONS_AGENT_BLOCK,
                  },
              ],
              null,
              2
          )
      );
      ctx.wroteFixture = true;
      // the rail is persisted and the fixture roster is read once at boot, so both need a reload
      await h.ev(`localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true")`);
      await h.ev(`localStorage.removeItem(${JSON.stringify(RAIL_SECTIONS_KEY)})`);
      await h.ev("location.reload()");
      await h.ev(`(async () => {
          for (let i = 0; i < 60 && !document.querySelector("nav button"); i++) {
              await new Promise((r) => setTimeout(r, 500));
          }
      })()`);
      await h.goto("agent");
      ctx.inRoster = await polishWaitFor(
          h,
          `!!document.querySelector('[data-agent-terminal="${RAIL_SECTIONS_AGENT_ID}"]')`,
          15000
      );
      if (!ctx.inRoster) return;
      await h.rpc("uireveal", { address: `agent:${RAIL_SECTIONS_AGENT_ID}` }, UI_ROUTE);
      await h.rpc(
          "uireveal",
          { address: `canvas:${RAIL_SECTIONS_TOPIC}`, callerblockid: RAIL_SECTIONS_AGENT_BLOCK, callercwd: ctx.cwd },
          UI_ROUTE
      );
      // the poller reads canvas.json on its next tick (3s)
      ctx.boards = await polishWaitFor(h, `(${railCount("artifacts")}) === 2`, 12000);
  }

  const agentRailSections = {
      name: "agent-rail-sections",
      surface: "agent",
      async arrange(h) {
          const cwd = mkdtempSync(join(tmpdir(), "verify-rail-sections-"));
          const project = join(cwd, ".superpowers", "design", RAIL_SECTIONS_TOPIC, "project");
          mkdirSync(project, { recursive: true });
          writeFileSync(
              join(project, "canvas.json"),
              JSON.stringify({
                  boards: {
                      "Main.dc.html": { x: 0, y: 0, w: 640, h: 480 },
                      "Cards.dc.html": { x: 720, y: 0, w: 640, h: 480 },
                  },
                  order: ["Main.dc.html", "Cards.dc.html"],
              })
          );
          for (const name of ["Main", "Cards"]) {
              writeFileSync(join(project, `${name}.dc.html`), `<!doctype html><title>${name}</title><p>${name} board</p>`);
          }
          const ctx = {
              cwd,
              terminals: [],
              prevRail: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`),
              prevSections: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_SECTIONS_KEY)})`),
          };
          // a throw past this point still returns ctx, so teardown removes whatever was already made
          try {
              await arrangeRailSections(h, ctx);
          } catch (e) {
              ctx.arrangeError = String(e?.message ?? e);
          }
          return ctx;
      },
      async assert(h, ctx) {
          const steps = [];
          const rec = (step, ok, detail) => steps.push({ step, ok, detail });
          const railUp =
              ctx.arrangeError == null &&
              ctx.inRoster === true &&
              (await polishWaitFor(h, `!!${railSection("subagents")}`, 8000));
          rec(
              "0. the fixture agent is focused and its rail is showing",
              railUp,
              ctx.arrangeError ?? `inRoster=${ctx.inRoster}`
          );
          if (!railUp) return steps;
          const [termA, termB] = ctx.terminals;

          const ids = await h.ev(RAIL_SECTION_IDS);
          rec(
              "1. the rail lists Subagents, Files, Artifacts, Uploads, Background tasks, Terminals, Tools, Details, Token usage in order",
              JSON.stringify(ids) === JSON.stringify(RAIL_SECTIONS_ORDER),
              JSON.stringify(ids)
          );
          await h.shot("cdp-shots/agent-rail-sections.png");

          const artifactRows = await h.ev(
              `[...(${railSection("artifacts")}?.querySelectorAll("button") ?? [])]
                  .filter((b) => !b.closest("h3")).map((b) => (b.textContent || "").trim())`
          );
          const artifactsOpen = await h.ev(`${railSection("artifacts")}?.dataset.open`);
          rec(
              "2. Artifacts counts the canvas's boards, open, and lists them",
              ctx.boards === true &&
                  artifactsOpen === "true" &&
                  JSON.stringify(artifactRows) === JSON.stringify(["Main", "Cards"]),
              JSON.stringify({ boards: ctx.boards, artifactsOpen, artifactRows })
          );

          await h.ev(
              `[...(${railSection("artifacts")}?.querySelectorAll("button") ?? [])].find((b) => (b.textContent || "").trim() === "Cards")?.click()`
          );
          const paneUp = await polishWaitFor(h, `!!${CANVAS_PANE}`, 3000);
          const shown = await canvasTabFrames(h);
          rec(
              "3. a board's row opens the canvas on that board alone",
              paneUp && JSON.stringify(shown.frames) === JSON.stringify(["Cards.dc.html"]),
              JSON.stringify({ paneUp, ...shown })
          );
          await h.shot("cdp-shots/agent-rail-sections-canvas.png");
          // the rail hides in canvas mode; the header swap brings the terminal, and the rail, back
          await clickCanvasSwap(h, "Terminal");
          await polishWaitFor(h, `!!${railSection("uploads")}`, 4000);

          const uploadsBefore = await h.ev(`(() => {
              const s = ${railSection("uploads")};
              return s
                  ? { open: s.dataset.open, count: ${railCount("uploads")}, heading: s.querySelector("h3 button")?.disabled === false }
                  : null;
          })()`);
          await h.ev(`${railSection("uploads")}?.querySelector("h3 button")?.click()`);
          await polishNap(300);
          const uploadsAfter = await h.ev(`(() => {
              const s = ${railSection("uploads")};
              const attach = s?.querySelector("button[data-rail-attach]");
              return s ? { open: s.dataset.open, attachDisabled: attach != null && attach.disabled } : null;
          })()`);
          rec(
              "4. Uploads is a counted 0 that opens to an empty state and a disabled Attach",
              uploadsBefore?.count === 0 &&
                  uploadsBefore.open === "false" &&
                  uploadsBefore.heading === true &&
                  uploadsAfter?.open === "true" &&
                  uploadsAfter.attachDisabled === true,
              JSON.stringify({ uploadsBefore, uploadsAfter })
          );

          const scoped = await h.ev(railTerminalIds);
          const scopedCount = await h.ev(railCount("terminals"));
          const widened = await h.ev(`(async () => {
              const b = [...(${railSection("terminals")}?.querySelectorAll("button") ?? [])]
                  .find((x) => /^Show \\d+ from other projects$/.test((x.textContent || "").trim()));
              if (!b) return null;
              b.click();
              await new Promise((r) => setTimeout(r, 400));
              return ${railTerminalIds};
          })()`);
          rec(
              "5. Terminals lists the agent's project's terminals, and Show N from other projects adds the rest",
              scoped.includes(termA.tabId) &&
                  !scoped.includes(termB.tabId) &&
                  scopedCount === scoped.length &&
                  Array.isArray(widened) &&
                  widened.includes(termA.tabId) &&
                  widened.includes(termB.tabId),
              JSON.stringify({ scoped, scopedCount, widened })
          );

          const swept = await h.ev(polishSweep(RAIL_ASIDE));
          rec("6. nothing in the open rail is under 10.5px", sweptOk(swept), JSON.stringify(swept));

          await h.ev(`document.querySelector('[data-rail-terminal="${termA.tabId}"]')?.click()`);
          const focused = await polishWaitFor(
              h,
              `(() => {
                  const t = document.querySelector('[data-agent-terminal="${termA.tabId}"]');
                  return !!t && !t.classList.contains("hidden");
              })()`,
              4000
          );
          await polishNap(600);
          const narrowed = await h.ev(RAIL_SECTION_IDS);
          const current = await h.ev(
              `document.querySelector('[data-rail-terminal="${termA.tabId}"]')?.getAttribute("aria-current")`
          );
          rec(
              "7. a Terminals row focuses that terminal, and the rail narrows to Terminals alone",
              focused && JSON.stringify(narrowed) === JSON.stringify(["terminals"]) && current === "true",
              JSON.stringify({ focused, narrowed, current })
          );
          await h.shot("cdp-shots/agent-rail-sections-terminal.png");

          const treeLists = await h.ev(
              `[...document.querySelectorAll("[data-agent-tree] span")].some((s) => (s.textContent || "").trim() === "Terminals")`
          );
          rec("8. the Agent tree has no Terminals group", treeLists === false, `treeLists=${treeLists}`);
          return steps;
      },
      async teardown(h, ctx) {
          await teardownFixtureRun(h, ctx, "agent-rail-sections", {
              what: "close the terminals and restore the rail preferences",
              fn: async () => {
                  for (const t of ctx.terminals ?? []) {
                      await waveService(h, "workspace", "CloseTab", [ctx.workspaceId, t.tabId, false]).catch(() => {});
                  }
                  await h.ev(restoreStorageKey(RAIL_VISIBLE_KEY, ctx.prevRail));
                  await h.ev(restoreStorageKey(RAIL_SECTIONS_KEY, ctx.prevSections));
              },
          });
      },
  };
  ```
- [ ] **Step 3: Register it**
  In the `SCENARIOS` array, after `canvasTabsScenario,` add `agentRailSections,`.
- [ ] **Step 4: Run the scenarios**
  **Requires `task dev` running** (the user's app, which the scenario reloads and restores):
  `task verify:ui -- agent-rail-sections agent-tree-rail canvas-swap canvas-tabs`
  Expected: PASS table with every step green (a SKIP on `canvas-swap` or `canvas-tabs` means the terminal launch
  failed; on `agent-rail-sections` an `arrangeError` is printed in step 0). Open `cdp-shots/index.html` and look at
  `agent-rail-sections.png` (section order, Uploads closed with `0`, Terminals open) and
  `agent-rail-sections-terminal.png` (the terminals-only rail).
- [ ] **Step 5: Commit**
  ```
  git add scripts/cdp/scenarios.mjs
  git commit -m "test(cdp): agent-rail-sections scenario and the new rail order in agent-tree-rail" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 17: The pure grid model

**Depends on:** Task 16
**Files:**
- Create: `frontend/app/view/agents/agentgrid.ts`
- Test: `frontend/app/view/agents/agentgrid.test.ts`

- [ ] **Step 1: Write the failing test**
  Create `frontend/app/view/agents/agentgrid.test.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0

  import { describe, expect, it } from "vitest";
  import {
      EMPTY_GRID,
      MAX_CELLS,
      addCell,
      collapseToFocused,
      focusAgent,
      gridEquals,
      gridFallbackFocus,
      gridHold,
      normalizeGrid,
      parseGrid,
      placementFor,
      placementStyle,
      pruneMissing,
      reconcileGrid,
      removeCell,
      replaceFocused,
      swapCells,
      visibleCells,
      type GridState,
  } from "./agentgrid";

  // a state whose focused cell defaults to the first
  const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });

  describe("normalizeGrid", () => {
      it("caps the grid at four cells", () => {
          expect(MAX_CELLS).toBe(4);
      });
      it("keeps the order and drops duplicate ids", () => {
          expect(normalizeGrid(g(["a", "b", "a", "c"], "b"))).toEqual(g(["a", "b", "c"], "b"));
      });
      it("keeps at most four cells, counting a duplicate once", () => {
          expect(normalizeGrid(g(["a", "b", "c", "d", "e"])).ids).toEqual(["a", "b", "c", "d"]);
          expect(normalizeGrid(g(["a", "a", "b", "c", "d", "e"])).ids).toEqual(["a", "b", "c", "d"]);
      });
      it("moves focus to the first cell when the focused id is not a cell", () => {
          expect(normalizeGrid({ ids: ["a", "b"], focused: "zz" })).toEqual(g(["a", "b"], "a"));
          expect(normalizeGrid({ ids: ["a", "b"], focused: null })).toEqual(g(["a", "b"], "a"));
      });
      it("has no focus when there are no cells", () => {
          expect(normalizeGrid({ ids: [], focused: "a" })).toEqual(EMPTY_GRID);
      });
      it("drops empty ids", () => {
          expect(normalizeGrid(g(["", "a"], "a"))).toEqual(g(["a"], "a"));
      });
      it("does not mutate its input", () => {
          const s = g(["a", "a", "b"]);
          normalizeGrid(s);
          expect(s.ids).toEqual(["a", "a", "b"]);
      });
  });

  describe("parseGrid", () => {
      it("reads nothing usable as an empty grid", () => {
          for (const raw of [null, undefined, "x", 3, true, [], {}]) {
              expect(parseGrid(raw)).toEqual(EMPTY_GRID);
          }
      });
      it("round-trips a stored grid", () => {
          const s = g(["a", "b", "c"], "b");
          expect(parseGrid(JSON.parse(JSON.stringify(s)))).toEqual(s);
      });
      it("keeps only the string ids and repairs the rest", () => {
          expect(parseGrid({ ids: ["a", 3, null, "b", "a"], focused: 7 })).toEqual(g(["a", "b"], "a"));
      });
      it("reads ids that are not an array as empty", () => {
          expect(parseGrid({ ids: "a", focused: "a" })).toEqual(EMPTY_GRID);
      });
      it("caps a stored list longer than four", () => {
          expect(parseGrid({ ids: ["a", "b", "c", "d", "e"], focused: "e" })).toEqual(g(["a", "b", "c", "d"], "a"));
      });
  });

  describe("gridEquals", () => {
      it("compares ids in order and the focused id", () => {
          expect(gridEquals(g(["a", "b"], "a"), g(["a", "b"], "a"))).toBe(true);
          expect(gridEquals(g(["a", "b"], "a"), g(["b", "a"], "a"))).toBe(false);
          expect(gridEquals(g(["a", "b"], "a"), g(["a", "b"], "b"))).toBe(false);
          expect(gridEquals(g(["a"], "a"), g(["a", "b"], "a"))).toBe(false);
          expect(gridEquals(EMPTY_GRID, g([]))).toBe(true);
      });
  });

  describe("addCell with an agent that is not in the grid", () => {
      it("starts a grid from nothing, whatever the zone", () => {
          expect(addCell(EMPTY_GRID, "a", 0, "right")).toEqual(g(["a"], "a"));
          expect(addCell(EMPTY_GRID, "a", 5, "center")).toEqual(g(["a"], "a"));
      });
      it("centre replaces the cell under the drop, which leaves the grid", () => {
          expect(addCell(g(["a", "b"]), "c", 1, "center")).toEqual(g(["a", "c"], "c"));
      });
      it("left and top insert before the target", () => {
          expect(addCell(g(["a", "b"]), "c", 1, "left")).toEqual(g(["a", "c", "b"], "c"));
          expect(addCell(g(["a", "b"]), "c", 0, "top")).toEqual(g(["c", "a", "b"], "c"));
      });
      it("right and bottom insert after the target", () => {
          expect(addCell(g(["a", "b"]), "c", 0, "right")).toEqual(g(["a", "c", "b"], "c"));
          expect(addCell(g(["a", "b"]), "c", 1, "bottom")).toEqual(g(["a", "b", "c"], "c"));
      });
      it("builds a grid up to four cells and focuses each agent as it lands", () => {
          let s = g(["a"]);
          s = addCell(s, "b", 0, "right");
          expect(s).toEqual(g(["a", "b"], "b"));
          s = addCell(s, "c", 1, "right");
          expect(s).toEqual(g(["a", "b", "c"], "c"));
          s = addCell(s, "d", 2, "right");
          expect(s).toEqual(g(["a", "b", "c", "d"], "d"));
      });
      it("on a full grid an edge zone acts as the centre", () => {
          expect(addCell(g(["a", "b", "c", "d"]), "e", 2, "left")).toEqual(g(["a", "b", "e", "d"], "e"));
          expect(addCell(g(["a", "b", "c", "d"]), "e", 3, "right")).toEqual(g(["a", "b", "c", "e"], "e"));
      });
      it("never grows past four cells", () => {
          let s = g([]);
          for (const id of ["a", "b", "c", "d", "e", "f"]) {
              s = addCell(s, id, 0, "right");
              expect(s.ids.length).toBeLessThanOrEqual(MAX_CELLS);
          }
      });
      it("clamps the target index", () => {
          expect(addCell(g(["a", "b"]), "x", 99, "right").ids).toEqual(["a", "b", "x"]);
          expect(addCell(g(["a", "b"]), "x", -5, "left").ids).toEqual(["x", "a", "b"]);
          expect(addCell(g(["a", "b"]), "x", Number.NaN, "left").ids).toEqual(["x", "a", "b"]);
          expect(addCell(g(["a", "b", "c"]), "x", 1.9, "left").ids).toEqual(["a", "x", "b", "c"]);
      });
      it("ignores an empty id", () => {
          expect(addCell(g(["a"]), "", 0, "right")).toEqual(g(["a"]));
          expect(addCell(EMPTY_GRID, "", 0, "right")).toEqual(EMPTY_GRID);
      });
      it("normalizes a state with duplicates before adding", () => {
          expect(addCell(g(["a", "a"]), "b", 0, "right")).toEqual(g(["a", "b"], "b"));
      });
      it("does not mutate its input", () => {
          const s = g(["a", "b"]);
          const before = JSON.stringify(s);
          addCell(s, "c", 0, "right");
          expect(JSON.stringify(s)).toBe(before);
      });
  });

  describe("addCell with an agent that is already in the grid (a move)", () => {
      it("centre swaps the two cells and focuses the moved agent", () => {
          expect(addCell(g(["a", "b", "c"], "a"), "c", 0, "center")).toEqual(g(["c", "b", "a"], "c"));
      });
      it("dropping an agent on its own cell only focuses it", () => {
          expect(addCell(g(["a", "b", "c"], "a"), "b", 1, "center")).toEqual(g(["a", "b", "c"], "b"));
          expect(addCell(g(["a", "b", "c"], "a"), "b", 1, "left")).toEqual(g(["a", "b", "c"], "b"));
      });
      it("left and top move it before the target", () => {
          expect(addCell(g(["a", "b", "c"]), "a", 2, "left")).toEqual(g(["b", "a", "c"], "a"));
          expect(addCell(g(["a", "b", "c"]), "c", 0, "top")).toEqual(g(["c", "a", "b"], "c"));
      });
      it("right and bottom move it after the target", () => {
          expect(addCell(g(["a", "b", "c"]), "a", 2, "right")).toEqual(g(["b", "c", "a"], "a"));
          expect(addCell(g(["a", "b", "c"]), "c", 0, "bottom")).toEqual(g(["a", "c", "b"], "c"));
      });
      it("moves on a full grid without dropping anyone", () => {
          expect(addCell(g(["a", "b", "c", "d"]), "d", 0, "left")).toEqual(g(["d", "a", "b", "c"], "d"));
          expect(addCell(g(["a", "b", "c", "d"]), "a", 3, "right")).toEqual(g(["b", "c", "d", "a"], "a"));
      });
  });

  describe("swapCells", () => {
      it("swaps two cells by index and leaves focus on the same agent", () => {
          expect(swapCells(g(["a", "b", "c"], "a"), 0, 2)).toEqual(g(["c", "b", "a"], "a"));
      });
      it("does nothing for the same, an out-of-range or a non-integer index", () => {
          const s = g(["a", "b"], "b");
          expect(swapCells(s, 1, 1)).toEqual(s);
          expect(swapCells(s, 0, 2)).toEqual(s);
          expect(swapCells(s, -1, 0)).toEqual(s);
          expect(swapCells(s, 0.5, 1)).toEqual(s);
          expect(swapCells(s, Number.NaN, 1)).toEqual(s);
      });
      it("does not mutate its input", () => {
          const s = g(["a", "b"]);
          swapCells(s, 0, 1);
          expect(s.ids).toEqual(["a", "b"]);
      });
  });

  describe("removeCell", () => {
      it("removes a cell that is not focused and keeps focus", () => {
          expect(removeCell(g(["a", "b", "c"], "a"), "b")).toEqual(g(["a", "c"], "a"));
      });
      it("focus moves to the cell that takes the removed one's place", () => {
          expect(removeCell(g(["a", "b", "c"], "b"), "b")).toEqual(g(["a", "c"], "c"));
          expect(removeCell(g(["a", "b"], "a"), "a")).toEqual(g(["b"], "b"));
      });
      it("focus moves to the previous cell when the last one is removed", () => {
          expect(removeCell(g(["a", "b", "c"], "c"), "c")).toEqual(g(["a", "b"], "b"));
      });
      it("removing the only cell leaves an empty grid", () => {
          expect(removeCell(g(["a"]), "a")).toEqual(EMPTY_GRID);
      });
      it("an id that is not a cell changes nothing", () => {
          expect(removeCell(g(["a", "b"], "b"), "z")).toEqual(g(["a", "b"], "b"));
      });
  });

  describe("replaceFocused", () => {
      it("starts a grid from nothing", () => {
          expect(replaceFocused(EMPTY_GRID, "x")).toEqual(g(["x"], "x"));
      });
      it("replaces the focused cell in place", () => {
          expect(replaceFocused(g(["a", "b", "c"], "b"), "d")).toEqual(g(["a", "d", "c"], "d"));
      });
      it("is a no-op for the agent already focused", () => {
          expect(replaceFocused(g(["a", "b"], "b"), "b")).toEqual(g(["a", "b"], "b"));
      });
      it("never duplicates: an agent in another cell trades places with the focused one", () => {
          expect(replaceFocused(g(["a", "b", "c"], "a"), "c")).toEqual(g(["c", "b", "a"], "c"));
      });
      it("keeps a full grid at four", () => {
          expect(replaceFocused(g(["a", "b", "c", "d"], "d"), "e").ids).toEqual(["a", "b", "c", "e"]);
      });
      it("ignores an empty id", () => {
          expect(replaceFocused(g(["a"]), "")).toEqual(g(["a"]));
      });
  });

  describe("focusAgent (the one rule: its cell, else the focused cell)", () => {
      it("focuses the cell of an agent that is in the grid and leaves the list alone", () => {
          expect(focusAgent(g(["a", "b"], "a"), "b")).toEqual(g(["a", "b"], "b"));
      });
      it("is a no-op for the agent already focused", () => {
          expect(focusAgent(g(["a", "b"], "b"), "b")).toEqual(g(["a", "b"], "b"));
      });
      it("replaces the focused cell with an agent that is not in the grid", () => {
          expect(focusAgent(g(["a", "b"], "a"), "c")).toEqual(g(["c", "b"], "c"));
      });
      it("starts a grid from nothing", () => {
          expect(focusAgent(EMPTY_GRID, "c")).toEqual(g(["c"], "c"));
      });
      it("ignores an empty id", () => {
          expect(focusAgent(g(["a", "b"], "b"), "")).toEqual(g(["a", "b"], "b"));
      });
      it("browsing through the roster keeps rewriting only the focused cell", () => {
          let s = g(["a", "b"], "a");
          s = focusAgent(s, "c");
          expect(s).toEqual(g(["c", "b"], "c"));
          s = focusAgent(s, "d");
          expect(s).toEqual(g(["d", "b"], "d"));
          s = focusAgent(s, "b");
          expect(s).toEqual(g(["d", "b"], "b"));
          s = focusAgent(s, "e");
          expect(s).toEqual(g(["d", "e"], "e"));
      });
  });

  describe("pruneMissing", () => {
      it("drops agents that are not live, keeping the order", () => {
          expect(pruneMissing(g(["a", "b", "c"], "a"), new Set(["a", "c"]))).toEqual(g(["a", "c"], "a"));
      });
      it("accepts any iterable of live ids", () => {
          expect(pruneMissing(g(["a", "b"]), ["b"])).toEqual(g(["b"], "b"));
      });
      it("a focused cell that left hands focus to the next surviving cell", () => {
          expect(pruneMissing(g(["a", "b", "c", "d"], "b"), new Set(["a", "c", "d"]))).toEqual(
              g(["a", "c", "d"], "c")
          );
          expect(pruneMissing(g(["a", "b", "c", "d"], "b"), new Set(["a", "d"]))).toEqual(g(["a", "d"], "d"));
      });
      it("falls back to the last survivor when none is after the focused one", () => {
          expect(pruneMissing(g(["a", "b", "c"], "c"), new Set(["a", "b"]))).toEqual(g(["a", "b"], "b"));
      });
      it("empties the grid when nothing survives", () => {
          expect(pruneMissing(g(["a", "b"]), new Set())).toEqual(EMPTY_GRID);
      });
      it("changes nothing when everything is live", () => {
          expect(pruneMissing(g(["a", "b"], "b"), new Set(["a", "b", "z"]))).toEqual(g(["a", "b"], "b"));
      });
      it("normalizes first", () => {
          expect(pruneMissing(g(["a", "a", "b"]), new Set(["a", "b"]))).toEqual(g(["a", "b"], "a"));
      });
  });

  describe("collapseToFocused", () => {
      it("keeps only the focused cell", () => {
          expect(collapseToFocused(g(["a", "b", "c"], "b"))).toEqual(g(["b"], "b"));
      });
      it("leaves an empty grid and a single cell as they are", () => {
          expect(collapseToFocused(EMPTY_GRID)).toEqual(EMPTY_GRID);
          expect(collapseToFocused(g(["a"]))).toEqual(g(["a"]));
      });
  });

  describe("placementFor", () => {
      it("1 fills the area", () => {
          expect(placementFor(1)).toEqual([{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }]);
      });
      it("2 sit side by side", () => {
          expect(placementFor(2)).toEqual([
              { row: 1, col: 1, rowSpan: 2, colSpan: 1 },
              { row: 1, col: 2, rowSpan: 2, colSpan: 1 },
          ]);
      });
      it("3 are two on top and one spanning the bottom", () => {
          expect(placementFor(3)).toEqual([
              { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
              { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
              { row: 2, col: 1, rowSpan: 1, colSpan: 2 },
          ]);
      });
      it("4 are 2x2", () => {
          expect(placementFor(4)).toEqual([
              { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
              { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
              { row: 2, col: 1, rowSpan: 1, colSpan: 1 },
              { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
          ]);
      });
      it("has nothing for zero, a negative or a non-number", () => {
          expect(placementFor(0)).toEqual([]);
          expect(placementFor(-3)).toEqual([]);
          expect(placementFor(Number.NaN)).toEqual([]);
      });
      it("clamps to four and truncates a fraction", () => {
          expect(placementFor(7)).toEqual(placementFor(4));
          expect(placementFor(2.9)).toEqual(placementFor(2));
      });
      it("every shape covers the 2x2 exactly once", () => {
          for (const n of [1, 2, 3, 4]) {
              const covered: number[][] = [
                  [0, 0],
                  [0, 0],
              ];
              for (const p of placementFor(n)) {
                  for (let r = p.row - 1; r < p.row - 1 + p.rowSpan; r++) {
                      for (let c = p.col - 1; c < p.col - 1 + p.colSpan; c++) {
                          covered[r][c]++;
                      }
                  }
              }
              expect(covered).toEqual([
                  [1, 1],
                  [1, 1],
              ]);
          }
      });
      it("returns fresh objects each call", () => {
          placementFor(1)[0].row = 9;
          expect(placementFor(1)[0].row).toBe(1);
      });
  });

  describe("placementStyle", () => {
      it("turns a placement into the grid-row and grid-column values", () => {
          expect(placementStyle({ row: 2, col: 1, rowSpan: 1, colSpan: 2 })).toEqual({
              gridRow: "2 / span 1",
              gridColumn: "1 / span 2",
          });
      });
  });

  describe("visibleCells", () => {
      it("is empty while nothing is in focus", () => {
          expect(visibleCells(g(["a", "b"]), { focusId: undefined, collapsed: false })).toEqual([]);
      });
      it("lays the grid out by count and flags the focused cell", () => {
          const cells = visibleCells(g(["a", "b", "c", "d"], "a"), { focusId: "c", collapsed: false });
          expect(cells.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
          expect(cells.map((c) => c.placement)).toEqual(placementFor(4));
          expect(cells.map((c) => c.focused)).toEqual([false, false, true, false]);
      });
      it("uses the three-cell shape for three agents", () => {
          const cells = visibleCells(g(["a", "b", "c"], "c"), { focusId: "c", collapsed: false });
          expect(cells.map((c) => c.placement)).toEqual(placementFor(3));
      });
      it("collapses to the focused cell, filling the area", () => {
          expect(visibleCells(g(["a", "b"]), { focusId: "b", collapsed: true })).toEqual([
              { id: "b", placement: { row: 1, col: 1, rowSpan: 2, colSpan: 2 }, focused: true },
          ]);
      });
      it("shows an agent that is not in the grid alone", () => {
          expect(visibleCells(g(["a", "b"]), { focusId: "term", collapsed: false })).toEqual([
              { id: "term", placement: placementFor(1)[0], focused: true },
          ]);
      });
      it("follows the id in focus, not the stored focused cell", () => {
          const cells = visibleCells(g(["a", "b"], "a"), { focusId: "b", collapsed: false });
          expect(cells.map((c) => c.focused)).toEqual([false, true]);
      });
  });

  describe("reconcileGrid", () => {
      const live = (...ids: string[]) => new Set(ids);

      it("leaves the saved grid alone until the roster has been read", () => {
          expect(reconcileGrid(g(["a", "b"], "b"), { focusId: "z", eligible: live(), seeded: false })).toEqual(
              g(["a", "b"], "b")
          );
      });
      it("prunes agents that are no longer live", () => {
          expect(
              reconcileGrid(g(["a", "b", "c"], "a"), { focusId: "a", eligible: live("a", "c"), seeded: true })
          ).toEqual(g(["a", "c"], "a"));
      });
      it("focuses the cell of a focused agent that is already in the grid", () => {
          expect(
              reconcileGrid(g(["a", "b"], "a"), { focusId: "b", eligible: live("a", "b"), seeded: true })
          ).toEqual(g(["a", "b"], "b"));
      });
      it("replaces the focused cell with a focused agent that is not in the grid", () => {
          expect(
              reconcileGrid(g(["a", "b"], "a"), { focusId: "c", eligible: live("a", "b", "c"), seeded: true })
          ).toEqual(g(["c", "b"], "c"));
      });
      it("ignores a focus that is not a live agent (a terminal, a done worker)", () => {
          expect(
              reconcileGrid(g(["a", "b"], "a"), { focusId: "term", eligible: live("a", "b"), seeded: true })
          ).toEqual(g(["a", "b"], "a"));
      });
      it("only prunes when nothing is in focus", () => {
          expect(
              reconcileGrid(g(["a", "b", "c"], "b"), { focusId: undefined, eligible: live("a", "c"), seeded: true })
          ).toEqual(g(["a", "c"], "c"));
      });
      it("starts a one-cell grid from a focused live agent", () => {
          expect(reconcileGrid(EMPTY_GRID, { focusId: "a", eligible: live("a"), seeded: true })).toEqual(g(["a"], "a"));
      });
      it("is idempotent", () => {
          const cases: [GridState, string | undefined, string[], boolean][] = [
              [g(["a", "b", "c"], "b"), "d", ["a", "b", "c", "d"], true],
              [g(["a", "b", "c", "d"], "a"), "e", ["a", "b", "c", "d", "e"], true],
              [g(["a", "x", "b"], "x"), undefined, ["a", "b"], true],
              [g(["a", "b"], "a"), "term", ["a", "b"], true],
              [g(["a", "b"], "a"), "c", [], false],
              [EMPTY_GRID, "a", ["a"], true],
          ];
          for (const [state, focusId, ids, seeded] of cases) {
              const input = { focusId, eligible: new Set(ids), seeded };
              const once = reconcileGrid(state, input);
              expect(reconcileGrid(once, input)).toEqual(once);
          }
      });
  });

  describe("gridFallbackFocus", () => {
      const live = (...ids: string[]) => new Set(ids);

      it("prefers the grid's focused cell", () => {
          expect(gridFallbackFocus(g(["a", "b"], "b"), live("a", "b"))).toBe("b");
      });
      it("falls to the first live cell when the focused one is not live", () => {
          expect(gridFallbackFocus(g(["a", "b", "c"], "b"), live("a", "c"))).toBe("a");
      });
      it("has nothing when no cell is live or the grid is empty", () => {
          expect(gridFallbackFocus(g(["a", "b"]), live("z"))).toBeUndefined();
          expect(gridFallbackFocus(EMPTY_GRID, live("a"))).toBeUndefined();
      });
  });

  describe("gridHold", () => {
      it("holds while the roster loads and none of the saved agents has arrived", () => {
          expect(gridHold(g(["a", "b"]), new Set(["z"]), false)).toBe(true);
          expect(gridHold(g(["a", "b"]), new Set(), false)).toBe(true);
      });
      it("lets go as soon as one saved agent is live", () => {
          expect(gridHold(g(["a", "b"]), new Set(["b"]), false)).toBe(false);
      });
      it("never holds once the roster has been read", () => {
          expect(gridHold(g(["a", "b"]), new Set(), true)).toBe(false);
      });
      it("never holds an empty grid", () => {
          expect(gridHold(EMPTY_GRID, new Set(), false)).toBe(false);
      });
  });
  ```
- [ ] **Step 2: Run it and watch it fail**
  `npx vitest run frontend/app/view/agents/agentgrid.test.ts`
  Expected: FAIL, `Failed to resolve import "./agentgrid"` (the module does not exist yet).
- [ ] **Step 3: Implement the model**
  Create `frontend/app/view/agents/agentgrid.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The Agent surface's terminal grid as pure data: which live agents hold the (at most four) cells, in order,
  // and which cell is focused. No React and no atoms: gridstore.ts persists it, agentsurface.tsx draws it, and
  // every rule that drag and drop, the sidebar and the keyboard share lives here so it can be tested.
  //
  // The shape depends only on how many cells there are (placementFor): 1 fills the area, 2 sit side by side,
  // 3 are two on top and one spanning the bottom, 4 are 2x2. A cell has no place of its own, only a position in
  // the list, so adding, removing or swapping one never needs a geometry rule.
  //
  // Every function returns a normalized state (normalizeGrid): ids are unique, non-empty and at most MAX_CELLS,
  // and `focused` is one of them, or null exactly when there are none. So a stale or hand-edited stored value
  // cannot break a caller. Nothing here mutates its input.

  export const MAX_CELLS = 4;

  export type DropZone = "center" | "left" | "right" | "top" | "bottom";

  export interface GridState {
      ids: string[];
      focused: string | null;
  }

  export const EMPTY_GRID: GridState = { ids: [], focused: null };

  export function normalizeGrid(state: GridState): GridState {
      const ids: string[] = [];
      for (const id of state.ids) {
          if (typeof id === "string" && id !== "" && !ids.includes(id) && ids.length < MAX_CELLS) {
              ids.push(id);
          }
      }
      const focused = state.focused != null && ids.includes(state.focused) ? state.focused : (ids[0] ?? null);
      return { ids, focused };
  }

  // What localStorage hands back: anything. Only string ids survive.
  export function parseGrid(raw: unknown): GridState {
      if (raw == null || typeof raw !== "object") {
          return { ids: [], focused: null };
      }
      const r = raw as { ids?: unknown; focused?: unknown };
      const ids = Array.isArray(r.ids) ? r.ids.filter((x): x is string => typeof x === "string") : [];
      return normalizeGrid({ ids, focused: typeof r.focused === "string" ? r.focused : null });
  }

  export function gridEquals(a: GridState, b: GridState): boolean {
      return a.focused === b.focused && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);
  }

  // Who is focused once some cells have left: the focused cell if it stayed, else the nearest survivor at or
  // after its old position (the cell that slid into its slot), else the last one.
  function refocus(oldIds: readonly string[], focused: string | null, kept: readonly string[]): string | null {
      if (kept.length === 0) {
          return null;
      }
      if (focused != null && kept.includes(focused)) {
          return focused;
      }
      const from = focused == null ? 0 : Math.max(0, oldIds.indexOf(focused));
      for (let i = from; i < oldIds.length; i++) {
          if (kept.includes(oldIds[i])) {
              return oldIds[i];
          }
      }
      return kept[kept.length - 1];
  }

  function clampIndex(i: number, length: number): number {
      return Number.isFinite(i) ? Math.min(length - 1, Math.max(0, Math.trunc(i))) : 0;
  }

  // Swaps two cells by index. Focus stays on the same agent, wherever it lands.
  export function swapCells(state: GridState, a: number, b: number): GridState {
      const s = normalizeGrid(state);
      const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < s.ids.length;
      if (!valid(a) || !valid(b) || a === b) {
          return s;
      }
      const ids = [...s.ids];
      [ids[a], ids[b]] = [ids[b], ids[a]];
      return { ids, focused: s.focused };
  }

  // Drops a cell from the grid (the agent keeps running; it just has no cell).
  export function removeCell(state: GridState, id: string): GridState {
      const s = normalizeGrid(state);
      if (!s.ids.includes(id)) {
          return s;
      }
      const kept = s.ids.filter((x) => x !== id);
      return { ids: kept, focused: refocus(s.ids, s.focused, kept) };
  }

  // Drops every cell whose agent is not live any more.
  export function pruneMissing(state: GridState, existing: Iterable<string>): GridState {
      const s = normalizeGrid(state);
      const live = new Set(existing);
      const kept = s.ids.filter((id) => live.has(id));
      return { ids: kept, focused: refocus(s.ids, s.focused, kept) };
  }

  // Puts `id` in the focused cell. An agent that is already another cell trades places with the focused one, so
  // the list never holds it twice.
  export function replaceFocused(state: GridState, id: string): GridState {
      const s = normalizeGrid(state);
      if (id === "") {
          return s;
      }
      if (s.focused == null) {
          return { ids: [id], focused: id };
      }
      if (s.focused === id) {
          return s;
      }
      const ids = [...s.ids];
      const focusedAt = ids.indexOf(s.focused);
      const at = ids.indexOf(id);
      if (at >= 0) {
          ids[at] = s.focused;
      }
      ids[focusedAt] = id;
      return { ids, focused: id };
  }

  // The one rule for "this agent was selected" (a sidebar click, Ctrl+Tab, an arrow, the palette): if it already
  // has a cell, focus that cell; otherwise it replaces the focused cell and the other cells stay put.
  export function focusAgent(state: GridState, id: string): GridState {
      const s = normalizeGrid(state);
      if (id === "") {
          return s;
      }
      if (s.ids.includes(id)) {
          return s.focused === id ? s : { ids: s.ids, focused: id };
      }
      return replaceFocused(s, id);
  }

  // An agent already in the grid is moved: centre swaps it with the target, an edge zone puts it before (left, top)
  // or after (right, bottom) the target. `t` is the target's index in the list as it was.
  function moveCell(s: GridState, id: string, t: number, zone: DropZone): GridState {
      const from = s.ids.indexOf(id);
      if (from === t) {
          return { ids: s.ids, focused: id };
      }
      if (zone === "center") {
          return { ids: swapCells(s, from, t).ids, focused: id };
      }
      const target = s.ids[t];
      const rest = s.ids.filter((x) => x !== id);
      const at = rest.indexOf(target) + (zone === "left" || zone === "top" ? 0 : 1);
      const ids = [...rest];
      ids.splice(at, 0, id);
      return { ids, focused: id };
  }

  // A drop of `id` on the cell at `targetIndex`. A new agent: centre replaces the target (which leaves the grid),
  // left/top insert before it, right/bottom after it; on a full grid there is no room, so an edge acts as the
  // centre. An agent already in the grid is moved (moveCell). The dropped agent becomes the focused cell.
  export function addCell(state: GridState, id: string, targetIndex: number, zone: DropZone): GridState {
      const s = normalizeGrid(state);
      if (id === "") {
          return s;
      }
      if (s.ids.length === 0) {
          return { ids: [id], focused: id };
      }
      const t = clampIndex(targetIndex, s.ids.length);
      if (s.ids.includes(id)) {
          return moveCell(s, id, t, zone);
      }
      const ids = [...s.ids];
      if (zone === "center" || ids.length >= MAX_CELLS) {
          ids[t] = id;
      } else {
          ids.splice(zone === "left" || zone === "top" ? t : t + 1, 0, id);
      }
      return { ids, focused: id };
  }

  // The grid as one cell: fullscreen, History and the other modes that show a single thing.
  export function collapseToFocused(state: GridState): GridState {
      const s = normalizeGrid(state);
      return s.focused == null ? s : { ids: [s.focused], focused: s.focused };
  }

  // A cell's place in the fixed 2x2 template; rows and columns count from 1, spans from 1.
  export interface CellPlacement {
      row: number;
      col: number;
      rowSpan: number;
      colSpan: number;
  }

  const PLACEMENTS: readonly (readonly CellPlacement[])[] = [
      [],
      [{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }],
      [
          { row: 1, col: 1, rowSpan: 2, colSpan: 1 },
          { row: 1, col: 2, rowSpan: 2, colSpan: 1 },
      ],
      [
          { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
          { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
          { row: 2, col: 1, rowSpan: 1, colSpan: 2 },
      ],
      [
          { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
          { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
          { row: 2, col: 1, rowSpan: 1, colSpan: 1 },
          { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
      ],
  ];

  // The placement of each cell for a grid of `count` cells, in order. Clamped to 0..4.
  export function placementFor(count: number): CellPlacement[] {
      const n = Number.isFinite(count) ? Math.min(MAX_CELLS, Math.max(0, Math.trunc(count))) : 0;
      return PLACEMENTS[n].map((p) => ({ ...p }));
  }

  // The inline style a cell carries: gridRow/gridColumn with spans, over a template that never changes.
  export function placementStyle(p: CellPlacement): { gridRow: string; gridColumn: string } {
      return { gridRow: `${p.row} / span ${p.rowSpan}`, gridColumn: `${p.col} / span ${p.colSpan}` };
  }

  export interface GridCell {
      id: string;
      placement: CellPlacement;
      focused: boolean;
  }

  // The cells on screen. `focusId` is the agent actually shown (it may be a terminal or something else that is
  // not a cell, which is then shown alone and leaves the saved grid untouched). `collapsed` shows only the focused
  // one, filling the area (fullscreen). No focus, no cells.
  export function visibleCells(state: GridState, opts: { focusId: string | undefined; collapsed: boolean }): GridCell[] {
      if (opts.focusId == null) {
          return [];
      }
      const s = normalizeGrid(state);
      const shown: GridState = s.ids.includes(opts.focusId)
          ? { ids: s.ids, focused: opts.focusId }
          : { ids: [opts.focusId], focused: opts.focusId };
      const cells = opts.collapsed ? collapseToFocused(shown) : shown;
      const spots = placementFor(cells.ids.length);
      return cells.ids.map((id, i) => ({ id, placement: spots[i], focused: id === cells.focused }));
  }

  export interface ReconcileInput {
      focusId: string | undefined; // what the surface shows: model.focusIdAtom after its own defaulting
      eligible: ReadonlySet<string>; // live agents that have a terminal
      seeded: boolean; // the roster has been read once (rosterSeededAtom)
  }

  // The saved grid brought up to date with the roster and the focus. Until the roster has been read nothing is
  // pruned and the focus rule is not applied: a half-loaded roster would otherwise throw away a saved layout.
  // Pure and idempotent, so the surface can compute it every render and write it back only when it differs.
  export function reconcileGrid(state: GridState, input: ReconcileInput): GridState {
      const s = normalizeGrid(state);
      if (!input.seeded) {
          return s;
      }
      const pruned = pruneMissing(s, input.eligible);
      return input.focusId != null && input.eligible.has(input.focusId) ? focusAgent(pruned, input.focusId) : pruned;
  }

  // Where focus resumes when nothing is explicitly in focus (a launch, a focused agent that just exited): the
  // grid's focused cell if it is live, else the first live cell.
  export function gridFallbackFocus(state: GridState, eligible: ReadonlySet<string>): string | undefined {
      const s = normalizeGrid(state);
      const order = s.focused == null ? s.ids : [s.focused, ...s.ids.filter((id) => id !== s.focused)];
      return order.find((id) => eligible.has(id));
  }

  // True while the roster is still loading and none of the saved cells has arrived: resuming on the roster's
  // first agent now would have the focus rule swap it into a saved cell once the roster is complete.
  export function gridHold(state: GridState, eligible: ReadonlySet<string>, seeded: boolean): boolean {
      const s = normalizeGrid(state);
      return !seeded && s.ids.length > 0 && !s.ids.some((id) => eligible.has(id));
  }
  ```
- [ ] **Step 4: Run it and watch it pass**
  `npx vitest run frontend/app/view/agents/agentgrid.test.ts`
  Expected: PASS, every `describe` above green.
- [ ] **Step 5: Commit**
  ```
  git add frontend/app/view/agents/agentgrid.ts frontend/app/view/agents/agentgrid.test.ts
  git commit -m "feat(agent): pure model for the terminal grid" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 18: The persisted grid atom and the focus-synced operations

**Depends on:** Task 17
**Files:**
- Create: `frontend/app/view/agents/gridstore.ts`
- Test: `frontend/app/view/agents/gridstore.test.ts`

Convention followed: `railstore.ts` / `projectfoldstore.ts` (`atomWithStorage`, key `agent.*`, the logic in a pure
module with its test), plus `getOnInit: true` as `focusstore.ts` does, so the saved grid is there on the first
render and the surface never flashes a one-cell grid before the stored one lands. The stored value is read through
`parseGrid`, so garbage in localStorage cannot reach the surface. Pruning against the live roster is
`reconcileGrid`'s job (run by the surface); the operations here prune through it too, so they never act on a
stale list.

- [ ] **Step 1: Write the failing test**
  Create `frontend/app/view/agents/gridstore.test.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0

  import { globalStore } from "@/app/store/jotaiStore";
  import { atom } from "jotai";
  import { beforeEach, describe, expect, it } from "vitest";
  import { EMPTY_GRID, type GridState } from "./agentgrid";
  import {
      agentGridAtom,
      canOpenInSplit,
      currentGrid,
      dropAgentOnGrid,
      openInSplit,
      removeFromGrid,
      type GridModel,
  } from "./gridstore";

  const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });

  // a roster of live agents, each with a terminal, and the surface's focus
  function model(ids: string[], focus?: string): GridModel {
      return {
          focusIdAtom: atom<string | undefined>(focus),
          agentsAtom: atom(ids.map((id) => ({ id, blockId: `blk-${id}` }))),
      };
  }

  beforeEach(() => {
      globalStore.set(agentGridAtom, EMPTY_GRID);
  });

  describe("currentGrid", () => {
      it("drops agents that are not live and keeps the rest in order", () => {
          globalStore.set(agentGridAtom, g(["a", "b", "c"]));
          expect(currentGrid(model(["a", "c"], "a"))).toEqual(g(["a", "c"], "a"));
      });
      it("does not count an agent with no terminal", () => {
          const m: GridModel = {
              focusIdAtom: atom<string | undefined>("a"),
              agentsAtom: atom([{ id: "a", blockId: "blk-a" }, { id: "p" }]),
          };
          globalStore.set(agentGridAtom, g(["a", "p"]));
          expect(currentGrid(m).ids).toEqual(["a"]);
      });
      it("puts the focused live agent in the grid even when the stored one is empty", () => {
          expect(currentGrid(model(["a", "b"], "b"))).toEqual(g(["b"], "b"));
      });
  });

  describe("dropAgentOnGrid", () => {
      it("adds a cell, focuses it and moves the surface's focus to it", () => {
          const m = model(["a", "b"], "a");
          globalStore.set(agentGridAtom, g(["a"]));
          dropAgentOnGrid(m, "b", 0, "right");
          expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "b"));
          expect(globalStore.get(m.focusIdAtom)).toBe("b");
      });
      it("starts from the agent on screen when the stored grid is empty", () => {
          const m = model(["a", "b"], "a");
          dropAgentOnGrid(m, "b", 0, "right");
          expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "b"));
      });
      it("swaps two cells and focuses the dragged one", () => {
          const m = model(["a", "b", "c"], "a");
          globalStore.set(agentGridAtom, g(["a", "b", "c"], "a"));
          dropAgentOnGrid(m, "c", 0, "center");
          expect(globalStore.get(agentGridAtom)).toEqual(g(["c", "b", "a"], "c"));
          expect(globalStore.get(m.focusIdAtom)).toBe("c");
      });
      it("ignores an agent that is not live", () => {
          const m = model(["a"], "a");
          globalStore.set(agentGridAtom, g(["a"]));
          dropAgentOnGrid(m, "ghost", 0, "right");
          expect(globalStore.get(agentGridAtom)).toEqual(g(["a"]));
          expect(globalStore.get(m.focusIdAtom)).toBe("a");
      });
  });

  describe("removeFromGrid", () => {
      it("hands focus, in the grid and on the surface, to the cell that takes the slot", () => {
          const m = model(["a", "b", "c"], "b");
          globalStore.set(agentGridAtom, g(["a", "b", "c"], "b"));
          removeFromGrid(m, "b");
          expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "c"], "c"));
          expect(globalStore.get(m.focusIdAtom)).toBe("c");
      });
      it("keeps focus where it was when another cell goes", () => {
          const m = model(["a", "b", "c"], "a");
          globalStore.set(agentGridAtom, g(["a", "b", "c"], "a"));
          removeFromGrid(m, "c");
          expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "a"));
          expect(globalStore.get(m.focusIdAtom)).toBe("a");
      });
  });

  describe("openInSplit", () => {
      it("adds the agent beside the focused cell and focuses it", () => {
          const m = model(["a", "b"], "a");
          globalStore.set(agentGridAtom, g(["a"]));
          expect(openInSplit(m, "b")).toBe(true);
          expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "b"));
          expect(globalStore.get(m.focusIdAtom)).toBe("b");
      });
      it("starts from the agent on screen when the stored grid is empty", () => {
          const m = model(["a", "b"], "a");
          expect(openInSplit(m, "b")).toBe(true);
          expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "b"));
      });
      it("inserts right after the focused cell", () => {
          const m = model(["a", "b", "c", "d"], "b");
          globalStore.set(agentGridAtom, g(["a", "b", "c"], "b"));
          expect(openInSplit(m, "d")).toBe(true);
          expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b", "d", "c"], "d"));
      });
      it("does nothing for an agent that already has a cell, on a full grid, or for a ghost", () => {
          const m = model(["a", "b", "c", "d", "e"], "a");
          globalStore.set(agentGridAtom, g(["a", "b", "c", "d"], "a"));
          expect(openInSplit(m, "e")).toBe(false);
          expect(openInSplit(m, "b")).toBe(false);
          expect(openInSplit(m, "ghost")).toBe(false);
          expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b", "c", "d"], "a"));
      });
  });

  describe("canOpenInSplit", () => {
      it("is true for a live agent with no cell and room in the grid", () => {
          const m = model(["a", "b"], "a");
          globalStore.set(agentGridAtom, g(["a"]));
          expect(canOpenInSplit(m, "b")).toBe(true);
      });
      it("is false for an agent that is a cell, a ghost, or when the grid is full", () => {
          const m = model(["a", "b", "c", "d", "e"], "a");
          globalStore.set(agentGridAtom, g(["a", "b", "c", "d"], "a"));
          expect(canOpenInSplit(m, "a")).toBe(false);
          expect(canOpenInSplit(m, "e")).toBe(false);
          expect(canOpenInSplit(m, "ghost")).toBe(false);
      });
  });
  ```
- [ ] **Step 2: Run it and watch it fail**
  `npx vitest run frontend/app/view/agents/gridstore.test.ts`
  Expected: FAIL, `Failed to resolve import "./gridstore"`.
- [ ] **Step 3: Implement the store**
  Create `frontend/app/view/agents/gridstore.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The Agent surface's grid, persisted (localStorage "agent.grid", the atomWithStorage convention of
  // railstore.ts and projectfoldstore.ts), and the operations the drop overlay, the cell bars and the menus
  // run. The rules are in agentgrid.ts; this file only reads and writes atoms.
  //
  // getOnInit is load-bearing, as in focusstore.ts: without it the stored value arrives one render after the
  // first read and the surface would paint, and reconcile against, an empty grid first.

  import { globalStore } from "@/app/store/jotaiStore";
  import { atom, type Atom, type PrimitiveAtom } from "jotai";
  import { atomWithStorage } from "jotai/utils";
  import {
      addCell,
      EMPTY_GRID,
      MAX_CELLS,
      parseGrid,
      reconcileGrid,
      removeCell,
      type DropZone,
      type GridState,
  } from "./agentgrid";

  const storedGridAtom = atomWithStorage<unknown>("agent.grid", EMPTY_GRID, undefined, { getOnInit: true });

  // Read through parseGrid so whatever is in storage (a hand edit, an older shape) is repaired, not trusted.
  export const agentGridAtom = atom(
      (get) => parseGrid(get(storedGridAtom)),
      (_get, set, next: GridState) => set(storedGridAtom, next)
  );

  // What the operations need of AgentsViewModel; spelled out so they can be tested without one.
  export interface GridModel {
      focusIdAtom: PrimitiveAtom<string | undefined>;
      agentsAtom: Atom<ReadonlyArray<{ id: string; blockId?: string }>>;
  }

  // Live agents with a terminal: the only agents that can be cells.
  function liveIds(model: GridModel): Set<string> {
      return new Set(
          globalStore
              .get(model.agentsAtom)
              .filter((a) => a.blockId != null)
              .map((a) => a.id)
      );
  }

  // The grid as the surface would show it right now: the stored one pruned against the live roster, with the
  // agent in focus applied. Operations start from this, never from the raw stored value.
  export function currentGrid(model: GridModel): GridState {
      return reconcileGrid(globalStore.get(agentGridAtom), {
          focusId: globalStore.get(model.focusIdAtom),
          eligible: liveIds(model),
          seeded: true,
      });
  }

  // Focus first, then the grid: until focusIdAtom names the new focused cell, the surface would read the old
  // focused agent as "not in the grid" and put it back in a cell.
  function commit(model: GridModel, next: GridState): void {
      if (next.focused != null) {
          globalStore.set(model.focusIdAtom, next.focused);
      }
      globalStore.set(agentGridAtom, next);
  }

  // A drop on the cell at `targetIndex` of the current grid (drop overlay). The dropped agent is focused.
  export function dropAgentOnGrid(model: GridModel, id: string, targetIndex: number, zone: DropZone): void {
      if (!liveIds(model).has(id)) {
          return;
      }
      commit(model, addCell(currentGrid(model), id, targetIndex, zone));
  }

  // The x on a cell's bar: the agent keeps running, it just has no cell.
  export function removeFromGrid(model: GridModel, id: string): void {
      commit(model, removeCell(currentGrid(model), id));
  }

  export function canOpenInSplit(model: GridModel, id: string): boolean {
      if (!liveIds(model).has(id)) {
          return false;
      }
      const s = currentGrid(model);
      return !s.ids.includes(id) && s.ids.length < MAX_CELLS;
  }

  // "Open in split": the agent becomes a new cell right after the focused one. False when it cannot (it already
  // has a cell, the grid is full, it is not live); the caller then falls back to plain focus.
  export function openInSplit(model: GridModel, id: string): boolean {
      if (!canOpenInSplit(model, id)) {
          return false;
      }
      const s = currentGrid(model);
      const at = s.focused == null ? 0 : s.ids.indexOf(s.focused);
      commit(model, addCell(s, id, at, "right"));
      return true;
  }
  ```
- [ ] **Step 4: Run it and watch it pass**
  `npx vitest run frontend/app/view/agents/gridstore.test.ts`
  Expected: PASS. (No `localStorage` exists under vitest's node environment; jotai's default storage falls back to the
  in-memory initial value, as it already does for `projectfoldstore.ts`.)
- [ ] **Step 5: Also re-run the model test**
  `npx vitest run frontend/app/view/agents/agentgrid.test.ts`
  Expected: PASS (unchanged).
- [ ] **Step 6: Commit**
  ```
  git add frontend/app/view/agents/gridstore.ts frontend/app/view/agents/gridstore.test.ts
  git commit -m "feat(agent): persisted grid atom and focus-synced grid operations" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 19: Render the terminal stack as a grid

**Depends on:** Task 17, Task 18
**Files:**
- Create: `frontend/app/view/agents/gridcellbar.tsx`
- Modify: `frontend/app/view/agents/agentsurface.tsx` (`AgentSurface`: imports, the `mountable`/`agent` block, a reconcile effect after the focus-sync effect, the `!agent` return, the terminal stack JSX)

DOM hooks this task defines (Task 20 to Task 22 and the CDP scenario rely on them; the existing
`[data-agent-terminal]`, `[data-agent-tree]`, `[data-agent-header]` and `aside[aria-label="Agent details"]` stay):

| Hook | Where |
|---|---|
| `[data-agent-grid]`, `data-agent-grid-count="<visible cells>"` | the grid parent; `hidden` when no pane is shown |
| `[data-agent-terminal="<id>"]` | the pane wrapper (unchanged key and attribute); now the grid item; `hidden` when not a visible cell |
| `data-agent-cell="<index>"` | on a visible pane wrapper |
| `data-agent-focused="true"` | on the focused wrapper, only while more than one cell shows |
| `[data-agent-cell-bar="<id>"]`, `[data-agent-cell-remove="<id>"]` | the slim bar and its x, only while more than one cell shows |

> NOTE (Stage 1 coupling): HEAD's `AgentSurface` has no `centerMode`. Stage 1 added `centerModeAtom`
> (`agentcenter.ts`, `"terminal" | "session" | "history"`) and changed how the terminal stack is hidden in
> `session` and `history` mode. Whatever it did, fold its condition into `terminalShown` below (shown here as
> `centerMode === "terminal"`) and delete the per-pane condition it left on the wrapper. If Stage 1 wrapped the
> stack in a *conditional render* (`centerMode === "terminal" ? <stack/> : ...`), change that to always render the
> grid parent and hide it with `hidden`: a conditional render unmounts every xterm and replays every TUI.

- [ ] **Step 1: Create the cell bar**
  Create `frontend/app/view/agents/gridcellbar.tsx`:
  ```tsx
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The slim bar over each cell of the agent grid while there is more than one: the agent's status dot and
  // name, and an x that takes the cell out of the grid (the agent keeps running).

  import { cn } from "@/util/util";
  import { X } from "lucide-react";
  import type { AgentVM } from "./agentsviewmodel";
  import { StatusDot } from "./statusdot";

  export function GridCellBar({
      agent,
      focused,
      onRemove,
  }: {
      agent: AgentVM;
      focused: boolean;
      onRemove: () => void;
  }) {
      return (
          <div
              data-agent-cell-bar={agent.id}
              title={`${agent.name} (${agent.state})`}
              className={cn(
                  "flex h-[26px] shrink-0 items-center gap-[7px] border-b border-border bg-surface px-[8px]",
                  focused ? "text-primary" : "text-muted"
              )}
          >
              <StatusDot state={agent.state} pulse={agent.state !== "idle"} className="!h-[7px] !w-[7px]" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{agent.name}</span>
              <button
                  type="button"
                  data-agent-cell-remove={agent.id}
                  aria-label={`Remove ${agent.name} from the grid`}
                  title="Remove from the grid (the agent keeps running)"
                  onClick={(e) => {
                      e.stopPropagation();
                      onRemove();
                  }}
                  className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary"
              >
                  <X size={12} aria-hidden />
              </button>
          </div>
      );
  }
  ```
- [ ] **Step 2: Imports in `agentsurface.tsx`**
  Next to the other `./` imports (after `import { AgentTree } from "./agenttree";`) add:
  ```tsx
  import {
      gridEquals,
      gridFallbackFocus,
      gridHold,
      placementStyle,
      pruneMissing,
      reconcileGrid,
      visibleCells,
  } from "./agentgrid";
  import { GridCellBar } from "./gridcellbar";
  import { agentGridAtom, removeFromGrid } from "./gridstore";
  ```
- [ ] **Step 3: Read the grid and resolve the focused agent through it**
  In `AgentSurface`, add the grid atom next to the other `useAtomValue` calls, after
  `const seeded = useAtomValue(rosterSeededAtom);`:
  ```tsx
      const gridState = useAtomValue(agentGridAtom);
  ```
  Then replace the block that starts at `const mountable = [...agents, ...terminals];` through
  `const agent = ...;`. Before:
  ```tsx
      const mountable = [...agents, ...terminals];
      const focused = focusId != null ? (mountable.find((a) => a.id === focusId) ?? ended?.agent) : undefined;
      const agent = focused ?? agents.find((a) => a.id === order[0]) ?? agents[0] ?? terminals[0];
  ```
  After:
  ```tsx
      const mountable = [...agents, ...terminals];
      // The grid's cells are live agents with a terminal. A plain terminal or a done worker is shown alone and
      // leaves the grid as it was (visibleCells).
      const eligible = useMemo(() => new Set(agents.filter((a) => a.blockId != null).map((a) => a.id)), [agents]);
      const focused = focusId != null ? (mountable.find((a) => a.id === focusId) ?? ended?.agent) : undefined;
      // With nothing in focus (a launch, or the focused agent just exited) resume on the grid's own focused cell
      // rather than the roster's first agent, which the focus rule would then swap into a cell. While the roster is
      // still loading and none of a saved grid's agents has arrived, hold the skeleton for the same reason.
      const holdForGrid = focused == null && gridHold(gridState, eligible, seeded);
      const gridFocusId = gridFallbackFocus(seeded ? pruneMissing(gridState, eligible) : gridState, eligible);
      const agent = holdForGrid
          ? undefined
          : (focused ??
            agents.find((a) => a.id === gridFocusId) ??
            agents.find((a) => a.id === order[0]) ??
            agents[0] ??
            terminals[0]);
  ```
  Keep the existing comment block above `const mountable` as it is.
- [ ] **Step 4: Persist the reconciled grid**
  After the existing "sync focusId to the defaulted agent" `useEffect` (the one that calls
  `globalStore.set(model.focusIdAtom, agent.id)`), add:
  ```tsx
      // The grid follows the roster and the focus (reconcileGrid): agents that left are pruned, and the focused
      // agent takes its cell or the focused cell. Computed every render so the cells drawn below are already right;
      // written back only when it differs, which makes it a fixed point (reconcileGrid is idempotent).
      const reconciled = useMemo(
          () => reconcileGrid(gridState, { focusId: agent?.id, eligible, seeded }),
          [gridState, agent?.id, eligible, seeded]
      );
      useEffect(() => {
          if (!gridEquals(reconciled, gridState)) {
              globalStore.set(agentGridAtom, reconciled);
          }
      }, [reconciled, gridState]);
  ```
- [ ] **Step 5: Hold the skeleton while a saved grid waits for its agents**
  Before:
  ```tsx
      if (!agent) {
          return rosterLoadPhase(seeded, agents.length) === "loading" ? (
  ```
  After:
  ```tsx
      if (!agent) {
          return holdForGrid || rosterLoadPhase(seeded, agents.length) === "loading" ? (
  ```
- [ ] **Step 6: Compute what is on screen**
  Right after the reconcile effect from Step 4 (this code reads `reconciled`, a `const`, so it has to come after it;
  `canvasMode` and `fullscreen` are declared higher up) and anywhere before the `if (!agent)` return, add:
  ```tsx
      // What the terminal stack shows: the grid's cells, or one cell alone (fullscreen; an agent that is not a cell,
      // such as a terminal). Canvas, a done worker's transcript and Stage 1's History and Session modes show something
      // else in the centre, so the grid hides, with every pane still mounted, and comes back as it was.
      const terminalShown = agent != null && centerMode === "terminal" && !canvasMode && !isEndedWorkerId(agent.id);
      const cells = agent != null && terminalShown ? visibleCells(reconciled, { focusId: agent.id, collapsed: fullscreen }) : [];
      const cellOf = new Map(cells.map((c) => [c.id, c] as const));
      const multi = cells.length > 1;
      // a visible cell with no pane (a launch with no terminal yet) leaves the grid hidden so the fallback below shows
      const gridShown = mountable.some((a) => a.blockId != null && cellOf.has(a.id));
  ```
  and add `centerModeAtom` the way Stage 1 reads it in this file (a hook, so declare it with the other top-level
  `useAtomValue` calls next to `gridState`: `const centerMode = useAtomValue(centerModeAtom);` with
  `import { centerModeAtom } from "./agentcenter";`). If Stage 1 already declares `centerMode` here, reuse that
  variable.
- [ ] **Step 7: Replace the terminal stack**
  Before (inside the centre column, after `<DivergenceBanner ... />`):
  ```tsx
                          {mountable
                              .filter((a) => a.blockId != null)
                              .map((a) => (
                                  <div
                                      key={a.id}
                                      data-agent-terminal={a.id}
                                      className={cn(
                                          "min-h-0 flex-1",
                                          a.id === agent.id && !canvasMode ? "flex flex-col" : "hidden"
                                      )}
                                  >
                                      <CockpitFocusPane blockId={a.blockId!} tabId={tabId} />
                                  </div>
                              ))}
  ```
  After:
  ```tsx
                          {/* The grid parent is always rendered: hidden, never unmounted, so no xterm remounts. Tracks
                              are minmax(0, 1fr) and cells min-w-0 min-h-0 so a cell can shrink below its xterm's pixel
                              width, which is what makes the terminal's ResizeObserver fire and refit. Nothing here
                              animates size: one layout commit is one PTY resize. */}
                          <div
                              data-agent-grid
                              data-agent-grid-count={cells.length}
                              className={cn(
                                  "min-h-0 min-w-0 flex-1",
                                  gridShown ? "grid grid-cols-2 grid-rows-2" : "hidden",
                                  gridShown && multi && "gap-[6px] p-[6px]"
                              )}
                          >
                              {mountable
                                  .filter((a) => a.blockId != null)
                                  .map((a) => {
                                      const cell = cellOf.get(a.id);
                                      return (
                                          <div
                                              key={a.id}
                                              data-agent-terminal={a.id}
                                              data-agent-cell={cell != null ? cells.indexOf(cell) : undefined}
                                              data-agent-focused={cell?.focused && multi ? "true" : undefined}
                                              style={cell != null ? placementStyle(cell.placement) : undefined}
                                              className={cn(
                                                  "relative isolate min-h-0 min-w-0",
                                                  cell != null ? "flex flex-col" : "hidden",
                                                  cell != null && multi && "overflow-hidden rounded-[8px] border",
                                                  cell != null && multi && (cell.focused ? "border-accent" : "border-edge-mid")
                                              )}
                                          >
                                              {cell != null && multi ? (
                                                  <GridCellBar
                                                      agent={a}
                                                      focused={cell.focused}
                                                      onRemove={() => removeFromGrid(model, a.id)}
                                                  />
                                              ) : null}
                                              <CockpitFocusPane blockId={a.blockId!} tabId={tabId} />
                                          </div>
                                      );
                                  })}
                          </div>
  ```
  The bar and the pane sit at fixed child positions (`null` keeps the bar's slot), so `CockpitFocusPane` keeps
  its identity when the bar appears or goes. Leave the `isEndedWorkerId(agent.id) ? <EndedTranscript/> : canvasMode ?
  <CanvasPane/> : agent.blockId == null ? ...` chain after it exactly as it is.
- [ ] **Step 8: Run the existing Agent scenarios**
  **Requires `task dev` running** (the user's app; Vite hot-reloads the change, then reload the window once, because
  moving the panes under a new parent remounts them one time):
  `task verify:ui -- canvas-swap tui-fullscreen agent-terminal-on-arrival`
  Expected: the same PASS/SKIP results as before this task. `canvas-swap` step 5 ("hidden, not remounted") and
  `tui-fullscreen` steps 1 to 3 are the ones that would catch a broken parent. A SKIP on `agent-terminal-on-arrival`
  ("launch one agent first") means no agent is running: launch one and re-run.
- [ ] **Step 9: Commit**
  ```
  git add frontend/app/view/agents/gridcellbar.tsx frontend/app/view/agents/agentsurface.tsx
  git commit -m "feat(agent): render the terminal stack as a 2x2 grid with cell bars" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 20: Drag and drop, drop zones and Open in split

**Depends on:** Task 18, Task 19
**Files:**
- Create: `frontend/app/view/agents/griddrop.ts` (pure: MIME, `zoneFromPoint`, `allowedZones`, `isAgentDrag`, `zoneBox`, `zoneLabel`)
- Test: `frontend/app/view/agents/griddrop.test.ts`
- Create: `frontend/app/view/agents/agentdragstore.ts` (the drag atom, `beginAgentDrag`, `endAgentDrag`)
- Test: `frontend/app/view/agents/agentdragstore.test.ts`
- Create: `frontend/app/view/agents/griddropoverlay.tsx`
- Modify: `frontend/app/view/agents/gridcellbar.tsx` (bar becomes the drag handle)
- Modify: `frontend/app/view/agents/agentsurface.tsx` (`AgentSurface`: the overlay child of each cell)
- Modify: `frontend/app/view/agents/agenttree.tsx` (`ParentRow`, `WorkerRow`, `StageRow`, new helpers `dragSource`, `splitMenuItem`)

HTML5 drag and drop works here because `src-tauri/tauri.conf.json` has `"dragDropEnabled": false` on the window.
The custom MIME is `application/x-arc-agent`; the overlay answers only drags that carry it, so an OS file drag is not
touched (S4 gives the terminal's own `drop` handler the files). The overlay exists only while an agent drag is
active, so it never sits over xterm the rest of the time.

- [ ] **Step 1: Write the failing test for the pure drop logic**
  Create `frontend/app/view/agents/griddrop.test.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0

  import { describe, expect, it } from "vitest";
  import {
      AGENT_DRAG_MIME,
      EDGE_FRACTION,
      allowedZones,
      isAgentDrag,
      zoneBox,
      zoneFromPoint,
      zoneLabel,
  } from "./griddrop";

  const rect = { left: 100, top: 50, width: 400, height: 200 };
  // the zone at a point given as a fraction of the rect
  const at = (u: number, v: number) => zoneFromPoint(rect, rect.left + rect.width * u, rect.top + rect.height * v);
  // the zone at an offset in px from the rect's top-left
  const off = (dx: number, dy: number) => zoneFromPoint(rect, rect.left + dx, rect.top + dy);

  describe("zoneFromPoint", () => {
      it("the middle of a cell is the centre", () => {
          expect(at(0.5, 0.5)).toBe("center");
          expect(at(0.3, 0.3)).toBe("center");
          expect(at(0.7, 0.7)).toBe("center");
      });
      it("the outer quarter on a side is that edge", () => {
          expect(at(0.1, 0.5)).toBe("left");
          expect(at(0.9, 0.5)).toBe("right");
          expect(at(0.5, 0.1)).toBe("top");
          expect(at(0.5, 0.9)).toBe("bottom");
      });
      it("the edge starts exactly one quarter in", () => {
          expect(EDGE_FRACTION).toBe(0.25);
          expect(off(100, 100)).toBe("center"); // 25% across: still the centre
          expect(off(99, 100)).toBe("left");
          expect(off(300, 100)).toBe("center"); // 75% across
          expect(off(301, 100)).toBe("right");
          expect(off(200, 50)).toBe("center"); // 25% down
          expect(off(200, 49)).toBe("top");
          expect(off(200, 150)).toBe("center"); // 75% down
          expect(off(200, 151)).toBe("bottom");
      });
      it("a corner goes to the nearer edge, the horizontal one on a tie", () => {
          expect(off(0, 0)).toBe("left");
          expect(off(0, 200)).toBe("left");
          expect(off(400, 0)).toBe("right");
          expect(off(400, 200)).toBe("right");
          expect(at(0.2, 0.02)).toBe("top");
          expect(at(0.02, 0.2)).toBe("left");
          expect(at(0.8, 0.98)).toBe("bottom");
      });
      it("a point outside the rect clamps to the nearest edge", () => {
          expect(at(-1, 0.5)).toBe("left");
          expect(at(2, 0.5)).toBe("right");
          expect(at(0.5, -3)).toBe("top");
          expect(at(0.5, 5)).toBe("bottom");
      });
      it("a rect with no area, or a non-finite point, is the centre", () => {
          expect(zoneFromPoint({ left: 0, top: 0, width: 0, height: 100 }, 5, 5)).toBe("center");
          expect(zoneFromPoint({ left: 0, top: 0, width: 100, height: 0 }, 5, 5)).toBe("center");
          expect(zoneFromPoint({ left: 0, top: 0, width: -10, height: 100 }, 5, 5)).toBe("center");
          expect(zoneFromPoint(rect, Number.NaN, 100)).toBe("center");
          expect(zoneFromPoint(rect, 200, Number.NaN)).toBe("center");
      });
  });

  describe("allowedZones", () => {
      it("offers every zone until the grid is full", () => {
          for (const n of [0, 1, 2, 3]) {
              expect(allowedZones(n)).toEqual(["center", "left", "right", "top", "bottom"]);
          }
      });
      it("offers only the swap at four cells", () => {
          expect(allowedZones(4)).toEqual(["center"]);
          expect(allowedZones(9)).toEqual(["center"]);
      });
  });

  describe("isAgentDrag", () => {
      it("is true only for a drag that carries the agent MIME", () => {
          expect(isAgentDrag(["Files", AGENT_DRAG_MIME])).toBe(true);
          expect(isAgentDrag({ length: 1, 0: AGENT_DRAG_MIME } as ArrayLike<string>)).toBe(true);
          expect(isAgentDrag(["Files"])).toBe(false);
          expect(isAgentDrag(["text/plain"])).toBe(false);
          expect(isAgentDrag([])).toBe(false);
          expect(isAgentDrag(null)).toBe(false);
          expect(isAgentDrag(undefined)).toBe(false);
      });
      it("uses the documented MIME", () => {
          expect(AGENT_DRAG_MIME).toBe("application/x-arc-agent");
      });
  });

  describe("zoneBox", () => {
      it("previews where the dropped agent will sit, as percentages of the cell", () => {
          expect(zoneBox("center")).toEqual({ left: 25, top: 25, width: 50, height: 50 });
          expect(zoneBox("left")).toEqual({ left: 0, top: 0, width: 50, height: 100 });
          expect(zoneBox("right")).toEqual({ left: 50, top: 0, width: 50, height: 100 });
          expect(zoneBox("top")).toEqual({ left: 0, top: 0, width: 100, height: 50 });
          expect(zoneBox("bottom")).toEqual({ left: 0, top: 50, width: 100, height: 50 });
      });
  });

  describe("zoneLabel", () => {
      it("says what a drop will do", () => {
          expect(zoneLabel("center", false)).toBe("Replace");
          expect(zoneLabel("center", true)).toBe("Swap");
          expect(zoneLabel("left", false)).toBe("Place before");
          expect(zoneLabel("top", true)).toBe("Place before");
          expect(zoneLabel("right", false)).toBe("Place after");
          expect(zoneLabel("bottom", true)).toBe("Place after");
      });
  });
  ```
- [ ] **Step 2: Run it and watch it fail**
  `npx vitest run frontend/app/view/agents/griddrop.test.ts`
  Expected: FAIL, `Failed to resolve import "./griddrop"`.
- [ ] **Step 3: Implement the pure drop logic**
  Create `frontend/app/view/agents/griddrop.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The pure half of dropping an agent on the grid: which drags count, which zone of a cell a point is in, which
  // zones a grid of N cells offers, and what to say about the zone. The overlay (griddropoverlay.tsx) only draws it.

  import { MAX_CELLS, type DropZone } from "./agentgrid";

  // Carried by a drag that starts on an agent row or a cell bar; its data is the agent's id. A drag without it
  // (an OS file, say) is none of the grid's business.
  export const AGENT_DRAG_MIME = "application/x-arc-agent";

  // The outer quarter of each side is an edge zone; what is left in the middle is the centre.
  export const EDGE_FRACTION = 0.25;

  export interface Rect {
      left: number;
      top: number;
      width: number;
      height: number;
  }

  export function isAgentDrag(types: ArrayLike<string> | null | undefined): boolean {
      return types != null && Array.from(types).includes(AGENT_DRAG_MIME);
  }

  const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

  // The zone of `rect` that (x, y) is in. Distances are fractions of the cell's own width and height, so a wide
  // cell and a tall one both keep a quarter. In a corner the nearer edge wins; on a tie the horizontal edge does.
  export function zoneFromPoint(rect: Rect, x: number, y: number): DropZone {
      if (!(rect.width > 0) || !(rect.height > 0)) {
          return "center";
      }
      const u = clamp01((x - rect.left) / rect.width);
      const v = clamp01((y - rect.top) / rect.height);
      const toLeft = u;
      const toRight = 1 - u;
      const toTop = v;
      const toBottom = 1 - v;
      const nearest = Math.min(toLeft, toRight, toTop, toBottom);
      if (nearest >= EDGE_FRACTION) {
          return "center";
      }
      if (nearest === toLeft) {
          return "left";
      }
      if (nearest === toRight) {
          return "right";
      }
      if (nearest === toTop) {
          return "top";
      }
      return "bottom";
  }

  const ALL_ZONES: readonly DropZone[] = ["center", "left", "right", "top", "bottom"];

  // A full grid has no room to insert, so only the swap remains.
  export function allowedZones(cellCount: number): readonly DropZone[] {
      return cellCount >= MAX_CELLS ? ["center"] : ALL_ZONES;
  }

  export interface ZoneBox {
      left: number;
      top: number;
      width: number;
      height: number;
  }

  // The highlight for a zone, as percentages of the cell: an edge previews the half the agent will take.
  const ZONE_BOX: Record<DropZone, ZoneBox> = {
      center: { left: 25, top: 25, width: 50, height: 50 },
      left: { left: 0, top: 0, width: 50, height: 100 },
      right: { left: 50, top: 0, width: 50, height: 100 },
      top: { left: 0, top: 0, width: 100, height: 50 },
      bottom: { left: 0, top: 50, width: 100, height: 50 },
  };

  export function zoneBox(zone: DropZone): ZoneBox {
      return ZONE_BOX[zone];
  }

  // `moving`: the dragged agent already has a cell, so the centre swaps instead of replacing.
  export function zoneLabel(zone: DropZone, moving: boolean): string {
      if (zone === "center") {
          return moving ? "Swap" : "Replace";
      }
      return zone === "left" || zone === "top" ? "Place before" : "Place after";
  }
  ```
- [ ] **Step 4: Run it and watch it pass**
  `npx vitest run frontend/app/view/agents/griddrop.test.ts`
  Expected: PASS.
- [ ] **Step 5: Write the failing test for the drag state**
  Create `frontend/app/view/agents/agentdragstore.test.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0

  import { globalStore } from "@/app/store/jotaiStore";
  import { beforeEach, describe, expect, it, vi } from "vitest";
  import { agentDragAtom, beginAgentDrag, endAgentDrag } from "./agentdragstore";
  import { AGENT_DRAG_MIME } from "./griddrop";

  const fakeEvent = () => ({ dataTransfer: { setData: vi.fn(), effectAllowed: "uninitialized" as string } });

  beforeEach(() => {
      endAgentDrag();
  });

  describe("agent drag state", () => {
      it("carries the agent id under the custom MIME and marks a drag as active", () => {
          const e = fakeEvent();
          beginAgentDrag(e, "tab1");
          expect(e.dataTransfer.setData).toHaveBeenCalledWith(AGENT_DRAG_MIME, "tab1");
          expect(e.dataTransfer.effectAllowed).toBe("move");
          expect(globalStore.get(agentDragAtom)).toEqual({ id: "tab1" });
      });
      it("does not start a drag that has no dataTransfer", () => {
          beginAgentDrag({ dataTransfer: null }, "tab1");
          expect(globalStore.get(agentDragAtom)).toBeNull();
      });
      it("ends", () => {
          beginAgentDrag(fakeEvent(), "tab1");
          endAgentDrag();
          expect(globalStore.get(agentDragAtom)).toBeNull();
      });
      it("a second begin replaces the first", () => {
          beginAgentDrag(fakeEvent(), "tab1");
          beginAgentDrag(fakeEvent(), "tab2");
          expect(globalStore.get(agentDragAtom)).toEqual({ id: "tab2" });
      });
  });
  ```
- [ ] **Step 6: Run it and watch it fail**
  `npx vitest run frontend/app/view/agents/agentdragstore.test.ts`
  Expected: FAIL, `Failed to resolve import "./agentdragstore"`.
- [ ] **Step 7: Implement the drag state**
  Create `frontend/app/view/agents/agentdragstore.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // Whether an agent is being dragged (from a tree row or a cell's bar), and which one. The drop overlays
  // (griddropoverlay.tsx) exist only while this is set, so nothing sits over xterm the rest of the time.

  import { globalStore } from "@/app/store/jotaiStore";
  import { atom } from "jotai";
  import { AGENT_DRAG_MIME } from "./griddrop";

  export const agentDragAtom = atom<{ id: string } | null>(null);

  interface DragSource {
      dataTransfer: { setData(format: string, data: string): void; effectAllowed: string } | null;
  }

  let disarm: (() => void) | null = null;
  const FAILSAFE_GRACE_MS = 300;

  // A drag whose source unmounts mid-drag (its agent exits) never fires dragend, which would leave the overlays up
  // for good. dragend and drop reach window last (bubbling, after React's own handlers, so the overlay's onDrop has
  // already run); pointermove and keydown only arrive once the drag is over, and are ignored for a moment after it
  // starts so a stray one cannot end it at once.
  function armFailsafe(): void {
      if (typeof window === "undefined" || disarm != null) {
          return;
      }
      const armedAt = performance.now();
      const stop = () => endAgentDrag();
      const stopLate = () => {
          if (performance.now() - armedAt > FAILSAFE_GRACE_MS) {
              endAgentDrag();
          }
      };
      window.addEventListener("dragend", stop);
      window.addEventListener("drop", stop);
      window.addEventListener("pointermove", stopLate, true);
      window.addEventListener("keydown", stopLate, true);
      disarm = () => {
          window.removeEventListener("dragend", stop);
          window.removeEventListener("drop", stop);
          window.removeEventListener("pointermove", stopLate, true);
          window.removeEventListener("keydown", stopLate, true);
          disarm = null;
      };
  }

  // onDragStart of anything that can be dropped on the grid.
  export function beginAgentDrag(e: DragSource, id: string): void {
      const dt = e.dataTransfer;
      if (dt == null) {
          return;
      }
      dt.setData(AGENT_DRAG_MIME, id);
      dt.effectAllowed = "move";
      globalStore.set(agentDragAtom, { id });
      armFailsafe();
  }

  export function endAgentDrag(): void {
      globalStore.set(agentDragAtom, null);
      disarm?.();
  }
  ```
- [ ] **Step 8: Run it and watch it pass**
  `npx vitest run frontend/app/view/agents/agentdragstore.test.ts`
  Expected: PASS (vitest's node environment has no `window`, so the failsafe is skipped there).
- [ ] **Step 9: The drop overlay**
  Create `frontend/app/view/agents/griddropoverlay.tsx`:
  ```tsx
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The zones that appear over a grid cell while an agent is being dragged: centre swaps (or replaces), an edge
  // inserts. One overlay per cell, a child of the cell, so it is exactly the cell's size; it renders nothing at all
  // unless an agent drag is active, and never over the cell being dragged.

  import { cn } from "@/util/util";
  import { useAtomValue } from "jotai";
  import { useState } from "react";
  import { agentDragAtom, endAgentDrag } from "./agentdragstore";
  import type { DropZone } from "./agentgrid";
  import { AGENT_DRAG_MIME, allowedZones, isAgentDrag, zoneBox, zoneFromPoint, zoneLabel } from "./griddrop";
  import { dropAgentOnGrid, type GridModel } from "./gridstore";

  interface OverlayProps {
      model: GridModel;
      id: string; // the cell's agent
      ids: readonly string[]; // every cell of the current grid, in order
  }

  // The drop leaves DOM focus on the row that was dragged; hand it to the cell that took the agent so typing goes there.
  function focusCellSoon(id: string): void {
      window.setTimeout(() => {
          const term = document.querySelector<HTMLElement>(`[data-agent-terminal="${id}"] .xterm-helper-textarea`);
          if (term?.checkVisibility()) {
              term.focus({ preventScroll: true });
          }
      }, 120);
  }

  export function GridDropOverlay(props: OverlayProps) {
      const drag = useAtomValue(agentDragAtom);
      if (drag == null || drag.id === props.id) {
          return null;
      }
      // a fresh component per drag, so the hovered zone never outlives it
      return <ActiveOverlay {...props} dragId={drag.id} />;
  }

  function ActiveOverlay({ model, id, ids, dragId }: OverlayProps & { dragId: string }) {
      const [zone, setZone] = useState<DropZone | null>(null);
      const index = ids.indexOf(id);
      const zones = allowedZones(ids.length);
      const moving = ids.includes(dragId);

      const zoneAt = (e: React.DragEvent<HTMLDivElement>): DropZone => {
          const z = zoneFromPoint(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
          return zones.includes(z) ? z : "center";
      };
      const onOver = (e: React.DragEvent<HTMLDivElement>) => {
          if (!isAgentDrag(e.dataTransfer.types)) {
              return;
          }
          e.preventDefault(); // a drop is only delivered to a target that accepted the dragover
          e.dataTransfer.dropEffect = "move";
          const z = zoneAt(e);
          if (z !== zone) {
              setZone(z);
          }
      };
      const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
          if (!isAgentDrag(e.dataTransfer.types)) {
              return;
          }
          e.preventDefault();
          const dropped = e.dataTransfer.getData(AGENT_DRAG_MIME) || dragId;
          const z = zoneAt(e);
          setZone(null);
          endAgentDrag();
          dropAgentOnGrid(model, dropped, index, z);
          focusCellSoon(dropped);
      };

      const box = zone != null ? zoneBox(zone) : null;
      return (
          <div
              aria-hidden="true"
              data-agent-drop-overlay={id}
              data-drop-zones={zones.join(" ")}
              data-drop-zone={zone ?? ""}
              onDragEnter={onOver}
              onDragOver={onOver}
              onDragLeave={() => setZone(null)}
              onDrop={onDrop}
              className="absolute inset-0 z-30 bg-background/40"
          >
              {box != null && zone != null ? (
                  <div
                      className={cn(
                          "pointer-events-none absolute flex items-center justify-center rounded-[6px]",
                          "border-2 border-dashed border-accent bg-accentbg"
                      )}
                      style={{
                          left: `${box.left}%`,
                          top: `${box.top}%`,
                          width: `${box.width}%`,
                          height: `${box.height}%`,
                      }}
                  >
                      <span className="text-[12px] font-semibold text-accent-soft">{zoneLabel(zone, moving)}</span>
                  </div>
              ) : null}
          </div>
      );
  }
  ```
  The overlay is a sibling after `CockpitFocusPane` inside an `isolate` cell, so `z-30` beats the term stickers
  layer (`--zindex-termstickers: 20`) without leaking out of the cell. The highlight box is `pointer-events-none`, so
  the overlay element itself is the only drag target and `dragleave` fires only when the pointer really leaves.
- [ ] **Step 10: Make the bar a drag handle**
  Overwrite `frontend/app/view/agents/gridcellbar.tsx` with:
  ```tsx
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The slim bar over each cell of the agent grid while there is more than one: the agent's status dot and
  // name, and an x that takes the cell out of the grid (the agent keeps running). The bar is also the handle for
  // rearranging: drag it onto another cell and the drop zones answer as they do for a row from the tree.

  import { cn } from "@/util/util";
  import { GripVertical, X } from "lucide-react";
  import { beginAgentDrag, endAgentDrag } from "./agentdragstore";
  import type { AgentVM } from "./agentsviewmodel";
  import { StatusDot } from "./statusdot";

  export function GridCellBar({
      agent,
      focused,
      onRemove,
  }: {
      agent: AgentVM;
      focused: boolean;
      onRemove: () => void;
  }) {
      return (
          <div
              data-agent-cell-bar={agent.id}
              draggable
              onDragStart={(e) => beginAgentDrag(e, agent.id)}
              onDragEnd={endAgentDrag}
              title={`${agent.name} (${agent.state}). Drag to rearrange`}
              className={cn(
                  "flex h-[26px] shrink-0 cursor-grab items-center gap-[7px] border-b border-border bg-surface px-[8px] active:cursor-grabbing",
                  focused ? "text-primary" : "text-muted"
              )}
          >
              <GripVertical size={12} aria-hidden className="shrink-0 text-ink-faint" />
              <StatusDot state={agent.state} pulse={agent.state !== "idle"} className="!h-[7px] !w-[7px]" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{agent.name}</span>
              <button
                  type="button"
                  data-agent-cell-remove={agent.id}
                  aria-label={`Remove ${agent.name} from the grid`}
                  title="Remove from the grid (the agent keeps running)"
                  onClick={(e) => {
                      e.stopPropagation();
                      onRemove();
                  }}
                  className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary"
              >
                  <X size={12} aria-hidden />
              </button>
          </div>
      );
  }
  ```
- [ ] **Step 11: Add the overlay to each cell**
  In `frontend/app/view/agents/agentsurface.tsx` add
  `import { GridDropOverlay } from "./griddropoverlay";` next to the `./gridcellbar` import. In the cell wrapper added
  in Task 19, after the `CockpitFocusPane` line. Before:
  ```tsx
                                              <CockpitFocusPane blockId={a.blockId!} tabId={tabId} />
                                          </div>
  ```
  After:
  ```tsx
                                              <CockpitFocusPane blockId={a.blockId!} tabId={tabId} />
                                              {cell != null && reconciled.ids.includes(a.id) ? (
                                                  <GridDropOverlay model={model} id={a.id} ids={reconciled.ids} />
                                              ) : null}
                                          </div>
  ```
  A cell that is not in the saved grid (a terminal shown alone) gets no overlay, so a drop can never target an index
  of a list the cell is not in.
- [ ] **Step 12: Draggable live-agent rows and the `Open in split` menu item**
  In `frontend/app/view/agents/agenttree.tsx`:
  1. Imports. Add `Columns2,` to the lucide import list (between `ChevronRight,` and `Copy,`), and next to the other
     `./` imports add:
     ```tsx
     import { beginAgentDrag, endAgentDrag } from "./agentdragstore";
     import { canOpenInSplit, openInSplit } from "./gridstore";
     ```
  2. Helpers. Insert before the comment `// The inline rename editor, shared by both row kinds`:
     ```tsx
     // A live agent's row is the drag source for the grid: dropped on a cell of the Agent surface it splits the view.
     // A row with no terminal to show (a done worker, a launch with no block yet) is not draggable.
     function dragSource(agent: AgentVM | undefined, enabled: boolean): React.HTMLAttributes<HTMLDivElement> {
         if (agent == null || !enabled || agent.blockId == null) {
             return {};
         }
         return {
             draggable: true,
             onDragStart: (e) => beginAgentDrag(e, agent.id),
             onDragEnd: endAgentDrag,
         };
     }

     // "Open in split" adds the agent as a new cell beside the focused one. Disabled when it already has a cell or the
     // grid is full; empty for an agent with no terminal. The palette has the same action (cockpit/actions/agent.ts).
     function splitMenuItem(model: AgentsViewModel, agent: AgentVM): ContextMenuItem[] {
         if (agent.blockId == null) {
             return [];
         }
         return [
             {
                 label: "Open in split",
                 icon: <Columns2 size={15} />,
                 enabled: canOpenInSplit(model, agent.id),
                 click: () => void openInSplit(model, agent.id),
             },
         ];
     }
     ```
  3. `ParentRow`, the outer row. Before:
     ```tsx
                 <div
                     onClick={select}
                     onContextMenu={onContextMenu}
                     className={cn(
                         "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                         // selection is the one filled row; an asking agent says so in words, not in a tint
     ```
     After:
     ```tsx
                 <div
                     onClick={select}
                     onContextMenu={onContextMenu}
                     data-agent-row={agent.id}
                     {...dragSource(agent, !renaming)}
                     className={cn(
                         "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                         // selection is the one filled row; an asking agent says so in words, not in a tint
     ```
     (`renaming` is already declared in `ParentRow`; a row being renamed must not start a drag from its text box.)
     In `ParentRow`'s `onContextMenu`, after the Duplicate item. Before:
     ```tsx
             { label: "Duplicate", icon: <CopyPlus size={15} />, click: () => duplicateSession(model, agent.id) },
             {
                 label: "Copy name",
     ```
     After:
     ```tsx
             { label: "Duplicate", icon: <CopyPlus size={15} />, click: () => duplicateSession(model, agent.id) },
             ...splitMenuItem(model, agent),
             {
                 label: "Copy name",
     ```
  4. `WorkerRow`. Its menu, before:
     ```tsx
         const onContextMenu = (e: React.MouseEvent) => {
             if (agent == null) {
                 return;
             }
             const items: ContextMenuItem[] = [
                 { label: "Close agent", icon: <X size={15} />, danger: true, click: () => confirmCloseSession(agent) },
             ];
     ```
     After:
     ```tsx
         const onContextMenu = (e: React.MouseEvent) => {
             if (agent == null) {
                 return;
             }
             const split = ended ? [] : splitMenuItem(model, agent);
             const items: ContextMenuItem[] = [
                 ...split,
                 ...(split.length > 0 ? [{ type: "separator" as const }] : []),
                 { label: "Close agent", icon: <X size={15} />, danger: true, click: () => confirmCloseSession(agent) },
             ];
     ```
     Its outer row, before:
     ```tsx
         return (
             <div
                 onClick={select}
                 onContextMenu={onContextMenu}
                 className={cn(
                     "relative flex items-center gap-[9px] rounded-[6px] py-[7px] pr-[11px] transition-colors duration-[140ms]",
     ```
     After:
     ```tsx
         return (
             <div
                 onClick={select}
                 onContextMenu={onContextMenu}
                 data-agent-row={agent?.id}
                 {...dragSource(agent, !ended)}
                 className={cn(
                     "relative flex items-center gap-[9px] rounded-[6px] py-[7px] pr-[11px] transition-colors duration-[140ms]",
     ```
     (`ended` is the row's existing "this row opens a transcript" flag; those rows are not draggable.)
  5. `StageRow`. Its menu, before:
     ```tsx
         const onContextMenu = (e: React.MouseEvent) => {
             const items: ContextMenuItem[] = [
                 { label: "Close agent", icon: <X size={15} />, danger: true, click: () => confirmCloseSession(agent) },
             ];
     ```
     After:
     ```tsx
         const onContextMenu = (e: React.MouseEvent) => {
             const split = splitMenuItem(model, agent);
             const items: ContextMenuItem[] = [
                 ...split,
                 ...(split.length > 0 ? [{ type: "separator" as const }] : []),
                 { label: "Close agent", icon: <X size={15} />, danger: true, click: () => confirmCloseSession(agent) },
             ];
     ```
     Its outer row, before:
     ```tsx
             <div
                 onClick={select}
                 onContextMenu={onContextMenu}
                 className={cn(
                     "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] py-[7px] pl-[28px] pr-[11px] transition-colors duration-[140ms]",
                     selected ? "bg-surface-selected" : "hover:bg-surface-hover"
     ```
     After:
     ```tsx
             <div
                 onClick={select}
                 onContextMenu={onContextMenu}
                 data-agent-row={agent.id}
                 {...dragSource(agent, true)}
                 className={cn(
                     "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] py-[7px] pl-[28px] pr-[11px] transition-colors duration-[140ms]",
                     selected ? "bg-surface-selected" : "hover:bg-surface-hover"
     ```
  If Stage 1 rebuilt these rows, the target is the same: every row that stands for a live agent carries
  `data-agent-row={agent.id}` and `dragSource(...)`, and its menu carries `splitMenuItem(...)`. Session rows and run
  rows get neither (spec: live agents only).
- [ ] **Step 13: Re-run this task's tests**
  `npx vitest run frontend/app/view/agents/griddrop.test.ts`
  `npx vitest run frontend/app/view/agents/agentdragstore.test.ts`
  Expected: PASS for both.
- [ ] **Step 14: Quick look at the real drag**
  **Requires `task dev` running.** In the Agent surface with two live agents, drag a row from the tree onto the
  terminal: the zones appear over the cell and nowhere else, the highlight follows the pointer, a drop on the right edge
  opens a second cell. The scripted check is Task 22; this is only to see that a real WebView2 drag starts at all.
- [ ] **Step 15: Commit**
  ```
  git add frontend/app/view/agents/griddrop.ts frontend/app/view/agents/griddrop.test.ts frontend/app/view/agents/agentdragstore.ts frontend/app/view/agents/agentdragstore.test.ts frontend/app/view/agents/griddropoverlay.tsx frontend/app/view/agents/gridcellbar.tsx frontend/app/view/agents/agentsurface.tsx frontend/app/view/agents/agenttree.tsx
  git commit -m "feat(agent): drag agents into the grid, drop zones and Open in split" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 21: One focus rule for clicks, cells and the keyboard

**Depends on:** Task 17, Task 19
**Files:**
- Modify: `frontend/app/view/agents/agentsurface.tsx` (`AgentSurface`: cell focus handlers)
- Create: `frontend/app/view/agents/agentgridfocus.test.ts`
- Modify: `frontend/app/store/keybindings/bindings.ts` (`cycle-agent-next` comment only)
- Modify: `frontend/app/cockpit/actions/agent.ts` (`actions`: `agent:split`)
- Test: `frontend/app/cockpit/actions/agent.test.ts`
- Modify: `docs/keyboard-shortcuts.md`
- Modify: `AGENTS.md`

**The decision, and why.** Every way of moving between agents (a tree row click, `Ctrl+Tab`, `Ctrl+Shift+Tab`,
`j`/`k`, `ArrowLeft`/`ArrowRight`, the palette, `openref.ts`, a notification) already ends in
`globalStore.set(model.focusIdAtom, id)`; `AgentSurface` turns that into the grid rule in one place
(`reconcileGrid` -> `focusAgent`): the agent's cell takes focus if it has one, otherwise the agent replaces the
focused cell. So:

- `cycle-agent-next` / `cycle-agent-prev` (`model.cycleFocus`) need no change and follow the same rule, as the spec
  asks.
- `agent:prev` / `agent:next` / `agent:prev-k` / `agent:next-j` (`step` in `buildAgentBindings`, which clamps at the
  ends of `orderAtom`) also keep stepping the roster and follow the rule. They do **not** become cell-to-cell keys:
  one rule for every writer is what lets the surface do this without per-binding branches, and the arrows only fire
  while the terminal does not hold focus (`navigate`), so they are the "browse" keys while the cells are the click
  targets.
- A click or focus inside a cell sets `focusIdAtom` to that cell's agent (added below), so the header, the rail and
  the tree highlight follow the focused cell.
- Consequence, accepted: stepping through the roster with a multi-cell grid *rewrites the focused cell* each time it
  lands on an agent that has no cell, so `Ctrl+Tab` over five agents in a four-cell grid shuffles which four are shown.
  The alternative (Ctrl+Tab cycling only the cells when there are two or more) contradicts the spec's "Ctrl+Tab
  follows the same rule" and is a small follow-up if the shuffle bites; see the stage risks.

- [ ] **Step 1: Write the failing test for the rule against the real stepping functions**
  Create `frontend/app/view/agents/agentgridfocus.test.ts`:
  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The one focus rule, exercised through the same pure steppers the keyboard uses (cycleFocus in agents.tsx and
  // step in buildAgentBindings): whatever writes focusIdAtom, AgentSurface reconciles the grid against it.

  import { describe, expect, it } from "vitest";
  import { gridFallbackFocus, pruneMissing, reconcileGrid, type GridState } from "./agentgrid";
  import { cycleId, moveCursor } from "./agentsviewmodel";

  const roster = ["a", "b", "c", "d", "e"];
  const live = new Set(roster);
  const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });

  // what the surface does after any write to focusIdAtom
  const settle = (s: GridState, focusId: string | undefined, eligible: ReadonlySet<string> = live) =>
      reconcileGrid(s, { focusId, eligible, seeded: true });
  // Ctrl+Tab: cycleFocus wraps around the roster order
  const ctrlTab = (s: GridState) => settle(s, cycleId(roster, s.focused ?? undefined, 1));
  // the arrows and j/k: step() clamps at the ends of the order
  const arrow = (s: GridState, delta: number) => settle(s, moveCursor(roster, s.focused ?? undefined, delta));

  describe("Ctrl+Tab", () => {
      it("onto an agent that has a cell focuses that cell and leaves the layout alone", () => {
          expect(ctrlTab(g(["a", "b"], "a"))).toEqual(g(["a", "b"], "b"));
      });
      it("onto an agent with no cell replaces the focused cell", () => {
          expect(ctrlTab(g(["a", "b"], "b"))).toEqual(g(["a", "c"], "c"));
      });
      it("round the whole roster the grid never grows, and focus always lands on the agent stepped to", () => {
          let s = g(["a", "b"], "a");
          for (let i = 0; i < 12; i++) {
              const expected = cycleId(roster, s.focused ?? undefined, 1);
              s = ctrlTab(s);
              expect(s.ids).toHaveLength(2);
              expect(s.focused).toBe(expected);
              expect(s.ids).toContain(s.focused);
          }
      });
  });

  describe("the arrows and j/k", () => {
      it("step the roster and follow the same rule", () => {
          expect(arrow(g(["a", "c"], "c"), -1)).toEqual(g(["a", "b"], "b"));
          expect(arrow(g(["a", "b"], "a"), 1)).toEqual(g(["a", "b"], "b"));
      });
      it("clamp at the ends, so the grid does not change there", () => {
          expect(arrow(g(["a", "e"], "e"), 1)).toEqual(g(["a", "e"], "e"));
          expect(arrow(g(["a", "b"], "a"), -1)).toEqual(g(["a", "b"], "a"));
      });
  });

  describe("a click on a tree row or a cell", () => {
      it("is the same rule: an agent in the grid takes focus, any other replaces the focused cell", () => {
          const s = g(["a", "b", "c", "d"], "b");
          expect(settle(s, "e")).toEqual(g(["a", "e", "c", "d"], "e"));
          expect(settle(s, "c")).toEqual(g(["a", "b", "c", "d"], "c"));
      });
  });

  describe("what is in focus but is not a cell", () => {
      it("a terminal or a done worker leaves the grid untouched, and an agent brings it back", () => {
          const s = g(["a", "b"], "a");
          expect(settle(s, "term")).toEqual(s);
          expect(settle(settle(s, "term"), "b")).toEqual(g(["a", "b"], "b"));
      });
  });

  describe("an agent that exits", () => {
      it("hands focus to the neighbouring cell, which the surface then resumes on", () => {
          const s = g(["a", "b", "c"], "b");
          const eligible = new Set(["a", "c"]);
          const resume = gridFallbackFocus(pruneMissing(s, eligible), eligible);
          expect(resume).toBe("c");
          expect(settle(s, resume, eligible)).toEqual(g(["a", "c"], "c"));
      });
  });
  ```
- [ ] **Step 2: Run it**
  `npx vitest run frontend/app/view/agents/agentgridfocus.test.ts`
  Expected: PASS straight away: Task 17 already implements the rule, and this test pins it against the real steppers
  (`cycleId`, `moveCursor` from `agentsviewmodel.ts`). If it fails, the rule in `agentgrid.ts` or a stepper changed;
  fix that before going on.
- [ ] **Step 3: Focus follows a click or a focus inside a cell**
  In `agentsurface.tsx`, add a helper inside `AgentSurface` before the `return`, next to the other handlers (for
  example after `const rejoin = ...`):
  ```tsx
      // A click or a focus inside a cell makes it the focused one; the header, the rail and the tree follow focusIdAtom.
      const focusCell = (id: string) => {
          if (globalStore.get(model.focusIdAtom) !== id) {
              globalStore.set(model.focusIdAtom, id);
          }
      };
  ```
  and on the cell wrapper (Task 19). Before:
  ```tsx
                                              data-agent-focused={cell?.focused && multi ? "true" : undefined}
                                              style={cell != null ? placementStyle(cell.placement) : undefined}
  ```
  After:
  ```tsx
                                              data-agent-focused={cell?.focused && multi ? "true" : undefined}
                                              style={cell != null ? placementStyle(cell.placement) : undefined}
                                              onMouseDownCapture={() => focusCell(a.id)}
                                              onFocus={() => focusCell(a.id)}
  ```
  `onMouseDownCapture` covers a click anywhere in the cell, the bar included (so dragging a cell's bar focuses it
  first), and `onFocus` (React's bubbling focus) covers Tab or a programmatic focus of its terminal. The existing
  arrival and canvas effects focus the *focused* agent's terminal, so they only ever re-set the id already set.
- [ ] **Step 4: Say it where the next reader will look**
  In `frontend/app/store/keybindings/bindings.ts`, before the `cycle-agent-next` binding. Before:
  ```ts
          {
              id: "cycle-agent-next",
              keys: "Ctrl:Tab",
  ```
  After:
  ```ts
          {
              // Every keyboard way of moving between agents (this, the arrows and j/k in buildAgentBindings) only writes
              // focusIdAtom. AgentSurface turns that into the grid rule (agentgrid.ts focusAgent): the agent's cell
              // takes focus if it has one, otherwise the agent replaces the focused cell. Nothing here knows about the grid.
              id: "cycle-agent-next",
              keys: "Ctrl:Tab",
  ```
- [ ] **Step 5: The palette's Open in split (the keyboard route)**
  The context menu is mouse-only; a palette action is reachable from the keyboard (Ctrl+P, an agent row, `->`).
  In `frontend/app/cockpit/actions/agent.ts` add the import
  `import { openInSplit } from "@/app/view/agents/gridstore";` (after the `focusstore` import) and, after the
  `agent:review` action (before `agent:nudge`), add:
  ```ts
      {
          id: "agent:split",
          label: "Open in split",
          group: "open",
          applies: ({ agent }) => live(agent),
          // a new cell beside the focused one; when it cannot (already a cell, grid full) it just opens the agent
          run: ({ agent }, { model }) => {
              if (openInSplit(model, agent.id)) {
                  globalStore.set(model.surfaceAtom, "agent");
              } else {
                  model.openTerminal(agent.id);
              }
          },
      },
  ```
  In `frontend/app/cockpit/actions/agent.test.ts` add the import
  `import { endedWorkerId } from "@/app/view/agents/runlineage";` and, inside `describe("agent actions", ...)` after the
  "offers Review changes" test:
  ```ts
      it("offers Open in split for a live agent with a terminal, not a finished worker or a card with no block", () => {
          expect(applies("agent:split", thing())).toBe(true);
          expect(applies("agent:split", thing({ blockId: undefined }))).toBe(false);
          expect(applies("agent:split", thing({ id: endedWorkerId("r1", "t1") }))).toBe(false);
      });
  ```
  Run: `npx vitest run frontend/app/cockpit/actions/agent.test.ts`
  Expected: PASS (the existing tests are unaffected: none counts the actions).
- [ ] **Step 6: Document the grid and the rule**
  In `docs/keyboard-shortcuts.md`, insert before the `### Agent: canvas mode` heading:
  ```md
  ### Agent: terminal grid

  Drag a live agent from the tree onto a terminal to split the view (up to four cells), or right-click its row and pick
  **Open in split** (the palette has it too: `Ctrl`+`P`, the agent, `→`). Each cell has a bar you can drag to rearrange it;
  the `×` on it takes the agent out of the grid and leaves it running. The header and the details rail follow the focused
  cell; click a cell to focus it.

  Moving between agents with the keyboard follows one rule: if the agent already has a cell, that cell takes focus;
  otherwise the agent replaces the focused cell and the others stay put.

  | Keys | Action |
  |---|---|
  | `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab`, `j` / `k`, `←` / `→` | Next / previous agent, by the rule above |
  | `f` / `F11` | Fullscreen shows only the focused cell; the grid returns when you leave it |

  Canvas mode, the subagent view, a done worker's transcript, and a terminal focused from the rail's Terminals section
  also show one thing; the grid comes back as it was.
  ```
  In `AGENTS.md`, under "Load-bearing rules", insert this bullet right after the bullet that ends
  `the always-mounted shell, not in a surface.`:
  ```md
  - **The Agent surface's terminal stack is one CSS grid parent that is always rendered, never conditionally.** Every live
    agent's `CockpitFocusPane` stays mounted under it with a stable `key`; `agentgrid.ts` / `gridstore.ts` only decide which
    panes show and where (inline `gridRow`/`gridColumn`; the rest `hidden`). Re-parenting a pane or rendering the stack
    conditionally remounts the xterm and replays the TUI. Panes refit through `term.tsx`'s ResizeObserver, so the tracks
    stay `minmax(0, 1fr)` (`grid-cols-2 grid-rows-2`), cells keep `min-w-0 min-h-0`, and nothing animates a cell's size.
  ```
- [ ] **Step 7: Commit**
  ```
  git add frontend/app/view/agents/agentsurface.tsx frontend/app/view/agents/agentgridfocus.test.ts frontend/app/store/keybindings/bindings.ts frontend/app/cockpit/actions/agent.ts frontend/app/cockpit/actions/agent.test.ts docs/keyboard-shortcuts.md AGENTS.md
  git commit -m "feat(agent): one focus rule for clicks, cells and keyboard; palette Open in split" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 22: CDP scenario `agent-grid`

**Depends on:** Task 19, Task 20, Task 21
**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (new `agentGrid` and its helpers above `export const SCENARIOS`, registered in the array)

How it works, and how it differs from `agent-tree-rail` / `canvas-swap`:

- It needs five **live agents with real terminals**. `canvas-swap` opens a plain terminal (`CreateTab` + `setmeta`),
  which is a *terminal*, not a grid-eligible agent. This scenario does the same five times and then makes each tab an
  agent by publishing the `agent:status` event a Claude Code hook would (`eventpublish`, `persist: 1`, the
  `AgentStatusData` fields `oref`, `state`, `agent`, `title`, `ts`), exactly what `wsh agentstatus` publishes. The
  roster then carries them through the real pipeline (`liveAgentBaseAtom`), so the rows, panes and the grid are the
  real ones. It skips (does not fail) while a cockpit fixture roster is active, because the dev roster then replaces the
  live one.
- The grid is read from `localStorage` once per page load, so a clean start writes an empty grid and reloads
  (`freshBoot`, as `agent-tree-rail` does for its keys). Teardown puts the previous value back, after the tabs have
  closed and the roster has settled, and reloads.
- A native drag cannot be started over CDP without a pointer, so the drag is dispatched in the page: `dragstart` on the
  real source (a tree row or a cell bar), then `dragenter`/`dragover`/`drop` on the overlay the app drew, with one
  `DataTransfer` carrying the custom MIME. The handlers under test cannot tell it from a real drag. The overlay
  existing at all after `dragstart` proves the overlay is drag-driven.
- **No remount** is proved with marks, as `canvas-swap` does: an attribute on each pane wrapper and on its `.xterm`,
  checked after every shape change. A remount drops both.
- **Refit** is proved from geometry (`window.term` is gone, so no buffer reads): each visible pane's `.xterm-screen` must
  fit its `.term-connectelem` to within a character cell plus the scrollbar gutter, in both directions. A pane that
  changed size and did not refit is off by half a cell width or more.
- **Garbling** cannot be asserted from the DOM; the shots (`agent-grid-2/3/4/collapsed.png`) are for a human to look at.

- [ ] **Step 1: Add the helpers and the scenario**
  Insert immediately above `export const SCENARIOS = [` in `scripts/cdp/scenarios.mjs`:
  ```js
  // --- the agent grid: up to four terminals side by side, none of them remounted -----------------------------------
  // Needs a live app (task dev). It opens five plain terminals and makes each an agent by publishing the agent:status
  // event a Claude Code hook would, because the grid holds live agents and a bare shell is not one. The roster, the
  // tree rows and the panes are then the real ones. The drag is dispatched in the page (a DataTransfer carrying the
  // custom MIME, on the real row or bar and then on the overlay the app drew), because a native drag needs a pointer.
  // Refit is proved from geometry and identity from DOM marks; garbling is for the shots.
  const GRID_KEY = "agent.grid";
  const GRID_PROJECT = "verify-grid";
  const GRID_NAMES = ["grid-a", "grid-b", "grid-c", "grid-d", "grid-e"];
  const GRID_MARK = "agent-grid";
  // the cell's ResizeObserver, the 50ms fit debounce, then the PTY resync
  const GRID_SETTLE_MS = 800;
  // a fit leaves under one character cell of slack, plus the scrollbar gutter
  const GRID_FIT_SLACK_PX = 40;
  // where in the overlay each zone's point sits (an edge is the outer quarter)
  const GRID_ZONE_AT = { center: [0.5, 0.5], left: [0.1, 0.5], right: [0.9, 0.5], top: [0.5, 0.1], bottom: [0.5, 0.9] };
  const gridRow = (id) => `[data-agent-row="${id}"]`;
  const gridBar = (id) => `[data-agent-cell-bar="${id}"]`;
  const gridNear = (a, b, tol = 4) => Math.abs(a - b) <= tol;
  const gridSameSize = (a, b) => gridNear(a.w, b.w) && gridNear(a.h, b.h);

  // a plain terminal that reports as a Claude agent; the tab id is the agent id
  async function openGridAgent(h, ctx, name) {
      const tabId = await waveService(h, "workspace", "CreateTab", [ctx.workspaceId, name, false]);
      ctx.tabIds.push(tabId);
      const tab = await waveService(h, "object", "GetObject", [`tab:${tabId}`]);
      const blockId = tab?.blockids?.[0];
      if (!blockId) throw new Error(`the tab for ${name} has no block`);
      // the shell starts in ~, not a temp dir: something in the app tree keeps its cwd locked until the app exits
      await h.rpc("setmeta", { oref: `block:${blockId}`, meta: { view: "term", controller: "shell", "cmd:cwd": "~" } });
      await h.rpc("setmeta", { oref: `tab:${tabId}`, meta: { "session:project": GRID_PROJECT } });
      await h.rpc("eventpublish", {
          event: "agent:status",
          scopes: [`block:${blockId}`],
          persist: 1,
          data: { oref: `block:${blockId}`, state: "working", agent: "claude", title: name, ts: Date.now() },
      });
      return { name, tabId, blockId };
  }

  // the grid as drawn: every visible cell in order, with its box, and whether the tree is up
  const gridLayout = (h) =>
      h.ev(`(() => {
          const grid = document.querySelector("[data-agent-grid]");
          const box = (el) => {
              const r = el.getBoundingClientRect();
              return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          };
          const cells = [...document.querySelectorAll("[data-agent-cell]")]
              .sort((a, b) => Number(a.getAttribute("data-agent-cell")) - Number(b.getAttribute("data-agent-cell")))
              .map((c) => ({
                  id: c.getAttribute("data-agent-terminal"),
                  focused: c.getAttribute("data-agent-focused") === "true",
                  bar: !!c.querySelector("[data-agent-cell-bar]"),
                  ...box(c),
              }));
          return {
              shown: !!grid && !grid.classList.contains("hidden"),
              count: grid ? Number(grid.getAttribute("data-agent-grid-count")) : null,
              tree: !!document.querySelector("[data-agent-tree]"),
              cells,
          };
      })()`);

  // each visible pane's xterm screen against the box the terminal fits itself to
  const gridFit = (h) =>
      h.ev(`(() => [...document.querySelectorAll("[data-agent-cell]")].map((c) => {
          const id = c.getAttribute("data-agent-terminal");
          const host = c.querySelector(".term-connectelem");
          const screen = c.querySelector(".xterm-screen");
          if (!host || !screen) return { id, dw: null, dh: null };
          const hr = host.getBoundingClientRect();
          const sr = screen.getBoundingClientRect();
          return { id, dw: Math.round(hr.width - sr.width), dh: Math.round(hr.height - sr.height) };
      }))()`);
  const gridFitOk = (fit) =>
      fit.length > 0 &&
      fit.every(
          (f) => f.dw != null && f.dw >= -1 && f.dw < GRID_FIT_SLACK_PX && f.dh >= -1 && f.dh < GRID_FIT_SLACK_PX
      );

  // tagged before any shape change: a remount drops the attribute with the node
  const tagGridPanes = (h, ids) =>
      h.ev(`(() => {
          for (const id of ${JSON.stringify(ids)}) {
              const cell = document.querySelector('[data-agent-terminal="' + id + '"]');
              cell?.setAttribute("data-verify-mark", ${JSON.stringify(GRID_MARK)});
              cell?.querySelector(".xterm")?.setAttribute("data-verify-mark", ${JSON.stringify(GRID_MARK)});
          }
          return true;
      })()`);
  const gridMarks = (h, ids) =>
      h.ev(`(() => ${JSON.stringify(ids)}.map((id) => {
          const cell = document.querySelector('[data-agent-terminal="' + id + '"]');
          const xterm = cell?.querySelector(".xterm");
          return {
              id,
              cell: cell?.getAttribute("data-verify-mark") === ${JSON.stringify(GRID_MARK)},
              xterm: xterm == null ? null : xterm.getAttribute("data-verify-mark") === ${JSON.stringify(GRID_MARK)},
          };
      }))()`);
  const gridMarksOk = (marks) => marks.every((m) => m.cell === true && m.xterm !== false);

  // dragstart on the source, then the drag events on the overlay over `target`, at the point of `zone`
  async function gridDrag(h, { source, target, zone }) {
      const [fx, fy] = GRID_ZONE_AT[zone];
      return h.ev(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const src = document.querySelector(${JSON.stringify(source)});
          if (!src) return { ok: false, why: "no drag source" };
          const dt = new DataTransfer();
          const fire = (el, type, x, y) =>
              el.dispatchEvent(
                  new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x ?? 0, clientY: y ?? 0 })
              );
          fire(src, "dragstart");
          const overlay = ${JSON.stringify(`[data-agent-drop-overlay="${target}"]`)};
          let ov = null;
          for (let i = 0; i < 20 && !ov; i++) {
              await wait(50);
              ov = document.querySelector(overlay);
          }
          if (!ov) {
              fire(src, "dragend");
              return { ok: false, why: "no drop overlay over the target cell" };
          }
          const r = ov.getBoundingClientRect();
          const x = r.left + r.width * ${fx};
          const y = r.top + r.height * ${fy};
          fire(ov, "dragenter", x, y);
          fire(ov, "dragover", x, y);
          await wait(80);
          const hint = ov.getAttribute("data-drop-zone");
          const zones = ov.getAttribute("data-drop-zones");
          fire(ov, "drop", x, y);
          fire(src, "dragend");
          return { ok: true, hint, zones };
      })()`);
  }

  const agentGrid = {
      name: "agent-grid",
      surface: "agent",
      async arrange(h) {
          const ctx = {
              tabIds: [],
              agents: [],
              prevGrid: await h.ev(`localStorage.getItem(${JSON.stringify(GRID_KEY)})`),
          };
          if (existsSync(TREE_RAIL_FIXTURE)) {
              ctx.skip =
                  "a cockpit fixture roster is active, so the agents this scenario launches never reach the tree: run `npm run cockpit:fixtures -- --clear` and reload";
              return ctx;
          }
          // a throw past this point still returns ctx, so teardown closes whatever was already opened
          try {
              const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
              const wslist = await h.rpc("workspacelist", null);
              const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
              ctx.workspaceId = ws.workspacedata.oid;
              for (const name of GRID_NAMES) ctx.agents.push(await openGridAgent(h, ctx, name));
              // the grid is read from storage once per page load, so a clean start needs a reload
              await h.ev(
                  `localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify({ ids: [], focused: null }))})`
              );
              ctx.booted = await freshBoot(h);
              await h.goto("agent");
              ctx.inRoster = await polishWaitFor(
                  h,
                  `${JSON.stringify(ctx.agents.map((a) => a.tabId))}.every((id) => !!document.querySelector('[data-agent-row="' + id + '"]') && !!document.querySelector('[data-agent-terminal="' + id + '"]'))`,
                  20000
              );
          } catch (e) {
              ctx.arrangeError = String(e?.message ?? e);
          }
          return ctx;
      },
      async assert(h, ctx) {
          if (ctx.skip) {
              return [skipStep("the agent grid", ctx.skip)];
          }
          const steps = [];
          const rec = (step, ok, detail) =>
              steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
          const click = (selector) =>
              h.ev(`(() => {
                  const el = document.querySelector(${JSON.stringify(selector)});
                  if (!el) return false;
                  el.click();
                  return true;
              })()`);
          const settle = () => polishNap(GRID_SETTLE_MS);
          const cellAt = (lay, id) => lay.cells.find((c) => c.id === id) ?? {};
          const order = (lay) => JSON.stringify(lay.cells.map((c) => c.id));
          const want = (...ids) => JSON.stringify(ids);
          const fitStep = async (label) => {
              const fit = await gridFit(h);
              rec(label, gridFitOk(fit), fit);
          };
          const markStep = async (label, ids) => {
              const marks = await gridMarks(h, ids);
              rec(label, gridMarksOk(marks), marks);
          };

          rec(
              "0. five live agents are in the tree and each has a pane",
              ctx.arrangeError == null && ctx.inRoster === true && ctx.agents.length === GRID_NAMES.length,
              ctx.arrangeError ?? `agents=${ctx.agents.length} inRoster=${ctx.inRoster}`
          );
          if (ctx.arrangeError != null || ctx.inRoster !== true) return steps;
          const [A, B, C, D, E] = ctx.agents.map((a) => a.tabId);
          const ALL = [A, B, C, D, E];

          // 1. one agent, no cells to speak of
          await click(gridRow(A));
          await settle();
          let lay = await gridLayout(h);
          rec(
              "1. a click on a row shows that agent alone, with no cell bars",
              lay.shown && lay.count === 1 && order(lay) === want(A) && lay.cells.every((c) => !c.bar),
              lay
          );
          await tagGridPanes(h, ALL);

          // 2. two cells, side by side
          const d2 = await gridDrag(h, { source: gridRow(B), target: A, zone: "right" });
          await settle();
          lay = await gridLayout(h);
          rec(
              "2. dropping B on A's right edge gives two cells side by side and focuses B",
              d2.ok === true &&
                  lay.count === 2 &&
                  order(lay) === want(A, B) &&
                  cellAt(lay, B).focused === true &&
                  cellAt(lay, A).x < cellAt(lay, B).x &&
                  gridNear(cellAt(lay, A).y, cellAt(lay, B).y) &&
                  gridSameSize(cellAt(lay, A), cellAt(lay, B)) &&
                  lay.cells.every((c) => c.bar),
              { drag: d2, lay }
          );
          await fitStep("2b. both terminals refit to their cell");
          await h.shot("cdp-shots/agent-grid-2.png");

          // 3. three cells: two on top, one spanning the bottom
          const d3 = await gridDrag(h, { source: gridRow(C), target: B, zone: "right" });
          await settle();
          lay = await gridLayout(h);
          rec(
              "3. dropping C after B gives two on top and one spanning the bottom",
              d3.ok === true &&
                  lay.count === 3 &&
                  order(lay) === want(A, B, C) &&
                  cellAt(lay, C).focused === true &&
                  gridNear(cellAt(lay, A).y, cellAt(lay, B).y) &&
                  cellAt(lay, C).y >= cellAt(lay, A).y + cellAt(lay, A).h - 2 &&
                  gridNear(cellAt(lay, C).x, cellAt(lay, A).x) &&
                  cellAt(lay, C).w > cellAt(lay, A).w * 1.8,
              { drag: d3, lay }
          );
          await fitStep("3b. all three terminals refit, the spanning one included");
          await markStep("3c. no terminal was remounted by the shape change", ALL);
          await h.shot("cdp-shots/agent-grid-3.png");

          // 4. four cells, 2x2
          const d4 = await gridDrag(h, { source: gridRow(D), target: C, zone: "right" });
          await settle();
          const lay4 = await gridLayout(h);
          rec(
              "4. dropping D after C gives a 2x2",
              d4.ok === true &&
                  lay4.count === 4 &&
                  order(lay4) === want(A, B, C, D) &&
                  [B, C, D].every((id) => gridSameSize(cellAt(lay4, id), cellAt(lay4, A))) &&
                  gridNear(cellAt(lay4, B).y, cellAt(lay4, A).y) &&
                  gridNear(cellAt(lay4, C).x, cellAt(lay4, A).x) &&
                  cellAt(lay4, D).x > cellAt(lay4, C).x &&
                  cellAt(lay4, D).y > cellAt(lay4, B).y,
              { drag: d4, lay: lay4 }
          );
          await fitStep("4b. all four terminals refit");
          await h.shot("cdp-shots/agent-grid-4.png");

          // 5. a full grid offers only the swap; a bar is the handle for rearranging
          const d5 = await gridDrag(h, { source: gridBar(D), target: A, zone: "left" });
          await settle();
          lay = await gridLayout(h);
          rec(
              "5. at four cells the overlay offers only the centre, and a bar dropped on A swaps D and A",
              d5.ok === true &&
                  d5.zones === "center" &&
                  d5.hint === "center" &&
                  order(lay) === want(D, B, C, A) &&
                  gridNear(cellAt(lay, D).x, cellAt(lay4, A).x) &&
                  gridNear(cellAt(lay, D).y, cellAt(lay4, A).y) &&
                  gridNear(cellAt(lay, A).x, cellAt(lay4, D).x) &&
                  gridNear(cellAt(lay, A).y, cellAt(lay4, D).y),
              { drag: d5, lay }
          );
          await markStep("5b. swapping cells remounted nothing", ALL);

          // 6. a fifth agent can only replace
          const d6 = await gridDrag(h, { source: gridRow(E), target: B, zone: "center" });
          await settle();
          lay = await gridLayout(h);
          rec(
              "6. dropping E on B at four cells replaces B, which leaves the grid but keeps running",
              d6.ok === true && d6.zones === "center" && order(lay) === want(D, E, C, A),
              { drag: d6, lay }
          );
          await markStep("6b. B's terminal is hidden, not unmounted, and nothing remounted", ALL);

          // 7. the x takes a cell out
          const removed = await click(`[data-agent-cell-remove="${C}"]`);
          await settle();
          lay = await gridLayout(h);
          rec(
              "7. the x on C's bar leaves three cells: D and E on top, A spanning the bottom",
              removed === true &&
                  lay.count === 3 &&
                  order(lay) === want(D, E, A) &&
                  gridSameSize(cellAt(lay, D), cellAt(lay, E)) &&
                  cellAt(lay, A).y > cellAt(lay, D).y &&
                  cellAt(lay, A).w > cellAt(lay, D).w * 1.8,
              lay
          );
          await fitStep("7b. the remaining terminals refit");
          await markStep("7c. C's terminal is hidden, not unmounted, and nothing remounted", ALL);

          // 8. the focus rule from the tree
          await click(gridRow(B));
          await settle();
          lay = await gridLayout(h);
          rec(
              "8. a row whose agent has no cell replaces the focused cell",
              order(lay) === want(D, B, A) && cellAt(lay, B).focused === true,
              lay
          );
          await click(gridRow(D));
          await settle();
          lay = await gridLayout(h);
          rec(
              "8b. a row whose agent has a cell focuses that cell and leaves the list alone",
              order(lay) === want(D, B, A) && cellAt(lay, D).focused === true,
              lay
          );

          // 9. fullscreen shows the focused cell alone and brings the grid back
          const fsOn = await click('[data-agent-header] button[title^="Fullscreen terminal"]');
          await settle();
          lay = await gridLayout(h);
          rec(
              "9. fullscreen collapses the grid to the focused cell and hides the tree",
              fsOn === true && lay.count === 1 && order(lay) === want(D) && lay.tree === false,
              lay
          );
          await fitStep("9b. the one cell refits to the whole area");
          await markStep("9c. fullscreen remounted nothing", ALL);
          await h.shot("cdp-shots/agent-grid-collapsed.png");
          const fsOff = await click('[data-agent-header] button[title^="Exit fullscreen"]');
          await settle();
          lay = await gridLayout(h);
          rec(
              "9d. leaving fullscreen restores the three cells and the tree",
              fsOff === true && lay.count === 3 && order(lay) === want(D, B, A) && lay.tree === true,
              lay
          );
          await fitStep("9e. the three terminals refit again");

          // 10. the grid survives a reload (the saved grid is read before the roster is complete)
          ctx.reloaded = await freshBoot(h);
          await h.goto("agent");
          const back = await polishWaitFor(
              h,
              `document.querySelector("[data-agent-grid]")?.getAttribute("data-agent-grid-count") === "3"`,
              20000
          );
          lay = await gridLayout(h);
          rec(
              "10. after a reload the same three cells come back in order, focused on D",
              ctx.reloaded === true && back && order(lay) === want(D, B, A) && cellAt(lay, D).focused === true,
              { reloaded: ctx.reloaded, back, lay }
          );
          await h.shot("cdp-shots/agent-grid-reloaded.png");
          return steps;
      },
      // best-effort, so one failed step does not strand the rest
      async teardown(h, ctx) {
          const step = async (what, fn) => {
              try {
                  await fn();
              } catch (e) {
                  console.error(`agent-grid teardown: ${what} failed: ${e?.message ?? e}`);
              }
          };
          if (ctx.skip) return;
          for (const tabId of ctx.tabIds) {
              await step(`close ${tabId}`, () => waveService(h, "workspace", "CloseTab", [ctx.workspaceId, tabId, false]));
          }
          // the surface prunes the closed agents out of the saved grid as the roster catches up; put the user's grid
          // back only after that has settled, or the prune would write over it
          await step("let the roster settle", () => polishNap(1500));
          await step("restore the saved grid", () => h.ev(restoreStorageKey(GRID_KEY, ctx.prevGrid)));
          await step("reload onto the live roster", async () => {
              await h.ev("location.reload()");
              await polishNap(2500);
          });
      },
  };
  ```
- [ ] **Step 2: Register it**
  In the `SCENARIOS` array, after `canvasTabsScenario,` add `agentGrid,`. (If Stage 2 already added
  `agentRailSections,` after it, put `agentGrid,` after that.)
- [ ] **Step 3: Run it**
  **Requires `task dev` running** (the user's app; the scenario launches five terminals in the window under test,
  reloads it twice, and closes them and restores `agent.grid` afterwards). Do not move the mouse during the run.
  `task verify:ui -- agent-grid`
  Expected: PASS for steps 0 to 10 (a SKIP means a fixture roster is active). Open `cdp-shots/index.html` and look at
  `agent-grid-2.png`, `agent-grid-3.png`, `agent-grid-4.png` (two on top and one spanning; 2x2; the focused cell has the
  accent border, the others `border-edge-mid`; each shell prompt is drawn at the width of its cell, not clipped or
  floating in a wider box), `agent-grid-collapsed.png` and `agent-grid-reloaded.png`.
  Reading failures: step 1 failing with `lay.shown=false` means the pane was not the focused one (the row click did not
  take); a step 2/3/4 `drag.why = "no drop overlay..."` means `dragstart` did not set `agentDragAtom` (check
  `onDragStart` on the row and `beginAgentDrag`); a `b` step failing with `fit` values in the hundreds is a stale fit
  (the observer did not fire: check `minmax(0, 1fr)` and `min-w-0 min-h-0`); a `markStep` failing means a pane was
  re-keyed or re-parented (the grid parent was rendered conditionally, or the bar moved the pane's child slot).
- [ ] **Step 4: Run the neighbours**
  `task verify:ui -- canvas-swap tui-fullscreen agent-tree-rail`
  Expected: unchanged results from before this stage.
- [ ] **Step 5: Commit**
  ```
  git add scripts/cdp/scenarios.mjs
  git commit -m "test(cdp): agent-grid scenario" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
  ```

---

### Task 23: Uploads store (records, dedupe, expiry, persistence)

**Depends on:** Task 22
**Files:**
- Create: `frontend/app/view/agents/uploadsstore.ts`
- Test: `frontend/app/view/agents/uploadsstore.test.ts`

Conventions followed: a persisted map seeded from `localStorage` at module load with `globalThis.localStorage?` guards
(`ratelimitstore.ts`), an `atomFamily` for the per-owner read (`canvasstore.ts`), tests that mock `globalThis.localStorage`
(`ratelimitstore.test.ts`). Key `agent.uploads`. A record is `{id, name, path, kind, source, ts}`; the thumbnail is not part
of it: it lives in `uploadThumbsAtom` keyed by path and is never written to storage.

> NOTE: the spec's "per-entity jotai atom family, persisted without thumbnails" is built as one persisted map atom
> (`uploadsMapAtom`: one storage key, one write per record) with an `atomFamily` (`uploadsAtom(blockId)`) as the per-owner
> read. A family of persisted atoms would be one storage key per agent for the same behaviour. The map is capped at 50
> records per owner and 40 owners, newest kept, so a closed agent's block id does not stay in storage for ever.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/view/agents/uploadsstore.test.ts`:
```ts
import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    addRecord,
    baseName,
    isExpired,
    kindForName,
    makeRecord,
    MAX_OWNERS,
    MAX_RECORDS_PER_OWNER,
    parseStored,
    pasteTextFor,
    planInserts,
    pruneOwners,
    pruneThumbs,
    quotePath,
    recordUpload,
    rowState,
    serialize,
    TEMP_RETENTION_MS,
    UPLOADS_STORAGE_KEY,
    uploadsAtom,
    uploadsMapAtom,
    uploadThumbsAtom,
    type UploadRecord,
} from "./uploadsstore";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function rec(over: Partial<UploadRecord> = {}): UploadRecord {
    return {
        id: "r1",
        name: "a.png",
        path: "C:\\tmp\\waveterm-attach-1\\a.png",
        kind: "image",
        source: "paste",
        ts: NOW,
        ...over,
    };
}

function mockLocalStorage(initial: Record<string, string> = {}): Record<string, string> {
    const store: Record<string, string> = { ...initial };
    (globalThis as any).localStorage = {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
            store[k] = v;
        },
        removeItem: (k: string) => {
            delete store[k];
        },
    };
    return store;
}

describe("baseName", () => {
    it("takes the last segment of a Windows or POSIX path", () => {
        expect(baseName("C:\\Users\\me\\a b.png")).toBe("a b.png");
        expect(baseName("/tmp/x/y.txt")).toBe("y.txt");
    });
    it("ignores a trailing separator and passes a bare name through", () => {
        expect(baseName("/tmp/dir/")).toBe("dir");
        expect(baseName("plain.txt")).toBe("plain.txt");
    });
});

describe("kindForName", () => {
    it("reads an image extension in any case", () => {
        expect(kindForName("photo.PNG")).toBe("image");
        expect(kindForName("shot.jpeg")).toBe("image");
    });
    it("calls everything else a file", () => {
        expect(kindForName("README")).toBe("file");
        expect(kindForName("archive.png.zip")).toBe("file");
        expect(kindForName("notes.pdf")).toBe("file");
    });
});

describe("isExpired", () => {
    it("keeps a fresh paste or drop", () => {
        expect(isExpired(rec({ ts: NOW }), NOW)).toBe(false);
        expect(isExpired(rec({ source: "drop", ts: NOW - 23 * HOUR }), NOW)).toBe(false);
    });
    it("expires a paste or drop only once it is older than the retention", () => {
        expect(isExpired(rec({ ts: NOW - TEMP_RETENTION_MS }), NOW)).toBe(false);
        expect(isExpired(rec({ ts: NOW - TEMP_RETENTION_MS - 1 }), NOW)).toBe(true);
        expect(isExpired(rec({ source: "drop", ts: NOW - 25 * HOUR }), NOW)).toBe(true);
    });
    it("never expires an attach, however old", () => {
        expect(isExpired(rec({ source: "attach", ts: NOW - 90 * 24 * HOUR }), NOW)).toBe(false);
    });
});

describe("quotePath and pasteTextFor", () => {
    it("leaves a path with no space alone", () => {
        expect(quotePath("C:\\tmp\\a.png")).toBe("C:\\tmp\\a.png");
    });
    it("double-quotes a path with a space", () => {
        expect(quotePath("C:\\Users\\Jo Doe\\a.png")).toBe('"C:\\Users\\Jo Doe\\a.png"');
        expect(quotePath("/home/jo/my file.txt")).toBe('"/home/jo/my file.txt"');
    });
    it("drops control characters, so a name cannot press Enter", () => {
        expect(quotePath("/tmp/a\nb.txt")).toBe("/tmp/ab.txt");
    });
    it("ends the paste with a space and never a newline", () => {
        expect(pasteTextFor("/tmp/a.png")).toBe("/tmp/a.png ");
        expect(pasteTextFor("/tmp/a b.png")).toBe('"/tmp/a b.png" ');
        expect(pasteTextFor("/tmp/a.png")).not.toMatch(/[\r\n]/);
    });
});

describe("makeRecord", () => {
    it("derives the name and kind from the path", () => {
        const r = makeRecord({ path: "C:\\x\\shot.png", source: "attach", now: NOW, nonce: "abc" });
        expect(r).toEqual({
            id: `${NOW.toString(36)}-abc`,
            name: "shot.png",
            path: "C:\\x\\shot.png",
            kind: "image",
            source: "attach",
            ts: NOW,
        });
    });
    it("takes an explicit name and kind over the derived ones", () => {
        const r = makeRecord({ path: "/t/1/x", source: "drop", now: NOW, nonce: "n", name: " Report ", kind: "file" });
        expect(r.name).toBe("Report");
        expect(r.kind).toBe("file");
    });
    it("falls back to the base name when the given one is blank", () => {
        expect(makeRecord({ path: "/t/a.txt", source: "drop", now: NOW, nonce: "n", name: "  " }).name).toBe("a.txt");
    });
});

describe("addRecord", () => {
    it("puts the newest first", () => {
        const out = addRecord([rec({ id: "old", path: "/p/old" })], rec({ id: "new", path: "/p/new" }));
        expect(out.map((r) => r.id)).toEqual(["new", "old"]);
    });
    it("replaces an earlier record of the same path and moves it to the front", () => {
        const list = [rec({ id: "a", path: "/p/a" }), rec({ id: "b", path: "/p/b" })];
        const out = addRecord(list, rec({ id: "b2", path: "/p/b", source: "attach", ts: NOW + 1 }));
        expect(out.map((r) => r.id)).toEqual(["b2", "a"]);
        expect(out[0].source).toBe("attach");
    });
    it("caps the list, dropping the oldest", () => {
        let list: UploadRecord[] = [];
        for (let i = 0; i < MAX_RECORDS_PER_OWNER + 5; i++) {
            list = addRecord(list, rec({ id: `r${i}`, path: `/p/${i}` }));
        }
        expect(list).toHaveLength(MAX_RECORDS_PER_OWNER);
        expect(list[0].id).toBe(`r${MAX_RECORDS_PER_OWNER + 4}`);
    });
});

describe("pruneOwners", () => {
    it("leaves a map within the limit as it is", () => {
        const map = { a: [rec()] };
        expect(pruneOwners(map, 2)).toBe(map);
    });
    it("keeps the owners with the newest records", () => {
        const map = {
            old: [rec({ ts: NOW - 3 * HOUR })],
            mid: [rec({ ts: NOW - HOUR })],
            fresh: [rec({ ts: NOW })],
        };
        expect(Object.keys(pruneOwners(map, 2)).sort()).toEqual(["fresh", "mid"]);
    });
});

describe("pruneThumbs", () => {
    it("drops a thumbnail no record points at and keeps the rest", () => {
        const map = { b1: [rec({ path: "/p/a.png" })] };
        expect(pruneThumbs({ "/p/a.png": "t1", "/p/gone.png": "t2" }, map)).toEqual({ "/p/a.png": "t1" });
    });
    it("returns the same object when nothing is dropped", () => {
        const thumbs = { "/p/a.png": "t1" };
        expect(pruneThumbs(thumbs, { b1: [rec({ path: "/p/a.png" })] })).toBe(thumbs);
    });
});

describe("parseStored", () => {
    it("reads nothing, garbage and a non-object as empty", () => {
        expect(parseStored(null)).toEqual({});
        expect(parseStored("")).toEqual({});
        expect(parseStored("{not json")).toEqual({});
        expect(parseStored("[1,2]")).toEqual({});
        expect(parseStored("7")).toEqual({});
    });
    it("round-trips what serialize wrote", () => {
        const map = { b1: [rec({ id: "a", path: "/p/a" }), rec({ id: "b", path: "/p/b", source: "attach" })] };
        expect(parseStored(serialize(map))).toEqual(map);
    });
    it("drops a malformed record and an owner left with none", () => {
        const raw = JSON.stringify({
            b1: [rec(), { id: "x" }, { ...rec({ id: "y" }), kind: "movie" }, { ...rec({ id: "z" }), ts: "soon" }],
            b2: [{ nope: true }],
            b3: "not a list",
        });
        const out = parseStored(raw);
        expect(Object.keys(out)).toEqual(["b1"]);
        expect(out.b1.map((r) => r.id)).toEqual(["r1"]);
    });
    it("keeps only the record fields, so a stored thumbnail cannot come back", () => {
        const raw = JSON.stringify({ b1: [{ ...rec(), thumb: "data:image/png;base64,AAAA" }] });
        expect(parseStored(raw).b1[0]).toEqual(rec());
        expect(JSON.stringify(parseStored(raw))).not.toContain("data:image");
    });
    it("caps one owner's list and the number of owners", () => {
        const many = Array.from({ length: MAX_RECORDS_PER_OWNER + 10 }, (_, i) =>
            rec({ id: `r${i}`, path: `/p/${i}` })
        );
        expect(parseStored(JSON.stringify({ b1: many })).b1).toHaveLength(MAX_RECORDS_PER_OWNER);
        const owners = Object.fromEntries(
            Array.from({ length: MAX_OWNERS + 3 }, (_, i) => [
                `b${i}`,
                [rec({ id: `o${i}`, path: `/p/${i}`, ts: NOW + i })],
            ])
        );
        expect(Object.keys(parseStored(JSON.stringify(owners)))).toHaveLength(MAX_OWNERS);
    });
});

describe("rowState", () => {
    it("shows a thumbnail when there is one", () => {
        expect(rowState(rec(), NOW, true)).toEqual({ expired: false, icon: "thumb", enlargeable: true });
    });
    it("falls back to an image or file icon without a thumbnail", () => {
        expect(rowState(rec(), NOW, false).icon).toBe("image");
        expect(rowState(rec({ kind: "file", name: "a.pdf" }), NOW, false).icon).toBe("file");
    });
    it("does not offer to enlarge a file or an expired image", () => {
        expect(rowState(rec({ kind: "file" }), NOW, false).enlargeable).toBe(false);
        expect(rowState(rec({ ts: NOW - 2 * 24 * HOUR }), NOW, true)).toEqual({
            expired: true,
            icon: "thumb",
            enlargeable: false,
        });
    });
    it("keeps an old attached image enlargeable", () => {
        expect(rowState(rec({ source: "attach", ts: NOW - 9 * 24 * HOUR }), NOW, false).enlargeable).toBe(true);
    });
});

describe("planInserts", () => {
    it("makes one record and one paste per path, quoting the ones with spaces", () => {
        let n = 0;
        const plan = planInserts(
            ["C:\\x\\a b.png", "", "C:\\x\\a b.png", "C:\\x\\c.txt"],
            "attach",
            NOW,
            () => `n${n++}`
        );
        expect(plan.map((p) => p.text)).toEqual(['"C:\\x\\a b.png" ', "C:\\x\\c.txt "]);
        expect(plan.map((p) => p.record.source)).toEqual(["attach", "attach"]);
        expect(plan.map((p) => p.record.kind)).toEqual(["image", "file"]);
        expect(plan.map((p) => p.record.name)).toEqual(["a b.png", "c.txt"]);
        expect(new Set(plan.map((p) => p.record.id)).size).toBe(2);
    });
    it("plans nothing for no paths", () => {
        expect(planInserts([], "attach", NOW, () => "n")).toEqual([]);
    });
});

describe("recordUpload", () => {
    let store: Record<string, string>;
    beforeEach(() => {
        store = mockLocalStorage();
        globalStore.set(uploadsMapAtom, {});
        globalStore.set(uploadThumbsAtom, {});
    });
    afterEach(() => {
        delete (globalThis as any).localStorage;
    });

    it("reads an owner with nothing as an empty list", () => {
        expect(globalStore.get(uploadsAtom("nobody"))).toEqual([]);
    });
    it("lists the record under its owner and persists it", () => {
        recordUpload("b1", rec());
        expect(globalStore.get(uploadsAtom("b1"))).toEqual([rec()]);
        expect(globalStore.get(uploadsAtom("b2"))).toEqual([]);
        expect(parseStored(store[UPLOADS_STORAGE_KEY])).toEqual({ b1: [rec()] });
    });
    it("keeps the thumbnail in memory and never writes it to storage", () => {
        recordUpload("b1", rec(), "data:image/png;base64,AAAA");
        expect(globalStore.get(uploadThumbsAtom)).toEqual({ [rec().path]: "data:image/png;base64,AAAA" });
        expect(store[UPLOADS_STORAGE_KEY]).not.toContain("data:image");
        expect(store[UPLOADS_STORAGE_KEY]).not.toContain("AAAA");
    });
    it("drops the thumbnail of a record the cap pushed out", () => {
        recordUpload("b1", rec({ id: "first", path: "/p/first.png" }), "t1");
        for (let i = 0; i < MAX_RECORDS_PER_OWNER; i++) {
            recordUpload("b1", rec({ id: `y${i}`, path: `/p/y${i}.png` }));
        }
        expect(globalStore.get(uploadThumbsAtom)).toEqual({});
    });
    it("lists a repeated path once", () => {
        recordUpload("b1", rec({ id: "a" }));
        recordUpload("b1", rec({ id: "b", source: "attach" }));
        expect(globalStore.get(uploadsAtom("b1")).map((r) => r.id)).toEqual(["b"]);
    });
    it("still works in memory when storage is unavailable", () => {
        delete (globalThis as any).localStorage;
        recordUpload("b1", rec());
        expect(globalStore.get(uploadsAtom("b1"))).toEqual([rec()]);
    });
    it("still works when storage throws", () => {
        (globalThis as any).localStorage = {
            getItem: () => null,
            setItem: () => {
                throw new Error("quota");
            },
        };
        expect(() => recordUpload("b1", rec())).not.toThrow();
        expect(globalStore.get(uploadsAtom("b1"))).toEqual([rec()]);
    });
});

describe("module load", () => {
    afterEach(() => {
        delete (globalThis as any).localStorage;
        vi.resetModules();
    });
    it("starts from what an earlier session stored", async () => {
        mockLocalStorage({ [UPLOADS_STORAGE_KEY]: serialize({ b9: [rec({ id: "old" })] }) });
        vi.resetModules();
        const fresh = await import("./uploadsstore");
        const { globalStore: freshStore } = await import("@/app/store/jotaiStore");
        expect(freshStore.get(fresh.uploadsAtom("b9"))).toEqual([rec({ id: "old" })]);
    });
});
```
- [ ] **Step 2: Run it and watch it fail**

`npx vitest run frontend/app/view/agents/uploadsstore.test.ts`
Expected: the suite fails to load, `Error: Cannot find module './uploadsstore'`.
- [ ] **Step 3: Implement the store**

Create `frontend/app/view/agents/uploadsstore.ts`:
```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What went into each agent's terminal as a file: an image pasted, files dropped on the terminal, files picked
// with Attach. Keyed by the agent's terminal block id (AgentVM.blockId): the paste hook in termwrap.ts knows its
// block but not the agent (the tab it was handed is the cockpit's own), and a live agent owns exactly one block.
//
// Records persist to localStorage WITHOUT thumbnails: the downscaled picture of an image lives in memory only,
// keyed by path, and after a reload a record shows a generic icon. A pasted or dropped file is a temp copy the
// server sweeps after 24h (tempAttachRetention in pkg/wshrpc/wshserver/wshserver_files.go), so its record then
// reads "expired"; an attached file is the user's own and never expires.
//
// Imports only jotai and the global store, so termwrap.ts can import it without an import cycle.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";

export type UploadKind = "image" | "file";
export type UploadSource = "paste" | "drop" | "attach";

export interface UploadRecord {
    id: string;
    name: string;
    path: string;
    kind: UploadKind;
    source: UploadSource;
    ts: number; // epoch ms the record was made
}

// owner (terminal block id) -> its records, newest first
export type UploadsByOwner = Record<string, UploadRecord[]>;

export const UPLOADS_STORAGE_KEY = "agent.uploads";
// tempAttachRetention on the server; a record older than this is a temp copy that has been swept
export const TEMP_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_RECORDS_PER_OWNER = 50;
export const MAX_OWNERS = 40;

const IMAGE_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "svg",
    "avif",
    "ico",
    "tif",
    "tiff",
    "heic",
    "heif",
]);
const KINDS: readonly string[] = ["image", "file"];
const SOURCES: readonly string[] = ["paste", "drop", "attach"];

export function baseName(path: string): string {
    const trimmed = path.replace(/[\\/]+$/, "");
    return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

export function kindForName(name: string): UploadKind {
    const dot = name.lastIndexOf(".");
    return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase()) ? "image" : "file";
}

// a paste or drop is a temp copy the server deletes after a day; an attach points at the user's own file
export function isExpired(record: UploadRecord, now: number): boolean {
    return record.source !== "attach" && now - record.ts > TEMP_RETENTION_MS;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

// A path goes into the prompt as typed text. Double-quoted when it has a space, the way a terminal quotes a
// dropped file and the form Claude Code unwraps; control characters are dropped, since terminal.paste turns a
// newline into Enter.
export function quotePath(path: string): string {
    const clean = path.replace(CONTROL_CHARS, "");
    return /\s/.test(clean) ? `"${clean}"` : clean;
}

// the trailing space is for the next word; Claude Code trims a pasted path before it looks for an image
export function pasteTextFor(path: string): string {
    return `${quotePath(path)} `;
}

export function makeRecord(input: {
    path: string;
    source: UploadSource;
    now: number;
    nonce: string; // random, from the caller, so this stays pure
    name?: string;
    kind?: UploadKind;
}): UploadRecord {
    const name = input.name?.trim() || baseName(input.path) || input.path;
    return {
        id: `${input.now.toString(36)}-${input.nonce}`,
        name,
        path: input.path,
        kind: input.kind ?? kindForName(name),
        source: input.source,
        ts: input.now,
    };
}

// Newest first. The same path again replaces its earlier record, so a re-attach refreshes it instead of listing twice.
export function addRecord(
    list: readonly UploadRecord[],
    record: UploadRecord,
    cap = MAX_RECORDS_PER_OWNER
): UploadRecord[] {
    return [record, ...list.filter((r) => r.path !== record.path)].slice(0, cap);
}

// keeps the owners whose newest record is newest; a closed agent's block id would otherwise stay in storage forever
export function pruneOwners(map: UploadsByOwner, max = MAX_OWNERS): UploadsByOwner {
    const owners = Object.keys(map);
    if (owners.length <= max) {
        return map;
    }
    const newest = (owner: string) => map[owner][0]?.ts ?? 0;
    const keep = owners.sort((a, b) => newest(b) - newest(a)).slice(0, max);
    return Object.fromEntries(keep.map((owner) => [owner, map[owner]]));
}

// a thumbnail is kept only while some record still points at its path
export function pruneThumbs(thumbs: Record<string, string>, map: UploadsByOwner): Record<string, string> {
    const live = new Set<string>();
    for (const list of Object.values(map)) {
        for (const r of list) {
            live.add(r.path);
        }
    }
    const keys = Object.keys(thumbs);
    if (keys.every((k) => live.has(k))) {
        return thumbs;
    }
    return Object.fromEntries(keys.filter((k) => live.has(k)).map((k) => [k, thumbs[k]]));
}

function isStoredRecord(v: unknown): v is UploadRecord {
    if (v == null || typeof v !== "object") {
        return false;
    }
    const r = v as Record<string, unknown>;
    return (
        typeof r.id === "string" &&
        r.id !== "" &&
        typeof r.name === "string" &&
        r.name !== "" &&
        typeof r.path === "string" &&
        r.path !== "" &&
        typeof r.kind === "string" &&
        KINDS.includes(r.kind) &&
        typeof r.source === "string" &&
        SOURCES.includes(r.source) &&
        typeof r.ts === "number" &&
        Number.isFinite(r.ts)
    );
}

// what a hand-edited or older value could hold is dropped; only the six record fields are kept, so nothing else
// (a thumbnail, say) can ride in from storage
export function parseStored(raw: string | null | undefined): UploadsByOwner {
    if (!raw) {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
    }
    const out: UploadsByOwner = {};
    for (const [owner, list] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Array.isArray(list)) {
            continue;
        }
        const records = list
            .filter(isStoredRecord)
            .slice(0, MAX_RECORDS_PER_OWNER)
            .map((r) => ({ id: r.id, name: r.name, path: r.path, kind: r.kind, source: r.source, ts: r.ts }));
        if (records.length > 0) {
            out[owner] = records;
        }
    }
    return pruneOwners(out);
}

export function serialize(map: UploadsByOwner): string {
    return JSON.stringify(map);
}

export interface UploadRowState {
    expired: boolean;
    icon: "thumb" | "image" | "file";
    enlargeable: boolean; // an image whose file is still there
}

export function rowState(record: UploadRecord, now: number, hasThumb: boolean): UploadRowState {
    const expired = isExpired(record, now);
    return {
        expired,
        icon: hasThumb ? "thumb" : record.kind === "image" ? "image" : "file",
        enlargeable: record.kind === "image" && !expired,
    };
}

export interface PlannedInsert {
    record: UploadRecord;
    text: string; // what goes into the terminal as a paste
}

// Real paths (Attach): one record and one paste per path, in order, a repeated or empty path skipped.
export function planInserts(
    paths: readonly string[],
    source: UploadSource,
    now: number,
    nonce: () => string
): PlannedInsert[] {
    const seen = new Set<string>();
    const out: PlannedInsert[] = [];
    for (const path of paths) {
        if (!path || seen.has(path)) {
            continue;
        }
        seen.add(path);
        out.push({ record: makeRecord({ path, source, now, nonce: nonce() }), text: pasteTextFor(path) });
    }
    return out;
}

function readStored(): UploadsByOwner {
    try {
        return parseStored(globalThis.localStorage?.getItem(UPLOADS_STORAGE_KEY));
    } catch {
        return {};
    }
}

function writeStored(map: UploadsByOwner): void {
    try {
        globalThis.localStorage?.setItem(UPLOADS_STORAGE_KEY, serialize(map));
    } catch {
        // quota or a restricted webview: the atom still serves this session
    }
}

// seeded from localStorage at module load, so a reload still lists what was uploaded
export const uploadsMapAtom = atom<UploadsByOwner>(readStored()) as PrimitiveAtom<UploadsByOwner>;

// path -> a data URL of the downscaled image; memory only, never persisted
export const uploadThumbsAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

const NONE: UploadRecord[] = [];

// one agent's uploads, by its terminal block id
export const uploadsAtom = atomFamily((owner: string) => atom((get) => get(uploadsMapAtom)[owner] ?? NONE));

export function recordUpload(owner: string, record: UploadRecord, thumb?: string | null): void {
    const prev = globalStore.get(uploadsMapAtom);
    const next = pruneOwners({ ...prev, [owner]: addRecord(prev[owner] ?? [], record) });
    globalStore.set(uploadsMapAtom, next);
    writeStored(next);
    globalStore.set(uploadThumbsAtom, (thumbs) =>
        pruneThumbs(thumb ? { ...thumbs, [record.path]: thumb } : thumbs, next)
    );
}
```
- [ ] **Step 4: Run it and watch it pass**

`npx vitest run frontend/app/view/agents/uploadsstore.test.ts`
Expected: `Test Files 1 passed`, `Tests 40 passed`.
- [ ] **Step 5: Check formatting of the two new files**

`npx prettier --check frontend/app/view/agents/uploadsstore.ts frontend/app/view/agents/uploadsstore.test.ts`
Expected: `All matched files use Prettier code style!` (check only; never `--write` the tree).
- [ ] **Step 6: Commit**

```
git add frontend/app/view/agents/uploadsstore.ts frontend/app/view/agents/uploadsstore.test.ts
git commit -m "feat(uploads): per-agent upload records with dedupe, expiry and storage without thumbnails" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 24: Upload file rules, `createTempFileFromFile` and the thumbnail

**Depends on:** Task 22
**Files:**
- Create: `frontend/app/view/agents/uploadfile.ts`
- Create: `frontend/app/view/agents/uploadthumb.ts`
- Modify: `frontend/app/view/term/termutil.ts` (`createTempFileFromBlob`, new `writeTempFile` and `createTempFileFromFile`)
- Test: `frontend/app/view/agents/uploadfile.test.ts`

`uploadfile.ts` holds everything about a file that does not need the DOM or an RPC: the 5 MB cap (`MAX_UPLOAD_BYTES`, the
same cap `createTempFileFromBlob` has), the over-cap and folder rejections (`UploadError`), `sanitizeFileName` (a temp copy
keeps the file's own name, cleaned for Windows), `isFileDrag` (an OS drag carries `Files` and never the grid's agent MIME),
`collectDroppedFiles` (a dropped folder arrives as an empty `File`, so the items' own `webkitGetAsEntry().isDirectory`
decides, with the empty-typeless-file guess only as a fallback), `rejectionToast`, and `thumbSize`.

> NOTE: the agent MIME is Stage 3's: `isFileDrag` calls `isAgentDrag` and the test reads `AGENT_DRAG_MIME`, both from
> `frontend/app/view/agents/griddrop.ts` (Task 20, `application/x-arc-agent`). If S3 renamed them, change the two imports.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/view/agents/uploadfile.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { AGENT_DRAG_MIME } from "./griddrop";
import {
    checkUploadFile,
    collectDroppedFiles,
    isFileDrag,
    MAX_UPLOAD_BYTES,
    rejectionToast,
    sanitizeFileName,
    thumbSize,
    UploadError,
    type DropItemLike,
} from "./uploadfile";

const file = (name: string, size = 10, type = "text/plain") => new File([new Uint8Array(size)], name, { type });

// isDirectory undefined: a webview without the entry API
function item(f: File | null, isDirectory?: boolean): DropItemLike {
    return {
        kind: "file",
        getAsFile: () => f,
        webkitGetAsEntry: isDirectory === undefined ? undefined : () => ({ isDirectory, name: f?.name ?? "" }),
    };
}

describe("checkUploadFile", () => {
    it("takes a file up to the cap", () => {
        expect(checkUploadFile({ size: 0 })).toBeNull();
        expect(checkUploadFile({ size: MAX_UPLOAD_BYTES })).toBeNull();
    });
    it("refuses one byte over", () => {
        expect(checkUploadFile({ size: MAX_UPLOAD_BYTES + 1 })).toBe("too-large");
    });
});

describe("UploadError", () => {
    it("carries the code and the file, with a message that names both", () => {
        const e = new UploadError("too-large", "big.bin");
        expect(e).toBeInstanceOf(Error);
        expect(e.code).toBe("too-large");
        expect(e.fileName).toBe("big.bin");
        expect(e.message).toBe("big.bin is over 5 MB");
        expect(new UploadError("directory", "src").message).toBe("src is a folder");
    });
});

describe("sanitizeFileName", () => {
    it("keeps an ordinary name, spaces included", () => {
        expect(sanitizeFileName("notes with space.txt")).toBe("notes with space.txt");
    });
    it("drops any directory part", () => {
        expect(sanitizeFileName("a/b\\c.png")).toBe("c.png");
        expect(sanitizeFileName("C:\\Users\\me\\d.png")).toBe("d.png");
    });
    it("replaces what Windows refuses", () => {
        expect(sanitizeFileName("we:ird*name?.txt")).toBe("we_ird_name_.txt");
        expect(sanitizeFileName("tab\there.txt")).toBe("tab_here.txt");
    });
    it("trims trailing dots and spaces and falls back when nothing is left", () => {
        expect(sanitizeFileName("x. ")).toBe("x");
        expect(sanitizeFileName(" .. ")).toBe("file");
        expect(sanitizeFileName("")).toBe("file");
    });
    it("moves a Windows device name out of the way", () => {
        expect(sanitizeFileName("CON.txt")).toBe("_CON.txt");
        expect(sanitizeFileName("nul")).toBe("_nul");
        expect(sanitizeFileName("console.txt")).toBe("console.txt");
    });
    it("shortens a long name but keeps its extension", () => {
        const out = sanitizeFileName(`${"a".repeat(300)}.pdf`);
        expect(out.length).toBe(120);
        expect(out.endsWith(".pdf")).toBe(true);
    });
});

describe("isFileDrag", () => {
    it("is true for an OS file drag", () => {
        expect(isFileDrag(["Files"])).toBe(true);
    });
    it("is false for a drag with no files", () => {
        expect(isFileDrag(["text/plain"])).toBe(false);
        expect(isFileDrag([])).toBe(false);
    });
    it("is false when the drag is an agent row, whatever else rides with it", () => {
        expect(isFileDrag([AGENT_DRAG_MIME])).toBe(false);
        expect(isFileDrag(["Files", AGENT_DRAG_MIME])).toBe(false);
    });
});

describe("collectDroppedFiles", () => {
    it("takes plain files and ignores string items", () => {
        const a = file("a.txt");
        const dropped = collectDroppedFiles([item(a, false), { kind: "string", getAsFile: () => null }], [a]);
        expect(dropped.files).toEqual([a]);
        expect(dropped.rejected).toEqual([]);
    });
    it("refuses a folder by its entry and names it", () => {
        const dropped = collectDroppedFiles([item(file("src", 0, ""), true)], []);
        expect(dropped.files).toEqual([]);
        expect(dropped.rejected).toEqual([{ name: "src", code: "directory" }]);
    });
    it("takes an empty regular file when the entry says it is not a folder", () => {
        const empty = file("empty.txt", 0, "");
        expect(collectDroppedFiles([item(empty, false)], []).files).toEqual([empty]);
    });
    it("refuses a file over the cap", () => {
        const big = file("big.bin", MAX_UPLOAD_BYTES + 1, "application/octet-stream");
        const dropped = collectDroppedFiles([item(big, false)], []);
        expect(dropped.rejected).toEqual([{ name: "big.bin", code: "too-large" }]);
    });
    it("keeps the good files of a mixed drop", () => {
        const a = file("a.txt");
        const dropped = collectDroppedFiles([item(file("dir", 0, ""), true), item(a, false)], []);
        expect(dropped.files).toEqual([a]);
        expect(dropped.rejected).toHaveLength(1);
    });
    it("without the entry API, reads an empty typeless file as a folder", () => {
        const dropped = collectDroppedFiles([item(file("src", 0, ""))], []);
        expect(dropped.rejected).toEqual([{ name: "src", code: "directory" }]);
    });
    it("falls back to the file list when there are no items", () => {
        const a = file("a.txt");
        expect(collectDroppedFiles(null, [a]).files).toEqual([a]);
        expect(collectDroppedFiles([], [file("src", 0, "")]).rejected).toEqual([{ name: "src", code: "directory" }]);
    });
});

describe("rejectionToast", () => {
    it("says nothing when nothing was refused", () => {
        expect(rejectionToast([])).toBeNull();
    });
    it("names a single file and points at Attach for a big one", () => {
        const t = rejectionToast([{ name: "big.bin", code: "too-large" }]);
        expect(t?.title).toBe("Couldn't add big.bin");
        expect(t?.message).toContain("over 5 MB");
        expect(t?.message).toContain("+ Attach");
    });
    it("explains a folder", () => {
        expect(rejectionToast([{ name: "src", code: "directory" }])?.message).toContain("Folders can't be dropped");
    });
    it("folds several refusals into one toast with the counts", () => {
        const t = rejectionToast([
            { name: "a", code: "too-large" },
            { name: "b", code: "too-large" },
            { name: "c", code: "directory" },
        ]);
        expect(t?.title).toBe("3 items weren't added");
        expect(t?.message).toContain("2 over 5 MB, 1 folder");
        expect(t?.message).toContain("+ Attach");
    });
});

describe("thumbSize", () => {
    it("scales the longer side to the maximum", () => {
        expect(thumbSize(960, 480)).toEqual({ width: 96, height: 48 });
        expect(thumbSize(480, 960)).toEqual({ width: 48, height: 96 });
    });
    it("never enlarges", () => {
        expect(thumbSize(50, 40)).toEqual({ width: 50, height: 40 });
    });
    it("keeps a sliver at least one pixel", () => {
        expect(thumbSize(10000, 1)).toEqual({ width: 96, height: 1 });
    });
    it("treats a missing size as one pixel", () => {
        expect(thumbSize(0, 10)).toEqual({ width: 1, height: 1 });
    });
});
```
- [ ] **Step 2: Run it and watch it fail**

`npx vitest run frontend/app/view/agents/uploadfile.test.ts`
Expected: `Error: Cannot find module './uploadfile'`.
- [ ] **Step 3: Implement the rules**

Create `frontend/app/view/agents/uploadfile.ts`:
```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure rules for turning an OS file into an upload: what is too big, what is a folder, what name its temp
// copy gets, how an OS file drag is told from an agent drag, what the toast says when a file is refused, and how
// big a thumbnail is. No DOM and no RPC, so uploadfile.test.ts covers it. The callers that touch the world are
// termutil.ts (createTempFileFromFile), uploadthumb.ts and uploadsingest.ts.

import { isAgentDrag } from "./griddrop";

const MB = 1024 * 1024;

// the same cap createTempFileFromBlob puts on a pasted image
export const MAX_UPLOAD_BYTES = 5 * MB;
export const THUMB_MAX_PX = 96;
// a bigger source is not decoded just for a 96px picture; its row falls back to the generic icon
export const THUMB_SOURCE_LIMIT_BYTES = 10 * MB;

export type UploadRejection = "too-large" | "directory" | "error";

export interface Rejection {
    name: string;
    code: UploadRejection;
}

function rejectionReason(code: UploadRejection, name: string): string {
    switch (code) {
        case "too-large":
            return `${name} is over ${MAX_UPLOAD_BYTES / MB} MB`;
        case "directory":
            return `${name} is a folder`;
        default:
            return `could not copy ${name} to a temporary file`;
    }
}

export class UploadError extends Error {
    readonly code: UploadRejection;
    readonly fileName: string;

    constructor(code: UploadRejection, fileName: string) {
        super(rejectionReason(code, fileName));
        this.name = "UploadError";
        this.code = code;
        this.fileName = fileName;
    }
}

export function checkUploadFile(f: { size: number }): UploadRejection | null {
    return f.size > MAX_UPLOAD_BYTES ? "too-large" : null;
}

// A temp copy keeps the file's own name (WriteTempFileCommand gives every file its own directory, so names cannot
// collide), cleaned for the OS: Windows refuses < > : " | ? * and control characters and the device names, and
// drops trailing dots and spaces.
const MAX_NAME_CHARS = 120;
// eslint-disable-next-line no-control-regex
const WINDOWS_ILLEGAL = /[<>:"|?*\x00-\x1f]/g;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function sanitizeFileName(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? "";
    let clean = base
        .replace(WINDOWS_ILLEGAL, "_")
        .replace(/[. ]+$/, "")
        .trim();
    if (clean === "" || /^\.+$/.test(clean)) {
        return "file";
    }
    if (RESERVED_NAME.test(clean)) {
        clean = `_${clean}`;
    }
    if (clean.length <= MAX_NAME_CHARS) {
        return clean;
    }
    const dot = clean.lastIndexOf(".");
    const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : "";
    return clean.slice(0, MAX_NAME_CHARS - ext.length) + ext;
}

// a file drag from the OS: it carries "Files", and never the grid's agent MIME (griddrop.ts, Stage 3)
export function isFileDrag(types: readonly string[]): boolean {
    return types.includes("Files") && !isAgentDrag(types);
}

// the part of a DataTransferItem collectDroppedFiles reads; the real one satisfies it
export interface DropItemLike {
    kind: string;
    getAsFile(): File | null;
    webkitGetAsEntry?(): { isDirectory: boolean; name: string } | null;
}

export interface DroppedFiles {
    files: File[];
    rejected: Rejection[];
}

function classifyFile(file: File, trustedNotFolder: boolean, out: DroppedFiles): void {
    // a dropped folder arrives as an empty File; without the entry API to say so, an empty typeless one is taken as a folder
    if (!trustedNotFolder && file.size === 0 && file.type === "") {
        out.rejected.push({ name: file.name, code: "directory" });
    } else if (checkUploadFile(file) != null) {
        out.rejected.push({ name: file.name, code: "too-large" });
    } else {
        out.files.push(file);
    }
}

// Reads a drop synchronously (a DataTransferItem is only valid while the drop event runs): the items, which know
// a folder from a file, else the plain file list.
export function collectDroppedFiles(
    items: ArrayLike<DropItemLike> | null | undefined,
    files: ArrayLike<File> | null | undefined
): DroppedFiles {
    const out: DroppedFiles = { files: [], rejected: [] };
    const fileItems = Array.from(items ?? []).filter((i) => i.kind === "file");
    if (fileItems.length === 0) {
        for (const file of Array.from(files ?? [])) {
            classifyFile(file, false, out);
        }
        return out;
    }
    for (const item of fileItems) {
        const entry = item.webkitGetAsEntry?.() ?? null;
        const file = item.getAsFile();
        if (entry?.isDirectory) {
            out.rejected.push({ name: file?.name || entry.name || "folder", code: "directory" });
        } else if (file != null) {
            classifyFile(file, entry != null, out);
        }
    }
    return out;
}

const MAX_MB = MAX_UPLOAD_BYTES / MB;
const ONE_REJECTION: Record<UploadRejection, string> = {
    "too-large": `It is over ${MAX_MB} MB. Use + Attach in the Uploads panel to insert its path instead.`,
    directory: "Folders can't be dropped. Drop the files inside it, or use + Attach.",
    error: "Copying it to a temporary file failed.",
};

// what to tell the user about everything a drop could not take, as one toast; null when nothing was refused
export function rejectionToast(rejected: readonly Rejection[]): { title: string; message: string } | null {
    if (rejected.length === 0) {
        return null;
    }
    if (rejected.length === 1) {
        return { title: `Couldn't add ${rejected[0].name}`, message: ONE_REJECTION[rejected[0].code] };
    }
    const count = (code: UploadRejection) => rejected.filter((r) => r.code === code).length;
    const parts: string[] = [];
    if (count("too-large") > 0) {
        parts.push(`${count("too-large")} over ${MAX_MB} MB`);
    }
    if (count("directory") > 0) {
        parts.push(`${count("directory")} ${count("directory") === 1 ? "folder" : "folders"}`);
    }
    if (count("error") > 0) {
        parts.push(`${count("error")} failed to copy`);
    }
    return {
        title: `${rejected.length} items weren't added`,
        message: `${parts.join(", ")}. Use + Attach to insert large files by path; folders can't be dropped.`,
    };
}

// the longer side scales to max and the picture is never enlarged
export function thumbSize(width: number, height: number, max = THUMB_MAX_PX): { width: number; height: number } {
    if (!(width > 0) || !(height > 0)) {
        return { width: 1, height: 1 };
    }
    const scale = Math.min(1, max / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
```
- [ ] **Step 4: Run it and watch it pass**

`npx vitest run frontend/app/view/agents/uploadfile.test.ts`
Expected: `Tests 27 passed`.
- [ ] **Step 5: Add `createTempFileFromFile` to `termutil.ts`**

Two edits to `frontend/app/view/term/termutil.ts`, anchored on `createTempFileFromBlob`. The first adds the import.
Replace:
```ts
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
```
with:
```ts
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { checkUploadFile, sanitizeFileName, UploadError } from "@/app/view/agents/uploadfile";
```
The second moves the byte-writing tail of `createTempFileFromBlob` into a shared `writeTempFile` (the blob path behaves as before)
and adds the file variant. Replace:
```ts
    const filename = `waveterm_paste_${timestamp}_${random}.${ext}`;

    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
    });

    const base64Data = base64.fromByteArray(new Uint8Array(arrayBuffer));

    // Write image to temp file and get path
    const tempPath = await RpcApi.WriteTempFileCommand(TabRpcClient, {
        filename,
        data64: base64Data,
    });

    return tempPath;
}
```
with:
```ts
    const filename = `waveterm_paste_${timestamp}_${random}.${ext}`;

    return writeTempFile(filename, blob);
}

// Writes the blob's bytes to a file called `filename` in a fresh temp directory (WriteTempFileCommand makes one
// per call, so two files with the same name never collide) and returns its path.
async function writeTempFile(filename: string, blob: Blob): Promise<string> {
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
    });

    const base64Data = base64.fromByteArray(new Uint8Array(arrayBuffer));

    return RpcApi.WriteTempFileCommand(TabRpcClient, {
        filename,
        data64: base64Data,
    });
}

/**
 * Copies any file (one dropped from the OS, which arrives as a blob with no path) to a temporary file that keeps
 * its own name, and returns the path.
 *
 * @param file - The File to copy
 * @returns The path to the created temporary file
 * @throws UploadError if the file is over the 5MB cap (checkUploadFile)
 */
export async function createTempFileFromFile(file: File): Promise<string> {
    const rejection = checkUploadFile(file);
    if (rejection != null) {
        throw new UploadError(rejection, file.name);
    }
    return writeTempFile(sanitizeFileName(file.name), file);
}
```
- [ ] **Step 6: Create the thumbnail helper**

Create `frontend/app/view/agents/uploadthumb.ts` (canvas; `thumbSize` is the tested part):
```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The thumbnail of an uploaded image: decoded and downscaled to THUMB_MAX_PX on a canvas, returned as a data URL
// for uploadsstore's in-memory map. Best effort: a source that is too big, or that the webview cannot decode
// (HEIC, a broken file), gives null and the row shows a generic icon. The size rule is uploadfile.ts's thumbSize.

import { THUMB_SOURCE_LIMIT_BYTES, thumbSize } from "./uploadfile";

export async function makeThumbnail(image: Blob): Promise<string | null> {
    if (image.size > THUMB_SOURCE_LIMIT_BYTES) {
        return null;
    }
    try {
        const bitmap = await createImageBitmap(image);
        try {
            const { width, height } = thumbSize(bitmap.width, bitmap.height);
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (ctx == null) {
                return null;
            }
            ctx.drawImage(bitmap, 0, 0, width, height);
            return canvas.toDataURL("image/png");
        } finally {
            bitmap.close();
        }
    } catch {
        return null;
    }
}
```
- [ ] **Step 7: Check formatting of the new files**

`npx prettier --check frontend/app/view/agents/uploadfile.ts frontend/app/view/agents/uploadfile.test.ts frontend/app/view/agents/uploadthumb.ts`
Expected: `All matched files use Prettier code style!`
- [ ] **Step 8: Commit**

```
git add frontend/app/view/agents/uploadfile.ts frontend/app/view/agents/uploadfile.test.ts frontend/app/view/agents/uploadthumb.ts frontend/app/view/term/termutil.ts
git commit -m "feat(uploads): upload file rules, a temp copy for any dropped file, and a canvas thumbnail" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 25: Record on paste (`termpaste.ts`, `pasteHandler`, `uploadsingest.ts`)

**Depends on:** Task 23, Task 24
**Files:**
- Create: `frontend/app/view/term/termpaste.ts`
- Create: `frontend/app/view/agents/uploadsingest.ts`
- Modify: `frontend/app/view/term/termwrap.ts` (imports, constructor, `pasteHandler`)
- Test: `frontend/app/view/term/termpaste.test.ts`

`termpaste.ts` is a registry from block id to `{paste, focus}`. Each `TermWrap` registers itself in its constructor and
unregisters in `dispose()`; the drop and Attach glue then reaches any mounted terminal by `agent.blockId` through xterm's own
`paste()` (see the bracketed-paste note above) without importing `termwrap.ts`. The unregister only removes its own
registration, so a remount that registered the block first is not undone by the old terminal's late dispose.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/view/term/termpaste.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { focusTerm, pasteIntoTerm, registerTermHandle } from "./termpaste";

function handle() {
    return { paste: vi.fn(), focus: vi.fn() };
}

describe("pasteIntoTerm", () => {
    it("pastes through the registered terminal and says it did", () => {
        const h = handle();
        const off = registerTermHandle("pb-1", h);
        expect(pasteIntoTerm("pb-1", "/tmp/a.png ")).toBe(true);
        expect(h.paste).toHaveBeenCalledWith("/tmp/a.png ");
        off();
    });
    it("says so when the block has no mounted terminal", () => {
        expect(pasteIntoTerm("pb-none", "x")).toBe(false);
    });
    it("keeps blocks apart", () => {
        const a = handle();
        const b = handle();
        const offA = registerTermHandle("pb-a", a);
        const offB = registerTermHandle("pb-b", b);
        pasteIntoTerm("pb-b", "x");
        expect(a.paste).not.toHaveBeenCalled();
        expect(b.paste).toHaveBeenCalledOnce();
        offA();
        offB();
    });
});

describe("registerTermHandle", () => {
    it("stops reaching the terminal once unregistered", () => {
        const h = handle();
        registerTermHandle("pb-2", h)();
        expect(pasteIntoTerm("pb-2", "x")).toBe(false);
    });
    it("does not let a stale unregister remove the newer terminal of the same block", () => {
        const oldH = handle();
        const newH = handle();
        const offOld = registerTermHandle("pb-3", oldH);
        const offNew = registerTermHandle("pb-3", newH);
        offOld();
        expect(pasteIntoTerm("pb-3", "x")).toBe(true);
        expect(newH.paste).toHaveBeenCalledOnce();
        offNew();
    });
});

describe("focusTerm", () => {
    it("focuses the registered terminal and ignores an unknown block", () => {
        const h = handle();
        const off = registerTermHandle("pb-4", h);
        focusTerm("pb-4");
        focusTerm("pb-unknown");
        expect(h.focus).toHaveBeenCalledOnce();
        off();
    });
});
```
- [ ] **Step 2: Run it and watch it fail**

`npx vitest run frontend/app/view/term/termpaste.test.ts`
Expected: `Error: Cannot find module './termpaste'`.
- [ ] **Step 3: Implement the registry**

Create `frontend/app/view/term/termpaste.ts`:
```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reaches a mounted terminal by its block id, so the cockpit can put text into an agent's terminal the way a paste
// does: through xterm's own paste(), which brackets the text when the program asked for bracketed paste (Claude
// Code does) and sends it as typed text when it did not, and never presses Enter. Each TermWrap registers itself;
// the callers (uploadsingest.ts) never import termwrap.ts or the cockpit, so this module has no imports and no
// import cycle can run through it.

export interface TermHandle {
    paste: (text: string) => void;
    focus: () => void;
}

const handles = new Map<string, TermHandle>();

// returns the unregister; a remount that registered the block again first is left alone
export function registerTermHandle(blockId: string, handle: TermHandle): () => void {
    handles.set(blockId, handle);
    return () => {
        if (handles.get(blockId) === handle) {
            handles.delete(blockId);
        }
    };
}

// false when the block has no mounted terminal to take the text
export function pasteIntoTerm(blockId: string, text: string): boolean {
    const handle = handles.get(blockId);
    if (handle == null) {
        return false;
    }
    handle.paste(text);
    return true;
}

export function focusTerm(blockId: string): void {
    handles.get(blockId)?.focus();
}
```
- [ ] **Step 4: Run it and watch it pass**

`npx vitest run frontend/app/view/term/termpaste.test.ts`
Expected: `Tests 6 passed`.
- [ ] **Step 5: Create the glue, first function**

Create `frontend/app/view/agents/uploadsingest.ts`. Only `recordPastedImage` exists yet; Task 26 and Task 27 add the rest (the
header comment already names them):
```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Getting a file in front of an agent: an image pasted into its terminal (termwrap.ts calls recordPastedImage),
// files dropped on its terminal (focus-pane.tsx calls ingestFiles) and files picked with the Uploads section's
// Attach (pickAndAttach). Each way ends the same: the path goes into the terminal as a paste with no Enter, one
// paste per file so the TUI reads each as its own (Claude Code turns a lone image path into an attachment and
// leaves several in one paste as plain text), and the file is recorded in uploadsstore. Impure glue; the rules
// worth testing live in uploadfile.ts and uploadsstore.ts.

import { fireAndForget } from "@/util/util";
import { makeRecord, recordUpload } from "./uploadsstore";
import { makeThumbnail } from "./uploadthumb";

const nonce = () => Math.random().toString(36).slice(2, 8);

// termwrap.ts's pasteHandler has already written the image to a temp file and pasted its path
export function recordPastedImage(blockId: string, path: string, image: Blob): void {
    const now = Date.now();
    fireAndForget(async () => {
        const thumb = await makeThumbnail(image);
        recordUpload(blockId, makeRecord({ path, source: "paste", now, nonce: nonce(), kind: "image" }), thumb);
    });
}
```
- [ ] **Step 6: Wire `TermWrap`**

Five edits to `frontend/app/view/term/termwrap.ts`. In the constructor, `this.blockId` is already set when the registration
runs. `pasteHandler` keeps its one-image-per-paste loop; the only changes are that the pasted text goes through
`pasteTextFor` (a path with a space is now double-quoted; for a path without one it is the same `path + " "` as before) and
that the image is recorded after its path was pasted.

Replace (agents imports):
```ts
import { shouldRelaunchWorker } from "@/app/view/agents/session-models/agentresumestore";
```
with:
```ts
import { shouldRelaunchWorker } from "@/app/view/agents/session-models/agentresumestore";
import { recordPastedImage } from "@/app/view/agents/uploadsingest";
import { pasteTextFor } from "@/app/view/agents/uploadsstore";
```
Replace (term imports):
```ts
} from "./osc-handlers";
import {
    bufferLinesToText,
```
with:
```ts
} from "./osc-handlers";
import { registerTermHandle } from "./termpaste";
import {
    bufferLinesToText,
```
Replace (the drop guard's comment; the guard itself is unchanged and stays, it keeps the webview from navigating to a dropped
file):
```ts
        // a dropped file carries no path in the webview (native drag-drop is off so HTML5 drag works),
        // so there is nothing to paste; swallow the drop so the webview doesn't navigate to the file.
        const dropGuard = (e: DragEvent) => e.preventDefault();
```
with:
```ts
        // native drag-drop is off so HTML5 drag works, and a dropped file carries no path in the webview. The
        // drop bubbles up to CockpitFocusPane, which copies the file and pastes its path (uploadsingest.ts);
        // here it is only kept from navigating the webview to the file.
        const dropGuard = (e: DragEvent) => e.preventDefault();
```
Replace (end of the constructor):
```ts
                this.connectElem.removeEventListener("paste", pasteHandler, true);
            },
        });
    }
```
with:
```ts
                this.connectElem.removeEventListener("paste", pasteHandler, true);
            },
        });
        // lets the cockpit paste into this terminal by block id (the path of a dropped or attached file)
        this.toDispose.push({
            dispose: registerTermHandle(this.blockId, {
                paste: (text) => this.terminal.paste(text),
                focus: () => this.terminal.focus(),
            }),
        });
    }
```
Replace (in `pasteHandler`):
```ts
                    const tempPath = await createTempFileFromBlob(data.image);
                    this.terminal.paste(tempPath + " ");
                    firstImage = false;
```
with:
```ts
                    const tempPath = await createTempFileFromBlob(data.image);
                    this.terminal.paste(pasteTextFor(tempPath));
                    recordPastedImage(this.blockId, tempPath, data.image);
                    firstImage = false;
```
- [ ] **Step 7: Check `termwrap.ts` still loads through its real imports**

`npx vitest run frontend/app/view/term/term-model.test.ts`
Expected: `Tests 2 passed`. That suite imports `term-model.ts`, which imports `termwrap.ts` at runtime, so a bad import chain
from the new modules shows up here. The paste itself is checked end to end by the `agent-uploads` scenario (Task 29).
- [ ] **Step 8: Check formatting of the new files**

`npx prettier --check frontend/app/view/term/termpaste.ts frontend/app/view/term/termpaste.test.ts frontend/app/view/agents/uploadsingest.ts`
Expected: `All matched files use Prettier code style!`
- [ ] **Step 9: Commit**

```
git add frontend/app/view/term/termpaste.ts frontend/app/view/term/termpaste.test.ts frontend/app/view/agents/uploadsingest.ts frontend/app/view/term/termwrap.ts
git commit -m "feat(uploads): record a pasted image and let the cockpit paste into a terminal by block id" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 26: Drop OS files on a terminal

**Depends on:** Task 24, Task 25
**Files:**
- Modify: `frontend/app/view/agents/uploadsingest.ts` (`ingestFiles`)
- Modify: `frontend/app/cockpit/focus-pane.tsx` (`CockpitFocusPane`)

The window runs with `dragDropEnabled: false` (`src-tauri/tauri.conf.json`), so an OS drop is plain HTML5: a `drop` event with
`dataTransfer.files`, no paths. `CockpitFocusPane` is the one place every terminal is mounted through (Stage 3 renders each
grid cell's terminal through it), so the handler lives there and works for each cell: a file lands in the terminal it is dropped
on. A drag that carries `application/x-arc-agent` (an agent row, Stage 3) is not a file drag (`isFileDrag`), so the handler
ignores it; S3's zone overlay is a sibling of the pane that exists only during such a drag and answers only it, and an OS file
drag never carries that type, so the two never meet. `termwrap.ts`'s own `dropGuard` still runs first on the event's way up (it
only calls `preventDefault`, so the webview does not navigate to the file). A file that is refused (folder, over 5 MB, failed
copy) is named in one toast that points at Attach; the rest of the drop goes through.

- [ ] **Step 1: Add `ingestFiles` to the glue**

In `frontend/app/view/agents/uploadsingest.ts`, replace everything above the comment
`// termwrap.ts's pasteHandler has already written the image to a temp file and pasted its path` (the header comment, the
imports and the constants) with:
```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Getting a file in front of an agent: an image pasted into its terminal (termwrap.ts calls recordPastedImage),
// files dropped on its terminal (focus-pane.tsx calls ingestFiles) and files picked with the Uploads section's
// Attach (pickAndAttach). Each way ends the same: the path goes into the terminal as a paste with no Enter, one
// paste per file so the TUI reads each as its own (Claude Code turns a lone image path into an attachment and
// leaves several in one paste as plain text), and the file is recorded in uploadsstore. Impure glue; the rules
// worth testing live in uploadfile.ts and uploadsstore.ts.

import { pushToast } from "@/app/cockpit/notificationstore";
import { focusTerm, pasteIntoTerm } from "@/app/view/term/termpaste";
import { createTempFileFromFile } from "@/app/view/term/termutil";
import { fireAndForget } from "@/util/util";
import { rejectionToast, UploadError, type Rejection } from "./uploadfile";
import { makeRecord, pasteTextFor, recordUpload, type UploadKind } from "./uploadsstore";
import { makeThumbnail } from "./uploadthumb";

// the gap pasteHandler leaves between pasted images: two pastes back to back can reach a TUI as one
const PASTE_GAP_MS = 150;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nonce = () => Math.random().toString(36).slice(2, 8);
```
then append to the end of the file, after a blank line:
```ts
// the second and later pastes of one batch wait a beat; false when the agent has no terminal mounted to take it
async function deliver(blockId: string, text: string, notFirst: boolean): Promise<boolean> {
    if (notFirst) {
        await sleep(PASTE_GAP_MS);
    }
    return pasteIntoTerm(blockId, text);
}

function warnUnreachable(): void {
    pushToast({
        title: "No terminal to insert into",
        message: "The files were added, but this agent's terminal is not open.",
        level: "warn",
    });
}

// Files dropped on a terminal arrive as blobs with no path (the window's native drop is off so the grid's HTML5
// drag works): each is copied to a temp file and its path pasted. What could not be taken (a folder, a file over
// the cap, a failed copy) comes back as one toast.
export async function ingestFiles(
    blockId: string,
    files: readonly File[],
    rejected: readonly Rejection[]
): Promise<void> {
    const failed: Rejection[] = [...rejected];
    let inserted = 0;
    let unreachable = false;
    for (const file of files) {
        try {
            const path = await createTempFileFromFile(file);
            const kind: UploadKind | undefined = file.type.startsWith("image/") ? "image" : undefined;
            const record = makeRecord({ path, source: "drop", now: Date.now(), nonce: nonce(), kind });
            const thumb = record.kind === "image" ? await makeThumbnail(file) : null;
            if (!(await deliver(blockId, pasteTextFor(path), inserted > 0))) {
                unreachable = true;
            }
            recordUpload(blockId, record, thumb);
            inserted++;
        } catch (err) {
            failed.push({ name: file.name, code: err instanceof UploadError ? err.code : "error" });
            if (!(err instanceof UploadError)) {
                console.error("uploads: could not copy", file.name, err);
            }
        }
    }
    if (inserted > 0) {
        focusTerm(blockId);
    }
    const toast = rejectionToast(failed);
    if (toast != null) {
        pushToast({ ...toast, level: "warn" });
    }
    if (unreachable) {
        warnUnreachable();
    }
}
```
- [ ] **Step 2: Handle the drop in `CockpitFocusPane`**

Two edits to `frontend/app/cockpit/focus-pane.tsx`. Replace (header comment and imports):
```tsx
// model on blockId change and dispose the previous one to avoid leaking FE block routes.
import { makeViewModel } from "@/app/block/blockregistry";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { useEffect, useMemo, useRef } from "react";
import { makeSyntheticNodeModel } from "./synthetic-node-model";
```
with:
```tsx
// model on blockId change and dispose the previous one to avoid leaking FE block routes.
//
// It is also where OS files are dropped on a terminal: the drop copies each file to a temp file and pastes its
// path into this block's terminal (uploadsingest.ts). An agent row being dragged into the grid carries its own
// MIME and is left alone (isFileDrag).
import { makeViewModel } from "@/app/block/blockregistry";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { collectDroppedFiles, isFileDrag } from "@/app/view/agents/uploadfile";
import { ingestFiles } from "@/app/view/agents/uploadsingest";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { fireAndForget } from "@/util/util";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { makeSyntheticNodeModel } from "./synthetic-node-model";
```
Replace (the render):
```tsx
    const VC = model.viewComponent;
    return (
        <TabModelContext.Provider value={tabModel}>
            <div className="cockpit-focus-pane" ref={contentRef}>
                <VC blockId={blockId} blockRef={blockRef} contentRef={contentRef} model={model} />
            </div>
        </TabModelContext.Provider>
    );
}
```
with:
```tsx
    const VC = model.viewComponent;

    // an OS file over the pane: a drop hint while it is there, the files taken on drop
    const [fileOver, setFileOver] = useState(false);
    const onDragOver = (e: DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(e.dataTransfer.types)) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setFileOver(true);
    };
    const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFileOver(false);
        }
    };
    const onDrop = (e: DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(e.dataTransfer.types)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setFileOver(false);
        // read now: a DataTransferItem is only valid while this event runs
        const { files, rejected } = collectDroppedFiles(e.dataTransfer.items, e.dataTransfer.files);
        fireAndForget(() => ingestFiles(blockId, files, rejected));
    };

    return (
        <TabModelContext.Provider value={tabModel}>
            <div
                className="cockpit-focus-pane"
                ref={contentRef}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                <VC blockId={blockId} blockRef={blockRef} contentRef={contentRef} model={model} />
                {fileOver ? (
                    // only while an OS file is over the pane, and it takes no pointer events, so it never sits in
                    // the way of the terminal
                    <div
                        aria-hidden="true"
                        data-upload-drop=""
                        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border border-accent bg-accentbg"
                    >
                        <span className="rounded-[8px] bg-surface px-[12px] py-[6px] text-[12px] font-medium text-accent-soft">
                            Drop to add to this agent
                        </span>
                    </div>
                ) : null}
            </div>
        </TabModelContext.Provider>
    );
}
```
The hint is an overlay that exists only while an OS file is over the pane and takes no pointer events, so it is never over the
terminal outside a drag (the rule the grid's own overlay follows, applied here too).
- [ ] **Step 3: Check formatting**

`npx prettier --check frontend/app/view/agents/uploadsingest.ts frontend/app/cockpit/focus-pane.tsx`
Expected: `All matched files use Prettier code style!`
- [ ] **Step 4: Confirm the pure rules this relies on are still green**

`npx vitest run frontend/app/view/agents/uploadfile.test.ts`
Expected: `Tests 27 passed`. The wiring has no unit test (the repo has no render tests); the drop, the hint, the toast and the
agent-MIME case are exercised by `agent-uploads` in Task 29.
- [ ] **Step 5: Commit**

```
git add frontend/app/view/agents/uploadsingest.ts frontend/app/cockpit/focus-pane.tsx
git commit -m "feat(uploads): drop OS files on a terminal, copy them to temp files and paste their paths" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 27: Attach

**Depends on:** Task 26, Task 10, Task 14
**Files:**
- Modify: `frontend/app/view/agents/uploadsingest.ts` (`attachPaths`, `pickAndAttach`)
- Modify: `frontend/app/view/agents/railuploads.tsx` (`UploadsSection`, Stage 2's placeholder)
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx` (`AgentDetailsRail`)
- Modify: `scripts/cdp/scenarios.mjs` (`agentRailSections` step 4, Stage 2's)
- Test: `frontend/app/view/agents/uploadsstore.test.ts` (existing, `planInserts` covers the record and the paste text)

Attach opens `@tauri-apps/plugin-dialog`'s `open({ multiple: true })` (dynamic import, as `newprojectmodal.tsx` does;
`dialog:allow-open` is already in `src-tauri/capabilities/default.json`; with `multiple: true` and no `directory` it returns
`string[] | null`). The picked files keep their real paths: no copy, no size cap, `source: "attach"`, one paste per path,
quoted when it has a space. `planInserts` (tested in Task 23) is the record-and-text plan. After the paste the terminal gets focus,
so you keep typing at the prompt.

- [ ] **Step 1: Add Attach to the glue**

In `frontend/app/view/agents/uploadsingest.ts`, replace everything above the comment
`// termwrap.ts's pasteHandler has already written the image to a temp file and pasted its path` with:
```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Getting a file in front of an agent: an image pasted into its terminal (termwrap.ts calls recordPastedImage),
// files dropped on its terminal (focus-pane.tsx calls ingestFiles) and files picked with the Uploads section's
// Attach (pickAndAttach). Each way ends the same: the path goes into the terminal as a paste with no Enter, one
// paste per file so the TUI reads each as its own (Claude Code turns a lone image path into an attachment and
// leaves several in one paste as plain text), and the file is recorded in uploadsstore. Impure glue; the rules
// worth testing live in uploadfile.ts and uploadsstore.ts.

import { pushToast } from "@/app/cockpit/notificationstore";
import { localFileUrl } from "@/app/view/jarvis/localimage";
import { focusTerm, pasteIntoTerm } from "@/app/view/term/termpaste";
import { createTempFileFromFile } from "@/app/view/term/termutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { fireAndForget } from "@/util/util";
import { rejectionToast, THUMB_SOURCE_LIMIT_BYTES, UploadError, type Rejection } from "./uploadfile";
import { makeRecord, pasteTextFor, planInserts, recordUpload, type UploadKind } from "./uploadsstore";
import { makeThumbnail } from "./uploadthumb";

// the gap pasteHandler leaves between pasted images: two pastes back to back can reach a TUI as one
const PASTE_GAP_MS = 150;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nonce = () => Math.random().toString(36).slice(2, 8);
```
then append to the end of the file, after a blank line:
```ts
// the picture of an attached image is read back through wavesrv, the way the lightbox reads it
async function thumbnailForPath(path: string): Promise<string | null> {
    try {
        const resp = await fetch(localFileUrl(getWebServerEndpoint(), path));
        if (!resp.ok || Number(resp.headers.get("content-length") ?? 0) > THUMB_SOURCE_LIMIT_BYTES) {
            return null;
        }
        return await makeThumbnail(await resp.blob());
    } catch {
        return null;
    }
}

// Attach: the picked files keep their own paths, so there is no copy and no size cap.
export async function attachPaths(blockId: string, paths: readonly string[]): Promise<void> {
    const plan = planInserts(paths, "attach", Date.now(), nonce);
    let unreachable = false;
    for (const [i, { record, text }] of plan.entries()) {
        const thumb = record.kind === "image" ? await thumbnailForPath(record.path) : null;
        if (!(await deliver(blockId, text, i > 0))) {
            unreachable = true;
        }
        recordUpload(blockId, record, thumb);
    }
    if (plan.length > 0) {
        focusTerm(blockId);
    }
    if (unreachable) {
        warnUnreachable();
    }
}

export async function pickAndAttach(blockId: string): Promise<void> {
    try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({ multiple: true, directory: false, title: "Attach files" });
        const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
        if (paths.length > 0) {
            await attachPaths(blockId, paths);
        }
    } catch (err) {
        console.error("uploads: file picker failed", err);
        pushToast({ title: "Couldn't open the file picker", message: String(err), level: "error" });
    }
}
```
- [ ] **Step 2: Make Stage 2's Attach button real**

Replace the whole contents of `frontend/app/view/agents/railuploads.tsx` (Stage 2's placeholder: the empty-state text and a
disabled Attach). The hooks `data-rail-uploads` and `data-rail-attach` stay, since S2's scenario and Task 29 use them. The
section now reads this agent's records only to know whether to show the hint; Task 28 adds the list:
```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The details rail's Uploads section: the Attach button, then what was uploaded into this agent's terminal. Keyed by
// the agent's terminal block id (uploadsstore.ts). The section opens at 0 (emptyOpenable, agentrailsections.ts), so
// Attach is reachable before the first upload.

import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Plus } from "lucide-react";
import { pickAndAttach } from "./uploadsingest";
import { uploadsAtom } from "./uploadsstore";

export function UploadsSection({ blockId }: { blockId: string | undefined }) {
    const records = useAtomValue(uploadsAtom(blockId ?? ""));
    return (
        <div data-rail-uploads className="flex flex-col gap-[8px]">
            <button
                type="button"
                data-rail-attach
                disabled={!blockId}
                title={
                    blockId
                        ? "Pick files and insert their paths at this agent's prompt"
                        : "This agent has no terminal to attach to"
                }
                onClick={() => fireAndForget(() => pickAndAttach(blockId!))}
                className="inline-flex w-fit cursor-pointer items-center gap-[5px] rounded-[7px] border border-edge-mid px-[9px] py-[4px] text-[11px] font-semibold text-secondary hover:bg-surface-hover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            >
                <Plus size={12} aria-hidden />
                Attach
            </button>
            {records.length === 0 ? (
                <div className="text-[11.5px] text-muted">
                    Paste an image or drop files on the terminal, or attach them here.
                </div>
            ) : null}
        </div>
    );
}
```
- [ ] **Step 3: Wire `AgentDetailsRail`**

Four edits to `frontend/app/view/agents/agentdetailsrail.tsx`, anchored on what Stage 2 left there.

(a) After `import { loadSessionUsage } from "./transcriptusagestore";` add:
```ts
import { uploadsAtom } from "./uploadsstore";
```
(b) In `AgentDetailsRail`, right after `const railState = useAtomValue(railStateAtom);`, add:
```ts
    // an agent's uploads are keyed by its terminal block (uploadsstore.ts); one with no terminal has none
    const uploads = useAtomValue(uploadsAtom(agent.blockId ?? ""));
```
(c) In the `planAgentRail({ ... })` call, replace Stage 2's literal (the line, without its indentation):
```ts
uploads: 0, // no upload records exist yet; the Uploads work feeds this
```
with:
```ts
uploads: uploads.length,
```
(d) In `CONTENT`, replace (the line, without its indentation):
```tsx
uploads: () => <UploadsSection />,
```
with:
```tsx
uploads: () => <UploadsSection blockId={agent.blockId} />,
```
The header count is now real, so the row stops being a `0` once something is uploaded, and its `defaultOpen: count > 0` opens it
by itself (unless the user has already toggled it).
- [ ] **Step 4: Flip Stage 2's step 4 in `agent-rail-sections`**

Its fixture agent has a block id, so Attach is now enabled. In `scripts/cdp/scenarios.mjs`, in `agentRailSections` step 4,
make three one-line replacements. Replace:
```js
return s ? { open: s.dataset.open, attachDisabled: attach != null && attach.disabled } : null;
```
with:
```js
return s ? { open: s.dataset.open, attachEnabled: attach != null && !attach.disabled } : null;
```
Replace:
```js
"4. Uploads is a counted 0 that opens to an empty state and a disabled Attach",
```
with:
```js
"4. Uploads is a counted 0 that opens to an empty state and an enabled Attach",
```
Replace:
```js
uploadsAfter.attachDisabled === true,
```
with:
```js
uploadsAfter.attachEnabled === true,
```
(Written from S2's draft; if S2's final text differs, keep the intent: after opening the section, the Attach button exists and
is enabled.)
- [ ] **Step 5: Check formatting and the pure tests**

`npx prettier --check frontend/app/view/agents/uploadsingest.ts frontend/app/view/agents/railuploads.tsx`
Expected: `All matched files use Prettier code style!`
`npx vitest run frontend/app/view/agents/uploadsstore.test.ts`
Expected: `Tests 40 passed`. The button itself opens a native dialog, which a CDP session cannot drive, so the visible part (the
section opens at 0 to an enabled Attach) is checked by `agent-uploads` step 0 and `agent-rail-sections` step 4, and the record
and paste text by `planInserts`' tests.
- [ ] **Step 6: Commit**

```
git add frontend/app/view/agents/uploadsingest.ts frontend/app/view/agents/railuploads.tsx frontend/app/view/agents/agentdetailsrail.tsx scripts/cdp/scenarios.mjs
git commit -m "feat(uploads): Attach in the Uploads section, pasting the picked files' real paths" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 28: The Uploads list and the lightbox

**Depends on:** Task 23, Task 27
**Files:**
- Create: `frontend/app/view/agents/uploadslist.tsx`
- Modify: `frontend/app/view/agents/railuploads.tsx` (`UploadsSection` renders the list)
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx` (`CONTENT.uploads` passes `now`)
- Test: `frontend/app/view/agents/uploadsstore.test.ts` (existing, `rowState`)

One row per record, newest first: a 32px thumbnail (or an image or file icon when there is none), the name in `font-mono`
(a file name is a path-like string, DESIGN.md), an `expired` badge when `isExpired`, and the age in Inter with `tabular-nums`
(`formatAge`, the "16m / 3h / 3d" the rest of the app uses). What each row shows is `rowState` (tested in Task 23), so the
component is thin. An image whose file is still there is a button that opens a lightbox built on `ModalShell` (Escape, backdrop
click, focus handling and the modal stack come with it; portaled to `document.body` like `FinalShotsViewer`), loading the file
through `useLocalImage` (wavesrv's `/wave/stream-local-file`, which has no path restriction, so a temp or attached file both
load; a file that is gone reads "No longer on disk"). An expired image is not a button: its file is already swept. Colors are
`@theme` tokens only; the smallest text is 10.5px. The header's count is the rail's, wired in Task 27.

> NOTE: `useLocalImage` lives in `view/jarvis/localimage.ts` and logs with a `final-shots:` prefix on failure. It is reused
> as is (a rename would be churn).

- [ ] **Step 1: Create the list component**

Create `frontend/app/view/agents/uploadslist.tsx`:
```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The list in the Agent rail's Uploads section: what was pasted, dropped or attached into this agent's terminal, newest
// first, each with its thumbnail (or a generic icon), name and age. A paste or drop older than a day reads "expired"
// (its temp copy has been swept), not as an error. An image whose file is still there opens full size in a lightbox.
// What each row shows is uploadsstore.ts's rowState; the section around it (heading, Attach) is railuploads.tsx.

import { ModalShell } from "@/app/modals/modalshell";
import { useLocalImage } from "@/app/view/jarvis/localimage";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { FileText, Image as ImageIcon, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatAge } from "./agentsviewmodel";
import { rowState, uploadThumbsAtom, type UploadRecord } from "./uploadsstore";

function UploadRow({
    record,
    thumb,
    now,
    onEnlarge,
}: {
    record: UploadRecord;
    thumb: string | undefined;
    now: number;
    onEnlarge: () => void;
}) {
    const state = rowState(record, now, thumb != null);
    const body = (
        <>
            <span className="flex size-[32px] flex-none items-center justify-center overflow-hidden rounded-[6px] bg-surface text-muted">
                {state.icon === "thumb" ? (
                    <img
                        src={thumb}
                        alt=""
                        data-upload-thumb=""
                        className={cn("block size-full object-cover", state.expired && "opacity-40")}
                    />
                ) : state.icon === "image" ? (
                    <ImageIcon size={16} aria-hidden />
                ) : (
                    <FileText size={16} aria-hidden />
                )}
            </span>
            <span
                className={cn(
                    "min-w-0 flex-1 truncate font-mono text-[11.5px]",
                    state.expired ? "text-muted" : "text-secondary"
                )}
            >
                {record.name}
            </span>
            {state.expired ? (
                <span className="flex-none rounded-sm border border-edge-mid px-[6px] py-[1px] text-[10.5px] font-medium text-muted">
                    expired
                </span>
            ) : null}
            <span className="flex-none text-[10.5px] tabular-nums text-muted">{formatAge(now - record.ts)}</span>
        </>
    );
    const rowProps = {
        "data-upload-row": "",
        "data-upload-source": record.source,
        "data-upload-expired": state.expired ? "true" : "false",
        title: record.path,
    };
    const cls = "flex w-full items-center gap-[10px] rounded-[8px] bg-surface-raised px-[11px] py-[8px] text-left";
    return state.enlargeable ? (
        <button
            type="button"
            {...rowProps}
            aria-label={`Enlarge ${record.name}`}
            onClick={onEnlarge}
            className={cn(cls, "cursor-zoom-in hover:bg-surface-hover")}
        >
            {body}
        </button>
    ) : (
        <div {...rowProps} className={cls}>
            {body}
        </div>
    );
}

// the file is read back through wavesrv; one that is gone says so
function LightboxBody({ record, onClose }: { record: UploadRecord; onClose: () => void }) {
    const img = useLocalImage(record.path);
    return (
        <>
            <div className="flex items-center gap-[10px] border-b border-border px-[16px] py-[12px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-primary" title={record.path}>
                    {record.name}
                </span>
                {img.width != null ? (
                    <span className="flex-none text-[11.5px] tabular-nums text-muted">
                        {img.width} × {img.height}
                    </span>
                ) : null}
                <button
                    type="button"
                    aria-label="Close"
                    onClick={onClose}
                    className="flex size-[28px] flex-none cursor-pointer items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-secondary"
                >
                    <X size={15} aria-hidden />
                </button>
            </div>
            <div className="flex max-h-[78vh] min-h-[160px] items-center justify-center overflow-auto bg-surface-code p-[12px]">
                {img.url != null ? (
                    <img
                        src={img.url}
                        alt={record.name}
                        data-upload-lightbox-img=""
                        className="block max-h-[74vh] max-w-full object-contain"
                    />
                ) : img.status === "loading" ? null : (
                    <span className="text-[12px] text-muted">
                        {img.status === "missing" ? "No longer on disk" : "Can't load this image"}
                    </span>
                )}
            </div>
        </>
    );
}

export function UploadsList({ records, now }: { records: readonly UploadRecord[]; now: number }) {
    const thumbs = useAtomValue(uploadThumbsAtom);
    const [open, setOpen] = useState<UploadRecord | null>(null);
    // the shell animates out after `open` clears, so it keeps showing the record it was showing
    const shown = useRef<UploadRecord | null>(null);
    if (open != null) {
        shown.current = open;
    }
    return (
        <div data-uploads-list="" className="flex flex-col gap-[7px]">
            {records.map((r) => (
                <UploadRow key={r.id} record={r} thumb={thumbs[r.path]} now={now} onEnlarge={() => setOpen(r)} />
            ))}
            {createPortal(
                <ModalShell
                    open={open != null}
                    onClose={() => setOpen(null)}
                    align="center"
                    className="w-[min(92vw,1000px)]"
                >
                    {shown.current != null ? (
                        <LightboxBody record={shown.current} onClose={() => setOpen(null)} />
                    ) : null}
                </ModalShell>,
                document.body
            )}
        </div>
    );
}
```
- [ ] **Step 2: Render it in the section**

Replace the whole contents of `frontend/app/view/agents/railuploads.tsx` (Task 27's version, now with `now` and the list):
```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The details rail's Uploads section: the Attach button, then what was uploaded into this agent's terminal (the list
// is uploadslist.tsx). Keyed by the agent's terminal block id (uploadsstore.ts). The section opens at 0
// (emptyOpenable, agentrailsections.ts), so Attach is reachable before the first upload.

import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Plus } from "lucide-react";
import { pickAndAttach } from "./uploadsingest";
import { UploadsList } from "./uploadslist";
import { uploadsAtom } from "./uploadsstore";

export function UploadsSection({ blockId, now }: { blockId: string | undefined; now: number }) {
    const records = useAtomValue(uploadsAtom(blockId ?? ""));
    return (
        <div data-rail-uploads className="flex flex-col gap-[8px]">
            <button
                type="button"
                data-rail-attach
                disabled={!blockId}
                title={
                    blockId
                        ? "Pick files and insert their paths at this agent's prompt"
                        : "This agent has no terminal to attach to"
                }
                onClick={() => fireAndForget(() => pickAndAttach(blockId!))}
                className="inline-flex w-fit cursor-pointer items-center gap-[5px] rounded-[7px] border border-edge-mid px-[9px] py-[4px] text-[11px] font-semibold text-secondary hover:bg-surface-hover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            >
                <Plus size={12} aria-hidden />
                Attach
            </button>
            {records.length === 0 ? (
                <div className="text-[11.5px] text-muted">
                    Paste an image or drop files on the terminal, or attach them here.
                </div>
            ) : (
                <UploadsList records={records} now={now} />
            )}
        </div>
    );
}
```
- [ ] **Step 3: Pass `now` from the rail**

In `frontend/app/view/agents/agentdetailsrail.tsx`, in `CONTENT`, replace (the line, without its indentation):
```tsx
uploads: () => <UploadsSection blockId={agent.blockId} />,
```
with:
```tsx
uploads: () => <UploadsSection blockId={agent.blockId} now={now} />,
```
(`now` is the `useAtomValue(model.nowAtom)` the rail already reads.)
- [ ] **Step 4: Check formatting and `rowState`**

`npx prettier --check frontend/app/view/agents/uploadslist.tsx frontend/app/view/agents/railuploads.tsx`
Expected: `All matched files use Prettier code style!`
`npx vitest run frontend/app/view/agents/uploadsstore.test.ts`
Expected: `Tests 40 passed`.
- [ ] **Step 5: Commit**

```
git add frontend/app/view/agents/uploadslist.tsx frontend/app/view/agents/railuploads.tsx frontend/app/view/agents/agentdetailsrail.tsx
git commit -m "feat(uploads): the Uploads list with thumbnails, expired badges and an image lightbox" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 29: The `agent-uploads` CDP scenario

**Depends on:** Task 26, Task 27, Task 28
**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (new `agentUploads`, `SCENARIOS`)

The scenario makes a shell terminal in a tab of its own an agent by publishing an `agent:status` event for its block (the
way `scripts/inject-live-agents.mjs` does with `wsh agentstatus`, through the `eventpublish` RPC the file already uses), so
the Agent surface shows it with its details rail. It needs a real terminal, unlike S2's fixture agent, because the paste and
the drop must reach a live xterm. It then:

- Step 0: Uploads starts as a closed `0` whose toggle is enabled (S2's `emptyOpenable`); opened, it shows an enabled Attach.
- Step 1 (1b, 1c): pastes an image through the real handler (a `ClipboardEvent` with a real `DataTransfer` on
  `.term-connectelem`). The row appears as a paste with a thumbnail, its temp file exists on disk, and the shell echoes the path.
- Step 2: clicks the thumbnail, sees the lightbox's `blob:` image, closes it.
- Step 3 (3b, 3c): drops a file named `notes with space.txt` (a `DragEvent` with a real `DataTransfer` on the same element).
  The hint shows over the pane, then a drop row with a generic icon appears, its temp copy exists, and the shell echoes the
  path double-quoted.
- Step 4: drops with `application/x-arc-agent` on it: nothing is added.
- Step 5: drops a file over 5 MB: a toast naming it and pointing at Attach, nothing added.
- Step 6: reads `localStorage["agent.uploads"]`: the records are there and no thumbnail is.
- Step 7: ages the paste record to 25h, seeds an old attach record, reloads and reselects the agent: three rows.
- Steps 8 and 9: the old paste reads `expired`, with the generic icon and no enlarge; the fresh drop and the old attach do not.

What it cannot do, and what covers it instead: **Attach** opens a native dialog, so its record and paste text are covered by
`planInserts` in `uploadsstore.test.ts` and its row by the seeded attach record (steps 7 to 9); a **dropped folder** needs a
real drag for `webkitGetAsEntry`, so `collectDroppedFiles`' tests cover it. Steps 1c and 3c read the shell's echo from the block's
`term` file over HTTP (`window.term` is no longer set); they skip, naming why, if the file has no output.

- [ ] **Step 1: Add the scenario**

In `scripts/cdp/scenarios.mjs`, insert this block immediately above `export const SCENARIOS = [` (it uses helpers and constants
the file already defines: `skipStep`, `freshBoot`, `polishNap`, `polishWaitFor`, `waveService`, `RAIL_VISIBLE_KEY`,
`RAIL_SECTIONS_KEY`, `existsSync`):
```js
// --- agent uploads: paste, drop and the rail's Uploads section ----------------------------------------------
// A shell terminal in a tab of its own, made an agent by publishing an agent:status event for its block, so the
// Agent surface gives it the details rail. Paste and drop go through the real handlers: a synthetic ClipboardEvent
// on the terminal's connect element (termwrap.ts pasteHandler) and a synthetic DragEvent on the same element, which
// bubbles up to the focus pane's handler (focus-pane.tsx), each carrying a real DataTransfer. Two things a CDP
// session cannot do are covered another way:
// Attach opens a native dialog, so planInserts (uploadsstore.test.ts) covers its record and paste text and an
// attach record seeded into storage covers its row (it must never read "expired"); a dropped folder needs a real
// drag for webkitGetAsEntry, so collectDroppedFiles' tests cover it.
const UPLOADS_KEY = "agent.uploads";
const UPLOADS_NAME = "verify-uploads";
const UPLOADS_AGENT_WAIT_MS = 10000;
const UPLOADS_SECTION = `document.querySelector('aside[aria-label="Agent details"] [data-rail-section="uploads"]')`;
const UPLOADS_TOGGLE = `${UPLOADS_SECTION}?.querySelector("h3 button")`;
const UPLOADS_ATTACH = `${UPLOADS_SECTION}?.querySelector("button[data-rail-attach]")`;
const UPLOADS_DIALOG = `document.querySelector('[role="dialog"] [data-upload-lightbox-img]')`;
const UPLOADS_DAY_MS = 24 * 3600 * 1000;

const publishUploadsStatus = (h, ctx) =>
    h.rpc("eventpublish", {
        event: "agent:status",
        scopes: [`block:${ctx.blockId}`],
        persist: 1,
        data: { oref: `block:${ctx.blockId}`, state: "idle", agent: "claude", title: UPLOADS_NAME, ts: Date.now() },
    });

async function openUploadsAgent(h, ctx) {
    const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
    const wslist = await h.rpc("workspacelist", null);
    const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
    ctx.workspaceId = ws.workspacedata.oid;
    ctx.tabId = await waveService(h, "workspace", "CreateTab", [ctx.workspaceId, UPLOADS_NAME, false]);
    const tab = await waveService(h, "object", "GetObject", [`tab:${ctx.tabId}`]);
    ctx.blockId = tab?.blockids?.[0];
    if (!ctx.blockId) throw new Error("the new tab has no block");
    // the shell starts in ~, as canvas-swap's does: nothing in the app tree should hold a temp dir
    await h.rpc("setmeta", { oref: `block:${ctx.blockId}`, meta: { view: "term", controller: "shell", "cmd:cwd": "~" } });
    await h.rpc("setmeta", { oref: `tab:${ctx.tabId}`, meta: { "session:project": UPLOADS_NAME } });
    await publishUploadsStatus(h, ctx);
}

// the agent's terminal is mounted, its tree row is clicked, and the rail shows its Uploads section
async function focusUploadsAgent(h, ctx) {
    await h.goto("agent");
    const mounted = await polishWaitFor(
        h,
        `!!document.querySelector('[data-agent-terminal="${ctx.tabId}"]')`,
        UPLOADS_AGENT_WAIT_MS
    );
    if (!mounted) return false;
    await h.ev(`(() => {
        const tree = document.querySelector("[data-agent-tree]");
        const el = tree && [...tree.querySelectorAll("div, span, button")].find(
            (d) => d.children.length === 0 && d.textContent.trim() === ${JSON.stringify(UPLOADS_NAME)}
        );
        el?.click();
        return !!el;
    })()`);
    return polishWaitFor(h, `${UPLOADS_SECTION} != null`, 5000);
}

const uploadsPasteExpr = (tabId) => `(async () => {
    const el = document.querySelector('[data-agent-terminal="${tabId}"] .term-connectelem');
    if (!el) return { ok: false };
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 120;
    const g = canvas.getContext("2d");
    g.fillStyle = "#5e9cff";
    g.fillRect(0, 0, 240, 120);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "image.png", { type: "image/png" }));
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return { ok: true, taken: ev.defaultPrevented };
})()`;

// kind: "dragover" (a file over the pane) or "drop"; bytes sizes the file, agentMime adds the grid's own MIME
const uploadsDragExpr = (tabId, kind, { name = "notes with space.txt", bytes = 12, agentMime = false } = {}) => `(() => {
    // dispatched on the terminal's own element, as a real drop would land: it bubbles up through termwrap's
    // dropGuard (which only stops the webview navigating) to the pane's handler
    const el = document.querySelector('[data-agent-terminal="${tabId}"] .term-connectelem');
    if (!el) return { ok: false };
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(${bytes}).fill(97)], ${JSON.stringify(name)}, { type: "text/plain" }));
    if (${agentMime}) dt.setData("application/x-arc-agent", "verify");
    const ev = new DragEvent(${JSON.stringify(kind)}, { dataTransfer: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return { ok: true, taken: ev.defaultPrevented };
})()`;

const uploadsCount = (h) =>
    h.ev(`(() => {
        const m = /(\\d+)\\s*$/.exec(${UPLOADS_SECTION}?.querySelector("h3")?.textContent ?? "");
        return m ? Number(m[1]) : null;
    })()`);

const uploadsRows = (h) =>
    h.ev(`[...(${UPLOADS_SECTION}?.querySelectorAll("[data-upload-row]") ?? [])].map((r) => ({
        name: r.querySelector("span.truncate")?.textContent ?? "",
        source: r.getAttribute("data-upload-source"),
        expired: r.getAttribute("data-upload-expired") === "true",
        thumb: !!r.querySelector("[data-upload-thumb]"),
        button: r.tagName === "BUTTON",
        path: r.getAttribute("title"),
    }))`);

// the shell echoes what is pasted into it, and wavesrv keeps the echo in the block's "term" file; null when it has none
async function uploadsTermText(h, blockId) {
    const [endpoint, key] = await h.ev(`[window.api.getEnv("WAVE_SERVER_WEB_ENDPOINT"), window.api.getAuthKey()]`);
    const res = await fetch(`http://${endpoint}/wave/file?zoneid=${blockId}&name=term`, { headers: { "x-authkey": key } });
    if (res.status !== 200) return null;
    // colour, cursor and title sequences are stripped, so a path the shell redraws token by token still reads whole
    return Buffer.from(await res.arrayBuffer())
        .toString("utf8")
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // eslint-disable-line no-control-regex
        .replace(/\x1b\][^\x07]*\x07/g, ""); // eslint-disable-line no-control-regex
}

async function uploadsTermHas(h, blockId, needle) {
    let text = null;
    for (let waited = 0; waited < 4000; waited += 400) {
        text = await uploadsTermText(h, blockId);
        if (text != null && text.includes(needle)) return { seen: true, readable: true };
        await polishNap(400);
    }
    return { seen: false, readable: text != null };
}

const agentUploads = {
    name: "agent-uploads",
    surface: "agent",
    async arrange(h) {
        const ctx = {
            prevRail: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`),
            prevUploads: await h.ev(`localStorage.getItem(${JSON.stringify(UPLOADS_KEY)})`),
            prevSections: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_SECTIONS_KEY)})`),
        };
        // a throw past this point still returns ctx, so teardown removes whatever was already made
        try {
            await h.ev(`localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true")`);
            await h.ev(`localStorage.removeItem(${JSON.stringify(UPLOADS_KEY)})`);
            // the sections' open state is persisted: start from each one's default (Uploads is closed at 0)
            await h.ev(`localStorage.removeItem(${JSON.stringify(RAIL_SECTIONS_KEY)})`);
            await freshBoot(h);
            await openUploadsAgent(h, ctx);
            ctx.focused = await focusUploadsAgent(h, ctx);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        if (ctx.arrangeError != null || ctx.focused !== true) {
            return [
                skipStep(
                    "agent uploads",
                    `could not verify: ${ctx.arrangeError ?? "the fixture agent never showed its Uploads rail section (does the roster list an idle claude agent with no transcript?)"}`
                ),
            ];
        }
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const waitCount = (n) => polishWaitFor(h, `${UPLOADS_SECTION}?.querySelector("h3")?.textContent.trim().endsWith("${n}")`, 6000);

        // a counted 0 that is closed by default but not inert: it opens to the empty state and an enabled Attach
        const before = await h.ev(`(() => {
            const s = ${UPLOADS_SECTION};
            const t = ${UPLOADS_TOGGLE};
            return s ? { open: s.dataset.open, toggleEnabled: t != null && !t.disabled } : null;
        })()`);
        await h.ev(`${UPLOADS_TOGGLE}?.click()`);
        await polishNap(300);
        const attach = await h.ev(`(() => {
            const b = ${UPLOADS_ATTACH};
            return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
        })()`);
        rec(
            "0. Uploads starts as a closed 0 that opens to an enabled Attach",
            (await uploadsCount(h)) === 0 &&
                before?.open === "false" &&
                before.toggleEnabled === true &&
                attach?.text === "Attach" &&
                attach.disabled === false,
            JSON.stringify({ count: await uploadsCount(h), before, attach })
        );

        // --- paste an image: the real pasteHandler writes a temp file, pastes its path and records it ---------
        const pasted = await h.ev(uploadsPasteExpr(ctx.tabId));
        const gotPaste = await waitCount(1);
        const afterPaste = await uploadsRows(h);
        const pasteRow = afterPaste[0];
        rec(
            "1. a pasted image is listed with a thumbnail, as a paste, not expired",
            pasted.ok && pasted.taken && gotPaste && pasteRow?.source === "paste" && pasteRow.thumb && !pasteRow.expired &&
                pasteRow.button && /^waveterm_paste_.*\.png$/.test(pasteRow.name),
            JSON.stringify({ pasted, row: pasteRow })
        );
        rec("1b. its temp file is on disk", !!pasteRow?.path && existsSync(pasteRow.path), `path=${pasteRow?.path}`);
        const echoed = pasteRow?.name ? await uploadsTermHas(h, ctx.blockId, pasteRow.name) : { seen: false, readable: false };
        if (!echoed.readable) {
            steps.push(skipStep("1c. the path reached the terminal", "the block's term file had no output to read"));
        } else {
            rec("1c. the pasted path reached the terminal as typed text", echoed.seen, `name=${pasteRow?.name}`);
        }

        // --- click the thumbnail: a lightbox with the full image, closed by Escape -----------------------------
        await h.ev(`${UPLOADS_SECTION}?.querySelector('button[data-upload-row]')?.click()`);
        const opened = await polishWaitFor(h, `${UPLOADS_DIALOG}?.src.startsWith("blob:")`, 4000);
        await h.shot("cdp-shots/agent-uploads-lightbox.png");
        await h.ev(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
        let closed = await polishWaitFor(h, `!${UPLOADS_DIALOG}`, 2000);
        if (!closed) {
            await h.ev(`document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click()`);
            closed = await polishWaitFor(h, `!${UPLOADS_DIALOG}`, 2000);
        }
        rec("2. clicking the thumbnail opens the image in a lightbox, and it closes again", opened && closed, `opened=${opened} closed=${closed}`);

        // --- drop a file: the hint shows while it is over the pane, then the file is copied and pasted --------
        await h.ev(uploadsDragExpr(ctx.tabId, "dragover"));
        await polishNap(150);
        const hinted = await h.ev(`!!document.querySelector("[data-upload-drop]")`);
        const dropped = await h.ev(uploadsDragExpr(ctx.tabId, "drop"));
        const gotDrop = await waitCount(2);
        const hintGone = await polishWaitFor(h, `!document.querySelector("[data-upload-drop]")`, 1500);
        const dropRow = (await uploadsRows(h))[0];
        rec(
            "3. a dropped file shows the drop hint, then is listed as a drop with a generic icon",
            hinted && dropped.ok && gotDrop && hintGone && dropRow?.source === "drop" &&
                dropRow.name === "notes with space.txt" && !dropRow.thumb && !dropRow.button && !dropRow.expired,
            JSON.stringify({ hinted, hintGone, dropped, row: dropRow })
        );
        rec("3b. its temp copy is on disk", !!dropRow?.path && existsSync(dropRow.path), `path=${dropRow?.path}`);
        const quoted = await uploadsTermHas(h, ctx.blockId, 'notes with space.txt"');
        if (!quoted.readable) {
            steps.push(skipStep("3c. the path with a space was quoted", "the block's term file had no output to read"));
        } else {
            rec("3c. the path with a space went in double-quoted", quoted.seen, "looked for: notes with space.txt\"");
        }

        // --- what must not become an upload ----------------------------------------------------------------------
        const agentDrag = await h.ev(uploadsDragExpr(ctx.tabId, "drop", { name: "agent-drag.txt", agentMime: true }));
        await polishNap(700);
        rec(
            "4. a drop that carries the grid's agent MIME is not taken as a file",
            agentDrag.ok && (await uploadsCount(h)) === 2,
            JSON.stringify({ agentDrag, count: await uploadsCount(h) })
        );
        const big = await h.ev(uploadsDragExpr(ctx.tabId, "drop", { name: "big.bin", bytes: 5 * 1024 * 1024 + 1 }));
        const toast = await polishWaitFor(
            h,
            `[...document.querySelectorAll("[data-notification-toast]")].some((t) => t.textContent.includes("big.bin") && t.textContent.includes("+ Attach"))`,
            4000
        );
        rec(
            "5. a file over 5 MB is refused with a toast that points at Attach, and is not listed",
            big.ok && toast && (await uploadsCount(h)) === 2,
            JSON.stringify({ big, toast, count: await uploadsCount(h) })
        );
        await h.shot("cdp-shots/agent-uploads.png");

        // --- storage and a reload: records survive, thumbnails do not, old temp copies read expired -------------
        const stored = JSON.parse((await h.ev(`localStorage.getItem(${JSON.stringify(UPLOADS_KEY)})`)) ?? "{}");
        const list = stored[ctx.blockId] ?? [];
        const raw = JSON.stringify(stored);
        rec(
            "6. the records are in storage, without any thumbnail",
            list.length === 2 && !raw.includes("data:image") && list.every((r) => !("thumb" in r)),
            `records=${list.length} sources=${list.map((r) => r.source)}`
        );

        const now = Date.now();
        const aged = list.map((r) => (r.source === "paste" ? { ...r, ts: now - 25 * 3600 * 1000 } : r));
        aged.push({
            id: "verify-attach",
            name: "seeded attach.pdf",
            path: "C:\\verify\\seeded attach.pdf",
            kind: "file",
            source: "attach",
            ts: now - 3 * UPLOADS_DAY_MS,
        });
        await h.ev(`localStorage.setItem(${JSON.stringify(UPLOADS_KEY)}, ${JSON.stringify(JSON.stringify({ [ctx.blockId]: aged }))})`);
        await freshBoot(h);
        await publishUploadsStatus(h, ctx);
        const back = await focusUploadsAgent(h, ctx);
        await waitCount(3);
        const rows = await uploadsRows(h);
        const byName = (n) => rows.find((r) => r.name === n);
        const oldPaste = rows.find((r) => r.source === "paste");
        rec("7. after a reload the agent's rail lists all three records", back && rows.length === 3, `rows=${rows.length}`);
        rec(
            "8. a paste older than a day reads expired, with the generic icon and no enlarge",
            !!oldPaste && oldPaste.expired && !oldPaste.thumb && !oldPaste.button,
            JSON.stringify(oldPaste)
        );
        rec(
            "9. a recent drop and an old attach do not read expired",
            byName("notes with space.txt")?.expired === false && byName("seeded attach.pdf")?.expired === false,
            JSON.stringify(rows.map((r) => ({ name: r.name, expired: r.expired })))
        );
        await h.shot("cdp-shots/agent-uploads-expired.png");
        return steps;
    },
    // best-effort, so one failed step does not strand the rest
    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`agent-uploads teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        await step("restore the rail preference", () =>
            h.ev(
                ctx.prevRail == null
                    ? `localStorage.removeItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`
                    : `localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, ${JSON.stringify(ctx.prevRail)})`
            )
        );
        await step("restore the rail sections' open state", () =>
            h.ev(
                ctx.prevSections == null
                    ? `localStorage.removeItem(${JSON.stringify(RAIL_SECTIONS_KEY)})`
                    : `localStorage.setItem(${JSON.stringify(RAIL_SECTIONS_KEY)}, ${JSON.stringify(ctx.prevSections)})`
            )
        );
        await step("restore the uploads records", () =>
            h.ev(
                ctx.prevUploads == null
                    ? `localStorage.removeItem(${JSON.stringify(UPLOADS_KEY)})`
                    : `localStorage.setItem(${JSON.stringify(UPLOADS_KEY)}, ${JSON.stringify(ctx.prevUploads)})`
            )
        );
        if (ctx.tabId) {
            await step("close the terminal tab", () => waveService(h, "workspace", "CloseTab", [ctx.workspaceId, ctx.tabId, false]));
        }
        await step("go home", () => h.goto("cockpit"));
    },
};
```
then add `agentUploads,` as the last entry of the `SCENARIOS` array. Do not run prettier on this file (`.editorconfig`
omits `.mjs`, see AGENTS.md).
- [ ] **Step 2: Check the file parses**

`node --check scripts/cdp/scenarios.mjs`
Expected: no output, exit 0.
- [ ] **Step 3: Run the scenario (requires `task dev` running)**

`task verify:ui -- agent-uploads`
Expected: a PASS row for `agent-uploads` with steps 0 to 9 passing; 1c and 3c may read SKIP (not FAIL) when the shell wrote
nothing to read. A SKIP of the whole scenario (`could not verify: ...`) means the fixture agent never reached the Agent
surface; the detail says what to seed. Screenshots land in `cdp-shots/agent-uploads.png`,
`agent-uploads-lightbox.png` and `agent-uploads-expired.png`; look at them: the section header with its count, the Attach
button, the rows, the lightbox.
- [ ] **Step 4: Re-run the neighbours the earlier tasks could have disturbed (requires `task dev` running)**

`task verify:ui -- agent-rail-sections agent-tree-rail canvas-swap agent-terminal-on-arrival tui-fullscreen`
Expected: they pass as before (`agent-rail-sections` step 4 now expects an enabled Attach; Task 26 changed the focus pane's
wrapper, which `canvas-swap` and `tui-fullscreen` exercise).
- [ ] **Step 5: Commit**

```
git add scripts/cdp/scenarios.mjs
git commit -m "test(uploads): agent-uploads CDP scenario for paste, drop, expiry and the lightbox" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
