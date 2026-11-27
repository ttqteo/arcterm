# Sleep an asking agent with its ask kept

**Effort:** effort:92be7081-f01c-4256-8af7-ffdb59533f46
**Spec:** `docs/superpowers/specs/2026-11-27-sleep-keeps-ask-design.md` (its "Builder's calls" section settles what each task relies on; tasks cite the calls by number)
**Verify:** `node scripts/verify.mjs ./pkg/agentask ./pkg/jarvis ./pkg/waveobj ./pkg/wshrpc/wshserver`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs sleep-keeps-ask sidebar-permission-row`

The two tasks share no file and run side by side. Task 2 reads the asking mark as the literal meta key
`agent:sleepasking` (sleepingOf takes a plain record), so it needs nothing Task 1 generates; its scenario's held answer
relies on Task 1's `answerHeld` rule (call 4), which Final sees on the merged result.

### Task 1: Sleep, hold and wake an agent that waits on the person (Go)
**Depends on:** none
**Chunk:** Sleep an asking or permission-waiting agent with its ask kept (sleepRefusal refuses it today)
**Files:** `pkg/waveobj/wtypemeta.go`, `pkg/waveobj/metaconsts.go`, `frontend/types/gotypes.d.ts`, `pkg/agentask/agentask.go`, `pkg/agentask/agentask_test.go`, `pkg/wshrpc/wshserver/wshserver_agentsleep.go`, `pkg/wshrpc/wshserver/wshserver_agentsleep_test.go`, `pkg/wshrpc/wshserver/wshserver_agentperm.go`, `pkg/wshrpc/wshserver/wshserver_agentperm_test.go`, `pkg/jarvis/pausenudge.go`, `pkg/jarvis/pausenudge_test.go`, `pkg/jarvis/attention.go`, `pkg/jarvis/attention_askprune_test.go`, `CHANGELOG.md`
**Files:** `pkg/wshrpc/wshserver/wshserver_agentsleepafterrun.go`, `pkg/wshrpc/wshserver/wshserver_agentsleepafterrun_test.go`, `pkg/wshrpc/wshserver/wshserver_pair.go`, `pkg/wshrpc/wshserver/wshserver_pair_test.go`

Builds calls 1–9: the `agent:sleepasking` meta key (add to `wtypemeta.go`, run `task generate`, never hand-edit its
outputs), `Registry.Unsuspend`, `awaitsPerson`, the `sleepRefusal` / `AgentsSleepCommand` / `sleepAgent` changes, the
jarvis "asleep with its ask kept" test in `LivePendingAsks` and `answerHeld`, `jarvis.SleptNudge`, the wake's single
delivery, retiring the kept ask at a wake, Start fresh, and the permission answer refusal. The idle sleep loop keeps
skipping asking rows (no change in `wshserver_agentsleeploop.go`). Add the CHANGELOG line under `Changed` in the top
section: "Sleep now works on an agent that is asking you a question or waiting for a permission: its question waits
for you, an answer you give while it sleeps reaches it when it wakes."

Acceptance, each a focused test:
- `sleepRefusal` lets an asking row (open ask) and a permission-waiting row (status Waiting) through, and still refuses
  a working, an asleep, a run's and a non-resuming row (`go test ./pkg/wshrpc/wshserver -run 'TestSleepRefusal'`).
- The sleep after a run and a pair round's Sleep still refuse an asking or permission-waiting agent, now with the
  `waiting on the person` error (call 2): update the existing cases in `wshserver_pair_test.go` ("an agent that asks
  the person") and `wshserver_agentsleepafterrun_test.go` ("waiting on a permission") to that error, and add an
  open-ask case to each (`-run 'TestPair.*Sleep|TestSleepAfterRun'`).
- `AgentsSleepCommand` on an asking Claude row with a stream does not compact first; `sleepAgent` on it calls
  `Suspend` before `destroyBlock` and writes `agent:sleepasking: true` in the same meta write as `agent:sleeping`; a
  failing meta write leaves the ask unsuspended and nothing destroyed; an idle row gets no suspend and its write sets
  `agent:sleepasking` to nil (`-run 'TestSleepAgent.*Ask|TestSleepAsking'`).
- `runWake` on a marked block delivers one message, the nudge with held answers then the person's message, and clears
  the mark with the other marks; a marked wake with no message delivers the nudge alone; a fresh wake delivers no
  nudge and drops the held answers; an unmarked wake delivers only the message; a suspended unanswered ask is retired
  (Cleared published) before the restart; `wakeMarkedAwake` clearing a marked block's stale marks delivers the nudge
  (taking held answers) with the message, and joining a wake in flight adds no second nudge
  (`-run 'TestWake.*Asking|TestWakeRetiresKeptAsk|TestWakeMarkedAwake.*Asking'`).
- `AgentPermissionAnswerCommand` for an asleep block is refused and the queue is untouched
  (`-run 'TestPermissionAnswerAsleep'`).
- `LivePendingAsks` keeps the ask of a block with `agent:sleeping` + `agent:sleepasking` and a Done process, and still
  prunes an idle-slept block's ask; `answerHeld` is true for the marked block, false when its process runs (stale mark)
  and false without the asking mark (`go test ./pkg/jarvis -run 'TestLivePendingAsks.*Sleep|TestAnswerHeld.*Sleep'`).
- `SleptNudge` writes the three parts in order, one line per held answer, and takes them (a second call has none)
  (`-run 'TestSleptNudge'`); `PausedNudge`'s existing tests still pass on the shared line format.
- `Registry.Unsuspend` clears the mark and `SuspendedAsk` reads false after it (`go test ./pkg/agentask -run 'TestUnsuspend'`).

### Task 2: A sleeping agent's question and permission in Chat (frontend + scenario)
**Depends on:** none
**Files:** `frontend/app/view/agents/agentsleep.ts`, `frontend/app/view/agents/agentsleep.test.ts`, `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/agentsviewmodel.test.ts`, `frontend/app/view/agents/liveagents.ts`, `frontend/app/view/agents/sleepheld.ts`, `frontend/app/view/agents/sleepheld.test.ts`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/sleepingtranscript.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/permissionmodel.ts`, `frontend/app/view/agents/permissionmodel.test.ts`, `frontend/app/view/agents/permissioncard.tsx`, `frontend/app/view/agents/permissionrow.tsx`, `scripts/cdp/scenarios-sleep-keeps-ask.mjs`, `scripts/cdp/scenarios.mjs`
**Files:** `frontend/app/view/agents/consumers.ts`, `frontend/app/view/agents/consumers.test.ts`

