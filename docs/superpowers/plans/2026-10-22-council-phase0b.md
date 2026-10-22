# Council v2 Phase 0b: a stronger benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-run Phase 0's comparison on cases with enough answer-key lines to separate the variants, so the agent-team
council gets a go or a no-go instead of "not decided".

**Architecture:** No product code. Same harness as Phase 0 (`docs/council-phase0.md`): cases, scripts, logs in
arcterm's data dir; V0 and V2 through `wsh council`; V3 a headless lead given the harness prompt; an opus judge. New:
two code cases holding several real bugs each, a second Brainstorm case with a known outcome, V3 launched with no tab's
variables so no stray message can reach it, and a second run of every close case (the spec's rule). Phase 0's scripts
stayed on the machine that ran it, so Tasks 1 and 2 write them again from the Phase 0 plan.

**Tech Stack:** `wsh council`, `claude -p`, git archive, bash (Git Bash on Windows), jq (Task 1 installs it); the
scripts in `<data dir>/council-bench/work/` (`check-cases.sh`, `run.sh`, `v3/run.sh`, `v3/tokens.sh`, `v3/review.md`,
`v3/brainstorm.md`, `judge.sh`, `results.sh`).

**Spec:** `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` (Benchmark, Phases item 0); Phase 0's note
`docs/council-phase0.md` (Go / no-go, Close comparisons, Tokens); the Phase 0 plan, deleted when it shipped:
`git show 74e8a2d4a^:docs/superpowers/plans/2026-10-22-council-phase0.md` (its Tasks 2, 4, 6 and 7 specify each
script). Below, "Phase 0 plan Task N" always means a task of that deleted plan, never of this one.

## Global Constraints

- No product code and no change under `pkg/`, `cmd/`, `frontend/`, `skills/`, `claude/`.
- `<data dir>` is the installed arcterm's `wavebase.GetWaveDataDir()`: on Windows `$LOCALAPPDATA/dev.arc.app/data`
  (Git Bash; `cygpath -u` it before handing it to `tar -C`, which cannot read a `C:\` path), on a Mac
  `~/Library/Application Support/dev.arc.app/data`; quote it in scripts. Cases and keys go in
  `<data dir>/council-bench/`, projects in `<data dir>/council-bench-projects/`, logs in `<data dir>/council-bench/work/`.
  `project` and `key` in `cases.json` are absolute paths in the form `wsh` reads (`C:/…` on Windows).
- The `newcomer` case is already there: `cases.json` holds its entry, `keys/newcomer.md` its five lines, and
  `council-bench-projects/newcomer/` the scrubbed snapshot of `0a2c46437` (built by hand 2026-10-22). The `solo-ui`
  group is in the config dir's `councilroles.json`. Keep both; append the new cases to `cases.json`, writing it to a
  temp file and moving it over the old one, so a script reading it never sees half a file.
- No case, key, quote or path from the person's thesis or papers, anywhere (the repo is public; the paper case was
  removed at the person's request). Every case comes from arcterm's own history.
- Variants: V0 (one agent, solo group), V2 (council v1), V3 (prompt-only agent team). V1 is left out: in Phase 0 it cost
  as much as V2 and scored the same or lower.
- One council or team at a time. **No run that spends tokens starts before the person's go (Task 5)**: the V3 smoke,
  the judge smoke and every real run come after it, and the go covers all of them.
- One run per cell in the first pass; a close case's variants run a second time (Task 8), the spec's rule. **0b's
  close rule (the person's call, 2026-10-22):** after the second run each cell scores the mean of its two runs, and a
  case whose variants are still within one key line counts as a tie, not as "not decided: re-run".
- Tokens are counted as `pkg/consult` counts them: input + cache read + cache creation + output.
- A `Not run: …` start is recorded as skipped, never retried.
- A worker asks the person with AskUserQuestion; the lead forwards it with `wsh jarvis dag forward`, never answers it.
- Commits carry no co-author trailer; nothing is pushed.

## Review Focus

- **A key line whose bug is not in the snapshot:** a fix made the same day may repair code added after the snapshot.
  Only a fix whose removed lines are present in the snapshot's files counts (Task 3's check).
- **A bug not findable by reading:** a fix whose bug shows only at run time (WebView2 or timing behaviour the source
  does not show) is dropped, as Phase 0 dropped `28f9e73ff`.
- **Answer leakage:** a snapshot that already holds the fix, its test, or a doc naming the bug or the decision. Each
  project is `git archive` of a commit before every fix (or before the spec), with every `docs/open-issues.md` and
  `CHANGELOG.md` line describing a kept bug deleted from the copy, and `check-cases.sh` greps for the kept fixes'
  subjects and the spec's and plan's file names.
- **A stray message reaching V3:** V3's lead runs with `WAVETERM_BLOCKID`, `WAVETERM_TABID`, `WAVETERM_WORKSPACEID`,
  `WAVETERM_CLIENTID`, `WAVETERM_SWAPTOKEN`, `WAVETERM_JWT` and `WAVETERM_CONN` unset, so `wsh agents send` cannot
  route to it; the run log records `env | grep -c WAVETERM` = 0.
- **The session's subagent cap:** the Claude mod's gate hook caps a claude session at 10 Agent calls with no rpc
  (`cmd/wsh/cmd/wshcmd-agenthook.go:633`, `jarvis.MaxSubagents`), so it holds headless too. The V3 prompts keep the
  lead to at most 10 Agent calls (a SendMessage resume does not count), and a refusal is logged as `failed`.
- **Unequal inputs:** all three variants of a case get the same feature, question and files, and every report is cut to
  the same top items (5 Review, 3 Brainstorm) before judging.
- **A loose judge:** the rubric demands the same problem or decision, not the same topic; the worker spot-checks every
  match against the fix diff or the spec text and corrects the table.
- **Rewritten scripts that differ from Phase 0's:** the token count, the cut to top items, the kept-aside column and
  the rubric must be the ones `docs/council-phase0.md` reports, or 0b's figures cannot be set beside Phase 0's.

---

### Task 1: jq and the case check

**Depends on:** none
**Files:** `<data dir>/council-bench/work/check-cases.sh`, `<data dir>/council-bench/work/fix-subjects.txt`

**Interfaces:**
- Produces: `check-cases.sh` as Phase 0 plan Task 2 Step 4 specifies it (fails when `<data dir>/council-bench-projects`
  holds a `key*.md`, a `cases.json` or a `work/` file; when a grep of the projects finds `council-agent-team`,
  `How they got here`, `has doubts`, or any line of `work/fix-subjects.txt`; or when a case's listed file is missing
  from its project), plus: a `review` case's key has at least 3 lines, a `brainstorm` case's at most 6. It prints
  `<n> cases ok`. `fix-subjects.txt` holds one leak string per line (a kept fix's subject, a spec or plan file name);
  it is outside every project, and `cases.json` keeps Phase 0's shape.

- [ ] **Step 1:** `command -v jq || scoop install jq` (on a Mac `brew install jq`), then `jq --version` — Expected: a
  version line.
- [ ] **Step 2:** Write `check-cases.sh` and an empty `fix-subjects.txt`.
- [ ] **Step 3:** `bash "<data dir>/council-bench/work/check-cases.sh"` — Expected: `1 cases ok` (newcomer).

### Task 2: The harness, written again

**Depends on:** Task 1 (jq)
**Files:** `<data dir>/council-bench/work/{run.sh,judge.sh,results.sh}`, `<data dir>/council-bench/work/v3/{review.md,brainstorm.md,run.sh,tokens.sh}`

**Interfaces:**
- Produces: the scripts as the Phase 0 plan specifies them (Phase 0 plan Task 4 the V3 harness, Phase 0 plan Task 6
  Step 1 `run.sh` for V0 and V2 only, Phase 0 plan Task 7 Step 1 `judge.sh` with its `keptaside` field, Phase 0 plan
  Task 7 Step 3 `results.sh`), writing to `runs-0b.jsonl` instead of `runs.jsonl` and taking `--run <n>` (default 1,
  recorded as `run` on each line and in the judged file name `judged/<case>-<variant>-<n>.json`), with what Phase 0
  learned built in: V3's lead runs `claude -p --model opus --output-format json --permission-mode bypassPermissions`
  (arcterm's subagent gate asks on every Agent call otherwise, and nobody answers headless); its teammates' transcripts
  are `<session>/subagents/agent-<id>.jsonl` beside the lead's under `~/.claude/projects/`; `tokens.sh` counts each
  assistant message id once over the lead and every teammate.
- `v3/run.sh` starts the lead under `env -u WAVETERM_BLOCKID -u WAVETERM_TABID -u WAVETERM_WORKSPACEID
  -u WAVETERM_CLIENTID -u WAVETERM_SWAPTOKEN -u WAVETERM_JWT -u WAVETERM_CONN`, writes `env | grep -c WAVETERM` (under
  the same `env -u`) to the run's log, and records `failed` when the lead's output shows an Agent call refused by the
  cap. `v3/run.sh --smoke` records to `smoke.jsonl`; `judge.sh --smoke` writes to `judged-smoke/`, never `judged/`.
- `results.sh` prints `results-0b.md`'s table (Task 7 Step 3) from `runs-0b.jsonl` and `judged/` (or `judged-smoke/`
  and `smoke.jsonl` with `--smoke`).

- [ ] **Step 1:** Read the Phase 0 plan and `docs/council-phase0.md`; write the scripts and the two V3 prompts. Leave
  out the paper case, V1 and the probe. Both prompts tell the lead to make at most 10 Agent calls (the Scout plus one
  per role, then SendMessage to resume a teammate, which is not an Agent call).
- [ ] **Step 2: Dry runs** (spend nothing). `run.sh --dry-run newcomer V0`, `run.sh --dry-run newcomer V2`,
  `v3/run.sh --dry-run newcomer` — Expected: each command names the case's project, group (solo group for V0),
  feature, question and files, every one present; V3's shows the `env -u …` prefix and a logged WAVETERM count of `0`.

### Task 3: Two multi-bug code cases

**Depends on:** Task 1 (check-cases.sh and fix-subjects.txt)
**Files:** `<data dir>/council-bench/cases.json`, `<data dir>/council-bench/work/fix-subjects.txt`, `<data dir>/council-bench/keys/services-bugs.md`, `<data dir>/council-bench/keys/agents-bugs.md`, `<data dir>/council-bench-projects/services-bugs/`, `<data dir>/council-bench-projects/agents-bugs/`

**Interfaces:**
- Produces: two entries appended to `cases.json` in Phase 0's shape (`id`, `mode`, `project`, `group`, `solo_group`,
  `feature`, `question`, `files`, `key`), ids `services-bugs` and `agents-bugs`, mode `review`, group `ui-feature`, solo
  group `solo-ui`, question `What is broken or wrong here? List every bug you can show.`; each kept fix's subject
  appended to `fix-subjects.txt`.

- [ ] **Step 1: services-bugs.** Candidate fixes: `c34d80918`, `5ab29f56f`, `66f34fac3`, `a7b03126d`, `30f0cc485`,
  `ac4c29f39`. Snapshot at the parent of the earliest of these six by commit date (`a7b03126d`):
  `git archive a7b03126d^ | tar -x -C "<data dir>/council-bench-projects/services-bugs"`. Keep a candidate only when
  both hold: every line its diff removes from non-test files is in the snapshot (`git show <sha> -- <file>`, then
  `grep -F` each removed line in the snapshot's file; a miss drops the fix), and its bug shows from reading the source
  (drop one that shows only at run time). Delete from the copy every `docs/open-issues.md` and `CHANGELOG.md` line that
  describes a kept bug. Key: one line per kept fix naming the bug, from its subject and diff. Files: the union of the
  kept fixes' non-test, non-doc files. Feature: `Services and pinned apps`.
- [ ] **Step 2: agents-bugs.** Candidate fixes: `45d6620da`, `761e813fa`, `c4ef9cb30`, `bcbdfb81e`. Snapshot at the
  parent of the earliest of these four by commit date (`bcbdfb81e^`), not services-bugs' snapshot. Same presence,
  readable-bug, scrub, key and files rules (`bcbdfb81e`'s garbled split-pane text may be run-time only: judge it by its
  diff). Feature: `The Agent surface's grid and the rail's Changes list`.
- [ ] **Step 3:** Each case needs at least 3 kept bugs; if one has fewer, add the next `fix(...)` commits in the same
  area from `git log --since=2026-10-15` until it has 3, by the same rules, re-snapshotting at the parent of the new
  earliest fix if one is older.
- [ ] **Step 4:** Append each kept fix's subject to `fix-subjects.txt` and run `check-cases.sh` — Expected:
  `3 cases ok`.

### Task 4: A second Brainstorm case with a known outcome

**Depends on:** none
**Files:** `<data dir>/council-bench/keys/services-sleep.md`, `<data dir>/council-bench-projects/services-sleep/`, `<data dir>/council-bench/work/services-sleep-entry.json`

**Interfaces:**
- Produces: `services-sleep-entry.json`, one `cases.json` entry in Phase 0's shape (Task 3 owns `cases.json`; Task 5
  appends it): id `services-sleep`, mode `brainstorm`, group `ui-feature`, solo group `solo-ui`.

- [ ] **Step 1:** Snapshot at the commit before the services-sleep spec and plan were added (`5207af644^`) into
  `council-bench-projects/services-sleep/`. Delete from the copy any `docs/open-issues.md` or `CHANGELOG.md` line that
  states one of the spec's decisions.
- [ ] **Step 2:** Key: the spec's main decisions (`git show 5207af644:docs/superpowers/specs/2026-10-20-services-sleep-design.md`),
  one per line, at most 6 (what happens to a service nobody is looking at, when, what keeps it awake, how it comes back,
  what the person can override). Question: the problem the spec's opening states, in plain words, without any of its
  decisions. Feature: `Services that run while unused`. Files: the services code the spec names, as it stood in the
  snapshot. Write the entry to `services-sleep-entry.json`.
- [ ] **Step 3:** `grep -rlE 'services-sleep-design|services-sleep\.md|sleep when not in use' "<data dir>/council-bench-projects/services-sleep"`
  — Expected: no output, and `jq -e .id services-sleep-entry.json` prints `"services-sleep"`.

### Task 5: Estimate and the person's go

**Depends on:** Task 2 (the harness the estimate covers), Task 3 (cases.json and the two code cases), Task 4 (the services-sleep entry)
**Files:** `<data dir>/council-bench/cases.json`, `<data dir>/council-bench/work/fix-subjects.txt`, `<data dir>/council-bench/work/estimate-0b.md`

- [ ] **Step 1:** Append `services-sleep-entry.json` to `cases.json`, add `services-sleep-design.md`,
  `services-sleep.md` and `sleep when not in use` to `fix-subjects.txt`, and run `check-cases.sh`. The cases are
  `services-bugs`, `agents-bugs`, `newcomer`, `services-sleep`. Expected: `4 cases ok`.
- [ ] **Step 2:** Estimate each cell from Phase 0's measured figures, not `wsh council estimate` (it reads low; see
  `docs/open-issues.md`): V0 ≈ 0.55M, V2 ≈ 1.4M, V3 ≈ 3.0M, scaled by each case's file size against Phase 0's. Add the
  V3 smoke (≈ 0.6M) and the judge smoke and judging (≈ 0.2M). Write the per-cell figures and the first pass's total to
  `estimate-0b.md`, then the second runs' ceiling apart: every variant of every case once more, the most Task 8 can
  spend.
- [ ] **Step 3:** Ask the person (AskUserQuestion) with the first pass's total and the second runs' ceiling, saying
  each v1 start may raise a Token burn card they must allow within 30 minutes. A V3 lead runs with no tab and no
  `WAVETERM_JWT`, so its spawn card has nowhere to show: with no wavesrv to reach, `wsh tokengate` errors and the
  Claude mod lets the spawn run (`cmd/wsh/cmd/wshcmd-tokengate.go`, its header comment); the go covers the V3 teams
  too. Wait for the answer; end `estimate-0b.md` with `go: all|part|no` (a part names the cells) and
  `rerun: yes|no` (whether Task 8 may run). Done when both lines are there.

### Task 6: Smoke, then the twelve

**Depends on:** Task 5 (runs only what estimate-0b.md's go line allows)
**Files:** `<data dir>/council-bench/work/smoke.jsonl`, `<data dir>/council-bench/work/judged-smoke/`, `<data dir>/council-bench/work/runs-0b.jsonl`

- [ ] **Step 1: Smoke.** `v3/run.sh --smoke` on a small folder with a three-paragraph `README.md`, haiku everywhere,
  a Scout and one role. Expected: a `council-report.md`, a `smoke.jsonl` line with state `done`, tokens > 0, and a
  log WAVETERM count of `0`; `tokens.sh` on the lead's transcript alone within 5% of the headless JSON's `usage` summed
  the `pkg/consult` way.
- [ ] **Step 2: Judge smoke.** `judge.sh --smoke` on a fake newcomer report made of its key's own lines and on one made
  of unrelated lines; then `results.sh --smoke`. Expected: every key line matched, then none; a two-row table.
- [ ] **Step 3:** For each case in Task 5's order, as the go line allows: V2, V0, then V3, one at a time (`run.sh`,
  `v3/run.sh`), appending to `runs-0b.jsonl` (`case`, `variant`, `run`, `id`, `state`, `tokens`, `minutes`,
  `messages`).
- [ ] **Step 4:** Run
  `jq -s 'map(select(.run == 1)) | group_by(.case + "/" + .variant) | map(last) | map(.state)' "<data dir>/council-bench/work/runs-0b.jsonl"`
  — Expected: 12 entries (fewer only where the go line left cells out), each `done`, `skipped` or `failed`.

### Task 7: Judge and score

**Depends on:** Task 6 (judges the runs in runs-0b.jsonl)
**Files:** `<data dir>/council-bench/work/judged/`, `<data dir>/council-bench/work/results-0b.md`

- [ ] **Step 1:** Judge every `done` run with `judge.sh` (same rubric, top 5 Review, top 3 Brainstorm; a V3 Brainstorm
  report's Wild ideas kept aside judged apart into `keptaside`).
- [ ] **Step 2:** Check every match yourself against the fix diff (code cases) or the spec text (brainstorm cases);
  correct the judged file where a match names the topic but not the problem.
- [ ] **Step 3:** `results.sh > results-0b.md`: a row per run (recall, kept-aside matches for the V3 rows of
  `newcomer` and `services-sleep` in a column of their own outside recall, wrong items, tokens, minutes, messages,
  recall per M tokens), a summed row per variant over all four cases, and "close" where two variants of a case differ by
  one key line or less. Expected: one row per `done` run in `runs-0b.jsonl` (12 when all ran), three summed rows, the
  kept-aside column present.

### Task 8: Second runs of the close cases

**Depends on:** Task 7 (reads the close marks in results-0b.md)
**Files:** `<data dir>/council-bench/work/runs-0b.jsonl`, `<data dir>/council-bench/work/judged/`, `<data dir>/council-bench/work/results-0b.md`

- [ ] **Step 1:** If `estimate-0b.md` says `rerun: no`, or no case is marked close, write that line under the table in
  `results-0b.md` and stop here. Otherwise, for each case with a close mark, run each of its variants once more with
  `--run 2` (same order, one at a time), then judge and spot-check them as in Task 7.
- [ ] **Step 2:** `results.sh > results-0b.md` again, now scoring each re-run cell on the mean of its two runs, and
  marking "tie" (not "close: re-run") where a case's variants are still within one key line. Expected: a row per run,
  the re-run cells' means, no "re-run" mark left.

### Task 9: Findings

**Depends on:** Task 8 (quotes the final results-0b.md)
**Files:** `docs/council-phase0.md`, `docs/superpowers/specs/2026-10-22-council-agent-team-design.md`, `docs/superpowers/plans/2026-10-22-council-phase0b.md`

- [ ] **Step 1:** Add a section "Phase 0b: the stronger pass" to `docs/council-phase0.md`: the cases (by id, key size,
  how each was built, the fixes dropped and why), the results table, the summed rows, what the panel bought (V2 vs V0)
  and what the agent team bought (V3 vs V2), the go/no-go by Phase 0's rule applied over the four cases with 0b's close
  rule (Global Constraints), the kept-aside matches, and the tokens the pass used (smoke, runs, second runs, judging).
  Name no thesis or paper detail.
- [ ] **Step 2:** In the same note, change the top **Verdict** line so it leads with 0b's verdict and says Phase 0's
  stands only for its own two cases, and change the "Two cases, not three" deviation to say 0b ran four.
- [ ] **Step 3:** In the spec, update the Status paragraph with 0b's verdict, and replace the "Where it stands" bullet
  that starts **Next, with Arc engine** (and the hand-check bullet after it that waits on this plan) with what 0b
  found and what comes next by its verdict: plan Phase 1 on a go, or the "Quick" v1 path and revisit on a no-go.
- [ ] **Step 4:** Delete this plan (`git rm docs/superpowers/plans/2026-10-22-council-phase0b.md`), as AGENTS.md has
  for a shipped plan.
- [ ] **Step 5: Commit** the three paths with the message
  `docs(council): phase 0b, a stronger benchmark of agent teams against council v1`. Do not push.
