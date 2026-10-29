# Option boards: UI options drawn on a canvas, not in ASCII

Brainstorm: `.superpowers/brainstorm/option-boards/brainstorm.json` (2026-10-29).

## Problem

When an agent offers options that differ in UI (layout, where something sits, a click flow), it draws
them as ASCII boxes in its terminal reply, or not at all, and asks "A or B?" in prose. The person has
to picture the options from text. Seen in a plain chat session (a design talk about agent "Rooms"):
one ASCII mockup of one option, then an A/B question with no picture of either, and only an offer to
"draw a few options with arc:design".

## Intent

Every option that differs in UI gets its own `arc:design` board, so the person compares them by
eye and then picks. This holds in a plain chat session as much as in an `arc:brainstorm`, not only
when a brainstorm is running.

## What exists today (context)

- `arc:brainstorm` lists boards on a **part** (`boards`, `skills/brainstorm/SKILL.md` "Mockups").
  A question's options are `{ label, detail, pros, cons }` and carry no board.
- The brainstorm pane already shows the asked part's boards as a column beside the question, labelled
  `option A of N` by index (`frontend/app/view/agents/brainstormui.tsx`, `Thumbnails`, and the
  `data-brainstorm-question-boards` block in the question view). Nothing in the skill tells the agent
  to fill it one board per option.
- In any session, `wsh ui reveal canvas:<topic>` attaches a canvas to the agent on the Agent surface
  without switching the person to it (`skills/design/SKILL.md`, "The loop"). The canvas pane lays
  several boards out as a grid.
- `arc:design` "When to use" today says conceptual A/B choices stay in the terminal and a UI topic is
  not automatically a visual question. It triggers only on `/arc:design` or a mockup request.
- The working conventions arcterm projects into every harness come from the person's own vault
  (`steering/AGENTS.md`, `pkg/agentsync`), not from arcterm, so a rule there would reach one machine only.

## Decisions

### When to draw (answer 2)

The agent draws boards whenever it is about to draw a UI mockup, or asks the person to choose between
options that differ in UI: one board per option. A **small** mockup (something that fits in a few
lines: a status line, one button, one label) is the exception: the agent first asks the person
whether to draw a board or keep it as text.

### Plain sessions: rule plus canvas pane (answer 3)

In a plain chat session the agent draws the options with `arc:design`, one artboard per option
labelled A/B/C, then runs `wsh ui reveal canvas:<topic>` so the canvas attaches to it on the Agent
surface. The question itself is still asked in the terminal, and the person answers by the label.
No new UI.

### Where the rule lives (answer 4)

In the `arc:design` skill (`skills/design/SKILL.md`), which arcterm ships to every harness (Claude
through the arc mod, others through the vault). Its `description` adds the trigger "when about to draw
a UI mockup or offer UI options"; its body adds a section on drawing options. `arc:brainstorm`
points to that section rather than restating it. Nothing goes into the person's steering file.

### Brainstorm pane: rule only, order kept (answer 5)

No pane code changes. `arc:brainstorm`'s Mockups section adds: when a question chooses between
options that differ in UI, the asked part lists in `boards` exactly one board per option, in the same
order as `question.options`. The pane's existing column then reads `option A of N` against the
matching lettered row.

A UI question that goes to the judge (an approach question) has no options until the judge writes
them, so the agent draws nothing before the judge runs. On `brainstorm: judged`, in that same turn,
it copies the judge's result in with the usual script, then draws one board per judge option in the
judge's order, lists them on the asked part, and ends on the question. When the judge reruns
(pushback, "double check"), the agent redraws to match the new options; a board no option matches
any more moves to `unchosen/`. (Builder question 2.)

### After the pick (answer 6)

Once the person picks an option, the part lists only the picked option's board, so the run's
prototype (the first board any part lists) is the picked design. The other options' board files move
to `.superpowers/design/<canvas>/unchosen/`, beside `project/`, and leave `canvas.json`. The engine's
plan reviewer wants a scenario step for every `.dc.html` in the prototype's folder
(`pkg/orchestrate/planreview.go`, `planReviewBoardItem`) and reads no titles, so a board left in
`project/` would be a finding in every run. The files are kept but no longer show in the canvas
gallery. A plain session does the same. (Builder question 1.)

`arc:design` "The canvas as a spec" is rewritten to match: before a canvas becomes a spec, the options
not chosen move to `unchosen/` rather than being dropped. (Agent's call.)

## Left to the builder (confirmed)

- Option artboards are named by their label: `A-<slug>.dc.html`, `B-<slug>.dc.html`, …, with
  `title` `Option A: …`, so the order in `canvas.json`, in the part's `boards` and the labels agree.
- In a plain session the canvas topic is named after the feature under discussion (e.g.
  `council-rooms`); later questions about the same feature add boards to the same topic.
- "Small mockup" means it fits in a few lines (a status line, a button, a label); the agent asks
  "draw a board, or keep it as text?" before drawing.
- `arc:design` "When to use" is rewritten to agree: options that differ in UI are drawn; conceptual
  choices (scope, trade-offs with no layout) stay in text.
- `arc:brainstorm` Mockups: add the one-board-per-option-in-order rule and the drop-unpicked-boards rule.
- One `Changed` line in `CHANGELOG.md`.

## Files

- `skills/design/SKILL.md`: `description`, "When to use", "The canvas as a spec", a new "Options"
  section (one artboard per option, naming, the small-mockup ask, `wsh ui reveal`, ask in the terminal
  by label, after the pick: move the rest to `unchosen/`).
- `skills/brainstorm/SKILL.md`: Mockups section, pointing to `arc:design`'s Options section; the
  `brainstorm: judged` row and **Approach questions go to the judge** (draw after the copy, before
  ending on the question; redraw on a rerun).
- `CHANGELOG.md`.

Edit `skills/`, never the copies under the vault, `~/.arc/claude-mod/skills` or `~/.claude/skills`.

## Testing

Skills are prose: no unit tests. Check by hand in a fresh session after the next launch re-seeds the
skills: ask a plain session a UI question with two layouts and see it draw `A-…` and `B-…` boards and
reveal the canvas; ask for a one-line status mockup and see it ask first.
