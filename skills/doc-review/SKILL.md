---
name: doc-review
description: Use when you finish a meaningful edit to a paper (.tex) or a markdown note in an arcterm session and need the user to review it — ask a Doc review and stop.
---

# Asking for a Doc review

When you finish a meaningful edit to a paper (`.tex`) or a markdown note, ask the user to review it
instead of carrying on. arcterm shows them a sentence-level diff of what you changed, lets them comment
on passages, and sends their answer back to you.

## When to ask

- After one unit of work: by default one paper section or one note.
- If the repo's `AGENTS.md` or `CLAUDE.md` defines the unit differently ("one review per chapter",
  "only when the whole paper is done"), follow that.
- Skip trivial edits (typos, whitespace).

## How to ask

Use your ask tool (`AskUserQuestion` in Claude Code) with one question:

- header: `Doc review`
- question, line by line:
  1. the absolute path of one `.tex` or `.md` file, and nothing else on that line
  2. optional: a short intro of what you did
  3. optional: `Pages: N` (the page limit, for a paper)
  4. optional: one `- ` line per thing worth a look, e.g. `- §3.2 Method overview: rewritten`
- options: `Approve` and `Request changes`

One file per ask. Several files are several asks, one after another.

After asking, stop. Do not edit that file while the ask is open.

## What you get back

`Approve`: carry on with the next unit.

`Request changes` arrives as free text, with one numbered comment per passage, each quoting the
file's own source text:

```
Request changes
1. [§3.2 ¶2] "XYZ replaces the payload initialization…"
   → Say why this de-confounds success rate.
2. [§5.1 ¶1] "17/29 benchmarks…"
   → This disagrees with Table 3.
General: §3 still reads like a tutorial.
```

`[§3.2 ¶2]` is the section and paragraph (a markdown note reads `[5. ¶2]`). The `General:` line is
about the file as a whole and appears only when the user wrote one.

An item can also be an edit the user wrote into the paragraph's source:

```
3. [§1 ¶1] Edit: replace
   "a defect show up in a running"
   with
   "a defect manifest in a running"
   → optional note
```

The old text occurs exactly once in the file. Apply it as written; if it would break the document
(an unbalanced brace, a removed `\label` something refers to), apply what you can and say why in
the next review's lines.

## Handling Request changes

1. Find each quote in the file and handle its comment, then the general note.
2. Ask a new `Doc review` of the same file, with one `- ` line per comment, starting with its
   number: `- 1: §5.2 ¶1 now opens with the null result`.
3. Then stop again. Repeat until the user approves.
