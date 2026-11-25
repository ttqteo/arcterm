# Pair an agent with a judge

**Spec:** `docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md` (read "Decisions made while planning" first: every task below builds on it)
**Verify:** `node scripts/verify.mjs ./pkg/agentpair/... ./pkg/agentmsg/... ./pkg/agentsessions/... ./pkg/wps/... ./pkg/tsgen/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke pair-conversation pair-decided pair-header pair-tree`
**Prototype:** .superpowers/design/agent-pair-judge/project

Shape of the work. Task 1 lands the wire (RPC types, the `pair:update` event, stub handlers, generated bindings), which
everything else builds on. The Go side then runs as one chain: the pure core of `pkg/agentpair` (Task 2), its manager
(Task 3), and the wavesrv wiring (Task 5); Task 4 (token counting) runs beside it. Task 5 waits on all of Task 3 by
choice, not only its signatures: its tests drive the real `Manager` over a temp dir, and a test-only interface for one
implementation is the abstraction the rules below forbid. The frontend starts from Task 1 too: Task 6 lands the store,
the pure models, the `pair` centre mode and the scenario scaffolding, then Tasks 7, 8, 9 and 10 build the four views
side by side, each owning its own scenario file. Task 11 writes the docs and the CHANGELOG line with Task 7's picture.

Rules for every task:
- Principles: simple, direct code; KISS, YAGNI, DRY, one source of truth; no abstraction for one implementation; handle
  errors at boundaries and never swallow one silently (log it, or return it).
- Never hand-edit generated files (`task generate` writes them). Never run prettier on `scripts/*.mjs`. Lint and
  format only the paths you touched.
- Go tests on Windows: prefix with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`. Run only the focused tests
  your task names (`go test ./pkg/x -run '<names>'`, `npx vitest run <file>`); `task check:ts` (4-minute timeout) for any
  frontend task.
- UI: follow `DESIGN.md`; colors from the `@theme` tokens in `frontend/tailwindsetup.css`, never raw hex; Tailwind over
  new SCSS; English UI strings (the boards' Vietnamese is sample copy; the app has no translation layer). Testable
  logic goes in a pure `foo.ts` with `foo.test.ts` beside it; no jsdom render tests.
- Each board in the Prototype folder (`R1-center-chat-rail-decided.dc.html`, `K2-header-button.dc.html`,
  `K1-tree-menu.dc.html`) is what a view task matches; open the one your task names before styling.
- Commits carry no attribution trailer.

### Task 1: The pair wire: RPC types, the event, stub handlers, generated bindings
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_pair.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `pkg/wshrpc/wshserver/wshserver_pair.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`, `pkg/agentpair/doc.go`

Add `PairCommands` in a new `pkg/wshrpc/wshrpctypes_pair.go`, embedded in `WshRpcInterface` (`wshrpctypes.go`, beside
`BoardCommands`), mirroring `wshrpctypes_board.go`'s style. Every other task relies on these names and shapes exactly
(json tags are the lowercase field names, as the rest of wshrpc):

```go
type PairCommands interface {
	PairListCommand(ctx context.Context) (*CommandPairListRtnData, error)                           // the active pairs
	PairGetCommand(ctx context.Context, data CommandPairGetData) (*PairView, error)                   // one pair in full
	PairBriefCommand(ctx context.Context, data CommandPairBriefData) (*CommandPairBriefRtnData, error) // a new judge's launch task
	PairStartCommand(ctx context.Context, data CommandPairStartData) (*PairView, error)               // pair, or add a judge
	PairSayCommand(ctx context.Context, data CommandPairSayData) error                                // the person's message or answer chip
	PairRunNowCommand(ctx context.Context, data CommandPairRunNowData) error                         // let a held command through
	PairUnpairCommand(ctx context.Context, data CommandPairGetData) error
}

