# Council v2, Phases 0 and 0b: agent teams probed and benchmarked against council v1

2026-10-22 (Phase 0) and 2026-10-23 (Phase 0b, the section before "The benchmark since"). Spec:
`docs/superpowers/specs/2026-10-22-council-agent-team-design.md` (Benchmark, Phases item 0). No product code changed in
either. The cases, keys, scripts, logs and judged files live in arcterm's data dir under `council-bench/`, outside the
repo, so none of them is reproduced here beyond the figures below.

**Verdict (Phase 0b, three cases): no-go on the benchmark's terms; by the rule's letter it is still "not decided".** The
agent team (V3) tied council v1 (V2) and one agent (V0) on recall, 3, 3 and 2.5 of 16 key lines, which is inside the
judge's noise, at 13.4M tokens against V2's 26.3M and V0's 7.9M: cheaper than the panel, 1.7 times one agent's tokens
for no recall it showed. The second runs that 0b's close rule needs did not fit the person's 50M cap, so no pair of
variants was ever turned into a tie. The cases could barely separate any variant (11 of the 16 key lines were matched by
none), so this reads "not shown to help", not "shown not to help". It does not justify planning the room on agent teams;
v1 stays as the council.

Phase 0's own verdict, below, stands only for its own two cases: **not decided: re-run codefix and re-run newcomer.**
Every comparison but newcomer V2 against V3 is close (one key line separates them at most), and the rule says a close
case is not decided. The numbers leaned no-go: V3 scored lowest and cost 2 to 6 times the others. Everything from "What
was compared" to "Tokens Phase 0 used in total" is Phase 0.

## What was compared

One pass, one run per cell, two cases (papercase removed at the person's request after V0-V2 ran):

- **codefix** (Review, top 5, group `ui-feature`): a real bug fixed later in arcterm (the answer key is that one bug).
  1 key line.
- **newcomer** (Brainstorm, top 3, group `ui-feature`): what would help a first-time user of a finished council.
  5 key lines.
- **V0** one agent (`solo-ui` group); **V1** council v1 without its argue round (round 1 + the Summary); **V2** council
  v1; **V3** a lead Claude Code session given the harness as a prompt, agent teams on, teammates are the same
  `ui-feature` roles plus a Scout, read-only tools plus Write for notes and the report.
- An opus `claude -p` judge scores each report against its key by "the same problem, not the same topic". Every report
  is cut to the same top items first (5 for Review, 3 for Brainstorm). Tokens are `pkg/consult`'s count (input + cache
  read + cache creation + output); V3's is the transcript total over the lead and every teammate.

## Results

| case | variant | recall | wrong items | tokens | minutes | messages | recall per M tokens |
|---|---|---|---|---|---|---|---|
| codefix | V0 | 1/1 | 0 | 543,609 | 2.5 | 4 | 1.84 |
| codefix | V1 | 1/1 | 0 | 1,382,251 | 4.4 | 16 | 0.72 |
| codefix | V2 | 1/1 | 0 | 1,479,206 | 5.2 | 69 | 0.68 |
| codefix | V3 | 1/1 | 0 | 3,174,738 | 4.4 | 5 | 0.31 |
| newcomer | V0 | 1/5 | 0 | 542,112 | 2.0 | 4 | 0.37 |
| newcomer | V1 | 1/5 | 0 | 1,368,685 | 6.6 | 19 | 0.15 |
| newcomer | V2 | 2/5 | 0 | 1,398,867 | 8.7 | 80 | 0.29 |
| newcomer | V3 | 0/5 | 0 | 2,978,520 | 5.3 | 6 | 0.00 |
| **sum, both cases** | V0 | 2/6 | 0 | 1,085,721 | | | 0.31 |
| | V1 | 2/6 | 0 | 2,750,936 | | | 0.12 |
| | V2 | 3/6 | 0 | 2,878,073 | | | 0.17 |
| | V3 | 1/6 | 0 | 6,153,258 | | | 0.03 |

V1's minutes are round 1's slowest expert plus the synthesis, not wall time (the wait for Summarize is left out); the
other variants' minutes are wall time. The summed rows' last column is recall (key lines matched ÷ 6) per M tokens. Counted in key lines matched per M tokens
instead (2 ÷ 1.086M for V0), the same rows read 1.84, 0.73, 1.04 and 0.16.

