# Quick look, Final fix round 1

**Spec:** `docs/superpowers/specs/2026-11-06-launcher-session-peek-design.md`
**Final:** `node scripts/cdp/final-verify.mjs launcher-session-peek launcher-resume`

Final round 1 failed 11 of 28 steps: `launcher-resume` 1, 1b, 1c, 2, 4a, 4b, 5b, 6a, 6b, 6c, and
`launcher-session-peek` 11. Both causes are in `scripts/cdp/scenarios.mjs`; the product code stays as it is.

Decisions, and why:

1. **File each test transcript under the slug of its project's folder, the way Claude Code does.**
   - **What failed:** in `launcher-resume` the Session column stayed on "Reading sessions…" for the whole scenario
     (screenshot `launcher-resume-1-list.png`), so every step that needs the list failed.
   - **Why:** both scenarios write their transcripts to `~/.claude/projects/verify-launcher-{resume,peek}-<8 hex>`.
     That is not the slug of the project folder. `scanPageFrom` (`pkg/agentsessions/scanpage.go`) reads only the
     project's slug folder when one exists; when none exists, it walks the whole Claude root. On this machine the root
     is 936 folders and 7.3 GB. Final starts a fresh app, so that walk was cold and outlasted every wait in
     `launcher-resume`, which runs first. `launcher-session-peek` passed only because the scan cache was warm by the
     time it ran.
   - **Fix:** write into `join(homedir(), ".claude", "projects", learnSlug(<the project dir>))`.
     - `learnSlug` in the same file already mirrors `agentobserve.SlugifyCwd`. Reuse it (DRY) and don't add a second
       copy.
     - The project dir is a fresh `mkdtemp`, so its slug folder is new to the run, and the teardown's recursive
       remove of `ctx.transcriptDir` deletes only what the scenario made.
   - **Not chosen:**
     - Lengthening the waits would only hide a cold walk that grows with the user's history.
     - Warming the scan in the arrange step would test a path real sessions never take.
2. **Step 11 reads the panel's full height in a tall window, then shortens the window from there.**
   - **What failed:** the dialog is capped at `max-h-[86vh]`. At the scenario's 950 px viewport, with the free-RAM
     warning row showing, the panel is already shrunk to 105 px. So the step's `fullH` was 105. The panel's minimum
     is 100 px, so it can never give up the 8 px the loop waits for, and `height` stayed `null`.
   - **Product call: keep the layout.** Spec D5 asks the panel to shrink first in a short window. At 950 px it did
     exactly that: the Task box and the Session column did not move, which steps 2 to 10 show. 950 px with a warning
     row is a short window for this dialog.
   - **Fix:** in step 11, set the viewport to `{ ...MODELS_VIEWPORT, height: 1300 }` before reading `fullH`. That is
     tall enough that 86vh holds the dialog with the panel at full height. Assert that `fullH` is within 8 px of 170,
     which is D5's full height, and add it to the step's detail. Then start the shortening loop from 1300 − 40.
     - The free-RAM row comes and goes with the machine, so a fixed start height under ~1100 px is not reliable.

### Task 1: Scenario fixes for Final round 1

**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios.mjs`

1. In the `launcher-resume` arrange (around line 25888), set `ctx.transcriptDir` to
   `join(homedir(), ".claude", "projects", learnSlug(ctx.dirs[0]))`. `ctx.dirs[0]` is the first project's folder,
   which is also the transcript's `cwd`. Update the comment above it: the transcript is filed under the project's slug
   folder so the project-scoped scan reads that one folder, not the whole root.
2. In the `launcher-session-peek` arrange (around line 26404), do the same with `learnSlug(dir)`. The F step's
   expected error text reads the path from `ctx.files`, so it follows on its own. Check that no assertion hard-codes
   `verify-launcher-peek-`.
3. `learnSlug` is a module-level `const` declared further down the file (around line 54730). It is read only inside
   `arrange` at run time, so the order is safe. Leave it where it is and do not rename it.
4. Step 11 of `launcher-session-peek` (around line 26724): after reopening the panel on A, call
   `h.cdp("Emulation.setDeviceMetricsOverride", { ...MODELS_VIEWPORT, height: 1300 })`, wait 300 ms and read `fullH`.
   Start the loop at `1300 - 40`. Add `Math.abs(fullH - 170) <= 8` to the step's pass condition and keep `fullH` in
   its detail. The rest of the step stays: it compares closed and open at the found height, and the viewport is put
   back afterwards.
5. Run `node --check scripts/cdp/scenarios.mjs`.
   - A worker can't run the scenarios: Final starts its own dev app. Report that under Not verified.
   - Never run prettier on this `.mjs` file.

The steps that show this are `launcher-resume` 1 to 6c (the list loads) and `launcher-session-peek` 11 (the panel
at full height, then shrunk). Both scenarios are already in Final.
