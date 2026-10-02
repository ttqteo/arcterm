# Graphite theme, Vietnamese-safe fonts, and the sectioned agent rail — design

Status: design settled 2026-10-02.

## Problem

Arc's look is a blue-tinted midnight palette with many borders and an accent used everywhere. The
reference the user wants to move toward is Google Antigravity's agent manager: neutral greys, regions
separated by tone rather than lines, a near-monochrome UI where accent is rare, and a right panel that
is a stable list of counted sections (Subagents, Files Changed, Background Tasks, …).

Two concrete defects ride along:

- The bundled `hanken-grotesk-variable.woff2` and `jetbrains-mono-v13-latin-*.woff2` are Latin-only
  (222 glyphs each). Vietnamese diacritics (ồ ộ đ ẩ ữ …) fall back to another face, so one word mixes
  two typefaces. Hack (the terminal default) and Fira Code lack them too. Inter (bundled) covers them.
- The agent details rail hides any empty section and shows every section expanded under a large
  heading, so its layout shifts from agent to agent and the counts are not scannable.

Out of scope (a later spec): folding the icon nav rail into the sidebar, a "Recent" sessions list in the
sidebar, merging or hiding surfaces (Usage/Setup into Settings, Jarvis into Cockpit,
the pet, Radar), a file tab strip, scheduled tasks, an in-app prompt box.

## Decisions

1. **A new `graphite` preset becomes the default; the other presets stay.** `midnight` remains in
   `THEMES` as an ordinary preset. A user who picked a preset keeps it (`cockpit.theme.preset` lives in
   localStorage); only users who never picked one see Graphite.
2. **The `@theme` literals in `frontend/tailwindsetup.css` move to Graphite**, so first paint (before
   `useApplyCockpitTheme` runs) matches the default and there is no Midnight flash. The guard in
   `themes.test.ts` changes from "midnight equals the literals" to "the `DEFAULT_THEME_PRESET` preset
   equals the literals". `DEFAULT_THEME_PRESET` becomes `"graphite"`.
3. **Graphite palette** (sampled from Antigravity, text tiers lifted to the contrast floor DESIGN.md
   requires):

   | Role | Value | Note |
   |---|---|---|
   | bg | `#101010` | Antigravity canvas |
   | surface | `#161616` | sidebar / rails |
   | surfaceRaised | `#1c1c1c` | inputs, buttons, cards |
   | surfaceHover | `#252525` | |
   | surfaceSelected | `#2d2d2d` | |
   | code | `#0c0c0c` | one step below bg |
   | border | `#1f1f1f` | |
   | edgeFaint | `#1a1a1a` | |
   | edgeMid | `#2a2a2a` | |
   | edgeStrong | `#3d3d3d` | |
   | text | `#d6d6d6` | |
   | secondary | `#cccccc` | Antigravity body text |
   | muted | `#8e8e8e` | Antigravity's `#6e6e6e` is 3.7:1; this clears 4.5:1 on bg and on hover |
   | inkFaint | `#666666` | ≥3:1 non-text minimum on bg |
   | accent | `#5e9cff` | unchanged; used sparingly (primary CTA, focus, links) |
   | success / warning / error | `#54c79a` / `#e6b450` / `#e0726c` | unchanged |

   The non-themed greys in `@theme` that carry a blue tint (`muted-foreground`, `ink-hi`, `ink-mid`,
   `lane`, `panel`, `modalbg`, `feed-*`, `cacheread`) get neutral equivalents of the same lightness, since
   they are not overridden per theme and would otherwise keep the old tint under Graphite.
