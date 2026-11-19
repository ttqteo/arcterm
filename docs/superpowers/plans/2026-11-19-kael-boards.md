# Boards, ported from Kael's fork

Goal: an Excalidraw board per topic, drawn by a cheap read-only Sonnet drawer that a claude agent briefs with
`wsh board draw`, shown split beside that agent's Chat, with questions asked on the board forwarded to the agent, and
every board reachable again from Library → Boards.

Architecture: Go owns the board files, each board's talk (its turns) and the drawer (`pkg/boardstore`,
`pkg/boarddrawer`, `pkg/boardforward`, handlers in `pkg/wshrpc/wshserver`); the frontend owns the scene and lands each
drawer answer through Excalidraw (`frontend/app/view/boards/`). The spec's "Builder decisions" section holds every
call made beyond the spec; read it before your task. Kael's code on `kael/main` (remote `kael`, already fetched: read it
with `git show kael/main:<path>`) is the starting point for every package named below, cut down to what the spec
keeps: no `pkg/boardthings`, no Boards surface, no New board / palette command / agent picker / agent chip, no
handoff summary, no pi agents, no words replies, no briefing-changes-topic choice. `main` has no workspace pane:
nothing is cherry-picked; port by reading and rewriting.

Principles every worker follows: simple, direct solutions; SOLID, KISS, YAGNI, DRY, one source of truth; measure before
optimizing; no abstraction for a single implementation; handle errors at boundaries and never swallow them silently.
Read `AGENTS.md` (tsc gotcha, generated files, Go test env on Windows, grid rules for the Agent surface, frontend
conventions: a pure `foo.ts` with `foo.test.ts`, a thin `foo.tsx`; colors only from `@theme` tokens) and `DESIGN.md`
before UI work.

**Spec:** `docs/superpowers/specs/2026-11-19-kael-boards-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/boardstore/... ./pkg/boardforward/... ./pkg/boarddrawer/... ./pkg/agentsessions/... ./pkg/wps/... ./pkg/tsgen/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs boards-split boards-chat boards-library`
**Prototype:** C:\Users\me\AppData\Local\arc-wt\b37db9e1\.superpowers\design\kael-boards-build\project

Go tests on Windows run with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in front (Bash). Never hand-edit
generated files: change the Go types, then `task generate`.

### Task 1: Board wire types, the board:update event, generated bindings
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_board.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`

The one interface every other task builds on. Port `kael/main:pkg/wshrpc/wshrpctypes_board.go`, trimmed and re-keyed
by project name (not channel id). Add `BoardCommands` to `WshRpcInterface` in `wshrpctypes.go` (no server code: the
handlers land in Task 4; there is no compile-time assertion, so wavesrv still builds). Add
`Event_BoardUpdate = "board:update" // type: wshrpc.BoardUpdateData` to `pkg/wps/wpstypes.go` and to its `AllEvents` list, and
`wps.Event_BoardUpdate: reflect.TypeOf(wshrpc.BoardUpdateData{})` to `WaveEventDataTypes` in `pkg/tsgen/tsgenevent.go`
(the header of `wpstypes.go` lists the steps). Run `task generate`.

