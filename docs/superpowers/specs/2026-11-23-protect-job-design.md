# Protect: hold the machine for one long job

## Intent

A long, timing-sensitive job keeps getting resumed. The person's case is the thesis reliability measurement: Docker
containers start a server, sleep, then curl, and the pilot already had to raise a timeout from 60 s to 180 s. When
another agent's build, typecheck or test suite runs alongside it, the job loses CPU, RAM and disk, and that produces
fake crashes and timeouts (`crash_before_sink`, `not_blocked`, `unclear`). The job queue does not see this job today,
so it lets the other agents' heavy work start next to it.

Scope:

1. **This spec:** mark one command as protected with `wsh protect -- <command>`.
2. **Later, not here:** a Protect button on an agent in the cockpit, built on the same `pkg/jobqueue` core.

## What runs today

- The queue is one FIFO, and no job overtakes another (`pkg/jobqueue/jobqueue.go:6`). Run now sets `Forced` and skips
  both the RAM gate and the CPU gate (`plan`, line 340).
- `python …` is light unless it is `python -m pytest` (`pkg/memgate/memgate.go:319`). A rule's verdict is final
  (memgate.go:307), so a measured peak never makes it heavy.
- An agent's slot is reclaimed after `MaxHold` = 60 min (jobqueue.go:38). A slot held by PID is reclaimed too
  (`holdWhileRunning`, `pkg/wshrpc/wshserver/wshserver_jobqueue.go:130`). Only engine jobs are exempt.
- memgate has no rule for docker, so an agent's `docker build` never queues.
- `jobmeter` cannot see RAM or CPU inside Docker's VM.
- `wsh jobslot` is a hidden command meant only for hooks (`cmd/wsh/cmd/wshcmd-jobslot.go:50`). Every agent Bash
  command goes through it. A background command gets `wsh jobslot --hold-parent` in front of it, and wavesrv holds the
  slot until that shell exits.

## Design

### Marking: a wrapper command

`wsh protect -- python scripts/audit_guard.py` starts the command as its own child process and holds one Protect slot,
keyed to that child's PID, until the child exits. It works the same whether the person types it in a terminal, an
agent runs it (foreground or `run_in_background`), or it runs under `wsh detach`.

- It is a public `wsh` command, listed in `wsh --help`, and documented.
- stdin, stdout and stderr pass straight through. Its exit code is the child's exit code.
- The agent hook (`wsh jobslot`, on both the wsh side and the wavesrv side) reads a command that starts with
  `wsh protect` as needing no slot of its own, so the command never holds two slots.

### What Protect does

- **Start.** A Protect request goes ahead of every queued job. It does not start until every heavy job already running
  has finished: running jobs are never killed.
- **While it runs.** Every other heavy job waits, agent and engine alike: Verify, Final, heavy Setup. An engine run
  stops at that step until the protected command exits. Waiting jobs show the reason `protected: <name> is running`.
  Light commands (git, reading files, anything memgate calls light) still run. Only queued steps wait: engine worker
  dispatch (`pkg/orchestrate/workerslots.go`) is unchanged, so a run that is already going keeps starting new workers.
  The `wsh protect` docs say so plainly.
- **Lifetime.** The slot is held until the child process exits. `MaxHold` does not reclaim it.
- **Queue off or paused.** Protect holds even when the queue is off (`jobs:mode off`) or paused (`jobs:pauseuntil`),
  which makes it an exception to "off never makes one wait". While a Protect job runs, `plan()` checks the Protect
  gate before the ModeOff branch, and `jobqueue.Off()` reports false. Once the Protect job ends, Off and Pause work as
  before. Update the package header and AGENTS.md to name this exception.
- **Escape hatch.** Run now still pushes one waiting job through for the person.
- **Two at once.** A second Protect request waits behind the first, like any queued job.
- **Council seats.** (Agent's call) `NoCPU` jobs such as council seats are exempt from both Protect gates, the same way
  Auto's CPU cap already exempts them: Protect does not hold them back, and it does not wait for them to finish.

In `plan()` this is an ordering change plus one gate: Protect requests sort first, and a Protect head waits while any
heavy job runs. While a Protect job runs, nothing non-forced starts unless memgate calls it light, and light commands
never reach the queue anyway.

### Docker as a heavy job

Add memgate rules that make these heavy, with a RAM estimate in the table:

- `docker build`
- `docker buildx build`
- `docker compose up`
- `docker compose build`

(Agent's call) `docker compose up` in the foreground (no `-d`) runs until it is stopped, like a dev server, so it is
`LongRunning()` and never queues. `docker compose up -d` is heavy, along with the three commands above it.

`jobmeter` cannot see inside Docker's VM, so a measured peak cannot replace the table estimate for these commands.
With the rules in place, Protect holds back another agent's docker builds, and outside Protect those builds queue on
RAM like any other heavy job.

### What the cockpit shows

- The Jobs popover and the app-bar jobs chip list the protected job first, tagged **Protected**.
- Each job waiting on it shows `protected: <name> is running`, including engine steps.
- Run now and Skip work as before on waiting jobs.
- A running Protect job has no Skip.

### Left to the builder

- Outside arcterm, or when wavesrv does not answer: `wsh protect` still runs the command, with a warning on stderr. Its
  connect and first-word deadlines match `wsh jobslot`'s, so a hung wavesrv never holds the command.
- (Agent's call) wavesrv holds the Protect slot by the child's PID, as `HoldPid` and `holdWhileRunning` do, so the slot
  survives the `wsh protect` process dying while the child lives. If the link to wavesrv drops, for example on an
  arcterm restart:
  - `wsh protect` prints a warning on stderr.
  - It retries the connection every few seconds.
  - Once reconnected, it asks for Protect again. It goes ahead of the queue again and waits for any heavy job that
    started during the gap.
- Unit tests on `plan()`, a `wsh protect` exemption test in the hook classification, and memgate tests for the
  docker rules. The `plan()` tests cover four cases:
  - Protect goes first.
  - Protect waits for running heavy jobs.
  - Protect blocks heavy jobs, engine jobs included.
  - `MaxHold` does not reclaim a Protect slot.
- A `CHANGELOG.md` line, and docs for `wsh protect`.
- A CDP scenario (or a step in an existing jobs-popover scenario) shows a fixture queue with a Protected job and one
  job waiting on it.

## Out of scope

- The cockpit Protect button on an agent (step 2).
- A `.arc/protect` pattern file, an `ARC_PROTECT=1` prefix, a time window, or automatic detection. The judge weighed
  all four and dropped them for this step.
- OS process priority.
- Work that runs outside arcterm's queue, such as docker commands the person types by hand or an IDE. Protect cannot
  hold those back.
