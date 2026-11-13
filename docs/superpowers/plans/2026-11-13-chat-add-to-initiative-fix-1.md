# Add to an initiative from Chat, fix round 1: `agent-chat` step 42

**Goal:** The merged result passes Final. Round 1 failed one step of 85: `agent-chat` step 42 (a second click on the
arc-visual's `#ask` "at once" must go into the box). Every other step passed, `chat-initiative`'s twelve included.

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-12-chat-add-to-initiative-design.md`
**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-initiative agent-chat`

## What failed, and what is known

Step 42 (`scripts/cdp/scenarios.mjs` ~l.44724) clicks `#ask` in the `chart.html` frame, waits until the block's typed
input starts with the prompt, clicks again, and expects the second prompt in the box (`promptAction` in `chatvisual.ts`:
a prompt within `PROMPT_GAP_MS` = 1500 ms of the frame's last accepted one is a `fill`). The record: the first prompt was
sent and its pending bubble shown, but the second click came 3144 ms after the first, past the gap, and the box was empty
(`box42: ""`). In the five earlier Finals that ran this step (runs ac8bd0b8, ef3edec8, 329a44d9, 2c1aa40f) the gap was
168 to 442 ms. So in this run the first prompt's text took about 3 s to reach the block, where it used to take well under
half a second. The step's code is unchanged by this run.

Checked by the lead, not the cause on reading: the send path change (`useAgentSend.send(lines?)`, the composer
in `chatcomposer.tsx` taking `takeResultLines`, which only reads localStorage); `ChatInitiativeHost` wrapping the
conversation (`chatconversation.tsx` ~l.1226) switches on `canAddInitiative = !!model && !!agent`, which does not flip
while a conversation is mounted; the `DrawnItem` reuse flag `initiative` is the same boolean. Not ruled out: machine load
during Final (the typecheck may have run beside it), a re-render or remount of the reply holding the visual that this run
causes in another way, or the host's effort reads (`useInitiativeCards`, `loadEffortDetail`) delaying the first send.

## Tasks

### Task 1: Step 42 passes, with its cause found

**Depends on:** none

**Files:** `scripts/cdp/scenarios.mjs`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatinitiativecard.tsx`

These are the likely files: in the scenario, step 42 of `agent-chat` only; another file is fine when the cause is there.

Measure before changing anything. Run the Final narrowed to `agent-chat` on this tree three times
(`node scripts/cdp/final-verify.mjs agent-chat`) and note step 42's `gapMs` each time. Then:

- If the gap stays above about 1 s on this tree, this run caused it: find what delays the first prompt's text reaching
  the block (time the click, `submitIntoChatBox`, `send` and the `submitToAgent` input; check whether the frame or the
  reply holding it remounts, e.g. a `data-chat-item` element replaced between the clicks, or the iframe's `load` firing
  again), fix that in the product, and keep step 42 as it is.
- If the gap is back under 500 ms every time, the failure was load on the machine. Then make the step measure what it
  claims and stop depending on how fast the terminal echoes: the second click is timed from the first prompt's
  acceptance, so make it as soon as the first send has visibly happened in the app (the pending bubble for the prompt, or
  the box emptied by the send, both set in the click's own handler), not after the text reaches the block. Keep every
  assertion (the first prompt typed once with its Enter, its pending bubble, nothing more typed, the box ending with the
  prompt), and record `gapMs` as now. Do not widen `PROMPT_GAP_MS`.

In either case run `node scripts/cdp/final-verify.mjs chat-initiative agent-chat` once at the end and get every step
of both passing. Report the three measured gaps and which branch you took under Done.
