# Council v2 Phase 0b: a stronger benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-run Phase 0's comparison on cases with enough answer-key lines to separate the variants, so the agent-team
council gets a go or a no-go instead of "not decided".

**Architecture:** No product code. Same harness as Phase 0 (`docs/council-phase0.md`): cases, scripts, logs in
arcterm's data dir; V0 and V2 through `wsh council`; V3 a headless lead given the harness prompt; an opus judge. New:
two code cases holding several real bugs each, a second Brainstorm case with a known outcome, and V3 launched outside
any tab so no stray message can reach it. Phase 0's scripts stayed on the machine that ran it, so Task 1 writes them
again from the Phase 0 plan.

**Tech Stack:** `wsh council`, `claude -p`, git archive, bash (Git Bash on Windows), jq; the scripts Task 1 writes in
`<data dir>/council-bench/work/` (`run.sh`, `v3/run.sh`, `v3/tokens.sh`, `v3/review.md`, `v3/brainstorm.md`,
`judge.sh`, `results.sh`, `check-cases.sh`).

**Spec:** `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` (Benchmark, Phases item 0); Phase 0's note
`docs/council-phase0.md` (Go / no-go, Close comparisons, Probe); the Phase 0 plan, deleted when it shipped:
`git show 74e8a2d4a^:docs/superpowers/plans/2026-10-22-council-phase0.md` (its Tasks 2, 4, 6 and 7 specify each script).

## Global Constraints

