# Sleep an asking agent with its ask kept

Initiative: Clean Slate: one switch stops every agent (`effort:92be7081-f01c-4256-8af7-ffdb59533f46`), chunk
"Sleep an asking or permission-waiting agent with its ask kept (sleepRefusal refuses it today)".

## Intent

Clean Slate's switch sleeps every agent outside a run (interrupt a working turn, then sleep with force). An agent that
is asking a question (AskUserQuestion) or waiting for a permission sleeps too, with its ask kept, instead of being
refused as `sleepRefusal` does today. This spec covers only that sleep path; the switch itself, the job queue hold and
the confirm/undo are other chunks.

## What runs today

- `sleepRefusal` (`pkg/wshrpc/wshserver/wshserver_agentsleep.go:271-287`) refuses any row that is not idle, naming
  "waiting for a permission" for a Waiting status. `sleepAgent` itself never touches the ask registry or `agentperm`.
- Asks live in memory (`agentask.GlobalRegistry`, `pkg/agentask/agentask.go:154`). `LivePendingAsks`
  (`pkg/jarvis/attention.go:1100-1134`) drops an ask whose block's process is Done, unless `blockRunPaused` says its run
  is paused.
- For a paused run, `agentask.HoldAnswer = answerHeld` (`pkg/jarvis/pausenudge.go:95-121`) holds an answer per
  question (`holdAnswer`, `pkg/agentask/deliver.go:91-103`), and `PausedNudge` (`pausenudge.go:30-39`) writes the held
  answers after the resume text when the worker reopens.
- Permission requests (`pkg/agentperm/agentperm.go:198-239`) are in memory and dropped on Stop / UserPromptSubmit /
  SessionStart (`agentperm.go:367-383`), so a wake drops them.
- The roster folds the registry and the status into "asking", and Sleeping overrides the state
  (`pkg/wshrpc/wshserver/wshserver_agentmsg.go:197-271`).
- The idle sleep loop skips asking rows (`pkg/wshrpc/wshserver/wshserver_agentsleeploop.go:392-396`).
- `runWake` delivers a message once the agent reports in (`wshserver_agentsleep.go:576-579`); an idle sleep's wake
  sends no nudge.

## Decisions

### Who may sleep an asking agent

