# Phone agent list: a list you can act on

**Spec:** `docs/superpowers/specs/2026-11-18-phone-agent-list-design.md` (its last section, "Build decisions", settles
what the spec left to the builder: cursors, page size, the resumable stream, the refusal JSON).
**Verify:** `node scripts/verify.mjs ./pkg/remotemode/... ./pkg/wshrpc/wshserver/... ./cmd/remotepreview/...`
**Check:** `go build ./pkg/remotemode/... ./pkg/wshrpc/wshserver/... ./cmd/remotepreview/... ./cmd/server/... && go vet ./pkg/remotemode/... ./cmd/remotepreview/...`
**Final:** `node scripts/cdp/final-verify.mjs remote-phone remote-hand`

Shape of the plan: Task 1 lands every Go type, route, hook signature and stub the others build on, so Tasks 2–8 run
side by side (four server pieces, two phone-page pieces, the preview server); Task 9 writes the scenario steps and
the docs on top of the phone page and the preview.

The phone page (`pkg/remotemode/web/static/*.js`) is plain ES modules with no build; its pure logic is tested by
vitest (`pkg/remotemode/web/*.test.js`), its DOM only by the `remote-phone` CDP scenario, which drives
`cmd/remotepreview` (fakes behind `remotemode.NewHandler`) in headless Chromium.

Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in front (AGENTS.md).

### Task 1: The contract: types, routes, hook signatures and stubs
**Depends on:** none
**Files:** `pkg/remotemode/agents.go`, `pkg/remotemode/agents_test.go`, `pkg/remotemode/handover.go`, `pkg/remotemode/handler.go`, `pkg/remotemode/handler_test.go`, `pkg/remotemode/waiting.go`, `pkg/remotemode/remote.go`, `pkg/remotemode/take.go`, `pkg/remotemode/transcriptpage.go`, `pkg/remotemode/pc.go`, `pkg/wshrpc/wshserver/wshserver_remoteagents.go`, `pkg/wshrpc/wshserver/wshserver_remoteagents_test.go`, `pkg/wshrpc/wshserver/wshserver_remotetranscript.go`, `pkg/wshrpc/wshserver/wshserver_remotetranscript_test.go`, `cmd/remotepreview/main.go`, `cmd/remotepreview/main_test.go`

Land the interfaces only, with today's behaviour kept wherever a later task fills it in. Everything compiles and
every existing test passes at the end of this task.

Types (exact JSON names; Tasks 2–8 rely on them):

- `remotemode.Agent` (handover.go) gains `RunKey, RunName, RunLine string`: the group a run worker lists under, the
  run's name, and the worker's own line ("Review: <task>", the task label, "Plan reviewer"…). Empty for a non-worker.
  It also gains `Ask string`: the text of the open ask's first question, "" with no ask (Task 2 fills it).
- `ListedAgent` gains `Takeable bool \`json:"takeable"\``.
- New in agents.go: `ListedRun{Key string "key"; Name string "name"; NeedsYou bool "needsyou"; Workers []RunWorkerRow "workers"}`
  and `RunWorkerRow{Tab "tab"; Label "label"; State "state" (Phone*); Line "line"; Since int64 "since"}`.
- `WaitingList` gains `Runs []ListedRun \`json:"runs"\`` and `PC bool \`json:"pc"\``; the handler always sends `runs` as an array.
- `TranscriptChunk{Lines []string "lines"; Cursor int64 "cursor"; End int64 \`json:"-"\`; Backlog bool "backlog"}` (agents.go).
- `StreamSink.Lines` becomes `Lines(TranscriptChunk) error`. The SSE `lines` event writes the chunk as JSON with an
  `id: <End>` line before `data:`.
- Hooks (handover.go): `TranscriptHook func(ctx, path string, from int64, send func(TranscriptChunk) error) error`
  (`from < 0`: backlog is the last 200 lines; else the lines from that byte offset), and new
  `TranscriptPageHook func(path string, before int64, maxLines int) (TranscriptChunk, error)`.
