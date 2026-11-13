---
name: handoff
description: Use whenever superpowers:writing-plans finishes a plan inside Arc, i.e. `wsh` is on PATH, to ask the plan Handoff with AskUserQuestion in place of writing-plans' own two-option handoff, and whenever a review comes back inside Arc (a reviewer subagent, superpowers:code-reviewer, review-plan) to write one arc-review block, so Arc's Chat draws the handoff and the verdict as cards.
---

# Handoffs and reviews inside Arc

Arc's Chat draws two moments of your work as cards instead of prose: how a finished plan gets built (the
**Handoff**), and what a reviewer found (the **arc-review** block). Each card reads one thing you write, in the exact
words below, and sends the user's pick back to you as a line you can act on. This skill rides on
`superpowers:writing-plans` and on the review skills the way `arc:brainstorm` rides on brainstorming: follow them as
usual, with this beside them.

## Handoff

When `superpowers:writing-plans` finishes a plan and wrote it to a file, it offers two ways to build it in its own
words. Inside Arc, do not offer those. Ask this instead.

**Not in a run's agent.** When Arc started you for a run (it sets `ARC_RUN_AGENT` in your environment), hand the plan
over as your instructions say (an orchestrator run's lead uses `wsh jarvis dag submit --plan`) and skip the Handoff.

Use your ask tool (`AskUserQuestion` in Claude Code) with one question:

- header: `Handoff`
- question: names the plan file's path. Arc reads the first `.md` path in the text, so put the plan's path in
  backticks (absolute, or relative to your working directory) and add nothing before it that looks like another
  `.md` path. One more line on what the plan holds is welcome.
- options: these four, in this order, with these labels exactly. Each has a one-sentence description. Arc draws four
  lettered rows in this order whatever order you list them in, so a label that differs is a row Arc cannot find.
  1. `Arc engine`: start the run now (`wsh runs start --plan <file>`).
  2. `Arc engine, queued`: queue the start (`wsh runs start --plan <file> --queue`), which arcterm starts when there is room.
  3. `Inline in this session`: you work through the plan here (`superpowers:executing-plans`).
  4. `Subagent-driven`: a subagent per task with a review after each (`superpowers:subagent-driven-development`).

Mark exactly one option `(Recommended)` by ending its label with that word (`Arc engine (Recommended)`). Arc strips
the suffix, and draws the pill on that row. Chat recommends nothing itself: some rules below need what only you know.
Leave a choice out only when it cannot work here; Arc draws it disabled.

**Which one is recommended:**

- **Arc engine** (`wsh runs start --plan <file>` on the route `wsh runs route` prints) starts the run now. Recommended
  for a plan of three or more tasks.
- **Arc engine, queued** (`wsh runs start --plan <file> --queue`, or `--after <run>` when another run touches the same
  files) is started by arcterm when fewer than `runs:maxactive` runs are active (3 unless set) and its `--after` run
  has landed. Recommended in place of the first when `wsh runs list --all` shows `runs:maxactive` runs active or more.
- **Inline in this session** (`superpowers:executing-plans`) is recommended only for one or two tasks, or for a plan
  that stops for a hand check on a Mac between tasks.
- **Subagent-driven** has no rule that recommends it: mark it only when the user asked for it.

Never call the inline choice "Native": the person reads it as the engine.

After asking, stop. Start nothing until the answer arrives.

**What you get back.** A click arrives as the option's label (with `(Recommended)` on it if you wrote that). Words typed in the box arrive as the user's own text:
do what they say, and ask again only if it leaves the method open.

- `Arc engine`: run `wsh runs route`, tell the user the lead and worker models in one line, then run
  `wsh runs start --plan <file>` yourself (`arc:runs` has the flags and the route rules).
- `Arc engine, queued`: the same, with `--queue`, and `--after <run>` when another run touches the same files. It
  prints `queued q-… (#N in line) — …`. A queued start reads the plan and takes the base commit when it starts, not
  when it is queued: the plan file must still be there then, and an edit to it meanwhile is what runs.
- `Inline in this session`: carry on with `superpowers:executing-plans` here.
- `Subagent-driven`: carry on with `superpowers:subagent-driven-development`.

Picking either engine choice is the yes the fan-out cost rule asks for, so do not ask again before starting or
queueing the run. Chat draws the run's card where you start it, so say nothing more about it than one line.

A handoff written for a new session (a prompt or a file for an agent that has not seen this conversation) names the
chosen method in these words: `Arc engine`, `Arc engine, queued`, `Inline in this session` or `Subagent-driven`.

## arc-review

After every review subagent returns (`superpowers:code-reviewer`, the `review-plan` skill, any reviewer you dispatch
with the `Agent` tool), write one `arc-review` block in your reply, with the one JSON object inside the fence. Arc's
Chat draws it as a verdict card: the reviewer's findings as rows the user ticks, with **Fix** and **Skip** buttons.

```arc-review
{
  "kind": "code",
  "reviewer": "code-reviewer",
  "pass": false,
  "note": "Two real problems in the send path; the third is wording.",
  "findings": [
    { "severity": "Important", "file": "pkg/jarvis/send.go", "line": 88, "summary": "A failed prompt still records the answer, so the card folds on a send that never happened." },
    { "severity": "Important", "file": "pkg/jarvis/send.go", "line": 131, "summary": "The retry sends the line twice when the first attempt only timed out." },
    { "severity": "Minor", "file": "frontend/app/view/agents/chatpane.tsx", "line": 412, "summary": "The hint reads \"bellow\"." }
  ],
  "subagent": "Review the send path"
}
```

- `kind`: `"code"` or `"plan"`. Required.
- `pass`: `true` when the reviewer approves, `false` when it asks for changes. Required, and a boolean.
- `reviewer`: the reviewer's short name, as the card's header shows it (`code-reviewer`, `review-plan`).
- `note`: one sentence that sums the review up; the card's summary line.
- `findings`: one object per finding, left out or `[]` when the review passes. `severity` is `"Critical"`,
  `"Important"` or `"Minor"`, as `superpowers:code-reviewer` uses them (Critical and Important start ticked); `file`
  and `line` (a positive whole number, left out when there is none) say where, and for a plan review name the plan's
  file and the line of the task; `summary` is one sentence and every finding needs one. Write the reviewer's findings
  and severities as it reported them: add none and soften none.
- `subagent`: the `description` of the `Agent` call that ran the review, exactly as that call wrote it. Arc pairs the
  block with the call by it and lets the user open the reviewer's transcript. Leave it out for a review that ran in
  your own session (`review-plan`): without it Arc pairs the block with the nearest reviewer call before it.

Broken JSON, a `pass` that is not a boolean, a `kind` that is not `code` or `plan`, or a finding with no `summary`
leaves the block a plain code block in Chat. Write the block only for a review that ran: Chat never guesses a verdict from prose. `/code-review`
needs no block: its `ReportFindings` call is read directly. Never repeat the findings in prose around the block: the
card shows them, and a list beside it shows them twice. One line before the block is enough.

**Then wait, when the findings need the user's pick.** Stop after the block, as after any question. The user ticks
findings and presses a button, or types their own words. Two lines come from the buttons:

- `Fix these review findings:` followed by one `- <file>:<line> — <summary>` line per ticked finding: fix exactly
  those, nothing more, and say what you changed.
- `Skip the review: go on without these changes.`: carry on without fixing any.

When you fix a review's findings yourself as part of your own process (the per-task reviews inside
`superpowers:subagent-driven-development`), write the block and carry on without stopping: the card folds into its ✓
row when you write on. A passing review with no findings needs no pick either: write the block and carry on.
