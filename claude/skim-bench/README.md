# Skim TL;DR bench

Measures how well the fold skim draws for a long reply (`claude/skim-mod/hooks/fold-core.ts`) keeps the reply's point.
Spec: `docs/superpowers/specs/2026-11-09-skim-tldr-bench-design.md`. This folder sits outside `claude/skim-mod`, so
`scripts/publish-skim.mjs` never ships it.

## Layout

- `cases/<id>.json`: one case each: `reply`, `marks`, `source` (`generated` or `history`), `mustKeep` (units the fold
  must show whole, each tagged criterion 2 or 3), `questions` (each with its answer), `labels` (set on the review page:
  `reviewed`, `ab`, `note`). `g-*` are generated; `h-*` are history replies the person approved.
- `bench-core.ts`: layer 1, the rules, and the case types. Sections are read by `claude/skim-mod/hooks/sections-core.ts`,
  which the fold shares.
- `bench.test.ts`: layer 1 in `npm test`; prints each criterion's pass rate and fails below `baseline.json`.
- `baseline.json`: written by `--baseline`; each case's fold (the review page's A) and score.
- `results/`: one file per `--llm` run, named by time and commit.
- `cache/` (gitignored): model calls keyed by the hash of what they read.

History drafts are not here: they wait, unscrubbed and uncommitted, in `~/.arc/skim-bench/drafts` (`SKIM_BENCH_DRAFTS`
overrides it) until the person approves them on the review page, which moves them into `cases/`.

## Criteria

A fold passes a case when (1) no kept item is only its bold label; (2) every must-keep unit of criterion 2 shows whole;
(3) a kept sentence ending in `:` is followed by the block it points at, no heading stands empty, and every criterion 3
unit shows whole; (4) every section of the reply (the opening, each heading, each bold label alone on its line) has a
line of its own content under its title in the fold, a table-only or code-only section as one stub line such as
`(table · 12 rows)`, never raw rows or code. A fold of 2/3 of the reply's lines or more draws the reply in full, which
passes. Layer 1 also fails when the median fold/reply line ratio rises more than 10 points over the baseline.

## Commands

```
node scripts/skim-bench.mjs                      layer 1 per case, against the baseline
node scripts/skim-bench.mjs --review             review page on http://localhost:5199/
node scripts/skim-bench.mjs --baseline --llm     save the baseline, layers 2-3 included
node scripts/skim-bench.mjs --llm                layers 2-3 (haiku answers from the fold alone, sonnet grades)
node scripts/skim-bench.mjs --draft --dry        preview which history replies --draft would pick
```

## The steps

1. Review the drafts on the review page: scrub what the automatic scrub missed (names, private figures), correct
   must-keep and questions, approve or drop each. Commit the approved `cases/h-*.json`.
2. `--baseline --llm` on the approved cases, commit `baseline.json` and the result; then fix the fold until layer 1
   passes every case, the median ratio stays within 10 points, and layers 2-3 score no lower.
3. Grade A against B on the review page.
