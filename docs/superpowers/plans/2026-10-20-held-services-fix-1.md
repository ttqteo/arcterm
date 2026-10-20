# Held services, fix round 1

**Goal:** fix what the round-1 Final on the merged result found: a service row in the Agent tree loses its name to its
words, and `tools-app` steps 3b and 3c fail in the Mac headless-Chrome Final.

The design canvas (boards `Main`, `AppBarServices`, `RowStates`) is on the run record (`wsh runs show <run> --json` →
`prototype`), as for the run's own plan.

### Task 1: A service row keeps its name

**Depends on:** none
**Files:** `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/scenarios.mjs`

In the 248 px Agent tree a service row's name gives way to its words: the round-1 Final's
`services-states-1-rows.png` shows `svc-crash` as `s..` beside `crashed · exit 1`, `svc-v6` as `s.` beside
`running, no page after 30s`, `svc-taken` as `svc...`, and `svc-else` with no name at all beside
`not started by arcterm`. `ServiceRow` (`agenttree.tsx`, around line 2160) gives the name `min-w-0 flex-1 truncate` and
the words `flex-none whitespace-nowrap`. The `RowStates` board does the opposite: the name keeps its width
(no `flex: 1`) and the words take the rest (`flex: 1`), so long words are what give way.

- [ ] Lay the row out as the board does: the name stays whole (`flex-none`, or `shrink-0` with a sensible max width so
  a very long name still truncates rather than pushing the dot out), and the words take the remaining width as
  `min-w-0 flex-1 truncate` with `title={w.words}`, so cut words can still be read on hover. A running row has no words:
  its name then fills the row, and the port stays right-aligned beside the dot. Keep the port, the hover Start/Restart
  and the dot `flex-none`, and keep every `data-service-*` attribute.
- [ ] Leave the popover rows (`frontend/app/cockpit/servicespanel.tsx`) as they are: the panel is wide and the Final's
  `services-chip-1-popover.png` shows every name whole.
- [ ] In `scripts/cdp/scenarios.mjs`, extend `services-states` step `1. each row reads its state` so that each row
  also reports whether its name shows whole (the name element's `scrollWidth <= clientWidth`), and fail the step when a
  name with 9 characters or fewer (every fixture's) is cut. Keep the rest of the step as it is.
- [ ] Check: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` exits 0. `agenttree.tsx` is not prettier-clean at
  HEAD: never run `prettier --write` on it; keep your lines to 120 columns by hand. Never run prettier on
  `scripts/*.mjs`.
- [ ] Show it: `node scripts/cdp/final-verify.mjs services-states` (it starts its own browser
  app and stops it), and look at `cdp-shots/services-states-1-rows.png`: every name whole, long words cut at the end.
  Name in the report what you ran and what you saw.

### Task 2: tools-app Back, Forward and Home pass on a Mac

**Depends on:** Task 1
**Files:** `scripts/cdp/scenarios.mjs`, `frontend/app/view/agents/appstore.ts`, `frontend/app/view/agents/apppane.tsx`

The round-1 Final failed two steps of `tools-app` (`scripts/cdp/scenarios.mjs`, around line 41965):

- `3b. Back and Forward walk the app's own pages` → `{"wentTwo":true,"wentBack":true,"wentForward":false,"walk":["/two","/"]}`
- `3c. Home loads the app's start page afresh` → `{"last":"/"}`. Home did load `/`; the step fails because `wentHome`
  waits for `asked().length >= before + 4`, which counts on 3b's Forward having made a request.

On a Mac, Back and Forward take the fallback: `app_frame_action` returns false both in the browser shim
(`frontend/tauri/browsershim/core.ts:53`) and in the Mac host (`src-tauri/src/pagekeys.rs`, the non-Windows stub), so
`appHistory` (`appstore.ts`) calls `window.history.back()` / `forward()`. That fallback is what a Mac user gets, so it
must work, not only the Windows host path. Task 11 of the run reported that on the base commit `07811b6c4` (before any
services work, its own `tools-app` run through `git archive`) 3b and 3c failed too, but differently: `wentBack` was
false there and the log stayed `["/two"]`. Here Back is seen and Forward is not.

- [ ] Find the cause before changing anything (superpowers:systematic-debugging). Read the app frame's URL after each of
  Back and Forward through CDP (`Page.getFrameTree`, or the frame's own target), not only the fixture server's request
  log, and answer three questions: (a) does Forward move the frame back to `/two`, perhaps served from cache with no
  request? (b) Is the `/` seen on Back a history step, or the frame being remounted or re-pointed at its `src`? The
  frame is keyed `${id}:${s.reloads}` with `src={s.url}` (`apppane.tsx:129-135`), fed by `appStatesAtom`, which now
  derives from `serviceByTabAtom`. A `services:changed` publish that changes the url or the reload count, or the frame
  unmounting while the state passes through `starting`, would reload `/` and drop the forward entry. (c) Does the
  same sequence pass when you go back to the base? Use `git archive`, not a new worktree.
- [ ] If this run's code remounts or re-points the frame (b), fix it in `appstore.ts` / `apppane.tsx` so a status
  publish for a running service never reloads its page, and add a unit test for the derivation if it is pure.
- [ ] If Forward does move the frame and only the request log misses it (a), make step 3b judge the frame's URL as
  read through CDP, or make the fixture server send `Cache-Control: no-store` so every step is a request. Either way the
  step must still fail when Forward does nothing.
- [ ] Make 3c judge Home by itself: count requests from just before the Home click, and pass when `/` is asked for
  again.
- [ ] If the window-history fallback cannot step the frame forward in headless Chrome on the base as well as here,
  do not weaken 3b to pass. Leave it failing, and put the evidence (the frame URLs read through CDP, base against run)
  under Found not fixed.
- [ ] Check: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` exits 0; `npx vitest run` on any test file you
  touch. Never run prettier on `scripts/*.mjs`.
- [ ] Show it: `node scripts/cdp/final-verify.mjs tools-app` (it starts its own browser app
  and stops it). Report each step's result and what you saw in `cdp-shots/tools-app-3b-forward.png`.
