# Subagent briefs — research apart from writing

A subagent's token cost is almost all cache reads: every tool call re-reads the whole context, so code it read
early is paid for again on every later call. Cost grows as (what it read) × (calls after that), not as what it read.

On 2026-10-08 a docs rewrite (session `444d9690`) spent ~222M tokens in 25 minutes. Four writer subagents each
`cat` ~800k characters of source, several whole files per command, then made 105–145 more calls on a context
of 400–566k tokens: 27–49M each. Three fact-checkers reading Go took 8–12M each.

## When to use these briefs

Any fan-out where a subagent must read a lot of code to produce something else — a guide page, a spec, an audit.
Split it in two:

1. A **research** subagent reads the code and returns a fact sheet. It writes nothing.
2. A **writing** subagent, with a fresh context, works from the sheet alone and reads no code.

Give each writer one page (or one unit of output). Several pages in one agent stack every page's reading into the
same context.

Nothing may be lost silently. Every limit below makes a gap visible — a range read, an `Omitted:` line, a
`TODO` — so the lead can fill it, instead of the agent guessing or quietly dropping it.

## Research brief

```markdown
Goal: collect the facts needed to write <page / output>. Do not write it.

Reading:
- Locate before reading: Grep/Glob for the symbol, string or route. Grep searches the whole repo,
  so a constant or keybinding defined in another file is found that way, not by reading more.
- A file under ~400 lines: read it whole. A larger file: Read with offset/limit around the hits;
  read further if the range is cut mid-thought.
- Never `cat` several files in one command: output over ~30k characters is truncated or moved to a file,
  and the part you did not see is easy to miss.

Budget: at most 40 tool calls. At the limit, return what you have and list what is missing.

Return ONLY a fact sheet, as short as it can be:
- one fact per line, each with its source `path:line`
- exact UI strings, keybindings, flags, defaults and paths, quoted as they appear in code
- `Contradicts old doc:` lines where the code disagrees with <old doc>
- `Omitted:` what you saw but left out, and `Not found:` what you looked for and could not find
No prose, no code excerpts longer than 3 lines.
```

## Writing brief

```markdown
Write <page> from the fact sheet below.

- Use only facts in the sheet. Do not read source code.
- A fact you need that the sheet lacks: write `<!-- TODO: verify <what> -->` and carry on.
  Do not guess and do not go read code to fill it.
- Keep each fact's `path:line` out of the page, but list them under `Sources:` in your reply.

<fact sheet>
```

## After the writers

The lead gathers every `TODO` and `Not found:` into one small lookup (one research brief, narrow scope), then
patches the pages. A fact-check pass, if any, checks the written page against the `path:line` sources in the sheet
— it reads those lines, not the whole area again.