- No product code and no change under `pkg/`, `cmd/`, `frontend/`, `skills/`, `claude/`.
- `<data dir>` is the installed arcterm's `wavebase.GetWaveDataDir()`: on Windows `$LOCALAPPDATA/dev.arc.app/data`
  (Git Bash; `cygpath -u` it before handing it to `tar -C`, which cannot read a `C:\` path), on a Mac
  `~/Library/Application Support/dev.arc.app/data`; quote it in scripts. Cases and keys go in
  `<data dir>/council-bench/`, projects in `<data dir>/council-bench-projects/`, logs in `<data dir>/council-bench/work/`.
  `project` and `key` in `cases.json` are absolute paths in the form `wsh` reads (`C:/…` on Windows).
- The `newcomer` case is already there: `cases.json` holds its entry, `keys/newcomer.md` its five lines, and
  `council-bench-projects/newcomer/` the scrubbed snapshot of `0a2c46437` (built by hand 2026-10-22). The `solo-ui`
  group is in the config dir's `councilroles.json`. Keep both; append the new cases to `cases.json`.
- No case, key, quote or path from the person's thesis or papers, anywhere (the repo is public; the paper case was
  removed at the person's request). Every case comes from arcterm's own history.
- Variants: V0 (one agent, solo group), V2 (council v1), V3 (prompt-only agent team). V1 is left out: in Phase 0 it cost
  as much as V2 and scored the same or lower.
- One run per cell; one council or team at a time. No run starts before the person's go on the total (Task 4).
- Tokens are counted as `pkg/consult` counts them: input + cache read + cache creation + output.
- A `Not run: …` start is recorded as skipped, never retried.
- Commits carry no co-author trailer; nothing is pushed.

## Review Focus

- **A key line whose bug is not in the snapshot:** a fix made the same day may repair code added after the snapshot.
  Only a fix whose removed lines are present in the snapshot's files counts (Task 2's check).
- **Answer leakage:** a snapshot that already holds the fix, its test, or a later doc naming the bug or the decision.
  Each project is `git archive` of a commit before every fix (or before the spec), checked by grep for the fix commits'
  subjects and the spec's file name.
- **A stray message reaching V3:** V3 runs with no tab's block id in its environment, so `wsh agents send` cannot route
  to it; the run log records the environment check.
- **Unequal inputs:** all three variants of a case get the same feature, question and files, and every report is cut to
  the same top items (5 Review, 3 Brainstorm) before judging.
- **A loose judge:** the rubric demands the same problem or decision, not the same topic; the worker spot-checks every
  match against the fix diff or the spec text and corrects the table.
- **Rewritten scripts that differ from Phase 0's:** the token count, the cut to top items and the rubric must be the
  ones `docs/council-phase0.md` reports, or 0b's figures cannot be set beside Phase 0's.

---

### Task 1: The harness, written again

**Depends on:** none
**Files:** `<data dir>/council-bench/work/{run.sh,judge.sh,results.sh,check-cases.sh}`, `<data dir>/council-bench/work/v3/{review.md,brainstorm.md,run.sh,tokens.sh}`

**Interfaces:**
- Produces: the scripts as the Phase 0 plan specifies them (Task 2 Step 4 `check-cases.sh`, Task 4 the V3 harness,
  Task 6 Step 1 `run.sh` for V0 and V2 only, Task 7 Step 1 `judge.sh`, Task 7 Step 3 `results.sh`), writing to
  `runs-0b.jsonl` instead of `runs.jsonl`, with what Phase 0 learned built in: V3's lead runs
  `claude -p --model opus --output-format json --permission-mode bypassPermissions` (arcterm's subagent gate asks on
  every Agent call otherwise, and nobody answers headless); its teammates' transcripts are
  `<session>/subagents/agent-<id>.jsonl` beside the lead's under `~/.claude/projects/`; `tokens.sh` counts each
  assistant message id once over the lead and every teammate.

- [ ] **Step 1:** Read the Phase 0 plan (`git show 74e8a2d4a^:docs/superpowers/plans/2026-10-22-council-phase0.md`)
  and `docs/council-phase0.md`; write the scripts and the two V3 prompts. Leave out the paper case, V1 and the probe.
- [ ] **Step 2:** `bash check-cases.sh` — Expected: `1 cases ok` (newcomer).
- [ ] **Step 3: Dry runs.** `run.sh --dry-run newcomer V0`, `run.sh --dry-run newcomer V2`,
  `v3/run.sh --dry-run newcomer` — Expected: each command names the case's project, group (solo group for V0), feature,
  question and files, every one present.
- [ ] **Step 4: Smoke** (costs about 0.6M tokens, inside Task 4's total): `v3/run.sh --smoke` on a small folder with a
  three-paragraph `README.md`, haiku everywhere, a Scout and one role; `judge.sh` on a fake newcomer report made of its
  key's lines and on one of unrelated lines. Expected: a `council-report.md` and a smoke line with tokens > 0; the
  judge matches every key line, then none.

### Task 2: Two multi-bug code cases

**Depends on:** Task 1 (extends check-cases.sh)
**Files:** `<data dir>/council-bench/cases.json`, `<data dir>/council-bench/keys/services-bugs.md`, `<data dir>/council-bench/keys/agents-bugs.md`, `<data dir>/council-bench-projects/services-bugs/`, `<data dir>/council-bench-projects/agents-bugs/`

**Interfaces:**
- Produces: two entries appended to `cases.json` in Phase 0's shape (`id`, `mode`, `project`, `group`, `solo_group`,
  `feature`, `question`, `files`, `key`), ids `services-bugs` and `agents-bugs`, mode `review`, group `ui-feature`, solo
  group `solo-ui`, question `What is broken or wrong here? List every bug you can show.`

- [ ] **Step 1: services-bugs.** Candidate fixes: `c34d80918`, `5ab29f56f`, `66f34fac3`, `a7b03126d`, `30f0cc485`,
  `ac4c29f39`. Snapshot at the parent of the earliest of them in `git log` order:
  `git archive <earliest>^ | tar -x -C "<data dir>/council-bench-projects/services-bugs"`. For each candidate, keep it
  only if the lines its diff removes (non-test files) are present in the snapshot. Key: one line per kept fix naming the
  bug, from its subject and diff. Files: the union of the kept fixes' non-test files. Feature: `Services and pinned apps`.
- [ ] **Step 2: agents-bugs.** Candidate fixes: `45d6620da`, `761e813fa`, `c4ef9cb30`, `bcbdfb81e`. Same snapshot,
  presence check, key and files rule. Feature: `The Agent surface's grid and the rail's Changes list`.
- [ ] **Step 3:** Each case needs at least 3 kept bugs; if one has fewer, add the next `fix(...)` commits in the same
  area from `git log --since=2026-10-15` until it has 3, by the same rule.
- [ ] **Step 4:** Extend `check-cases.sh` so it also fails when a project contains a kept fix's subject line, and run
  it. Expected: every case ok.

### Task 3: A second Brainstorm case with a known outcome

**Depends on:** none
**Files:** `<data dir>/council-bench/keys/services-sleep.md`, `<data dir>/council-bench-projects/services-sleep/`

**Interfaces:**
- Produces: a `cases.json` entry handed to Task 4 in the worker's report (Task 2 owns `cases.json`): id
  `services-sleep`, mode `brainstorm`, group `ui-feature`, solo group `solo-ui`.

- [ ] **Step 1:** Snapshot at the commit before `docs/superpowers/specs/2026-10-20-services-sleep-design.md` was added
  (`5207af644^`) into `council-bench-projects/services-sleep/`. Check it holds neither that spec nor its plan.
- [ ] **Step 2:** Key: the spec's main decisions, one per line, at most 6 (what happens to a service nobody is
  looking at, when, what keeps it awake, how it comes back, what the person can override). Question: the problem the
  spec's opening states, in plain words, without any of its decisions. Feature: `Services that run while unused`. Files:
  the services code the spec names, as it stood in the snapshot.

### Task 4: Estimate and the person's go

**Depends on:** Task 2 (cases.json and the two code cases), Task 3 (the services-sleep entry, added here to cases.json)
**Files:** `<data dir>/council-bench/work/estimate-0b.md`

- [ ] **Step 1:** Add Task 3's entry to `cases.json` and run `check-cases.sh`. The cases are `services-bugs`,
  `agents-bugs`, `newcomer`, `services-sleep`. Expected: `4 cases ok`.
- [ ] **Step 2:** Estimate each cell from Phase 0's measured figures, not `wsh council estimate` (it reads low; see
  `docs/open-issues.md`): V0 ≈ 0.55M, V2 ≈ 1.4M, V3 ≈ 3.0M, scaled by each case's file size against Phase 0's. Write
  the per-cell figures and the total to `estimate-0b.md`.
- [ ] **Step 3:** `wsh ask` the person with the total, saying each v1 start may raise a Token burn card they must
  allow within 30 minutes. A V3 lead runs with no tab, so its spawn card has nowhere to show: with no wavesrv to
  reach, `wsh tokengate` errors and the Claude mod lets the spawn run (`cmd/wsh/cmd/wshcmd-tokengate.go`, its header
  comment); the go covers the V3 teams too. Wait for go.

### Task 5: Run the twelve

**Depends on:** Task 1 (run.sh and v3/run.sh), Task 4 (runs only after the person's go)
**Files:** `<data dir>/council-bench/work/v3/run.sh`, `<data dir>/council-bench/work/runs-0b.jsonl`

- [ ] **Step 1:** Make sure `v3/run.sh` starts the lead with every variable that names a tab or block removed from its
  environment (find them with `env | grep -iE 'block|tab|wave'` in an agent's shell; remove those `wsh agents send`
  routes on), headless only, and records that check in the run's log.
- [ ] **Step 2:** For each case in the order of Task 4's list: V2, V0, then V3, one at a time (`run.sh`, `v3/run.sh`),
  appending to `runs-0b.jsonl` (`case`, `variant`, `id`, `state`, `tokens`, `minutes`, `messages`).
- [ ] **Step 3:** Run `jq -s 'length' "<data dir>/council-bench/work/runs-0b.jsonl"`. Expected: `12`, each state
  `done`, `skipped` or `failed`.

### Task 6: Judge and score

**Depends on:** Task 5 (judges the runs in runs-0b.jsonl)
**Files:** `<data dir>/council-bench/work/results-0b.md`

- [ ] **Step 1:** Judge every run with `judge.sh` (same rubric, top 5 Review, top 3 Brainstorm).
- [ ] **Step 2:** Check every match yourself against the fix diff (code cases) or the spec text (brainstorm cases);
  correct the table where a match names the topic but not the problem.
- [ ] **Step 3:** `results-0b.md`: a row per run (recall, wrong items, tokens, minutes, messages, recall per M tokens),
  a summed row per variant over all four cases, and "close" where two variants of a case differ by one key line or
  less.

### Task 7: Findings

**Depends on:** Task 6 (quotes results-0b.md)
**Files:** `docs/council-phase0.md`

- [ ] **Step 1:** Add a section "Phase 0b: the stronger pass" to `docs/council-phase0.md`: the cases (by id, key size,
  how each was built), the results table, the summed rows, what the panel bought (V2 vs V0) and what the agent team
  bought (V3 vs V2), the go/no-go by Phase 0's rule applied over the four cases, and the tokens the pass used. Name no
  thesis or paper detail.
- [ ] **Step 2: Commit** `docs/council-phase0.md` with the message
  `docs(council): phase 0b, a stronger benchmark of agent teams against council v1`. Do not push.
