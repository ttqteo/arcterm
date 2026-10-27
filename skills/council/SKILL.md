---
name: council
description: Use when the conversation holds a clear problem or a thing to judge and a real open question more viewpoints would settle (two directions weighed and neither won, a spec or plan just written, a draft about to be submitted), or when the person asks for a council ("ask a council", "hỏi council", /arc:council) — start it yourself with `wsh council start`, wait for it, and sum its report up in the conversation.
---

# Starting a Council

A council is a panel of expert agents that works one question in three rounds of one-shot `claude -p` calls: each
expert proposes, the experts react to each other's proposals, and a coordinator writes the answer. It runs in one of
two modes, which you pick:

- **`review`** — a thing to judge (a spec, a plan, a design, a draft, two directions already on the table). The report
  ranks up to three directions, each with its first step, and lists the rest under Also raised, one line each.
- **`brainstorm`** — a problem or a goal with no answer yet. The report holds up to three ideas worth trying, each with
  its why and a first step, plus the wild ideas kept aside.

arcterm shows it as a group chat while it runs, then as a report, and saves every finished council as a document in the
project's `docs/council/` with its whole discussion. One council costs roughly 0.5–1.5M tokens. The Token burn gate
prices every start and asks the person when it is costly, so you start one without asking first.

## When to start one

**Without being asked**, when the conversation holds a clear problem or a thing to judge *and* a real open question
that more viewpoints would settle:

- two directions were weighed and neither won;
- a spec or a plan was just written, before it goes to the engine;
- a paper draft (`.tex`) is about to be submitted.

**At once** when the person asks for one: "ask a council", "hỏi council", `/arc:council`. Do not judge whether the
conversation is ready; use what it holds. If they ask and the conversation holds no question yet, ask for it in one line; do not invent one.

**Not** for a question already settled, a small or reversible choice, a question you can answer by reading the code,
or when the person said no council. Start at most one council per decision: if the person stopped one or turned it
down for this spec, plan, draft or question, do not start another for it unless they ask. `wsh council list` shows the
project's councils, so check it before starting a second one on the same thing.

## Starting it

Pick the mode yourself, from the question: a problem or a goal ("how do we…", "what should…") is `brainstorm`; a thing
that exists to be judged (a draft, a spec, a plan, a feature, "review this", "what's wrong with…") is `review`. The
person does not choose it. Then run:

```
wsh council start --mode <review|brainstorm> --mode-why "<one line: why this mode>" \
  --feature "<the first line: what the council looks at>" \
  --question "<the question in the person's words. Keep to: <the constraints they stated>>" \
  --files <path>,<path> [--screenshot <png>]...
```

- `--mode-why` is one line, kept with the council beside its mode ("a goal with no answer yet", "a plan to judge").
- `--question` is the person's question in their own words, not your reading of it, and not your preferred answer: a
  council anchored on your view adds nothing. When they stated constraints (the budget, the stack, what is out of
  scope, what is already decided), add them after "Keep to:"; leave "Keep to:" out when they stated none.
- `--files` are the files the experts read (the spec or plan, the source it touches), comma-separated, relative to the
  working directory or absolute. Their size is part of the cost, so name what matters, not the whole tree.
- `--screenshot <png>` (repeatable) for a UI the experts should see.
- `--group` is optional: `brainstorm` takes `product-ideas` and `review` takes `ui-feature` (a UI feature, a spec or a
  plan) when you leave it out. Use `--group paper` ("Paper review") for a `.tex` draft.
- Leave `--pause` out unless the person asked for it: a paused council stops after round 1 and only the person can
  continue it. `--queue` is accepted and does nothing more; every second start is queued.

Say in **one line** what happened, from the line `start` printed:

- `council <id> started: …` — it is running. Say so with the mode, the group and the estimate.
- `Queued after <id> (<feature>)` — one council runs at a time across all projects, so this one waits for the running
  council and starts by itself when it ends. Say so, and which council it waits for.
- `Not run: …` — see below.

Then read it back:

```
wsh council wait <id>
```

`<id>` is the new council's own id; when the printed line does not carry it, `wsh council list` shows it (newest
first). `wait` polls until the council stops running (a queued one included), then prints the report and the matrix as
markdown. Sum it up in the conversation in a few lines: for a review, the top direction, why it ranked there, its first
step and where the panel disagreed; for a brainstorm, the ideas worth trying with their first steps, and a wild idea only when it
changes the choice. Then carry on from there with the spec, the plan, the draft or the problem.

A council's directions are only in its report. Its document is saved under the project's `docs/council/` when it ends
(done or stopped); `wsh council show <id> --json` carries its path as `docpath`.

## What can come back

- **`Not run: …`** is the person's call, from the Token burn gate. Do not retry. `start` saved the council as not run
  and exits 0: carry on without it, and say in your reply that the council was skipped and that Start council in the
  app runs it later.
- **A council waiting on the person** (`wait` says it paused after round 1) is theirs to continue in the app. Tell
  them, and carry on; do not call `wait` in a loop.
- **A failed council** makes `wait` exit non-zero with the reason. Report it and carry on; do not start another to
  retry, which would spend the tokens again.
- **A stopped council** prints what its finished rounds hold. Use it as it is.
- **A timeout** (`wait` gives up after 30 minutes by default) leaves the council as it is, running or still queued.
  Say so, and run `wsh council wait <id>` again later if you need the answer.

## The other commands

- `wsh council list` — the project's councils, newest first: id, state, round and feature.
- `wsh council show <id>` — a council's report and matrix as markdown, without waiting.
- `wsh council stop <id>` — stop a running or queued council; the rounds that finished stay. Only when the person asks.
