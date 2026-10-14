---
description: Record the idea just discussed in arcterm's Ideas list
---

Record one item in arcterm's Ideas list for this session, with `wsh idea add`.

If arguments follow the command, record those words: $ARGUMENTS

If there are none, sum up the idea, decision or open question that was just discussed in one line. Do not batch
several into one line; record each separately.

Write the line in the language of the conversation, then run:

`wsh idea add "<line>" --kind <kind> --topic "<topic>" --by you`

`<kind>` is `decision` when something was settled, `idea` when a direction was floated, and `question` when
something was left open. Run `wsh idea list` first: do not repeat an item it already holds, and take `<topic>` from
its topics, spelled the same; leave `--topic` out when the list has no topics or none fits. Reply with the one line
you recorded and nothing else.
