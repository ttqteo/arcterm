# Pair judge UX, fix round 1: the reply under way at a token cap, and the three failing Final steps

**Spec:** `docs/superpowers/specs/2026-11-26-pair-judge-ux-design.md` ("Turns after a pause", item 2 as corrected)
**Verify:** `node scripts/verify.mjs ./pkg/agentpair/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-judge pair-conversation library-pairs pair-tree`

No attribution trailer in commits. Lint/format only the paths you touched; never run prettier on `scripts/*.mjs`. No CDP
in a worker: the round's Final runs the scenarios.

### Task 1: After a token cap, record the worker's answer to a message it still owes
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/agentpair/manager.go`, `pkg/agentpair/manager_test.go`, `docs/guide/agent-pair.md`
The person corrected the token-cap rule the main plan's Task 3 built (spec "Turns after a pause", item 2). In pair
e801794d the judge sent fixes at 10:59, the cap stopped the pair at 11:03 while the worker was still on that turn, and
its full answer arrived after the stop: today's `takeAnswer` (`manager.go`, the `from == FromWorker && p.State ==
StateStopped && p.StopReason == StopTokenCap` branch) would drop it.
- In `takeAnswer`, on a token-cap stop: compute `answeredBy(p, tab)` first. When it names a message, record the answer
  as any worker message (that `ReplyTo`, `msg.Held, p.Held = p.Held, nil`, `Seen[tab]`, append, `enqueue`), but do not
  call `resume`: the pair stays stopped at the token cap. When it returns "", keep today's branch: not recorded, not
  enqueued, `p.Held` untouched, `Seen[tab]` advanced and persisted. Other stops keep today's rule. Update the doc
  comment above `takeAnswer` to say so.
- New test `TestWorkerAnswerUnderWayAtTokenCapKept`: the judge sends the worker a message (delivered, so it is not in
  `Pending` for the worker), the cap then stops the pair, and then the worker's answer arrives. The answer is in the
  conversation with `ReplyTo` = the judge's message id, it is in the judge's queue, and the pair is still
  `StateStopped` / `StopTokenCap`. A second worker turn after it (nothing left to answer) is not recorded and moves
  `Seen`.
- `TestWorkerAfterTokenCapNotFollowed`, `TestManagerResumeNotByAWorkerReplyAfterTheTokenCap`,
  `TestReplyNeverQuotesAnAnsweredMessage` and `TestResumeKeepsAQueueForAnAgentAtWork` must still pass unchanged; if one
  breaks, say in the report why the new rule changes what it asserts before touching it.
- `docs/guide/agent-pair.md`, the paragraph under "Chạy tiếp" that starts "Vì vậy, sau một lần dừng ở token cap": add
  that the worker's answer to a message it was already working on when the pair stopped is still kept in the pair's
  conversation and queued for the judge, and does not resume the pair.
Acceptance: `go test ./pkg/agentpair -run 'TestWorkerAnswerUnderWayAtTokenCapKept|TestWorkerAfterTokenCapNotFollowed|TestManagerResumeNotByAWorkerReplyAfterTheTokenCap|TestReplyNeverQuotesAnAnsweredMessage|TestResumeKeepsAQueueForAnAgentAtWork|TestResumeAfterATokenCapDeliversTheKeptQueues'`.
This task changes no rendered view, so it adds no scenario step.

### Task 2: pair-conversation's header-paused step reads the header, not a start error
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-pair-conversation.mjs`
Final failed `pair-conversation` step "header-paused": the header state pill read "failed to start" in all four cases
(`{"no-new-points":"failed to start","token-cap":"failed to start","judges-gone":"failed to start","relaying":"failed to
start"}`). The fixture's blocks are not real agents, so a pane's refused controller start shows as "failed to start",
which wins over the state line. `scripts/cdp/scenarios-pair-header.mjs` (l.194-215) solves exactly this: `markFixture`
calls `setFixtureRoster(true)` from `agentcontrollerstore.ts` before the roster is set, `show()` waits until the header
has no `[data-agent-start-error]` and `data-header-labels === "words"`, and the roster mark is put back after
(`devMockAgentsAtom != null`). Do the same in pair-conversation's arrange (and its cleanup), and before the step reads
`headerState`, wait for the header to hold its words. Read the app's state line code (`agentheader.tsx` ~l.524-545,
`pauseHead`) to be sure the expected words are what it draws; change the scenario, not the app, unless the app is wrong
against the spec. Keep every other step of the scenario as it is.
Acceptance: `node --check scripts/cdp/scenarios-pair-conversation.mjs`; Final's `pair-conversation` step
"header-paused" is the live check.

### Task 3: pair-tree's row-resume-fails step reads the tooltip while the pointer is on the button
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-pair-tree.mjs`
Final failed `pair-tree` step 7 "row-resume-fails" on one check only: `failed7.resume.title` was `null` while every
other check passed (error line, polite live region, button enabled, retry). The app sets the title
(`agenttree.tsx` ~l.834, "Resume failed: …"), but the step reads it with the pointer on the button, and
`frontend/app/element/titletiphost.tsx` (l.30, l.80-85) lifts a hovered element's `title` into `data-arc-title` while
its tip shows. Make `readActions` (~l.620) read `getAttribute("title") ?? getAttribute("data-arc-title")`, so the step
checks the tooltip's words either way, and say in a comment why. Keep the step's assertion.
Acceptance: `node --check scripts/cdp/scenarios-pair-tree.mjs`; Final's `pair-tree` step 7 is the live check.

### Task 4: chat-judge step 11, the reading-to-done cross-fade
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatjudgeline.tsx`, `scripts/cdp/scenarios-chat-judge.mjs`, `docs/hand-checks.md`
Final failed `chat-judge` step "11. done with an added option (cross-fade)": over 53 frames in 709 ms the line's
`[data-chat-judge-body]` never held two children (`{"frames":53,"two":0,"last":{"t":709,"kids":[1]}}`); the rest of
step 11 passed. This run's Task 4 changed only words and the icon there (`git diff f924fbf97 HEAD --
frontend/app/view/agents/chatjudgeline.tsx`), so the failure likely predates the run: the step's line is the card look
(`look: "card"`, the last message's judge, added in `e66a99d4b`), and the cross-fade the file's header comment promises
("a state change cross-fades its text on the micro ease") may not reach the card's body, or the card body is not the
element the step samples. Find which: read `chatjudgeline.tsx` (the card branch, `rowFade`, `AnimatePresence`,
`[data-chat-judge-body]`) and the spec `docs/superpowers/specs/2026-11-25-chat-choice-judge-design.md` on the card's
motion. If the card drops the cross-fade the spec asks for, fix the component so reading→done cross-fades in the card
too (reduced motion still swaps at once: step 16 must keep passing). If the card cross-fades on another element, point
the step's sampling at it. Say which in the report. A motion you could not watch gets a `- [ ] (arcterm) …` line in
`docs/hand-checks.md`.
Acceptance: `node --check scripts/cdp/scenarios-chat-judge.mjs`; `npx vitest run frontend/app/view/agents/chatjudge.test.ts`;
Final's `chat-judge` steps 11 and 16 are the live check.
