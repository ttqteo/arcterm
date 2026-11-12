# Measured job peaks (heavy-job queue)

> Builds `docs/superpowers/specs/2026-11-12-measured-job-peaks-design.md`. Read the whole spec first, its
> "Build decisions" section included: it settles every call this plan relies on (one meter for slotted and unslotted
> commands, the worktree → main checkout project key, what the store keeps, `jobqueue.Basis`, the popover wording).

**Effort:** effort:c12d047a-2bfa-4bfb-97bd-a60f4d4ebe07
**Spec:** `docs/superpowers/specs/2026-11-12-measured-job-peaks-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/memgate/... ./pkg/job... ./pkg/memusage/... ./pkg/resmon/... ./pkg/wshrpc/... ./cmd/wsh/... ./cmd/server/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs jobqueue-measured`

Shape: Tasks 1, 3 and 4 are small interfaces that start at once; the long work (2, 5, 6, 7) runs beside each other on
top of them, and Task 8 wires it together. Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target
x86_64-windows-gnu"` in front (Bash), see AGENTS.md. Never hand-edit generated files: change the Go type, then
`task generate`. Every test named in an acceptance below is new unless it says otherwise: write it.

### Task 1: the learned file
**Depends on:** none
**Files:** `pkg/memgate/learned.go`, `pkg/memgate/learned_test.go`

The file wsh and wavesrv share (spec "How wsh learns it"): `{"patterns": ["make build", …]}`.

Interface (exact):
```go
const LearnedBytes uint64 = 1 << 30 // the "turns heavy" threshold, and a learned job's figure before wavesrv's estimate
// LearnedPath is <home>/.arc/jobslot-learned.json.
func LearnedPath(home string) string
// ReadLearned: a missing, unreadable or broken file is an empty, non-nil set.
func ReadLearned(path string) map[string]bool
// WriteLearned writes the patterns sorted, to a temp file in the same dir (created if missing), then renames it over path.
func WriteLearned(path string, patterns []string) error
```

Acceptance: `go test ./pkg/memgate -run 'TestLearnedFile'`: a write then read round-trips; a missing file and a file
of `{not json` both read as empty; a second write replaces the first.

### Task 2: memgate patterns and the learned check; wsh reads the file
**Depends on:** Task 1 (LearnedBytes, LearnedPath, ReadLearned)
**Files:** `pkg/memgate/memgate.go`, `pkg/memgate/memgate_test.go`, `cmd/wsh/cmd/wshcmd-jobslot.go`, `cmd/wsh/cmd/wshcmd-jobslot_test.go`

Decisions:
- A program memgate "has a rule for" is any name `classifyStep` switches on (`task`, `npm`, `pnpm`, `uv`,
  `python`/`python3`/`py`, `npx`, `node`, `cargo`, `go`) or `classifyTool` knows (`vitest`, `vite`, `tsc`, `tauri`,
  `pytest`, `py.test`, `astro`, `playwright`, a `*.sh` script). Keep that list in one place both the classifier and
  `Pattern` read, so they cannot drift.
- `sh`/`bash`/`zsh` with `-c` is not a program of its own: `Pattern` and `ClassifyWith` recurse into its command line,
  exactly where `classifyStep` recurses (spec, Keys, as amended).
- Steps that do no work, dropped before a pattern is taken: `cd`, `pushd`, `popd`, `export`, `set`, `source`, `.`,
  `echo`, and the pipeline tails `tail`, `head`, `grep`, `tee`, `wc`, `sort`, `less`.
- An unknown step's pattern is its program's base name (`.exe` trimmed) plus its first word that is not a flag, past
  `program`'s wrapper stripping (`make build`, `gradle build`); a bare `make` is `make`.

Interface (exact):
```go
// Pattern is the key a command's measured peak is kept under. known: its one working step is a heavy table job and
// name is that job's Name. Otherwise name is the unknown step's pattern. ok false: no working step, more than one,
// or a program memgate has a rule for that it calls light (go test -run X).
func Pattern(command string) (name string, known bool, ok bool)
// ClassifyWith is Classify, plus any step whose unknown-program pattern is in learned reads heavy as
// Job{Name: pattern, Bytes: LearnedBytes}; the heaviest step wins as in Classify. nil learned is Classify.
func ClassifyWith(command string, learned map[string]bool) (Job, bool)
```

