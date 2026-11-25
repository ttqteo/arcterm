---
name: ux-check
description: Use before you report UI work done, in any project: a view, panel, toggle, list, dialog or state you built or changed. Checks every state change for motion, the states nobody opens (empty, error, long text, narrow, keyboard), presses cut short mid-motion, and watches the change frame by frame in the running app instead of trusting an end-state screenshot.
---

# Checking the UX before you call UI work done

Typecheck, tests and a screenshot of the finished state pass on UI that feels broken: a panel that snaps open, a
slide that a second press leaves stuck half-way, a label that overflows at a narrow width. Those show only between
frames, or in states the happy path never reaches. Do these four steps before you say the work is done, and report
what each found.

## 1. Every state change, and its motion

List each change the UI you touched goes through: appear and leave, open and fold, select, a value updating, loading
to done, an error arriving, a row added or removed, a layout switch (expand, collapse, a narrow window).

For each, find in the code what draws it and name its motion from the project's design system (in arcterm,
`DESIGN.md` Motion and `frontend/app/element/motiontokens.ts`: a shape change rides the spring through
`springReveal`, `springFoldWidth`, `springFoldHeight`, `springPop` or `springSheet`, with `usePartMotion` for reduced
motion). A conditional render, `{open ? <Panel/> : null}` or `{a ? <A/> : <B/>}`, with no `AnimatePresence` or
transition around it snaps: either give it its motion or write down why it stays still (a keyboard action, something
seen a hundred times a day). A missing motion is a defect you fix now, not polish for later.

## 2. The states nobody opens

Walk each of these that applies, in the running app where you can, and fix what breaks:

- empty (no items), loading, error (the call fails), and one item against hundreds
- long text: a long name, title or path in every label you added; does it truncate with a title, or push its
  neighbours out?
- a narrow window or cell, and the widest layout
- keyboard only: can you reach it, is focus visible, does Escape do what the person expects
- reduced motion: it still opens and closes, at once
- what the person sees right after acting: is there feedback, or does the click seem to do nothing?

## 3. Presses cut short

Motion code breaks when a second change arrives mid-motion. Try: press the toggle twice fast; switch the layout
(expand, collapse, resize) while it is sliding; leave the view and come back mid-motion; unmount it while it
animates. The end state must match a slow press: no box stuck at an in-between size, no element left at opacity 0,
no two copies of it.

## 4. Watch it move

An end-state screenshot cannot show motion or a stuck in-between size. Record the change frame by frame.

In arcterm, with the dev app running (`task dev` on Windows; `task dev:browser` on a Mac, CDP :9222), this is the
one live pass for the work: run the view's scenario (`task verify:ui -- <name>`) for the end state, then trace the
motion:

```
node scripts/cdp/motion-trace.mjs --selector "<css of the parts that move>" \
    --do "<js that makes the change>" --do "<js that undoes it>" --out <scratch dir>
```

It prints each motion with its frame count and length; a change drawn in a single frame is a `SNAP`. Read the `end:`
line against a slow press. Repeat with `--gap 120` for the cut-short case of step 3. With `--out` it writes the frames
and `trace.webp`, an animation at half speed: look at it, and show it to the person with `![...](<path>)` when the
change is theirs to judge. A scenario in `scripts/cdp/scenarios.mjs` that covers the view keeps the end-state check;
the trace is what tells you how it got there.

Elsewhere, use what the project has (Playwright's trace or video, a screen recording, the browser's Performance
panel), or say plainly that you could not watch it move.

**In an agent an Arc run started** (`ARC_RUN_AGENT` is set), skip this step: start no dev app and run no CDP, since
the run's Final starts its own app and runs the scenarios once on the merged tree. Do steps 1 to 3 from the code,
write or update the scenario that shows the view, and for each motion you could not watch add a `- [ ]` line to
`docs/hand-checks.md` (what to press, what should move and how, where).

## Reporting

Say in the reply which state changes you checked and how (watched live, traced, read in code only), what you fixed,
and what you could not verify. "Not seen moving" is a fine answer; claiming a motion works from a screenshot is not.
