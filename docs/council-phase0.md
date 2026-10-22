# Council v2, Phase 0: agent teams probed and benchmarked against council v1

2026-10-22. Spec: `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` (Benchmark, Phases item 0). No
product code changed. The cases, keys, scripts, logs and judged files live in arcterm's data dir under
`council-bench/`, outside the repo, so none of them is reproduced here beyond the figures below.

**Verdict: not decided: re-run codefix and re-run newcomer.** Every comparison but newcomer V2 against V3 is close (one
key line separates them at most), and the rule says a close case is not decided. The numbers lean no-go: V3 scored lowest and cost 2 to 6 times
the others. Nothing here justifies building the room on agent teams yet, and nothing rules it out either.

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

The summed rows' last column is recall (key lines matched ÷ 6) per M tokens. Counted in key lines matched per M tokens
instead (2 ÷ 1.086M for V0), the same rows read 1.84, 0.73, 1.04 and 0.16.

Every cell is "close" in the judge's sense: the whole codefix case (all four found the one bug at rank 1, so recall
cannot tell them apart; only cost differs), and in newcomer each pair but V2 against V3 differs by one key line. V3's
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
- **Two cases, not three**: the go/no-go is applied over codefix and newcomer.
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
key line each). Only newcomer V2 vs V3 (two lines) is not close, and that one is shaded by the stray message.

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
