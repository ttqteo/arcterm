# Session ideas: what was floated in a session and never decided, kept before its transcript goes

**Effort:** effort:0ab0fe28-b25a-4769-8c62-c1963dc1aabc
**Spec:** `docs/superpowers/specs/2026-11-26-session-ideas-design.md` (read "Decided after the first draft": nothing scans before Scan my sessions; no nav-rail dot)
**Verify:** `node scripts/verify.mjs ./pkg/sessionideas/... ./pkg/agentsessions/... ./pkg/jarvis ./pkg/storage/... ./pkg/wps/... ./pkg/tsgen/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs sessionideas-brief sessionideas-pet brief-surface jarvis-pet settings-storage`

Shape of the work: Task 1 lands the names everything builds on (wire types, the store, the RPCs, the event, the scan
guard, the dev fixture mode, empty scenario modules), and Task 2 (search back 90 days, an exported digest reader) runs
beside it. Then the backend goes Task 3 (Keep and Drop) beside Task 4 (the scan), and Task 5 (the schedule) after both
(it changes the Get handler Task 3 edits). The frontend goes Task 6 (store, model, launches, the `sessionideas`
address), then Task 7 (the Waiting line) beside Task 8 (the Brief region), and Task 9 (Sprout and Jarvis) after Task 7,
whose Waiting line its scenario shows. Task 10 writes the docs last. The brainstorm panel part (spec, "Related") is not
in this plan: it is already chunk 10 on the effort.

**What a scan covers** (one rule every task uses): a scan the person starts (Scan my sessions, Scan now, Retry, Scan them
first with its own list) passes its Paths or none; **empty Paths means every quiet session not yet scanned** (no mark,
or a mark whose size or mtime changed). The schedule (Task 5) always passes Paths: its forced and due lists.

**No step of Final calls a model or reads a real transcript.** Final's dev app has its own store but reads the real
`~/.claude`, so every scenario that can start a scan first seeds **fixture mode** (`SessionIdeasSeedCommand` with
`Fixture` set, Task 1): while it is on, the scan's candidates are the seeded sessions, every digest read returns a
canned one-turn digest, the model call returns the seeded `Reply` (default `[]`) and spends nothing, the Get handler
lists the seeded sessions, and the schedule's loop (Task 5) does nothing. Teardown seeds `{Clear: true}`, which empties
the store and turns fixture mode off.

The canvas `D:\work\arcterm\.superpowers\design\ideas-vault\project` is guidance, not a Prototype: build
`Brief-Region` and `Jarvis-Ask` as drawn; from `Nudges` build the toast (1), Since you looked (2) and the Waiting line
(4), not the rail dot (3); `Scan-States` board 1 is the first-scan offer, and its boards 2–4 show states that go inside
the From your sessions region, not on the To review strip or sheet.

Rules for every task:

- Principles: simple and direct, KISS, YAGNI, DRY, one source of truth; no abstraction for a single implementation;
  handle errors at the boundaries and never swallow one silently (a failed read logs what it lost).
