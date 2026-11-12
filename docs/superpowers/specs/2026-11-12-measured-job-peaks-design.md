# Measured job peaks (heavy-job queue)

Status: design, 2026-11-12. Initiative: "Heavy job queue follow-ups" (effort c12d047a), chunk 17.

## Intent

The heavy-job queue admits a job when free RAM covers the job's peak plus headroom. That peak today is a fixed
number per command in `pkg/memgate/memgate.go`, measured once on an 8 GB Mac and rounded up. Two things go wrong:

- **A known job claims too much.** `task check:ts` claims 3 GB on any repo, a small one included. Fewer jobs run at
  once than the machine allows.
- **An unknown build never queues.** A command that is not in the table (`make`, `pnpm build`, `gradle build`…)
  reads as light: `wsh jobslot` answers it locally and wavesrv never sees it. Several of them from several agents run
  at once and the machine swaps.

arcterm learns each heavy job's real peak and uses it the next time, for both kinds of command.

## Decisions

### Scope (answer 1)

Both kinds of command:

- A command in the memgate table uses its measured peak in place of the table's number.
- A command not in the table whose measured peak turns out heavy queues from its next run on.

### How a peak is measured (answer 2)

wavesrv samples the command's process tree. It finds the bash process Claude Code starts for a Bash-tool command
under the block's agent: the process whose `-c` script contains `eval '<command>' < /dev/null`, as
`pkg/resmon/shelltask.go` `isTaskProcess` already matches. Every ~2 s it reads the footprint of that process and all
its descendants with `pkg/memusage`:
- `ReadTable` to list the processes;
- `Table.Tree` to collect the tree;
- `Live().Footprint` for each process, which is the physical footprint on macOS. On Windows, read the private bytes
  (commit) instead of the private working set. Admission on Windows reads the commit charge, and Windows trims
  working sets under pressure, so peaks measured while RAM is tight would read low. This needs a new reader in
  `pkg/memusage`. (Agent's call, builder question 5.)

It keeps the largest sum as the run's peak.

**Windows and Git Bash (builder question 3).** Git Bash starts a task's real work (node, go, cargo) outside the bash's
Windows process tree: its fork exits, and only MSYS process groups tie that work back to the shell (see the comment
above `msysGroup` in `pkg/resmon/shelltask.go`). `Table.Tree(bash)` alone would miss most of the work.

So on Windows each 2 s poll reads the MSYS process table once with the `ps.exe` beside the task's bash (`ps -l`). It
reads it once for all the commands being measured, and only while at least one is. It adds each MSYS group member's
tree to the command's tree, reusing `msysGroupPids` and `parseMsysPs`. The CPU cost of that `ps -l` goes into the poll
cost the builder measures.

### When a peak is measured

- **A job with a slot:** sampling starts when the slot is granted, and the peak is recorded when the slot is released.
  - A foreground command's slot lives as long as its `wsh jobslot` stream (`JobSlotCommand`). Its tree is the matched
    bash under the block's agent.
  - A background command's slot is held for `HoldPid` (`holdWhileRunning`). Its tree is `HoldPid`'s tree.
- **A command without a slot:** a background poll every 2 s reads the process table once. For each agent block it
  finds the bash processes of running Bash-tool commands, keeps each command's running peak, and records it when the
  process is gone.
- **Not measured:**
  - A foreground PowerShell-tool command cannot be matched, so it keeps the table's number.
  - Engine steps (Setup, Verify, Check, Final) keep the table's numbers in this change.
  - Only Claude Code's commands are matched. pi, codex and agy commands are not measured: their slots keep the table's
    numbers and their unknown commands are never learned. pi still reads the learned file, since it calls
    `wsh jobslot`. (Agent's call, builder question 7.)

### Which number the next run uses (answer 3)

- For each key (command pattern, project), wavesrv keeps the peaks of the last 5 runs.
- Admission uses the largest of them × 1.2.
- A key with no measurement yet uses the memgate table's number.
- An unknown pattern that is learned heavy but has never run in this project uses the largest peak recorded for that
  pattern in any project, × 1.2. wavesrv therefore also keeps that maximum per pattern. In the popover the figure reads
  "measured in another project". (Agent's call, builder question 4.)
- Overestimating costs only some waiting; underestimating lets the machine swap, which the queue exists to prevent.
  So the rule is a max, not an average: one cold `tsc` at 2.5 GB among four incremental runs at 0.8 GB would average
  1.4 GB × 1.2.

### Keys

- **Command pattern.** A known command's pattern is its memgate job name (`task check:ts`). An unknown command's
  pattern is its program plus its first word that is not a flag (`make build`, `pnpm build`), split the way memgate
  splits commands: `steps` and `program`, which already drop wrappers, redirections and `sh -c`.
- **Only programs memgate has no rule for are learned.** A command whose program memgate classifies at all, heavy or
  light (`go`, `npx vitest`, `pytest`, `cargo`…), keeps the table's verdict. A `go test -run X` stays light, as
  AGENTS.md promises. (Agent's call, builder question 1.)
- **Compound commands.** Steps that do no work are dropped before picking a pattern:
  - `cd`, `pushd`, `export`, `set`, `source`, `.` and `echo`;
  - pipeline tails: `tail`, `head`, `grep`, `tee`, `wc`, `sort`, `less`.

  When exactly one step is left, it is the pattern. When more than one is left (`make build && pnpm test`), the run is
  not learned, because the tree's peak cannot be split between them. On a later run a command is heavy when any of its
  steps matches a learned pattern, the way `Classify` takes the heaviest step. (Agent's call, builder question 2.)
- **Project.** The git root of the block's working directory. With no block, or no repo, all such jobs share one
  "no project" key.

### Unknown commands that turn heavy (answers 4 and 5)

- **Threshold.** An unknown pattern whose measured peak is 1 GB or more becomes heavy.
- **Known commands always queue.** A command in the memgate table queues whatever its measured peak is, because Auto
  also caps the number of heavy jobs by CPU (`max(1, CPUs/6)`) and those commands use a lot of CPU.
- **How wsh learns it.** wsh keeps deciding locally, with no connection for a light command, which is the point of
  ca7ecca7f. wavesrv writes the heavy unknown patterns to `~/.arc/jobslot-learned.json`:
  - it writes a temp file and renames it over the old one;
  - the file lists patterns only, not projects, because wsh only needs to know whether a command takes a slot.

  `jobslotTakesSlot` and `--heavy` read that file beside the memgate table on each run. A missing or broken file reads
  as empty.
- **wavesrv's own check.** `JobSlotCommand` classifies the command with the same learned set, from memory.
- **Expiry.** A pattern that has not run for 30 days is dropped from the file.
- **Back to light.** A learned pattern whose last 5 peaks in every project are all under 1 GB goes back to light and
  leaves the file. One cold run then makes a command queue for at most 5 runs. (Agent's call, builder question 6.)
- **One writer.** Only a wavesrv that installs the global hooks writes `~/.arc/jobslot-learned.json`, that is, one
  where `ARC_DEV_NO_GLOBAL_INSTALL` is unset. A worktree or browser dev app keeps its learning to its own data dir, so
  the file does not flip between two wavesrvs. (Agent's call, builder question 8.)

### Storage

- wavesrv keeps the per-key peaks in `jobpeaks.json` in its data directory and writes the file after each
  measurement.
- `~/.arc/jobslot-learned.json` is derived from it.

### What the person sees (answer 6)

- In the Jobs popover, each row's RAM figure says whether it is measured or the table's estimate.
- Its tooltip names the recent peaks and the rule. Example: "2.1 GB: max of the last 5 runs × 1.2", or "3 GB:
  estimate (not measured yet)".
- `JobQueueJob` gains what the row needs:
  - whether the figure is measured;
  - the recent peaks.
- There is no list of learned commands and no Forget button in this change.

## What exists today

Context only.

- **Admission.** `pkg/jobqueue` admits on `Request.Bytes`. `Snapshot` and `Job` carry what the popover shows, via
  `JobQueueData` in `wshserver_jobqueue.go`.
- **Classification.** `memgate.Classify(command)` returns `Job{Name, Bytes}`, and both wsh
  (`cmd/wsh/cmd/wshcmd-jobslot.go` `jobslotTakesSlot`) and wavesrv (`JobSlotCommand`) call it.
- **Existing measurement.** `pkg/memusage` already measures each agent's tree for the Agent sidebar's RAM figure
  (`wshserver_consumers.go`, via `memusage.Measure` and `AgentPid`).
- **Popover.** It draws each row's size with `formatGB(job.bytes)` in `frontend/app/cockpit/jobqueuepanel.tsx` `Row`.
  Its pure logic lives in `frontend/app/cockpit/jobqueue.ts`, with tests beside it.

## Left to the builder

- **Pattern extraction.** Reuse `memgate.steps`/`program` to split an unknown command into its pattern.
- **Poll cost.** Measure the CPU cost of the 2 s poll on Windows (`ReadTable` plus footprints of the command trees)
  and log it in `docs/open-issues.md` "RAM watch".
- **Go tests:**
  - the max-of-5 × 1.2 rule;
  - the fallback to the table;
  - pattern extraction;
  - the 1 GB promotion and the 30-day expiry;
  - a broken or missing learned file reads as empty in wsh;
  - `JobSlotCommand` using a learned figure and queueing a learned unknown pattern.
- **Vitest.** The measured / estimate label and tooltip.
- **CDP scenario.** Open the Jobs popover with a measured job and an estimated one.
- **CHANGELOG.** A line under Changed in the same commit.
- **Hand check.** Add a line to `docs/hand-checks.md` for the live check on Windows and on the Mac.
