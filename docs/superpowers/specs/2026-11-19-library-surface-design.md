# Library: a surface for Conversation History, Canvas gallery and Councils

Date: 2026-11-19 · Brainstorm: `.superpowers/brainstorm/library-surface/brainstorm.json`

## Why

The Agent sidebar opens with three large rows (Conversation History, Canvas gallery, Councils) that take ~100px above
the project tree, the part of the sidebar used all day. Below the tree, the Conversations section (269 ended
conversations) is rarely used. All four are archives: nothing in them waits on the person. They move to a new
nav-rail surface, **Library**, and the Agent sidebar keeps only what is live or just finished.

Jarvis was ruled out: it holds what waits on you, and its badge counts that; archives would dilute it.

## Today

- `frontend/app/view/agents/agentcenter.ts` holds `centerModeAtom`: `terminal`, `session`, `run`, `history`,
  `canvases`, `councils`, `council`, `project`, `held`.
- The three rows are `agenttree.tsx` ~4238-4287 (`showHistory`, `showCanvases`, `showCouncils`).
- The Conversations section is in `agenttree.tsx` (`endedConversationsByProject`, `registeredConversations`,
  `conversationPressesAtom`, `collapsedConversationProjectsAtom`, the "elsewhere" count row ~4000).
- A council is in the tree while it runs, waits on you or is queued, is pinned, ended less than a day ago, or is
  unread (`councilInTree`, `agentsidebarmodel.ts:458`).
- 62 calls to `showSession` / `showCouncil` / `showHistory` / `showCanvases` / `showCouncils` across 23 files
  (Jarvis `briefsurface.tsx`, `councilsheet.tsx`, `openref.ts`, `traybridge.tsx`, `uiclient.ts`, `launchermodal.tsx`,
  `usagesurface.tsx`, `projecthistory.tsx`, `settingspages/storage.tsx`, the council views…).
- Rail: `CORE_ITEMS` (Cockpit, Jarvis, Agent, Usage), divider, `TOOL_ITEMS` (Code, Diff) in `navrail.tsx`;
  `SURFACE_ORDER` in `agents.tsx:50` gives them Ctrl+1..6.

## Decisions

### Where an item opens
Old things are read inside Library: a finished session's transcript (and a run's detail), a finished council's
Discussion / Summary / Map, the canvas viewer. Resume, a live agent and a running council open on Agent.

### Rail, name and shortcut
Rail order: Cockpit, Jarvis, Agent, Usage, **Library**, divider, Code, Diff. Library takes **Ctrl+7**; Ctrl+1..6 do
not change. `SURFACE_ORDER` appends `"library"` (so the chord is 7 though it sits fifth); `CORE_ITEMS` adds it after
Usage. The rail label is "Library".

### Inside Library
Three tabs across the top: **Conversations** (Conversation History's master-detail, including session transcript and
run detail), **Canvases** (`canvasgalleryview` and its viewer) and **Councils** (`councilhistoryview`, plus a finished
council's Discussion, Summary and Map). The open tab survives surface switches in a module-level atom. A running
council or Resume goes to Agent through `openref.ts`.

**Agent's call — Library is the only host of session and run detail.** With the Conversations section gone, nothing in
the tree opens Agent's `session` or `run` modes (their only tree callers, `ConversationRow` and `RunConversationRow`,
`agenttree.tsx:2525/2585`, are in the removed section). Both modes leave Agent. Every `showSession` caller
(`briefsurface.tsx:850`, `usagesurface.tsx:717`, `launchermodal.tsx:934`, `projecthistory.tsx:147/592`,
`runoriginstore.ts:82`, `cockpit/actions/session.ts:42`) opens Library instead. The transcript's "Back to Overview"
becomes Library's Back, which returns to the surface that opened it (`returnsurface.ts`); `backFor` /
`centerBackAtom` lose their session case.

**Agent's call — councils keep one selection per host.** Library has its own council selection atoms, passed to
`councilpane` through a React context whose default is the global `councilSelAtom` / `councilViewAtom` /
`councilOnlyAtom` Agent uses today. Opening a finished council in Library never changes what Agent's centre shows.
Sessions need no split: only Library shows them.

### What stays on Agent
The sidebar drops the three top rows and drops the **Conversations section entirely**. The tree keeps agents,
terminals, tools and the councils `councilInTree` keeps; those councils still open in Agent's centre column as today.
Finished conversations exist only in Library's Conversations tab. No new "just finished" group replaces the section:
a solo agent whose tab closes, or a run that ends, leaves the tree at once (a run to land still shows in Jarvis).

### Other routes
Every route that opens a session or a council (Jarvis, palette, notifications, `wsh ui`, Project overview, Settings →
Storage) goes through `openref.ts`, which decides:
- a council still in the tree (`councilInTree`) opens in Agent's centre column;
- a council that left the tree opens in Library's Councils tab;
- a finished conversation always opens in Library's Conversations tab (the tree no longer lists them);
- Resume, a live agent and a running council always open on Agent.

## Left to the builder