- **`pkg/sessionideas` imports neither `pkg/jarvis` nor `pkg/effortstore`** (`pkg/jarvis` reads the store for the
  Waiting line, Task 7, so the other way would be a cycle). What needs initiatives (Keep, the scan's project context)
  is wired in `pkg/wshrpc/wshserver`, which imports both.
- Never hand-edit generated files (`frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`,
  `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`): edit the Go types and run `task generate`.
- Frontend: testable logic in the pure `.ts` beside its test, the `.tsx` thin; colors from `@theme` tokens only; read
  `DESIGN.md` before styling, and copy sizes from the Brief's and the popup's own classes (`briefstyle.ts`,
  `petpeek.tsx`). Every change of shape rides `springReveal` / `springPop` from `element/motiontokens.ts`, opacity the
  Fluid ease at `durMicro`; a batch (first load, 3+ rows at once) shows at once (`element/springbatch.ts`).
- Lint and format only the paths you touched (`npx eslint <paths>`, `npx prettier --check <paths>`); never run prettier
  on `scripts/*.mjs`.
- Run only the focused tests your task names (Go: `go test ./pkg/x -run '<names>'`, with
  `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` on Windows; vitest: `npx vitest run <file>`), never a whole
  package or the suite: Verify runs those at merge.
- Commits carry no attribution trailer.
- **No scenario step opens a real agent** (AGENTS.md: never launch real agents to stage a shot). Every press of Discuss
  or Go through, from the region, a chip or a typed route, runs under the launch hook Task 6 adds, which records the
  launch and opens nothing.

### Task 1: Names, wire types, the ideas store, the RPCs and empty scenario modules
**Depends on:** none
**Files:** `pkg/sessionideas/store.go`, `pkg/sessionideas/store_test.go`, `pkg/sessionideas/scan.go`, `pkg/sessionideas/sessions.go`, `pkg/sessionideas/sessions_test.go`, `pkg/wshrpc/wshrpctypes_sessionideas.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_sessionideas.go`, `pkg/wshrpc/wshserver/wshserver_sessionideasscan.go`, `pkg/wshrpc/wshserver/wshserver_sessionideas_test.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/sessionideas-brief-scenarios.mjs`, `scripts/cdp/sessionideas-pet-scenarios.mjs`

Interface the other tasks rely on (exact names; json tags lowercase of the field name):

- `pkg/wshrpc/wshrpctypes_sessionideas.go`:
  - `SessionIdeaQuote{Who string /* "you" | "agent" */; Text string}`.
  - `SessionIdea{ID, Gist, Project, ProjectPath, EffortOID, EffortTitle string; Quotes []SessionIdeaQuote; Why,
    SessionID, SessionTitle, TranscriptPath string; SaidTs, DeletesTs, FoundTs int64; State string /* review | kept |
    dropped */; ResolvedTs int64; KeptAs string /* "chunk:<effort oid>:<label>" or "effort:<oid>" */}`. `EffortOID`
    empty means a new idea.
  - `SessionIdeaMark{TranscriptPath, SessionID, SessionTitle, Project string; Size, MtimeMs, ScannedTs, LastTurnTs
    int64; Ideas int; Outcome string /* ideas | nothing | skipped */}`. `skipped` is a session read and passed over
    without a model call (a decide agent's session, a digest with no user turn): it counts as scanned everywhere, so it
    is never forced, counted unscanned or offered to Storage's Scan them first again.
  - `SessionIdeasScan{Done, Total int; StartedTs, EndedTs int64; Forced bool; Error string; StoppedAt int; NewIdeas
    int; Tokens int64}` (`Error` and `StoppedAt` set when the scan stopped part way; `Tokens` the scan's calls summed).
  - `SessionIdeasSession{SessionID, Title, Project, TranscriptPath string; Size, LastWriteTs, DeletesTs int64; Outcome
    string /* ideas | kept | nothing | not-scanned | waiting */; Ideas int}`: `not-scanned` is quiet (no write for 2
    days) and unscanned, so the next scan the person starts reads it; `waiting` is unscanned and still being written.
    Sessions with a `skipped` mark and archived ones are left out of the list and the counts. The first-scan offer's
    "M sessions" is the number of `not-scanned` rows.
  - `SessionIdeasData{Ideas []SessionIdea; Marks []SessionIdeaMark; Sessions []SessionIdeasSession; Scanned, NotYet,
    LeavingSoon int; LastScanTs, NextScanTs, SeenTs, SnoozedUntil int64; FirstScanDone bool; Scan *SessionIdeasScan}`.
  - Commands, in a `SessionIdeasCommands` interface embedded in `WshRpcInterface` (`pkg/wshrpc/wshrpctypes.go`, beside
    `EffortCommands`): `SessionIdeasGetCommand(ctx) (*SessionIdeasData, error)`;
    `SessionIdeasResolveCommand(ctx, CommandSessionIdeasResolveData{ID, Op /* keep | drop */, Label string}) error`;
    `SessionIdeasMarkCommand(ctx, CommandSessionIdeasMarkData{Op string /* seen | snooze */}) error`;
    `SessionIdeasScanCommand(ctx, CommandSessionIdeasScanData{Stop bool; Paths []string}) error` (empty Paths: every
    quiet session not yet scanned, the rule above); `SessionIdeasSeedCommand(ctx, CommandSessionIdeasSeedData{Data
    SessionIdeasData; Fixture bool; Sessions []SessionIdeasSession; Reply string; Clear bool}) error`, refused unless
    `wavebase.IsDevMode()` (the CDP fixtures use it): it writes `Data` to the store; `Fixture` turns fixture mode on
    with `Sessions` as the candidates and `Reply` as the canned model reply; `Clear` empties the store and turns it
    off.
- `pkg/wps/wpstypes.go`: `Event_SessionIdeasChanged = "sessionideas:changed" // type: none`, in `AllEvents` (`:72`)
  and in `pkg/tsgen/tsgenevent.go`'s `WaveEventDataTypes` (`:23`), as the file's header says; published on every store
  write. It carries no data: the counts and the session list are computed by the Get handler, not stored, so the
  frontend re-reads with `SessionIdeasGetCommand` on each event (Task 6).
- `pkg/sessionideas/store.go`: `Store{Root string; Now func() time.Time}`, `Default()` at
  `<wavebase.GetWaveDataDir()>/sessionideas/`, one `state.json` holding `SessionIdeasData` minus `Sessions` and the
  three counts; `Load() (wshrpc.SessionIdeasData, error)`; `Update(fn func(*wshrpc.SessionIdeasData) error) error`
  (one mutex, written with temp file + rename as `pkg/bugreport/bugreport.go:196` `writeJSONAtomic` does, then the
  event). Model it on `pkg/bugreport` and its test harness.
- `pkg/sessionideas/sessions.go`: `Sessions(d wshrpc.SessionIdeasData, now time.Time) ([]wshrpc.SessionIdeasSession,
  scanned, notYet, leavingSoon int)` from the marks alone (Task 5 changes its inputs to add the unscanned sessions and
  deletion days, and its one caller, the Get handler, with it).
- `pkg/sessionideas/scan.go`: `type Deps struct{}`, `type ProjectContext struct{}` (Task 4 fills both) and
  `ScanNow(ctx context.Context, s *Store, deps Deps, opts ScanOpts) error` with `ScanOpts{Forced bool; Paths
  []string}`, returning `errors.New("scan not built yet")` (Task 4 replaces the body).
- `pkg/wshrpc/wshserver/wshserver_sessionideasscan.go`, **the one scan guard** the Scan handler and Task 5's loop both
  go through: `startSessionIdeasScan(opts sessionideas.ScanOpts) error` runs `sessionideas.ScanNow(ctx,
  sessionideas.Default(), sessionIdeasScanDeps(), opts)` in a goroutine under one mutex and cancel func; a second start
  while one runs returns "a scan is running"; `stopSessionIdeasScan()` cancels it. The fixture state lives here too:
  `sessionIdeasFixture() (*wshrpc.CommandSessionIdeasSeedData, bool)`, set by Seed. `func sessionIdeasScanDeps()
  sessionideas.Deps` returns the zero value (Task 4 fills it, the fixture deps included).
- Handlers in `wshserver_sessionideas.go`: Get (store + `Sessions`; Task 5 adds the candidates, the fixture sessions
  while fixture mode is on),
  Scan (`startSessionIdeasScan`, or `stopSessionIdeasScan` on Stop), Mark (`seen` sets `SeenTs`, `snooze` sets
  `SnoozedUntil` to now + 7 days), Resolve `drop` (state `dropped`, `ResolvedTs`), Resolve `keep` returning
  `errors.New("keep not built yet")` (Task 3), Seed.
- Scenario modules: `scripts/cdp/sessionideas-brief-scenarios.mjs` exporting `sessionIdeasBriefScenarios(kit)` (one
  scenario, name `sessionideas-brief`, surface `jarvis`) and `scripts/cdp/sessionideas-pet-scenarios.mjs` exporting
  `sessionIdeasPetScenarios(kit)` (name `sessionideas-pet`), shaped as `jarvisCardsScenarios` is: called with
  `JARVIS_KIT` (`scenarios.mjs:65916`, which holds `briefSeedInitiative` at `:65924`) and spread into the scenario list
  beside `...jarvisCardsScenarios(JARVIS_KIT)` (`:76031`). Each has a seed helper that calls `sessionideasseed` with
  `Fixture: true`, two ideas on an initiative seeded through `kit.briefSeedInitiative`, one new idea, and fixture
  sessions to match; a teardown that seeds `{Clear: true}` and deletes the initiative; and an empty step list.
- Run `task generate`. Tests: `go test ./pkg/sessionideas -run 'TestStore|TestSessions'` (load of a missing file is
  empty, update round-trips, no temp file left, the event fires once per update) and `go test
  ./pkg/wshrpc/wshserver -run 'TestSessionIdeas'` (drop, seen, snooze, seed refused outside dev mode, fixture on and
  cleared, a second scan start refused while one runs).

### Task 2: Search back 90 days and an exported digest reader
**Depends on:** none
**Chunk:** Search back 90 days: DigestWindowDays 30 -> 90, measure digest RAM/disk into open-issues RAM watch
**Files:** `pkg/agentsessions/digeststore.go`, `pkg/agentsessions/digeststore_test.go`, `pkg/agentsessions/digestexport.go`, `pkg/agentsessions/digestexport_test.go`

- `DigestWindowDays = 90` (`pkg/agentsessions/digeststore.go:34`). No test pins 30: `digeststore_test.go:353` and
  `:531` use the constant, so check they still pass. `digestBudgetFiles = 100` (`:65`) is per search call and stays;
  the warm-up (`warmDigests`, `:315`) builds the whole window, so at 90 days about three times the digests at boot: its
  log line (`:334`) gives the count and time, and the For later note below says it was not measured.
- `digestexport.go`: `type DigestSession struct{ Path, Stem string; Mtime time.Time; Size int64; Archived bool;
  Session *SessionInfo; Turns []Turn }`; `ClaudeDigestCandidates(windowDays int) []DigestSession` (claude provider and
  its archive, `agentsessions.go:843`/`:853`, through `walkCandidates` `:1376`; `Archived` from `provider.archive`
  `:836`; no Turns); `ReadDigestFor(path string) (DigestSession, error)` (the fresh digest via `readDigest` /
  `digestFresh`, `digeststore.go:105`/`:122`, else `buildDigest` + `writeDigest` `:134`/`:155`).
- Tests: `go test ./pkg/agentsessions -run 'TestDigestExport|TestDigestWindow'` with temp roots (the provider vars are
  seams, `digestProviders`).
- In your worker report's **For later tasks** section write: "RAM/disk of the digest store at 90 days not measured
  (stress runs go off-hours)"; Task 10 turns it into an open-issues RAM watch row.

### Task 3: Keep and Drop into initiatives, and `wsh sessionideas`
**Depends on:** Task 1
**Files:** `pkg/sessionideas/resolve.go`, `pkg/sessionideas/resolve_test.go`, `pkg/wshrpc/wshserver/wshserver_sessionideas.go`, `pkg/wshrpc/wshserver/wshserver_sessionideas_test.go`, `cmd/wsh/cmd/wshcmd-sessionideas.go`, `cmd/wsh/cmd/wshcmd-sessionideas_test.go`

- `resolve.go` (pure): `KeepNote(i wshrpc.SessionIdea) string` — the chunk's first note: the source line
  (`From session "<title>" (<session id>), <date>`), each quote as `> You: …` / `> Claude: …`, then `Why it stayed open:
  …`; `ChunkLabel(i, label string) string` (the label given, else the gist).
- Keep in the handler: with `EffortOID`, add a `pending` chunk and its note through the same path
  `EffortMutateCommand` uses (`pkg/wshrpc/wshserver/wshserver_effort.go:100`, `jarvis.ApplyEffortOpsAs`
  `pkg/jarvis/effortops.go:179`); without, create an idea (an initiative with no chunk, `project` set) as
  `EffortCreateCommand` does, with the note as its first note. Then state `kept`, `KeptAs`, `ResolvedTs`. An effort
  gone since the scan makes a new idea instead, and says so in the log.
- `wsh sessionideas list` (id, state, gist, initiative) and `wsh sessionideas keep <id> [--label "<label>"]` /
  `drop <id>`: the CLI the Discuss and Go through agents (Task 6) record decisions with.
- Tests: `go test ./pkg/sessionideas -run 'TestKeepNote|TestChunkLabel'`, `go test ./pkg/wshrpc/wshserver -run
  'TestSessionIdeasKeep'` (on an initiative: one pending chunk with the note; no initiative: an idea; a gone effort:
  an idea), `go test ./cmd/wsh/cmd -run 'TestSessionIdeasCmd'`.

### Task 4: The scan
**Depends on:** Task 1, Task 2 (reads sessions through `ClaudeDigestCandidates` and `ReadDigestFor`)
**Chunk:** Scan: haiku per session digest, ideas store under <data dir>/sessionideas, scanned marks, skips (archive, quiet < 2 days, decide agents)
**Files:** `pkg/sessionideas/scan.go`, `pkg/sessionideas/scan_test.go`, `pkg/sessionideas/prompt.go`, `pkg/sessionideas/prompt_test.go`, `pkg/sessionideas/projectctx.go`, `pkg/sessionideas/projectctx_test.go`, `pkg/wshrpc/wshserver/wshserver_sessionideasscan.go`, `pkg/wshrpc/wshserver/wshserver_sessionideasscan_test.go`

- `Deps{Run func(ctx context.Context, prompt string) (reply string, tokens int64, err error); ProjectContext func(ctx context.Context,
  projectPath string) (ProjectContext, error); Candidates func() []agentsessions.DigestSession; Read func(path string)
  (agentsessions.DigestSession, error); Now func() time.Time}`.
- **Skips**, in two pure steps. `Eligible(s DigestSession, marks, now) bool`, over what a candidate carries (no Turns):
  not archived, last write at least 2 days ago, and no mark with the same size and mtime. Then, after the digest is
  read, `SkipContent(d DigestSession) (bool, reason string)`: the first user turn starts with `[arc:session-ideas]`
  (the marker Task 6's agents carry), or the digest has no user turn. A content skip writes a `skipped` mark and makes
  no model call, so the session is never read again unless it grows.
- **Project context** (`projectctx.go`, pure over what the caller reads): `ProjectContext{Initiatives []{OID, Title
  string; Chunks []string}; Ideas []string; Specs, Plans []string /* file names */; Deferred []string /* ## and ###
  headings of docs/deferred.md */; Commits []string /* last 200 subjects */; Known []string /* gists already in the
  store for this project, any state */}`. In `wshserver_sessionideasscan.go`, `ProjectContext` reads the project's
  initiatives and ideas (the effort list the Brief uses), the two folders and `docs/deferred.md` when they exist, and
  `git log -200 --format=%s`.
- **Prompt** (`prompt.go`): the session's turns (only those after the mark's `LastTurnTs` for a session that grew),
  the project context, and the rules: list ideas floated and not decided; leave out anything matching an initiative,
  chunk, idea, spec, plan, deferred heading, commit or known gist; gist in English, one line; quotes verbatim (any
  language), at most 3 lines; `effort` the OID of the matching initiative or empty; reply with a JSON array only.
  `ParseReply(s string) ([]RawIdea, error)` strips a fence and refuses anything that is not an array.
- **Run** in `wshserver_sessionideasscan.go`: one haiku call per session through `consult.RunClaude(ctx,
  wavebase.HeadlessAgentCwd(), prompt, consult.CallOpts{Model: "haiku", ExtraArgs: []string{"--setting-sources=",
  "--no-session-persistence", "--disable-slash-commands"}}, nil)` (`pkg/consult/exec.go:66`, `CallOpts` at
  `consult.go:380`; `consult.Run` returns no usage), the extra args those `pkg/chatsuggest/chatsuggest.go` passes. The tokens are the returned `Usage.TotalTokens` (the Complete event's `Tokens`,
  `pkg/consult/consult.go:150`), summed into `Scan.Tokens`.
- **Fixture deps** in `sessionIdeasScanDeps()`: while `sessionIdeasFixture()` is on, `Candidates` returns the seeded
  sessions as `DigestSession`s, `Read` returns one canned user turn for any path, `Run` returns the seeded `Reply`
  (default `[]`) with 1000 tokens, `ProjectContext` an empty one. Nothing reads `~/.claude` or calls a model.
- **ScanNow**: `opts.Paths` when given (each still passed through `Eligible` and `SkipContent`), else every eligible
  candidate (the rule at the top of the plan); nearest deletion first; `Scan` progress in the store after each
  session; a model error stops the scan with `Error` and `StoppedAt` (the next scan goes on from there); each session
  ends with a mark (outcome `ideas` / `nothing` / `skipped`); ideas get `FoundTs`, `DeletesTs` (from the candidate's
  mtime + 90 days until Task 5 reads the setting), state `review`; `NewIdeas` counts this scan's ideas. At the scan's
  end, stopped part way or not, `LastScanTs` is set to now; `FirstScanDone` is set when a scan that was not `Forced`
  ends.
- Tests with a fake `Run`: `go test ./pkg/sessionideas -run 'TestEligible|TestSkipContent|TestPrompt|TestParseReply|TestScanNow'`
  (eligibility, a marker session and an empty digest get a `skipped` mark and no call, a grown session sends only new
  turns, a 529 stops with StoppedAt and keeps what was found, marks written, LastScanTs set, empty Paths reads every
  eligible candidate, dedupe against Known), and `go test ./pkg/wshrpc/wshserver -run 'TestSessionIdeasFixtureDeps'`
  (fixture deps never call the real Run).

### Task 5: The schedule, deletion days and the Storage card
**Depends on:** Task 3 (it changes the Get handler in `wshserver_sessionideas.go`, which Task 3 edits), Task 4
**Chunk:** Schedule: due 10 days before deletion (cleanupPeriodDays), DUM-E leftover window, forced at 7 days; Storage Sessions card scans before trash
**Files:** `pkg/sessionideas/schedule.go`, `pkg/sessionideas/schedule_test.go`, `pkg/sessionideas/claudesettings.go`, `pkg/sessionideas/claudesettings_test.go`, `pkg/sessionideas/sessions.go`, `pkg/sessionideas/sessions_test.go`, `pkg/sessionideas/scan.go`, `pkg/sessionideas/scan_test.go`, `pkg/wshrpc/wshserver/wshserver_sessionideas.go`, `pkg/wshrpc/wshserver/wshserver_sessionideasloop.go`, `pkg/wshrpc/wshserver/wshserver_sessionideasloop_test.go`, `cmd/server/main-server.go`, `pkg/storage/storage.go`, `pkg/storage/sessions.go`, `pkg/storage/sessions_test.go`, `frontend/types/gotypes.d.ts`, `frontend/app/view/agents/storagemodel.ts`, `frontend/app/view/agents/storagemodel.test.ts`, `frontend/app/view/agents/settingspages/storage.tsx`, `scripts/cdp/scenarios.mjs`

- `claudesettings.go`: `CleanupPeriodDays(path string) int` reads `cleanupPeriodDays` from `~/.claude/settings.json`
  (path seam; Claude Code's default 30 when absent; a parse error logs and returns 30). Read it per tick.
- `schedule.go` (pure): `DeletesAt(mtime, days)`; `DueAt = DeletesAt − 10 days`; `Plan(candidates, marks, now, days)
  (due, forced []string)` over the candidates `Eligible` (Task 4) keeps, so archived, still-written and already marked
  sessions (a `skipped` mark included) are never due or forced; forced is unscanned with ≤ 7 days left.
- `sessions.go`: `Sessions` now takes the candidates (`[]agentsessions.DigestSession`) and `cleanupPeriodDays` besides
  the data and now, and lists every candidate in the window with its `DeletesTs` and outcome as Task 1 defines them
  (`not-scanned` quiet and unscanned, `waiting` still being written; archived and `skipped` ones left out), plus the
  three counts (`Scanned`, `NotYet` = not-scanned + waiting, `LeavingSoon` = unscanned with ≤ 7 days left); the Get
  handler (`wshserver_sessionideas.go`) passes `agentsessions.ClaudeDigestCandidates` and `CleanupPeriodDays`, or the
  fixture sessions while fixture mode is on. `scan.go` uses `DeletesAt` with the real setting.
- `wshserver_sessionideasloop.go`: `StartSessionIdeasLoop(ctx)`, a tick every 5 minutes (DUM-E's `dumeTickEvery`,
  `wshserver_dume.go:43`: the leftover window is the stretch before a 5-hour reset, which an hourly tick can miss; the
  spec says so) that does nothing until `FirstScanDone` and nothing while fixture mode is on (`sessionIdeasFixture()`,
  Task 1); it starts its scans through Task 1's `startSessionIdeasScan` (the one guard: a tick that finds a scan
  running does nothing), with `Paths` always set to its forced list (`Forced: true`) or, failing that, its due list;
  forced sessions scan at once; due ones only when `dume.Decide`
  (`pkg/dume/gate.go:45`) with `Enabled: true, HasWork: true` says Start. Gather its inputs with the helpers
  `dumeTick` calls (`dumeQuota`, `dumePressure`, `dumeRuns`; `wshserver_dume.go:114-185`), not by extracting
  `dumeTick`'s body: `OwnRunsLive` counts every live top-level run (`runqueue.TopLevel`), DUM-E's included, so a scan
  never shares a window with DUM-E, and the loop keeps its own `ArmedReset`. It sets `NextScanTs` (the earliest DueAt).
  Started in `cmd/server/main-server.go` beside `sessionarchive.StartSweepLoop` (`:653`), behind
  `snapshotSkips("wshserver.StartSessionIdeasLoop")`, with that name added to `snapshotBootSkips` (`:94`), so a
  snapshot store never scans the real `~/.claude`.
- Storage (the spec's Storage card line; nothing scans inside a clean, which would hold the RPC for minutes):
  `StorageItem` (`pkg/storage/storage.go:52`) gains `Unscanned bool` (`json:"unscanned,omitempty"`), set in the
  sessions `measure` (`pkg/storage/sessions.go`) through a hook var the server sets
  (`storage.SessionUnscanned func(path string) bool`; storage does not import sessionideas; nil leaves it false); run
  `task generate`. The hook is true when the path has no mark of any outcome and `Eligible` would keep it (so a
  `skipped` session is not counted). `confirmFor`'s sessions case (`frontend/app/view/agents/storagemodel.ts:287`,
  pure) takes a `firstScanDone` argument and adds "K of them were never scanned for ideas" when K > 0, and, when
  `firstScanDone`, an alt action **Scan them first** (`ConfirmDialog`'s `altLabel`/`onAlt`,
  `frontend/app/modals/confirmdialog.tsx:37`; `confirmmodal.tsx` already passes them) that calls
  `SessionIdeasScanCommand{Paths: <the K ids>}` and moves nothing. `storage.tsx` reads `firstScanDone` with
  `SessionIdeasGetCommand` when it opens the sessions confirm (Settings does not mount Task 6's feed). Before the first
  scan the count is all it says.
- Acceptance: a `settings-storage` step (`scripts/cdp/scenarios.mjs:61165`; its transcripts are the scenario's own,
  written under `~/.claude/projects`): the sessions confirm names the count of its unscanned fixtures; with
  `sessionideasseed {Fixture: true, Data: {FirstScanDone: true}}` it shows Scan them first, and pressing it starts a
  scan under fixture mode (canned reply, no model call) and moves nothing; teardown seeds `{Clear: true}`.
- Tests: `go test ./pkg/sessionideas -run 'TestCleanupPeriodDays|TestPlan|TestSessions'`, `go test
  ./pkg/wshrpc/wshserver -run 'TestSessionIdeasLoop'` (nothing before FirstScanDone, nothing in fixture mode, nothing
  while a scan runs, forced ignores the gate, due waits for Start, a skipped session is never forced), `go test ./pkg/storage -run 'TestOldSessionsUnscanned'`, `npx vitest run frontend/app/view/agents/storagemodel.test.ts`.

### Task 6: The frontend store, model and agent launches
**Depends on:** Task 1 (the generated RPC client, types and event)
**Chunk:** Discuss (sonnet, idea's project) and Go through N (sonnet, No folder), stamped so the scan skips them
**Files:** `frontend/app/view/jarvis/sessionideasstore.ts`, `frontend/app/view/jarvis/sessionideasmodel.ts`, `frontend/app/view/jarvis/sessionideasmodel.test.ts`, `frontend/app/view/jarvis/sessionideaslaunch.ts`, `frontend/app/view/jarvis/sessionideaslaunch.test.ts`, `frontend/app/view/jarvis/address.ts`, `frontend/app/view/jarvis/address.test.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`

- Store (as `briefdumestore.ts` does it): `sessionIdeasAtom`, `ensureSessionIdeasFeed()` (subscribe to
  `sessionideas:changed` first, then read with `SessionIdeasGetCommand`). The event carries no data (Task 1), so each
  event re-reads with `SessionIdeasGetCommand`: one read in flight, at most one more queued behind it, and a reply
  older than the newest one sent never overwrites the atom. `sessionIdeasFocusAtom` (set to ask the Brief to scroll to
  the region); actions `keepIdea`, `dropIdea`, `markSeen`, `snooze`, `scanNow`, `stopScan`.
- **The `sessionideas` address** (every cross-surface open goes through `openref.ts`, AGENTS.md): a new kind
  `{ kind: "sessionideas" }` in `address.ts`'s union and parser (the ref `sessionideas`), opened in `openref.ts`'s
  `openAddress` by switching to Jarvis and setting `sessionIdeasFocusAtom`. `openSessionIdeas(model)` in the store is
  `openAddress` on that address, never a hand-rolled surface switch.
- The feed pushes one toast (`pushToast`, `frontend/app/cockpit/notificationstore.ts:53`) when a scan ends with
  `NewIdeas > 0`: "Session scan: N ideas to review, from M sessions", with a Review action that calls
  `openSessionIdeas`. The transition test is pure: `scanEndToast(prev, next)`. The live check is Task 9's scan-end
  toast step (Task 9 mounts the feed in the pet).
- Model (pure): `reviewRows(data)` (ideas in review, the one deleted soonest first), `coverage(data)`, `chipsFor(data,
  now)` (What's waiting?, Go through N with an agent, Discuss: <gist of the first row>, and Which lose their transcript
  soon? only while one does), `ideaChipLogLine(chip, position)` in the shape of `chipPickLogLine`
  (`frontend/app/view/agents/chatsuggest.ts:359`).
- Launches (`sessionideaslaunch.ts`): `discussIdea(model, idea)` opens a claude agent in the idea's project and
  `goThroughIdeas(model, ideas)` one in No folder (the path the launcher's No folder row uses,
  `frontend/app/view/agents/launcher.ts:221`), both through `launchAgent` (`frontend/app/cockpit/cockpit-actions.ts:97`)
  with `extraArgs: ["--model", "sonnet"]` as `frontend/app/view/agents/pairlaunch.ts:49` passes its model, and a
  `label`. The task text is pure (`discussPrompt`, `goThroughPrompt`): first line `[arc:session-ideas]`, then the gist,
  the quotes, the initiative, the source session ("read more with `wsh read session:<id>`; never resume it"), and how to
  record a decision (`wsh sessionideas keep <id> [--label …]` / `drop <id>`). `launchedFor(ideaId)` remembers the tab
  so the row reads Go to agent while it is open.
- **Launch hook** (DEV only, as `jarvisroutestore.ts`'s hook, `:166`): while a scenario sets it, `discussIdea` and
  `goThroughIdeas` record `{kind, ideaIds, projectPath, task}` and give `launchedFor` a fake tab id, opening no agent.
  Every scenario step that presses Discuss or Go through sets it first.
- Tests: `npx vitest run frontend/app/view/jarvis/sessionideasmodel.test.ts frontend/app/view/jarvis/sessionideaslaunch.test.ts frontend/app/view/jarvis/address.test.ts frontend/app/view/jarvis/openref.test.ts`.

### Task 7: The Waiting line after 7 days
**Depends on:** Task 1 (reads the store's SeenTs, SnoozedUntil and ideas), Task 6 (Review opens the `sessionideas` address it adds)
**Files:** `pkg/jarvis/attention.go`, `pkg/jarvis/attention_test.go`, `frontend/app/view/jarvis/briefingmodel.ts`, `frontend/app/view/jarvis/briefingmodel.test.ts`, `frontend/app/view/jarvis/attentionact.ts`, `frontend/app/view/jarvis/attentionact.test.ts`, `frontend/app/view/jarvis/petacts.ts`, `frontend/app/view/jarvis/petacts.test.ts`, `frontend/app/view/jarvis/petpeekmodel.ts`, `frontend/app/view/jarvis/petpeekmodel.test.ts`, `frontend/app/view/agents/needsyoustripmodel.ts`, `frontend/app/view/agents/needsyoustripmodel.test.ts`, `frontend/app/cockpit/palette-needs.ts`, `frontend/app/cockpit/palette-needs.test.ts`, `frontend/app/cockpit/sidecarneeds.ts`, `frontend/app/cockpit/command-palette.tsx`

- `AttentionSessionIdeas = "session-ideas"` beside `AttentionPlanReview` (`pkg/jarvis/attention.go:52`); a producer
  like `planReviewItems` (`:629`) reading the store: one item when ideas wait in review, `now − max(SeenTs, oldest
  FoundTs) ≥ 7 days` and `now ≥ SnoozedUntil`; text "N ideas from your sessions, waiting D days", detail the gists
  joined by " · ". It counts in the badge like the other items.
- Frontend: label "Ideas" (`petpeekmodel.ts:55`), briefing kind word `ideas` in both of `briefingmodel.ts`'s kind
  switches (the QueueRow one, `:208`, and `kindWord`, `:383`, whose default is `blocked`), two acts: Review (the
  `sessionideas` address Task 6 adds, through `openAddress`) and Next week (the `snooze` mark). The other readers of
  attention kinds learn it: `palette-needs.ts`'s `KIND_GROUP` (`:27`; an unknown kind falls to Blocked, `:77`) maps
  `session-ideas` to `reviews`; the command palette's (`command-palette.tsx:214`) and `sidecarneeds.ts`'s (`:63`)
  labels name it "Ideas"; `needsyoustripmodel.ts`'s `KIND_LABEL` (`:17`; an unknown kind is dropped from the Cockpit
  strip, `:135`) gains `"session-ideas": "Ideas"`. Two readers live in files other tasks own: `briefrows.ts`'s
  `REMINDER_KINDS` (Task 8) and `petpeek.tsx`'s `ROW_DOT` (Task 9). `notifyevents.ts`'s `DECISION_KINDS` stays as it
  is: a waiting idea is a reminder, not a decision.
- Tests: `go test ./pkg/jarvis -run 'TestSessionIdeasAttention'` (none under 7 days, none while snoozed, seen resets
  the clock), `npx vitest run frontend/app/view/jarvis/petpeekmodel.test.ts frontend/app/view/jarvis/attentionact.test.ts frontend/app/view/agents/needsyoustripmodel.test.ts frontend/app/view/jarvis/briefingmodel.test.ts frontend/app/cockpit/palette-needs.test.ts`.
- Acceptance: the `sessionideas-pet` scenario's step "waiting line" (Task 9, which waits on this task, owns that
  module; name the step in your report's For later tasks section with what it should show).

### Task 8: The Brief's From your sessions region
**Depends on:** Task 6 (the store, the model's rows and coverage, the launches)
**Chunk:** Brief region From your sessions: Keep / Drop / Discuss, What was said, Sessions scanned fold
**Files:** `frontend/app/view/jarvis/sessionideasregion.tsx`, `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/jarvis/briefrows.ts`, `frontend/app/view/jarvis/briefrows.test.ts`, `scripts/cdp/sessionideas-brief-scenarios.mjs`

Board `Brief-Region`. Between the Initiatives section (closes at `briefsurface.tsx:2216`) and the Ideas / For later row
(`:2217`), with the Brief's own region header (`REGION_LABEL`, count, "scanned <date> · next by <date>", Scan now,
Go through N with an agent, `OnlyButton` `:280`). The scanned line names the last scan's tokens beside its date
("scanned Nov 24 · 210k tokens · next by Dec 1", from `Scan.Tokens`).

- Rows: lightbulb, gist, initiative or "New idea · <project>", **What was said** (springReveal: the quotes, the source
  session with Open session, the day its transcript is deleted), Discuss / ● Go to agent, Keep, Drop (the row leaves on
  springReveal). Keep of a new idea shows it in the Ideas column on the next read.
- States: before the first scan the offer card (Scan-States board 1: what it reads, "haiku · about N tokens for M
  sessions", M the `not-scanned` rows of `Sessions` (Task 1) and N from M, Scan my sessions, Not now), shown under the Ideas column; scanning (progress "Reading
  session d of t", Stop, rows arriving); stopped part way (error line with Retry, what was found stays); sessions
  leaving soon unscanned (warning line with the count and day); nothing found ("Nothing left open in the sessions
  scanned so far.").
- **Sessions scanned** fold at the region's end: coverage bar (scanned, not yet, leaving within 7 days, each in the
  legend with its count, not colour alone), then each session with its outcome; springReveal.
- The Waiting line's kind (Task 7's `session-ideas`) joins `REMINDER_KINDS` (`briefrows.ts:121`), so `queueTone`
  draws it muted, not with the error tone an unknown kind gets (`:127`).
- Since you looked: a `sessions` kind in `sinceSections` (`briefrows.ts:751`, `SinceKind` `:707`): "Scanned N
  sessions: K ideas to review" with Review.
- Opening the region (or the Review in Since you looked) calls `markSeen`; `sessionIdeasFocusAtom` scrolls to it.
- Tests: `npx vitest run frontend/app/view/jarvis/briefrows.test.ts` (the `session-ideas` kind's muted tone among them).
- Acceptance: `sessionideas-brief` steps (seeded with `sessionideasseed` in fixture mode; Discuss and Go through under
  Task 6's launch hook): region with rows, which also makes the What's new picture with `await
  h.whatsnewShot("session-ideas", { selector: <the region> })` (`scripts/cdp/whatsnewshot.mjs:71`; Task 10's
  CHANGELOG line names it); What was said open; Keep (row leaves, the new idea in Ideas); Drop; Discuss reads Go
  to agent; the header's Go through N with an agent (the hook recorded one No-folder launch); Scan now (fixture mode with
  one `not-scanned` fixture session and the default `[]` reply: the scanned line's date and tokens update, no model
  call, no real transcript read); Sessions scanned open; first-scan offer (seed
  `FirstScanDone: false`, no ideas); scanning; stopped part way; leaving-soon line; Since you looked's Sessions row.

### Task 9: Sprout's popup line, its chips, and Jarvis's prompt
**Depends on:** Task 6 (the store, `chipsFor`, `ideaChipLogLine`, the launches, the `sessionideas` address), Task 7 (writes the Waiting line step its For later note names)
**Chunk:** Sprout popup: the ideas line and its fixed chips (What's waiting, Go through, Discuss, Leaving soon) with a log line per press; ideas in buildRoutePrompt for typed questions
**Files:** `frontend/app/view/jarvis/petideas.tsx`, `frontend/app/view/jarvis/petpeek.tsx`, `frontend/app/view/jarvis/petview.tsx`, `frontend/app/view/jarvis/jarvisroute.ts`, `frontend/app/view/jarvis/jarvisroute.test.ts`, `frontend/app/view/jarvis/jarvisroutestore.ts`, `scripts/cdp/sessionideas-pet-scenarios.mjs`

Board `Jarvis-Ask`.

- `petideas.tsx`: under the updates strip (`petpeek.tsx:598`), "N ideas from your sessions to review · Review in
  Jarvis" (Review in Jarvis opens the `sessionideas` address Task 6 adds), then the chips from `chipsFor`; What's waiting? and Which lose their transcript soon? open the list in place
  (springReveal), Go through and Discuss launch (Task 6) and show the started line with Go to agent. Each press sends
  `ideaChipLogLine` with `getApi().sendLog`. Not a queue row: no badge. Hidden with nothing in review.
- `petpeek.tsx`'s `ROW_DOT` (`:153`) gains `"session-ideas": "bg-muted"`, the reminder's quiet dot `bug-reports` has.
- `petview.tsx` calls `ensureSessionIdeasFeed()` (the pet is always mounted, so the toast fires on any surface).
- `RouteWorld` (`jarvisroute.ts:42`) gains `ideas: {id, gist, project, initiative}[]`, filled in `routeWorld`
  (`jarvisroutestore.ts:113`); `buildRoutePrompt` (`:72`) lists them under "Ideas from your sessions, waiting for a
  decision".
- Typed "go through" / "discuss" jobs: the `arc-route` verdict (`RouteVerdict`, `jarvisroute.ts:25`) gains
  `ideas?: "go-through" | "discuss"` and `idea?: string` (a listed idea's id), and the prompt tells Jarvis to set them
  for such a job instead of a project or agent; the verdict-to-action rule gains
  `{ kind: "ideas"; op: "go-through" | "discuss"; ideaId?: string; reason: string }` (`RouteAction`, `:37`; a discuss
  naming no listed idea is a question back); `jarvisroutestore.ts` carries it out with `goThroughIdeas` /
  `discussIdea`, so the agent is sonnet and carries the `[arc:session-ideas]` marker, never through `applyLaunch`
  (`:217`). Under the route hook (`:166`) it records and opens nothing, as `applyLaunch` does.
- Tests: `npx vitest run frontend/app/view/jarvis/jarvisroute.test.ts` (the prompt lists the ideas; a go-through and a
  discuss verdict become the ideas action; a discuss on an unknown id does not).
- Acceptance: `sessionideas-pet` steps (seeded in fixture mode; presses under Task 6's launch hook): popup with the line and four chips; What's
  waiting? open; Which lose their transcript soon? (seed one idea deleted within 7 days); Go through shows the started
  line with Go to agent; Discuss: <gist> shows its started line; the scan-end toast (seed a running scan, then the same
  scan ended with `NewIdeas: 2`: the toast with Review); a typed "duyệt giúp tôi" on a canned route reply under the
  route hook (the ideas action recorded); the Waiting line from Task 7 (seed `SeenTs` and `FoundTs` 8 days back) with
  Review (Jarvis opens on the region) and Next week (the line leaves).

### Task 10: Docs
**Depends on:** Task 2 (its For later note), Task 3 (documents `wsh sessionideas`), Task 5 (documents the schedule), Task 7 (documents the Waiting line), Task 8 (documents the region), Task 9 (documents the popup)
**Files:** `docs/guide/jarvis.md`, `docs/guide/agent-integration.md`, `CHANGELOG.md`, `docs/open-issues.md`, `docs/hand-checks.md`

- `docs/guide/jarvis.md`: a "From your sessions" section (what is scanned and when, nothing before Scan my sessions,
  Keep / Drop / Discuss / Go through, Sessions scanned, the Waiting line, Sprout's chips), in Vietnamese like the rest
  of the guide.
- `docs/guide/agent-integration.md`: `wsh sessionideas` in the command table.
- `CHANGELOG.md`: one Added line for the region and popup, with `<!-- big -->`, and one Changed line for search
  reaching 90 days (`docs/reference/dev-workflow.md` "CHANGELOG markup"). End the big line with `<!-- shot: none -->`:
  the picture is made by Task 8's scenario step during Final, and `frontend/app/cockpit/whatsnew.test.ts` fails a
  `shot:` naming a file that is not in `public/whatsnew/` yet. After Final the lead swaps in
  `<!-- shot: <version>-session-ideas.webp -->` and commits the picture with it. Run `npx vitest run
  frontend/app/cockpit/whatsnew.test.ts`.
- `docs/open-issues.md`: RAM watch rows "(arcterm) Session digests at 90 days" and "(arcterm) First session scan's
  tokens", both not measured yet, with the command that measures each.
- `docs/hand-checks.md`: a `- [ ]` line per motion no scenario watches (What was said opening, a row leaving on Keep,
  the chips' list opening), each titled "(arcterm) …".
