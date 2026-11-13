# Chat follow-ups, fix round 1: the agent-chat scenario's six failing steps

**Effort:** effort:dc0dbfa4-9f2f-4e18-b037-9637441389ad
**Spec:** `docs/superpowers/specs/2026-11-12-chat-follow-ups-design.md` (the decisions for each chunk, with why)
**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat chat-redesign agent-sleep rail-transcript-tab`

Round 1's Final ran 122 steps and 116 passed. All six failures are in `agent-chat`: steps 22, 41, 43, 50, 52 and 53.
`chat-redesign`, `agent-sleep` and `rail-transcript-tab` passed every step. The Final's shots and details are in
`C:/Users/me/AppData/Local/dev.arc.app/data/final-shots/ac8bd0b8-80fb-4890-89d0-e865a94e2640/1/shots.json`.

The lead's reading, before this round (the worker confirms or corrects it):

- **41, 43 and 52: a send's Enter now lands up to 2 s after its text.** `f676ec1ff` (on the base, 2026-11-12) makes
  `submitToAgent` (`agentsubmit.ts`, `chatpending.ts` `submitSteps`) wait until Claude Code's box shows the text before
  it writes `"\r"`, at most `ECHO_WAIT_MAX_MS` (2,000 ms). The fixture block's screen never shows the typed text, so
  each send in the scenario writes its `"\r"` the full 2 s late. Steps that take a "before" mark or read the typed
  inputs right after a send see the wrong thing:
  - 41: `theme41` is `"\r"`. A late Enter from an earlier send lands after `before41`, and `acUntil` stops at it.
    `chat` shows `["\r", "theme:#1f1e1d"]`, with the theme's own `"\r"` not there yet.
  - 43: `typed43` is `["\r"]`, the same leftover. Task t-3 saw it in all three of its runs.
  - 52: `sentMcp52` is `["/mcp"]` and is read before its `"\r"`.
  - 21 and 42 failed the same way in the workers' runs and passed in Final by timing alone.
- **50 and 53: the `/` menu has an "In Chat" group**, added on the base by `44f8bef08` and `8540a48c3`. Step 50 expects
  `Built-in 12, Skills 2, Plugins 4, MCP 1` (19 rows). The live list is now In Chat 1 (`help`), Built-in 11, Skills 2,
  Plugins 4, MCP 1. Step 53 got groups In Chat 5, Built-in 17, Plugins 1 (23 rows).
- **22: ↑ in the empty box did not put back step 21's message** (`box22: ""`), although step 21 passed and its
  `[S21, "\r"]` reached the block. This run's changes to `chatcomposer.tsx` and `chateditor.tsx` do not touch ↑:
  `recallKey` in `chatcomposer.tsx` is unchanged from the base. One candidate is the base's `takeBackKey("ArrowUp")`,
  which runs before recall in an empty box (`chattakebackstore.ts`, "a message Claude has not taken"). The fixture
  never answers, so step 21's message may still count as untaken.

Plan-wide rules:
- Run focused tests only: `npx vitest run <file>`.
- Never prettier `scripts/*.mjs`.
- The machine is short of RAM: run the `agent-chat` scenario through `final-verify.mjs` at most twice. If it cannot run
  (exit 3), say so in the report and leave the proof to the Final.

### Task 1: agent-chat: settle each send's late Enter, the In Chat group in the `/` lists, and ↑ recall after a queued send
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios.mjs`, `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/chattakebackstore.ts`, `frontend/app/view/agents/chattakeback.ts`, `frontend/app/view/agents/chattakeback.test.ts`, `frontend/app/view/agents/chatpending.ts`, `frontend/app/view/agents/chatpending.test.ts`

Decisions (the lead's, for this round):

1. **The 2 s echo wait stays.** It is the base's fix for a message sent to an idle Claude going out joined to the next
   one, and the base's tests and CHANGELOG line cover it. The scenario adapts to it. Do not shorten
   `ECHO_WAIT_MAX_MS` or skip the wait for fixtures.
2. **The scenario waits for each send's Enter before it moves on.** Add one helper in `scenarios.mjs` beside
   `acInputs`. It waits until the block's last non-empty input is `"\r"`, or until no input has arrived for
   `ECHO_WAIT_MAX_MS` + 1 s, whichever comes first. Call it:
   - wherever a step takes a "before" mark of the block's inputs after an earlier step sent something;
   - wherever a step reads a send's inputs and expects a trailing `"\r"`.

   At least 21, 22, 41, 42, 43 and 52 need it, plus any other step in `agent-chat` with the same pattern; grep for
   `acInputs(` and `typedSince(`. Step 41's `acUntil` must wait for the theme's own `"\r"`: the typed text since the
   mark must start with `theme:`, not merely end with `"\r"`. Weaken no assertion: each step still checks the exact
   inputs it checked before.
3. **50 and 53 expect the `/` menu as it is on the base**, In Chat group included. First read `44f8bef08` and
   `8540a48c3` to confirm the group is intended. Then:
   - Step 50 asserts the group list it now gets (In Chat 1 `help`, Built-in 11, Skills 2, Plugins 4, MCP 1), 19 rows,
     and a footer that reads 19 commands. If the footer's count differs, assert what the code means it to say.
   - Step 53 asserts its groups with In Chat included, and its "N commands found on disk" footer matching the row
     count.
   - The step names (`rec` labels) are updated to say In Chat.
4. **22: find the cause before changing anything.** Read `recallKey`, `takeBackKey` and the take-back store, and
   decide which of these holds:
   - **(a) Product bug:** ↑ in an empty box swallows the key when nothing can be taken back, or treats a message Claude
     already received as untaken. Fix it in the product, with a vitest in `chattakeback.test.ts` or
     `chatpending.test.ts` for the pure part.
   - **(b) Base behaviour:** the take-back is meant to win here, because the fixture's Claude never takes the message.
     Make the step match that, either by letting the message count as taken (the fixture answers, or the step waits
     for what marks it taken) or by asserting the take-back, whichever the spec of `chattakebackstore.ts` says ↑ should
     do. Then make the step still prove that ↑ recalls the last sent message.

   Say in the report which case it was and why. A product change here is the lead's call, made now: fix it, if (a).

Acceptance:
- `node scripts/cdp/final-verify.mjs agent-chat` (with `ARC_FINAL_OUT` set to a scratch directory) passes every
  step, 22, 41, 43, 50, 52 and 53 included. Report the step count.
- A product change, if any, has its vitest passing.
- Every edit to `scenarios.mjs` keeps each step's existing assertions. The report lists any assertion whose expected
  value changed, with the line that justifies it.
- If the product changed (case (a) of decision 4), add one `Fixed` line under `## Unreleased` in `CHANGELOG.md`, and add
  `CHANGELOG.md` to what the task touches.

### Task 2: Hand-check lines for what no scenario step drives
**Depends on:** none
**Model:** sonnet
**Files:** `docs/hand-checks.md`

Add `- [ ]` lines to `docs/hand-checks.md`, in the file's existing format and section order:
1. **Brainstorm tab's own-words field.** Type an answer in a question's own-words field in the Brainstorm tab and send
   it. The row in Chat reads "You replied", not "You picked". The `useAnswer.sendDraft` path has no scenario step; Chat's
   own box does, in `chat-redesign` 14c.
2. **The pinned prompt band on the other `CompactTranscript` hosts.** In History's session detail, the sleeping agent's
   overlay and an ended agent's transcript, the band sits flush at the scroller's top with no clipped line above it. A
   jump lands just under the band. Only the rail transcript is covered by `rail-transcript-tab`.

Acceptance: the two lines are at the top of the list in `docs/hand-checks.md`, where the newest lines go. Each starts
`- [ ] (arcterm)` and says what to do, what you should see and where. Each names its commit as the file's header asks:
`b86ab9fa4` for line 1, `4671d8cea` for line 2, on run ebecc28f's branch.
