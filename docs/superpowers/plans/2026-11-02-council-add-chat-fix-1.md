# Council add chat: fix round 1

Final `node scripts/cdp/final-verify.mjs council-discussion` failed 7 of 78 steps. Every add-chat step passed. The 7
are steps written before two base commits changed what they read, and `scripts/cdp/council/discussion.mjs` was not
updated with them:

- `58f8fb245` added `takeTurns` (`frontend/app/view/agents/councilchatmodel.ts:495`): the channel lists a round's
  ideas by seat in turn, not in the order they were posted. `councilChannel` on the room fixture gives `P1,P3,P4,P2`.
- `0e2b433cf` made a cited file one link on a draft card, so a draft's buttons now start with its evidence link
  (`railappsstore.ts:12`) before Send to the others, Edit and Drop.

### Task 1: Bring the stale council-discussion steps in line with the base

**Depends on:** none

**Files:** `scripts/cdp/council/discussion.mjs`

**Decisions:**

- Only `discussion.mjs` changes. No product code changes.
- Each failing step keeps what it checks, with its expectation changed to what the base's code gives. Derive each new
  order or text from the model (`councilChannel`, `takeTurns`, the draft card), not by copying what the run printed.
  Reword the step title when its words name the old behaviour ("in the order they were posted").
- The steps to fix:
  1. `round 2: six ideas in the channel (in the order they were posted)…` (line ~206): the ideas in `takeTurns` order.
  2. `room: dividers … four ideas (the dropped P5 is gone)…` (line ~882): P1, P3, P4, P2.
  3. `room: P2's chip reads … P4's names its waiting draft` (line ~901): it asserts no
     `[data-council-channel] [data-council-draft="r4"]`, but a held reply draft is a channel item today (the model
     gives `r4:reply`). Check in `councilChannel` that this is intended (it came in with `58f8fb245` or later on
     the base), then assert the draft card where it now sits. If it is not intended and is a product bug, leave the
     step failing and report it under Found not fixed. Do not loosen the step to hide it.
  4. `keys: j moves nothing with focus outside the channel; in it j / k move over the ideas …`: the j/k order follows
     the channel's idea order (P1, P3, P4, P2), stopping at the last.
  5. `keys: Enter opens the thread of the idea under the cursor`: the idea the cursor is on after step 4's walk.
  6. `keys: Esc closes it, and k moves the cursor again`: the idea before it in the new order.
  7. `room waiting on drafts: the two held ideas (P2, P3) are amber drafts …`: match the three draft buttons by their
     `data-council-draft-send` / `-edit` / `-drop` hooks (as the thread step at line ~957 does), not by the whole
     button list, so the evidence link before them no longer breaks it.
- No step is deleted, and no assertion stops checking what its title says.

**Acceptance:**

- `node scripts/cdp/final-verify.mjs council-discussion` passes every step, the add-chat steps included.
- The diff touches only `scripts/cdp/council/discussion.mjs`. It keeps the file's 4-space hand formatting (never run
  prettier on it).