- `Deps`: `Agents func(ctx) ([]ListedAgent, []ListedRun, error)`; `Stream func(ctx, tab string, from int64, sink StreamSink) error`
  (from = parsed `Last-Event-ID`, -1 when absent or malformed); new `Take func(ctx, tab string) error`,
  `Release func(ctx, tab string) error`, `Transcript func(ctx, tab string, before int64) (TranscriptChunk, error)`,
  `PCLock func(ctx) error`, `PCVolume func(ctx, step string) error`. New sentinel `ErrRefused` (a take refusal wraps it).

Routes (handler.go), POSTs behind `handlerPost`:

- `POST /api/agents/{tab}/hand` → `Take`: 200 ok; an error wrapping `ErrRefused` → 409 `{"error":"refused","reason":<err text after the sentinel>}`; else 500.
- `POST /api/agents/{tab}/release` → `Release`: 200 ok; a `*GoneError` → 200 ok too (nothing to release); else 500.
- `GET /api/agents/{tab}/transcript?before=<n>` → `Transcript`: 200 `{"lines","cursor"}`; missing or non-integer `before` or `before < 0` → 400; `*GoneError` → 410 as the action routes.
- `POST /api/pc/lock`, `POST /api/pc/volume` with `{"step": "down"|"mute"|"up"}`: a nil dep → 501 `{"error":"Not supported on this computer"}`; another step → 400; an error → 500 with its text.
- `handleWaiting` fills `Runs` from `Agents` and `PC = d.PCLock != nil && d.PCVolume != nil`.
- Every new route answers 501 `{"error":"Not supported on this computer"}` when its dep is nil (`Take`, `Release`,
  `Transcript`, `PCLock`, `PCVolume`), so a handler built without one never panics.

Stubs the later tasks replace (each in the file that task owns): take.go `remoteTake`, `remoteRelease`,
`handMarkActed(tab string)` (returns errors.New("not built yet") / does nothing); transcriptpage.go
`remoteTranscriptPage` (calls `TranscriptPageHook`, error when nil); pc.go `pcSupported = false`, `pcLock`,
`pcVolume`. `remoteAct` calls `handMarkActed(tab)` after an action succeeds. `remoteDeps` wires all of them, the PC
deps only when `pcSupported`. `remoteAgentList` returns nil runs. `remoteStream` takes `from` and passes it to
`TranscriptHook`.

wshserver: move `RemoteTranscript` and its two tests out of wshserver_remoteagents*.go into
wshserver_remotetranscript*.go with the new signature, behaving as today (backlog then appends, `Cursor`/`End` 0,
`Backlog` true on the first chunk); Task 4 fills in the offsets. cmd/remotepreview: adapt to the new `Deps`
signatures only (no new fixtures; Task 8 owns those), and drop the `fx-old-spike` row so nothing outside agents.go
names `remotemode.PhoneEnded` (Task 2 deletes the constant while Task 8 owns the preview).

Acceptance: `go test ./pkg/remotemode -run 'TestHandler'` covers each new route's status codes with fake deps
(hand 200/409, release 200 on gone, transcript 400/410/200, pc 400/200, 501 for each nil dep, `runs` and `pc` in `/api/waiting`,
the SSE `id:` line and `Last-Event-ID` → `from`); the existing remotemode, wshserver `TestRemote*` and
cmd/remotepreview tests pass.

### Task 2: Roster: live agents only, takeable, idle reply line, runs grouped
**Depends on:** Task 1
**Files:** `pkg/remotemode/agents.go`, `pkg/remotemode/agents_test.go`, `pkg/wshrpc/wshserver/wshserver_remoteagents.go`, `pkg/wshrpc/wshserver/wshserver_remoteagents_test.go`

Spec sections "Which agents are listed", "An agent row", "A run's row".

- `BuildAgentList(agents, handed)` returns `([]ListedAgent, []ListedRun)`. Not live (`Status.Ended`, or claude
  without `HasStream`) → left out; drop `listedState` and `PhoneEnded`. Run workers (`RunWorker`) → grouped by
  `RunKey` into `ListedRun`s, never agent rows. `Takeable = Eligible(a) == nil`.