Every cell is "close" in the judge's sense: the whole codefix case (all four found the one bug at rank 1, so recall
cannot tell them apart; only cost differs), and in newcomer each pair but V2 against V3 differs by one key line at most (V0 and V1 tie). V3's
Wild ideas, kept aside and outside recall, matched K1 (open a finished council on its Summary) once in newcomer; that
is not in the table.

No variant matched K3 (the top-3 picks vote), K4 (answer-first Summary) or K5 (done/waiting notifications) in its top 3.

**Two flags on the data.**

- newcomer V2's second match (rank 3, "define round, score, stance and coordinator in visible captions" as K2) is
  borderline: it names the same problem but fixes it with captions instead of replacing the words. Without it V2 is 1/5
  and ties V0 and V1.
- newcomer V3 is not a clean run. At 07:38:32Z, mid Phase 2, a message meant for another worker (a lead's note about the
  codefix rerun) was injected into the V3 lead's session, because a lead launched from a tab inherits that tab's block
  id. The lead ran Phase 2 as normal after it (4 `SendMessage`) and wrote its report at 07:41:05Z; before that it had
  read only its own `notes.md` and made 2 Grep calls in the newcomer project. The search came after the report, at
  07:41:08 to 07:41:35Z: 6 Glob calls (the run copies, the projects root, the data dir, `council-bench/work/v3`,
  `council-bench`), a Read of `run.sh` and 1 Grep of `runs.jsonl`, looking for the codefix rerun's launcher, which it
  could not run. It looked through the data dir and the bench folder, not the codefix run folder, and read no answer key.
  The run took 5.3 minutes, so the stray message may have rushed its wrap-up. The codefix rerun's lead got no such
  message. The first (skipped) codefix V3 run did.

## What each addition bought

Recall, and recall per million tokens, per case (the cases have different key sizes, so the summed rows above are
recall over all 6 key lines, a different quantity from the per-case figures).

| step | codefix | newcomer |
|---|---|---|
| **argue round** (V2 vs V1) | same recall (1/1 each), +97k tokens (+7%); recall per M 0.68 vs 0.72 | 2/5 vs 1/5, +30k tokens (+2%); recall per M 0.29 vs 0.15; the extra match is the borderline K2 |
| **panel** (V1 vs V0) | same recall (1/1 each) at 2.5x the tokens; recall per M 0.72 vs 1.84 | same recall (1/5 each) at 2.5x the tokens; recall per M 0.15 vs 0.37 |
| **agent team** (V3 vs V2) | same recall (1/1 each) at 2.1x the tokens (+1.70M); recall per M 0.31 vs 0.68 | 0/5 vs 2/5 at 2.1x the tokens (+1.58M); recall per M 0.00 vs 0.29 |

- **The argue round** cost almost nothing on top of V1 (V1 already pays for the Summary and round 1; the estimate's "V1
  is half of V2" was wrong: V1 cost as much as V2). It is the only step that scored higher anywhere, and by one
  borderline line.
- **The panel** bought no recall at 2.5x the tokens: V0 matched V1 on both cases. A single agent is the best value on
  these two cases (1.84 key lines matched per M tokens summed, against 1.04 for V2; as recall per M, 0.31 against 0.17).
- **The agent team** bought nothing: equal on codefix, lower on newcomer, at about twice V2's tokens. Against the
  estimate, newcomer V3 (2.98M) came in inside the 2.5 to 3.9M expected, but the codefix rerun (3.17M) came in above the
  2.0 to 3.0M expected.

## Probe: agent teams in Claude Code 2.1.307

Details and logs are in `council-bench/work/teamprobe.md` (data dir). The live half did not run: the person opened no
Claude agent in the probe folder, so `wsh agents send` into a live lead and a Token burn card on the probe were never
observed. The rest ran headless, driven through `claude -p --input-format stream-json` (a later user message is what
`wsh agents send` also delivers).

- **A team** is the lead's named `Agent` calls plus `SendMessage`. No team object exists (no TeamCreate tool with the
  switch on or off; `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` made no visible difference to teammates).
