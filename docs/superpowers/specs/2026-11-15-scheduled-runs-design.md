# Scheduled runs — design

Date: 2026-11-15. Brainstorm: `.superpowers/brainstorm/scheduled-runs/brainstorm.json`.

## Intent

Some checks are scheduled for later as initiative chunks with a due date: "Re-measure: … after 30 days", the monthly
"Review memory". On the day, the chunk only shows up in Needs you, and someone has to do the check by hand. A
recurring check (Review memory) is also re-created by hand each month.

Scheduled runs make such a chunk **run its own check on its due date**: a quick run does the measurement, writes the
result and a recommendation onto the chunk, and the chunk waits in Needs you with the result ready for the person to
decide. The run works in a throwaway worktree that is removed when it ends, so it leaves no change behind.

## What runs today

- `EffortChunk.Due` is a local day, `YYYY-MM-DD` (`pkg/waveobj/wtype.go:929`). `pkg/jarvis/attention.go:558` puts an
  open chunk whose day has come into Needs you on its next read (key `chunk-due:<oid>:<label>:<due>`, line 570).
  Nothing fires at the date.
- Initiatives sync through the vault, one `efforts/<oid>.json` per effort (`pkg/wavevault/effortmerge.go`), so a
  chunk exists on every computer the person uses.
- The run queue is local to one computer: `runqueue.json` in the data dir (`pkg/runqueue/runqueue.go:38`). Its loop
  evaluates on every poke and every 15 s (`pkg/wshrpc/wshserver/wshserver_runqueue.go:33`), starts entries through
  `CreateRunCommand` one at a time, and caps active runs at `runs:maxactive`.
- `wsh runs start --effort <id> --chunk <label>` already attaches a run to a chunk (a workref).
- Storage autoclean already holds a scheduled scan until heavy jobs finish, at most `IdleWaitMax`
  (`pkg/storage/autoclean.go:20`, `waitForIdle`).
- Today's open due chunks: three `Re-measure:` chunks (2026-11-17, 2026-11-19, 2027-01-15), `Review memory (Dec)`
  (2026-12-13), and five `Decide:` chunks on the Kael sync effort (2026-11-26).

## Decisions

### A chunk carries its run

A chunk gains two optional fields:

- **goal**: the quick run's goal text. A chunk with a goal and a due day is a *scheduled chunk*; clearing the goal
  turns it back into a plain due chunk.
- **every**: a period (`30d`, `7d`) that makes the chunk recurring.

Each scheduled chunk is opted in on its own; nothing runs for a due chunk without a goal.

### Who writes the goal

The agent that creates the chunk writes the goal at that moment, since it holds the context:
`wsh effort chunk add <effort> "<label>" --due +30d --run "<goal>" [--every 30d]`. The `arc:initiatives` skill
(`skills/initiatives/`) and AGENTS.md's "A decision to re-measure on a date" rule tell agents to add `--run` whenever
they schedule a re-measure. The person edits or clears the goal and the period on the chunk card. Commands to change
them later: `wsh effort chunk run <effort> <chunk> <goal|"">` and `wsh effort chunk every <effort> <chunk> <Nd|"">`.

### When it runs

The first time the scheduling host's wavesrv sees a scheduled chunk whose day has come and that is pending or active,
after midnight or at app start, it queues a quick run for it. (Agent's call: a deferred chunk is parked and stays out
of Needs you today, so it does not fire; a blocked chunk does not fire either, so a failed run never fires again until
the person unblocks it. Unblocking a chunk whose due day has passed arms it again.) Only chunks of an **active**
initiative fire: a chunk in a paused initiative shows as due in Needs you, as today, and does not run; resuming the
initiative arms it, so a due day that passed while it was paused fires then. The run is attached to the
chunk (`--effort` / `--chunk`) and named after the chunk. It starts on the project's saved route, the harness and
model `wsh runs start` resolves (the project's, else the settings default), so it costs what a quick run costs. The queued start waits for the machine to be idle the way
autoclean's scan does: it holds while heavy jobs run, at most `IdleWaitMax`, and then goes through the run queue as
usual, under `runs:maxactive`. A machine that was off on the day runs the chunk at its next start, so a day is never
missed.

A chunk fires once per due day: it does not fire again while a run from it is live or after one has finished for that
due day. A new due day (set by the person, or the next period) arms it again.

### Which computer runs it

One computer runs scheduled chunks: the setting `runs:schedulehost`, kept in the vault settings so every computer
sees it, names it. The person picks it; no computer claims it on its own, so two computers never both run. The first
time a scheduled chunk exists and no host is set, Needs you asks once, on each computer that sees it, "Run scheduled
chunks on this computer?"; answering yes there sets the host to that computer. Until a host is set, no computer runs
scheduled chunks, and they show as due in Needs you as today. Every other computer only shows the due chunk in Needs
you, plus a line saying which computer runs scheduled chunks. A host that stays off means the chunk is not run; it
still shows in Needs you. The person changes the host in Settings.

### What the run does and how the result comes back

The run measures and reports. It works in a **throwaway worktree** checked out from the project's HEAD, never in the
project's checkout, where other agents are editing: inside it the run may build, run commands and edit files (a
production build for a re-measure, for example). When the run ends, however it ends, the worktree and its branch are
removed; only the note on the chunk remains. The worktree does not cover files outside the repo (`~/.claude`
memory, settings), so the goal's fixed instruction still says to change nothing outside the worktree.

