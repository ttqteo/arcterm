# Sleep an asking agent with its ask kept: fix round 1

**Effort:** effort:92be7081-f01c-4256-8af7-ffdb59533f46
**Spec:** `docs/superpowers/specs/2026-11-27-sleep-keeps-ask-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/agentask ./pkg/jarvis ./pkg/waveobj ./pkg/wshrpc/wshserver`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs sleep-keeps-ask sidebar-permission-row`

Final round 1 failed every step of `sleep-keeps-ask` with `{"chat":false}` / `{"row":false}`: its shots show the Agent
surface reading "No agents running". Cause, checked in the source: the scenario's block meta has no `cmd:cwd`, and the
sidebar counts a block as a session terminal only when it is `view: "term"` with a non-empty `cmd:cwd`
(`findSessionTermBlock`, `frontend/app/view/agents/session-models/sessionviewmodel.ts:179`). With no terminal block the
tab has no `termBlockOref`, so `liveAgentBaseAtom` (`liveagents.ts:60`) skips it and no row or Chat is drawn. The DOM
hooks the scenario reads all exist (`chatpane.tsx`, `sleepheldview.tsx`, `chatcomposer.tsx`, `permissioncard.tsx`,
`permissionrow.tsx`, `agenttree.tsx`). Task 2 takes two small defects in the feature the run's tasks and review found.
The two tasks share no file.

### Task 1: The sleep-keeps-ask scenario's tab reaches the roster
**Depends on:** none
**Files:** `scripts/cdp/scenarios-sleep-keeps-ask.mjs`

In `arrange`, give the block meta a `"cmd:cwd"` (a real directory: `"~"`, as `scenarios-chat-brainstorm-review.mjs:347`
does). After `focusAgent`, put the agent in Chat explicitly (`window.__arcChatMode.set(tabId, "chat")`, the hook in
`frontend/app/view/agents/chatmodestore.ts:93`), keeping the mode it had and putting it back in `teardown`. Then wait in
`arrange` (WAIT_MS) for the agent's row in the tree (`[data-agent-tree] [data-agent-row="<tabId>"]`) and for its Chat
layer (`[data-agent-chat="<tabId>"]`); when either never shows, set `ctx.arrangeError` to a line naming which one, so a
next failure says where it stopped instead of four `chat:false` steps. Leave the steps' assertions as they are. Never run
prettier on this file (hand-formatted 4-space). An Arc run agent runs no CDP: Final is the live pass.

Acceptance:
- The block meta written by `makeTab` holds a non-empty `cmd:cwd`, and the scenario sets and restores the Chat mode
  (read the file; `node --check scripts/cdp/scenarios-sleep-keeps-ask.mjs` passes).
- Final's `sleep-keeps-ask` passes its four steps, and `sidebar-permission-row` still passes.

### Task 2: A sleeping agent's kept question in the peek dot, and a stale-mark wake retires the kept ask
**Depends on:** none
**Files:** `frontend/app/view/agents/treepeekmodel.ts`, `frontend/app/view/agents/treepeekmodel.test.ts`, `pkg/wshrpc/wshserver/wshserver_agentsleep.go`, `pkg/wshrpc/wshserver/wshserver_agentsleep_test.go`

1. `dotOf` (`treepeekmodel.ts:39`) reads `vm.state === "asking" && !vm.sleeping`, so the collapsed sidebar's peek draws
   a sleeping agent that keeps its question (spec call 10: `withAsk` keeps it asking, `sleeping.asking` set) as idle.
   Make it asking when `vm.sleeping?.asking` is set; an agent asleep without the mark keeps its current dot.
2. `wakeMarkedAwake` (`wshserver_agentsleep.go:553`), on the path that clears stale marks over a running process (not
   the `joinWake` path), leaves a still-Suspended ask in the registry. With the marks cleared and the process running,
   `answerHeld` is false, so an answer to that old ask is typed into a picker the restarted process never drew. Call
   `retireKeptAsk` there before delivering the nudge, as `runWake` does (spec call 7). An ask no sleep suspended stays.

Acceptance:
- vitest: the peek dot of a sleeping vm in state `asking` with `sleeping.asking` is `asking`, and one asleep without the
  mark is not (`npx vitest run frontend/app/view/agents/treepeekmodel.test.ts`).
- Go: `wakeMarkedAwake` clearing a marked block's stale marks retires its Suspended unanswered ask (Cleared published,
  registry empty) and still delivers the nudge with the message; an unsuspended pending ask is left in place; joining a
  wake in flight retires nothing (`go test ./pkg/wshrpc/wshserver -run 'TestWakeMarkedAwake'`).