- **Spawning needs `--permission-mode bypassPermissions`**: arcterm's gate (`subagentNeedsApproval`) asks on every Agent
  call otherwise, and nobody answers headless. Past 10 Agent calls per session the gate refuses (`jarvis.MaxSubagents`;
  a `SendMessage` resume is not an Agent call). A lead that starts 3 or more at once waits on a Token burn card; the
  card lands on the tab that launched the lead and a card unanswered for 30 minutes counts as a refusal (this ended the
  first codefix V3 run).
- **Messages live in files arcterm can tail**: every teammate's whole exchange is an append-only JSONL under
  `<session>/subagents/agent-<id>.jsonl` beside the lead's transcript, with a `meta.json`. A message to a teammate is a
  user turn in the recipient's file; the sender's file holds a `SendMessage` tool use. A stream-json session also emits
  `task_started`, `task_progress`, `task_updated`, `task_notification` events to a host that owns the lead's stdout.
- **The lead ran the phases: yes.** In the probe it spawned both teammates, waited for both Phase 1 hand-backs, then sent
  Phase 2, and ended early when a reply added no new point. In the two real V3 runs it did the same (spawn, wait, one
  `SendMessage` round, then the report), and teammates also messaged each other directly when the prompt told them to
  (3 messages to Skeptic in codefix, for instance); left alone, the lead relays everything.
- **A message reaches the lead from outside: yes.** A second stdin user message arrived as an ordinary user turn. The
  stray message in newcomer V3 above shows the same through `wsh`.
- **Steering reaches a teammate: yes, through the lead.** The lead turned "tell Bob to argue the opposite of Alice" into
  its own `SendMessage` and Bob's next message argued the opposite. The lead chose what "opposite" meant, so it is real
  but re-worded.
- **A teammate sleeps and resumes with its context: yes.** A finished teammate costs nothing until messaged;
  `SendMessage` to it returned "Resuming agent Bob" with the same id and the same transcript, and Bob quoted all four
  earlier messages exactly (not a fresh agent with the same name). "Shut down" was never shown on a running teammate:
  every one had already finished when the stop landed. Each resume pays the teammate's whole transcript again.
- **Processes: one.** Teammates run inside the lead's process (`spawnDepth: 1`), so there is no process of their own to
  sample or end.
- **Peak RSS per teammate: not separable, and under 512 MiB.** The whole team, lead included, peaked at 311 to 341 MiB;
  two teammates added no measurable RSS over the lead's own start-up peak (311 before, 308 after; 323 before, 283
  after). A teammate costs tokens, not RAM. Not measured on the real V3 runs (opus teammates reading real files).
- **The awake limit that implies on this Mac** (8 GiB; the spec's rule is (free − 512 MiB headroom) ÷ the per-agent peak,
  at most 6): with about 39% free at writing (about 3.1 GiB), the 512 MiB v1 claim gives 5; the measured whole-team peak
  of 341 MiB as a per-agent bound gives 7, so 6, the hard max. In-process teammates add no process RAM, so RAM does not
  cap a V3 team here: the caps that bind are the 10 Agent calls per session and tokens. The limit would apply only to
  the `wsh council say` path (one resumed process per turn).
- **Cost shape:** every model call carries 27 to 36k tokens of base context, so a haiku teammate with two small tasks
  cost about 60k and its lead about 3.4 times that.

## Go / no-go

The rule, summed over the cases: go when V3's recall is higher than both V2's and V0's, or equal to the better of them
at fewer tokens; no-go when V3 costs more without scoring higher (the spec's anti-goal); a case marked close makes it
"not decided: re-run <case>".

Summed over codefix and newcomer (two cases, not three), V3's recall is 1/6 against V2's 3/6 and
V0's 2/6, at 6.15M tokens against 2.88M and 1.09M. On the numbers alone that is the no-go case. But both cases are
marked close, so by the rule the answer is **not decided: re-run codefix, re-run newcomer**. A re-run needs more key
lines than codefix has (one key line cannot separate four variants; a second code case would), and one run per cell
cannot show whether V3's 0/5 on newcomer is the variant or the stray message.

## The plumbing, if the room is built on agent teams

The probe found messages in files arcterm can read and steering that reaches teammates, so the plumbing it implies is to
**tail the team's files** (the lead's and each teammate's JSONL, plus the stream-json events if arcterm owns the lead's
process) rather than the `wsh council say` path. That holds only if the benchmark later says to build the room on teams.
Two limits to carry: steering and Phase 2 are mediated by the lead (re-worded, and teammates talk to each other only
when told to), and `wsh agents send` into a live lead was not tested directly (only stream-json stdin, and the stray
message above).

