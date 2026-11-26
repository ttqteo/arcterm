# Pair judge round, fix round 1: the conversation's Judge again collides with the tree's, and Wake offers an arbitrary resting judge

**Spec:** `docs/superpowers/specs/2026-11-26-pair-judge-round-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/agentpair ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs pair-tree pair-header pair-conversation library-pair-open`
**Prototype:** D:\work\arcterm\.superpowers\design\pair-judge-round\project\D-line-inside-worker.dc.html

Round 1's Final failed on two points. Principles: KISS, YAGNI, DRY, one source of truth, handle errors at boundaries and never swallow them.

### Task 1: The tree line's Judge again gets its own attribute
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/pairjudgelineview.tsx`, `scripts/cdp/scenarios-pair-tree.mjs`

What failed: scenario `pair-conversation` threw after step `7-pause-card` with `TypeError: Cannot read properties of null (reading 'value')`. The cause is at `scripts/cdp/scenarios-pair-conversation.mjs:559-562`: `document.querySelector("[data-pair-judge-again]")` now finds the ⚖ line's button in the Agent tree (`pairjudgelineview.tsx:178`), which comes before the pause card's button (`pairpausecard.tsx:120`) in the DOM. The tree button is faded out with `pointer-events: none`, so the click lands on the worker's row, the centre goes to the terminal, and `[data-pair-composer]` is gone.

Fix: one attribute, one meaning. Every other button on the tree line already has a name of its own (`data-pair-judge-resume` against the card's `data-pair-resume`, and likewise `-error`, `-words`, `-tokens`), so rename only the tree line's Judge again from `data-pair-judge-again` to `data-pair-judge-rerun`. Change it in `pairjudgelineview.tsx` and in every place `scenarios-pair-tree.mjs` names it (the header comment near line 31, `BTN_AGAIN` near line 559, `btn(...)` near line 691). The pause card keeps `data-pair-judge-again`, and `pair-conversation` and `library-pair-open` read it unchanged. Before finishing, grep the whole repo for `data-pair-judge-again`: it must remain only in `pairpausecard.tsx` and the conversation and library scenarios.

Acceptance: `task check:ts` is clean. Final's `pair-conversation` steps `judge-again` (a press on the card's Judge again leaves "@judge " in the focused composer) and the steps after it run and pass, and `pair-tree` steps `line-stopped` and `row-judge-again` still pass with the renamed button. This task runs no CDP itself (AGENTS.md: an Arc-run agent's only live pass is the run's Final).

### Task 2: Resting lists a worker's judges newest first
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/agentpair/rest.go`, `pkg/agentpair/rest_test.go`

What failed: the end review found that `Manager.Resting()` (`pkg/agentpair/rest.go`) sorts by `WorkerTab` and then by the judge's `Tab`, which is a random UUID. The frontend (`pairlaunch.ts` `restingJudgeOf`, `pairmodel.ts` `hiddenJudgesOf`) takes a worker's first entry as its newest resting judge, as the spec's "Add judge offers the sleeping judge first" needs, and its comments say the server lists newest first. So when a worker has two resting judges (round 1 launched judge A; round 2 opened a new judge B; both rounds ended), Wake offers whichever tab id sorts first.

Fix: within one worker, sort by the ended pair's `createdTs` (already on `tabLast`), newest first, and break a tie by tab, so the order is fully determined. Carry `createdTs` beside each entry while sorting; the wire type `PairResting` does not change. Update `Resting`'s doc comment to say the order.

Acceptance: a new test in `rest_test.go` gives one worker two launched judges in two pairs that both ended, where the newer pair's judge tab sorts after the older one's (for example the older pair's judge is `j1` and the newer pair's is `j2`). It asserts that `Resting()` lists the newer pair's judge first, and that the order holds after a restart (a fresh `r.manager()` reading the files). Run `go test ./pkg/agentpair -run '^TestResting'`.
