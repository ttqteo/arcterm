# Brainstorm builder check as an Arc-launched reviewer

Date: 2026-10-22. Status: design, autonomous run (every call below was made without the human, with its reason).

## Problem

When the user presses **Check with a builder**, the pane sends `brainstorm: check` and
`skills/brainstorm/SKILL.md` has the brainstorming agent write the spec and run superpowers' builder check, which
dispatches a fresh harness subagent with `builder-check-prompt.md`. Three things are wrong with that:

- Arc never knows a check is running. The agent's turn ends while the subagent works in the background, so the
  pane offers Check with a builder again.
- pi has no subagent tool, so on pi the check degrades to the agent reviewing its own spec: no fresh reader.
- Arc already runs separate judging sessions (plan reviewer, task reviewers, final verifier, launched by
  `spawnStageSession` in `pkg/orchestrate/stagesession.go`) on the reviewer route the run settings define. The
  builder check is the same kind of job and goes around them.

## Outcome

1. Arc launches the builder check: a one-shot reviewer session, in the project's checkout, given the spec's path,
   with Arc's builder-check prompt, on the reviewer route the run settings define.
2. Arc owns the check's state. The pane shows "A builder is reading the design." from that state, and Check with a
   builder is unavailable until the result is back, whatever the agent writes.
3. The reviewer's ranked questions go back to the brainstorming agent as one line into its tab. The agent still
   sorts them into `check.yours` / `calls` / `answered` and folds them into the parts and the spec.
4. Claude and pi brainstorming agents behave the same.
5. A failed, lost or timed-out reviewer shows an error in the pane with a way to try again. Nothing hangs silently.

## Flow

1. The user presses **Check with a builder**. The pane sends `brainstorm: check` (unchanged). The sent-line rule
   shows the pane working while the agent's turn runs.
2. The agent writes the spec at `spec` from the parts, then runs `wsh brainstorm check <abs path of brainstorm.json>`
   and ends its turn with one line. It no longer dispatches a subagent.
3. `wsh brainstorm check` calls `BrainstormCheckCommand{blockid: <its own block>, file}`. The handler validates,
   writes the check record (`reading`) on the agent's tab and returns at once. A detached goroutine launches the
   reviewer and watches it.
4. The reviewer reads the spec and what it references, writes its ranked questions to a report file and runs
   `wsh jarvis complete --report <file>`. That ends its session: the existing done path stops a session that has a
   `StageRole`.
5. The watcher sees the run done. It writes `Run.Report` to `<topic dir>/builder-check.md`, sends the agent
   `brainstorm: builder questions <abs path of builder-check.md>`, and sets the record to `answered`.
6. The agent reads the file, sorts and folds as the skill says today, and writes `check`. The pane leaves the
   pending state once the agent takes that line (below).

## Decisions

### D1. The agent triggers the launch with `wsh brainstorm check`; Arc owns everything after it

The spec has to exist before a reviewer can read it, and the agent writes it. Three ways to hand over:

- The agent runs `wsh brainstorm check` once the spec is written (picked). Both harnesses have a shell with `wsh`
  on PATH, so claude and pi behave the same, and the handoff is a tool call, which is deterministic. Arc owns the
  state from that call on.
- Arc launches on the button press and waits for the spec file. Arc would have to infer "the spec is finished"
  from file mtimes and the agent's turn ending, which is a guess, and a half-written spec would be read.
- Arc writes the spec itself. That moves design writing out of the agent, which holds the conversation.

The gap before the `wsh` call is covered by the existing sent-line rule. If the agent's turn ends and no check
record newer than the `brainstorm: check` send exists, the pane shows the failure "The agent ended its turn without
starting the builder check." with Try again (D7). The agent skipping a step is never a silent hang.

### D2. Reuse the engine's launcher by extracting its dag-free core

`spawnStageSession` resolves a route, spawns the worker tab, records a quick child run with `StageRole`, stamps and
starts it. Only the route default (`reviewerRoute(owner, g)`) and the `RunEventKindStageSessionStarted` event are
about a dag. `stageSessionLost` uses `g` only for `g.ChannelId`. So `pkg/orchestrate` exports the core and the
engine calls it:

```go
// JudgingSession is one fresh session that works no task, reads Tree, and ends with the command its Prompt names.
// DagORef is "" for a session outside a dag (the brainstorm builder check).
type JudgingSession struct {
	ChannelId, WorkspaceId, DagORef string
	Role, Label, Tree, Prompt       string
	Route                           waveobj.RoutePin // required: the caller resolves its own default
}

// LaunchJudgingSession starts s and returns its run id.
func LaunchJudgingSession(ctx context.Context, s JudgingSession) (string, error)

// JudgingSessionLost says why a judging session that has not finished is done for, or "" while it still works.
// final is set when its route refused it.
func JudgingSessionLost(ctx context.Context, channelId, runID string, startedTs, now int64) (reason string, final bool)
```

