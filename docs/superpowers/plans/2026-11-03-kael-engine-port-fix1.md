# Kael sync, fix round 1: the final-stage scenario reads today's tree and rail

Round 1's Final (`node scripts/cdp/final-verify.mjs final-rerun final-stage`) failed 12 of 29 steps. Every failure
comes from two stale reads in the `final-stage` scenario's helpers in `scripts/cdp/scenarios.mjs`, both already stale
on the run's base (`4db9d9690`), not from this run's work: `final-rerun`'s steps 1–5 all passed, and this run changed
neither the Agent tree nor the details rail. The plan's Task 1 acceptance requires `final-stage` to still pass.

The failing steps and their detail are in
`%LOCALAPPDATA%/dev.arc.app/data/final-shots/257d4530-79a1-42b4-8945-4d4bcd21386e/1/shots.json`, with
screenshots in its `cdp-shots/` folder (`final-stage-a1-row-and-lead-rail.png` shows the lead focused, its rail open on
the RUN section, while the step read `leadFocused: false`).

### Task 1: Bring the final-stage scenario's tree and rail reads up to the current UI
**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`

1. **The tree strip's final slot.** `FST_AGENT` reads `tree.querySelector("[data-final-slot]")` for `slot`, and its
   parent's `aria-label` for `strip`. No frontend file renders `data-final-slot` any more: `TaskStripBar` in
   `frontend/app/view/agents/agenttree.tsx` (~line 761) now draws a tail of pips from `runStage(run).tail`
   (`data-run-strip-tail`, one `span[data-pip]` per stage with `title="<name>: <state>"`, the first named
   `Final check`) and an `aria-label` ending `; Final check <state>, …`. Rewrite `slot` and `strip` to read the
   `Final check` pip of the lead's run (its `data-pip` state, and the strip's `aria-label`), and update every
   assertion that expects the old slot values (A1, B2, B5, B8, B9 and any other step reading `a.slot` / `a.strip`)
   to the pip's states for that stage (read `runstage.ts` for which state each final-stage state maps to). Do not
   change the frontend.
2. **The lead's focus.** `fstFocusLead` waits for an `h3` reading `Run` inside `aside[aria-label="Agent details"]`;
   it timed out although the rail showed the run section (screenshot above), so `leadFocused` read false and every
   step gated on it failed (both scenarios' step 0, `final-stage` A0, B7a, B7b, B10, whose `rebooted` / `reloaded`
   come from `fstBoot`). Find what the rail's run section renders today (`agentdetailsrail.tsx`, the `run:` label
   near line 946, and its section header component) and wait on that instead, preferably a `data-rail-section`
   attribute rather than text. The `final-rerun` scenario reuses `fstBoot`, so its step 0 must pass too.

Acceptance: run `node scripts/cdp/final-verify.mjs final-stage final-rerun` once (it starts its own dev app; it is
heavy, so run it once at the end, not per edit) and every step of both scenarios passes. If a step still fails for a
reason that is the product's and not the scenario's, stop and report it in Found not fixed rather than loosening the
assertion. Name each assertion you changed, with old and new expected values, in the commit message.
