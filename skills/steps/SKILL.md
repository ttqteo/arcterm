---
name: steps
description: Use in a Claude Code agent inside arcterm when you start work that takes three or more steps — write the steps as an arc-steps block in your reply, and rewrite the whole block each time a step changes, so arcterm's Chat shows your plan as a checklist.
---

# Showing your steps in Chat

When you start work that takes **three or more steps**, list them in your reply as a ```` ```arc-steps ```` block.
arcterm's Chat draws it as a checklist inside the turn: a tick for a done step, a pulsing green ring for the one you
are on, a dashed ring for the rest. The agent card's done/total chip counts the same list.

Skip it for a question, a one-line answer or a small fix.

## The block

One step per line, a marker then the step's text:

````
```arc-steps
[x] Read the failing test
[>] Patch the handler
[ ] Add a regression test
```
````

- `[x]` done, `[>]` being worked on, `[ ]` not started.
- Keep each step to a short line, in the order you will do them.
- A line without one of the three markers is ignored, so write nothing else inside the block.

## Keep it current

Each time a step changes state, write the **whole block again** in your reply, every step with its new marker. Chat
draws one list per turn, where you first wrote it, and each later block in the same turn updates that list in place;
the later blocks show nothing where they stand. So never write only the step that changed.

- Mark a step `[>]` when you start it and `[x]` when it is done; one step is `[>]` at a time.
- Add or drop a step by rewriting the block with it in or out.
- Before you end the turn, write the block once more with the finished steps ticked.

## Where it shows

Only a Claude agent's Chat view in arcterm draws the block. The terminal view and councils show it as code. A pi or
codex agent does not use this block: keep using your own list tool (`TaskCreate` / `TaskList` in pi, `update_plan` in
codex), which the agent card already reads.
