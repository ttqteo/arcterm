# Council bench: council against a Claude Code agent team

Date: 2026-11-03. Brainstorm: `.superpowers/brainstorm/council-bench-team/brainstorm.json`.

## Why

The bench exists to decide one thing: **whether to rebuild the council on a Claude Code agent team.** Phase 0b
(`docs/council-phase0.md`, 2026-10-23) ran a team by hand and found it tied council v1 on recall (3/16 each) at about half
the tokens (13.4M against 26.3M). That result is not enough to build on: 11 of 16 key lines were matched by nobody, the one
code case scored 0/5 for every variant, and only one cell got a second run, while a cell moves by about one key line between
runs. This pass measures the same comparison on cases built to separate the variants, with every cell run twice.

## What the code does today

- `pkg/council/bench` runs two variants, `solo` and `council` (`cases.go:34`); `benchCouncil` builds a hidden `Bench`
  council for each (`run.go:161`), `Run` starts it, waits, judges a done one and appends a `CouncilBenchResult` row to
  `council-bench.jsonl` (`run.go:58`).
- `Judge` makes one opus call with no tools and reads only the council's `Summary` (`Answer`, `Text`, `Directions`, and for a
  Review the `Kept` list), cut to the top 5 (Review) or top 3 (Brainstorm) (`judge.go:94`, `judge.go:112`).
- Cases are `council-bench/cases.json` in the data dir: newcomer, services-bugs, agents-bugs, services-sleep, with keys under
  `council-bench/keys/`.
- The plan is priced at 550,000 tokens a solo run and 1,400,000 a council run (`cases.go:41`). Measured runs were 1.0 to 4.7M
  (solo) and 1.4 to 17.5M (council). Nothing caps a bench's spend.
- `wsh council bench results` prints "no bench results yet": the Go bench has never run.
- The 0b team ran from `council-bench/work/v3/run.sh` (data dir, outside the repo): an opus lead under `claude -p`, agent teams
  on through `.claude/settings.json`, `--permission-mode bypassPermissions`, `--strict-mcp-config`, Bash, PowerShell, Edit,
  NotebookEdit, WebFetch and WebSearch off, every `WAVETERM_*` variable unset, a haiku Scout and one sonnet teammate per
  `ui-feature` role. `tokens.sh` summed the lead's transcript and every `subagents/agent-*.jsonl`. Team cells cost 3.0 to 6.9M.

## Design

### Variants

Each case runs two variants:

1. **council**: council v1 as it ships, at the current `HarnessVersion`.
2. **team**: a Claude Code agent team with the same roles and models: an opus lead in the coordinator's seat and one sonnet
   teammate per role of the case's group, read-only tools.

No `solo` and no "solo ×3, merged" cells in this pass. Agent's call: a bare `wsh council bench` runs council and team
(`AllVariants`); `solo` stays runnable with `--variant solo`. 0b's four cases are marked retired in `cases.json` and skipped
unless named with `--case`.

### The team variant lives in the Go bench

`pkg/council/bench` gains `VariantTeam = "team"`. A team item:

