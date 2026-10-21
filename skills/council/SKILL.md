---
name: council
description: Use when a direction was just weighed, a spec or plan was just written, or a paper draft is about to be submitted — offer a Council review as a numbered choice and, when picked, run it with `wsh council start` and read back its Summary.
---

# Offering a Council review

A council is a panel of expert agents that reviews one feature in three rounds of one-shot `claude -p` calls:
each expert proposes directions, the experts review each other's proposals, and a coordinator ranks the directions.
arcterm shows it as a Discussion with a Summary (ranked directions plus a matrix). One council costs roughly 0.5–1.5M
tokens, so you offer it and the person picks it; you never start one on your own.

## When to offer it

At a natural point, in the same place you would offer the Arc engine:

- a direction was just weighed with the person and they are about to commit to one;
- a spec was just written;
- a plan is written and about to go to the engine;
- a paper draft (`.tex`) is about to be submitted.

Offer it at most once per decision. If the person passed it over, do not offer it again for the same spec, plan or
draft. Never start one without their pick.

## The offer

Get the line to quote with `wsh council estimate`, which starts nothing and asks nothing:

```
wsh council estimate --feature "<the feature, in a few words>" --files <path>,<path> --group <group>
```

`--files` are the files the experts read (the spec or plan, the source it touches), comma-separated, relative to the
working directory or absolute; their size is part of the estimate. `--group` is `ui-feature` (the default, "Review a
UI feature") for a UI feature, a spec or a plan; use `paper` ("Paper review") for a `.tex` draft. `wsh council start`
and `wsh council estimate` take the same four flags (`--feature`, `--files`, `--group`, `--project`).

Put its line into a numbered choice, with your usual option to skip, and mark the council as recommended only when it
is worth the tokens:

```
1. Council review (recommended) — group "Review a UI feature": UX, RAM, New user, Skeptic on sonnet, Coordinator on opus · ≈ 9 calls · ~0.8M tokens · ~6 min
2. Carry on without it
```

Quote the line as `estimate` printed it: it names the group, every expert's model and the cost, which is what the
person is agreeing to.

## When it is picked

Picking it is the yes: run it at once, with no second question and no Setup. Use the same feature, files and group
as the offer:

```
wsh council start --feature "<the feature>" --files <path>,<path> --group <group>
```

It prints `council <id> started: …`. Then read it back:

```
wsh council wait <id>
```

`wait` polls until the council stops running, then prints its Summary and Matrix as markdown. Sum the directions up in
the conversation in a few lines (the top direction, why it ranked there, where the panel disagreed), and carry on from
there with the spec, the plan or the draft. A council started from this session puts each direction into this session's
Ideas list itself, so do not record them again with `wsh idea add`.

Optional flags of `start`: `--screenshot <png>` (repeatable) for a UI the experts should see, `--question "<text>"`
for something to put to the whole council, `--queue` to wait while another council of this project is running. Leave
`--pause` out unless the person asked for it: a paused council stops after round 1 and only the person can continue it.

## What can come back

- **`Not run: …`** is the person's call, from the Token burn gate. Do not retry. `start` saved the council as not run
  and exits 0: carry on without it, and say in your reply that the council was skipped and that Start council in the
  app runs it later.
- **A council waiting on the person** (`wait` says it paused after round 1) is theirs to continue in the app. Tell
  them, and carry on; do not call `wait` in a loop.
- **A failed council** makes `wait` exit non-zero with the reason. Report it and carry on; do not start another to
  retry, which would spend the tokens again.
- **A stopped council** prints what its finished rounds hold. Use it as it is.
- **A timeout** (`wait` gives up after 30 minutes by default) leaves the council running. Say so, and run
  `wsh council wait <id>` again later if you need the answer.

## The other commands

- `wsh council list` — the project's councils, newest first: id, state, round and feature.
- `wsh council show <id>` — a council's Summary and Matrix as markdown, without waiting.
- `wsh council stop <id>` — stop a running council; the rounds that finished stay. Only when the person asks.
