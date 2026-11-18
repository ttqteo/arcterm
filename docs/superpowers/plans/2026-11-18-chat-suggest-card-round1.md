# Chat summary line and usage-limit strip: final-stage fix round 1

**Goal:** Make the run's Final pass. `chat-summary-line` and `chat-limit-strip` passed (11/11). `agent-chat` failed in two
ways, both already on this run's base (`3efb8d963`) and outside the run's goal; the land is held on them all the same:

1. The cockpit blanks before the first step ("nav button "Agent" not found"), because `AgentHeader` calls a hook
   behind `handable &&` (`frontend/app/view/agents/agentheader.tsx:618`). When the header moves between agents, the
   hook order shifts and React throws `TypeError: number … is not iterable`. `main` has already fixed this in
   `7778f1559` ("fix(agents): the header reads the remote status on every draw"), which this branch does not have.
2. With that fixed, the t-5 worker saw 5 of 85 `agent-chat` steps fail with and without this run's commits:
   - 4: the working line, its turn card and Stop. The line read `Working(59m 2s)`.
   - 26a and 26: the running stretch is never drawn (`stretchUp:false`).
   - 76: `!git l` does not put the box into bash mode (`typed76.mode:false`).
   - 88: a click on the card's client.ts row leaves `surface:"agent"` instead of opening Diff.

**Architecture:** Task 1 ports `main`'s header fix as it stands, so that when the run lands, the merge with `main` sees
the same change on both sides. Task 2 runs `agent-chat` on top of it and fixes each of the 5 steps at its root cause.

**Tech stack:** React 19 + jotai, CDP scenarios (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-18-chat-suggest-card-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/chatsuggest/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-summary-line chat-limit-strip agent-chat`

### Task 1: The agent header reads the remote status on every draw
**Depends on:** none

Port `main`'s commit `7778f1559` onto this branch: `git cherry-pick 7778f1559`, or the same change by hand if the pick
does not apply cleanly. The fix reads `useAtomValue(remoteStatusAtom)` on every draw, outside `handable &&`, and adds
that commit's comment and its `CHANGELOG.md` Fixed line. Keep both as `main` has them, word for word, so that the land's
merge with `main` resolves the same text on both sides. Change nothing else in the header.

**Files:** `frontend/app/view/agents/agentheader.tsx`, `CHANGELOG.md`

**Acceptance:**
- `agentheader.tsx` calls no hook after a `&&`, `?:` or early return in `AgentHeader`'s body. Check this by reading the
  body around the Hand to phone lines.
- `git diff 7778f1559^ 7778f1559 -- frontend/app/view/agents/agentheader.tsx` and this task's diff of that file are the
  same change.
- `task check:ts` passes.
- Scenario: `agent-chat` gets past its arrange and reaches its numbered steps, with no "nav button "Agent" not found"
  error. Run it with `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs agent-chat`; other steps may still fail,
  since Task 2 owns them.

### Task 2: agent-chat steps 4, 26a, 26, 76 and 88 pass
**Depends on:** Task 1

Run `agent-chat` on top of Task 1 (`ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs agent-chat`; one run takes
about 5 minutes) and read each failing step's recorded values. For each of the 5 steps:

- First check whether `main` already fixed it (`git log 3efb8d963..main` over the files the step reads). If it did, port
  that fix as `main` has it, as in Task 1, so the land's merge sees the same change on both sides. Name the commit in
  your report.
- Otherwise find the root cause and fix the product. Change a step's assertion only when the product's current
  behaviour is the intended one: a later commit or spec decided it, and you name that source in your report. Never
  widen a wait or loosen a check just to make a step pass.
- If this run's own work caused a failure (the usage-limit strip, the summary line, or the
  `chatpane.tsx`/`chatcomposer.tsx` wiring), fix it in this run's code. For example, a real strip drawn above the
  composer might move what a step clicks or reads.

Starting points (not conclusions): step 4 is the working line and Stop in `chatpane.tsx`. Steps 26a and 26 are the
running stretch, `data-fold-state="running"` in `chatstepsview.tsx` and `chatsteps.ts`. Step 76 is bash mode,
`data-chat-bash-mode` in `chatcomposer.tsx`. Step 88 is the turn-files card row, `chatturnfiles.tsx`, opening Diff
through `openref.ts`.

**Files:** `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/chatstepsview.tsx`,
`frontend/app/view/agents/chatsteps.ts`, `frontend/app/view/agents/chatsteps.test.ts`,
`frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/chatturnfiles.tsx`, `scripts/cdp/scenarios.mjs`.
A root cause that sits in another file is fixed there, and that file is named under "Differs from plan" in the report.

**Acceptance:**
- Scenario: `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs chat-summary-line chat-limit-strip agent-chat`
  passes every step of all three scenarios: steps 4, 26a, 26, 76 and 88 of `agent-chat`, and no step that passed
  before now fails.
- Any pure logic changed for a fix gets a vitest case beside it that fails without the fix. For example, a running
  stretch's state in `chatsteps.test.ts`.
- `task check:ts` passes.
- The report names, for each of the 5 steps, its root cause, whether `main` already had the fix, and whether this run's
  work was involved.