`sleepRefusal` stops refusing an asking or permission-waiting agent, so Clean Slate and the person's own Sleep (both
`AgentsSleepCommand`) put it to sleep. The idle sleep loop keeps skipping asking rows. Its other refusals (already
asleep, a run's agent, a harness that cannot resume) stay.

Agent's call (builder question 4): an asking or permission-waiting agent skips compaction-before-sleep
(`sleepAfterCompaction`) and sleeps at once. `/compact` typed into an open dialog would answer or dismiss it, and the
loop that finishes a compaction's sleep skips asking rows, so that sleep would never come.

Agent's call (builder question 3): an asking or permission-waiting agent is never interrupted (no Esc), only slept: an
Esc dismisses the dialog, and `agentperm.NoteKey` drops the permission queue (`agentperm.go:421-422`). This chunk
exports that rule (one predicate on the roster row) for the Clean Slate switch chunk to use.

### The ask while asleep (paused-run pattern)

A sleeping agent's question stays on its row and in the attention list. `LivePendingAsks` keeps the ask of a sleeping
block as it keeps a paused run's block's. An answer given while it sleeps is held (`answerHeld` also returns true for a
sleeping block), and the wake hands the held answers to the agent in its nudge. A held answer does not wake the agent.

Agent's call (builder question 1): with the arc mod, a Claude AskUserQuestion is a `wsh ask --wait` spawned inside the
agent's tree (`claude/arc-mod/hooks/register.ts:1211-1221`; pi's bridge waits too). When the sleep kills the tree,
`AskCommand`'s `ctx.Done` branch (`pkg/wshrpc/wshserver/wshserver_ask.go:55-62`) claims the ask and publishes
`Cleared`, so the ask would be gone before the prune or `answerHeld` see it. So `sleepAgent` marks the block's ask
suspended in the registry before it destroys the tree, and the `ctx.Done` branch, finding the mark, removes only the
waiter: the ask stays pending with its AskId (no `Cleared` event, no `ChildAskCleared` row; a sleeping agent is never a
run's, so dag lifecycle rows are untouched), and the UI sees no clear-then-raise. A sleep that fails before the kill
clears the mark. The mark already exists: `agentask.Registry.Suspend` / `SuspendedAsk` and the `ctx.Done` check
shipped in e2c1334ef for paused runs (`SuspendRunWorker` sets it), so `sleepAgent` only calls `Suspend` on the block's
oref before `destroyBlock`.

### A permission prompt while asleep

A permission request is not held as a decision. While the agent sleeps, its permission card is read-only: it shows
what the agent waited on (the `agentperm` request's Summary, e.g. the Bash command) and a Wake button in place of Allow
and Deny (builder question 1, your answer). `AgentPermissionAnswerCommand` refuses an answer for a sleeping agent: its
Allow and Deny type keys into a PTY that has no process (`wshserver_agentperm.go:150-163`), and Deny's `DropAll` would
take the Summary away. The wake nudge's "ask again" makes the resumed agent retry the tool, which raises a fresh
permission prompt. The wake's SessionStart drops the old request, as today; a restart while asleep drops it too, and the
card goes with it.

### Across an app restart

The ask stays in memory only, as for a paused run. An app or wavesrv restart while the agent sleeps drops the question
from its row and the attention list; waking it still sends the "ask again" nudge (the mark below is in block meta and
survives), so the agent asks again.

### Where you answer it

The sleeping row keeps its ask beside the Sleeping state, so every place that answers an ask today (Chat's ask picker,
the composer's typed answer, the palette, Sidecar, Needs you) answers it through `AnswerAgentCommand`, and
`DeliverAnswer` holds it. Chat then shows the answer with a line saying it goes in when the agent wakes. The composer's
Send on a sleeping agent with no question left wakes it as it does today.

### What the agent reads on wake

`sleepAgent` records that the agent was asking or waiting: a block meta mark beside `agent:sleeping`, set in the same
write. Its wake sends a sleep nudge first, then the person's wake message if there is one:

- "You were put to sleep while waiting on the person; carry on from where you stopped."
- one line per held answer, written as `PausedNudge` writes them;
- "If you were waiting on an answer or a permission that is not below, ask again."

The wake clears the mark with the other sleep marks. An agent slept while idle wakes as today, with no nudge.

## Left to the builder

- How `answerHeld` learns a block sleeps (the `agent:sleeping` meta, read as `blockRunPaused` reads the run), and the
  same test in `LivePendingAsks`.
- The meta key name of the asking mark, and the exact nudge wording.
- Keeping the sleeping row's ask in the roster and the frontend agent view model, so Chat draws the question.
- Go tests beside `sleepRefusal`, `LivePendingAsks` and `answerHeld`; a CDP scenario that shows a sleeping agent's
  question in Chat and the held-answer line.
- A `CHANGELOG.md` line under Changed: Sleep now works on an agent that is asking you, and its question waits for you.

## Builder's calls

Made by the run's lead (autonomous run, 2026-11-27) for what the spec left to the builder. Tasks cite them by number.

1. **The asking mark is `agent:sleepasking`, a bool** in block meta (`AgentSleepAsking bool
   json:"agent:sleepasking,omitempty"` beside `AgentSleeping` in `pkg/waveobj/wtypemeta.go`, then `task generate`).
   `sleepAgent` writes it `true` in the same `updateBlockMeta` as `agent:sleeping` when the row awaits the person
   (call 2) and `nil` in that write for any other row (a stale mark never rides into an idle sleep), and every place
   that clears the sleep marks (`runWake`'s `awake`, `wakeMarkedAwake`) clears it too (`nil`). A bool, not a time:
   `agent:sleeping` already carries when.
2. **One predicate, `awaitsPerson(row *agentRow) bool`**, in `wshserver_agentsleep.go`: the row's folded state is
   asking (`row.State == wshrpc.AgentsState_Asking`, which covers an open ask) or its raw status is Asking or Waiting.
   `sleepRefusal` no longer refuses such a row (it still refuses a working one, an asleep one, a run's, a harness that
   cannot resume); `AgentsSleepCommand` skips `sleepAfterCompaction` for it; `sleepAgent` uses it to set the mark and
   suspend the ask. The Clean Slate switch chunk uses it to decide not to send Esc. The two other callers of
   `sleepRefusal` keep refusing such a row, since the spec widens only the person's Sleep and Clean Slate: the sleep
   after a run (`wshserver_agentsleepafterrun.go`) and a pair round's `livePairLink.Sleep` (`wshserver_pair.go`)
   each also call `awaitsPerson` and refuse with `agent %q is waiting on the person; it cannot sleep`.
3. **Suspend and its undo.** `sleepAgent`, for a row that awaits the person, calls
   `agentask.GlobalRegistry.Suspend(blockORef)` before the meta write and `destroyBlock`. If the meta write fails, it
   calls a new `Registry.Unsuspend(oref)` (clears `Suspended` on the pending ask, if any) before returning the error.
   Once `destroyBlock` has run, the sleep stands (as today), so nothing is unsuspended after it.
4. **"Asleep with its ask kept" is one test, in jarvis:** block meta `agent:sleeping` > 0 and `agent:sleepasking`
   true, with the block's process not running (`controllerStatusFn` nil or Done; a stale mark over a running process
   types the answer as before). `LivePendingAsks` keeps such a block's ask as it keeps a paused run's; `answerHeld`
   returns true for it. An idle-slept block (no asking mark) is pruned and typed as today.
5. **The wake nudge** is built by a new `jarvis.SleptNudge(blockORef string) string`, beside `PausedNudge` in
   `pkg/jarvis/pausenudge.go`, sharing its held-answer line format (factor the loop out, do not copy it):
   `You were put to sleep while waiting on the person; carry on from where you stopped.`, then one line per held answer
   `While you were asleep, the person answered your question: <question> → <answers>`, then
   `If you were waiting on an answer or a permission that is not above, ask again.` ("above", not the spec's "below":
   the line comes after the answers). It takes the held answers, so each reaches the agent once.
6. **One delivery.** `runWake`, when the block carried `agent:sleepasking` (read from the meta it already reads),
   delivers the nudge and the person's wake message as one message (nudge, a blank line, then the message), once the
   agent reports in. One turn: two back-to-back deliveries race the TUI's queued input. A wake with no mark delivers
   only the message, as today; a marked wake with no message (the Wake button, Clean Slate's undo) delivers the nudge
   alone. `wakeMarkedAwake`, when it clears a marked block's stale marks over a running process (not when it joins a
   wake in flight, which delivers its own nudge), delivers the nudge with the message the same way: the process was
   restarted without one, and it takes any answers held while the block really slept.
7. **The kept ask does not outlive the wake.** Before `runWake` restarts the process, a still-pending ask of the block
   that is marked Suspended (nobody answered it) is retired: claimed, its waiter (none) resolved cancelled, and a
   `Cleared` published, as `LivePendingAsks` retires one. The resumed agent asks again (the nudge says so), raising a
   fresh ask; an answer to the old one after the wake would type into a picker that is not there.
8. **Start fresh** (`fresh` wake) sends no nudge: the new session has no conversation to carry on. It drops the held
   answers (`agentask.TakeHeldAnswers`) and retires the kept ask as in call 7.
9. **`AgentPermissionAnswerCommand` refuses an answer for an asleep block** (`agent:sleeping` > 0 and
   `controllerExited`) with `agent is asleep; wake it and it will ask again`, before claiming the head. The request
   stays in the queue for the read-only card.
10. **Frontend: `sleepingOf` reads the mark** into `AgentVM.sleeping.asking?: boolean`. `liveAsk(ask, sleeping)` keeps
    the ask when `sleeping?.asking` is set and drops it for any other sleeping agent (the stale-ask reason in its
    comment still holds for those). `withAsk` then makes the vm `asking` and keeps `sleeping`, so lists and Needs you
    count it while Chat still draws the sleeping overlay and its Wake. `canSleep` (`consumers.ts`, the one rule behind
    the sidebar's Sleep, the Consumers panel and the palette) offers Sleep for an awake agent whose state is `asking`
    as well as `idle` (still never a working, an asleep, a run's or a non-resuming one), so the person can press it.
11. **Chat on a sleeping agent with a kept ask** draws the question with the same ask card an awake asking agent gets,
    answering through `AnswerAgentCommand`. On success, Chat keeps the answer in a per-block jotai atom (survives a
    surface switch) and shows it under the question's place with the line `Goes in when <name> wakes`; the atom is
    cleared when the agent is no longer sleeping. The composer's typed text on such an agent answers the question (the
    composer's existing typed-answer path), and with no question left Send wakes it as today.
12. **The permission card and the sidebar permission row of a sleeping agent with the mark** are read-only: the head
    request's summary (`permissionSummaryLine`) and how long it waited, and one Wake button (`wakeAgent`) in place of
    Allow / Deny. `cardShown` and `rowPermission`'s `shown` show them for `sleeping.asking`; a sleeping agent without
    the mark still shows none. The rule lives in `permissionmodel.ts`, read by both `permissioncard.tsx` and
    `permissionrow.tsx`.
13. **The CDP scenario is `sleep-keeps-ask`** (`scripts/cdp/scenarios-sleep-keeps-ask.mjs`, registered in
    `scripts/cdp/scenarios.mjs`). It uses a real tab with no controller whose block meta carries `agent:sleeping` and
    `agent:sleepasking`, and a real pending ask registered for that block in wavesrv, so the answer is really held
    (call 4) and the held line is real, not a fixture.