wsh: `jobslotTakesSlot`, `--heavy`, `jobslotTurn` and the missed-bypass note classify with
`memgate.ClassifyWith(command, memgate.ReadLearned(<learned path>))`, the file read once per wsh run; no home
directory reads as an empty set. Put the path behind a package var so tests point it at a temp file. A light command
still makes no connection.

Acceptance:
- `go test ./pkg/memgate -run 'TestPattern|TestClassifyWith'`: `cd web && make build 2>&1 | tail -5` → (`make build`,
  unknown, ok); `bash -c "make build"` and `/bin/zsh -c -l "make build"` → (`make build`, unknown, ok); `task check:ts`
  → (`task check:ts`, known, ok); `make build && gradle test` → not ok; `go test ./pkg/x -run X`, `pnpm build` (a
  ruled program) and `npx vitest run foo.test.ts` → never an unknown pattern; `echo hi` → not ok;
  `env FOO=1 nice -n 5 gradle build --info` → `gradle build`. `ClassifyWith("cd x && make build", {"make build"})` is
  heavy with `LearnedBytes`; `ClassifyWith("bash -c 'make build'", {"make build"})` too; `go test -run X` stays light
  whatever the learned set holds.
- `go test ./cmd/wsh/cmd -run 'TestJobslotLearned'`: a learned pattern takes a slot; a missing or broken learned file
  leaves an unknown command light.

### Task 3: the figure's basis on the queue and on the wire
**Depends on:** none
**Files:** `pkg/jobqueue/jobqueue.go`, `pkg/jobqueue/jobqueue_test.go`, `pkg/wshrpc/wshrpctypes_jobqueue.go`, `pkg/wshrpc/wshserver/wshserver_jobqueue.go`, `pkg/wshrpc/wshserver/wshserver_jobqueue_test.go`, `frontend/types/gotypes.d.ts`

Decision: `Job` must stay comparable (`evaluate` compares snapshots with `slices.Equal`), so the peaks are a fixed
array whose length is the spec's "last 5", defined here once. A Basis is fixed at `Acquire`, like `Bytes`.

Interface (exact):
```go
// in pkg/jobqueue
type Basis struct {
	Measured  bool
	Elsewhere bool      // measured only in another project
	Peaks     [5]uint64 // the kept peaks, newest first; 0 = none
}
// Request gains: Basis Basis
```
Wire: `wshrpc.JobQueueJob` gains `Measured bool json:"measured,omitempty"`, `Elsewhere bool
json:"elsewhere,omitempty"`, `Peaks []uint64 json:"peaks,omitempty"` (the non-zero peaks, newest first);
`JobQueueData` fills them. Run `task generate` so `frontend/types/gotypes.d.ts` carries them. Nothing sets a Basis yet.

Acceptance:
- `go test ./pkg/jobqueue -run 'TestBasisReachesTheSnapshot'`: a job acquired with a Basis shows it unchanged in
  `Snapshot().Jobs`.
- `go test ./pkg/wshrpc/wshserver -run 'TestJobQueueDataBasis'`: `Basis{Measured: true, Peaks: [5]uint64{3, 2}}` comes
  out `Measured: true, Peaks: [3, 2]`; a job with no basis leaves all three empty.

### Task 4: the meter's interface
**Depends on:** none
**Files:** `pkg/jobmeter/jobmeter.go`

The types Task 8 wires against, with a `Run` that only blocks until ctx ends; Task 5 fills it in.

Interface (exact):
```go
package jobmeter
type Agent struct{ BlockId string; Pid int32 } // the agent's own process (memusage.AgentPid), not the block's root
type Done struct{ BlockId, Command string; Peak uint64 }
type Config struct {
	Agents func(t memusage.Table) []Agent // the agents to watch, given this poll's table
	OnDone func(Done)                     // a measured command ended; called outside any lock
	Poll   time.Duration                  // 0 is 2 s
}
func Run(ctx context.Context, cfg Config) // blocks until ctx ends
```