1. Copies the case's project to a throwaway folder and writes `.claude/settings.json` there with
   `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
2. Starts the lead headless: `claude -p --model opus --output-format json --permission-mode bypassPermissions
   --strict-mcp-config --disallowedTools Bash,PowerShell,Edit,Write,NotebookEdit,WebFetch,WebSearch`, with every `WAVETERM_*`
   variable removed from its environment, so no spawn gate, Token burn card or stray `wsh agents send` reaches it, and a
   wall-time limit.
3. Feeds it a prompt ported from 0b's `v3/review.md` / `brainstorm.md`, built from the case's feature, question, files and
   the group's roles (`roles.go`), that asks for a report in a fixed format. Agent's call: no Scout and no Write tool (0b
   had both); the lead returns its report in the `claude -p` JSON result, not a file.
4. Parses that report into a `council.Summary` and judges it with the same `Judge` as the council cells.
5. Counts tokens over the lead's transcript and every teammate transcript, each assistant message once, in `pkg/consult`'s
   count (input + cache read + cache creation + output).
6. Writes one `CouncilBenchResult` row like any other cell; `Messages` is the `SendMessage` calls of the lead and teammates.

The 0b bash scripts are not used.

### Cases and keys

Two new cases, none of 0b's reused:

- **Plan/spec review** (Review, top 5): an arcterm spec or plan from before its build; the key is the flaws later `fix(...)`
  commits repaired.
- **Multi-file bug hunt** (Review, top 5): a snapshot before several fixes whose bugs each span two or more files, with every
  file each bug needs inside the case's file list.

Each project is a `git archive` of the snapshot commit, without `.git`, scrubbed of any plan or doc that names a kept fix;
0b's leak check (grep the project for the fixes' subjects and every key line verbatim) passes before any cell runs.
Agent's call: it is a step the case builder runs before the approval stop, not code in `LoadCases`; `cases.json` gains no
field for it. Each new case carries a tag naming this pass, which the verdict reads.

**Who builds them:** the agent searched git history for candidates of each kind and drafted each one's snapshot, file
list and key lines; the person approved one of each in the brainstorm (2026-11-03), listed under **Approved cases**. The
plan only installs them.

### Approved cases

Both are Review (top 5), group `ui-feature`, solo group `solo-ui`, tag `team-bench-2026-11`. Projects go to
`<data dir>/council-bench-projects/<id>`, keys to `<data dir>/council-bench/keys/<id>.md`, where the data dir is the packaged
app's (`%LOCALAPPDATA%\dev.arc.app\data`), the one 0b's cases live in.

**`spec-live-agents`**: plan/spec review.

- Snapshot `0d452589e` (the spec and plan for Council with live agents just written, nothing built). Run f46b61f9 built
  it; its fix round (`537c4dbf3`, fixes `54559d037` and `c5ca6fedd`) repaired the flaws in the key.
- Feature: "Council with live agents and a Slack-style council chat". Question: "This spec and plan are about to be
  built. What is wrong or missing in them? List every flaw you can show."
- Files: `docs/superpowers/specs/2026-10-29-council-live-agents-design.md`,
  `docs/superpowers/plans/2026-10-29-council-live-agents.md`, `pkg/council/prompts.go`, `pkg/council/runner.go`,
  `pkg/council/types.go`, `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councildiscussionmodel.ts`,
  `frontend/app/view/agents/agenttreemodel.ts`, `frontend/app/view/agents/councilsetupmodel.ts`.
- Key:
  - K1: The synthesis, answers and picks prompts hard-code round 2 for the picks and withdrawals, so a council the person sets to 3 rounds (or 1) names the wrong round.
  - K2: Summarize accepts an awaiting council whose ideas are all held drafts, so the synthesis runs with no idea to read.
  - K3: The frontend's Summarize check and the expert cards count held and dropped drafts as ideas, not only sent ones.
  - K4: The plan adds a second claude/pi seat rule (Setup's seatable agents) beside the agent tree's, with a different project-path fallback.

**`bugs-orchestrate`**: multi-file bug hunt.

- Snapshot `18e85a3fa^` (`16abe9e10`, 2026-10-30), which holds none of the four fixes (`18e85a3fa` was committed before
  the other three despite its later author date, so `981dd5bd3^` already holds K3's fix).
- Feature: "The orchestrator engine: ended runs, final-stage trees and lands". Question: "What is broken or wrong here?
  List every bug you can show."
- Files: `pkg/orchestrate/engine.go`, `pkg/orchestrate/mutation.go`, `pkg/orchestrate/watchdog.go`,
  `pkg/orchestrate/final.go`, `pkg/orchestrate/verifier.go`, `pkg/orchestrate/land.go`, `pkg/orchestrate/queue.go`,
  `frontend/app/view/orchestrate/daggraph-header.tsx`, `frontend/app/view/agents/runlineage.ts`.
- Key:
  - K1: A dag whose owner run is done or cancelled is never settled: it stays blocked or finalizing, and the watchdog keeps ticking a finalizing one that fails on the branch the land deleted.
  - K2: A retried removal of a held final tree deletes by path, so it can remove the next round's live tree made at the same `<run>-final` path.
  - K3: A land held by a merge, rebase or cherry-pick in progress is not Dirty, so the dirty-land retry never retries it once the operation ends.
  - K4: The DAG graph header counts only done tasks while the tree's run progress counts done and skipped, so a run with a skipped task reads 4/5 in one and 5/5 in the other.

The fixes' subjects for the leak check are those of `5604d611d`, `981dd5bd3`, `18e85a3fa` and `7561eb541`
(`bugs-orchestrate`) and of `537c4dbf3`, `54559d037` and `c5ca6fedd` (`spec-live-agents`).

### Size and token cap

One case of each kind, two variants, two runs each: **8 cells**. The bench has a **50M token cap**: it starts no new cell
once the spend recorded so far reaches it. The plan's price uses measured figures, not today's constants: 0b's means,
2.3M a solo run, 8.8M a council run (V2) and 4.5M a team run (V3). That prices the 8 cells at about 53M, over the cap;
the person kept the cap at 50M (the council's mean is pulled up by one 17.5M run, its median is 4.4M), so a cut cell is
rerun with `--case`.

Agent's call: the cap counts this invocation's cells and judge calls; the haiku smoke runs before it, apart. Cells run
interleaved, run 1 of every cell before any run 2, and a case's council and team cells back to back, so a cut leaves
complete pairs. A cell already running when the cap is reached finishes.

### Go / no-go

Each cell scores the mean of its two runs; recall is summed over both cases.

- **Go**: team recall within one key line of the council's, or above it, at under 0.8× the council's tokens.
- **No-go**: team recall two or more key lines below the council's.
- **Not decided**: anything else (a tie at 0.8× the tokens or more).

`wsh council bench results` prints the verdict beside the table.

Agent's call: the verdict reads only rows of the current `HarnessVersion` for the cases tagged with this pass, and the
latest two scored runs of each cell. A cell with fewer than two scored runs (failed, timed out, cut by the cap) makes the
verdict "not decided: incomplete", naming the cell. Team rows carry `council.HarnessVersion`, like council rows.

### Where the plan stops

The plan ends at **ready to run**: the code, the two approved cases and a haiku smoke run of the team variant. The person
starts the 8 cells with one command (`wsh council bench`, priced first on the Token burn card) and the verdict is written up
after it. The plan neither runs the 50M pass nor writes the verdict.

## Calls made while planning

- **The wiring.** `bench.Run` takes one `Funcs` struct (`Start`, `Wait`, `Judge`, `Remind`, `Team`) instead of four
  arguments. `TeamFunc` is `func(ctx context.Context, c Case) (TeamOutcome, error)`; `TeamOutcome` holds the state
  (`done`, `failed`, `timed-out`), the parsed `*council.CouncilSummary`, tokens, minutes and messages. Its error is the
  context's only, as `runItem`'s is: any other failure is an outcome with a failed state. `runItem` judges a done team
  outcome by wrapping its summary in a `council.Council`. The real `TeamFunc` is `bench.RunTeam` with `TeamOptions{Lead:
  "opus", Mate: "sonnet", Limit: 45 * time.Minute}`.
- **Judge tokens.** `Verdict` gains `Tokens` (the judge call's usage), and the run row gains `judgetokens`, so the cap
  sums `tokens + judgetokens` over this invocation's rows.
- **Case fields.** `Case` gains `retired` (bool) and `tag` (string). `Plan` leaves a retired case out unless it is named
  in `Cases`. The pass's tag is the constant `bench.TeamPassTag = "team-bench-2026-11"`.
- **Order.** `Plan` orders by run, then case, then variant (council before team), so run 1 of every cell comes first and
  a case's pair is back to back.
- **The verdict on the wire.** `CouncilBenchResultsRtnData` gains `Verdict *bench.CouncilBenchDecision` (`outcome`: `go`,
  `no-go` or `not decided`; `reason`; the summed recall and tokens of each side). wavesrv computes it from the results and
  the cases tagged `TeamPassTag`; `wsh council bench results` prints it under the table.
- **`--runs` defaults to 2**, so a bare `wsh council bench` is the 8 cells (it defaulted to 1).
- **Key reads fail the cell.** A team cell whose transcripts hold a tool call (other than Agent, Task or SendMessage)
  whose input names the `council-bench` folder, where the keys live, is a failed row with a log line naming the count,
  never a score (0b only noted these as `bench_reads`).
- **Token cross-check.** The team count from the transcripts is compared with the result JSON's `modelUsage`, summed
  over every model (the session's cumulative count, teammates included); a gap over 5% is logged with both figures. The
  row keeps the transcripts' count.
- **The smoke run** is a Go test that runs only when `ARC_BENCH_SMOKE=1`: `RunTeam` with haiku for the lead and the
  teammates on a tiny fixture project under `pkg/council/bench/testdata/`, checking that the report parses into at least
  one item, at least one teammate transcript was read, `Messages` is 1 or more, and the transcripts' tokens are within
  5% of `modelUsage`. It judges nothing. Verify never runs it; the task that builds the team runner
  runs it once.
- **Building the cases** is `scripts/council-bench-cases.mjs`: it archives each snapshot, scrubs plans and docs that name
  a kept fix, runs the leak check (exit nonzero on a hit), writes the keys, marks 0b's four cases retired and adds the
  two new ones to `cases.json`. It is idempotent, so it can be rerun.
- No council prompt changes, so `HarnessVersion` stays. No UI changes, so the plan has no Final.

## Not in this change

- No solo or solo ×3 variant, no thesis case, no reuse of 0b's cases.
- No change to how the council runs; the rebuild itself waits on this verdict.

## Testing

- Go: plan with the team variant and its price; the cap stops new cells; the team report parser (well formed, missing items,
  extra text around it); token counting over a fixture lead transcript plus teammate transcripts (a message counted once);
  the team row on a failed or timed-out lead; the go rule on each side of each threshold.
- The team runner's process launch is behind a function the tests replace, as `StartFunc` is today.
- A haiku smoke run of the team variant on a tiny case before the real pass, as 0b did (`ARC_BENCH_SMOKE=1`, above).
- The case builder's leak check fails on a planted hit.

## Left to the builder

- The team lead's prompt (ported from 0b's `v3/review.md` and `brainstorm.md`) and the report format it writes, parsed into a
  `council.Summary` the Judge reads.
- How the lead runs headless: the flags above, the environment, a wall-time limit.
- Token count over the lead and every `subagents/agent-*.jsonl` transcript, each assistant message once (transcript
  lines that share a `message.id` are one message). 0b's `council-bench/work/v3/tokens.sh` and `v3/run.sh` in the data dir
  show where the transcripts land.