4. **New token `--color-code-inline: #d7b981`** (warm gold, Antigravity's inline-code color),
   theme-agnostic like the syntax tokens. Inline `code` outside `pre` in `markdown.scss` (and the
   transcript's inline code, wherever it renders) uses it on a `surface` chip.
5. **Fonts.** `DEFAULT_SANS = "inter"`. The Latin-only JetBrains Mono files are replaced by the official
   JetBrains Mono variable woff2 (OFL, full charset incl. Vietnamese) registered in `util/fontutil.ts`.
   `DEFAULT_TERM_FONT` moves from `hack` to `jetbrains`: the user types Vietnamese into the Claude TUI,
   and Hack lacks it. Nerd Font icons are lost by default; Hack stays selectable. Hanken Grotesk stays in
   the picker as is.
6. **The agent rail becomes a list of counted, collapsible sections.** `RailSection` gains optional
   `count?: number` and `defaultOpen?: boolean`. When a section has a `count`, `CollapsibleRail` draws its
   header row — `Label  n  ›` — and owns open/closed. A section with `count === 0` still shows, dimmed,
   and does not expand. Open state persists per section id in one jotai atom (`railSectionOpenAtom`,
   a `Record<string, boolean>` with `atomWithStorage`). Sections without a `count` render as today, so the
   Cockpit Events rail is unchanged unless it opts in.
7. **Rail order** (attention first):
   1. Needs you — only when there are asks; always open, not collapsible.
   2. Subagents (n)
   3. Files changed (n) — renamed from "Files touched"; keeps +/− and View diff.
   4. Background tasks (n) — new, decision 8.
   5. Tools used (n)
   6. Run / Task — only for an agent in a run.
   7. Details — model, session, project, branch, worktree, context; default closed.
   8. Token usage — default closed.

   No Terminals section: background terminals belong to the workspace, not an agent, and already have
   their own group in the agent tree. The subagent-interior head section keeps its place on top.
   The section list (ids, counts, defaults, order) is computed by a pure function in a new
   `agentrailsections.ts`, tested by vitest; `agentdetailsrail.tsx` only renders it.
8. **Background tasks are derived from the parent transcript.** A pure
   `extractBackgroundTasks(lines)` in `transcriptprojection.ts`:
   - starts a task at each `Bash` `tool_use` whose `input.run_in_background === true`, and at each `Bash`
     call whose result record carries `toolUseResult.backgroundTaskId` (a foreground command that hit its
     timeout is auto-backgrounded: its result has `timedOutAfterMs` and a task id); label =
     `input.description`, falling back to the command;
   - reads the task id from `toolUseResult.backgroundTaskId`, or the result text "running in background
     with ID: X";
   - sets status from the `<task-notification>` whose `<tool-use-id>` matches (`completed` / `failed` /
     `killed`), or `stopped` when a later `TaskStop` (`input.task_id`) or `KillShell` names its task id;
   - leaves unresolved tasks `running`; the rail shows them as `unknown` when the agent is not live.

   Only Bash: background subagents are already in Subagents, and counting them twice would mislead.
   Loading piggybacks on `refreshSubagents` in `subagentsstore.ts`, which already tails the last 1000
   transcript lines on a 4 s debounce; it also sets a new `backgroundTasksByIdAtom`, even when the agent
   has no subagent files. A task started before that 1000-line window is not shown — accepted.
9. **The Agent surface's left tree is restyled after Antigravity's sidebar** (added 2026-10-02; the
   icon nav rail stays as is):
   - A full-width "+ New agent" button heads the tree (opens the same modal as the app bar's), then a
     sentence-case "Agents  n" header replacing the uppercase mono one.
   - Every project gets a group row, even when only one project is live (the single-project suppression
     goes): chevron, folder icon, project name in sentence case, and "N asking" in amber text when agents
     wait — no rule line, no per-group count, no filled badge. Clicking it collapses or expands the project;
     collapsed projects persist (`agent.tree.collapsed`, a list of names). A pure
     `foldCollapsedProjects(rows, collapsed)` in `agenttreemodel.ts` drops a collapsed group's body rows.
   - Rows under a project are indented. A plain agent row is one line: status dot, name, then on the right
     its subagents chip, "asking"/review when it wants something, else its age. The branch line goes (the
     rail's Details carries it). Lead rows keep their run subline.
   - Selected rows use `surface-selected` instead of the accent tint; an asking row loses its amber fill (the
     dot and the word carry it). Row padding tightens to `px-[10px] py-[6px]`, radius 6px.
   - The Terminals header takes the same sentence-case style.
10. **DESIGN.md** front-matter and Colors/Typography sections are updated to Graphite + Inter, and list
   Midnight among the presets.

## Testing

- vitest: `extractBackgroundTasks` (explicit start, auto-backgrounded timeout, id from result, each
  notification status, TaskStop, missing result), the rail section model (order, counts, zero sections, defaults, needs-you rule),
  `themes.test.ts` (default preset equals `@theme` literals; Graphite contrast floor for muted/inkFaint),
  `fonts.test.ts` (new defaults), `foldCollapsedProjects`.
- `task check:ts`.
- CDP: screenshot the Agent surface with the rail open under Graphite (a `scripts/cdp/scenarios.mjs`
  step that opens the rail), compared by eye against the Antigravity reference. The dev app currently
  boot-fails when launched from a detached shell (wavesrv logs "stdin closed/error (EOF)" and exits);
  launch it from an attached terminal, or fix that first if it reproduces there.
