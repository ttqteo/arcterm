# Jarvis Brief redesign: final-stage fix, round 1

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the three places where the merged Brief redesign departs from
`docs/superpowers/specs/2026-10-12-jarvis-brief-redesign-design.md` (the spec), plus the chunk panel header that
overflows at 460px, and show each one in a CDP scenario step.

**Architecture:** Small view edits in the files that drew each defect. No new modules. The words come from the spec;
the layout comes from the mockup boards at
`.superpowers/design/jarvis-overview/project/` (gitignored, so read them at that absolute path).
Map their inline hex back to `@theme` tokens as the main plan lists (`#262624` → `bg-surface`, `#a3a198` →
`text-muted`, `#a2a2a2` → `text-ink-mid`, `#e3e3e3` → `text-ink-hi`, `#383734` → `border-edge-mid`, `#4a4945` →
`border-edge-strong`).

**Tech Stack:** React 19, Tailwind 4 (`@theme` tokens only, never raw hex), vitest, CDP.

Rules for every task: follow `DESIGN.md`; no raw hex or rgba in `className` or `style`; check only the files you
touched with `npx prettier --check <files>` and `npx eslint <files>` (never `--write` the tree; never prettier on
`scripts/*.mjs`); typecheck with `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` (in a worktree
`task check:ts` runs `npm install` and breaks the `node_modules` junction). Commit with a pathspec
(`git commit -m "…" -- <files>`), never a bare `git commit`.

