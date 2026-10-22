# Council v2 Phase 0: probe agent teams and benchmark them first Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before building anything, find out whether an agent team is worth its higher cost: probe how Claude Code agent
teams can be observed, steered and put to sleep, then score a prompt-only agent-team council (V3) against a single
agent (V0), council v1 without its argue round (V1) and council v1 (V2) on three cases with answer keys.

**Architecture:** No product code. Bench cases, keys, throwaway scripts, prompts and logs all live in arcterm's data
dir, outside the repo, so every task's worktree sees the same files (a gitignored folder in a worktree is not merged). V0–V2 run through the installed arcterm with `wsh council`; V3 is a lead
Claude Code session given the council harness as a prompt, with agent teams switched on in a copy of the case's
project. An opus `claude -p` call judges every report against its key.

**Tech Stack:** `wsh council` (start, wait, show --json, estimate), `wsh agents` (list, send, read), `wsh ask`, Claude
Code agent teams, `claude -p`, bash, jq, git archive.

**Spec:** `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` (sections "The room: architecture", "Cost
levers", "Benchmark", "Phases" item 0)

## Global Constraints

- No product code and no change under `pkg/`, `cmd/`, `frontend/`, `skills/`, `claude/`.
- `<data dir>` is `~/Library/Application Support/dev.arc.app/data` (the installed arcterm); quote it in scripts, it
  holds a space. Cases go in `<data dir>/council-bench/`; scripts, prompts, run copies and logs in
  `<data dir>/council-bench/work/`. Nothing of the benchmark goes in the repo except Task 8's note.
- The pass is the cheap one: cases 1–3 × V0, V1, V2, V3 × 1 run. No council starts before the person has the total
  (Task 5) and says go, per AGENTS.md.
- One council or one V3 team at a time: start the next only when the previous one has ended.
- Tokens are counted the way `pkg/consult` counts them: input + cache read + cache creation + output
  (`pkg/consult/consult.go:135`), so V3's sum is comparable with v1's `tokens`.
- A start that prints `Not run: …` (Token burn gate refused) is recorded as skipped and never retried.
- Questions for the person go through `wsh ask`; wait for the answer.
- Commits carry no co-author trailer; nothing is pushed.

## Review Focus

- **Answer leakage:** an expert or teammate finding the key inside the project it reads (the real reviews sit in
  [removed] the v2 spec and canvas hold the newcomer ideas). Each case's project is a copy without
  them, checked by grep (Task 2).
- **Wrong paper version:** a `main.tex` revised after the reviews would hide the issues they raised; check it is not
  newer than the submitted PDF [removed] 2026-08-22).
- **Unequal comparison:** V3 given more files, a better question or a longer report than V0–V2. All four variants of a
  case get the same feature, question and files, and every report is cut to the same top items before judging.
- **A loose judge:** matching on topic ("prose") rather than the same problem. The rubric demands the same problem; the
  person checks papercase's matches (Task 7).
- **"Resume" that is a fresh agent with the same name, steering that only looks like it worked:** count them only when
  the teammate quotes its earlier message, or its next message shows the change (Task 1).

---

### Task 1: Probe agent teams

**Depends on:** none
**Files:** `<data dir>/council-bench/work/teamprobe/`, `<data dir>/council-bench/work/teamprobe.md`

**Interfaces:**
- Produces: `teamprobe.md` with the line `headless: yes|no` (whether a team runs under `claude -p`), which Task 4
  reads, plus the six answers below.

- [ ] **Step 1:** Confirm how agent teams are switched on in Claude Code 2.1.306 (docs, `claude --help`); expected:
  env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Create `teamprobe/` with `.claude/settings.json` setting it and a
  three-paragraph `README.md` to discuss.
- [ ] **Step 2: Headless.** From `teamprobe/`, `claude -p --model haiku "Create an agent team with two haiku teammates, Alice and Bob. Each proposes one change to README.md; they reply to each other once; you summarize; end the team."`
  Record `headless: yes` when teammates' messages appear (Step 4's files), else `headless: no`.
- [ ] **Step 3: Live.** `wsh ask` the person to open a claude agent in `teamprobe/` from arcterm; find its tab with
  `wsh agents list`; send it the same prompt with `wsh agents send <tab> "…"`.
- [ ] **Step 4:** While it runs, record `ls -R ~/.claude/teams ~/.claude/tasks`, which file holds teammate-to-teammate
  messages (one message verbatim), the teammates' transcripts under `~/.claude/projects/`, and
  `ps -axo pid,rss,command | grep -i claude` (RSS per process; separate processes or in-process).
- [ ] **Step 5: Steering.** `wsh agents send <tab> "Tell Bob to argue the opposite of Alice."`; record whether Bob's
  next message changes.
- [ ] **Step 6: Sleep and resume.** Ask the lead to shut Bob down, then bring him back and have him quote what he said
  before; record whether his process ended and whether he quotes it.