type PairSide struct { Tab, Name, Harness string; Gone bool `json:"gone,omitempty"` }
type PairInfo struct {
	Id, Project string; Worker PairSide; Judges []PairSide
	State      string // "relaying" | "stopped" | "ended"
	StopReason string // "" | "no-new-points" | "settled" | "token-cap" | "judges-gone"
	Owed       bool   // a live judge owes an answer to the working agent's newest message
	MessageCount int; LastTs int64
}
type CommandPairListRtnData struct { Pairs []PairInfo }
type CommandPairGetData struct { PairId string }
type PairHeld struct { Command string; Ts int64; RunTs int64 `json:"runts,omitempty"` } // RunTs: Run now let it through
type PairMessage struct {
	Id   string
	From string // "worker" | "judge" | "person" | "system"
	Tab  string // the agent's tab; "" for person and system
	Ts   int64
	Text  string // the shown body: arc-pair / arc-judge fence and leading quote line taken out
	Quote string // the line it answers
	ReplyTo string // the id of the message it answers
	To   string // a person's message: "both" | "worker" | "judge" | a judge's tab
	Held []PairHeld
}
type PairItem struct {
	Num  int    // 0 for a judge's new point
	Kind string // "agreed" | "open" | "asks"
	Text, Note string; Chips []string
	MsgId      string // agreed: the message where it was settled; else the message of the block (or of the judge's new point)
	ReopenedBy string // open: the judge tab whose reopen mark put it here
	NewBy      string // open: the judge tab whose `new:` point this is
	Answer     string // asks: the person's answer, until the next block
}
type PairDecided struct { Asks, Agreed, Open []PairItem }
type PairView struct {
	PairInfo
	HoldHeavy bool; TokenCap, Tokens int64; Note string; CreatedTs int64
	Messages []PairMessage
	Decided  PairDecided
}
type CommandPairBriefData struct { WorkerTab string }
type CommandPairBriefRtnData struct { Text string }
type CommandPairStartData struct {
	WorkerTab, JudgeTab string; HoldHeavy bool
	TokenCap int64 // 0: 3,000,000
	Note    string
	Briefed bool // the judge was launched with PairBrief's text as its task
}
type CommandPairSayData struct { PairId, Text, To, ReplyTo string; Item int `json:"item,omitempty"` } // Item: the A item it answers
type CommandPairRunNowData struct { PairId, MsgId, Command string }
type PairUpdateData struct { PairId, WorkerTab string }
```

Add `Event_PairUpdate = "pair:update" // type: wshrpc.PairUpdateData` to `pkg/wps/wpstypes.go` (and `AllEvents`), and
its type to `pkg/tsgen/tsgenevent.go`. In a new `pkg/wshrpc/wshserver/wshserver_pair.go`, give `WshServer` the seven
methods as stubs returning `errors.New("pairs are not built yet")` (Task 5 replaces them). Add
`pkg/agentpair/doc.go` (the package comment only: what a pair is, pointing at the spec), so Verify's
`./pkg/agentpair/...` pattern resolves in every tree from here on. Run `task generate` and commit what it writes.

Acceptance: `go build ./...` passes; `task generate` leaves no further diff; `frontend/types/gotypes.d.ts` has
`PairView` and `RpcApi.PairGetCommand` exists in `wshclientapi.ts`;
`go test ./pkg/wshrpc -run 'TestGenerateWshCommandDecl|TestUiCommandsAreDeclared'` and `go test ./pkg/tsgen` pass;
`go vet ./pkg/agentpair/...` passes; `task check:ts` passes.

### Task 2: `pkg/agentpair` core: stored types, block parsers, the Decided view, the stop rule, the briefs
**Depends on:** Task 1 (uses the wshrpc pair types)
**Model:** sonnet
**Files:** `pkg/agentpair/pair.go`, `pkg/agentpair/blocks.go`, `pkg/agentpair/blocks_test.go`, `pkg/agentpair/view.go`, `pkg/agentpair/view_test.go`, `pkg/agentpair/brief.go`, `pkg/agentpair/brief_test.go`, `pkg/agentmsg/agentmsg.go`, `pkg/agentmsg/agentmsg_test.go`

All pure: no store, no clock (pass `now`), no I/O. The spec's "The blocks", "Stops" and the brief bullets are the rules.