**Verify:** `node scripts/verify.mjs ./pkg/jarvis`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: brief-surface brief-layout brief-chunk-panel brief-run-sheet-order need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs brief-surface brief-layout brief-chunk-panel brief-run-sheet-order`

---

### Task 1: Since you looked rows read compact, and the Waiting head says gates first

**Depends on:** none
**Files:** `frontend/app/view/jarvis/briefrowviews.tsx`, `frontend/app/view/jarvis/briefsurface.tsx`

The spec's Side column section: "The rows are the delta groups …, compact: the kind and age on one line, the title
under it." The spec's Waiting head: "dot, label, count, rule, `gates first · oldest 1d`".

**Step 1: `DeltaRowView` (`briefrowviews.tsx`, about line 500).** Today it is the old three-column row: a `w-28` kind
column, the title, and a `w-12` age, which leaves about 150px for the title in the 340px side column (the final
stage's `brief-layout.png` shows "Ship the landing bri…"). Make it a column: a first line with `line.kind` (keep its
`TONE_TEXT[line.kindTone]` colour, 10.5px semibold) on the left and `line.state` (the age, 11px `tabular-nums
text-ink-mid`) pushed right with `ml-auto`; then the title full width under it (13px `text-ink-hi`, `truncate`, keep
`title={line.title}`), then `line.detail` when present (`FAINT_TEXT`, `truncate`). Read
`Proposed-Brief.dc.html` lines 191-199 for spacing. Keep the root's `data-jarvis-brief-row="delta"`, `data-peek`,
`cursorAttrs`, `onClick`, `ROW_BORDER`, hover and `CURSOR_RING`. Add `data-jarvis-delta-kind` on the kind span and
`data-jarvis-delta-title` on the title span (Task 4 reads them). `DeltaRowView` has one caller (`briefsurface.tsx`,
the side column), so nothing else changes shape.

**Step 2: the Waiting head meta (`briefsurface.tsx`, about line 1695).** Replace `meta="gates before asks"` with
`gates first`, followed by ` · oldest <age>` when `queueSummary?.oldestTs` is not null, where the age is
`formatAge(Date.now() - queueSummary.oldestTs)` (`formatAge` from `@/app/view/agents/agentsviewmodel`, the one
`briefingmodel.ts` already uses for the same age). With no oldest, the meta is `gates first` alone.

**Step 3:** run `npx vitest run frontend/app/view/jarvis`, the typecheck, prettier and eslint on the two files.
Commit: `fix(jarvis): Since you looked rows put kind and age over the title, and the Waiting head says gates first`.

### Task 2: The run sheet composer says who it messages

**Depends on:** none
**Files:** `frontend/app/view/jarvis/briefcompose.ts`, `frontend/app/view/jarvis/briefcompose.test.ts`, `frontend/app/view/jarvis/briefcomposer.tsx`

The spec's Run sheet section: "a label row "Message the lead" (or "the worker") with an `i` keycap and "goes straight
to its terminal"". Today the row reads `<lead|worker> scoped to this session [i]` (`briefcomposer.tsx:134-147`).
Read `Proposed-RunSheet.dc.html` line 113 for the row.

**Step 1 (test first):** in `briefcompose.test.ts`, the expected `scope` becomes `"goes straight to its terminal"`.
Run it and see it fail.

**Step 2:** in `briefcompose.ts`, `scope: "goes straight to its terminal"`. Update the file's header comment if it
names the old words.

**Step 3:** in `briefcomposer.tsx`, the label row reads, left to right: a `data-jarvis-brief-composer="who"` span
`Message the lead` when `orchestrator`, else `Message the worker` (keep the `text-success` colour on `lead` /
`worker` only if the mockup draws it so; otherwise `text-ink-mid`), then the existing `i` `kbd`, then the
`data-jarvis-brief-composer="scope"` span with `labels.scope` after it. Keep the Shift+Enter `labels.alt` span at the
right (`ml-auto`) when it exists. When a run's worker has a name, `Message the worker` may name it
(`Message <workerName>`) only if the mockup does; otherwise keep the spec's words.

**Step 4:** run `npx vitest run frontend/app/view/jarvis`, the typecheck, prettier and eslint on the three files.
Commit: `fix(jarvis): the run sheet composer says Message the lead and that it goes straight to its terminal`.

### Task 3: The chunk panel header fits on one line at 460px

**Depends on:** none
**Files:** `frontend/app/view/jarvis/chunksidebar.tsx`

Two tasks of the main run reported it, and the `brief-chunk-panel` shots show it: at the 460px panel the header
`Chunk · n / total · ↑ ↓ · Work on this chunk · Copy wsh command · ✕` needs about 20px more than it has, so `1 / 3`
wraps onto two lines and the Work button truncates to `Work on this ch…`.

**Step 1:** give the `n / total` span (`chunksidebar.tsx`, about line 175) `flex-none whitespace-nowrap`.

**Step 2:** make the Copy button icon-only: a copy icon from `lucide-react` (the file already imports from it),
`aria-label="Copy wsh command"`, and keep its `title` (the full `wsh effort note …` command) and its handler. Size it
like the header's other 24px controls. `Work on this chunk` (or `Go to agent`) then shows in full; keep its
`data-jarvis-chunk-work` hook.

**Step 3:** typecheck, prettier and eslint on the file; `npx vitest run frontend/app/view/jarvis`. Commit:
`fix(jarvis): the chunk panel header fits on one line, with Copy as an icon`.

### Task 4: Scenario steps for the round's fixes

**Depends on:** Task 1, Task 2, Task 3
**Files:** `scripts/cdp/scenarios.mjs`

Add steps to the existing scenarios; never prettier this file.

**Step 1: `brief-layout`** (about line 799). Add a step after the side-column step: in `[data-jarvis-brief-side]`,
for each `[data-jarvis-brief-row="delta"]`, the `[data-jarvis-delta-kind]`'s `getBoundingClientRect().bottom` is at
or above the `[data-jarvis-delta-title]`'s `top`, and the title's width is at least 80% of the row's. SKIP with a note
when the fixture has no delta row. Add a step: the `waiting` region head's text contains `gates first` and not
`gates before asks`; when it contains `oldest`, it matches `/gates first · oldest \S+/`. Shoot the side column after
the first.

**Step 2: `brief-chunk-panel`** (about line 1080), step 3. Add to it: the panel header (the first child of
`[data-jarvis-chunk-sidebar]`) has `scrollWidth <= clientWidth`; the `n / total` span's height is under 20px (one
line); the `[data-jarvis-chunk-work]` button's label is not cut (`scrollWidth <= clientWidth` on its label span); and
a button with `aria-label="Copy wsh command"` has a `title` starting `wsh effort note`. Replace the old check that
looked for a button reading `Copy wsh command`.

**Step 3: `brief-run-sheet-order`** (about line 1408), step 3. When a composer shows, also assert
`[data-jarvis-brief-composer="who"]` reads `Message the lead` or `Message the worker` and
`[data-jarvis-brief-composer="scope"]` reads `goes straight to its terminal`. The step SKIPs as it does today when no
composer shows; say in its note that `briefcompose.test.ts` covers the words.

**Step 4:** run `node --check scripts/cdp/scenarios.mjs` and `npx eslint scripts/cdp/scenarios.mjs`. No dev app or
`final-verify` run: the round's Final runs these scenarios. Commit: `test(cdp): steps for compact delta rows, the
Waiting meta, the chunk header and the composer label`.