## Deviations

- **Newcomer's team**: it used `ui-feature` (UX, RAM, Newuser, Skeptic + a Scout), deliberately not the spec's Product
  ideas default, so the variants differ only in setup. Product ideas is benchmarked in Phase 3.
- **Brainstorm scored on the top 3**, and V3's Wild ideas kept aside in a column of their own, outside recall.
- **Two cases, not three**: the go/no-go is applied over codefix and newcomer. Phase 0b then built four cases and ran
  three of them (agents-bugs was dropped before any cell ran); see its section.
- **codefix V3 ran twice.** The first run was skipped: its 4th teammate's Token burn card timed out after 30 minutes
  unanswered (2.04M tokens, 3 of 4 roles), and it was rerun at the person's call. Its tokens are in the pass's total
  spend but not in V3's per-run cost above. It is a cost lesson: a headless team stalls on one card.
- **newcomer V3 got a stray message** mid Phase 2 (see Results).
- **Both V1 Summaries were produced with every proposal ticked.**
- **A V0 estimate is flat.** `wsh council estimate` gives 0.3M for V0 on every case; real V0 runs came to 0.54M.
- **Judging**: opus, not the council's own models. Judge smoke-tested on the newcomer key as the report (K1 to K5 matched
  at ranks 1 to 5) and then on unrelated lines (no match, five wrong). The judge's matches were checked against the
  source commit (codefix) and the key's text (newcomer) by the worker, not by the person as planned.

## Close comparisons

Every comparison but one: all four codefix variants (1/1 each); newcomer V2 vs V0, V2 vs V1, V3 vs V0, V3 vs V1 (one
key line each) and V0 vs V1 (a tie). Only newcomer V2 vs V3 (two lines) is not close, and that one is shaded by the stray message.

## Tokens Phase 0 used in total

About **18.8M** tokens, in `pkg/consult`'s count, for codefix and newcomer only (the removed case's spend is not counted here):

| part | tokens |
|---|---|
| probe (seven headless runs, two of them failed attempts) | 3,088,279 |
| V3 smoke (haiku lead) | 594,971 |
| V0, V1, V2 runs on the two cases | 6,714,730 |
| V3 runs that counted (codefix rerun, newcomer) | 6,153,258 |
| codefix's first V3 run, skipped | 2,043,267 |
| judging (eight judgements and two smoke runs) | 187,585 |
| **total** | **18,782,090** |

Newcomer's skipped V3 line in the run log repeats its done figures and is not a second spend.

## Phase 0b: the stronger pass

2026-10-23. Plan: `docs/superpowers/plans/2026-10-22-council-phase0b.md` (deleted with this section; git history
keeps it). Phase 0 ended "not decided" because one key line cannot separate four variants. 0b wrote the harness again
from Phase 0's plan, whose scripts stayed on the machine that ran it, and ran it on cases with more key lines: V0 (one
agent, group `solo-ui`), V2 (council v1, group `ui-feature`) and V3 (a prompt-only agent team). V1 is left out: in
Phase 0 it cost as much as V2 and scored the same or lower. No product code changed; the cases, keys, scripts, logs and
judged files are again in the data dir.

**Three cases ran, not four, and the code-review comparison rests on one of them.** Four were built. services-bugs V2
cost 17,502,066 tokens in 30.7 minutes, and on 2026-10-23 the person dropped agents-bugs and capped the whole benchmark
at 50M tokens (first pass, smokes, judging and second runs together). Everything below therefore rests on newcomer,
services-bugs and services-sleep: nine first-run cells and one repeat. The only code-review case that ran is
services-bugs, and all three variants scored 0 of 5 on it.