- The line: working → `stateLine`; permission → `stateLine`; asking → `Agent.Ask` when set, else `stateLine`'s
  "Asking you a question" (the Handed over row's `handedLine` takes the same rule); input → the status detail if any; idle → the
  first sentence of the last reply (one helper shared with `handedLine`; at most 160 chars). Read through a cache
  keyed by transcript path with the file's size and mod time (a package var map under a mutex), so an unchanged
  transcript is not reread on the 10 s poll.
- `ListedRun`: `NeedsYou` when any worker is asking, permission or input; workers sorted like agent rows; runs
  sorted needs-you first, then name, then key. A worker's `RunWorkerRow.Label` is its `Agent.RunLine`, its `Line`
  the same state line an agent row gets.
- wshserver `RemoteAgents` fills `Ask` from the open ask it already looks up (`agentask.GlobalRegistry.Get` on the
  block oref): the first question's `Question`.
- wshserver `RemoteAgents` fills `RunKey` (the run's `DagORef`; else `"lead:" + ParentLeadORef`; else the run's
  OID), `RunName` (the goal of the run with that `DagORef` and no `TaskId`, `Review` or `StageRole`; else the first
  worker's `Goal`; a `ParentLeadORef` child: the lead tab's roster `Name`), and `RunLine` (task label from the
  `TaskGroup` `DagORef` names, prefixed "Review: " for a reviewer; `StageRole` "plan-reviewer" → "Plan reviewer",
  "verifier" → "Verifier", "land-resolver" → "Land resolver"; else the run's goal). Load each distinct TaskGroup
  once per call, through a package var `loadRemoteTaskGroup func(ctx, oid string) (*waveobj.TaskGroup, error)`
  (default `wstore.DBGet`), so tests script it beside `loadAgentRosterFacts` with no store. A failed load logs and
  falls back to the run's goal.

Acceptance: `go test ./pkg/remotemode -run 'TestBuildAgentList|TestReplyLine|TestIdleLineCache'` (exited left out,
codex row listed untakeable, workers grouped with needs-you sort, idle line from a fixture transcript and not reread
when unchanged, an asking row's line is its question); `go test ./pkg/wshrpc/wshserver -run 'TestRemoteAgents'`
(run key, name and line for a dag worker, a reviewer, a stage session and a `wsh jarvis run` child; `Ask` filled).
Shown in `remote-phone` steps 1a and 1d (Task 9).

### Task 3: Take and release from the phone
**Depends on:** Task 1
**Files:** `pkg/remotemode/take.go`, `pkg/remotemode/take_test.go`, `pkg/remotemode/handover.go`, `pkg/remotemode/handover_test.go`

Spec section "Tapping an agent row takes it".

- `remoteTake(ctx, tab)`: resolve the tab exactly (no prefix) in `handAgents`; missing → `ErrRefused` "its tab is
  gone"; `Eligible` fails → `ErrRefused` with its message; else `handAdd(a)` marking the hand-over `phone: true,
  acted: false` (a tab already handed keeps its flags), then `publishStatus()`. Never `remoteStartLocked`.
- `handMarkActed(tab)` sets `acted` on a handed tab. `remoteRelease(ctx, tab)` ends the hand-over (reason
  `EndTaken`, `publishStatus`) only when it is `phone && !acted`; otherwise nil.
- `handover` gains `phone, acted bool`; `handClearOff`/`TakeBack` unchanged.

Acceptance: `go test ./pkg/remotemode -run 'TestRemoteTake|TestRemoteRelease'`: a take of an eligible agent hands
it (and `Status().Handed` lists it); a run worker and a gone tab are refused with `ErrRefused`; release ends an
unacted phone take, and is a no-op after a send (through `remoteAct` with a recorded `remoteSendInput`) and for a
hand-over made with `Hand`. Shown in `remote-phone` step 1c (Task 9).

### Task 4: Transcript pages and a resumable stream
**Depends on:** Task 1
**Files:** `pkg/remotemode/transcriptpage.go`, `pkg/remotemode/transcriptpage_test.go`, `pkg/wshrpc/wshserver/wshserver_remotetranscript.go`, `pkg/wshrpc/wshserver/wshserver_remotetranscript_test.go`, `pkg/wshrpc/wshserver/transcript.go`, `pkg/wshrpc/wshserver/transcript_test.go`, `cmd/server/main-server.go`

Spec "Reading an agent's transcript" and the cursor decisions.

- wshserver `RemoteTranscriptPage(path, before, maxLines)`: up to `maxLines` complete non-empty lines ending at
  byte `before` (clamped to the file's size; only whole newline-terminated lines), `Cursor` = start of the first;
  reuse `readTail` rather than reading the file. Wire it as `remotemode.TranscriptPageHook` in main-server.go.
- `RemoteTranscript(ctx, path, from, send)`: `from < 0` → backlog of the last 200 complete lines; else the lines from
  `from` on. The first chunk has `Backlog: true` and its `Cursor`; every chunk has `End` = the offset after its last
  line. Keep the watch-before-read order of `streamTranscript`; if that needs a shared helper in transcript.go, the
  cockpit's `streamTranscript` keeps its behaviour and its tests.
- `remoteTranscriptPage(ctx, tab, before)`: `LookupHanded` (its `*GoneError` passes through), 200-line pages.

Acceptance: `go test ./pkg/wshrpc/wshserver -run 'TestRemoteTranscript'` (page boundaries and cursors over a fixture
file including a partial last line, cursor 0 at the start, resume from an offset with no duplicate and no gap,
appends carry End); `go test ./pkg/remotemode -run 'TestRemoteTranscriptPage'`. Shown in `remote-phone` step 13 (Task 9).

### Task 5: Lock and volume
**Depends on:** Task 1
**Files:** `pkg/remotemode/pc.go`, `pkg/remotemode/pc_windows.go`, `pkg/remotemode/pc_darwin.go`, `pkg/remotemode/pc_other.go`, `pkg/remotemode/pc_test.go`, `pkg/remotemode/pc_windows_test.go`, `pkg/remotemode/pc_darwin_test.go`

Spec "Controlling the computer from the phone". `pc.go` keeps the step validation and the shared signatures;
`pcSupported`, `pcLock`, `pcVolume` move to the platform files: Windows `LockWorkStation` (user32, lazy DLL like
awake_windows.go) and `keybd_event` key down + up of `VK_VOLUME_DOWN` (0xAE) / `VK_VOLUME_MUTE` (0xAD) /
`VK_VOLUME_UP` (0xAF); darwin `pmset displaysleepnow` and `osascript -e` setting output volume ±6 or toggling
output muted, through an exec var tests can replace; others unsupported. Every failure returns an error naming what
failed (no swallowed error).

Acceptance: `go test ./pkg/remotemode -run 'TestPC'`: step validation (pc_test.go), darwin command lines via the
exec var (pc_darwin_test.go, built only on darwin), and on Windows that the procs resolve (pc_windows_test.go:
`Find()` on the lazy procs; never press a key or lock in a test). The Check builds only for Windows, so also run
`GOOS=darwin go vet ./pkg/remotemode/` and `GOOS=linux go vet ./pkg/remotemode/` and make both pass (say in the
report if a dependency outside these files blocks either). Shown in `remote-phone` steps 14 and 5 (Task 9).

### Task 6: The phone list page
**Depends on:** none
**Files:** `pkg/remotemode/web/static/phone.js`, `pkg/remotemode/web/static/model.js`, `pkg/remotemode/web/static/chatmodel.js`, `pkg/remotemode/web/static/phone.css`, `pkg/remotemode/web/model.test.js`, `pkg/remotemode/web/chatmodel.test.js`

Spec "An agent row", "A run's row", "Page layout", the Computer section. Read DESIGN.md's phone notes and keep
phone.css on the tokens in tokens.css.

- Agent rows: name, project only when it differs from the name, a left dot coloured by state (not runtime), the
  state chip, the second line. A takeable row is a `button` with `data-agent-row=<tab>`; tapping posts
  `/api/agents/<tab>/hand` and on 200 sets `#agent/<tab>`; on 409 shows "Not taken: <reason>" on that row
  (`data-take-error`) and leaves it listed. The error lives in page state keyed by tab (cleared by that row's next
  take), since `render()` rebuilds every row on the 10 s refresh. An untakeable row is a muted `div` (`data-agent-row`, `data-untakeable`).
  Drop the `ended`/"exited" row label from `rowStateLabel`.
- Runs: a **Runs** section after Agents; one `button` row per run (`data-run-row=<key>`, `aria-expanded`) with the
  name, a counts line from a pure `runCounts(run)` ("3 working · 1 needs approval"), and a "Needs you at the desk"
  chip when `needsyou`. Tapping toggles worker lines (`data-run-worker=<tab>`: label · line, read-only) under it;
  open keys live in page state, kept across the 10 s refresh.
- Header: `h1` is "N need you" / "1 needs you" / "Nothing waits on you" from a pure `needYouCount(list)`:
  `questions.length + shown.length +` the number of distinct tabs, across `handed`, `agents` and every run's
  `workers`, whose state is `permission` or `input` (an `asking` agent is counted through its question; `agents`
  repeats the handed ones with `handed: true`, hence the dedupe by tab). The sub-line stays `countsLine`.
  Sections in order: Questions, Handed over, Held runs, Agents, Runs, Computer.
- Leaving a chat: `openChat`'s `close()` now returns a Promise that settles once the release post is done (Task 7);
  `route()` awaits it before `render()` and `refresh()`, so the list never reads the agent as still handed.
- Computer section (`aria-label="Computer"`, `h2` "Computer") above the off footer, when `list.pc`: Lock (`data-pc="lock"`) and
  down / mute / up (`data-pc="down|mute|up"`); a non-200 shows its `error` under the buttons
  (`data-pc-error`). Shown in the main and empty views.
- `viewState`: empty also needs no runs.

Acceptance: `npx vitest run pkg/remotemode/web/model.test.js pkg/remotemode/web/chatmodel.test.js` covers
`needYouCount` (including the dedupe of a handed agent repeated in `agents`, and an asking agent not counted),
`runCounts`, `viewState` with runs, the project-shown rule and `rowStateLabel`. Shown in `remote-phone` steps 1
(header), 1a (rows), 1c (take, refused take, release), 1d (run row closed and open), 14 (Computer) and 5 (empty
view's header and Computer), written by Task 9.

### Task 7: The phone chat: older pages, resumed stream, release on leave
**Depends on:** none
**Files:** `pkg/remotemode/web/static/chat.js`, `pkg/remotemode/web/static/transcriptpages.js`, `pkg/remotemode/web/transcriptpages.test.js`, `pkg/remotemode/web/static/sw.js`

Spec "Reading an agent's transcript" and the release rule.

- A pure `transcriptpages.js`: the held history (pages, oldest cursor, reached start), the live tail capped at
  `MAX_LINES`, `merge` of a backlog chunk (first connection: sets the cursor; resumed: appends to the tail), and
  `needMore(itemsGained)` against the 20-item screenful. Add it to sw.js's `SHELL`.
- chat.js: draws history + tail through `projectFor`; scrolling within 48 px of the top loads `GET
  .../transcript?before=<cursor>` page by page until 20 more items or cursor 0, one request at a time, keeping the
  scroll position (scrollTop += height gained); a "Loading earlier messages" line and, at cursor 0, nothing more.
  A reconnect no longer clears the lines. No new CSS: reuse existing classes (Task 6 owns phone.css).
- Release: `close()` posts `/api/agents/<tab>/release` unless the chat already ended, and returns a Promise that
  settles when the post does (a failure is logged to the console and still settles); an ended chat's `close()`
  returns a settled Promise. phone.js (Task 6) awaits it before refreshing the list. Back calls `ui.onBack` as today,
  which reaches `close()` through the route.

Acceptance: `npx vitest run pkg/remotemode/web/transcriptpages.test.js` (first backlog, resumed backlog appends,
page prepends and cursor moves, start reached, tail cap leaves history). Shown in `remote-phone` steps 1c (release
on Back) and 13 (older page on scroll to top), written by Task 9.

### Task 8: Preview server fixtures
**Depends on:** Task 1 (uses the new `Deps` fields it adds)
**Files:** `cmd/remotepreview/main.go`, `cmd/remotepreview/main_test.go`, `cmd/remotepreview/testdata/lab-notes.jsonl`

Spec "Left to the builder" (fixtures). The main fixture's roster becomes: the three hand-overs (`handed: true`),
`fx-bench-runner` (pi, working, takeable), `fx-lab-notes` (claude, idle 25 m, takeable, its line the first sentence
of its last reply, project shown since it differs), `fx-codex-scan` (codex, idle, untakeable), `fx-refused`
(takeable in the list, but the fake `Take` refuses it with a reason); no exited row. One run `dag-fx1` named
"Phone agent list" with three workers (two working, one permission → `needsyou`). Fakes record `take`, `release`,
`transcript` (with `before`), `pclock`, `pcvolume`: a take moves the agent into `handed` (and release back out when
nothing was acted on), the stream honours `from` and sets End offsets over its fixture lines, `Transcript` pages a
long fixture (`lab-notes.jsonl`, enough turns that its first message is outside the 200-line backlog), `PCVolume`
refuses `mute` with an error so the page's error line can be shown. Wire `PCLock`/`PCVolume` fakes in every
fixture (the empty one included), so `pc` is true there too.

Acceptance: `go test ./cmd/remotepreview` (the list's shape, take/release round trip, a page before the backlog's
cursor reaches cursor 0). Used by `remote-phone` (Task 9).

### Task 9: Scenario steps, docs and changelog
**Depends on:** Task 6 (draws the rows the steps read), Task 7 (the chat paging and release the steps drive), Task 8 (the preview fixtures the steps assert on)
**Files:** `scripts/cdp/scenarios-remote.mjs`, `docs/remote-phone.md`, `docs/hand-checks.md`, `CHANGELOG.md`

`remote-phone` steps (assert on the DOM and the preview's records; screenshot each):

- 1 (existing, adjusted): header `h1` reads "7 need you" for the main fixture (3 questions + 2 held runs + the
  `siem-deploy` permission hand-over + the run's permission worker, by Task 6's `needYouCount`) and the sections
  read Questions, Handed over, Held runs, Agents, Runs, Computer.
- 1a (existing, adjusted): agent rows `fx-bench-runner`, `fx-lab-notes`, `fx-codex-scan`, `fx-refused` with state
  dots, the idle reply line, the codex row `data-untakeable` and not a button, no exited row.
- 1c (new): tap `fx-lab-notes` → `take` recorded and the chat opens; Back → `release` recorded and the row is listed
  again; tap `fx-refused` → its "Not taken: …" line shows, stays after a refresh, and no chat opens.
- 1d (new): the run row shows "2 working · 1 needs approval" and its needs-you chip; tapping opens three worker
  lines, survives a refresh, and tapping again closes it.
- 13 (new): in `fx-lab-notes`'s chat, scrolling to the top records a `transcript` request and the fixture's first
  message shows, with the previously top message still in view.
- 14 (new): the main view's Computer section: Lock and volume up record `pclock` / `pcvolume`; mute shows the
  refusal under the buttons.
- 5 (existing, adjusted): the empty fixture's `h1` reads "Nothing waits on you" and its Computer section shows.

The existing step ids 1b (Turn on notifications), 2–12b stay as they are; new steps take the free ids above. Docs: rewrite "The Agents
list" in `docs/remote-phone.md` (taking, release, runs, older messages, Computer); `CHANGELOG.md` Unreleased: one
`Added` line for taking an agent and the Computer controls, one `Changed` line for the list (live only, runs
grouped, older messages); replace the open `docs/hand-checks.md` Agents-list line with a real-iPhone check (take an
agent, scroll an old transcript, Lock).

Acceptance: `task verify:ui -- remote-phone` passes (the Final runs it on the merged result).
