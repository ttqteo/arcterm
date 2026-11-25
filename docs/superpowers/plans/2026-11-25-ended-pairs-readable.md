# Read a judge pair again, on either machine

**Spec:** `docs/superpowers/specs/2026-11-25-ended-pairs-readable-design.md` (read its "Decisions made while planning": every task builds on the names and shapes it fixes)
**Verify:** `node scripts/verify.mjs ./pkg/agentpair/... ./pkg/wshrpc/... ./cmd/wsh/... ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs library-tabs boards-library library-pair-open library-pairs project-overview-history pair-conversation pair-decided council-tree council-bench-chart`
**Prototype:** D:\work\arcterm\.superpowers\design\ended-pairs-readable\project\B-under-worker-session.dc.html

Shape of the work: Task 1 lands the interface (the new fields, the wire types, `PairHistoryCommand`'s signature, the
generated bindings, the pair words and the frontend's history store). Task 6 (the shared placing rule) needs none of it
and starts at once. On Task 1: Task 2 (the history read and the `PairGet` fallback), Task 3 (the `Manager` stamps
session ids and the updated time), Task 4 (`wsh read <pairId>`) and Task 5 (the read-only pair view) run side by side.
Task 7 (Library's three tabs, the full-width council and pair views, the routes) follows Task 5; Task 8 (Conversations'
pure rows) follows Task 6. Task 9 (Conversations' view) and Task 10 (the Overview's pair rows, the `pair:` address) close
it, side by side.

The prototype board still draws a Councils tab: the spec's later decision (three tabs) wins, as its planning section
says. The mit-thesis `sync_history.py` part is not in this plan (another repo); the lead delivers it separately.

Rules for every task:

- Principles: simple and direct, KISS, YAGNI, DRY, one source of truth; measure before optimizing; no abstraction for a
  single implementation; handle errors at the boundaries and never swallow one silently (a pair file that does not
  read is logged and skipped, as `store.loadActive` does; a failed RPC read logs and is shown, never left loading).
- Never hand-edit generated files (`frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`,
  `pkg/wshrpc/wshclient/wshclient.go`): edit the Go types and run `task generate`.
- Go tests on Windows: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/x -run '^TestName$'`.
- Frontend: pure logic in `.ts` with `.test.ts` beside it (`npx vitest run <file>`), no jsdom render tests. Colors from
  `@theme` tokens only, Tailwind over SCSS, `DESIGN.md` for layout and motion (read it before styling). `task check:ts`
  with a 4-minute timeout. Lint and format only the paths you touched (`npx eslint <paths>`, `npx prettier --check
  <paths>`); never run prettier on `scripts/*.mjs`.
- A CDP scenario step a task adds is written so the Final can run it: seed pairs through the page's dev mock
  (`devMockPairsAtom`; `scripts/cdp/pair-fixtures.mjs`'s `seedPair`, `stubPairRpc`) and sessions through transcripts in
  a temp folder (as `library-tabs` in `scripts/cdp/scenarios-library.mjs` does). No worker runs CDP: the Final does.
- Copy is English, as the rest of the cockpit; the board's Vietnamese sample copy is sample data.

### Task 1: The interface: pair fields, wire types, bindings, pair words and the history store
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/agentpair/pair.go`, `pkg/agentpair/view.go`, `pkg/agentpair/view_test.go`, `pkg/agentpair/manager.go`, `pkg/wshrpc/wshrpctypes_pair.go`, `pkg/wshrpc/wshserver/wshserver_pair.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/app/view/agents/pairreadmodel.ts`, `frontend/app/view/agents/pairreadmodel.test.ts`, `frontend/app/view/agents/pairstore.ts`, `frontend/app/view/agents/pairstore.test.ts`

Everything other tasks build on, kept small.

- Go fields: `agentpair.Side.Session` (`json:"session,omitempty"`), `agentpair.Pair.UpdatedTs` (`json:"updated"`).
  Nothing sets them yet (Task 3 does). `agentpair.DirName = "pairs"`, `agentpair.SyncedDirName = "pairs-synced"`;
  `getPairManager` builds its `Dir` from `DirName`. `ErrNoPair = errors.New("no pair")` in `manager.go`, and
  `errNoPair(id)` wraps it (`fmt.Errorf("%w %q", ErrNoPair, id)`, the message unchanged).
- `view.go`: `sideInfo` carries `Session`; `Info` sets `UpdatedTs` (a file without `updated` reads its `LastTs`: the
  spec's "a pair saved before this change lists by its last message's time").
- Wire (`wshrpctypes_pair.go`): `PairSide.Session` (`json:"session,omitempty"`), `PairInfo.UpdatedTs`
  (`json:"updatedts"`), `PairInfo.Synced` (`json:"synced,omitempty"`), and
  `PairHistoryCommand(ctx, CommandPairHistoryData) (*CommandPairListRtnData, error)` with `CommandPairHistoryData{
  Project string \`json:"project"\` }` in `PairCommands`. `wshserver_pair.go`'s `PairHistoryCommand` returns the
  manager's `List()` filtered to the project until Task 2 makes it read the folders (so the frontend has live pairs
  from the first merge). Run `task generate`.
- `pairreadmodel.ts` (pure), the one source of a pair's words off the Agent surface:
  - `pairStateWords(info: Pick<PairInfo, "state" | "stopreason" | "synced">): string`: `settled` → "both sides
    settled", `token-cap` → "token cap reached", `no-new-points` → "no new points", `judges-gone` → "judges gone",
    ended → "ended", relaying → "still relaying"; a synced pair adds " · as of the last sync".
  - `pairReadHeader(view: PairView)`: `{ title, line }`: title `<worker name> with judge <short id>` (or `with N
    judges`); line `<Ended | Stopped | Relaying since> dd/MM hh:mm · <state words> · <tokens> tokens` (`formatTokens`),
    the time from `updatedts`.
  - `pairTranscripts(view: PairView)`: `{ label, sel }[]` for the worker and each judge with a session id, `sel` =
    `<harness>:<session>` (the Conversations selection key); a side without one is left out.
  - `pairHistoryMatches(info: PairInfo, q: string): boolean`: worker name, judge short ids, project.
- `pairstore.ts`:
  - `usePairHistory(project: string): PairInfo[] | null` over a per-project atom (null before the first read), read
    with `PairHistoryCommand` and again on every `pair:update`; with the dev mock set it is the mock's views (as their
    `PairInfo`), filtered by project (`""` every project).
  - `pairListAtom` (the live list) leaves a mocked pair out when it is `ended` or `synced`, as the server's `PairList`.
  - A failed `PairGetCommand` read is kept per id (`pairViewErrorAtom(id): string | null`, cleared by the next good
    read), so a view can say it did not read instead of loading for ever.

Acceptance (focused tests):
- `go test ./pkg/agentpair -run 'TestInfo|TestView'`: `Session` and `UpdatedTs` reach the wire; a pair without
  `updated` reads its last message's time.
- `npx vitest run frontend/app/view/agents/pairreadmodel.test.ts frontend/app/view/agents/pairstore.test.ts`: every
  state's words and the synced suffix; the header for an ended, a relaying and a two-judge pair; transcripts skip a side
  without a session id; `pairHistoryMatches`; the mocked history filters by project; the mocked live list leaves out an
  ended and a synced pair; a failed read sets the error atom and a later good read clears it.

### Task 2: Every pair file reads back: the history read and the `PairGet` fallback
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/agentpair/store.go`, `pkg/agentpair/store_test.go`, `pkg/agentpair/history.go`, `pkg/agentpair/history_test.go`, `pkg/wshrpc/wshserver/wshserver_pair.go`, `pkg/wshrpc/wshserver/wshserver_pair_test.go`

- `store.readAll` reads every pair file of a folder (one bad file logged and skipped, a missing folder is no pairs);
  `loadActive` becomes `readAll` filtered to the not-ended ones, so the two never disagree on what a file is.
- `history.go`:
  - `func History(ownDir, syncedDir, project string) ([]wshrpc.PairInfo, error)`: every pair file of both folders, any
    state, as `Info` gives it, `Synced` true for the synced folder's; `project ""` is every project, otherwise matched
    with `storage.SamePath` (cleaned, no case on Windows; if importing `pkg/storage` makes a cycle, a three-line local
    helper with the same rule). Newest first by `UpdatedTs`, then id. An id in both folders is the own folder's.
  - `func Read(ownDir, syncedDir, id string) (*wshrpc.PairView, error)`: the pair's `View` from the own folder's file,
    else the synced folder's (`Synced` set). An id not matching `^[A-Za-z0-9_-]{1,64}$` is refused before it names a
    file; an id in neither folder returns an error wrapping `ErrNoPair`.
- `wshserver_pair.go`: one var naming the two folders under the data dir (a test points it at temp folders);
  `PairHistoryCommand` returns `agentpair.History(...)` (replacing Task 1's live-list body); `PairGetCommand` returns
  the manager's view and, on `errors.Is(err, agentpair.ErrNoPair)`, `agentpair.Read(...)`.
- The `Manager` is never given the synced folder: nothing here names it to the manager.

Acceptance (focused tests):
- `go test ./pkg/agentpair -run 'TestHistory|TestRead|TestStoreReadAll|TestSyncedNeverLoaded'`: `History` lists an
  ended and a relaying pair of the own folder and a synced one (marked `Synced`), filters by project, orders newest
  first, prefers the own copy of a doubled id; `Read` finds an ended pair in the own folder and a synced one, refuses
  `../x`, returns `ErrNoPair` for an unknown id; a `Manager` over the own folder, with a relaying pair in the synced
  folder, never lists it after `Load`, and the synced file's bytes are unchanged after `Load` and a `TurnEnded` for its
  tabs.
- `go test ./pkg/wshrpc/wshserver -run 'TestPairHistoryCommand|TestPairGetFallsBack'`: the command lists both folders;
  `PairGetCommand` serves an ended pair from its file and a synced one from the synced folder.

### Task 3: The Manager stamps each side's session id and the updated time
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/agentpair/manager.go`, `pkg/agentpair/manager_test.go`

- A side's session id is derived in the manager from `AgentFacts.Transcript` (already there) with
  `agentobserve.TranscriptSession` (`pkg/agentobserve` does not import `pkg/agentpair`: no cycle). `AgentFacts` gains
  no field, and `wshserver_pair.go` does not change.
- `Start` stores `Session` on the worker's side (new pair) and on the joining judge's side, from `pairable`'s facts.
- `saveLocked` sets `p.UpdatedTs = m.nowMs()` before every save, so every change (`change`, `Start`, `undoStart`)
  stamps it.
- A side whose `Session` is still `""` gets it at its first turn end: in `TurnEnded`, for that tab's side, one
  `Link.Agent` read; a found id is stored and saved with the turn's change. A failed read is logged and tried again at
  the next turn end. A side that has an id keeps it for good (no second read).

Acceptance (focused tests):
- `go test ./pkg/agentpair -run 'TestStartStoresSessions|TestJudgeJoinStoresSession|TestSessionAtFirstTurnEnd|TestSessionKept|TestSaveStampsUpdated'`
  (the fake link's transcript paths name a session per tab): a new pair's worker and judge carry their session ids; a
  judge added later carries its own; a judge whose facts had no transcript gets its id at its first turn end and keeps
  it when the fake later reports another; every save advances `UpdatedTs` to the manager's clock.

### Task 4: `wsh read <pairId>` prints a pair as text
**Depends on:** Task 1 (uses the wire's `PairView`, `PairSide.Session`, `PairInfo.Synced` and `PairHistoryCommand`)
**Model:** sonnet
**Files:** `pkg/agentpair/document.go`, `pkg/agentpair/document_test.go`, `cmd/wsh/cmd/wshcmd-read.go`, `cmd/wsh/cmd/wshcmd-read_test.go`, `skills/runs/SKILL.md`, `docs/guide/agent-integration.md`

- `agentpair.Document(v *wshrpc.PairView, loc *time.Location) string`, pure (the location so a test pins `hh:mm`):
  - `# Pair <id8> · <worker name> · judge <short ids, comma-separated>`
  - one line: `Project: <project> · <state words> · <tokens> of <cap> tokens`; the state words say the state and why
    (settled → "stopped: both sides settled", token-cap → "stopped: token cap reached", no-new-points → "stopped: no
    new points", judges-gone → "stopped: judges gone", relaying → "relaying", ended → "ended"); a synced pair adds a
    line `Synced from another machine; as of <date hh:mm>`.
  - each message: `[hh:mm] Who → Whom` then its shown text (its quote line as `> …` when it has one). Who/Whom:
    `Worker`, `Judge <short id>`, `You`, `System`; a worker's message goes to `Judge`/`Judges` (the live judges), a
    judge's to `Worker`, a person's to its `To` (both → `Both`, worker, judge, or one judge by its short id); a system
    line has no `→`. A held command shows as `  held: <command>` (and `(let through hh:mm)` once run).
  - `## Decided`: `### Agreed` numbered, `### Your answers` (`- <item> → <answer>`, only answered asks), `### Still
    open` (`- <text>`, with `(reopened by Judge <short>)` / `(new point from Judge <short>)` when it says so); an empty
    section reads `(none)`.
- `wshcmd-read.go`: `readKindPair = "pair"` in `readKinds` after `council` (a bare id is looked up in pairs too);
  candidates from `PairHistoryCommand{Project: ""}`, labelled `<state> · <worker name> · judge <short>` (` · synced`
  for a synced one); the text from `PairGetCommand` through `Document` in the local time zone. The `Use`/`Short`/`Long`
  help, the "is not …" error and its hint (`wsh read pair:<id>`) name pairs.
- Docs that list what `wsh read` reads name a pair too: `skills/runs/SKILL.md` (the description's list and the
  `wsh read` bullet) and `docs/guide/agent-integration.md`.

Acceptance (focused tests):
- `go test ./pkg/agentpair -run 'TestDocument'`: a view with two judges, a person's message to one judge, a quoted
  reply, a held command let through, every Decided section, and a synced ended one, printed exactly (golden strings).
- `go test ./cmd/wsh/cmd -run 'TestParseReadRef|TestPickReadHits|TestReadPair'`: `pair:<id>` parses; a pair hit sorts
  after a council's in a match list; the label reads as specified.

### Task 5: The read-only pair view
**Depends on:** Task 1 (uses `pairreadmodel.ts` and the store's history and error atoms)
**Model:** sonnet
**Files:** `frontend/app/view/agents/pairreadpane.tsx`, `frontend/app/view/agents/pairpane.tsx`, `frontend/app/view/agents/pairpanemodel.ts`, `frontend/app/view/agents/pairpanemodel.test.ts`, `frontend/app/view/agents/raildecidedpane.tsx`

What the board's right half draws (header, thread, the "Đã chốt" column, foot line), as a component Library places; no
route opens it yet (Task 7 and Task 9 do).

- `pairpanemodel.ts`: `pairControls({ readOnly, ended })` → which of the top bar, composer, Reply, Run now, Unpair and
  the ended footer show (read-only: none). `PairConversation` in `pairpane.tsx` is exported (it is module-private
  today) and takes `readOnly?: boolean`, drawing from `pairControls`; read-only it marks nothing seen
  (`markPairSeen` stays the live view's). The live view is unchanged.
- `RailDecidedPane` takes `readOnly?: boolean`: no answer chips and no "other…" button; an answered ask still shows
  "You answered …"; Agreed's links still scroll the thread.
- `pairreadpane.tsx`: `PairReadView({ model, pairId, openSession }: { model: AgentsViewModel; pairId: string;
  openSession: (sel: string) => void })`: reads with `usePairView`; the header from `pairReadHeader`; the read-only
  thread and the read-only Decided list side by side (Decided at the rail's width, the thread taking the rest, each
  scrolling on its own); the foot line `This pair is over. Read-only.` (ended), `Read-only here; it relays on the Agent
  surface.` (relaying or stopped) or `Synced from another machine. Read-only.`, then `Transcripts:` and one link per
  `pairTranscripts` entry calling `openSession(sel)`. Not read yet: `Loading the conversation…`; a failed read
  (`pairViewErrorAtom`): `This pair did not read: <error>` with a Retry. Data attributes for the scenarios:
  `data-pair-read`, `data-pair-read-header`, `data-pair-read-decided`, `data-pair-read-foot`,
  `data-pair-read-transcript`, `data-pair-read-loading`, `data-pair-read-error`.

Acceptance (focused tests):
- `npx vitest run frontend/app/view/agents/pairpanemodel.test.ts`: `pairControls` drops the composer, Reply and Run
  now (and bar, Unpair, footer) read-only and keeps today's set otherwise.
- The rendered view: Task 7's `library-pair-open` steps "pair open read-only", "pair loading" and "pair unreadable",
  and Task 9's `library-pairs` step "pair in the detail pane" (the live foot on a relaying pair); the existing
  `pair-conversation` and `pair-decided` scenarios still pass on the live view.

### Task 6: One placing rule for both Histories
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/historyplace.ts`, `frontend/app/view/agents/historyplace.test.ts`, `frontend/app/view/agents/projectoverviewmodel.ts`, `frontend/app/view/agents/projectoverviewmodel.test.ts`

- `historyplace.ts` (pure): the rule that puts a run, a council or a pair under the session that started it, with no
  time window and no project filter:
  `placeUnderSessions<T>(sessions: readonly LiveSession[], items: readonly { item: T; sessionId?: string; transcript?: string }[]): { owned: Map<string, { owner: LiveSession; items: T[] }>; loose: { item: T; named: boolean }[] }`,
  keyed by `sessionKey(owner)`: an item with a `sessionId` belongs to the session of that id, one with a `transcript`
  to the session whose transcript path matches (compared as `normPath` does today: slashes and case); one whose session
  is not in `sessions` is loose, `named` saying whether it named one at all. Items keep their order; the caller sorts.
- `projectoverviewmodel.ts`: `historyRows` places runs and councils through `placeUnderSessions`; its 7-day window,
  project filter, query and "Started from the cockpit" prefix stay its own. No new history kind and no signature change
  here (Task 10 adds pairs), so every caller and view stays as it is.

Acceptance (focused tests):
- `npx vitest run frontend/app/view/agents/historyplace.test.ts frontend/app/view/agents/projectoverviewmodel.test.ts`:
  `placeUnderSessions` places by id and by transcript (Windows and POSIX spellings), leaves an unknown owner loose with
  `named` true and a missing one with `named` false; every existing `historyRows` test passes unchanged.
- No view changes: the Overview's History is shown by `project-overview-history`, which must still pass.

### Task 7: Library keeps three tabs; councils and pairs open full width in Conversations
**Depends on:** Task 5 (renders `PairReadView`)
**Model:** sonnet
**Files:** `frontend/app/view/library/librarystore.ts`, `frontend/app/view/library/librarystore.test.ts`, `frontend/app/view/library/librarysurface.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/store.test.ts`, `frontend/app/store/keybindings/whenstate.ts`, `frontend/app/cockpit/uiapi.ts`, `frontend/app/cockpit/uiapi.test.ts`, `frontend/app/cockpit/uiclient.ts`, `frontend/app/cockpit/footerhints.ts`, `frontend/app/cockpit/footerhints.test.ts`, `frontend/app/cockpit/footer-visible.test.ts`, `frontend/app/view/agents/councilnotify.ts`, `frontend/app/view/agents/councilnotify.test.ts`, `frontend/app/view/agents/councilnotifysync.tsx`, `frontend/app/view/agents/councilremove.ts`, `frontend/app/view/agents/councilhost.test.ts`, `frontend/app/view/agents/councilreveal.test.ts`, `frontend/app/view/jarvis/openref.test.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios-library.mjs`, `scripts/cdp/scenarios-boards-library.mjs`, `scripts/cdp/scenarios-library-pairs.mjs`, `scripts/cdp/scenarios.mjs`

The routes and the frame; the list itself is Task 9's.

- `librarystore.ts`:
  - `LibraryTab = "conversations" | "canvases" | "boards"`, `LIBRARY_TABS` in that order (keys `1`–`3`).
  - `LibraryConvView` gains `"council" | "pair"`. `setLibraryCouncil` (and so `showLibraryCouncil`, `openCouncil`'s
    Library branch and `LIBRARY_COUNCIL_HOST.open`) sets the tab to `conversations` and the view to `council`, keeping
    `view` and `only`. `leaveLibraryCouncil` goes: the council view's Back is `leaveLibraryDetail`, which also clears
    `libraryCouncilSelAtom`.
  - `libraryPairSelAtom: string | null`; `showLibraryPair(model, id)` (tab `conversations`, view `pair`, `landOn`);
    `openPair(model, id)`: the one route from outside a pair's views (a pair in `pairListAtom` → `showPair(id, model)`
    on Agent's centre; any other → `showLibraryPair`).
  - `libraryConvKindsAtom: { judge: boolean; council: boolean }` (both false), and `showLibraryCouncils(model)`:
    Conversations' list with `{ judge: false, council: true }`.
- `librarysurface.tsx`: the three tabs; Conversations' views: `list`, `session`, `run`, `council` (the council under a
  Back row inside `LIBRARY_COUNCIL_HOST`, as the Councils tab drew it, `data-library-council-back`), `pair`
  (`PairReadView` of `libraryPairSelAtom` under a Back row, `data-library-pair-back`, its transcript links through
  `showLibrarySession`). The bench chart and `CouncilHistory` leave this file (Task 9 places the bench over the list).
  Keep the person's in-flight tab-strip restyle if it has landed on `main` by then (an underline indicator, no `kbd`):
  merge with it, never revert it.
- `bindings.ts`: `go:councils` (`g o`) runs `showLibraryCouncils`, labelled "Councils (in Conversations)";
  `LIBRARY_TAB_LABEL` and the tab keys follow the three tabs; `libraryOpen().council` reads `conv === "council"` on
  Conversations; `library:back` sends a `council` view to `leaveLibraryDetail` unless the council holds Escape, and a
  `pair` view (part of `detail`) to `leaveLibraryDetail`. `whenstate.ts`'s predicate atoms follow.
  `footerhints.ts`: Library's tab chip names `library:tab-1`–`3` with glyph `1 2 3`.
- `uiapi.ts`: `parseSurfaceAddress("surface:councils")` returns `{ surface: "library", tab: "conversations",
  councils: true }` (a new optional field) and the tab name list for errors drops `councils` as a tab; `uiclient.ts`'s
  `handle_uireveal` calls `showLibraryCouncils(model)` when `councils` is set, `showLibrary(model, tab)` otherwise.
- `councilnotify.ts` / `councilnotifysync.tsx`: "Library has the council open" is the `council` view on Conversations
  with that council selected (`LibraryShown` says so). `councilremove.ts`: removing the open council leaves that view
  (`leaveLibraryDetail`).
- `docs/keyboard-shortcuts.md`: Library is Conversations, Canvases and Boards (`1`–`3`); `g o` opens Conversations with
  the Council chip on; Esc in a council or pair opened in Conversations; the "Library: Councils" section becomes
  councils in Conversations.
- CDP:
  - `library-tabs` (`scripts/cdp/scenarios-library.mjs`): three tabs, keys `1`–`3`, and a council opened from outside
    (`showLibraryCouncil`) landing in Conversations' full-width council view, whose Back and Esc return to the list.
  - `boards-library` (`scripts/cdp/scenarios-boards-library.mjs`) step 1 presses `4` for Boards and reads a `kbd`
    beside each tab label: Boards is `3` now, and the step reads the key from the tab's `aria-keyshortcuts`.
  - New `scripts/cdp/scenarios-library-pairs.mjs`, registered in `scripts/cdp/scenarios.mjs`, scenario
    `library-pair-open`: seed an ended pair (an answered ask, two Agreed, one Still open, both sides with a session)
    and a synced one; open each with `openPair` from another surface. Step "pair open read-only" shoots the full-width
    view and asserts the header's title and line, the thread, the Decided column with the answered ask, the foot line
    and its two transcript links, and no composer, Reply, Run now or Unpair. Step "synced pair foot" asserts the synced
    foot line. Step "pair back" presses Esc and asserts the surface it came from. Step "live pair opens on Agent": a
    relaying mocked pair opened with `openPair` lands on Agent's centre. Step "pair loading" (mock cleared,
    `stubPairRpc` with `PairGetCommand` never answering) asserts `data-pair-read-loading`; step "pair unreadable"
    (`PairGetCommand` rejecting) asserts `data-pair-read-error` and its text; both restore the client afterwards.

Acceptance (focused tests):
- `npx vitest run frontend/app/view/library/librarystore.test.ts frontend/app/store/keybindings/bindings.test.ts frontend/app/store/keybindings/store.test.ts frontend/app/cockpit/uiapi.test.ts frontend/app/cockpit/footerhints.test.ts frontend/app/cockpit/footer-visible.test.ts frontend/app/view/agents/councilnotify.test.ts frontend/app/view/agents/councilhost.test.ts frontend/app/view/agents/councilreveal.test.ts frontend/app/view/jarvis/openref.test.ts`:
  three tabs and keys `1`–`3`; `showLibraryCouncil` lands on Conversations' `council` view with `view` and `only`;
  `openPair` routes a live pair to Agent and an ended or synced one to the `pair` view; `g o` and `showLibraryCouncils`
  set the chips to Council only; Esc leaves a council view (not while the council holds Escape) and a pair view;
  `surface:councils` parses to Conversations with `councils: true`; the footer's tab chip has no dangling id.
- CDP: `library-tabs`, `boards-library` step 1 (Boards on `3`) and `library-pair-open` (steps above).

### Task 8: Conversations' rows: nesting, the frontier, the chips, search
**Depends on:** Task 6 (uses `placeUnderSessions`), Task 1 (uses `pairStateWords`, `pairHistoryMatches` and the wire's `PairInfo`)
**Model:** sonnet
**Files:** `frontend/app/view/agents/conversationrows.ts`, `frontend/app/view/agents/conversationrows.test.ts`

The pure model of the board's left half (planning section: nesting, frontier, status filter, search, keyboard, row
text). No view; Task 9 draws it.

- `nestedRows(...)`: from the loaded live sessions, the run and solo entries Conversation History builds today
  (`groupRunSessions`), the councils and the pairs: each entry with its nested pairs and councils (newest first; an
  owner that is a run's member session nests under that run's entry), and the loose pairs and councils as entries of
  their own, placed by their own time. While older pages are unread (the archive cursor is not `""`), a loose item
  older than the oldest loaded session waits. The status filter applies to session and run entries; a nested item
  rides with its entry; a loose pair or council shows under All only.
- `flatRows(kinds, ...)`: with a chip on, only pairs (Judge), councils (Council) or both, newest first, no nesting, each
  naming the session that started it (`sessionLabel`, else "Started from the cockpit, not a session"; a session not
  loaded yet reads its short id).
- `searchRows(q, ...)`: the councils (`searchCouncilHistory`) and pairs (`pairHistoryMatches`) the query matches.
- Row keys and text: `pair:<id>` (in the `j`/`k` order) and `council:<id>` (not in it); a nested pair line reads
  `Pair with judge <short> · <state words>`, a nested council `Council: <feature>`; a loose or flat pair has the worker's
  name as title and `Judge <short> · <state words>` under it. A `navIds(rows)` helper gives the `j`/`k` order.

Acceptance (focused tests):
- `npx vitest run frontend/app/view/agents/conversationrows.test.ts`: a pair nests under its worker's solo session and
  under a run whose member session is its worker's; a council nests by session id; a pair without a session id and a
  council without one stand top-level by their time; a loose item older than the oldest loaded session waits while the
  cursor is not `""` and shows once it is; the status filter keeps nested items with their entry and loose ones under
  All only; each chip's flat rows and both, with the session named; search matches a council by feature and a pair by
  worker name; the `j`/`k` order holds pair rows and no council row; a relaying pair's line says "still relaying".

### Task 9: Conversations holds pairs and councils
**Depends on:** Task 8 (draws its rows), Task 7
**Model:** sonnet
**Files:** `frontend/app/view/agents/conversationhistory.tsx`, `frontend/app/view/agents/councilhistoryview.tsx`, `scripts/cdp/scenarios-library-pairs.mjs`, `scripts/cdp/council/tree.mjs`, `scripts/cdp/council/figures.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

- `conversationhistory.tsx`, reading the councils (`useCouncils("")`) and pairs (`usePairHistory("")`):
  - Judge and Council chips over the list (`libraryConvKindsAtom`, `aria-pressed`, `data-history-chip="judge|council"`);
    with one on, the status filter hides and the list is `flatRows`; off, `nestedRows`.
  - With the Council chip on, the bench chart (`CouncilBenchChart`, folded to one line until opened, in the box Library
    drew it in: `data-library-bench`) sits over the list.
  - A nested row is a tree line under its entry's card (`└`, as the board draws it), `data-history-nested="pair|council"`;
    a loose or flat pair is a card (`data-history-pair`); a flat council is `CouncilHistoryRowView`.
  - Council rows (nested and flat) keep Pin/Unpin (hover button and context menu) and Resume (menu) with
    `councilHistoryPinAct` / `resumeCouncil`; a click opens the council with `openCouncil`.
  - A pair row selects `pair:<id>`; the detail pane shows `PairReadView` with `openSession` selecting that session in
    the list. The list's `j`/`k` order is `navIds`.
  - While searching, the matched councils and pairs (`searchRows`) show as a section headed "Councils and pairs" above
    the session results.
- `councilhistoryview.tsx`: export `CouncilHistoryRowView`; delete the `CouncilHistory` list component and its query
  atom (grep every import first; Task 7 removed the only one).
- CDP, in `scripts/cdp/scenarios-library-pairs.mjs`, scenario `library-pairs`: seed transcripts whose stems are the
  sessions of an ended pair's worker and judge, a council carrying that worker's session id, a relaying pair under
  another session, a pair with no session id, and a synced pair. Steps: "pair nested under its session" (the `└` line
  under the worker's card, shot), "relaying pair nested" (its line says still relaying), "council nested", "loose pair
  top-level", "judge chip" (flat pairs, each naming its session, status filter hidden), "council chip" (flat councils,
  the bench line over them, a pin button on hover), "both chips", "pair in the detail pane" (click the ended pair's
  nested row: the read-only view beside the list with its header, Decided column and answered ask, foot line and
  transcript links, no composer, Reply or Run now; shot), "live pair in the detail pane" (the relaying pair's foot says
  it relays on the Agent surface), "transcript link" (selects the worker's session), "search finds a council".
  Update `council-tree` (`scripts/cdp/council/tree.mjs`: its Councils list is Conversations with the Council chip) and
  `council-bench-chart` (`scripts/cdp/council/figures.mjs`: `openLibraryCouncils` opens the chip and finds the bench
  over the list).
- `CHANGELOG.md`, top section: `Added` "Judge pairs stay readable after they end: Library's Conversations lists each
  pair under the session of the agent that worked, read-only with its Decided list, and pairs synced from your other
  machine read the same. `wsh read <pair id>` prints one as text." `Changed` "Councils moved into Conversations: the
  Councils tab is gone, `Mod+G o` opens Conversations with the Council chip on, and a council nests under the session
  that started it." Ordinary lines, not `<!-- big -->` (spec planning section).
- `docs/hand-checks.md`: `- [ ] (arcterm) Library pairs: take the What's new shot of a pair nested in Conversations and
  promote the Added line to big`, and one line per motion the scenarios cannot watch (the chips' list change, the
  detail pane's change from a session to a pair).

Acceptance:
- `task check:ts` clean.
- CDP: `library-pairs` (steps above), `council-tree`, `council-bench-chart`.

### Task 10: The Overview's History shows pairs; a `pair:` address opens one
**Depends on:** Task 6, Task 7
**Model:** sonnet
**Files:** `frontend/app/view/agents/projectoverviewmodel.ts`, `frontend/app/view/agents/projectoverviewmodel.test.ts`, `frontend/app/view/agents/projecthistory.tsx`, `frontend/app/view/jarvis/address.ts`, `frontend/app/view/jarvis/address.test.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`, `scripts/cdp/scenarios.mjs`

- `projectoverviewmodel.ts`: `historyRows(sessions, councils, runs, path, now, q, pairs: readonly PairInfo[] | null)`
  places pairs too, through `placeUnderSessions` by the worker's `session`. `HistoryItem` gains `{ kind: "pair"; key:
  "pair:<id>"; title; line; warn: ""; ts; since; pairId }` (`pairItem`: title `Pair with judge <short>`, line
  `pairStateWords(info)`, ts its `updatedts`). A pair whose worker has no session id is loose and named-less ("Started
  from the cockpit, not a session · …"), as a council without one.
- `projecthistory.tsx`: passes `usePairHistory(path)`; `openItem` and `KindLabel` branch on every kind (a pair opens
  with `openPair`: a live one on Agent, an ended or synced one in Library's full-width pair view); a pair row draws as
  a council's does, labelled "Pair" (`data-history-kind="pair"`), nested or top-level.
- `address.ts`: `pair:<id>` parses to `{ kind: "pair"; pairId }`; `openref.ts` opens it with `openPair` (no load to
  prove, as a council: the view reads it by id). `wsh ui` and Jarvis reach a pair through this.
- CDP: `project-overview-history` (in `scripts/cdp/scenarios.mjs`) gains a seeded ended pair whose worker session is
  one of its sessions: step "pair nested in History" asserts the `data-history-kind="pair"` row under that session;
  step "pair opens from History" clicks it and asserts Library's full-width pair view.

Acceptance (focused tests):
- `npx vitest run frontend/app/view/agents/projectoverviewmodel.test.ts frontend/app/view/jarvis/address.test.ts frontend/app/view/jarvis/openref.test.ts`:
  `historyRows` nests a pair under its worker's session, puts a pair without a session id and a council without one
  top-level, keeps the window and the query; `pair:<id>` parses and `pair:` alone is unsupported; opening a `pair`
  target routes a live pair to Agent and an ended one to Library's `pair` view.
- CDP: `project-overview-history` (steps above).