### The cases

| id | mode, cut | key lines | snapshot | files | ran |
|---|---|---|---|---|---|
| newcomer | Brainstorm, top 3 | 5 | Phase 0's case rebuilt from `0a2c46437` | 4 files, 131 KB | yes |
| services-bugs | Review, top 5 | 5 | `a7b03126d^` | 7 files, 190 KB (`agenttree.tsx` alone is about 2,840 lines) | yes |
| services-sleep | Brainstorm, top 3 | 6 | `5207af644^`, the commit before the services-sleep spec | 11 files, 87 KB | yes |
| agents-bugs | Review, top 5 | 4 | `bcbdfb81e^` | 10 files, 354 KB | no: dropped |

- **How they were built.** Each project is a `git archive` of a commit before every kept fix (before the spec, for
  services-sleep), without `.git`. A key line is one problem (a bug a later `fix(...)` commit repaired) or one decision
  (services-sleep: the spec's decisions; newcomer: the ideas reached on 2026-10-21/22). A check ran before any cell: it
  greps each project for the kept fixes' subjects, the spec's and plan's file names, and every key line verbatim, and
  fails on a key file inside a project (it printed `4 cases ok`). Only one scrub was needed: the services-bugs copy held
  a plan that names a kept bug and its fix, and the plan was deleted from the copy.
- **Fixes dropped.** `ac4c29f39` (services-bugs): its bug is an ordering race between one write's status read and the
  next click, and the source does not show when those reads land. That is a run-time-only bug, the kind Phase 0 dropped
  `28f9e73ff` for. `45d6620da` (agents-bugs): 8 of its 14 removed lines and 4 context lines are not in the snapshot
  (the code came after it), so the snapshot does not hold its bug.
- **One fix, two key lines.** `bcbdfb81e` (agents-bugs) fixes two independent defects, so it gives two lines: one line
  holding both would score a report that finds half of it the same as one that finds both.

### How the harness differs from Phase 0's

- **Kept as in Phase 0:** the token count (input + cache read + cache creation + output), the cut (5 for Review, 3 for
  Brainstorm), V3's Wild ideas kept aside in a column outside recall, and the rubric ("the same problem, not the same
  topic"). The scripts themselves are new.
- **V3** is a lead on opus with a Scout on haiku and the four `ui-feature` roles (UX, RAM, Newuser, Skeptic) on sonnet,
  5 Agent calls in every run, read-only tools plus Write, no shell. It ran with every `WAVETERM_*` variable unset (the
  count in each run's log is 0), so no stray message like Phase 0's newcomer run can reach it, and it read nothing under
  `council-bench/`, where the keys are. Its tokens are the transcript total over lead and teammates, and agreed with
  the result's own cumulative `modelUsage` in every run (within 5%).
- **V3 has no spawn gate here.** With `WAVETERM_BLOCKID` unset, `wsh agent-hook` returns before the gate, so the 10-call
  cap and the Token burn card do not apply to it (the Phase 0 probe met them because its leads inherited a tab's block
  id). The prompt tells the lead at most 5 calls and the run counts them.
- **V0 and V2 ran through the installed `wsh`, which has no `council start --mode`.** The two Brainstorm cases
  (newcomer, services-sleep) therefore ran as review councils for V0 and V2, as in Phase 0, while V3 got the Brainstorm
  prompt. A `task install` would have changed that and is the person's call, so it was not done.
- **The judge** (opus, rubric as in Phase 0) ran with no tools, so it cannot open a file: its `wrong` column is 0 in
  every run and carries no information, and cannot be set beside Phase 0's wrong-item figures.

### Results

| case | variant | run | recall | kept aside | wrong | tokens | minutes | messages | recall per M tokens |
|---|---|---|---|---|---|---|---|---|---|
| newcomer | V0 | 1 | 1/5 | - | 0 | 1,015,458 | 3.1 | 4 | 0.20 |
| newcomer | V0 | 2 | 2/5 | - | 0 | 1,183,447 | 7.4 | 5 | 0.34 |
| newcomer | V2 | 1 | 1/5 | - | 0 | 4,439,539 | 14.5 | 83 | 0.05 |
| newcomer | V3 | 1 | 1/5 | 0/5 | 0 | 3,545,600 | 22.6 | 15 | 0.06 |
| services-bugs | V0 | 1 | 0/5 | - | 0 | 4,682,970 | 10.2 | 10 | 0.00 |
| services-bugs | V2 | 1 | 0/5 | - | 0 | 17,502,066 | 30.7 | 117 | 0.00 |
| services-bugs | V3 | 1 | 0/5 | - | 0 | 6,889,305 | 7.7 | 14 | 0.00 |
| services-sleep | V0 | 1 | 1/6 | - | 0 | 2,122,944 | 6.1 | 5 | 0.08 |
| services-sleep | V2 | 1 | 2/6 | - | 0 | 4,406,454 | 16.1 | 75 | 0.08 |
| services-sleep | V3 | 1 | 2/6 | 0/6 | 0 | 3,000,674 | 4.2 | 17 | 0.11 |
| **sum, three cases** | V0 | | 2.5/16 | - | 0 | 7,905,367 | | | 0.02 |
| | V2 | | 3/16 | - | 0 | 26,348,059 | | | 0.01 |
| | V3 | | 3/16 | 0/11 | 0 | 13,435,579 | | | 0.01 |

V3's messages are its `SendMessage` calls; V2's are proposals plus replies. A cell with two runs scores their mean, and
the summed rows use a cell's mean tokens: V0's newcomer figure is the mean of its two runs (1.5/5, 1,099,453 tokens), so
V0's summed row mixes bases. On one run of each case V0 is 2/16 and 7,821,372 tokens. In key lines matched per M tokens
the summed rows read 0.32 (V0), 0.11 (V2) and 0.22 (V3), against Phase 0's 1.84, 1.04 and 0.16 on codefix and newcomer:
one agent was the best value in both passes.

newcomer: all three variants matched only K1 (open a finished council on its answer) in their first run; K3, K4 and K5
were matched by none, as in Phase 0. services-sleep: V2 matched K1 and K2 (K2 partly), V3 matched K1 and K3, V0 matched
K3; K4, K5 and K6 by none. services-bugs: no key line in any top 5.

### Judging and its noise

Every match was read against the spec text (Brainstorm cases) or the fix diff (services-bugs). That hand check only
removes a match that names the topic and not the problem; it never adds one the judge left null, in any cell (a first
attempt raised one null in one cell and was reverted, because that call had been made for one side of the V2/V3
comparison and not the other). It removed none: ten matches stand, two of them partial (services-sleep V2 K2, whose
fire-time veto watches traffic, which the key says is not watched; newcomer V0 run 2 K2, which explains the terms the
key replaces). Eleven rows of borderline nulls are listed in the hand-check file. No single flip moves V2 or V3 by more
than a line:

| reading | V0 | V2 | V3 |
|---|---|---|---|
| as scored (one run each) | 2/16 | 3/16 | 3/16 |
| both services-sleep borderlines raised (V2 K6, V3 K2) | 2/16 | 4/16 | 4/16 |
| V2's partial K2 dropped | 2/16 | 2/16 | 3/16 |

The same V0 on the same case scored 1/5 and then 2/5 (1/5 and 1/5 without the partial K2), and took 16% more tokens and
2.4 times the minutes the second time. newcomer also ran in Phase 0: V0 1/5, V2 2/5 (one borderline), V3 0/5; in 0b V2
scored 1/5 and V3 1/5. A cell moves by about a key line between runs, which is the size of every gap in the table.

### What each addition bought

Recall, with the tokens that bought it (V0's newcomer figures are its two-run mean):

| step | newcomer | services-bugs | services-sleep | summed |
|---|---|---|---|---|
| **panel** (V2 vs V0) | 1/5 vs 1.5/5 at 4.0x the tokens | 0/5 each at 3.7x | 2/6 vs 1/6 at 2.1x | 3 vs 2.5 of 16 at 3.3x (26.3M vs 7.9M) |
| **agent team vs the panel** (V3 vs V2) | 1/5 each at 0.80x | 0/5 each at 0.39x | 2/6 each at 0.68x | 3 vs 3 of 16 at 0.51x (13.4M vs 26.3M) |
| **agent team vs one agent** (V3 vs V0) | 1/5 vs 1.5/5 at 3.2x | 0/5 each at 1.5x | 2/6 vs 1/6 at 1.4x | 3 vs 2.5 of 16 at 1.7x (13.4M vs 7.9M) |

- **The panel** bought at most one key line of 16 (inside the noise) at 3.3 times one agent's tokens.
- **The agent team** tied the panel on every case at 0.4 to 0.8 of its tokens, which reverses Phase 0 (V3 cost 2.1 times
  V2 there). V0 and V3 grew about 2.2 and 2.3 times from services-sleep to services-bugs, V2 4.0 times, so the team is
  cheaper than the panel on bigger cases, not a fixed discount. It cost more than one agent on every case, here and in
  Phase 0, and scored above it only on services-sleep, by one line, which the noise covers.
- **A kept-aside list** exists only for V3 (V0 and V2 ran as review councils): its Wild ideas matched no key line, 0 of
  5 on newcomer and 0 of 6 on services-sleep, so the one kept-aside match of Phase 0 did not repeat.

### What the cases showed

- **11 of the 16 key lines were matched by no variant in any run:** newcomer K3 to K5, services-sleep K4 to K6, and all
  five of services-bugs. Of the five matched at least once, V0 matched three (newcomer K1 and K2, services-sleep K3;
  the K2 only in its second run and partly); only V2 or V3 matched the other two, both on services-sleep (the idle
  policy, K1; the in-use rule, K2, partly). That is the whole separation 0b found.
- **services-bugs scored 0 of 5 for all three, and part of that is the cut.** V2 named three key lines below the top 5
  (ranks 6, 7 and 11) and V0 one (rank 8); V3's lead kept five and has no list below. The held service shown twice in
  the Agent tree (K5, needing the inherited `WAVETERM_BLOCKID`) was named by no variant at any rank, and nobody stated
  K2 as the key does (V2 rank 10 and V0 rank 9 argue the opposite). K1, the waiting card that reads 0 s, is drawn in two
  frontend files outside the case's Files, so a reader of those files sees only the start time zeroed at start (V2 did
  name that, at rank 6). These are properties of the case, not of a variant. agents-bugs held the same kind of line
  (K4, a glyph atlas shared by every WebGL terminal, which garbles only at run time) and never ran.
- **A bigger key did not make a case separate the variants.** What is needed is a case whose lines one agent misses and
  a team or panel finds, and 0b found two such lines out of 16.

### Cost

The estimates were wrong, by case size and variant. The first pass was estimated at about 24.2M tokens for twelve cells
(about 15.1M for the nine that ran), scaled from Phase 0's measurements (V2 1.4M on newcomer). The nine cells cost
**47,605,010**, and the pass in all **49,205,931**, about twice that estimate for a pass that ran nine cells instead of
twelve.

- **V2 cost 3.2 times its estimate on newcomer, 3.7 on services-sleep and 10.5 on services-bugs** (17,502,066 against
  1.66M). There the four experts made 28 proposals and 89 replies (117 messages, 20 to 25 replies each) in 9 calls that
  cost 5,182,408 (Newuser), 2,201,328 (RAM), 7,386,127 (Skeptic), 2,674,650 (UX) and 57,553 (the coordinator).
- **`wsh council start` printed "about 9 calls, ~1M tokens" for it.** The nine calls were right and the tokens read
  about 17 times low; a V0 printed as "about 3 calls, 0.3M" cost 4.7M, about 15 times. The Token burn card shows that
  estimate, and nothing in the product limits a council's spend once it has started.
- **V0 cost 1.8 to 7.2 times its estimate and V3 1.2 to 1.9 times.** Time is not tokens: V3 took 4.2 to 22.6 minutes,
  V2 14.5 to 30.7, V0 3.1 to 10.2.

### Go / no-go

The rule is Phase 0's: go when V3's recall is higher than both V2's and V0's, or equal to the better of them at fewer
tokens; no-go when V3 costs more without scoring higher (the spec's anti-goal); a close case is "not decided: re-run".
0b's close rule (the person's call, 2026-10-22): after a second run each cell scores the mean of its two runs, and a
case whose variants are still within one key line counts as a tie, not "not decided".

**By the letter: not decided.** All nine pairs of variants (three cases, three pairs each) are within one key line, so
all nine are marked close. The close rule can call a pair a tie only once both its cells have two runs, and only
newcomer V0 got a second run: the other eight would have cost about 46.6M tokens more at their first-run prices, and
the cap left 0.8M. So the close rule decided none of the nine pairs; it was not applied. By the letter the answer is
"not decided: re-run newcomer, services-bugs and services-sleep".

**Read as the close rule means it, it is a no-go.** Every pair is within a line, so every pair is a tie and the tokens
decide. V3 ties V2 and V0 on recall (3, 3 and 2.5 of 16) and costs 1.7 times V0's tokens. With V0 and V2 tied on
recall, "the better of them" includes V0, which is cheaper than V3, so the go clause is not met; and V3 costs more than
one agent without scoring higher, which is the spec's anti-goal. The raw sums read the other way: V2 (3) is the better
of the two, and V3 equals it at half its tokens, which meets the go clause. That reading rests on a margin over V0 of
half a key line (one line on single runs), no more than the line V0 itself moved between its two runs, so it is not
taken.

**The verdict is therefore: no-go on the benchmark's terms, not settled by its letter.** What it says is "not shown to
help": three cases, one a code review that scored 0 of 5 for everyone, two Brainstorm cases that gave each variant one
or two lines, a judge that moves by a line, and 11 key lines no variant reached. It does not show that an agent team
cannot help. The agent team is cheaper than the panel on every case here, which Phase 0 did not find, and neither the
team nor the panel beat one agent by more than a key line in either pass.

What comes next: the room (Phases 1 to 3) is not planned on a benchmark win, and v1 stays as the council (the "Quick"
path). Building the room for what it is for, a team the person can watch and steer, is a product choice at about 1.7
times one agent's tokens, not a result of this benchmark, and it is the person's call. Both passes also found one agent
within a key line of the panel's recall at 30 to 40% of its tokens (0b: 7.9M against 26.3M; Phase 0: 1.09M against
2.88M), which makes the panel, not the team, the setup worth questioning; this pass does not answer that. No re-measure
date is set.

### Tokens Phase 0b used

About **49.2M** tokens, in `pkg/consult`'s count, against the 50M cap (794,069 left):

| part | tokens |
|---|---|
| first runs (nine cells; services-bugs V2 alone 17,502,066) | 47,605,010 |
| second runs (newcomer V0) | 1,183,447 |
| V3 smoke (haiku lead, a Scout and one role) | 322,842 |
| judge smoke | 12,668 |
| judging (ten judge calls) | 81,964 |
| **total** | **49,205,931** |

A probe of whether a subagent can use Bash (it cannot) cost 87,653 more and is in no log, so the true total is about
49.29M. agents-bugs ran no cell and is in no row.

### Deviations in 0b

- **agents-bugs was dropped**, so nine cells ran, not twelve; the code-review comparison has one case.
- **One second run of nine.** The plan reran every variant of every close case; under the cap only newcomer V0 fit (the
  other eight would have gone over it by 0.1M to 15.5M each). `rerun: yes` had been given under the old estimate.
- **The brainstorm cases ran as review councils for V0 and V2**, because the installed `wsh` has no `--mode`.
- **The smoke's token check** compares the team total with the result's `modelUsage`, not the lead's transcript with its
  headless `usage`: that `usage` covers only the last turn of a lead that a teammate's notification restarts.
- **The cost-scaling rule** in the estimate (0.6 + 0.4 times the size ratio) is wrong for V0 and V2.

## The benchmark since

The hand-run benchmark above is now `wsh council bench`: it reads the same cases from the data dir, runs each as V0
(`solo`) and V2 (`council`), and judges every report with the rubric above. `wsh council bench results` prints the
table per harness version, with the ratings of real councils beside it, and `--runs 2` is the setting for a first
pass or a close comparison. `HarnessVersion` (`pkg/council`) must be bumped with any prompt or role change, or the
results of the old and the new prompts read as one version's.
