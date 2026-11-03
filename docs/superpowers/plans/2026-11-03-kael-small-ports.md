# Kael sync (2026-11-03): small ports: monitors in the Agent tree, the Memory tab, Monaco ligatures

**Verify:** `node scripts/verify.mjs ./pkg/resmon/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs monitor-tasks setup-memory`

## Context for every task

Port of four small features from the kaeltran16 fork (`kael` remote, `kael/main` at `16b726ffd`). Read a commit
with `git show <hash>`, a file at the fork's tip with `git show kael/main:<path>`. Our tree has diverged: the Agent
sidebar is one tree per project (`projectTree` in `agentsidebarmodel.ts`), and we already have part of the shell
task model (`pkg/resmon/shelltask.go`, `ShellTask` in `subagentsstore.ts`). Port the behaviour into our shape, keep
the fork's tests (adapted) and its pure-model / thin-view split; `git cherry-pick -n` only where it applies cleanly.
The fork's Jarvis pet, avatar and Brief-layout files are not ours: skip any part of a commit that touches them.

Rules: Go is the source of truth for wire types; change the Go and run `task generate`, never hand-edit
`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts` or `pkg/wshrpc/wshclient/wshclient.go`. Colors
only from `@theme` tokens, motion only from `frontend/app/element/motiontokens.ts`, UI follows `DESIGN.md`. Each task
adds its user-facing line under `## Unreleased` in `CHANGELOG.md` and a `- [ ] (arcterm) Kael sync: …` line in
`docs/hand-checks.md` for what only a live app shows. A new keybinding goes in
`frontend/app/store/keybindings/bindings.ts` and `docs/keyboard-shortcuts.md`.

### Task 1: Claude Code monitors and background shells in the Agent tree
**Depends on:** none

Commits `a06397716` (ShellTask kinds and monitor label helpers, `shelltasks.ts`), `a019e532d` (monitor rows in the
Agent tree, under their agent), `f9a615b6a` (project Claude Code monitors from the transcript, `shelltasksstore.ts`),
`b139c36e7` (the Events and Output peek for a monitor, `shelltaskpeek.tsx`), `798335c28` (CDP scenario
`monitor-tasks`: keep that name, adapted to our tree). Extend our existing `ShellTask` model, don't add a second one.
The rows must not touch the terminal stack: no pane re-parenting or remount (AGENTS.md, Agent surface rules).

### Task 2: The Memory tab works through a backlog
**Depends on:** none

Commit `9fd916309`: Apply and Keep move to the next change still to review; j/k/a/x/u drive the table from the
keyboard; each labelled split group gets a two-click Apply all that applies its open changes one at a time with
progress; the rail lists projects with changes to review first and draws checked projects with an empty index on
one line; kind chips tinted by what the change does (remove, bring in, edit in place); an empty size reads 0 KB;
long paths truncate their folder, not the file name (`pathtail.tsx`, shared with Setup). Extend our
`setup-memory` scenario with a step that shows the keyboard flow and an Apply all in progress.

### Task 3: The Memory tab animates its state changes
**Depends on:** Task 2

Commit `d71af8f76`: the project pane and change detail fade in with `viewFade` when they switch what they show, the
Check now result note and a row's status fade with `microFade`, and the meters ease their width with `widthTween`
(all already in our motion tokens). Respect reduced motion as the tokens do.

### Task 4: Monaco draws the code font's ligatures
**Depends on:** none

Commit `7bb41e97d` (9 lines): turn on `fontLigatures` wherever we create a Monaco editor or diff editor with the
code font. Check that the bundled code font has ligatures; if it has none, say so in the commit and still enable it
for a user font that does.
