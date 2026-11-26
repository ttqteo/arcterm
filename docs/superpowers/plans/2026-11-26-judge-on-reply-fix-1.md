# Judge on a reply, fix round 1: the chat-judge-reply scenario's six failing steps

**Spec:** `docs/superpowers/specs/2026-11-26-judge-on-reply-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/agentpair ./pkg/agentsessions ./pkg/wshrpc/... ./pkg/orchestrate`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs pair-header chat-judge-reply chat-pair-relay pair-conversation`

Final round 1 ran 48 steps: 42 passed. `pair-header`, `chat-pair-relay` (steps 7/7b included) and `pair-conversation` pass; all six failures are `chat-judge-reply`'s (step 0, its setup, passes). The shot `cdp-shots/chat-judge-reply-live-bar.png` shows the mark drawn as the spec asks: the line under the third reply, Open pair at its end, the accent bar hung left of the column and unbroken from that reply down. So most of the failures are in what the scenario measures, but two are not explained yet.

### Task 1: Make chat-judge-reply pass: the bar's drawn check, the line opening on the spring, the reduced-motion colour check
**Depends on:** none
**Model:** opus
**Files:** `scripts/cdp/scenarios-chat-judge-reply.mjs`, `frontend/app/view/agents/chatpairmark.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/pairmark.ts`, `frontend/app/view/agents/pairmark.test.ts`, `docs/hand-checks.md`

**Live runs allowed in this task.** The lead decided this, overriding AGENTS.md's "an agent an Arc run started runs no CDP" for this one fix. The Final has already run, the failures below are not explained from the code alone, and a blind fix risks the last Final round. Run only the narrowed command `ARC_FINAL_OUT=<a temp dir> node scripts/cdp/final-verify.mjs chat-judge-reply`, as often as you need. Read the step `detail` JSON and the shots it writes. Don't run the other scenarios: the run's Final does that.

What failed, from the round-1 Final (each step's detail is quoted where it matters):

1. **`span.drawn` is false in `reading-line`, `live-bar`, `ended-mark` and `two-rounds`.** In each of these steps every other check in that step passed. Only `two-rounds` was partly unread; see point 2. `barSpan` compares the covered rows' computed `::before` against exact strings (`position "absolute"`, `width "2px"`, `left "-12px"`, `top "0px"`, `bottom "-16px"`), and at least one value differs. Pixels are hard to call from the shot alone. Find which property differs:
   - Put the first covered row's computed `before` values into each step's detail. Today the detail drops them.
   - If the bar really sits where the spec says (2px wide, 12px left of the column, reaching 16px under the row), compare the values numerically with a 0.5px tolerance.
   - If the bar is off, fix `pairBarClass` in `chatpairmark.tsx`.
   - Either way, keep the detail carrying the measured values.
2. **`two-rounds`.** The detail shows the step otherwise right: both lines are under the third reply, the older above, both line rows carry `round-b`, `spanA.count` is 0, and spanB runs from the third reply to the bottom. Only `spanB.drawn` failed, so fixing point 1 should pass it. Confirm this on a live run, because the gap check never ran for the newer line (gap 42).
3. **`motion`, the opening half (real).** A round starting under a reply already drawn did not open. In every sampled frame (671 frames) the line row was at its full 25.7px height and opacity 1. The colour easing and the cross-fade on ending passed (19 colours from accent to grey, 11 cross-fade frames). The spec's motion rules say a new round's line opens on the spring, so this is a product defect unless a live run shows the sampler misses it.
   - Where the decision is made: `chatconversation.tsx` passes `arrive={!still && drawnBefore.has(item.key) && !lastDrawn.current.marks.has(line.pairId)}`, and `ChatPairMarkLine` opens only when `arrive && !reduce`.
   - Find which term is false on the render where the round-c line first mounts. Candidates: `still` (`catchingUp` after the step's earlier trip to Library and back), the Chat layer or `ChatConversation` remounting when the agent becomes paired (its key is `view.path:view.epoch`), the line mounting before its item is in `drawnBefore`, and the view loading in a later render.
   - Fix the cause in the component, not by loosening the step.
   - A first load, Show earlier or a restored place must still draw lines at once, as rows do.
4. **`motion (reduced)`.** It saw only the grey colour (`colors: ["rgb(102, 102, 102)"]`) where the step wants exactly two colours, accent then grey. With no transition the bar changes in the same commit as the seed, so the sampler can miss the accent frame. That is a measurement issue, not a defect. Change the check to "every sampled colour is the accent or the grey, and the last is the grey". That is the spec's "no colour between" requirement. Keep the other reduced checks as they are.
   - If point 3's fix changes the order of first-mount frames, the reduced open check (full height in the first frame) must still pass.

- Don't weaken a check the UI should meet, the goalpost guard. Each change to an assertion in `scenarios-chat-judge-reply.mjs` goes under "Differs from plan" with the reason the old check measured wrongly.
- If a fix changes `pairmark.ts`, add a test for it in `pairmark.test.ts`.
- Once the motion step passes live, mark t-5's motion hand-check line for the mark in `docs/hand-checks.md` as watched by the scenario. Keep it if the scenario does not watch the motion it names.
- Acceptance:
  - All seven `chat-judge-reply` steps pass on `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs chat-judge-reply`; quote its last lines in your report.
  - `task check:ts` is clean.
  - `npx vitest run frontend/app/view/agents/pairmark.test.ts` passes.
  - `npx eslint` and `npx prettier --check` are clean on the touched `.ts`/`.tsx` files. Don't run prettier on the `.mjs` file.