Exactly these commands and shapes (doc comments as in Kael's file, adjusted):

```go
type BoardCommands interface {
	BoardListCommand(ctx context.Context, data CommandBoardListData) (*BoardListRtnData, error)
	BoardReadCommand(ctx context.Context, data CommandBoardRefData) (*BoardReadRtnData, error)
	BoardSaveCommand(ctx context.Context, data CommandBoardSaveData) (*BoardSaveRtnData, error)
	BoardTalkCommand(ctx context.Context, data CommandBoardRefData) (*BoardTalk, error)
	BoardAskCommand(ctx context.Context, data CommandBoardAskData) error
	BoardAskStopCommand(ctx context.Context, data CommandBoardRefData) error
	BoardAskRetryCommand(ctx context.Context, data CommandBoardTurnData) error
	BoardRerouteCommand(ctx context.Context, data CommandBoardTurnData) error
	BoardAnswerInboxCommand(ctx context.Context, data CommandBoardRefData) ([]BoardAnswer, error)
	BoardAnswerAckCommand(ctx context.Context, data CommandBoardAnswerAckData) error
	BoardAgentDrawCommand(ctx context.Context, data CommandBoardAgentDrawData) (*BoardAgentDrawRtnData, error)
}
type CommandBoardListData struct{ Project string `json:"project,omitempty"` } // empty: every project
type BoardListRtnData struct{ Boards []BoardInfo `json:"boards"` }             // most recently active first
type BoardInfo struct {
	ID, Name, Project, Path string // json: id, name, project, path (the .excalidraw, absolute)
	CreatedTs, ActiveTs, DrawnTs int64 // json: createdts, activets, drawnts,omitempty
	State      string // json: state,omitempty — "answering" while a turn runs, "failed" when the last turn failed
	LoadError  string // json: loaderror,omitempty
	Turns      int    // json: turns,omitempty
	Shapes     int    // json: shapes,omitempty — live elements, bound text not counted
	AgentTabId string // json: agenttabid,omitempty
	AgentTitle string // json: agenttitle,omitempty
}
type CommandBoardRefData struct{ Project, BoardId string } // json: project, boardid
type CommandBoardTurnData struct{ Project, BoardId, TurnId string } // json: project, boardid, turnid
type BoardReadRtnData struct { Info BoardInfo; Data string; Rev string } // json: info, data (the file's JSON text), rev
type CommandBoardSaveData struct{ Project, BoardId, Data, BaseRev string } // json: …, baserev
type BoardSaveRtnData struct { Rev string; Conflict bool } // json: rev,omitempty / conflict,omitempty
type CommandBoardAskData struct { Project, BoardId, Question, On string; SelectedIds []string } // json: …, on,omitempty, selectedids,omitempty
type CommandBoardAnswerAckData struct { Project, BoardId, AnswerId, TurnId string; ShapeIds []string; Error string } // error,omitempty: the landing failed
type CommandBoardAgentDrawData struct { BlockId, Board, Ask, Context string } // json: blockid, board, ask,omitempty, context,omitempty
type BoardAgentDrawRtnData struct {
	BoardId, BoardName, Project string
	Created bool
	State   string // the turn's end state: answered | failed | answering (still drawing when the wait ran out)
	Added, Changed, Removed int
	Reason  string // failed: why
}
type BoardArcRecord struct{ Name string; CreatedTs int64 } // the file's first key, "arc"
type BoardUpdateData struct { Project, BoardId, What, TurnId, State, Reason string } // What: list | talk | answer
type BoardAgent struct { TabId, Title, SessionId string; ReadTs int64 } // json: tabid, title, sessionid,omitempty, readts,omitempty
type BoardForward struct { State, Reason string; SentTs int64; Reply string; ReplyTs int64 } // State: waiting | sent | replied | agentgone
type BoardTalk struct {
	Project, BoardId, SessionId string
	ContextTokens int
	Agent *BoardAgent
	Turns []BoardTurn
}
type BoardTurn struct {
	ID string; Ts int64
	Kind string        // "ask" (yours: drawn or forwarded) | "request" (the agent's wsh board draw: drawn or failed)
	Question, On string
	SelectedIds []string
	Context string     // a request's briefing
	State string       // waiting | answering | answered | forwarded | failed | stopped
	Title string
	Added, Changed, Removed int
	ShapeIds []string
	StartedTs, AnsweredTs int64 // startedts: when it began answering (the UI's seconds and slow come from it)
	Reason string
	From string        // the turn a send-the-other-way redoes
	Forward *BoardForward
}
type BoardAnswer struct { ID, Project, BoardId, TurnId, Add, Update string; Remove []string; Ts int64 }
```

Use lowercase json tags with `omitempty` on optional fields, as in Kael's file. Acceptance: `go build ./pkg/... ./cmd/...`
passes; `task generate` leaves `frontend/types/gotypes.d.ts` with every type above and `wshclientapi.ts` with every
command; `frontend/types/waveevent.d.ts` maps `board:update` to `BoardUpdateData`;
`go test ./pkg/wshrpc -run 'TestGenerateWshCommandDecl|TestUiCommandsAreDeclared'` and
`go test ./pkg/tsgen -run 'TestWaveEventDataTypesCoverage|TestWaveEventTypesInSync'` pass.

### Task 2: Board store, forward marker, transcript turns
**Depends on:** Task 1 (uses the wire types it adds)
**Model:** sonnet
**Files:** `pkg/boardstore/doc.go`, `pkg/boardstore/boardstore.go`, `pkg/boardstore/boardstore_test.go`, `pkg/boardforward/doc.go`, `pkg/boardforward/boardforward.go`, `pkg/boardforward/boardforward_test.go`, `pkg/agentsessions/turns.go`, `pkg/agentsessions/turns_test.go`

Port three small packages from `kael/main`:

- `pkg/boardstore`: boards under `filepath.Join(wavebase data dir, "boards", ProjectDir(project))`, each
  `<id>.excalidraw` (its `arc` record first), a `<id>.talk.json` sidecar only wavesrv writes, and an answers inbox
  folder. Keyed by project name, not channel. API Task 4 relies on: `Root() string`, `ProjectDir(project string) string`,
  `ProjectDirs() ([]string, error)` (every project folder, for the all-projects list), `ValidID(id string) bool`,
  `List(dir, project string, state func(boardId string) string) ([]wshrpc.BoardInfo, error)` (fills `Turns`,
  `Shapes`, `ActiveTs`, `DrawnTs`, `AgentTabId`, `AgentTitle` from the talk; `Shapes` counts live elements, bound text
  not counted, as Kael's `copiedShapes`), `Create(dir, project, name string, agent wshrpc.BoardAgent, now int64)
  (wshrpc.BoardInfo, error)` (empty drawing, talk tied to agent), `FindByName(dir, project, name string)
  (wshrpc.BoardInfo, bool, error)` (trimmed, any case, most recently active first), `Read`, `Save(dir, id, data,
  baseRev string)` (rev-guarded: a stale base rev writes nothing and returns `Conflict`), `ReadTalk`, `UpdateTalk(dir,
  id, fn)` (under the dir lock), `PutAnswer`, `Answers(dir, boardId string)`, `AckAnswer(dir, boardId, answerId)`.
  Drop Kael's handoff, about and needs-agent facts.
- `pkg/boardforward`: `Marker(board, on, turnId, question string) string` and `ReplyAfter(turns []agentsessions.Turn,
  turnId string) (string, int64, bool)` as Kael's (the marker format is fixed by the spec's Builder decisions; the
  frontend's `boardforwardmarker.ts` mirrors it).
- `pkg/agentsessions/turns.go`: Kael's `TurnsSince(path, runtime string, sinceTs int64) []Turn`, claude only
  (drop the pi branch); reuse `main`'s `Turn` type in `digest.go` and its claude line parsing, and port whatever
  helper `main` lacks.

Acceptance, by focused tests: `go test ./pkg/boardstore -run 'TestCreate|TestList|TestSave|TestTalk|TestAnswers|TestFindByName|TestProjectDir'`
(rev conflict writes nothing; a hand edit and an ack-time save never overwrite each other; a broken file lists with
`LoadError`; shapes skip bound text and deleted elements), `go test ./pkg/boardforward -run 'TestMarker|TestReplyAfter'`,
`go test ./pkg/agentsessions -run 'TestTurnsSince'`.

### Task 3: The drawer
**Depends on:** Task 1 (uses the wire types it adds)
**Model:** opus
**Files:** `pkg/boarddrawer/doc.go`, `pkg/boarddrawer/drawer.go`, `pkg/boarddrawer/drawer_test.go`, `pkg/boarddrawer/drawer-prompt.md`, `pkg/boarddrawer/prompt.go`, `pkg/boarddrawer/prompt_test.go`, `pkg/boarddrawer/runner.go`, `pkg/boarddrawer/runner_test.go`, `pkg/boarddrawer/scene.go`, `pkg/boarddrawer/scene_test.go`, `pkg/boarddrawer/answer.go`, `pkg/boarddrawer/answer_test.go`, `pkg/wshrpc/wshserver/usagesessions.go`, `pkg/wshrpc/wshserver/usagesessions_test.go`

Port `kael/main:pkg/boarddrawer`, cut down. It knows nothing of the store or the roster: everything outside goes
through `Deps`.

- `type Board struct{ Project, BoardId, Name, ProjectPath string }`.
- `Deps`: `LoadTalk`, `UpdateTalk`, `ReadBoard`, `ReadAgent func(ctx, agent wshrpc.BoardAgent, sinceTs int64)
  (text, sessionId string, cursorTs int64, err error)` (what the agent said since the drawer's last read; Task 4 backs
  it with the transcript), `Deliver(wshrpc.BoardAnswer) error`, `Publish(wshrpc.BoardUpdateData)`, `Forward(b Board,
  turnId string)` (called outside any talk update once a turn is saved forwarded), `Run` (nil: `RunModel`), `Now`,
  `NewId`.
- `Drawer` methods Task 4 calls: `Ask(b, turn) (wshrpc.BoardTurn, error)` (a `kind:"ask"` while a turn runs is refused
  with `BusyReason`; a `kind:"request"` queues behind it), `Stop(b)` (ends the running turn `stopped`, nothing
  delivered), `Retry(b, turnId)`, `Answered(b, turnId string, shapeIds []string)` (the ack: turn → `answered`),
  `LandFailed(b, turnId, reason string)` (the frontend could not land it: turn → `failed`), `Talk(b)` (fails turns left
  answering or waiting after a restart with `RestartedReason`), `Busy(b)`, and `Wait(ctx, b, turnId)
  (wshrpc.BoardTurn, error)`, which returns the turn once it is `answered`, `failed`, `stopped` or `forwarded`, or when
  ctx ends.
- One turn at a time per board; each turn first reads the agent (`ReadAgent` from `talk.Agent.ReadTs`, saving the new
  cursor and session id once the turn ran; an agent that cannot be read costs the turn nothing), then runs the session
  (`--session-id` first, `--resume` after; a lost session starts a new one), then parses the reply.
- A reply is a drawing (`title`, `add`, `update`, `remove`) or `{"question":true}`. For an `ask` a question → state
  `forwarded`, `Forward{State:"waiting"}`, then `Deps.Forward`. For a `request` a question is a failure ("the drawer
  could not draw the agent's request"), never a forward. A drawing is delivered to the inbox and the turn stays
  `answering` until `Answered` or `LandFailed`; `Added/Changed/Removed` are set from the answer.
- Drop: handoff/summary, `Choose`, about kinds other than the agent, `SummarizeAboveTokens` (keep recording
  `ContextTokens`), `RemoveSession` unless the lost-session path needs it.
- `runner.go`: `claude --model sonnet`, tools `Read,Grep,Glob` only, `--strict-mcp-config`, cwd the project path,
  Kael's env (`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`, no CLAUDE.md, no auto-memory), through `consult.SpecFor("claude")`
  as Kael's. The spec requires the drawer's turns to count in Usage under the board's project. Its sessions are
  written under the project's cwd; read how Usage attributes a session to a project (`pkg/usagestats`,
  `pkg/wshrpc/wshserver/usagesessions.go`). If a headless session in the project's folder already counts there,
  prove it with a focused test in `usagesessions_test.go` and change nothing else; if it does not (for example
  headless sessions are skipped), make it count, in `usagesessions.go`, with that test.
- `drawer-prompt.md`: Kael's, with `[ABOUT]` becoming the board's briefing (the first request's `--context`) and
  `[HANDOFF]` removed; the turn text says whether the line is the person's ask (may be flagged) or the agent's request
  (must be drawn), and carries what the agent said since the last read and the selected shapes.

Acceptance, by focused tests with a stubbed `Run`: `go test ./pkg/boarddrawer -run 'TestAsk|TestBusy|TestRequestQueues|TestRequestNeverForwards|TestForward|TestStop|TestRetry|TestAnswered|TestLandFailed|TestRestart|TestWait|TestReadAgentCursor|TestPrompt|TestParseAnswer|TestRunnerArgs'`
and `go test ./pkg/wshrpc/wshserver -run 'TestUsageSessions.*Drawer'` (a drawer session in a project's folder counts
under that project).

### Task 4: wavesrv board handlers and the forwarder
**Depends on:** Task 2 (uses the store, marker and TurnsSince), Task 3 (uses the drawer)
**Model:** opus
**Files:** `pkg/wshrpc/wshserver/wshserver_board.go`, `pkg/wshrpc/wshserver/wshserver_board_test.go`, `pkg/wshrpc/wshserver/wshserver_boarddrawer.go`, `pkg/wshrpc/wshserver/wshserver_boarddrawer_test.go`, `pkg/wshrpc/wshserver/wshserver_boardforward.go`, `pkg/wshrpc/wshserver/wshserver_boardforward_test.go`, `pkg/wshrpc/wshserver/wshserver.go`

Port Kael's `wshserver_board*.go` onto `main`'s roster (`wshserver_agentmsg.go`: `agentRow`, `loadAgentRosterFacts`,
`buildAgentRoster`, `deliverToAgent`, `agentTranscriptPath`) and the Task 1 commands.

- List/Read/Save/Talk/Ask/Stop/Retry/AnswerInbox/AnswerAck: straight onto the store and drawer; publish
  `board:update` on every change. Ack with `Error` calls `LandFailed`. Ask on a board whose agent tab is no longer in
  the roster is refused: "the agent ended, so you can't ask here". `BoardListCommand` with an empty project lists every
  project folder's boards, newest first.
- `BoardAgentDrawCommand` (`wsh board draw`): resolve `BlockId` to its roster row; refuse a non-claude harness ("boards
  are for Claude agents") and an empty `Project` ("<agent> is not in a registered project"). Find the board by name in
  the agent's project; none and no `Context` is an error naming `--context`; none with `Context` creates it tied to this
  agent (`BoardAgent{TabId, Title (roster name), SessionId}`). A board tied to another agent keeps its tie. Ask a
  `kind:"request"` turn (`Question` = `Ask`, `Context` = `Context`), then `drawer.Wait` up to 9 minutes and return
  the turn's end state and counts (`answering` when the wait ran out).
- `ReadAgent` dep: the tied tab's current roster row → `agentTranscriptPath` → `agentsessions.TurnsSince(path,
  "claude", since)`, joined as the agent's words; returns the session id so the talk's `Agent.SessionId` follows
  `/clear` and compaction. A tab no longer in the roster reads nothing.
- Forwarder (`wshserver_boardforward.go`): Kael's, re-keyed by project, with states `waiting | sent | replied |
  agentgone`. On `Deps.Forward`: the tied agent asking (open ask or permission prompt) → `waiting`, indexed by tab;
  otherwise `deliverToAgent` (wakes a sleeping agent, queues behind a running turn) with
  `boardforward.Marker(board name, turn.On, turn.ID, turn.Question)` → `sent`; tab gone → `agentgone` with the reason.
  On each agent status event (hook it in `wshserver.go` beside `noteAgentTurnEnded`): a `waiting` forward goes once the
  agent is not asking; a `sent` forward at the agent's turn end reads `ReplyAfter` and stores `Reply`/`ReplyTs` →
  `replied`. The index rebuilds from the talk files on first use, so a restart loses none.
- `BoardRerouteCommand`: a drawn `ask` turn → a new `ask` turn with `From` set, forwarded at once (no drawer run); a
  forwarded turn → a new turn with `From` set, run by the drawer as a must-draw. The original turn is left as it was.

Acceptance, by focused tests (stub `RunModel`, the roster facts and `deliverAgentMessage` through their vars):
`go test ./pkg/wshrpc/wshserver -run '^TestBoard'` covering: agent draw creates and ties, needs `--context` for a new
board, refuses pi and a project-less agent, keeps another agent's tie, returns counts once acked and `answering` past
the wait (shorten the wait through a var); ask refused on an ended agent; forward waits while asking then goes; forward
wakes a sleeper via `deliverToAgent`; forward to a gone tab is `agentgone`; reply copied at turn end; reroute both ways;
an ack with `Error` fails the turn; the forwarder index survives a reset.

### Task 5: `wsh board draw`
**Depends on:** Task 1 (calls the generated `wshclient.BoardAgentDrawCommand`)
**Model:** sonnet
**Files:** `cmd/wsh/cmd/wshcmd-board.go`, `cmd/wsh/cmd/wshcmd-board_test.go`

Port Kael's command, cut to `wsh board draw --board <name> [--context "<briefing>"] [--ask "<question>"]` (one of the
two required). It sends the calling block's id (as the other agent commands find it) with an RPC timeout of 10
minutes. Output (exact, one line, the skill quotes it): answered → `Drawn on board "<name>": +A shapes, C changed, R
removed.` (exit 0); `answering` → `Still drawing on board "<name>"; its card in Chat shows when it lands.` (exit 0);
failed → `Couldn't draw on board "<name>": <reason>` (exit 1); an RPC error prints it (exit 1). Help text says the
drawer only draws, and what `--context` and `--ask` are for.

Acceptance: `go test ./cmd/wsh/cmd -run 'TestBoard'` (flag validation, each output line from a stubbed RPC result).

### Task 6: Frontend board core: Excalidraw, stores, applier, canvas, toast
**Depends on:** Task 1 (uses the generated TS types and RPC client)
**Model:** opus
**Files:** `package.json`, `package-lock.json`, `frontend/app/view/boards/boardmodel.ts`, `frontend/app/view/boards/boardmodel.test.ts`, `frontend/app/view/boards/boardconvert.ts`, `frontend/app/view/boards/boardapplier.ts`, `frontend/app/view/boards/boardapplier.test.ts`, `frontend/app/view/boards/boardstore.ts`, `frontend/app/view/boards/boardstore.test.ts`, `frontend/app/view/boards/boardsplitstore.ts`, `frontend/app/view/boards/boardsplitstore.test.ts`, `frontend/app/view/boards/boardtalkmodel.ts`, `frontend/app/view/boards/boardtalkmodel.test.ts`, `frontend/app/view/boards/boardforwardmarker.ts`, `frontend/app/view/boards/boardforwardmarker.test.ts`, `frontend/app/view/boards/boardcanvas.tsx`, `frontend/app/view/boards/boardcanvas.css`, `frontend/app/view/boards/boardsfeed.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-boards-split.mjs`, `scripts/cdp/scenarios-boards-chat.mjs`, `scripts/cdp/scenarios-boards-library.mjs`

Add `@excalidraw/excalidraw` 0.18.1 (exact) to `package.json` and `package-lock.json` with `npm install
--package-lock-only --save-exact @excalidraw/excalidraw@0.18.1`. Its files are already in the main checkout's
`node_modules`, which every task tree links to (the lead installed it once before the run); never run a plain
`npm install` in a junctioned tree. Port from `kael/main:frontend/app/view/boards/` what the split and Library need, re-keyed by
project; everything below is used by Tasks 7, 8 and 9, so keep these names:

- `boardmodel.ts` / `boardconvert.ts`: Kael's file parse/serialize, `applyAnswer`, `landAnswer` (one undo step: the
  open canvas lands through `updateScene` with Excalidraw's capture-update so one Ctrl+Z removes the turn).
- `boardapplier.ts` + `boardsfeed.tsx`: subscribe to `board:update`; for `what:"answer"` fetch the board's inbox and
  land each answer, oldest first, one per board in flight: on the open canvas when the board shows, else read →
  land → save under the rev read (retry on conflict, 3 tries); ack with the shape ids, or with `error` when it cannot
  land. Excalidraw (and `boardconvert.ts`) load by dynamic `import()` only when an answer arrives or a canvas shows.
  On a drawn `kind:"request"` turn, toast `The drawer drew on <board>` with **Open** (→ `openBoard`) unless the Agent
  surface shows that board's agent focused. Mount `<BoardsFeed />` in `cockpit-root.tsx` beside the other pollers,
  with the agents model it already holds.
- `boardstore.ts`: module-level atoms `boardListAtom(project)` (project `""` = all), `boardTalkAtom(boardId)`;
  `loadBoardList`, `loadBoardTalk`; hooks `useBoardList(project)` and `useBoardTalk(project, boardId)` that load once
  and stay current on `board:update`; `boardsOfAgent(list, agentTabId)`; `findBoardByName(list, name)`.
- `boardsplitstore.ts`: `boardSplitAtom(agentId)` holding `{ project, boardId, expanded } | null`;
  `openBoard(model, agentId, project, boardId)`: focus the agent on the Agent surface, set its view to the terminal
  slot (`setAgentView`, closing a Review, Brainstorm or Canvas pane) and its chat mode to Chat (`setChatMode`), then
  open the split, expanded when the agent's cell sits in a grid of more than one cell; `closeBoard(agentId)`;
  `setBoardExpanded(agentId, expanded)`. The pure rule (`splitOpens(cellsInGrid) → {expanded}`) is unit-tested.
- `boardtalkmodel.ts` (pure): `SLOW_MS = 45_000`; `turnView(turn, now)` → the turn's shown state (`waiting |
  answering | slow | drawn | forwarded | failed | stopped`), seconds since it started, the forward note (`waiting for
  <agent>`, `forwarded · answered in Chat`, `agent closed`), whether **Show** applies (a drawn turn with shape ids) and
  the send-the-other-way action (`forward` on a drawn ask, `draw` on a forwarded turn, none on a request);
  `recentTurns(talk, 3)`; `boardFacts(info, now)` → `9 shapes · drawn 15:20`; `askAllowed(talk, alive)`.
- `boardforwardmarker.ts` (pure): `parseBoardForward(text) → { board, on, turnId, question } | null`, the mirror of
  `boardforward.Marker`, tested against the exact strings Go writes.
- `boardcanvas.tsx` (+ `.css`): `<BoardCanvas project boardId highlightIds? onSelection?>`, Excalidraw through
  `React.lazy`, reading the board, saving hand edits rev-guarded (debounced), registering itself with the applier as
  the board's live canvas, reporting the selection as `{ ids, label }` (the first selected shape's text or label),
  outlining `highlightIds` for **Show**. Theme from the app's tokens (no raw colours outside the Excalidraw scene).
- Scenarios: create `scenarios-boards-split.mjs`, `scenarios-boards-chat.mjs` and `scenarios-boards-library.mjs`
  (each `export default function (kit) { return [...] }`, as `scenarios-chat-council.mjs`) and register all three in
  `scenarios.mjs`. They stub the `RpcApi.Board*` methods in the page and fire `board:update` to the page's handlers
  (Kael's `scenarios-boards-*.mjs` do this; port the helpers you need into these files, since `main` has no
  `scenarios-shared.mjs`); no real drawer ever runs. `boards-split` and `boards-library` return `[]` here (Tasks 7 and
  9 fill them). `boards-chat` gets the scenario `boards-chat` with this task's step: a fixture claude agent, another
  agent focused, a stubbed drawn request answer fed through `board:update` → the toast `The drawer drew on <board>`
  shows (screenshot), and its **Open** focuses the agent with `boardSplitAtom` set (assert the atom; the split view is
  Task 7's).

Acceptance: `npx vitest run frontend/app/view/boards` (boardmodel, applier: lands on the open canvas vs the file,
retries a conflict, acks errors, one in flight per board; store; splitstore; talkmodel: every state, slow at 45 s,
other-way per kind; marker parse); `task check:ts`; the `boards-chat` toast step above.

### Task 7: The board split beside Chat
**Depends on:** Task 6 (uses the stores, canvas and talk model)
**Model:** opus
**Files:** `frontend/app/view/boards/boardsplit.tsx`, `frontend/app/view/boards/boardheader.tsx`, `frontend/app/view/boards/boardturns.tsx`, `frontend/app/view/boards/boardaskbox.tsx`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/chatpane.tsx`, `scripts/cdp/scenarios-boards-split.mjs`

The prototype's `A-ben-canh-chat.dc.html` board. A layer inside the agent's cell, rendered in `agentsurface.tsx`
beside `ChatLayer` (never wrapping it, never re-parenting the pane; the terminal stack stays one always-rendered grid;
nothing animates a cell's size). When `boardSplitAtom(agent.id)` is set: the board layer takes the right 50% of the
cell (all of it when expanded) and `ChatLayer`'s `ChatPane` gets a right inset of 50% (it stays mounted under an
expanded board, so the composer's draft survives). The xterm under both keeps its size.

- `boardheader.tsx`: the board's name as a switcher over `boardsOfAgent` (each of the agent's boards), its facts
  (`boardFacts`), **Expand**/**Collapse** (absent when the cell is in a multi-cell grid), **Close** (`closeBoard`).
- The canvas (`BoardCanvas`).
- `boardturns.tsx` (Library reuses it, so it takes `{ talk, mode: "recent" | "full", onShow, onOtherWay, onStop,
  onRetry }`): recent mode lists the last 3 turns and an `N earlier` line that expands the board; full mode (expanded,
  and Library) lists every turn with the copied reply under each replied forward. Each turn shows its `turnView` state:
  drawn (`+N shapes`, **Show** outlines its shapes), forwarded (`forwarded · answered in Chat` in the split; the reply
  in full mode; `waiting for <agent>`; `agent closed`), answering (green, seconds), slow (`Still answering`, **Stop**),
  failed (`Couldn't answer`, the reason, **Retry**); one send-the-other-way button (`Send to agent` / `Draw instead`) →
  `BoardRerouteCommand`.
- `boardaskbox.tsx`: `Selected <label>` when shapes are selected, else the hint to select shapes to ask about them;
  **Ask** → `BoardAskCommand` with `on` and `selectedids`; disabled while a turn answers (`askAllowed`).
- Keys: Escape inside the canvas stays Excalidraw's; nothing new in `bindings.ts`.

Acceptance: `task check:ts`; the `boards-split` scenario in `scenarios-boards-split.mjs`, each step a screenshot plus a
DOM assert, with stubbed RPCs: (1) record `performance.memory.usedJSHeapSize`, open a board on a fixture claude agent →
Chat left, board right, header name and facts; (2) the recent turns with a drawn turn, **Show** outlines its shapes
(assert the highlight ids), a forwarded turn reading `forwarded · answered in Chat`; (3) **Send to agent** and **Draw
instead** each call `BoardRerouteCommand` with the turn id; (4) select a shape → the ask box reads `Selected <label>`,
**Ask** sends `on` and `selectedids`; (5) answering with its seconds, Ask disabled; slow (start ts 60 s back) with
**Stop** calling `BoardAskStopCommand`; failed with its reason and **Retry**; (6) **Expand** → full turns column with a
copied reply; (7) the switcher lists the agent's two boards and switches; (8) **Close** → Chat alone at full width;
(9) the agent in a 2-cell grid → Open opens expanded with no Expand; (10) a Review pane open on the agent → Open closes
it and shows Chat + board; (10b) the agent in Terminal chat mode → Open switches it to Chat and shows Chat + board
(assert the stored chat mode and both layers); (11) record the heap again and put both numbers in the step's detail; (12)
`await h.whatsnewShot("boards", { selector: <the split cell> })`.

### Task 8: Chat's board card and the forwarded chip
**Depends on:** Task 6 (uses the stores, `openBoard` and `parseBoardForward`)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatboard.ts`, `frontend/app/view/agents/chatboard.test.ts`, `frontend/app/view/agents/chatboardcard.tsx`, `frontend/app/view/agents/chatmodel.ts`, `frontend/app/view/agents/chatmodel.test.ts`, `frontend/app/view/agents/chatitemeq.ts`, `frontend/app/view/agents/chatitemeq.test.ts`, `frontend/app/view/agents/chatconversation.tsx`, `scripts/cdp/scenarios-boards-chat.mjs`

- The board card, placed the way the council card is (`chatcouncil.ts`, the `councilstart` moment in `chatmodel.ts`):
  `chatboard.ts` (pure) finds `wsh board draw` Bash calls (a path to wsh, `wsh.exe`, quotes, after `cd x &&`; not
  another program's words) and reads `--board <name>` (quoted or bare); `chatmodel.ts` adds a `boarddraw` moment (and part), with its case in `chatitemeq.ts`'s
  exhaustive `samePart` switch;
  `chatconversation.tsx` draws `chatboardcard.tsx` at the end of that turn: the board's name, its shape count (from
  `useBoardList(agent.project)` and `findBoardByName`), `drawing…` while the board's last request answers, and
  **Open** → `openBoard`. One card per board per turn (two draws on one board in a turn make one card).
- The forwarded chip: in `YouBubble`, a message `parseBoardForward` reads draws a chip `from <board> · on <shapes>`
  (no `· on …` without shapes) above your words, and the marker line is not shown.

Acceptance: `npx vitest run frontend/app/view/agents/chatboard.test.ts frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/chatitemeq.test.ts`;
`task check:ts`; the `boards-chat` scenario gains steps (screenshot + assert each): a fixture transcript with a
`wsh board draw --board wavesrv-startup …` call → the card with the name, `9 shapes` and **Open**; **Open** focuses the
agent on the Agent surface with `boardSplitAtom` set to that board (assert the atom and the focus; the split's own
look is Task 7's scenario); a user message carrying the marker → the chip, the marker line absent from the bubble.

### Task 9: Library → Boards
**Depends on:** Task 6, Task 7 (reuses `boardturns.tsx` and the canvas wiring it adds)
**Model:** sonnet
**Files:** `frontend/app/view/library/librarystore.ts`, `frontend/app/view/library/librarystore.test.ts`, `frontend/app/view/library/librarysurface.tsx`, `frontend/app/view/library/libraryboards.tsx`, `frontend/app/view/library/libraryboardsmodel.ts`, `frontend/app/view/library/libraryboardsmodel.test.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`, `frontend/app/cockpit/uiapi.ts`, `frontend/app/cockpit/uiapi.test.ts`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios-boards-library.mjs`, `scripts/cdp/scenarios-library.mjs`

The prototype's `Library-boards.dc.html` board.

- `librarystore.ts`: `LibraryTab` gains `"boards"`, last in `LIBRARY_TABS` (so key 4 and its `kbd` come from the
  existing loop); `libraryBoardSelAtom` (`{ project, boardId } | null`); `showLibraryBoard(model, project, boardId)`.
  Every route goes through this file.
- `openref.ts`: a `board` target (`{ kind: "board", project, boardId }`, address `board:<project>/<boardId>`): the
  board's agent alive in the roster (sleeping counts) → `openBoard` on the Agent surface; else `showLibraryBoard`.
- `libraryboardsmodel.ts` (pure): rows for the app bar's project (`projectFilterAtom`; none picked = every project,
  each row naming its project), newest first, search by name; each row: name, agent title and `running`/`ended`, turn
  count, shape count, last drawn time.
- `libraryboards.tsx`: the list with a thumbnail per row (Excalidraw's `exportToSvg`, lazy-imported, only for rows on
  screen, cached by rev); selecting a live agent's board routes through `openTarget`; selecting an ended one shows its
  canvas (hand edits still save), the full turns column (`boardturns.tsx`, `mode:"full"`) with copied replies and
  **Show**, the line `The agent ended, so you can't ask here` in place of the ask box, and **Open conversation** →
  `showLibrarySession` with the board's agent session id. Empty: `No boards in <project> yet. Boards appear when an
  agent runs wsh board draw.`
- `uiapi.ts`: `boards` as a Library tab address for `wsh ui`. `bindings.ts`: the Library label lists boards; add
  `go:boards` to `GO_TARGETS` with the free letter `d` (`g d`; `b` is Code) opening Library on Boards. Update
  `docs/keyboard-shortcuts.md` (Library's tabs, the new go binding) and the tests that list the tabs
  (`bindings.test.ts`, `uiapi.test.ts`, `librarystore.test.ts`, `scripts/cdp/scenarios-library.mjs`'s
  `LIBRARY_TAB_NAMES`).

Acceptance: `npx vitest run frontend/app/view/library frontend/app/view/jarvis/openref.test.ts frontend/app/cockpit/uiapi.test.ts frontend/app/store/keybindings/bindings.test.ts`;
`task check:ts`; the `boards-library` scenario (screenshot + assert each): the tab row shows Boards with `4`; a list of
three stubbed boards (one live agent, two ended) with thumbnails, agent state, counts; the search filters to one;
selecting the ended board → canvas, turns with a copied reply, the ended line, **Open conversation** landing on
Conversations; **Show** on its drawn turn outlines its shapes (assert the highlight ids); a hand edit on its canvas
(add a rectangle through the Excalidraw API) saves (assert the `BoardSaveCommand` call with the board's rev); selecting the live agent's board → the Agent surface with the board split; a project with no boards →
the empty text.

### Task 10: Docs, skill, changelog
**Depends on:** none
**Model:** sonnet
**Files:** `skills/cockpit/SKILL.md`, `CHANGELOG.md`, `docs/open-issues.md`, `docs/hand-checks.md`, `docs/reference/architecture.md`

- `skills/cockpit/SKILL.md`: when to draw (an explanation of a flow, an architecture or a choice reads better as a
  picture; the person asks to draw), how (`wsh board draw --board <name> --context "<briefing>"` the first time, later
  one-line `--ask`; run it with a Bash timeout of 600000 ms; the exact output lines from Task 5), that the drawer only
  draws and reads the conversation itself so the briefing stays short, that questions on the board reach you as a
  message headed `[From board "…"]` which you answer in words, and that you may send a one-line `wsh board draw` when
  your answer changes the picture. Claude agents only.
- `CHANGELOG.md` Unreleased → Added: one big line for the person (agents draw explanations on a board beside Chat; ask
  on the board; Library → Boards), ending `<!-- big --> <!-- shot: none -->` (the spec's Builder decisions say why
  the picture waits for the Final's shot).
- `docs/open-issues.md` RAM watch: a row for an open board (`@excalidraw/excalidraw`, lazy-loaded), naming the
  `boards-split` scenario's heap numbers as where the measurement lands, marked to be filled from the first Final run.
- `docs/hand-checks.md`: `- [ ]` lines for what Final cannot check: a real drawer turn from `wsh board draw` in a live
  claude agent; a forwarded question reaching a live agent and its reply copied; a sleeping agent woken by a forward;
  and the What's new picture: commit the `public/whatsnew/<version>-boards.webp` the `boards-split` scenario writes on
  the Final run (or `node scripts/whatsnew-shot.mjs boards` in the dev app) and change the CHANGELOG line's
  `<!-- shot: none -->` to `<!-- shot: <that file> -->`.
- `docs/reference/architecture.md`: a short Boards entry (packages, the board:update event, the frontend applier).

Acceptance: `npx vitest run frontend/app/cockpit/whatsnew.test.ts` passes; `claude plugin validate claude/arc-mod` is
not needed (no mod change).