- [ ] **Step 7:** Write `teamprobe.md`: the `headless:` line; where teammate messages live and whether arcterm can tail
  them; processes; RSS per teammate; whether a message reaches the lead from outside; whether steering reaches a
  teammate; whether a teammate sleeps and resumes with its context; each with its evidence; the probe's tokens.

### Task 2: Bench cases and answer keys

**Depends on:** none
**Files:** `<data dir>/council-bench/{cases.json,papercase/,codefix/,newcomer/}`, `<data dir>/council-bench/work/check-cases.sh`

**Interfaces:**
- Produces: `cases.json`, an array of `{"id","mode","project","group","solo_group","feature","question","files","key"}`
  with `id` in `papercase | codefix | newcomer`, `mode` in `review | brainstorm`, `project` an absolute folder, `files`
  comma-separated and relative to `project`, `key` the path of a `key.md` with one item per line (`K1: …`).

- [ ] **Step 1: papercase.** Copy `main.tex`, `numbers.tex`, `numbers/`, `base.bib`, `images/` from
  [removed] into `papercase/project/`. Check `stat -f %m main.tex` ≤ the PDF's;
  if not, `wsh ask` which version was submitted. Write `key.md` from [removed] one line per
  distinct problem the two reviews raise (the undefined terms, the "not X but Y" sentences, the density, novelty and
  generality, the missing [removed] baseline, the rest of [removed]). Mode `review`, group `paper`, solo group `solo-paper`,
  feature [removed] 2027 submission [removed] (main.tex)`, question `What would the reviewers criticize, most serious first?`,
  files `main.tex`.
- [ ] **Step 2: codefix.** Pick one of `c34d80918`, `5ab29f56f`, `28f9e73ff`: the smallest diff whose bug shows from
  reading the code before it. `git archive <sha>^ | tar -x -C codefix/project`. Key: one line naming the bug. Mode
  `review`, group `ui-feature`, solo group `solo-ui`, feature named for the fixed area, question
  `What is broken or wrong here?`, files: the files the fix touched.
- [ ] **Step 3: newcomer.** `git archive 0a2c46437 | tar -x -C newcomer/project`. Key, five lines: open the report
  first and move the debate behind it; plain words instead of code words (Accept/Challenge/Oppose, Split, P-ids); the
  vote as top-3 picks with agreement as a reaction; an answer-first report; done and waiting notifications. Mode
  `brainstorm`, group `ui-feature`, solo group `solo-ui`, feature `Council, for a first-time user`, question
  `A newcomer opens a council and cannot tell what to do; it shows many threads. How should it change?`, files
  `frontend/app/view/agents/councilsetup.tsx,frontend/app/view/agents/councildiscussion.tsx,frontend/app/view/agents/councilsummary.tsx,docs/superpowers/specs/2026-10-21-council-design.md`.
- [ ] **Step 4:** `check-cases.sh` greps each project for [removed] `Review [removed]`, `council-agent-team`,
  `How they got here`, `has doubts`, fails on any hit, and checks each listed file exists. Run:
  `bash <data dir>/council-bench/work/check-cases.sh` — Expected: `3 cases ok`.
- [ ] **Step 5:** `wsh ask` the person to read the three `key.md` files and correct them.

### Task 3: Solo groups for V0

**Depends on:** none
**Files:** `~/Library/Application Support/dev.arc.app/config/councilroles.json`

- [ ] **Step 1:** Keep any existing content. Add roles `solo-paper` (name "Reviewer", model sonnet, brief: the briefs
  of `reviewer-a`, `reviewer-b`, `reader` in `pkg/council/roles.go`, joined) and `solo-ui` (the briefs of `ux`, `ram`,
  `newuser`, `skeptic`, joined); groups `solo-paper` (roles `[solo-paper]`, coordinator `areachair`) and `solo-ui`
  (roles `[solo-ui]`, coordinator `coordinator`). Schema:
  `{"roles":[{"id","name","brief","model"}],"groups":[{"id","name","roles","coordinator"}]}`.
- [ ] **Step 2:** Run `wsh council estimate --project <papercase project> --group solo-paper --feature x --files main.tex`
  — Expected: an estimate line, not `no group`.

### Task 4: The V3 harness (prompt-only agent-team council)

**Depends on:** Task 1 (reads teamprobe.md: the headless line and where the transcripts live)
**Files:** `<data dir>/council-bench/work/v3/{review.md,brainstorm.md,run.sh,tokens.sh}`

**Interfaces:**
- Consumes: `teamprobe.md`'s `headless:` line and message location; `cases.json`.
- Produces: `v3/run.sh <case>` → writes `<data dir>/council-bench/work/v3runs/<case>/council-report.md` and appends
  `{"case","variant":"V3","tokens","minutes","messages","state"}` to `<data dir>/council-bench/work/runs.jsonl`.

- [ ] **Step 1:** Write `review.md` and `brainstorm.md`, the lead's prompt, carrying the spec's harness: a Scout
  teammate (haiku) reads the files once and writes `notes.md` (facts with `path:line`), then exits; one sonnet teammate
  per role of the case's group, given that role's brief from `pkg/council/roles.go`; the mode's phases and judging rule
  ("The two modes" table); messages ≤120 words, agreement as a one-word reaction; each teammate names its top 3 of the
  others' ideas; stop after two turns with nothing new or 40 turns; the lead writes `council-report.md`: the answer in
  one sentence, then ≤5 ranked items (review) or ≤3 ideas plus wild ideas kept aside (brainstorm), each with why and who
  disagrees.
- [ ] **Step 2:** `run.sh <case>` copies the case's project to `v3runs/<case>/`, adds `.claude/settings.json` with the
  agent-teams env, and starts the lead with the mode's prompt plus the case's feature, question and files: headless
  (`claude -p --model opus`) when `headless: yes`, otherwise by `wsh ask`ing the person to open a claude agent there and
  `wsh agents send`ing the prompt. It waits for `council-report.md` and the team's end.
- [ ] **Step 3:** `tokens.sh <dir>` sums input + cache read + cache creation + output over every transcript of the
  lead and its teammates for that run (the transcripts Task 1 located). Check it on `teamprobe/`: its total matches the
  probe's tokens in `teamprobe.md` within 5%.

### Task 5: Estimate and the person's go

**Depends on:** Task 2 (estimates each case in cases.json), Task 3 (estimates V0 on the solo groups), Task 4 (estimates V3 from its harness)
**Files:** `<data dir>/council-bench/work/estimate.md`

- [ ] **Step 1:** For each case, `wsh council estimate` for V2 (group) and V0 (solo group); V1 is V2's round 1 plus one
  synthesis (half of V2 if the estimate cannot split it); V3 is the probe's tokens scaled by team size and the case's
  file sizes, stated as a range. Write the per-run figures and the total to `estimate.md`.
- [ ] **Step 2:** `wsh ask` the person with the total, saying each v1 start may show a Token burn card to allow. Wait
  for go.

### Task 6: Run the twelve

**Depends on:** Task 5 (runs only after the person's go on estimate.md)
**Files:** `<data dir>/council-bench/work/run.sh`, `<data dir>/council-bench/work/runs.jsonl`

- [ ] **Step 1:** `run.sh <case> <V0|V1|V2>` runs from the case's project: V2
  `wsh council start --project P --group G --feature F --question Q --files L`; V1 the same plus `--pause`; V0 with
  `--group <solo group>`. It parses the id, runs `wsh council wait <id>`, and appends
  `{"case","variant","id","state","tokens","minutes","messages"}` to `runs.jsonl` (`messages` = proposals + replies;
  `skipped` on `Not run:`).
- [ ] **Step 2:** Run in this order, one at a time: for each of papercase, codefix, newcomer: V2, V1, V0, then
  `v3/run.sh <case>`.
- [ ] **Step 3:** When a V1 returns `awaiting-you`, `wsh ask` the person to press **Summarize** on it in the app (the
  CLI has none), then wait on it again.
- [ ] **Step 4:** Run `jq -s 'length' <data dir>/council-bench/work/runs.jsonl` — Expected: `12`, every state `done`,
  `skipped` or `failed`.

### Task 7: Judge and score

**Depends on:** Task 6 (judges the runs listed in runs.jsonl)
**Files:** `<data dir>/council-bench/work/judge.sh`, `<data dir>/council-bench/work/results.md`

- [ ] **Step 1:** `judge.sh <case> <variant>` builds the report (v1: `wsh council show <id> --json` summary text plus
  each direction's rank, title, reasoning; V3: `council-report.md`), cuts it to the top 5 (review) or top 3 (brainstorm)
  items, and asks `claude -p --model opus --output-format json` with the key and this rubric: an item matches a key line
  only when it names the same problem (same terms, same sentence pattern, same missing baseline, same bug), not the same
  topic; each item is `key:<Kn>`, `valid` or `wrong`. Output `{"matches":{"K1":rank|null,…},"items":[{"rank","verdict"}]}`.
- [ ] **Step 2:** `results.md`: a row per run: recall (matched key lines ÷ key lines), wrong items, tokens, minutes,
  messages, and recall per million tokens; `partial` when a v1 council has failed experts.
- [ ] **Step 3:** `wsh ask` the person to check papercase's four judged reports against its key; correct the table.
- [ ] **Step 4:** Mark "close: re-run before deciding" where two variants of a case differ by one key line or less.

### Task 8: Findings note

**Depends on:** Task 1 (quotes teamprobe.md), Task 7 (quotes results.md)
**Files:** `docs/council-phase0.md`

- [ ] **Step 1:** Write the note: the results table; what the argue round bought (V2 vs V1), what the panel bought (V1
  vs V0), what the agent team bought (V3 vs V2) per case, in recall and in recall per million tokens; the probe's
  answers and RSS per teammate; the go/no-go for building the room on agent teams and the plumbing it implies (tail the
  team's files, or the `wsh council say` path); which comparisons are close; the tokens Phase 0 used in total.
- [ ] **Step 2: Commit** `docs/council-phase0.md` with the message
  `docs(council): phase 0, agent teams probed and benchmarked against council v1`. Do not push.