Acceptance: `go build ./pkg/jobmeter` and `go vet ./pkg/jobmeter` pass.

### Task 5: the meter: sample each Bash-tool command's process tree
**Depends on:** Task 4
**Files:** `pkg/jobmeter/jobmeter.go`, `pkg/jobmeter/jobmeter_test.go`, `pkg/memusage/memusage.go`, `pkg/memusage/memusage_test.go`, `pkg/memusage/footprint_windows.go`, `pkg/memusage/footprint_windows_test.go`, `pkg/memusage/footprint_darwin.go`, `pkg/memusage/footprint_other.go`, `pkg/resmon/shelltask.go`, `pkg/resmon/shelltask_test.go`, `pkg/resmon/shelltask_windows_test.go`, `pkg/resmon/sample_windows.go`, `pkg/resmon/sample_other.go`, `docs/open-issues.md`

Decisions:
- `memusage.JobFootprint(pid int32) (uint64, bool)`: private bytes (`privateUsage`, the commit) on Windows, the
  physical footprint on darwin (the existing `footprint`), the resident set elsewhere. The Consumers panel's
  `footprint` stays as it is.
- `memusage.Table.Children(pid int32) []int32`, so the meter looks only at each agent's direct children.
- From `pkg/resmon`, export what the meter reuses rather than copying it: the MSYS table read (`parseMsysPs`,
  `msysGroupPids`, the `ps.exe`-beside-the-bash lookup), and a function that takes a shell's argv and returns the
  command its `-c` script evals (`eval '<cmd>' < /dev/null`, undoing `shQuote`). The script is the first operand after
  `-c`, short flags such as `-l` skipped: Windows starts `bash.exe -c "<script>"`, macOS and Linux
  `<shell> -c -l <script>`. `isTaskProcess` uses the same function. Also export an argv reader for any pid that works
  per OS: resmon's own reader on Windows (`sample_windows.go`), gopsutil's `CmdlineSlice` elsewhere (`sample_other.go`,
  whose `readCmdline` returns "").
