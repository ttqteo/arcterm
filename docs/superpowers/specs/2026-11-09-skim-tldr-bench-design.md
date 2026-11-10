# Skim TL;DR benchmark, and a fold that keeps the point

Brainstorm: `.superpowers/brainstorm/skim-tldr-bench/brainstorm.json` (2026-11-09).

## Goal

Measure the **quality** of the fold that skim draws for a long reply (its TL;DR): does the folded text keep what the
person must read, and how terse is it. Speed is out of scope. Then fix the fold until the benchmark passes, and report
the numbers before and after.

The person's complaint: the folds they read feel too terse and lose the reply's point.

**Two stages, with the person's review between them** *(builder question 2)*:

1. Build the bench (layers 1–3), the review page and draft cases. History cases stay uncommitted.
2. *(Gate.)* The person reviews, scrubs and approves the cases on the review page; the approved cases are committed.
3. Save the baseline on the approved cases, fix the fold until the bench passes, report before/after, and the person
   grades A/B.

Stage 1 and stage 2 (step 3) are separate runs; the fix never runs on unreviewed cases.

## What exists today

- `claude/skim-mod/hooks/fold-core.ts`: `canFold` (more than `FOLD_LINES` = 10 lines), `endsOnQuestion`,
  `folded(text, marks) → { text, marks }`.
  - No marks: the first prose paragraph (plus the next one when it ends on a colon), then at most `MAX_REASONS` = 4
    items of the **first** list, each cut by `firstSentence` to its bold lead plus first sentence
    (`MAX_REASON_CHARS` 160, `MAX_SENTENCE_CHARS` 320).
  - Marks: `foldMarked` keeps the verdict, then each marked sentence in order, a section's heading above the first mark
    under it, and fences of `! command` lines.
- `register.ts` calls it from `ui.render` of `AssistantMessage`. Unit tests: `fold-core.test.ts`,
  `highlight-core.test.ts`. Both cores are pure TS with no `claude-code` import, so esbuild bundles them for node.
- Real replies on the machine: `~/.claude/projects/**/*.jsonl` (replies stored without marks). Skim's marks live in
  `~/.claude/plugins/store/skim_inline-*.json`, key `highlightMarks`: up to 500 `[hash, marks]` pairs, where
  `hash = hashText(clean)` (`highlight-core.ts:136`), so a transcript reply re-hashed finds its marks.
- `scripts/publish-skim.mjs` copies all of `claude/skim-mod` (minus `*.test.ts` and `.claude-plugin/types`) to the
  public `claude-skim` repo: nothing private may live under `claude/skim-mod`.

### What a scan of 316 real replies found

`folded()` run on the foldable prose replies of the 400 newest transcripts (316 replies, 41 with marks): the fold keeps
10% / 25% / 41% of the characters at p10 / p50 / p90. Four ways it loses the point, each seen many times:

1. **A reason left as an empty bold label.** When the sentence after a lead is over 160 characters, `firstSentence`
   returns the lead alone: `- **What they do:**`, `- **Runtime name:**`.
2. **Only the first list survives.** `byPosition` takes the first list; later sections, often the warnings, vanish
   ("Cần bạn để ý", "Found not fixed", "Judgement call").
3. **A marked reply loses the context of a mark.** The mark "The decision is yours:" stays, the (a)/(b) options it
   points at go; a heading ("Everything else passed…") stays with nothing under it.
4. **A marked reply folds too hard.** An 11-line reply folds to 2 sentences and drops "What landed" entirely.

## What "keeps the point" means

A fold passes a case when all four hold:

1. **Every reason has content.** An item that is kept is never only its bold label.
2. **Warnings and what waits on the person stay.** Sections such as "Cần bạn để ý", "Found not fixed",
   "Judgement call" reach the fold even when they come after the first list.
3. **A mark keeps its context.** A marked sentence ending in `:` brings what it points at (the options); a heading
   shows only with content under it.
4. **Long enough to grasp the whole reply.** Every section of the reply (the opening paragraph, each heading, each bold
   label standing on its own line) has at least one line of content in the fold. There is no character-ratio floor.
   A section that is only a table or only code (not a fence of `! command` lines, which stays whole as today) meets this
   with one stub line such as "(table · 12 rows)" or "(code · 8 lines)", never raw rows or code lines. *(Agent's call,
   builder question 3.)*

**Ceiling.** A fold that would be 2/3 of the reply's lines or more is not drawn: the reply draws in full. Layer 1 also
reports the median fold-to-reply line ratio and fails when it rises more than 10 points above the baseline, so the
bench catches a regression towards "too long" as well as "too terse". *(Builder question 1.)*