- `pair.go`: the stored record. `Pair` {Id, Project, Worker Side, Judges []Side, HoldHeavy, TokenCap, Note, CreatedTs,
  State, StopReason, CapFromTs, Tokens, Messages []Message, Pending map[string][]string (tab → message ids waiting for
  it), Seen map[string]int64 (tab → ts of the last answer taken), Held []wshrpc.PairHeld (refused since the working
  agent's last message), Passes []string (commands Run now let through), WorkerBriefed bool}; `Side` {Tab, Name,
  Harness, Gone, Briefed}; `Message` {Id, From, Tab, Ts, Raw, To, ReplyTo, Item, Held []wshrpc.PairHeld}. Constants
  for the states, stop reasons and `From` values, matching Task 1's strings; `DefaultTokenCap = 3_000_000`.
- `blocks.go`: `WorkerBlock(raw string) (items []BlockItem, ok bool)` reads the last top-level `arc-pair` fence
  (`D<n>`/`O<n>`/`A<n>`, ` — note` or ` -- note`, `[a | b]` chips on A); `JudgeMarks(raw string) (m Marks, ok bool)`
  reads the last `arc-judge` fence (`reopen D2: why` / `reopen 2: why`, `new: point`, `no new points`, any case);
  `Body(raw string) (text, quote string)` drops both fences and a leading `> ` quote line. Fence finding follows
  `frontend/app/view/agents/chatsteplist.ts` `stepBlocksOf` (same-character closing fence at least as long; an open
  fence runs to the end; fences nested in a longer fence are not blocks).
- `view.go`: `Owed(p *Pair) bool`, `OwedBy(p *Pair) []string` (live judge tabs that owe), `Decided(p *Pair)
  wshrpc.PairDecided` (anchor = newest worker message with a block; marks only from judge messages after the anchor;
  agreed links per the spec; a person's answer to an A item, `Message.Item`, after the anchor shows as `Answer`),
  `StopVerdict(p *Pair) string` (no-new-points / settled / judges-gone / "" — token cap is the manager's, it needs
  counts), `Info(p *Pair) wshrpc.PairInfo`, `View(p *Pair) *wshrpc.PairView` (messages with `Body` applied; a relayed
  message without a quote line gets the first line of the message it answers).
- `brief.go`: `JudgeBrief(in JudgeBriefInput) string` (worker name and tab, its latest reply, doc paths, note: the
  spec's judge-brief bullets, with an `arc-judge` example fence), `DocsAtHand(texts []string) []string` (the
  `…/plans/*.md` and `…/specs/*.md` paths the texts name, newest first, distinct), `WorkerBrief(judgeNames []string)
  string` (the spec's worker brief, with an `arc-pair` example fence), `RelayPrompt(msgs []RelayItem, firstToWorker
  string) string` (one prompt for a batch: each message headed by who and when, the person's marked as the person's).
- In `pkg/agentmsg/agentmsg.go` add `PairEnvelope(text string) string`: starts with the existing `envelopePrefix` so
  `IsAgentMessage` holds, names arcterm's pair as the relay, says it was not typed by the user and that the reply passes
  back on its own (answer here, no `wsh agents send`).

Tests (`go test ./pkg/agentpair -run 'TestWorkerBlock|TestJudgeMarks|TestBody|TestDecided|TestStopVerdict|TestOwed|TestJudgeBrief|TestDocsAtHand|TestRelayPrompt'`,
`go test ./pkg/agentmsg -run TestPairEnvelope`) cover: each line form, a bad line skipped, a nested fence ignored, an
open fence; a reopen moving D→open until the next block; a dropped number gone; a judge `new:` under Open; an answer
shown until the next block; agreed linking back through an unbroken run of D; both stop verdicts, including settled
refused when a judge reply lacks the fence; two judges where only one said no new points; owed after a worker message
and cleared by each judge's reply; a gone judge never owing.

### Task 3: `agentpair.Manager`: store, relay, stops, hold, Run now, Unpair
**Depends on:** Task 2 (builds on the stored types, parsers, view, stop verdict and briefs it adds)
**Model:** opus
**Files:** `pkg/agentpair/store.go`, `pkg/agentpair/store_test.go`, `pkg/agentpair/manager.go`, `pkg/agentpair/manager_test.go`, `pkg/agentpair/hold.go`, `pkg/agentpair/hold_test.go`

The spec's "Where a pair lives", "What passes, and when", "Stops" and "Holding heavy commands" are the rules.

- `store.go`: one file per pair under a directory, atomic writes (`fileutil.AtomicWriteFile`), read all on first use
  into an in-memory index of non-ended pairs (as `boardForwarder.ensureLoaded`), one mutex for the index and writes.
- `manager.go`, the interface Task 5 relies on:

```go
type Link interface {
	State(ctx context.Context, tab string) (string, error) // "idle" | "working" | "asking" | "sleeping" | "gone"
	Send(ctx context.Context, tab, text string) error     // wakes a sleeping agent
	LastAnswer(ctx context.Context, tab string) (text string, ts int64, err error)
	Tokens(ctx context.Context, tab string, sinceMs int64) (int64, error)
	Agent(ctx context.Context, tab string) (AgentFacts, error) // Name, Harness, Project, Cwd, Transcript; error for a non-agent tab
	RecentTexts(ctx context.Context, tab string, n int) ([]string, error) // its last n turns' texts, for DocsAtHand
}
type Manager struct {
	Link    Link
	Dir     string
	Publish func(wshrpc.PairUpdateData)
	Now     func() time.Time // nil: time.Now
	// unexported: the store, the index
}
func (m *Manager) List() []wshrpc.PairInfo
func (m *Manager) Get(id string) (*wshrpc.PairView, error)
func (m *Manager) Brief(ctx context.Context, workerTab string) (string, error)
func (m *Manager) Start(ctx context.Context, d wshrpc.CommandPairStartData) (*wshrpc.PairView, error)
func (m *Manager) Say(ctx context.Context, d wshrpc.CommandPairSayData) error
func (m *Manager) RunNow(ctx context.Context, d wshrpc.CommandPairRunNowData) error
func (m *Manager) Unpair(ctx context.Context, pairId string) error
func (m *Manager) TurnEnded(ctx context.Context, tab string)       // a member reported idle or asleep
func (m *Manager) Hold(workerTab, command string) (reason string, held bool) // in hold.go
func (m *Manager) Paired(tab string) bool                           // is tab in an active pair: memory only once loaded
func (m *Manager) Load(ctx context.Context)                         // load the index now and try every pending queue (boot)
```

- The index loads once, on the first call of any method (`Paired` and `Hold` included: the first one reads the files,
  every later one is memory only), or at boot through `Load`, which also tries every pending queue and takes any answer
  a member gave while wavesrv was down. Why: after a restart the status hook and the hold must see the pairs before
  the frontend ever asks, and a queue for an agent that is already idle would otherwise never go.
- `Start`: refuses a tab already in an active pair, a judge equal to the worker, a harness other than claude or pi;
  adds a judge to the worker's existing pair when it has one. A new pair records the worker's latest answer as its
  first message (`Seen` set). An unbriefed (live, picked) judge's `Seen` is its current last answer, and it gets
  `JudgeBrief` + the worker's latest reply as its first prompt. A briefed judge (launched with the brief) starts with
  `Seen` 0, so the answer to its brief is taken even when it was given before `Start` (the frontend calls `Start` only
  once the judge reported in, and it may already be idle): `Start` ends by taking each member's answer as a turn end
  would.
- `TurnEnded`: take a new answer (`LastAnswer` newer than `Seen`), append it (the held commands since the worker's last
  message attach to a worker message), queue it per the spec, recount tokens, run the stop rule, deliver queues
  (`RelayPrompt` inside `agentmsg.PairEnvelope`; `WorkerBrief` first, once). A `gone` member: a judge is marked gone
  with a system line; the worker gone ends the pair. Every change saves and calls `Publish`.
- Delivery never runs under the mutex, and a failed `Send` is logged and leaves the queue in place for the next try.
- `hold.go`: `Hold` refuses (spec's reason text, the command in backticks) when the worker's pair holds; a matching
  pass is consumed and lets it run; a refusal appends to `Held` and saves. `RunNow` adds the pass, sets `RunTs`, and
  sends the worker the spec's person message (also appended to the timeline). `Unpair` ends the pair and tells the
  worker about each held command not let through.

Tests, all with a fake `Link` and a temp dir
(`go test ./pkg/agentpair -run 'TestStore|TestManagerStart|TestManagerRelay|TestManagerBatch|TestManagerStop|TestManagerResume|TestManagerTokenCap|TestManagerGone|TestHold|TestRunNow|TestUnpair|TestReload|TestLoad'`):
the first message at pairing; a briefed judge already idle with its answer when `Start` runs, that answer taken;
a fresh `Manager` over existing files answering `Paired` and `Hold` with no `List` first, and `Load` delivering a queue
to an agent already idle; a worker reply reaching an idle judge as one prompt and waiting for a busy one; two judge
replies to a busy worker batched into one prompt at its turn end; a judge's reply queued for another judge but not
starting its turn; a stop on no new points and on settled, the judge replies behind it not delivered; resume by the
person and by a worker reply, and not by a worker reply after a token-cap stop; a held command refused with the reason,
attached to the next worker message, then let through once by Run now; Unpair lifting the hold and telling the worker;
a reload from disk keeping queues, seen marks and passes; a failed Send kept for the next try.

### Task 4: Token counting since a time
**Depends on:** Task 1 (its tree needs the `pkg/agentpair` package Task 1 starts, which Verify's `./pkg/agentpair/...` pattern names)
**Model:** sonnet
**Files:** `pkg/agentsessions/tokens.go`, `pkg/agentsessions/tokens_test.go`

Add `func TokensSince(path, harness string, sinceMs int64) int64` to `pkg/agentsessions`: Input + CacheRead +
CacheCreation + Output of every request a session's transcript records at `sinceMs` or later, the way council run
facts count (`pkg/consult/consult.go:150`). Claude: reuse `claudeTokens`'s dedupe (`agentsessions.go:290`: one count
per message id + request id, the line with the most output). Pi: its usage records (`pkg/usagestats/pi.go` reads the
same fields), filtered by time. Any other harness, or an unreadable file: 0. Read the file once; no caching (measure
before optimizing).

Tests (`go test ./pkg/agentsessions -run 'TestTokensSince'`): a Claude transcript with repeated lines for one message
counted once, records before `sinceMs` left out, a pi transcript, an unknown harness and a missing file giving 0.

### Task 5: wavesrv wiring: RPC handlers, the live link, the turn-end hook, the heavy-command hold
**Depends on:** Task 1, Task 3 (delegates to `agentpair.Manager` and implements its `Link`), Task 4 (the live link's Tokens uses `agentsessions.TokensSince`)
**Model:** sonnet
**Files:** `pkg/wshrpc/wshserver/wshserver_pair.go`, `pkg/wshrpc/wshserver/wshserver_pair_test.go`, `pkg/wshrpc/wshserver/wshserver.go`, `pkg/wshrpc/wshserver/wshserver_jobqueue.go`, `pkg/wshrpc/wshserver/wshserver_jobqueue_test.go`, `cmd/server/main-server.go`

- In `wshserver_pair.go`, replace Task 1's stubs: one package-level `pairManager *agentpair.Manager` (Dir
  `<wavebase.GetWaveDataDir()>/pairs`, `Publish` → `wps.Broker.Publish` of `Event_PairUpdate`, as
  `wshserver_council.go:74` publishes `council:changed`), the seven handlers delegating to it, and `livePairLink`
  implementing `agentpair.Link` over the roster as `liveAgentLink` does for councils (`wshserver_councilagents.go`:
  `loadAgentRosterFacts`, `buildAgentRoster`, `resolveAgentTab`, `deliverToAgent` with no send-back lock,
  `agentTranscriptPath` + `agentsessions.LastAnswer`, `agentsessions.TokensSince`, `agentsessions.TurnsSince` for
  `RecentTexts`). State maps the roster's states as `seatState` does; a tab not on the roster is `gone`.
- `StartPairManager()` in `wshserver_pair.go`, called once at boot from `cmd/server/main-server.go` beside
  `StartCouncilRunner` (and named in `snapshotBootSkips`, so a snapshot store never relays), runs `pairManager.Load`
  off the boot goroutine.
- `notePairStatus(ev)` in `publishEvent` (`wshserver.go`, beside `noteBoardForwardStatus`): decode the status, resolve
  its tab (`statusBlockId` then the block's tab), and when `pairManager.Paired(tab)` and the state is
  `baseds.AgentState_Idle` (no status event says sleeping: that is only a roster state, which `Link.State` maps), call
  `TurnEnded` off the publishing goroutine (as `noteBoardForwardStatus` does: delivery can wake an agent, whose
  wake waits on these very events).
- In `JobSlotCommand` (`wshserver_jobqueue.go`), for a heavy, not long-running, not Protect command whose block's tab
  (`src.TabId`, already resolved there) is a worker, ask `pairManager.Hold`; when held, send `Run: &no` with the reason
  and return before the queue.

Tests (`go test ./pkg/wshrpc/wshserver -run 'TestPairHandlers|TestPairStatusHook|TestJobSlotPairHold'`): a handler
round trip over a temp-dir manager with a scripted link; an idle status of a paired tab reaching `TurnEnded`, and a
working status or an unpaired tab not; a held heavy command refused with the pair's reason while a light one and an unpaired worker's heavy
one pass as before.

### Task 6: Frontend store, pure models, the `pair` centre mode, scenario scaffolding
**Depends on:** Task 1 (uses the generated pair types and `RpcApi.Pair*Command`)
**Model:** sonnet
**Files:** `frontend/app/view/agents/pairstore.ts`, `frontend/app/view/agents/pairmodel.ts`, `frontend/app/view/agents/pairmodel.test.ts`, `frontend/app/view/agents/agentcenter.ts`, `frontend/app/view/agents/agentcenter.test.ts`, `scripts/cdp/pair-fixtures.mjs`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-pair-conversation.mjs`, `scripts/cdp/scenarios-pair-decided.mjs`, `scripts/cdp/scenarios-pair-header.mjs`, `scripts/cdp/scenarios-pair-tree.mjs`

The interface Tasks 7–10 rely on:

- `pairstore.ts`: `pairListAtom` (PairInfo[]), `pairViewAtom(pairId)` (PairView | null), refreshed from
  `RpcApi.PairListCommand` / `PairGetCommand` on first use and on every `pair:update` event (`waveEventSubscribe…` from
  `@/app/store/wps`, as `agentaskstore.ts` subscribes); `devMockPairsAtom` (PairView[] | null), which wins over the
  server's answer while set, as `devMockAgentsAtom` does in `devmock.ts` (the scenarios set it); `pairScrollToAtom`
  (a message id the conversation scrolls to and clears: an agreed item's link sets it); `usePairOf(tabId)`
  (the pair the tab is in, as worker or judge, with its role) and `usePairView(pairId)`; `pairSeenAtom(pairId)` (the
  message count the person last saw, in localStorage `agent.pairseen`, wrapped in try/catch) and `markPairSeen(pairId)`.
- `pairmodel.ts` (pure): `timelineRows(view)` (one row per message: side `left` worker, `right` judge, `wide` person,
  `system` line; judge name shown only with more than one judge; quote and its target id; held lines);
  `composerTarget(text, view)` (`@worker` / `@judge` / `@<judge short id>` at the start → `{to, text}`, else both);
  `newCount(view, seen)`; `pairButtonLabel(view, role, seen)` ("Paired with judge 4c6ba858 · 2 new",
  "Judging 61483cd6"); `waitingOnJudge(info)`.
- `agentcenter.ts`: `CenterMode` gains `"pair"`, `pairSelAtom` (the pair id), and `showPair(pairId, model?)` (sets
  both, marks it seen, lands on Agent as `showCouncil` does). Check `agentsleep.ts`, `unreadagents.ts` and
  `agentsurface.tsx` still typecheck with the new member (Task 7 draws it).
- `scripts/cdp/pair-fixtures.mjs`: the R1 exchange in English as fixture data: a roster for the dev mock (a Claude
  worker "Plan oracle-tightening" 61483cd6 and judge 4c6ba858 in project mit-thesis, plus one more live agent), and
  `pairView(now, { judges: 1 | 2 })` — the four messages, quotes, a held `python study_pilot.py --tag benigngate_probe`
  with Run now, one Waits-on-you item with chips "50%, go on", two agreed, one still open — `seedPair(h, views)`
  setting `devMockPairsAtom` in the page (the `LIB`/`pageEval` pattern of `scenarios-agent-header.mjs`), and
  `stubPairRpc(h)` / `pairRpcCalls(h)`: replace the seven `RpcApi.Pair*Command` methods in the page with stubs that
  record their calls (and return the seeded view where one is asked for), and read the recorded calls back. Tasks 7–10
  use these and never edit this file.
- The four scenario modules, each `export default function (kit) { return []; }` with a comment naming the task that
  fills it, imported and spread into the list in `scripts/cdp/scenarios.mjs` beside `agentHeaderScenarios`.

Tests (`npx vitest run frontend/app/view/agents/pairmodel.test.ts frontend/app/view/agents/agentcenter.test.ts`): row
sides, judge names with one and two judges, quote target, composer targets, new counts, labels; `showPair` sets the mode
and the pair. `task check:ts` passes.

### Task 7: The conversation in the centre (board R1, centre)
**Depends on:** Task 6
**Model:** sonnet
**Files:** `frontend/app/view/agents/pairpane.tsx`, `frontend/app/view/agents/agentsurface.tsx`, `scripts/cdp/scenarios-pair-conversation.mjs`, `public/whatsnew/1.10.0-agent-pair.webp`

`pairpane.tsx` draws `pairSelAtom`'s pair from `timelineRows`, matching R1's centre: top bar (the working agent's name,
which calls `showTerminal()` back to its Chat; "Paired with judge …" and each judge's state from the roster, e.g.
"judge reading · 12 s"; Unpair → `PairUnpairCommand`, then back to the agent's Chat); messages top to bottom, worker
left and judge right, each a block with a head (who, time), every message in full (Markdown as Chat draws it), a quote
at the top that scrolls to its message on click (and the same scroll for `pairScrollToAtom`, which it then clears),
Reply on hover; the dashed held line inside the worker's message with
**Run now** (`PairRunNowCommand`, then "let through" in place of the button); system lines; the person's messages wide.
No round counter anywhere. One composer at the bottom ("Talk to both… · @worker or @judge for one"), sending
`PairSayCommand` with `composerTarget` and the reply it is answering. Mark the pair seen while shown. Wire `"pair"` into
`AgentCenterPane` in `agentsurface.tsx`.

Acceptance, in `scenarios-pair-conversation.mjs` (scenario `pair-conversation`, seeded with `pair-fixtures.mjs`, its
RPCs stubbed in the page to record calls): step `conversation` (the R1 centre: sides, heads, quotes, held line, composer;
`h.whatsnewShot("agent-pair", { selector })` on it), step `two-judges` (each right-side message names its judge),
step `quote-jump` (a quote click scrolls its message into view), step `reply-hover` (Reply on hover puts the quote in
the composer), step `run-now` (Run now calls the stub and the line reads let through), step `back-to-chat` (the name
click leaves the `pair` mode). Run `arc:ux-check` on the view.

What's new picture: run the `pair-conversation` scenario on a dev app of this task's own tree (dev-workflow
"Worktrees" / "Visual verification": its own ports, never the main checkout's app), which writes
`public/whatsnew/1.10.0-agent-pair.webp` through `h.whatsnewShot("agent-pair", …)` (or `node scripts/whatsnew-shot.mjs
agent-pair --selector <the conversation>` with `CDP_PORT` set); check it is 2:1 and under 120 KB, commit it, and stop
that dev app by its PID. The next minor is 1.10.0 (package.json is 1.9.0 and Unreleased already names 1.10.0 shots).

### Task 8: The Decided rail tab (board R1, rail)
**Depends on:** Task 6
**Model:** sonnet
**Files:** `frontend/app/view/agents/agentrailtabs.ts`, `frontend/app/view/agents/agentrailtabs.test.ts`, `frontend/app/view/agents/agentrailpanel.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/raildecidedpane.tsx`, `scripts/cdp/scenarios-pair-decided.mjs`

Add `"decided"` to `RailTab` and `decided` to `RailHas` (and `RAIL_HAS_NONE`; `agentrailstore.ts` spreads it and needs
no edit); `visibleTabs` puts it right after Changes; `shownTab` falls back to Overview without it; `panelFor`'s list of
tabs that are never a default (`agentrailtabs.ts:133`, beside council and brainstorm) gains it; its width is the fixed
one (`wideTabOf` null); its label "Decided", with the amber dot (`RAIL_DOT.asking`, as the Initiative tab's) while
Waits on you is not empty (`agentrailpanel.tsx` draws the strip: give it the label and any
per-tab case it switches on). `agentdetailsrail.tsx` sets `has.decided` from `usePairOf(agent.tabId)` (worker or judge)
and renders `raildecidedpane.tsx`: **Waits on you** (each item, its note, its chips sending `PairSayCommand` with `Item`
and `To: "both"`, and "other…" opening the conversation (`showPair`) to type an answer, plus the answer once given),
**Agreed** (numbered, each linking to its message: `showPair` and set `pairScrollToAtom` to `MsgId`), **Still open**
(with "reopened by judge …" or "judge's new point"). It updates with the pair atom.

Acceptance: `npx vitest run frontend/app/view/agents/agentrailtabs.test.ts` (order with and without decided,
fallback, never a default); in `scenarios-pair-decided.mjs` (scenario `pair-decided`): step `decided-tab` (the tab
beside Overview, Files and Changes with its amber dot, the three sections as R1's rail), step `answer-chip` (a chip
press calls the stubbed `PairSayCommand` with the item), step `agreed-link` (an agreed item sets the `pair` centre mode
and `pairScrollToAtom` to its message: the scroll itself is Task 7's), step `no-asks` (a seeded pair with nothing
waiting on the person: no dot), step `unpaired` (an agent in no pair has no Decided tab). Run `arc:ux-check` on the tab.

### Task 9: Add judge in the agent header (board K2)
**Depends on:** Task 6
**Model:** sonnet
**Files:** `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/pairjudgemenu.tsx`, `frontend/app/view/agents/pairlaunch.ts`, `frontend/app/view/agents/pairlaunch.test.ts`, `scripts/cdp/scenarios-pair-header.mjs`

Unpaired claude or pi agent: an **Add judge** button in the header opens `pairjudgemenu.tsx`: **Open a new judge**
("new tab in the same project, reads the plan and the latest reply · opus"), then the project's live claude and pi
agents not in a pair (name, short id, state), as K2. Picking a live agent calls `PairStartCommand` (hold on, default
cap) and `showPair`. **Open a new judge** runs `openNewJudge` in `pairlaunch.ts`: `PairBriefCommand`, then
`launchAgent` (`cockpit-actions.ts`) with runtime claude, `startupCommand: runtimeStartupCommand("claude")`,
`extraArgs: ["--model", "opus"]`, the worker's cwd and project, the brief as task, a label naming the worker. The launch
must take the focus (the default: a process starts only when its terminal mounts in the focus pane), so the judge tab
is focused while it boots. Once the judge's row has reported in (its pending launch is gone from
`model.pendingLaunchesAtom`: the roster lists a tab only after its first status names claude or pi), call
`PairStartCommand` with `briefed: true`, put the focus back on the worker and `showPair`. A launch that never reports
in leaves no pair; a failed step shows a toast with the error. Paired worker: **Paired with judge … · N new** (`pairButtonLabel`) opening the conversation, plus a small
Add judge icon button with the same menu to add another judge; the state line reads "waiting on judge" while owed. A
judge's header: **Judging …**, opening the conversation. Keep `pairlaunch.ts`'s choices (args, cwd pick, label)
in pure functions tested beside it.

Acceptance: `npx vitest run frontend/app/view/agents/pairlaunch.test.ts`; in `scenarios-pair-header.mjs` (scenario
`pair-header`): step `add-judge-menu` (K2's open menu: new judge, then live agents), step `paired-button` (the paired
header with "· 2 new" and "waiting on judge"), step `paired-opens` (the button opens the `pair` mode), step
`judge-header` (the judge's own header reads Judging …). Run `arc:ux-check`.

### Task 10: Pair from the Agent tree and the pairing sheet (board K1)
**Depends on:** Task 6
**Model:** sonnet
**Files:** `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/agenttreemodel.ts`, `frontend/app/view/agents/agenttreemodel.test.ts`, `frontend/app/view/agents/pairsheet.tsx`, `frontend/app/view/agents/pairsheetmodel.ts`, `frontend/app/view/agents/pairsheetmodel.test.ts`, `scripts/cdp/scenarios-pair-tree.mjs`

With exactly two picked claude or pi agents, neither in a pair, the row menu (`agenttree.tsx` `menu:` near "Discuss
together") gets **Pair: worker + judge** ("the two talk it through, you get what they settled") above Discuss together,
which keeps opening council Setup. A pure `pairPickable(picked, agents)` in `agenttreemodel.ts` decides it (the first
picked is the worker). The item opens `pairsheet.tsx`, a small sheet rendered by `agenttree.tsx` itself (a popover
anchored beside the tree, as K1 draws it; not a registered modal, so `frontend/app/modals/` is untouched), with
Escape and Cancel closing it and focus returning to the tree: who works and who judges (name, short id), Swap,
the "Hold heavy commands until the judge answers" box (on; "tests, builds, Docker, long commands"), "Note to the judge
(optional)", the token cap in millions (default 3), Cancel and **Pair** (`PairStartCommand`, then `showPair`; an error
shows in the sheet). `pairsheetmodel.ts` holds the draft (swap, cap parse and bounds).

Acceptance: `npx vitest run frontend/app/view/agents/agenttreemodel.test.ts frontend/app/view/agents/pairsheetmodel.test.ts`
(`pairPickable` with two, three, a paired one, a codex one; swap; cap parsing); in `scenarios-pair-tree.mjs` (scenario
`pair-tree`): step `tree-menu` (two picked, the menu with Pair above Discuss together), step `pair-sheet` (K1's sheet),
step `swap` (the sides trade), step `pair-sent` (Pair calls the stubbed `PairStartCommand` with the sheet's values and
opens the conversation). Run `arc:ux-check`.

### Task 11: Docs, CHANGELOG, hand checks
**Depends on:** Task 7 (the CHANGELOG line names the `public/whatsnew/1.10.0-agent-pair.webp` picture Task 7 commits)
**Model:** sonnet
**Files:** `docs/guide/agent-pair.md`, `docs/README.md`, `CHANGELOG.md`, `docs/hand-checks.md`, `docs/reference/architecture.md`

Write from the spec (the docs describe the behaviour the spec settles; they need no other task's code).
`docs/guide/agent-pair.md`: what a pair is, the two ways to start one, the `arc-pair` and `arc-judge` syntax, stops,
the hold and Run now, Unpair; linked from `docs/README.md`. One line in `architecture.md` naming `pkg/agentpair` and
the `pair` centre mode. CHANGELOG: one `Added` line under Unreleased, written for the person, ending
`<!-- big --> <!-- shot: 1.10.0-agent-pair.webp -->`. `docs/hand-checks.md` gets `- [ ] (arcterm) …` lines for what no
scenario can show, since the scenarios run on seeded pairs: pair two live agents and watch a full exchange end on a
stop; a heavy command held mid-turn and Run now; Unpair with a held command; a wavesrv restart mid-exchange.

Acceptance: `npx vitest run frontend/app/cockpit/whatsnew.test.ts` passes.