- `agentcenter.ts` drops the `history`, `canvases`, `councils`, `session` and `run` modes (Agent's call above); only
  `council` stays, for councils in the tree. Update `agentcenter.test.ts`.
- Remove the Conversations section from `agenttree.tsx` with the code only it uses (the "elsewhere" count row,
  `conversationPressesAtom`, `collapsedConversationProjectsAtom` if nothing else reads them). Grep every import,
  `import type` included, before deleting.
- Library has no nav badge: nothing in it waits on you.
- `library` is a `wsh ui go:` target like the other surfaces. The "Conversation History" link in
  `agentlaunchhero.tsx` opens Library.
- Add the Ctrl+7 binding in `frontend/app/store/keybindings/bindings.ts` and `docs/keyboard-shortcuts.md`.
- Update the CDP scenarios that count nav buttons (`surface-smoke`) and add a scenario that opens each Library tab.
- One `Changed` line in `CHANGELOG.md`.

## Decisions made while planning (2026-11-19, autonomous run)

Each settles something the sections above leave to the builder; the reason follows each.

1. **Library's state lives in `frontend/app/view/library/librarystore.ts`**, beside a new `librarysurface.tsx`.
   `libraryTabAtom` (`"conversations" | "canvases" | "councils"`, default `conversations`) is module-level, so the tab
   survives a surface switch (Library unmounts like every surface but Agent). Why a new folder: Library is a surface,
   as `view/jarvis` is, and its store must not import Agent's centre (`agentcenter.ts`) for anything but `showCouncil`.
2. **Conversations tab has two views, `libraryConvViewAtom`: `list | session | run`.** `list` is Conversation
   History's master-detail as it is today (picking a row reads it in the detail pane, in place). `session` and `run` are
   today's `SessionPane` / `RunPane`, full width, shown when a session is opened from outside Library
   (`showLibrarySession`). Why keep both: a session opened from Jarvis or Usage may sit outside the loaded or filtered
   list, and the full-width pane already handles that (`sessionLookupAtom`).
3. **Back from a session, run or council opened in Library** is one function per tab (`leaveLibraryDetail`,
   `leaveLibraryCouncil`): set the tab back to its list, then `backToOrigin()` (returnsurface.ts), which returns to the
   surface the jump came from when there was one. The button reads "Back"; Escape does the same. `CenterBack`,
   `centerBackAtom`, `backFor`, `backLabel` and `leaveCenter`'s session case go: nothing on Agent opens a session.
4. **Council host context** (`frontend/app/view/agents/councilhost.ts`): `CouncilHost = { kind, selAtom, viewAtom,
   onlyAtom(id), open(id, view?, only?) }`; `CouncilHostContext`'s default is `AGENT_COUNCIL_HOST` (the global
   `councilSelAtom` / `councilViewAtom` / `councilOnlyAtom`, `open` = `showCouncil` without a model). Library provides
   `LIBRARY_COUNCIL_HOST` (its own atoms, `open` = set them, no surface change). Every council view reads its selection
   and moves between views (tabs, Open in Discussion, a seat's messages, Map) through `useCouncilHost()`, never the
   global atoms or `showCouncil` directly. `councilLastViewAtom` stays shared: it records what the person last read of a
   council, wherever they read it. `revealCouncilMessage` takes the host. Setup stays Agent only.
5. **One router for "open this council": `openCouncil(model, id, view?, only?)` in librarystore.ts.** A council that
   `councilInTree` keeps (or one not loaded yet, which is new and therefore live) opens on Agent through `showCouncil`;
   any other opens in Library's Councils tab. Jarvis, notifications, `openref.ts`, Library's Councils list and the
   palette all call it. Resume (`resumeCouncil`) always lands on Agent: it takes the model.
6. **Keys.** Ctrl+7 comes from `SURFACE_ORDER` (bindings.ts maps its first nine). The `g` leader gets `l` → Library;
   the existing ids `go:history`, `go:canvases`, `go:councils` (letters `s`, `v`, `o`) stay and open Library on that
   tab, because What's new's Try it links in `CHANGELOG.md` name them. The Canvas gallery's keys move from
   `surface === "agent" && centerMode === "canvases"` to `surface === "library" && tab === "canvases"`; council keys
   (`buildCouncilBindings`, `buildCouncilTabBindings`) are live on Agent's `council` mode or Library's Councils tab with
   a council open. Library joins `ESC_HOME_SURFACES` (Escape: back, else Cockpit) unless something in it holds Escape
   (an open canvas, clean up or scan; a session, run or council open in it, whose Escape is its Back; an open council
   thread). `1` `2` `3` switch Library's tabs (navigate posture, Library surface only). Rail order and chord order now
   differ, so `agents.tsx` exports `RAIL_ORDER` (the rail's visual order) beside `SURFACE_ORDER` (the chords): the
   rail's Ctrl-held digit reads `SURFACE_ORDER`, so it shows the chord that works (7 on Library); `[` `]` and the
   start-surface options follow `RAIL_ORDER`, the order the person sees. Library's own keys live in
   `buildLibraryBindings`, activated by `LibrarySurface`; Conversation History publishes its list cursor on `library`.
7. **`wsh ui`**: `surface:library` is a valid address (it is in `SURFACE_ORDER`); `surface:history` and the old
   `surface:sessions` open Library on Conversations; `surface:canvases` and `surface:councils` open their tabs.
8. **What a removed mode's openers become.** `showHistory`, `showCanvases`, `showCouncils`, `showSession`,
   `centerForSelection` leave `agentcenter.ts`; callers use `showLibrary(model, tab)` and `showLibrarySession`.
   `CenterMode` becomes `terminal | council | project | held`. Agent's centre no longer renders History, the gallery,
   Councils, the session or run pane.
9. **Councils still in the tree** keep opening in Agent's centre from the tree, exactly as today. A council removed
   while Library shows it returns Library to its Councils list; a council notification counts as seen when the council
   is on screen in either host.