## Cases

Committed, scrubbed, under `claude/skim-bench/` (outside `claude/skim-mod`, so `publish-skim` never ships them).

- **~40 replies from history**, picked from the foldable replies of the transcripts: cover all four failure kinds,
  marked and unmarked replies (all 41 marked ones are candidates), skip JSON replies from headless runs. Scrubbed of
  machine paths, people's names, tokens and private figures, then reviewed by the person on the review page before
  commit.
- **~20 generated cases**, one or more per failure kind: a lead followed by a sentence over 160 characters, a warning
  section after the first list, a marked sentence ending in `:` pointing at options, a reply of many sections, long
  tables and code.
- One JSON file per case: `reply`, `marks`, `source` (`history` or `generated`), `mustKeep` (units the fold must keep,
  each tagged with the criterion it serves: warning sections, what waits on the person, what a `:` sentence points
  at), `questions` (each with its answer, written once), and `labels` (what the person set on the review page).
- First drafts of `mustKeep` and `questions` are written by a model from the reply; the person corrects and approves
  them on the review page. *(Agent's call, builder question 2.)*
- Each `mustKeep` unit is written as its first sentence. It counts as kept when that sentence appears whole in the fold
  (compared after collapsing whitespace); cut mid-sentence, it is lost. So the fold shows must-keep material (warnings,
  what waits on the person, the options a `:` sentence points at) in whole sentences, and may cut other reasons at a
  word boundary. *(Agent's call, builder question 4.)*
- `mustKeep` is never just the marks: `foldMarked` keeps every mark it finds, so recall on marks is always ~100% and
  would never catch "too terse".

## Scoring, in four layers

1. **Rules + must-keep** (vitest, no tokens, deterministic). Rules: no kept item is a bare bold label (criterion 1);
   every section has a line (criterion 4); a `:`-ending kept sentence is followed by its block, and no heading stands
   empty (criterion 3). Must-keep recall per case (criteria 2 and 3). Reports the share of cases passing per
   criterion, and fails when a criterion drops below the saved baseline.
2. **Questions from the fold alone.** Each case's questions are written once and stored with it; on each run a model
   reads **only the fold** and answers; the score is the share answered correctly.
3. **LLM grading each run.** A model reads the reply and its fold and scores each of the four criteria 1–5 with a
   reason.
4. **Hand review, A/B.** A page shows each case's reply beside two TL;DRs, A (the fold at the baseline) and B (the
   fold in the working tree), order shuffled per case. The person picks the one that keeps the point better and ticks
   the criteria the loser broke; the same page is where they review and edit each case's must-keep and questions.
   Reports B's win rate; the labels are kept as ground truth to check layers 1–3 against.

## Running it

- Layer 1 is a vitest test over `folded()` that runs with `npm test`, prints per-criterion pass rates, and fails below
  the baseline stored in `claude/skim-bench/`.
- `node scripts/skim-bench.mjs --llm` runs layers 2 and 3 through `claude -p` (answers with haiku, fold-only; grading
  with sonnet), cached by the hash of each fold so a rerun with an unchanged fold costs no tokens. Each run writes its
  results to `claude/skim-bench/results/` with the commit, for before/after comparison.
- `node scripts/skim-bench.mjs --review` serves the review page on localhost; labels write straight into the case
  files. It is a dev tool, not part of the app, so DESIGN.md tokens do not apply.

## Fixing the fold

After the baseline is saved, change `fold-core.ts`:

- An item is never left as its bold label alone: cut the sentence after the lead at a word boundary instead of
  dropping it.
- Every section gets at least one line, not only the first list.
- A marked sentence ending in `:` brings the block it points at; a heading shows only with content under it.

- A fold of 2/3 of the reply's lines or more is dropped and the reply draws in full (the ceiling above).

Stop when layer 1 passes 100% of cases, the median length ratio is no more than 10 points above the baseline, and
layers 2–3 score no lower than the baseline. Update `fold-core.test.ts` to
the new behaviour. Bump skim's version in `claude/skim-mod/.claude-plugin/plugin.json` (0.3.5 → 0.3.6 or 0.4.0) and add
one `CHANGELOG.md` line. Finish with the person grading A/B on the review page to confirm the new fold keeps the point
better.

## Left to the builder

The exact ~40 history replies; the scrub rules; the wording of the question and grading prompts; how a section is
recognised (heading, a bold label on its own line, the opening paragraph), shared by the rules and the new fold; the
longest a section's one line may be.