- The meter unwraps the arc mod's background wrapper (`'<wsh>' jobslot --hold-parent -- '<cmd>'; [ $? -ne 75 ] ||
  exit 75\n<cmd>`, see `claude/arc-mod/hooks/jobslot-core.ts` `heldOriginal`) and reports `<cmd>`.
- Each process's argv is read once (cache by pid, drop it when the pid leaves the table). The MSYS `ps -l` runs at most
  once per poll, only on Windows and only while at least one command is being measured.
- A command never sampled is not reported. A tracked shell whose parent is no longer its agent counts as gone (pid
  reuse).
- Keep the per-poll step a pure function over injected seams (table, argv reader, footprint, MSYS group), so tests
  script it with no real processes.

Acceptance:
- `go test ./pkg/jobmeter -run 'TestMeter'`: a scripted shell child of an agent with two descendants is reported once,
  after it leaves the table, with the largest per-poll sum; a `[/bin/zsh -c -l <script>]` child is matched like a
  `[bash.exe -c <script>]` one; a held background command is reported as its inner command; a child that is not a
  Bash-tool shell, a command gone before its first sample, and a child of a pid that is not an agent are not
  reported; MSYS group members' trees are added to the sum when the group seam returns them.
- `go test ./pkg/resmon -run 'TestIsTaskProcess|TestEvalCommand|TestParseMsysPs|TestMsysGroupPids'`, with a
  `TestEvalCommand` case for `[/bin/zsh -c -l <script>]` (existing tests keep passing under their exported names).
- `go test ./pkg/memusage -run 'TestChildren|TestJobFootprint'` (the Windows one reads this process's private bytes
  as non-zero).
- Poll cost (spec "Left to the builder"): measure one poll's CPU time on this Windows machine over the live process
  table with at least one Git Bash command measured (a test skipped unless `ARC_MEASURE_JOBMETER=1`, run once by
  hand), and add the figures (table read, footprints, `ps -l`) under "RAM watch" in `docs/open-issues.md`, titled
  "(arcterm) …".

### Task 6: the peak store and the learned file writer
**Depends on:** Task 1 (WriteLearned, LearnedBytes), Task 3 (jobqueue.Basis)
**Files:** `pkg/jobpeaks/jobpeaks.go`, `pkg/jobpeaks/jobpeaks_test.go`

Decisions, from the spec's rules and its "Build decisions": max of the kept peaks × 1.2; at most `len(Basis{}.Peaks)`
kept per (pattern, project); a known run always kept; an unknown run kept only at `memgate.LearnedBytes` or more, or
when the pattern is already stored; an unknown pattern whose kept peaks are all under the threshold in every project
leaves the store; the "any project" max is computed from the keys; a key idle 30 days is dropped (at load and on each
record). `jobpeaks.json` is rewritten (temp + rename) after each record; the learned file (unknown patterns only) is
rewritten through `memgate.WriteLearned` when its set changes and once at Open, never when its path is "". A missing
`jobpeaks.json` is an empty store; a broken one is logged and read as empty. Safe for concurrent use.

Interface (exact):
```go
package jobpeaks
const Threshold = memgate.LearnedBytes
var Default *Store // wavesrv's; nil means no measurement (tests, wsh)
func Open(path, learnedPath string, now func() time.Time) *Store // learnedPath "" never writes it
func (s *Store) Record(pattern, project string, known bool, peak uint64)
// Estimate is the figure to admit on and its basis: the key's kept max × 1.2; else, for a learned unknown pattern,
// the max over its other projects × 1.2 (Elsewhere, Peaks those of the project holding the max); else table.
func (s *Store) Estimate(pattern, project string, table uint64) (uint64, jobqueue.Basis)
func (s *Store) Learned() map[string]bool // the unknown patterns that read heavy now
```

Acceptance, `go test ./pkg/jobpeaks -run 'TestEstimate|TestRecord|TestLearned|TestExpiry|TestPersist'`:
- the max-of-5 × 1.2 rule (six records keep the last five; one cold 2.5 GB among four 0.8 GB runs gives 3 GB);
- no key → the table figure, not measured;
- an unknown 1.2 GB run makes the pattern learned and writes it to the learned file; a 0.5 GB run of an unstored
  unknown pattern stores nothing; five light runs after a heavy one take it out of the store and the file;
- a learned pattern never run in project B estimates from project A, `Elsewhere` true;
- a key idle 31 days (scripted `now`) is gone after Open, and its pattern leaves the learned file;
- a store reopened from `jobpeaks.json` gives the same estimates; a broken file opens empty.

### Task 7: the popover says measured or estimate
**Depends on:** Task 3 (the generated JobQueueJob fields)
**Files:** `frontend/app/cockpit/jobqueue.ts`, `frontend/app/cockpit/jobqueue.test.ts`, `frontend/app/cockpit/jobqueuepanel.tsx`, `scripts/cdp/scenarios.mjs`

Decisions (spec "Build decisions", popover wording): the figure keeps its place and a muted word follows it,
"measured" or "est."; the size's tooltip (today "Its peak RAM") becomes the rule and the peaks:
"2.1 GB: max of the last 3 runs × 1.2 (1.8, 1.2, 0.9 GB)", for `elsewhere`
"2.1 GB: measured in another project, max of its last 5 runs × 1.2 (…)", else "3 GB: estimate (not measured yet)".
One run reads "the last run", not "the last 1 runs". Use `formatGB` and DESIGN.md tokens; no raw colors.

Interface: a pure `sizeLabel(job: JobQueueJob): { text: string; tag: string; title: string; measured: boolean }` in
`jobqueue.ts`, used by `Row` in `jobqueuepanel.tsx`; the tag carries `data-job-basis="measured"|"estimate"`.

Acceptance:
- `npx vitest run frontend/app/cockpit/jobqueue.test.ts`: measured with 3 peaks, measured with 1 peak, elsewhere and
  estimate give the exact tooltips above.
- New CDP scenario `jobqueue-measured` in `scripts/cdp/scenarios.mjs`, registered with the others: injects through
  `window.__jobQueueInject` one running measured job (`measured: true, peaks: [...]`) and one queued estimated job,
  opens the Jobs popover from the app bar chip (as `jobqueue-chip` does), takes a shot, and asserts one row's tag reads
  "measured" with the max-of-the-last-runs tooltip and the other "est." with "estimate (not measured yet)"; teardown
  clears the injection. Run it with `task verify:ui -- jobqueue-measured` against a dev app if your tree can start one;
  Final runs it either way.

### Task 8: wire it into wavesrv
**Depends on:** Task 2 (ClassifyWith, Pattern), Task 3, Task 4 (the meter's interface), Task 6 (the store)
**Chunk:** Measure each heavy job's real RAM peak instead of the fixed memgate table: sample the job's process tree peak when its slot is released, keep it per command + project, use it next time (table stays the fallback); today tsc on a small repo still claims 3 GB and unknown builds never queue
**Files:** `cmd/server/main-server.go`, `pkg/wshrpc/wshserver/wshserver_jobqueue.go`, `pkg/wshrpc/wshserver/wshserver_jobqueue_test.go`, `pkg/wshrpc/wshserver/wshserver_jobpeaks.go`, `pkg/wshrpc/wshserver/wshserver_jobpeaks_test.go`, `CHANGELOG.md`, `docs/hand-checks.md`, `docs/guide/usage.md`, `AGENTS.md`

Decisions:
- `jobProject(ctx context.Context, blockId string) string`, in `wshserver_jobpeaks.go`: the block's `cmd:cwd` meta,
  walked up to the first `.git`; a `.git` file's `gitdir: …/.git/worktrees/<name>` resolves to the main checkout that
  owns it. File system only, no git process; cached per cwd. No block, no cwd or no repo → "" (the "no project" key).
- The meter's `Agents`: the live agent blocks as `GetConsumersCommand` finds them (roster rows → `consumerBlockPid` →
  `memusage.AgentPid` on the poll's table), with the roster read at most every 10 s, not every poll.
- `OnDone`: `memgate.Pattern(command)`; when ok, `jobpeaks.Default.Record(pattern,
  jobProject(context.Background(), blockId), known, peak)`.
- Startup (`main-server.go`, beside `startJobQueue`): `jobpeaks.Default = jobpeaks.Open(<data dir>/jobpeaks.json,
  learnedPath, time.Now)`, `learnedPath` being `memgate.LearnedPath(home)` unless `wavebase.NoGlobalInstall()`, then
  ""; start `jobmeter.Run` in a goroutine under `panichandler`.
- `JobSlotCommand`: classify with `memgate.ClassifyWith(command, jobpeaks.Default.Learned())` (nil store: plain
  `Classify`); for a heavy job, `bytes, basis := Default.Estimate(job.Name, jobProject(ctx, blockId), job.Bytes)` and
  queue `Request{Name, Bytes: bytes, Basis: basis, …}`. Every caller gets the estimate, pi's included (spec, as
  amended). A known command queues whatever its estimate.
- Docs: CHANGELOG under `Unreleased` → `Changed`, written for the user (the queue learns each heavy job's real RAM and
  starts queueing unknown builds that turn out heavy; the Jobs popover says measured or est.). `docs/hand-checks.md`:
  one `- [ ]` line, "(arcterm) …", for the live check on Windows and on the Mac (run `task check:ts` twice in an
  agent; the second row reads measured with the first run's peak × 1.2; a `make`-style build over 1 GB queues on its
  next run). `docs/guide/usage.md` (~line 265, Vietnamese, keep its language) and the AGENTS.md bullet "A heavy shell
  command waits its turn" say the table is the fallback: a measured peak replaces it, and unknown commands measured at
  1 GB or more queue too.

Acceptance, `go test ./pkg/wshrpc/wshserver -run 'TestJobSlotMeasured|TestJobProject|TestJobPeaksOnDone'`:
- with a store holding a 1 GB peak for (`task check:ts`, project P) and a block whose cwd is in P, `JobSlotCommand`
  queues `task check:ts` at 1.2 GB with `Measured`; with no store entry, at the table's 3 GB;
- a learned unknown pattern (`make build`) gets a slot and is queued; an unlearned one runs at once with no slot;
- `jobProject` maps a cwd in a linked worktree to the main checkout and a cwd outside any repo to "";
- the `OnDone` path records a known command, records a heavy unknown one, and records nothing for a compound
  (`make build && gradle test`).
