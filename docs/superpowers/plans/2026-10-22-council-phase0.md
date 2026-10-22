# Council v2 Phase 0: probe agent teams and benchmark them first Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before building anything, find out whether an agent team is worth its higher cost: probe how Claude Code agent
teams can be observed, steered and put to sleep, then score a prompt-only agent-team council (V3) against a single
agent (V0), council v1 without its argue round (V1) and council v1 (V2) on three cases with answer keys.

**Architecture:** No product code. Bench cases, keys, throwaway scripts, prompts and logs all live in arcterm's data
dir, outside the repo, so every task's worktree sees the same files (a gitignored folder in a worktree is not merged).
The projects the councils read sit under a root of their own that holds no key. V0–V2 run through the installed
arcterm with `wsh council`; V3 is a lead Claude Code session given the council harness as a prompt, with agent teams
switched on in a copy of the case's project. An opus `claude -p` call judges every report against its key.

**Tech Stack:** `wsh council` (start, wait, show --json, estimate), `wsh agents` (list, send), AskUserQuestion, Claude
Code agent teams, `claude -p`, bash, jq, git archive.

**Spec:** `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` (sections "The room: architecture", "Cost
levers", "Benchmark", "Phases" item 0)

## Global Constraints

- No product code and no change under `pkg/`, `cmd/`, `frontend/`, `skills/`, `claude/`.
- Paths. `<data dir>` is `~/Library/Application Support/dev.arc.app/data` (the installed arcterm); quote it in scripts,
  it holds a space. `<bench>` is `<data dir>/council-bench/`: `cases.json`, the keys in `keys/<case>.md`, and `work/`
  (scripts, prompts, the probe, logs, `runs.jsonl`). `<projects>` is `<data dir>/council-bench-projects/`: each case's
  project copy in `<projects>/<case>/` and V3's run copies in `<projects>/v3runs/<case>/`. No key, `cases.json` or
  `work/` file is ever under `<projects>` (Task 2's `check-cases.sh` checks it). Nothing of the benchmark goes in the
  repo except Task 8's note.
- The pass is the cheap one: cases 1–3 × V0, V1, V2, V3 × 1 run, with one code case (the person's call, 2026-10-22).
  No council starts before the person has the total (Task 5) and says go, per AGENTS.md.
- One council or one V3 team at a time: start the next only when the previous one has ended.
- Tokens are counted the way `pkg/consult` counts them: input + cache read + cache creation + output
  (`pkg/consult/consult.go:135`), so V3's sum is comparable with v1's `tokens`. In a Claude Code transcript each
  assistant message id is counted once: its usage repeats on every line of that message.
- Token burn cards: each v1 start may wait on one, and a V3 lead's teammate spawns wait on one when it starts 3 or more
  agents (`pkg/tokengate`, `DefaultRules.Agents`); the person allows them there. A start or spawn that comes back
  `Not run: …` (refused) is recorded as `skipped` and never retried.
- Questions for the person go through AskUserQuestion, and the worker waits for the answer. They are the person's
  alone (open an agent, correct the keys, the token go, press Summarize, check the judge): **the lead forwards them
  with `wsh jarvis dag forward`, never answers them.**
- **For the lead:** Tasks 1–7 change nothing in the repo; they finish without a commit (the engine marks them done
  unreviewed). While one waits on the person or a council, the engine may flag it "may be stuck" after 20 minutes:
  expected; read the worker's last lines before acting. Never retry Task 6 or Task 7 without reading `runs.jsonl` and
  the judged files: their scripts skip what is already recorded, and a fresh run pays for councils again.
- Commits carry no co-author trailer; nothing is pushed.

## Review Focus

- **Answer leakage:** an expert or teammate finding the key inside what it reads (the real reviews sit in
  [removed] arcterm's docs at `0a2c46437` name the paper's reviews; a fix's parent may list its bug in
  `docs/open-issues.md`). Projects live under `<projects>`, which holds no key; each copy is scrubbed and checked by
  grep (Task 2).
- **Wrong paper version:** a `main.tex` revised after the reviews would hide the issues they raised; check the source
  file (not the copy) is not newer than the submitted PDF [removed] 2026-08-22).
- **Unequal comparison:** V3 given more files, a better question, other agents, more tools or a longer report than
  V0–V2. All four variants of a case get the same feature, question and files; V3's teammates are the roles of the
  same v1 group V1 and V2 use (for the newcomer case that is `ui-feature`, deliberately not the spec's Product ideas
  default, so the variants differ only in setup; Product ideas is benchmarked in Phase 3); V3's agents get v1's read
  tools (Read, Grep, Glob, `pkg/council/caller.go:45`) plus Write for their notes and report, no Bash unless Task 1
  shows a team cannot run without it. Every report is cut to the same top items before judging: top 5 (Review) or
  top 3 (Brainstorm); V3's Brainstorm Wild ideas kept aside are judged in a column of their own, outside recall (the
  person's call, 2026-10-22).
- **A loose judge:** matching on topic ("prose") rather than the same problem. The rubric demands the same problem;
  judge.sh is smoke-tested on known reports first, and the person checks papercase's matches (Task 7).
- **"Resume" that is a fresh agent with the same name, steering that only looks like it worked:** count them only when
  the teammate quotes its earlier message, or its next message shows the change (Task 1).

---

### Task 1: Probe agent teams

**Depends on:** none
**Files:** `<bench>/work/teamprobe/`, `<bench>/work/teamprobe.md`

**Interfaces:**
- Produces: `teamprobe.md`, opening with these lines, which Tasks 4 and 5 read: `headless: yes|no` (whether a team
  runs under `claude -p`), `flags: <the claude flags that let the team spawn and write>`, `lead_session: <id>`,
  `lead_usage: <n>` (the headless lead's own tokens, from Claude Code's JSON result), `probe_tokens: <n>` (the headless
  run's lead and teammates together), `transcripts: <where the lead's and the teammates' transcripts live>`; then the
  answers below, each with its evidence.

The playbook both runs use, `<playbook>`: `Create an agent team with two haiku teammates, Alice and Bob. Phase 1: each
proposes one change to README.md, and no one criticizes yet. Phase 2: each names one doubt about the other's change,
and each replies once. Move to your summary early if a turn brings nothing new. Then summarize and end the team.`

- [ ] **Step 1:** Confirm how agent teams are switched on in the installed Claude Code (docs, `claude --help`);
  expected: env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Create `teamprobe/` with `.claude/settings.json` setting it
  and a three-paragraph `README.md` to discuss.
- [ ] **Step 2: Headless.** Start a sampler, `while :; do date +%s; ps -axo pid,ppid,rss,command | grep -i '[c]laude'; sleep 2; done > teamprobe/ps-headless.log &`.
  From `teamprobe/`, run `claude -p --model haiku --output-format json --permission-mode acceptEdits --disallowedTools Bash "<playbook>" > teamprobe/headless.json`.
  If a teammate cannot spawn or blocks on a permission, adjust the flags once (allowed tools, or Bash back) and rerun;
  the flags that worked are the `flags:` line. Stop the sampler. Record `headless: yes` when the teammates' messages
  appear (Step 4's files), else `headless: no`; `lead_session` and `lead_usage` (input + cache read + cache creation +
  output from `headless.json`'s usage) either way.
- [ ] **Step 3: Live.** Ask the person (AskUserQuestion) to open a claude agent on opus in `teamprobe/` from arcterm
  and answer when it shows; find its tab with `wsh agents list`; start the sampler again into `ps-live.log`; send it
  the playbook with `wsh agents send <tab> "<playbook>"`. The spawn may show a Token burn card; the person allows it.
- [ ] **Step 4:** While it runs, record `ls -R ~/.claude/teams ~/.claude/tasks`, which file holds teammate-to-teammate
  messages (one message verbatim), the teammates' transcripts under `~/.claude/projects/`, and from the ps logs whether
  teammates are separate processes or in-process. After it ends, stop the sampler: each teammate's peak RSS is the
  largest of its samples (in-process: the lead's peak with the team against its peak before the spawn); compare it
  with the 512 MiB v1 claims per call (`toolSlotBytes`, `pkg/council/caller.go:40`).
- [ ] **Step 5: Phases.** From both runs' messages, record `phases: yes|no`: yes only when every Phase 1 message
  comes before any Phase 2 doubt and the lead moved on by the rule; quote the messages that show it.
- [ ] **Step 6: Steering.** `wsh agents send <tab> "Tell Bob to argue the opposite of Alice."` Done when
  `teamprobe.md` says whether the message reached the lead (it is in the lead's transcript) and whether Bob's next
  message argues the opposite, each quoted.
- [ ] **Step 7: Sleep and resume.** Ask the lead to shut Bob down, then bring him back and have him quote what he said
  before. Done when `teamprobe.md` says whether his process ended (the ps lines) and whether he resumed with his
  context (yes only when he quotes his earlier message as written).
- [ ] **Step 8: Tokens.** `probe_tokens` is the sum over the headless run's lead and teammate transcripts, each
  assistant message id once; also sum the lead's transcript alone the same way and write it beside `lead_usage`.
- [ ] **Step 9:** Write `teamprobe.md`: the lines above; then where teammate messages live and whether arcterm can tail
  them; processes; peak RSS per teammate against 512 MiB; phases; whether a message reaches the lead from outside;
  whether steering reaches a teammate; whether a teammate sleeps and resumes with its context. Done when each answer is
  a yes, a no or a number, with its evidence.

### Task 2: Bench cases and answer keys

**Depends on:** none
**Files:** `<bench>/cases.json`, `<bench>/keys/`, `<projects>/{papercase,codefix,newcomer}/`, `<bench>/work/check-cases.sh`

**Interfaces:**
- Produces: `cases.json`, an array of `{"id","mode","project","group","solo_group","feature","question","files","key"}`
  with `id` in `papercase | codefix | newcomer`, `mode` in `review | brainstorm`, `project` the absolute folder
  `<projects>/<id>`, `files` comma-separated and relative to `project`, `key` the path of `<bench>/keys/<id>.md` with
  one item per line (`K1: …`).

- [ ] **Step 1: papercase.** Check `stat -f %m [removed] (the source, not
  a copy) ≤ the PDF's; if not, ask the person (AskUserQuestion) which version was submitted. Copy with `cp -p`
  `main.tex`, `numbers.tex`, `numbers/`, `base.bib`, `images/` into `<projects>/papercase/`. Write `keys/papercase.md`
  from [removed] one line per distinct problem the two reviews raise (the undefined terms, the
  "not X but Y" sentences, the density, novelty and generality, the missing [removed] baseline, the rest of [removed]). Mode
  `review`, group `paper`, solo group `solo-paper`, feature [removed] 2027 submission [removed] (main.tex)`, question
  `What would the reviewers criticize, most serious first?`, files `main.tex`.
- [ ] **Step 2: codefix.** Pick one of `c34d80918` (a starting app's waiting card reads 0 s) and `5ab29f56f` (the
  Services chip reads a bare 0): the one whose bug shows from reading its source files. `28f9e73ff` is out: its bug is
  WebView2 behaviour the code does not show, and its parent's `docs/open-issues.md` describes it.
  `git archive <sha>^ | tar -x -C <projects>/codefix`, then delete from the copy any line that describes the bug
  (`docs/open-issues.md`, `CHANGELOG.md`). Key: one line naming the bug. Mode `review`, group `ui-feature`, solo group
  `solo-ui`, feature named for the fixed area, question `What is broken or wrong here?`, files: the source files the
  fix touched, no CHANGELOG, docs or tests. Note the fix's own words (its subject, the CHANGELOG line it added) for
  Step 4.
- [ ] **Step 3: newcomer.** `git archive 0a2c46437 | tar -x -C <projects>/newcomer`, then delete from the copy the
  sentence naming the paper's reviews [removed] in `docs/open-issues.md` (line 63) and
  `docs/superpowers/specs/2026-10-21-council-design.md` (line 194). Key, five lines: open the report first and move the
  debate behind it; plain words instead of code words (Accept/Challenge/Oppose, Split, P-ids); the vote as top-3 picks
  with agreement as a reaction; an answer-first report; done and waiting notifications. Mode `brainstorm`, group
  `ui-feature`, solo group `solo-ui`, feature `Council, for a first-time user`, question
  `A newcomer opens a council and cannot tell what to do; it shows many threads. How should it change?`, files
  `frontend/app/view/agents/councilsetup.tsx,frontend/app/view/agents/councildiscussion.tsx,frontend/app/view/agents/councilsummary.tsx,docs/superpowers/specs/2026-10-21-council-design.md`.
- [ ] **Step 4:** `check-cases.sh` fails when `<projects>` holds a `key*.md`, a `cases.json` or a `work/` file; when a
  grep of `<projects>` finds [removed] `Review [removed]`, `council-agent-team`, `How they got here`, `has doubts` or
  the codefix fix's words; or when a case's listed file is missing from its project. Run:
  `bash "<bench>/work/check-cases.sh"` — Expected: `3 cases ok`.
- [ ] **Step 5:** Ask the person (AskUserQuestion) to read the three key files and correct them; apply the corrections
  and run `check-cases.sh` again — Expected: `3 cases ok`.

### Task 3: Solo groups for V0

**Depends on:** none
**Files:** `~/Library/Application Support/dev.arc.app/config/councilroles.json`

- [ ] **Step 1:** Keep any existing content. Add roles `solo-paper` (name "Reviewer", model sonnet, brief: the briefs
  of `reviewer-a`, `reviewer-b`, `reader` in `pkg/council/roles.go`, joined) and `solo-ui` (the briefs of `ux`, `ram`,
  `newuser`, `skeptic`, joined); groups `solo-paper` (roles `[solo-paper]`, coordinator `areachair`) and `solo-ui`
  (roles `[solo-ui]`, coordinator `coordinator`). Schema:
  `{"roles":[{"id","name","brief","model"}],"groups":[{"id","name","roles","coordinator"}]}`.
- [ ] **Step 2:** From the task's worktree, run
  `wsh council estimate --project "$PWD" --group solo-paper --feature x --files README.md`, then the same with
  `--group solo-ui` — Expected: an estimate line each, not `no group`.

### Task 4: The V3 harness (prompt-only agent-team council)

**Depends on:** Task 1 (run.sh and tokens.sh read teamprobe.md's flags, headless line, transcripts and token figures)
**Files:** `<bench>/work/v3/{review.md,brainstorm.md,run.sh,tokens.sh}`, `<bench>/work/smoke.jsonl`

**Interfaces:**
- Consumes: `teamprobe.md`'s opening lines; `cases.json` at run time.
- Produces: `v3/run.sh [--dry-run] <case>` → copies `<projects>/<case>` to `<projects>/v3runs/<case>/`, which ends with
  `council-report.md`, and appends `{"case","variant":"V3","tokens","minutes","messages","state"}` to
  `<bench>/work/runs.jsonl`. It skips a case already recorded there unless its state is `failed` and `--rerun` is
  given. With `headless: no`, `run.sh --prepare <case>` makes the copy and the prompt file and `run.sh --collect <case>`
  waits and records, while the person opens the lead in between (Task 6).

- [ ] **Step 1:** Write `review.md` and `brainstorm.md`, the lead's prompt, carrying the spec's harness and all five
  cost levers (this step needs nothing from Task 1): one shared block that opens every teammate's spawn prompt word for
  word (mode rules, room protocol, the message cap, the notes, the goal), so it is cached (lever 5); a Scout teammate
  (haiku) reads the files once and writes `notes.md` (facts with `path:line`), then exits (lever 1); one sonnet
  teammate per role of the case's group, given that role's brief from `pkg/council/roles.go`, the lead on opus
  (lever 2); a teammate idles until the lead calls it or names it (lever 3); the mode's phases and judging rule
  ("The two modes" table); messages ≤120 words, agreement as a one-word reaction; each teammate names its top 3 of the
  others' ideas; move to the last phase after two turns with nothing new, stop at 40 turns (lever 4); the lead writes
  `council-report.md`: the answer in one sentence, then ≤5 ranked items (review) or ≤3 ideas plus Wild ideas kept aside
  (brainstorm), each with why and who disagrees.
- [ ] **Step 2:** `run.sh <case>` copies the case's project fresh to `v3runs/<case>/`, adds `.claude/settings.json`
  with the agent-teams env, and starts the lead with the mode's prompt plus the case's feature, question and files:
  headless (`claude -p --model opus --output-format json <flags>`) when `headless: yes`, else through `--prepare` and
  `--collect` (the person opens a claude agent on opus in the copy and the worker `wsh agents send`s the prompt file).
  It waits for `council-report.md` and the team's end, then records: `tokens` from `tokens.sh` over that run's lead and
  teammate transcripts, `minutes` of wall time, `messages` as teammate-to-teammate messages, `state` `done`, `failed`,
  or `skipped` when a teammate spawn came back `Not run:`. `--dry-run <case>` prints the copy, the command and the
  prompt and runs nothing.
- [ ] **Step 3:** `tokens.sh <transcripts>` sums input + cache read + cache creation + output over the given
  transcripts, each assistant message id once. Check it on the probe: the lead's transcript (`lead_session`) within 5%
  of `lead_usage`, and the headless run's lead and teammates equal to `probe_tokens`.
- [ ] **Step 4: Smoke.** `run.sh --smoke` runs the review prompt on a copy of `teamprobe/` with haiku everywhere, a
  Scout and one role, question `What is unclear in README.md?`, and records to `smoke.jsonl` instead of `runs.jsonl`.
  Expected: a `council-report.md` with the one-sentence answer and ranked items, and a `smoke.jsonl` line with state
  `done` and tokens > 0. Then `run.sh --dry-run` on a case object made by hand in the shape of `cases.json`. Expected:
  the copy, the command and a prompt holding that case's feature, question and files.

### Task 5: Estimate and the person's go

**Depends on:** Task 1 (prices V3 from probe_tokens), Task 2 (estimates each case in cases.json), Task 3 (estimates V0 on the solo groups)
**Files:** `<bench>/work/estimate.md`

- [ ] **Step 1:** For each case, `wsh council estimate` for V2 (group) and V0 (solo group); V1 is V2's round 1 plus one
  synthesis (half of V2 if the estimate cannot split it); V3 is `probe_tokens` scaled by team size (the group's roles
  plus a Scout, against the probe's two) and the case's file sizes (against the probe's README.md), stated as a range.
  Write the per-run figures and the total to `estimate.md`.
- [ ] **Step 2:** Ask the person (AskUserQuestion) with the total and the per-variant figures, saying each v1 start may
  show a Token burn card and each V3 run shows one when its lead spawns its teammates, to allow there. Wait for the
  answer; end `estimate.md` with `go: <what the person allowed>` (all, a part, or no). Done when that line is there.

### Task 6: Run the twelve

**Depends on:** Task 4 (runs v3/run.sh), Task 5 (runs only what estimate.md's go line allows)
**Files:** `<bench>/work/run.sh`, `<bench>/work/runs.jsonl`

- [ ] **Step 1:** `run.sh [--dry-run] <case> <V0|V1|V2>` reads the case from `cases.json` and runs from its project: V2
  `wsh council start --project P --group G --feature F --question Q --files L`; V1 the same plus `--pause`; V0 with
  `--group <solo group>`. It takes the id from the line `council <id> started: …` (`councilStartedLine`,
  `cmd/wsh/cmd/wshcmd-council.go:211`) and records `skipped` on a `Not run:` line. V0 and V2 then
  `wsh council wait <id>`. V1 stops at `awaiting-you` and prints its id; `run.sh --collect <case> V1` then polls
  `wsh council show <id> --json` until `.summary` is set and `.state` is not `running` (Summarize puts a paused council
  back to `awaiting-you` with its summary, `pkg/council/runner.go:1195`). It appends
  `{"case","variant","id","state","tokens","minutes","messages"}` to `runs.jsonl` (`messages` = proposals + replies;
  `state` `done` for a V1 with a summary), and skips a pair already recorded unless its state is `failed` and `--rerun`
  is given.
- [ ] **Step 2: Dry run.** `run.sh --dry-run` for each case and V0, V1, V2, and `v3/run.sh --dry-run <case>` for each
  case — Expected: twelve commands, each naming its case's project, group, feature, question and files, every project
  and file present. Read `estimate.md`'s `go:` line; run only the pairs it allows.
- [ ] **Step 3:** Run in this order, one at a time: for each of papercase, codefix, newcomer: V2, V1, V0, then
  `v3/run.sh <case>`. When a V1 stops at `awaiting-you`, ask the person (AskUserQuestion) to open it in the app and
  press **Summarize** without unticking any proposal (the CLI has none), then `run.sh --collect <case> V1`. With
  `headless: no`, ask the person to open a claude agent on opus in `<projects>/v3runs/<case>/` for each V3 run.
- [ ] **Step 4:** Run `jq -s 'group_by(.case + "/" + .variant) | map(last) | map(.state) ' "<bench>/work/runs.jsonl"`
  — Expected: 12 entries (fewer only where the go line left pairs out), each `done`, `skipped` or `failed`.

### Task 7: Judge and score

**Depends on:** Task 6 (judges the runs listed in runs.jsonl)
**Files:** `<bench>/work/judge.sh`, `<bench>/work/judged/`, `<bench>/work/results.md`

- [ ] **Step 1:** `judge.sh <case> <variant>` builds the report (v1: `wsh council show <id> --json` summary text plus
  each direction's rank, title, reasoning; V3: `council-report.md`), cuts it to the top 5 (review) or top 3
  (brainstorm) items, and asks `claude -p --model opus --output-format json` with the key and this rubric: an item
  matches a key line only when it names the same problem (same terms, same sentence pattern, same missing baseline, same
  bug), not the same topic; each item is `key:<Kn>`, `valid` or `wrong`. For a V3 brainstorm report it judges the Wild
  ideas kept aside the same way, apart. Output to `judged/<case>-<variant>.json`:
  `{"matches":{"K1":rank|null,…},"items":[{"rank","verdict"}],"keptaside":{"K1":true|false,…}}`; a pair already
  judged is skipped.
- [ ] **Step 2: Smoke** before the real reports: judge, for papercase, a fake report made of its key's own lines and
  one made of unrelated lines. Expected: every key line matched, then none.
- [ ] **Step 3:** `results.md`: a row per run: recall (key lines matched in the top items ÷ key lines), V3 brainstorm's
  kept-aside matches in a column of their own (not in recall), wrong items, tokens, minutes, messages, and recall per
  million tokens; `partial` when a v1 council has failed experts.
- [ ] **Step 4:** Ask the person (AskUserQuestion) to check papercase's four judged reports against its key; correct the
  table.
- [ ] **Step 5:** Mark "close: re-run before deciding" where two variants of a case differ by one key line or less.

### Task 8: Findings note

**Depends on:** Task 1 (quotes teamprobe.md), Task 7 (quotes results.md)
**Files:** `docs/council-phase0.md`

- [ ] **Step 1:** Write the note: the results table; what the argue round bought (V2 vs V1), what the panel bought (V1
  vs V0), what the agent team bought (V3 vs V2) per case, in recall and in recall per million tokens; the probe's
  answers, including whether the lead ran the phases, and peak RSS per teammate against 512 MiB with the awake limit it
  implies on this Mac; the go/no-go for building the room on agent teams by this rule: go when, summed over the three
  cases, V3's recall is higher than both V2's and V0's, or equal to the better of them at fewer tokens; no-go when V3
  costs more without scoring higher (the spec's anti-goal); a case marked close makes it "not decided: re-run <case>";
  the plumbing it implies (tail the team's files when the probe found messages in files arcterm can read and steering
  reaching teammates, otherwise the `wsh council say` path); the deviations (the newcomer case's team, Brainstorm
  scored on the top 3); which comparisons are close; the tokens Phase 0 used in total (probe, smoke, runs, judging).
  Done when every part above has its figure or answer.
- [ ] **Step 2: Commit** `docs/council-phase0.md` with the message
  `docs(council): phase 0, agent teams probed and benchmarked against council v1`. Do not push.
