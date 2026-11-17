---
name: commit
description: Use in a Claude Code agent inside arcterm when you are about to stop and ask the person before committing (the repo's rules want their approval) — write the suggestion as an arc-commit block and end the turn, so arcterm's Chat shows an editable commit card; and when a "Commit exactly these files with exactly this message" line arrives, commit exactly that.
---

# Asking before a commit, as a card

Some repos want the person to approve each commit. Where you would stop and ask — a message in a code block, a list of
files, then "commit?" — write the suggestion as a ```` ```arc-commit ```` block instead, then **end the turn**.
arcterm's Chat draws it as a card: the message in an editable box, a tick per file, and a Commit button. The person
edits what they want and presses Commit; you get one line back and commit.

Write the block only where you would otherwise stop to ask before committing. In a repo whose rules let you commit on
your own, keep committing on your own: no block.

## The repo's rules come first

The repo's rules decide whether to ask and what the message says (its format, its ticket prefix, its scope tags). The
block only changes how the question is shown: the message inside follows the repo's format, and the block takes the
place of the repo's prose ask.

## The block

The message first, verbatim and possibly several lines, then a line that is exactly `---`, then one path per line:

````
```arc-commit
[SIEM-1746][ingest] Drop lagging partitions before rebalance

Rebalance waited on partitions that had already fallen behind.
---
services/ingest/rebalance.go
services/ingest/rebalance_test.go
```
````

- List only the files meant for this commit, with paths relative to your working directory.
- A block with no `---`, an empty message or no files is not a card: Chat shows it as code.
- Write a sentence or two of prose around it if it helps (what the commit holds); don't repeat the message or the files.

## When the Commit line arrives

Pressing Commit sends you exactly this, with the message and files the person left:

````
Commit exactly these files with exactly this message, unchanged:

```
<message>
```

- <path>
- <path>
````

Then:

1. Commit exactly that message and those files, unchanged. Write the message to a temp file and run
   `git commit -F <file> -- <paths>`: no amend, nothing else staged, and the repo's other commit rules still hold (no
   added trailers where the repo forbids them, hooks not skipped).
2. Report the new commit's hash in one line.

The person declines in their own words instead (there is no Skip button): read their reply and go on from it.

## Where it shows

Only a Claude agent's Chat view in arcterm draws the block. The terminal view shows it as code, which still reads as the
suggestion.
