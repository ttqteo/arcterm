# Arc's desktop popup: the card's inset and the close-and-exit check

**Verify:** `node scripts/verify.mjs ./pkg/jarvis`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
**Final:** `node scripts/cdp/final-verify.mjs attention-popup surface-smoke`
**Prototype:** C:/Users/kael02/IdeaProjects/waveterm/.superpowers/design/attention-notification/project/Main.dc.html

Two gaps left by run 494e6529, which built the popup. Both were decided by the user on 2026-10-08. The spec is
`docs/superpowers/specs/2026-10-08-attention-desktop-popup.md`; its Decisions bind every task. The canvas on
the Prototype line is gitignored scaffolding: read it at that path, never copy or commit it.

Repo rules: no new dependency. Never run `task dev`, `task check:ts` or `npm install` in a worktree. Never run
prettier on `scripts/*.mjs`. Never stop `wave-tauri.exe` or `wavesrv.x64.exe` by image name. No
`Co-Authored-By`, `Claude-Session` or other attribution trailer in a commit. Change nothing outside the files
a task names.

The two tasks touch different files and run at the same time.

### Task 1: The visible card sits 16px from the work area's corner

**Depends on:** none

**Files:** `frontend/tauri/popup.tsx`, `scripts/cdp/scenarios.mjs`

**What is wrong.** `popup.tsx` wraps the card in a frame with 24px of padding (`p-6`), the window's room for
the card's shadow, and `placeWindow` hands the *frame's* size to `popupPlacement`. So the window's edge is 16px
from the work area's right and bottom edges and the visible card is 40px in. The canvas and the spec put the
card 16px in.

**The user's decision.** The card is 16px in. The shadow and its 24px of room stay. The transparent ring
therefore reaches 8px past the work area's right and bottom edges; that is accepted.

**Do this.**

- In `placeWindow`, place the card, not the frame: pass the card's own size to `popupPlacement` (unchanged, it
  already means "the bubble, 16px in"), then set the window's position to that spot minus the card's offset
  inside the frame, read from the two elements' `getBoundingClientRect()`. The window's size stays the frame's
  size. No new constant for the 24px: the offset is measured, so `p-6` remains the one place that sets it.
- Do not change `popupPlacement`, `POPUP_MARGIN`, or `attentionpopup.ts` and its test.
- In `scripts/cdp/scenarios.mjs`, scenario `attention-popup`, step 3 and `popupEdgeError`: assert the 16px rule
  on the card. Read the card's rect in the popup page (through the card's `data-attention-popup*` attribute,
  scoped, never a document-wide query), add it to the window's outer position (logical to physical with the
  monitor's scale factor), and check the card's right and bottom edges against the work area's with the
  tolerance the step already uses. Update the step's title text if it names the window.

**Acceptance.**

- `node --check scripts/cdp/scenarios.mjs` passes and Check (tsc) is clean.
- Scenario `attention-popup` step 3 passes with this change and would fail against the old placement (say in
  the report how you know: the numbers the step read).
- The step-3 screenshot shows the whole card with its shadow, not clipped at the window's right or bottom.

### Task 2: Final checks that closing the main window ends the app

**Depends on:** none

**Files:** `scripts/cdp/final-verify.mjs`, `scripts/cdp/final-verify.test.mjs`, `AGENTS.md`

**Why.** The app has a second, hidden window (`attention-popup`). `src-tauri/src/main.rs` exits the app when
the main window is destroyed so that window never keeps Arc and wavesrv alive. Only a Rust unit test of the
predicate covers it. The user accepted a real check; it was not built.

**Do this,** in `main()` of `final-verify.mjs`, after the scenarios have run and their shots are copied, and
before `stop()` kills the process tree:

- Attach to the cockpit page with `attach(port)` from `scripts/cdp/attach.mjs` and close the main window:
  evaluate `window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })`. The page dies with
  the window, so a socket that closes or a reply that never comes is not an error here.
- Then poll the CDP port (the file's existing probe helpers, its `POLL_MS`) for up to a named
  `CLOSE_EXIT_MS = 15_000`. The app has exited by itself when the port stops answering: the hidden popup's
  webview is served on the same port, so a port that still answers means the host is still alive.
- Outcomes, decided in a small exported pure function so the test can pin them:
  - the scenarios' own non-zero exit code always wins, unchanged;
  - scenarios passed and the port stopped answering: exit 0;
  - scenarios passed and the port still answers after `CLOSE_EXIT_MS`: print one line saying the app stayed
    alive after its main window was closed, and exit 1 (a failure, not `EXIT_UNVERIFIED`);
  - scenarios passed and the window could not be closed at all (no page to attach to, the invoke rejected):
    `unverified(...)` with that reason.
- `stop()` and `dropStore` still run in every case, as the fallback kill by PID.
- Put the close-and-wait in its own short function; `main()` only calls it.

**Tests,** in `final-verify.test.mjs`, in the file's existing style (it already runs the script against a fake
dev command through `ARC_FINAL_DEV_CMD`):

- the pure outcome function: one case per bullet above;
- the existing end-to-end cases still pass. Where a fake app has no cockpit page to close, either extend the
  fake so the close works, or assert the unverified outcome, whichever the case is about. Do not skip the
  close check behind an environment variable.

**AGENTS.md.** One sentence where `final-verify.mjs` is described under "Design docs": after the scenarios it
closes the main window and fails Final if the dev app does not exit by itself.

**Acceptance.**

- `npx vitest run scripts/cdp/final-verify.test.mjs` passes; paste its summary line in the report.
- `node --check scripts/cdp/final-verify.mjs` passes.
- The report says what the check printed in a real `final-verify.mjs` run if you made one, and says plainly
  if you did not.