`spawnStageSession` keeps its signature, resolves its route as today, calls `LaunchJudgingSession` and logs its run
event. `stageSessionLost` calls `JudgingSessionLost`. The engine's behavior does not change, and its tests prove it.
A second launcher is not written. The check gets the engine's liveness rules: the route refused it, the
`ReviewTimeout` (20 min), the run ended without a result, the worker exited, or the session went idle past its grace.

### D3. Route: the reviewer route of the run settings, else the brainstorming agent's runtime

The handler resolves `jarvis.ResolveProfile(jarvis.LoadGlobalProfile(), jarvis.OverrideFromMeta(ch))` for the
project's channel and uses its `ReviewerRoute`. That is the setting the run settings call the reviewer route, with a
per-project override when there is one. When it is unset, the engine falls back to the lead's route, and here the
lead is the brainstorming agent: its runtime (`session:agent` on its tab, when that harness can run a worker) with
the runtime's default model, else `runroute.DefaultRuntime("")`. `LightReviewerRoute` is not used: the check is
one careful read, not a cheap lens.

### D4. Where the session lives: a run in the project's channel, `StageRole: "builder-check"`

A judging session is a run (usage, transcript, stop on done all hang off it). The handler takes the channel with
`wstore.EnsureChannelAtPath(ctx, <project name>, <brainstorm cwd>)`, and the workspace from the agent's tab. The run has no
`DagORef`, no parent and `StageRole: "builder-check"` (`jarvis.UsageRole_BuilderCheck`), so usage counts it under
that role (`UsageRole` already returns `StageRole`). It works in the brainstorm's cwd. The prompt says to change
nothing, so it shares the checkout with the agent safely.

A builder-check run is an implementation detail of the brainstorm. The pane is its only face:

- **Run lists.** `GetChannelRunsCommand` and `GetChannelRunChangesCommand` (`wshserver_channels.go`) leave out a
  run whose `StageRole` is `builder-check`, ids and rows alike. Those two RPCs feed every frontend run list
  (`activeChannelRunsAtom` in `channelsstore.ts` and what reads it), so filtering at the server is the one place.
  `wsh runs list` treats such a run as a child (`runsIsTask` in `wshcmd-runs.go`) and does not list it.
- **Session tree.** `groupRunSessions` (`sessionsruns.ts`) makes no run row for a session whose `role` is
  `builder-check`. The reviewer's tab stays a solo session, so the user can still open it.
- **Attention.** `unverifiedItem` and every other run-level item in `pkg/jarvis/attention.go` skip it.
- **The run-done path.** At done, `advanceRun` leaves `sealDue` false for it. The session made no change of its
  own, and a seal would diff the brainstorm's shared checkout and attribute that diff to the reviewer. The other
  done steps already do nothing for it, so they stay as they are: no parent to notify, no dag to wake, and
  continuity capture finds no dossier. The existing `StageRole` stop still ends its session.

### D5. The check record lives on the agent's tab meta; the Run is only the session

The single source of the check's state is a set of flat keys on the brainstorming agent's tab, next to
`session:brainstorm`. Flat keys go through `metaconsts` with no new generator support:

| Key | Type | Holds |
|---|---|---|
| `brainstorm:checkstate` | string | `reading`, `answered` or `failed`; absent = no check |
| `brainstorm:checkts` | int64 | UnixMilli the state was set |
| `brainstorm:checkrun` | string | the reviewer's run id, once launched |
| `brainstorm:checkchannel` | string | the channel the run is in |
| `brainstorm:checkreason` | string | why it failed, for `failed` |

Only the server writes these keys. Each write sets all five, clearing the ones that do not apply. The frontend reads
them from the tab (the roster already reads `session:brainstorm` there) and never infers the state from the file.
Why not keep the state only in the frontend store: a reload or an Arc restart would lose it. Why not keep it only on
the Run: the frontend would then need the run's channel and a liveness judgment, which the server already makes.

### D6. One watcher goroutine per check, re-armed at startup

