# Clickable prototypes, Final round 1 fixes: the brainstorm scenarios' sends and two proto-pane checks

**Spec:** `docs/superpowers/specs/2026-11-27-prototype-feedback-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/canvasserve ./pkg/storage ./pkg/orchestrate ./skills`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs proto-chips proto-pane proto-rail brainstorm-board-pick canvas-tabs brainstorm-mode`

Lead's notes for every worker: the run's Final failed at commit `9a37235` with 75 of 104 steps passing. Every step's
detail is in `C:/Users/me/AppData/Local/dev.arc.app/data/final-shots/b9bb5ec0-5185-4064-94da-80cb29c3da74/1/shots.json`
(one entry per scenario, `steps[]` with `step`, `state`, `detail`), with `cdp-shots/` beside it; read the failing
steps there before you change anything. proto-chips, proto-rail and canvas-tabs passed in full. You run no CDP
scenario yourself (`ARC_RUN_AGENT` is set; the round's Final is the live pass), so reason from the details and the
code, and say in your report which steps you expect to pass and why. Fix the cause, never loosen a check to pass.
Don't hand-format `scripts/*.mjs` with prettier.

### Task 1: brainstorm-mode and brainstorm-board-pick: a line sent to the agent reaches it again
**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-brainstorm-board-pick.mjs`

Every step that sends a line through `agentprompt` fails with the call recorded and nothing in the terminal
(`"sent":[{...}]`, `"inTerminal":false`): brainstorm-mode 2e0, 2e, 2g, 2s, 2h, 2i, 2k, 2l4, 5b, 5c, 7d, and
brainstorm-board-pick 5. The lead's reading, to confirm in the code: since `bf0ca5492` (2026-11-16, before this run)
`AgentPromptCommand` refuses a block whose shell is running with nothing under it (`unreachablePrompt`,
`pb.AgentGone`, `shellHoldsNothing` in `pkg/wshrpc/wshserver/wshserver_agentmsg.go`), and these scenarios' agent is a
plain terminal at its PowerShell prompt (step 0: `lastRow` `PS C:\Users\me>`). The refusal is the product's
intended behavior, so the fixture is what changes: the agent terminal these two scenarios send to holds a native
child process that reads its input and echoes it (for example a nested `powershell -NoLogo -NoProfile`, or `cmd`),
started and waited on in their arrange, so a send is typed and the terminal shows it, and step 0's "at its shell's
prompt" still holds. Put it where both scenarios' arrange reaches it, without changing what other scenarios that share
the helper see (if the helper is shared wider, add it as an option those two pass).

Then go through the rest of brainstorm-mode's failures and fix each one's cause:
- The steps that follow a send and read its effect (2k2, 2k3, 2l, 4, 2l4's `closed`, board-pick 5's `dialog`,
  `working` and `answerBox`) should pass once the send lands: confirm each one reads the result of a delivered send,
  and fix any that does not.
- Steps 2 and 2b: `s2.history` is empty (2b's detail is `[]`; step 2's `bsUntil` waited 7 s for
  `history.length === 4`) though the `mid` file carries `BS_HISTORY`, and the rail head reads "Decided so far". Find
  why the history rows are not read: the reader in `bsRead`, the rail's markup, or the rail opening on another tab. If
  this run's change to `frontend/app/view/agents/brainstormrail.tsx` (Task 7, commit `9a37235`) caused it, say so in
  your report and fix the scenario only if the scenario is what is wrong; a defect in the rail is reported under Found
  not fixed with the line, since the rail is not on this task's files.
- Steps 6, 7c, 7c2, 10, 10b, 11, 11b, 12 and 12b (from step 6 on the brainstorm view reads `null`): find whether they
  follow from an earlier failure (a send never delivered, so the agent never "worked") or fail on their own, and fix the
  cause. 7c2 records no `agentprompt` call though the line is in the terminal: check which call the line box makes.

**Acceptance:** each of the failing steps listed above is accounted for in the report: fixed (with the cause), or
expected to pass once an earlier cause is fixed (naming it), or a product defect outside these files (with its line).
`node -e "import('./scripts/cdp/scenarios.mjs')"` loads and registers both scenarios, and nothing in other scenarios'
arrange changes.

### Task 2: proto-pane: the gallery card count and Send's line are read as they are
**Depends on:** none
**Files:** `scripts/cdp/scenarios-proto-pane.mjs`

Two of proto-pane's steps fail on the check, not on the app:
- **1b.** The card text is `MainStaticNo preview yet: it is taken the first time you open it2 boardsverify-proto-pane…`:
  the count runs into the topic name, so `/\b2 boards\b/` never matches although the card says 2 boards and the viewer's
  tabs are `["Main","Static"]`. Read the count from its own element (find the card's markup), or match it so a word
  after it does not break it, keeping the check that it is 2 boards.
- **7.** Send typed the line (`inTerminal: true`) and wrote `001.png` and `002.png`, but `sent` is `[]`: Canvas Send
  types through `sendToAgent` (`frontend/app/view/agents/agentsubmit.ts`, used by `canvassend.ts`), not
  `agentprompt`, which is all `BS_TYPED_INSTALL` records. Assert what Send does: the exact line in the agent's
  terminal once (as `bsTyped` reads the scrollback), to the agent's own block, plus the two files. If you record the
  call, record the one `sendToAgent` makes, in this file, and remove it in teardown.

**Acceptance:** steps 1b and 7 check the same facts as before (two boards on the card, no screen tab; exactly the
expected line once in the agent's terminal and exactly `001.png` and `002.png`), and with the details in `shots.json`
both would pass; the other proto-pane steps are unchanged.