Builds calls 10–13: `sleepingOf` reads `agent:sleepasking` into `sleeping.asking`; `liveAsk` keeps the ask of a
sleeping agent with that mark (update its caller in `liveagents.ts`); Chat draws the kept question on a sleeping agent
with the ask card an awake one gets and keeps the held answer in a per-block atom (`sleepheld.ts`, pure line logic
tested beside it) shown as `Goes in when <name> wakes`, cleared once the agent is awake; the composer's typed text on
such an agent answers the question; the permission card and the sidebar permission row of a marked sleeping agent are
read-only with one Wake button, the rule in `permissionmodel.ts`. Colors from `@theme` tokens, motion as DESIGN.md
says; follow the arc:ux-check code steps (no CDP in a run agent: Final is the live pass).

Acceptance:
- vitest: `sleepingOf` with and without the mark; `liveAsk` keeps a marked sleeping agent's ask and drops an unmarked
  sleeping agent's; `withAsk` on a marked sleeping vm reads asking and keeps `sleeping`; `cardShown` / `rowPermission`
  show read-only for a marked sleeping agent and nothing for an unmarked one; the held-line text and clearing rule in
  `sleepheld.test.ts`; `canSleep` is true for an awake `asking` agent and still false for a working, an asleep
  (marked or not), a run's and a non-resuming one (call 10) (`npx vitest run frontend/app/view/agents/agentsleep.test.ts frontend/app/view/agents/agentsviewmodel.test.ts frontend/app/view/agents/permissionmodel.test.ts frontend/app/view/agents/sleepheld.test.ts frontend/app/view/agents/consumers.test.ts`).
- Scenario `sleep-keeps-ask` (call 13), with a shot per step: `question` (Chat on the sleeping agent shows its kept
  question beside the Asleep line and Wake), `held` (an option picked on the ask card; the answer and
  `Goes in when … wakes` show and the question card is gone; the RPC was accepted, not refused), `permission` (a
  marked sleeping agent with a permission request fixture: the card shows the summary and Wake, no Allow / Deny), and
  `row` (the same agent's sidebar row shows Wake, no Allow). Scenario `sidebar-permission-row` still passes for an
  awake agent.
