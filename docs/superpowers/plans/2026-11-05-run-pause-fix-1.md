# Run pause: fix round 1

The final stage of run 64c0b649 failed in round 1: Verify timed out after 20 minutes on the merged result, and
`TestLandLineThreeAtOnce` failed inside it. That test predates this run and passes alone in about 9 s on the merged
result: its 30-second wall-clock wait for three real git lands ran out at 33 s while a second engine run (Revamp
Jarvis) loaded the same machine. The lead reran the same Verify on the merged result (commit f5eaf90) afterwards: it
passed in 343 s with no failure, so the timeout was the machine's load, not a hang in this run's code. This round makes that wait fit a loaded machine, and fixes two gaps the task workers found and could not take
because the files were outside their lists: the run queue does not count a paused run, and the runs skill does not
name the new commands.

### Task 1: The land line test waits long enough on a loaded machine
**Depends on:** none
**Files:** `pkg/orchestrate/landline_test.go`

`driveLandLineUntil` (`pkg/orchestrate/landline_test.go:66`) gives three real git lands 30 s of wall clock. They take
about 4.5 s on an idle machine and took 33 s during the final stage, while another run's workers and tests shared the
CPU. The test checks the order and the outcome of the lands, not their speed.

- Raise the deadline to 2 minutes, in one named constant beside the helper (for example `landLineWait`), and make the
  failure message read from the same constant so the two cannot drift.
- Keep the 20 ms poll and every assertion as they are. Change nothing outside this helper.
- Prove it: `go test ./pkg/orchestrate -run '^TestLandLine' -count=1` passes (with the CGO env AGENTS.md gives for
  Windows).

### Task 2: The run queue counts a paused run against runs:maxactive
**Depends on:** none
**Files:** `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`

The spec's "The run queue" section says a paused run still counts as active against `runs:maxactive`, so the queue
does not start a queued run in its place. `runqueue.Active` (`pkg/runqueue/rules.go:32`) already counts any top-level
run that is not done or cancelled, but `loadRunQueueRuns` (`pkg/wshrpc/wshserver/wshserver_runqueue.go:297`) loads only
planning, awaiting-review, executing and blocked runs, so a paused run never reaches it.

- Add `jarvis.RunStatus_Paused` to the statuses `loadRunQueueRuns` reads, and to `allRunStatuses` (`:73`), which
  `resolveQueueAfter` (`:377`) uses to match an `--after` prefix, so a paused run can be named there too.
- Test (in `wshserver_runqueue_test.go`, reusing its fixtures): with `runs:maxactive` at 1 and one paused top-level
  run stored, an evaluation of the queue starts no queued entry; and `resolveQueueAfter` finds a paused run by a
  unique prefix of its id. Run with `go test ./pkg/wshrpc/wshserver -run '<the new test names>' -count=1`.
- Leave `wshserver_keepawake.go` alone: a paused run holds no agents, so it should not keep the machine awake.

### Task 3: The runs skill names pause and resume
**Depends on:** none
**Files:** `skills/runs/SKILL.md`

`skills/runs/SKILL.md` lists `wsh runs cancel` (line 24) but not the two commands this run added, so an agent reading
the skill does not know they exist. Edit `skills/`, never a vault or `~/.arc` copy.

- Beside the `cancel` line, add one line for `wsh runs pause <run-id>` and one for `wsh runs resume <run-id>`. Say what
  each does in the skill's voice: pause stops every agent of a top-level run and frees their RAM while keeping their
  sessions, and resume reopens them where they were. Both take the exact id `wsh runs list` prints.
- Add one sentence saying that, on a Mac or Windows machine, arcterm may resume a run paused this way once memory has
  been free for a few minutes, so a paused run is not guaranteed to stay paused.
- There is no test for this file. Check that the headings and list structure still parse as Markdown.
