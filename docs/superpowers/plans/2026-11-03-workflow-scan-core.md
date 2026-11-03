# Workflow scan, core only: the engine reads its own run records and proposes fixes

**Verify:** `node scripts/verify.mjs ./pkg/workflowscan/... ./pkg/wshrpc/... ./pkg/wstore/... ./pkg/jarvis/... ./cmd/wsh/...`
**Check:** `task check:ts && go vet ./pkg/workflowscan/... ./pkg/wshrpc/... ./pkg/wstore/... ./pkg/jarvis/... ./cmd/wsh/...`

## Context for every task

Port of the kaeltran16 fork's workflow scan (`kael` remote, `kael/main` at `16b726ffd`). Read the fork's spec first:
`git show kael/main:docs/superpowers/specs/2026-10-26-workflow-scan-design.md`. In short: a scan builds a corpus of
the last 14 days of engine run records (failure and correction signals, no transcripts, 640k-char cap), a Sonnet
pass names patterns seen in 3+ runs with one verbatim quote per run and a named fix target, code recounts the quotes
and drops what does not hold, and an Opus quick run checks the survivors against the code and `docs/deferred.md`,
proposes a small edit to the prompt or config behind each, waits for the owner's picks, applies and commits only
the picked ones in its own repo, and files the dropped ones as declined.

**What differs from the fork (the cheap port):** no Workflow lens on Usage (`workflowlens*.ts`, `usagesurface.tsx`
changes, the `workflow-scan` CDP scenario) and no new Needs you item kind. The Opus agent presents its proposals
and takes the picks with Claude Code's `AskUserQuestion` (one question per proposal: Apply / Drop, a reason in
Other), which arcterm already projects into the cockpit as an agent waiting on you. A fix whose target is in
another project is shown as text to copy, never applied. Write this into the scan agent's built-in instructions and
into the spec's "where suggestions show" when you copy the spec in.

Port, don't cherry-pick blindly: our tree has diverged (tabbed Usage, our attention model, our palette). Go is the
source of truth for wire types; change the Go and run `task generate`, never hand-edit `frontend/types/gotypes.d.ts`,
`frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go` or `pkg/{waveobj,wconfig}/metaconsts.go`.
Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash). A new registered
`waveobj` type needs a migration in `db/migrations-wstore/`. Add one `CHANGELOG.md` line under `## Unreleased` and
a `- [ ] (arcterm) Kael sync: run a real workflow scan …` line in `docs/hand-checks.md`.

### Task 1: The scan package: corpus, Sonnet pass, recount, validation
**Depends on:** none

Commit `f594b3b87` (`pkg/workflowscan`: `corpus.go`, `recount.go`, `sonnet.go`, `validate.go`, `goal.go` and their
tests; `liveprobe_test.go` only if it skips cleanly without a store snapshot). The corpus reads our run records: check
each signal the fork's corpus reads against the fields our `Run`/DAG records actually carry, and drop or remap the
ones we lack (list them in the commit message). The Sonnet pass runs as a consult session pinned to claude/sonnet.
Copy the spec to `docs/superpowers/specs/2026-10-26-workflow-scan-design.md` with the differences above written in.

### Task 2: The scan in wavesrv and `wsh workflow`
**Depends on:** Task 1

Commits `e3b028b62` (wire types, RPCs, `Run.WorkflowScan`, `ConsultSessions`; skip the Usage lens value and
`workflowscanstart.ts`), `4a30d4f2a` (wavesrv steps, `pkg/wstore/wstore_workflowscan.go`, `wsh workflow scan
[--start] | result | picks`), `962792522` (one scan at a time across projects), `19c627337` (resume a scan agent
whose tab was closed), `530ef1733` (Usage attributes a run's consult sessions to the run). The `workflowscan:<runid>`
address opens the scan run's agent through `frontend/app/view/jarvis/openref.ts`.

### Task 3: The Opus agent's instructions and a way in
**Depends on:** Task 2

The scan agent's built-in instructions (the fork's, in `goal.go` / `wshcmd-workflow.go`) with the AskUserQuestion
picks above. One way in: a palette command "Scan workflow…" that runs the scan in the palette's home project (the
palette part of `ba040a2a1`, without its Brief and Needs you changes). Update `skills/runs` (never the claude-mod
copy) with one line on `wsh workflow scan`.
