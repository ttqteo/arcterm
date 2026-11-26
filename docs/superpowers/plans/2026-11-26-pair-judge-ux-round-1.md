# Pair judge UX, fix round 1: keep the reply under way at a token cap

**Spec:** `docs/superpowers/specs/2026-11-26-pair-judge-ux-design.md` ("Turns after a pause", item 2 as corrected)
**Verify:** `node scripts/verify.mjs ./pkg/agentpair/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-judge pair-conversation library-pairs pair-tree`

No attribution trailer in commits. Lint/format only the paths you touched.

### Task 1: After a token cap, record the worker's answer to a message it still owes
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/agentpair/manager.go`, `pkg/agentpair/manager_test.go`, `docs/guide/agent-pair.md`
The person corrected the token-cap rule Task 3 of the main plan built (spec "Turns after a pause", item 2). In pair
e801794d the judge sent fixes at 10:59, the cap stopped the pair at 11:03 while the worker was still on that turn, and
its full answer arrived after the stop: today's `takeAnswer` (`manager.go`, the `from == FromWorker && p.State ==
StateStopped && p.StopReason == StopTokenCap` branch) would drop it.
- In `takeAnswer`, on a token-cap stop: compute `answeredBy(p, tab)` first. When it names a message, record the answer
  as any worker message (that `ReplyTo`, `msg.Held, p.Held = p.Held, nil`, `Seen[tab]`, append, `enqueue`), but do not
  call `resume`: the pair stays stopped at the token cap. When it returns "", keep today's branch: not recorded, not
  enqueued, `p.Held` untouched, `Seen[tab]` advanced and persisted. Other stops keep today's rule. Update the doc
  comment above `takeAnswer` to say so.
- New test `TestWorkerAnswerUnderWayAtTokenCapKept`: the judge sends the worker a message (delivered, so it is not in
  `Pending` for the worker), the cap then stops the pair (the judge's reply turn or a settle that crosses the cap), and
  then the worker's answer arrives. The answer is in the conversation with `ReplyTo` = the judge's message id, it is in
  the judge's queue, and the pair is still `StateStopped` / `StopTokenCap`. A second worker turn after it (nothing left
  to answer) is not recorded and moves `Seen`.
- `TestWorkerAfterTokenCapNotFollowed`, `TestManagerResumeNotByAWorkerReplyAfterTheTokenCap`,
  `TestReplyNeverQuotesAnAnsweredMessage` and `TestResumeKeepsAQueueForAnAgentAtWork` must still pass unchanged; if one
  breaks, say in the report why the new rule changes what it asserts before touching it.
- `docs/guide/agent-pair.md`, the paragraph under "Chạy tiếp" that starts "Vì vậy, sau một lần dừng ở token cap": add
  that the worker's answer to a message it was already working on when the pair stopped is still kept in the pair's
  conversation and queued for the judge, and does not resume the pair.
Acceptance: `go test ./pkg/agentpair -run 'TestWorkerAnswerUnderWayAtTokenCapKept|TestWorkerAfterTokenCapNotFollowed|TestManagerResumeNotByAWorkerReplyAfterTheTokenCap|TestReplyNeverQuotesAnAnsweredMessage|TestResumeKeepsAQueueForAnAgentAtWork|TestResumeAfterATokenCapDeliversTheKeptQueues'`.
This task changes no rendered view, so it adds no scenario step.
