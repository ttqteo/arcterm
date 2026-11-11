# Chat redesign — Final fix round 1

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-11-chat-redesign-design.md`
**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat chat-scroll-keep chat-redesign`
**Prototype:** D:\work\arcterm\.superpowers\design\chat-redesign\project\A-floating.dc.html

Final round 1 on the merged result (commit 4184352) passed 87 of 90 steps. Three failed; the shots and
`shots.json` are in `C:/Users/user/AppData/Local/dev.arc.app/data/final-shots/ef3edec8-5f79-41f0-a4c5-0e3153b22d99/1`.

- `agent-chat` 13b: `{"empty":"Starting Claude Code…Setting up a new conversation in arcterm","working":false,"box":false}`.
  It fails on `main` too: the step looks for `[data-agent-chat-composer] textarea`, and the box has been a Lexical
  contenteditable `[data-chat-input]` since the editor change.
- `chat-redesign` 8 "steps folded": `{"fold":"Worked for 6s · 7 tools","steps":0,"reply":false}`.
- `chat-redesign` 9 "type rhythm": `heading: null`; everything else in its detail is in range (prose 14px / 23.1px,
  root spacing -0.16px, bubble radius 16px). It fails only because the reply was not drawn yet when it read.

Rules for every task: the plan's original rules still hold (no `task dev`, no build, no `node scripts/verify.mjs`, no
whole vitest suite; `task check:ts` with a long timeout). Change no assertion's threshold or meaning: these are
waiting fixes and one stale selector, not lowered checks. Never run prettier on `scripts/*.mjs`.

### Task 1: chat-redesign steps 8 and 9 wait for the reply to land
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-chat-redesign.mjs`, `frontend/app/view/agents/chatconversation.tsx`

Step 8 (`scripts/cdp/scenarios-chat-redesign.mjs` ~508–523) appends the tool result and the reply (`REPLY`, which
opens with `## What changed`), then sets the roster idle, and waits only for the last fold to read `Worked for`. The
fold flips with the roster, before the transcript re-read draws the reply row, so the read that follows sees
`reply:false` and step 9 finds no heading. The Final screenshot `chat-redesign-9-type-rhythm.png` shows the reply's
`What changed` heading arriving at the bottom edge after step 9 had read, partly under the box.

Decisions:

- Step 8 waits (`polishWaitFor`, `WAIT_MS`) for both the fold reading `Worked for` and the layer's text containing
  `What changed`, then naps long enough for the arrival spring to finish (at least 600 ms: `MOTION.spring` is a
  0.35 s visual duration), scrolls to the end, and reads. Its pass condition stays exactly as it is.
- Step 9 reads only after that, so it needs no change unless the reply's heading is not an `h1`–`h4` inside the
  reply's `[data-chat-prose]`; if it is drawn otherwise, that is a DOM change to report, not a reason to loosen the
  step.
- If, with the wait in place, the reply row never appears within `WAIT_MS`, or it appears but stays clipped (its
  arrival height does not reach its full height, or the scroller does not follow it to the end while pinned), that is
  a product bug in Chat's arrival (Task 4's `AnimatePresence` / `springReveal` wrap in `chatconversation.tsx`): find
  the cause there and fix it in the product, not in the scenario. Do not change `useStickToBottom`.

Acceptance: `node --check scripts/cdp/scenarios-chat-redesign.mjs`; then run
`node scripts/cdp/final-verify.mjs chat-redesign` (this task's one allowed app run, up to three times): steps 8 and 9
pass in each run, and every other `chat-redesign` step still passes. In `chat-redesign-8-steps-folded.png` the
`What changed` heading is drawn in full above the box. If `chatconversation.tsx` changed, `task check:ts` is clean.

### Task 2: agent-chat step 13b reads the box the composer now has
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios.mjs`

`agent-chat` 13b (`scripts/cdp/scenarios.mjs` ~43162–43178) checks the box with
`l?.querySelector("[data-agent-chat-composer] textarea")`. Chat's box has no `<textarea>`: it is the Lexical
`[data-chat-input]` (`chateditor.tsx`), which step 13 on the same page already reads. The step fails on `main` as
well; it holds this run's land, so it is fixed here.

Decisions:

- Change that one selector to `[data-agent-chat-composer] [data-chat-input]`, after confirming in
  `chatcomposer.tsx` / `chateditor.tsx` on this tree that the input still sits inside `[data-agent-chat-composer]`
  (the floating box from Task 2 of the original plan restyled the composer). If it does not, use the selector that
  names the box's input the way step 13 does. Nothing else in 13b changes.
- Grep `scripts/cdp/scenarios.mjs` for any other `[data-agent-chat-composer] textarea` (or a bare `textarea` read
  inside a Chat layer); fix each the same way and list them in the report.

Acceptance: `node --check scripts/cdp/scenarios.mjs`; the selector change is the only diff besides any other stale
`textarea` reads found by the grep. Do not run the app: the engine's Final runs `agent-chat` on the merged result.