The handler returns after writing `reading` (the RPC's 5 s budget cannot cover a worker spawn). A detached goroutine
launches the reviewer, records `checkrun`/`checkchannel`, then ticks every 5 s (`builderCheckPollEvery`) until it
decides:

- Run done and `Report` non-empty: deliver (D8), set `answered`.
- Run done with an empty report: `failed`, "The builder ended without its questions."
- `JudgingSessionLost` gives a reason: stop the session (`stopStageSession`), `failed` with that reason.
- The launch fails: `failed`, "Arc could not start the builder: <err>".

What each tick decides is a pure function in `pkg/brainstormcheck`, `Decide(run, lostReason) Action`, and has unit
tests. The goroutine is the thin loop around it. The engine respawns a lost reviewer once. The check does not: it
shows the failure and the user retries (D7), so a broken route never costs two silent reviewer sessions.

At wavesrv start, a sweep finds every tab whose `brainstorm:checkstate` is `reading`. When it has a `checkrun`, the
sweep re-arms that tab's watcher. `JudgingSessionLost` judges from the persisted run and `checkts`, so a re-armed
watcher picks up where the lost one stopped, and a reviewer that finished while Arc was down is delivered. When it
has no `checkrun`, the launch never finished, and the sweep sets `failed` with "Arc restarted before the builder
started."

The handler refuses a second check for a tab whose record is `reading` ("a builder check is already running"), and
`wsh` prints that to the agent.

### D7. Pending, failure and Try again in the pane, derived by one pure function

`brainstormmodel.ts` gets `builderCheckView(record, sentCheckAt, file, modifiedMs, agent)`, which returns
`{ kind: "none" } | { kind: "pending"; text } | { kind: "failed"; reason }`:

- `reading`: pending, "A builder is reading the design."
- `answered` until the agent takes the delivered line: pending, "Taking in the builder's questions." The rule is
  `settleSent`'s: the agent has taken it once its turn ends after `checkts`, or the file changes after `checkts`
  while it is not at work. Once taken, the record is inert (`none`): the file's `check` drives the view, as today.
- `failed`: failed, with `checkreason`, while the file's `check` is null.
- No record newer than a settled `brainstorm: check` send (`sentCheckAt`, kept in the brainstorm state once that
  sent line settles): failed, "The agent ended its turn without starting the builder check."

`canCheck` stays about the file. The pane offers Check with a builder only when `canCheck(file)` holds and
`builderCheckView` is not pending. The pending card is the pane's existing working card. The failed card shows the
reason and **Try again**, which sends `brainstorm: check` again, the same line as the button. Retrying through the agent
keeps one path. The agent rewrites the spec and relaunches, which also covers a spec that went missing. That costs
one short agent turn, which is fine against a reviewer that takes minutes.

This replaces the "pending sent-check" rule that run 9e6103c5 is adding to `brainstormmodel.ts`. Whatever that run
landed (its `working` field included) is the base. Its rule becomes the `reading` / `answered` states, because Arc's record
now says what the agent's file could only guess.

### D8. Delivery: the report as a file, one line to the agent

The watcher writes `Run.Report` verbatim to `<cwd>/.superpowers/brainstorm/<topic>/builder-check.md`, overwriting
it, and sends `brainstorm: builder questions <abs path>` with the same `deliverAgentMessage` that
`AgentPromptCommand` uses. A session whose mod holds a control stream runs it as a prompt. Any other session has
it typed, so claude and pi are the same. `Run.Report` is the single source: the file is written from it even when
the reviewer wrote its own report elsewhere. The multi-line questions travel as a file because every brainstorm
line is one line.

### D9. Arc's copy of the builder-check prompt

`pkg/brainstormcheck/builder-check-prompt.md`, embedded with `go:embed`, is superpowers' prompt (domain "software
engineer"), plus Arc's ending: read only, change no file, write the report to `[REPORT_PATH]`, then run
`wsh jarvis complete --report [REPORT_PATH]`, which ends the session. "Nothing important left" is a valid report.
It lives in the package, not in `skills/brainstorm/`. Everything under `skills/` is projected into every harness's
skills dir, and the brainstorming agent must not find it and run the check itself. The report path is in the system
temp dir, named by a fresh uuid (the run id does not exist until the launch, and the prompt needs the path before
it), so it is outside the project the reviewer is told not to change.

### D10. The skill and the docs

`skills/brainstorm/SKILL.md`: on `brainstorm: check`, write the spec at `spec` from the parts, run
`wsh brainstorm check <abs brainstorm.json path>`, write nothing else, and end the turn with one line naming the spec.
The new line is `brainstorm: builder questions <path>`. On it the agent reads the file, sorts every question into
`check.yours` / `calls` / `answered` with the pile rules the skill has today, folds into parts and spec, refreshes
`touched`, and writes the file once. If the file says nothing important is left, `check` is written with empty
`yours`. Every mention of a subagent goes. `docs/agents/brainstorm.md` changes its action table, explains the check
record and the reviewer, and drops "Pi is untested" for the check where the pi path now matches claude's.

## Out of scope

- Automatic respawn of a lost reviewer (D6).
- Showing the reviewer's tab anywhere but the agent roster's background tabs.
- Model picks per check, or a builder-check route of its own. The reviewer route is the setting.

## Verification

- Go: `Decide`, the prompt fill, the report path, the handler's refusals and record writes, the startup sweep, the
  whole route chain of D3, the run-list, `wsh runs list`, attention and seal exclusions of a `builder-check` run,
  and the engine's stage-session tests unchanged after the extraction.
- Vitest: `builderCheckView` for every state and both settle paths, the Check gating, and the session tree making
  no run row for a `builder-check` session.
- CDP: `brainstorm-builder-check` in `scripts/cdp/scenarios-brainstorm-builder.mjs` plays the server's side by
  setting the tab meta. It shows the pending card with Check unavailable, the returned result once the file's
  `check` is written, and the failed card with Try again. Pressing Try again sends `brainstorm: check`.
- A live reviewer cannot run in the scenario: it costs a real session and minutes. The run's proof of the reviewer
  path is the Go tests with the launch stubbed. An end-to-end check with a real claude and a real pi reviewer is
  deferred, recorded in `docs/deferred.md`.
