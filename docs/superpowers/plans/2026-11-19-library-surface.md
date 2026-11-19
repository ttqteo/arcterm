# Library surface: Conversation History, Canvas gallery and Councils move off Agent

**Spec:** `docs/superpowers/specs/2026-11-19-library-surface-design.md` (read its "Decisions made while planning" section: every task below builds on it)
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke library-tabs canvas-gallery jarvis-brief-later`

Shape of the work: Task 1 lands the interface every other task uses (the `library` surface key, `librarystore.ts`'s
atoms and openers, the council host context). Tasks 2, 3, 4 and 5 then run side by side: the surface itself, the
council views reading their host, every caller rerouted to Library, and the keys. Task 6 removes Agent's old modes,
rows and the Conversations section once nothing calls them. Task 7 updates the CDP scenarios, adds `library-tabs`, and
writes the docs and CHANGELOG line.

Rules for every task: frontend only, no generated files. Colors from `theme` tokens, layout per `DESIGN.md`. Before
deleting a symbol or file, grep every reference (`import type` included) across `frontend/` and `scripts/`. Run the
focused vitest files named in the task (`npx vitest run <file>`), and `task check:ts` (give it a 4-minute timeout).
Never run prettier on `scripts/*.mjs`.

### Task 1: The `library` surface key, Library's store and the council host
**Depends on:** none
**Files:** `frontend/app/view/agents/agents.tsx`, `frontend/app/view/agents/navrail.tsx`, `frontend/app/view/agents/surfacecontext.ts`, `frontend/app/view/agents/surfacecontext.test.ts`, `frontend/app/view/agents/surfaceorder.test.ts`, `frontend/app/view/agents/cockpitprefsstore.ts`, `frontend/app/view/agents/cockpitprefsstore.test.ts`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/view/library/librarystore.ts`, `frontend/app/view/library/librarystore.test.ts`, `frontend/app/view/agents/councilhost.ts`

- Rail order and chord order now differ (Library sits fifth on the rail, chord 7). `agents.tsx` exports
  `RAIL_ORDER: SurfaceKey[]` = cockpit, jarvis, agent, usage, library, code, files (the rail's visual order; `navrail.tsx`'s
  `CORE_ITEMS` / `TOOL_ITEMS` must list the same order). `SURFACE_ORDER` stays the chord order (appends library). The
  rail's Ctrl-held digit hint (`navrail.tsx` ~222) becomes `SURFACE_ORDER.indexOf(key) + 1`, so it shows 7 on Library
  and 5/6 on Code/Diff. `[` / `]` (bindings.ts ~424) and `startupSurfaceOptions` (cockpitprefsstore.ts) follow
  `RAIL_ORDER`, the order the person sees. Rewrite `surfaceorder.test.ts`, the `[ ]` wrap test and the Mod+1..6 test
  in `bindings.test.ts`, and `cockpitprefsstore.test.ts` for this.
- `bindings.ts` gets an exported stub `buildLibraryBindings(model: AgentsViewModel): Binding[]` returning `[]`, for
  Task 2 to activate (`useKeybindings`) and Task 5 to fill.

- `SurfaceKey` gains `"library"`; `SURFACE_ORDER` appends it (so it is Ctrl+7 while sitting fifth on the rail); fix the
  comment above it. `navrail.tsx`: `ICON.library` (lucide `Library`), `CORE_ITEMS` adds `{ key: "library", label:
  "Library" }` after Usage. No badge. `surfacecontext.ts`: `library: { project: "unsupported" }`. Fix every
  `Record<SurfaceKey, …>` tsc reports.
- `frontend/app/view/library/librarystore.ts` (the interface the other tasks rely on; keep these names and shapes):
  - `type LibraryTab = "conversations" | "canvases" | "councils"`; `LIBRARY_TABS: readonly LibraryTab[]` in that order;
    `libraryTabAtom: PrimitiveAtom<LibraryTab>` (default `conversations`).
  - `type LibraryConvView = "list" | "session" | "run"`; `libraryConvViewAtom` (default `list`).
  - `libraryCouncilSelAtom: PrimitiveAtom<string | null>` (null = the Councils list shows), `libraryCouncilViewAtom:
    PrimitiveAtom<CouncilView>` (default `discussion`, never `setup`), `libraryCouncilOnlyAtom` (an `atomFamily` by
    council id of `string | null`, like `councilOnlyAtom`).
  - `showLibrary(model: Pick<AgentsViewModel, "surfaceAtom">, tab?: LibraryTab): void` — sets the tab when given,
    `landOn(model.surfaceAtom, "library")`.
  - `showLibrarySession(model: Pick<AgentsViewModel, "surfaceAtom" | "sessionsSelAtom" | "sessionsMemberAtom">, sel:
    string, member?: string): void` — writes `sessionsSelAtom` (and the member when given), tab `conversations`, view
    `run` for a `run:<id>` sel (`runIdOfSel`), `list` for `"all"`, else `session`; lands on Library.
  - `leaveLibraryDetail(): void` — view back to `list`, then `backToOrigin()`.
  - `setLibraryCouncil(id: string, view?: Exclude<CouncilView, "setup">, only?: string): void` — the same view choice
    as `showCouncil` (`reopenView`, `councilLastViewAtom` kept), on Library's atoms, tab `councils`; no surface change.
  - `showLibraryCouncil(model, id, view?, only?)` — `setLibraryCouncil` then lands on Library.
  - `leaveLibraryCouncil(): void` — `libraryCouncilSelAtom` to null, then `backToOrigin()`.
  - `openCouncil(model: Pick<AgentsViewModel, "surfaceAtom">, id: string, view?, only?): void` — the one router: the
    council (from `councilAtom(id)`, else `councilListAtom("")`) kept by `councilInTree(c, councilOpenedAtom value,
    Date.now())`, or not loaded at all, opens through `showCouncil(id, view, model, only)`; any other through
    `showLibraryCouncil`.
  - `LIBRARY_COUNCIL_HOST: CouncilHost` (`kind: "library"`, Library's atoms, `open` = `setLibraryCouncil`).
- `frontend/app/view/agents/councilhost.ts`: `interface CouncilHost { kind: "agent" | "library"; selAtom:
  Atom<string | null>; viewAtom: Atom<CouncilView>; onlyAtom: (id: string) => PrimitiveAtom<string | null>; open(id:
  string, view?: Exclude<CouncilView, "setup">, only?: string): void }`, `AGENT_COUNCIL_HOST` (global atoms, `open` =
  `showCouncil(id, view, undefined, only)`), `CouncilHostContext = createContext(AGENT_COUNCIL_HOST)`,
  `useCouncilHost()`. A `.ts` file: `createContext` needs no JSX.
- Tests: `librarystore.test.ts` covers each opener's atoms and surface (a session, a run, `all`; `leaveLibraryDetail`
  returning to the surface that opened it and staying on Library when nothing did; `openCouncil` sending a running
  council, a pinned one and an unknown id to Agent, a day-old read one to Library; `setLibraryCouncil` leaving
  `councilSelAtom` / `councilViewAtom` untouched). `surfaceorder.test.ts`, `surfacecontext.test.ts` and the
  `bindings.test.ts` case "binds Mod+1..6" now expect seven surfaces with Library on Mod+7.

### Task 2: The Library surface
**Depends on:** Task 1 (uses librarystore.ts and LIBRARY_COUNCIL_HOST)
**Files:** `frontend/app/view/library/librarysurface.tsx`, `frontend/app/view/agents/cockpitshell.tsx`, `frontend/app/view/agents/sessionpane.tsx`, `frontend/app/view/agents/runpane.tsx`, `frontend/app/view/agents/conversationhistory.tsx`, `frontend/app/view/agents/canvasgalleryview.tsx`, `frontend/app/view/agents/canvasgallerystore.ts`

- `LibrarySurface({ model })`, mounted in `cockpitshell.tsx`'s surface switch for `"library"`. A tab strip across the
  top (Conversations, Canvases, Councils; `data-library-tab="<tab>"`, `aria-selected`, keyboard hint `1` `2` `3`), the
  root `data-library` with `data-library-active="<tab>"`. Style the strip after Setup's tabs (`DESIGN.md`).
- Conversations: `libraryConvViewAtom` `list` renders `ConversationHistory`; `session` renders `SessionPane`; `run`
  renders `RunPane`. Canvases: `CanvasGallery`. Councils: `libraryCouncilSelAtom` null renders `CouncilHistory`; else a
  slim Back row (`data-library-council-back`, "Back", calls `leaveLibraryCouncil`) over `CouncilPane`, both inside
  `<CouncilHostContext.Provider value={LIBRARY_COUNCIL_HOST}>`.
- `SessionPane` / `RunPane`: their Back (button and the one inside `SoloDetail`) calls `leaveLibraryDetail` and reads
  "Back"; they stop importing `backLabel`, `centerBackAtom`, `leaveCenter`. Keep `data-agent-session` and the other
  data attributes scenarios read. `ConversationHistory` loses its close button (`data-agent-history-close`): Library has
  nothing to close back to. Update the header comments of these files and the gallery's (`canvasgalleryview.tsx`,
  `canvasgallerystore.ts`) that say they are Agent centre modes; change code there only if the gallery assumes the
  Agent surface.
- `conversationhistory.tsx` hard-codes the surface `"agent"` (~125 `onSurface`, ~317 the list-nav controller it
  publishes; `buildListNavBindings` matches `c.surface === ctx.surface`): both become `"library"`, so j/k, Enter and
  paging work in Library.
- `LibrarySurface` activates its keys with `useKeybindings(useMemo(() => buildLibraryBindings(model), [model]))` (the
  stub Task 1 lands; Task 5 fills it).
- Acceptance: `library-tabs` (Task 7) steps "j/k move the Conversations list cursor", "rail Library opens Conversations", "Canvases tab shows the gallery",
  "Councils tab shows the list", "a session opened from Usage reads full width and Back returns to Usage", and "a
  closed council opens inside Library with Back to the list" show this view.

### Task 3: Council views read their host
**Depends on:** Task 1 (uses councilhost.ts and openCouncil)
**Files:** `frontend/app/view/agents/councilpane.tsx`, `frontend/app/view/agents/councildiscussion.tsx`, `frontend/app/view/agents/councilmap.tsx`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councilseats.tsx`, `frontend/app/view/agents/counciltabs.tsx`, `frontend/app/view/agents/councilheader.tsx`, `frontend/app/view/agents/councilresume.tsx`, `frontend/app/view/agents/councilreveal.ts`, `frontend/app/view/agents/councilreveal.test.ts`, `frontend/app/view/agents/councilremove.ts`, `frontend/app/view/agents/councilnotifysync.tsx`, `frontend/app/view/agents/councilhistoryview.tsx`

- Every read of `councilSelAtom` / `councilViewAtom` / `councilOnlyAtom` in these views goes through
  `useCouncilHost()`; every `showCouncil(id, view[, , only])` that moves between a council's views (tabs, Map, Open in
  Discussion, a seat's messages, after a reveal) becomes `host.open(...)`. `revealCouncilMessage(host, councilId,
  messageId)`. Leave `councilsetup.tsx` alone (Setup is Agent only) and the DEV `window.__arcCouncil.showCouncil` hook
  as it is.
- `resumeCouncil(id, model)` lands on Agent (`showCouncil(id, "discussion", model)`); its callers pass the model.
- `CouncilHistory` rows open through `openCouncil(model, row.id)` (a council the tree keeps goes to Agent, a closed one
  stays in Library).
- `councilremove.ts`: a removed council open in Library sets `libraryCouncilSelAtom` to null (Library shows the list);
  the Agent case stays. Leave `councilstore.ts` alone: importing librarystore.ts there would make a cycle (councilstore → librarystore →
  agentcenter → councilstore); `councilremove.ts` is where the Library case is handled.
- `councilnotifysync.tsx`: a council counts as on screen when Agent shows it (as today) or Library's Councils tab shows
  it on the Library surface; its notification's open uses `openCouncil(model, id, "summary")`.
- Tests: `councilreveal.test.ts` for the host argument; add a test (new `councilhost.test.ts` is fine, list it in your
  commit) that `LIBRARY_COUNCIL_HOST.open` moving between views leaves the global atoms untouched.
- Acceptance: `library-tabs` step "a closed council opens inside Library with Back to the list" switches its tabs to
  Summary and Map inside Library and asserts Agent's `councilSelAtom` did not change.

### Task 4: Every route that opened a session, a council or a removed mode goes through Library
**Depends on:** Task 1 (uses showLibrary, showLibrarySession, openCouncil)
**Files:** `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`, `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/jarvis/councilsheet.tsx`, `frontend/app/view/agents/usagesurface.tsx`, `frontend/app/view/agents/projecthistory.tsx`, `frontend/app/view/agents/runoriginstore.ts`, `frontend/app/cockpit/actions/session.ts`, `frontend/app/cockpit/actions/session.test.ts`, `frontend/app/cockpit/traybridge.tsx`, `frontend/app/cockpit/uiclient.ts`, `frontend/app/cockpit/uiapi.ts`, `frontend/app/cockpit/uiapi.test.ts`, `frontend/app/view/agents/settingspages/storage.tsx`, `frontend/app/view/agents/agentlaunchhero.tsx`

- `showSession` → `showLibrarySession` (briefsurface, usagesurface, projecthistory, runoriginstore,
  cockpit/actions/session). `showHistory` → `showLibrary(model, "conversations")` (projecthistory, agentlaunchhero,
  uiclient). `showCanvases` → `showLibrary(model, "canvases")` (traybridge, storage). Leave `launchermodal.tsx` to
  Task 6 (its `showSession` call becomes `showLibrarySession` there).
- `openref.ts`'s `selectCouncil` → `openCouncil(model, councilId, view)`; the `session` target (Resume into a tab) is
  unchanged. Jarvis `councilsheet.tsx` opens councils through `openCouncil`.
- `uiapi.ts`'s `parseSurfaceAddress` returns `{ surface: SurfaceKey; tab?: LibraryTab }`: `surface:history` and
  `surface:sessions` → Library conversations, `surface:canvases` / `surface:councils` → their tabs, `surface:library`
  plain; the error lists the extra names. `uiclient.ts` applies `tab` through `showLibrary`.
- Tests: `openref.test.ts` (a running council opens on Agent's `council` mode, a closed one in Library's Councils tab),
  `session.test.ts` (the action lands on Library with the right view), `uiapi.test.ts`.
- Acceptance: `jarvis-brief-later`'s session step (Task 7 updates it) and `library-tabs` step "a session opened from
  Usage reads full width and Back returns to Usage" show these routes.

### Task 5: Keys for Library
**Depends on:** Task 1 (uses libraryTabAtom and the openers)
**Files:** `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/whenstate.ts`, `frontend/app/store/keybindings/store.test.ts`, `frontend/app/cockpit/footer-visible.test.ts`, `frontend/app/cockpit/footerhints.ts`, `frontend/app/cockpit/palette-commands.ts`, `docs/keyboard-shortcuts.md`

- `GO_TARGETS`: add `l` → Library (its id defaults to `go:library`; Task 7's CHANGELOG line links it); `go:history` / `go:canvases` / `go:councils` keep their ids and letters and open
  Library on that tab (`surface: "library"`, `open` through `showLibrary`). Remove the `showHistory`/`showCanvases`/
  `showCouncils` imports.
- The Canvas gallery bindings (`onGallery`, `galleryViewerOpen`, `galleryHoldsEscape` and their users) gate on
  `ctx.surface === "library" && libraryTabAtom === "canvases"`. `buildCouncilBindings` / `buildCouncilTabBindings`
  are live on Agent's `council` mode or on Library's Councils tab with a council open. New `library:tab-1..3`
  (keys `1` `2` `3`, navigate posture, surface `library`, not while a text field holds focus) and `library:back`
  (Escape, strict: a session/run open → `leaveLibraryDetail`, a council open and no council panel holding Escape →
  `leaveLibraryCouncil`). `library` joins `ESC_HOME_SURFACES`, standing down whenever the gallery, a Library detail or a
  council holds Escape, so one Escape never means two things (`assertNoConflicts`). `agent:leave-center`'s label and
  `when` drop History, the canvases and sessions. Register the atoms you read in `whenstate.ts`.
- `inAgentSwap` (~373) gates `galleryViewerOpen()` on `ctx.surface === "agent"`: on Library the gallery viewer must
  hold `[` `]` too, or they switch surface; give the Library case its own clause. Fill `buildLibraryBindings` (Task 1's
  stub, activated by Task 2) with `library:tab-1..3` and `library:back`; the gallery and council bindings stay where
  they are, regated.
- Footer hints and the palette group for `library`. `docs/keyboard-shortcuts.md`: Ctrl+7, `g l`, the three tab keys,
  Escape in Library; the `g s`/`g v`/`g o` lines say they open Library.
- Tests: `bindings.test.ts` (Ctrl+7 → Library; `go:canvases` lands on Library's Canvases; gallery keys live on Library
  and dead on Agent; Escape in Library with and without a detail open; no conflicts), and fix `store.test.ts` /
  `footer-visible.test.ts` cases that set the removed modes, moving them to Library.
- Acceptance: `library-tabs` steps "Ctrl+7 opens Library", "keys 1 2 3 switch tabs", "arrow keys move the gallery's card cursor and `[` `]` page an open canvas without leaving
  Library", "r c m switch a council's views inside Library" and "Escape from a session opened
  in Library goes back" show these keys.

### Task 6: Agent drops History, the gallery, Councils, sessions and the Conversations section
**Depends on:** Task 2 (Library must host History, the gallery, Councils and the session/run panes before Agent drops them), Task 4 (every caller of showSession/showHistory/showCanvases/showCouncils moves to Library first), Task 5 (bindings stop importing the removed openers and modes)
**Files:** `frontend/app/view/agents/agentcenter.ts`, `frontend/app/view/agents/agentcenter.test.ts`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/projectfoldstore.ts`, `frontend/app/view/agents/agentsleep.ts`, `frontend/app/view/agents/agentsleep.test.ts`, `frontend/app/view/agents/notifysync.tsx`, `frontend/app/view/agents/unreadagents.ts`, `frontend/app/view/agents/unreadagents.test.ts`, `frontend/app/view/agents/unreadagentsstore.ts`, `frontend/app/view/agents/launchermodal.tsx`, `frontend/app/view/agents/gridstore.test.ts`, `frontend/app/view/agents/docreviewstore.test.ts`

- `agentcenter.ts`: `CenterMode` = `terminal | council | project | held`; remove `showHistory`, `showCanvases`,
  `showCouncils`, `showSession`, `centerForSelection`, `CenterBack`, `centerBackAtom`, `backFor`, `backLabel`;
  `leaveCenter` goes to the terminal. Update its header comment and `agentcenter.test.ts`.
- `agentsurface.tsx`'s centre renders only council, project, held. `agenttree.tsx` drops the three top rows
  (`data-agent-history-open`, `-canvases-open`, `-councils-open`) and the whole Conversations section with what only it
  uses (`ConversationRow`, `RunConversationRow`, the "elsewhere" row, `conversationPressesAtom`, the session scan it
  triggers if nothing else needs it); `collapsedConversationProjectsAtom` and `endedConversationsByProject` /
  `registeredConversations` go when nothing else reads them (grep `scripts/` too: `scenarios.mjs` names
  `registeredConversations` in a string; Task 7 rewrites that scenario).
- Every reader of the removed modes (`agentsleep.ts`, `notifysync.tsx`, `unreadagents*.ts`, `launchermodal.tsx`, and
  the tests `gridstore.test.ts` (sets `history`/`session`, ~130-271) and `docreviewstore.test.ts` (~175), whose cases
  move to `project` or `council`) is
  fixed so tsc is clean; behaviour for `terminal` and `council` stays.
- Acceptance: `surface-smoke`'s step "Agent sidebar shows no History, Canvas gallery or Councils row and no
  Conversations section" (Task 7) shows it; the vitest files above pass.

### Task 7: Scenarios, docs and CHANGELOG
**Depends on:** Task 3 (library-tabs' closed-council steps need the council host), Task 6 (the scenarios assert the Agent tree without the rows and the Library that replaces them, which exist only once Tasks 1-6 have landed)
**Files:** `scripts/cdp/attach.mjs`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-library.mjs`, `scripts/cdp/scenarios-jarvis-later.mjs`, `scripts/cdp/scenarios-rail-transcript.mjs`, `scripts/cdp/scenarios-session-search-find.mjs`, `scripts/cdp/scenarios-session-search-history.mjs`, `scripts/cdp/scenarios-chat-council.mjs`, `scripts/cdp/scenarios-jarvis-activity.mjs`, `scripts/cdp/scenarios-kael1113-final.mjs`, `scripts/cdp/scenarios-monitor-tasks.mjs`, `scripts/cdp/council/tree.mjs`, `scripts/cdp/council/fixtures.mjs`, `scripts/cdp/council/finalproposal.mjs`, `scripts/cdp/council/setup.mjs`, `scripts/cdp/overlays-frost/agents.mjs`, `scripts/cdp/final-verify.test.mjs`, `CHANGELOG.md`, `AGENTS.md`, `docs/reference/architecture.md`

- `surface-smoke`: the rail reads Cockpit, Jarvis, Agent, Usage, Library, Code, Diff; Ctrl+7 lands on Library (the
  "Ctrl+7 leaves the surface on Diff" step changes); `SMOKE_SURFACES` / labels include Library; add the step "Agent
  sidebar shows no History, Canvas gallery or Councils row and no Conversations section".
- `attach.mjs`'s `SURFACE_LABEL` gains `library: "Library"`, or `h.goto("library")` throws. In `scenarios.mjs`, the
  `agent-history` scenario (its step ~17929) and `rail-tabs` (step ~38253) assert the old rail or the History row:
  update them too.
- New `library-tabs` scenario in `scripts/cdp/scenarios-library.mjs` (register it where the other split files are
  imported), each step with a screenshot: rail Library opens Conversations; j/k move the Conversations list cursor; Ctrl+7 opens Library; keys 1 2 3 switch
  tabs; Canvases tab shows the gallery; arrow keys move the gallery's card cursor and `[` `]` page an open canvas
  without leaving Library; Councils tab shows the list; a session opened from Usage reads full width and
  Back returns to Usage; Escape from a session opened in Library goes back; a closed council (fixture) opens inside
  Library with Back to the list, its Summary and Map tabs switch inside Library (by click and by r c m) and Agent's `councilSelAtom` is
  unchanged; a council kept in the tree opened from Jarvis lands on Agent.
- Every scenario that opened History, the gallery or Councils through the tree rows (`data-agent-history-open`,
  `-canvases-open`, `-councils-open`), the Conversations section (`data-agent-conversations…`), `C.showHistory` /
  `centerModeAtom` modes, or asserts `mode === "session"`, now opens Library (rail, `showLibrary`, or the tab
  attributes) and asserts Library's atoms. Grep `scripts/cdp` for each; a Conversations-section scenario with nothing
  left to test is removed, said so in the commit. Run `npx vitest run scripts/cdp` for the `.test.mjs` files touched.
- `CHANGELOG.md`: one `Changed` line under Unreleased, for the user: History, Canvas gallery and Councils now live on
  their own Library page (Ctrl+7) and the Agent sidebar keeps only what is live, ending `<!-- try: go:library -->`
  (the id `g l` gets by default, `go:${surface}`).
- `AGENTS.md` and `docs/reference/architecture.md`: rewrite the lines that say past conversations are Agent centre
  modes and list Agent's three sidebar sections and `SURFACE_ORDER`; name Library, its tabs and `librarystore.ts`.
- Acceptance: Final runs `surface-smoke library-tabs canvas-gallery jarvis-brief-later`; every step passes with a
  screenshot.