Its goal, as sent, is the chunk's goal plus a fixed instruction: work only inside this worktree, change nothing
outside it, write the result and a recommendation with `wsh effort chunk note` on that chunk, then finish. The note
carries the run (`EffortNote.Run`), so the card links to the run's report.

When the run finishes, the chunk stays open and is not ticked done. Its Needs you item changes from "Due <day>." to
"Result ready: <first line of the note>". The person marks it done, skips it, or moves the date, as today.

### When the run fails

A run that ends cancelled or stalled, or fails to start, sets the chunk `blocked` with a note naming the run and the
reason. (Agent's call: a chunk whose effort has no project, or whose project the scheduling host does not have, is a
failure to start: the chunk goes `blocked` with a note saying which project is missing.) There is no automatic retry. A run that stops to ask the person sends its question to Waiting on you like any
run.

### Recurring chunks

When a recurring chunk is marked done, the next period's chunk is created at once with the same goal and period: its
due day is **the day the chunk was marked done + the period**, and its label is the same label with the new period's
date, so two periods never share a label (labels are unique within an effort). The new chunk goes right after the
finished one.

Agent's call:

- Done and skipped both make the next period (a skip passes over this period, not the series), whoever sets them: the
  cockpit, `wsh effort chunk status`, or `advance`. Clearing the period ends the series.
- The date is a suffix: `<base label> (YYYY-MM-DD)`, the period's due day. The next label strips one trailing
  ` (YYYY-MM-DD)` from the finished label and appends the new one.

### Where it shows

- **Chunk card**: a line "Runs on <due> · every 30d" with the goal folding open; edit goal, edit period, turn off
  (clear the goal). After a run, the card links to it.
- **`wsh effort show`** prints the goal and the period.
- **Needs you**: while no host is set, one item "Run scheduled chunks on this computer?" (Yes sets the host).
- **Settings**: `runs:schedulehost`, to change the host. Other computers show "Scheduled chunks run on <host>".
- The run itself is an ordinary quick run, with a run event naming the chunk it came from.

### Today's chunks

After the feature lands, an agent gives a goal, written from each chunk's notes, to the three `Re-measure:` chunks and
`Review memory (Dec)`, and sets `every 30d` on the last. (Agent's call: it also renames that chunk to the suffix form,
`Review memory: compare … (2026-12-13)`, dropping the `(Dec)` tag.) The five `Decide:` chunks keep no goal: they are questions
for the person, with nothing to measure. The person reads the written goals on the chunk cards.

## Left to the builder

- Field names on `EffortChunk` (for example `Run` and `Every`) and how the vault merge treats them.
- Where the trigger lives: a step in the run queue's evaluation or a loop of its own, reusing autoclean's
  `waitForIdle`.
- How a computer is identified for `runs:schedulehost`.
- How "fired for this due day" is recorded so a restart does not fire twice.
- How the throwaway worktree is made and removed (reusing the engine's worktree and junction setup, `.arc/setup`), and
  removing one left behind by a crash.
- CLI flag names and UI wording.
- Updating `skills/initiatives/SKILL.md` and AGENTS.md so agents write `--run` when they schedule a re-measure.

## Out of scope

- Runs at a time of day, cron expressions, or schedules outside initiatives.
- Waiting on the 5-hour token window.
- Runs that act on their result (change code or settings).
