# Brainstorm skill bench

The council bench (`wsh council bench`, `pkg/council/bench`) measures the council, an agent team and a solo agent on
the same cases and scores them against the same keys. Arc's own brainstorm skill (`skills/brainstorm`, run beside
`superpowers:brainstorming`) is not measured anywhere. This adds it as a fourth variant, `brainstorm`, so its design
sits in the same table as the council's report.

Brainstormed in `.superpowers/brainstorm/brainstorm-skill-bench/brainstorm.json` (2026-11-10).

## What is measured

The quality of the design the skill produces, judged by recall against the case's key, comparable with the council,
team and solo columns. The person in the loop is simulated without the key, so recall is the skill's own and the key
never leaks through an answer.

Only Brainstorm-mode cases run the variant (today `launcher-declutter` and `run-pause`; the case file is
`<data dir>/council-bench/cases.json`). A Review case skips it.

## The simulated person

The fake person always takes the recommended answer:

- An open question with `options`: it sends the `label` of the option with `pick: true`, whether the agent's or the
  judge's pick.
- An open question with no `options`: it sends `brainstorm: guess`.

It adds nothing beyond what the council gets (the case's feature, question and files: `Case.Feature`, `Question`,
`Files`, `pkg/council/bench/cases.go`).

## How the bench drives the skill

`claude -p` in a copy of the case's project, looped with `claude -p --resume <session>`. A fake `wsh` first on `PATH`
catches the skill's `wsh brainstorm judge` / `wsh brainstorm check` calls, and the driver runs the judge and the
builder check itself, then sends the line Arc would send.

Why: the skill is written for an agent in an Arc tab. Its judge and builder check go through wavesrv and are tied to a
block (`cmd/wsh/cmd/wshcmd-brainstorm.go` resolves the block; `pkg/wshrpc/wshserver/wshserver_brainstorm.go`
`startBrainstormSession` launches an orchestrate judging session and answers with `deliverAgentMessage`). The prompt
builders are pure, though: `brainstormcheck.ReadJudgeInput` / `JudgePrompt` / `JudgeFileBytes` / `JudgedLine` /
`JudgeFailedLine` (`pkg/brainstormcheck/judge.go`) and `brainstormcheck.Prompt` / `ReportPath` / `Line`
(`pkg/brainstormcheck/brainstormcheck.go`), so the driver reuses them and the agent runs the skill unchanged.

### The driver loop

A pure function `nextLine(file state, recorded requests)` returns the next line to send, or that the run is finished
or broken. After every turn the driver reads `brainstorm.json` and the fake wsh's `requests.jsonl`, and takes the first
that applies:

1. A judge request is recorded: run the judge (`ReadJudgeInput`, `JudgePrompt`, one Opus `claude -p` session in the
   project copy as builder question 4 below says, `JudgeFileBytes` writes `judge.json` beside `brainstorm.json`) and
   send `brainstorm: judged <path>`; on a judge failure send `brainstorm: judge failed: <reason>`. A request carrying
   `--line` passes it to `JudgePrompt`.
2. A check request is recorded: run the reviewer (`brainstormcheck.Prompt(spec, report)`, one Opus `claude -p`
   session, the same way) and send `brainstorm: builder questions <path>`.
3. A question is open with `options`: send its picked `label`. Open with no `options`: send `brainstorm: guess`.
4. A part carries `was`: send `brainstorm: keep every change`.
5. `done` is true, `check` is null and a decision is still a `guess`: send `brainstorm: confirm every guess`.
6. `done` is true, `check` is null, every decision is `yours`: score the **done** mark, then send `brainstorm: check`.
7. `check.yours` holds an entry with no `a`: send `brainstorm: builder decide`.
8. The builder check is sorted and nothing is left: score the **final** mark, finished.

*Agent's call (builder question 5):* step 5 applies whenever no question is open and a decision is a `guess`,
during the builder check too (a `builder decide` can leave one), and step 8 scores only once every decision is
`yours`. A turn that ends on a valid file where no step applies (`question` null with `done` false; `working` set with
no request; `done` true with an `asked` or `open` part; `options` with no `pick`) gets one reminder line naming what is
missing under arc:brainstorm's rules. A run gets at most 3 reminders; the 4th stuck turn ends it `failed`, the last
stuck state as its reason.

A request is consumed once handled. The first turn's prompt asks the agent to brainstorm, with superpowers:brainstorming
inside Arc, the case's feature and question, reading the case's files first, and says the answers will come as the
person's. It never mentions a benchmark or who answers.

### The fake wsh

The bench writes a POSIX `sh` script named `wsh` into a temp bin folder (Claude's Bash tool on Windows is Git Bash).
For `brainstorm judge <file> [--line <text>]` and `brainstorm check <file>` it appends one JSON line to
`requests.jsonl` and prints `judge started` / `builder check started`, as the real wsh does. Every other subcommand
(`ui reveal`, ...) exits 0 and prints nothing. The folder goes first on `PATH`.

The process environment drops Wave's variables (`withoutWaveEnv`, `pkg/council/bench/team.go`) and `ARC_RUN_AGENT`
(set, it would turn the skill off). It also drops the Claude Code session variables a `go run` from a Claude shell
inherits: `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT` and `CLAUDE_CODE_PLUGIN_DIRS` (which
`install-agent-hooks` points at `~/.arc/claude-mod`, and which `--setting-sources` does not stop, so the installed
`arc:brainstorm` would load beside the bench's). Auth and provider variables stay. The arc mod's hooks call `~/.arc/bin/wsh` by absolute path, not through `PATH`;
without the Wave environment they do nothing.

### Launch and limits

- The case's project is copied to a temp folder with `copyProject`, as the team variant does.
- First turn: `claude -p --model opus --output-format json`; later turns `claude -p --resume <session_id>`, same flags.
  No tool is disabled: the skill needs Bash (`node -e`, `wsh`) and Write. Permissions: `--permission-mode
  bypassPermissions`, safe in the copy.
- Limits: 60 turns and 60 minutes. Past either, the row's state is `timed-out`. A failed turn, or a `brainstorm.json`
  that is missing or invalid after a turn, gets one reminder line asking the agent to rewrite the file per arc:brainstorm;
  a second failure ends the run as `failed`.
- Tokens: the sum over turns of the result's `modelUsage` (`leadResult.modelUsageTotal`), plus the driver's judge and
  reviewer calls.
- Model: the brainstorm agent runs **opus**; the skill's judge and the builder reviewer run Opus as in production.
- **Which skill text (Agent's call, builder question 1).** The agent runs the brainstorm skill the running binary
  embeds (`skills/skills.go`): the bench writes it into a temp plugin folder passed with `--plugin-dir`, and keeps the
  installed arc mod's `arc:brainstorm` out. So `go run` scores the checkout's skill and `wsh council bench` the
  installed app's. `superpowers:brainstorming` comes from the installed plugin; its version goes on the row. The
  builder confirms on one real run which copy loaded.
- **The skill's judge and reviewer (Agent's call, builder question 4).** Each is `claude -p --model opus` in the
  project copy with Read, Grep, Glob, Write and Bash, the fake wsh first on `PATH` (it takes
  `jarvis complete --report` as exit 0). The driver reads `REPORT_PATH`: `judge.json` through `JudgeFileBytes`, the
  reviewer's report as written. The judge checks facts in the code, as in production.
- **Key reads (Agent's call, builder question 7).** As for the team, a run whose tool calls name the `council-bench`
  folder (`readTranscripts`, `KeyReads`, `pkg/council/bench/teamtokens.go`) ends `failed` with that reason and is not
  scored.

## Scoring

- Every decision part (a part without `"kind": "note"`) is one item: its title and body, in file order. The bench
  judge (`pkg/council/bench/judge.go`) scores all of them (`key:Kn`, `valid`, `wrong`); the `brainstorm` variant is
  not cut at `TopBrainstorm`. A design is one answer, not a menu; the decision count and `wrong` show a design that
  pads. *Agent's call (builder question 6):* the part with id `builder` ("Left to the builder") is neither judged nor
  counted.
- Two marks: when `done` first holds with every decision `yours` (step 6), and after the builder check (step 8). The
  final mark is the column compared with the council; the done mark shows what the builder check adds. A judge call
  costs ~8k tokens (`judgetokens` in `council-bench.jsonl`).

## Result row

A `run` line in `council-bench.jsonl` (`CouncilBenchResult`, `pkg/council/bench/results.go`):

- `variant: "brainstorm"`, `council`: the agent's session id, `messages`: turns.
- `recall`, `matches`, `wrong`: the final mark.
- New fields: `decisions` (decision parts at the final mark), `recall_done` and `matches_done` (the done mark),
  `questions` (answered questions, counted from `history`).
- `judgetokens` sums both bench judge calls; the skill's judge and the reviewer count in `tokens`.
- `variantTokens["brainstorm"] = 5_000_000`, to re-measure after the first bench.
- *Agent's call (builder question 2):* `council.HarnessVersion` does **not** bump: it names the council's prompts
  (`pkg/council/prompts.go`), a bump would move every council and team row to an old version (`Decide` counts only the
  current one, `decision.go:120`) and tell users the council changed (`repeat.go`). A `brainstorm` row carries a new
  `skill` field instead: the first 8 hex of the sha256 of the SKILL.md it ran, plus the superpowers version.
  `Summarize` groups brainstorm rows by harness and `skill`, so two skill texts never add up in one row.
- `Decide` (`decision.go`) stays as it is and still decides only the team.

### The results table, split by mode (builder question 3, the person's answer)

`Summarize` today sums each variant over every case (`results.go:205`), so a council row mixes Review and Brainstorm
cases and cannot sit beside a `brainstorm` row that holds only Brainstorm cases. It groups by harness, **mode** and
variant instead:

- Every new `run` line carries `mode` (the case's). An older line has none; `Summarize` takes a case id → mode map
  (from `LoadCases`) and fills it from there, and a line whose case is gone groups under an empty mode.
- `CouncilBenchRow` gains `Mode` (it goes over the wire in `wshrpctypes_council.go`: run `task generate`).
- `wsh council bench results` prints a Review section and a Brainstorm section; in Brainstorm, council, team, solo
  and brainstorm stand side by side over the same cases. A note under the table says council items are cut at 3 while
  brainstorm scores every decision.

## Running it

- A bare `wsh council bench` runs the variant on every Brainstorm case (`AllVariants` gains `brainstorm`; `Plan` skips
  it on a Review case and `--variant brainstorm` names it). It adds 5M per Brainstorm case per run: 10M for one run of
  today's two cases, 20M for a bare bench's default two runs. Council and team already cost ~13.3M per case per run, so
  a bare bench over every case can reach the 50M cap first; the cap then leaves the later items unrun, as it does
  today. `Plan` orders run 1 of every case before run 2, and `Run` checks the cap before every item, so the cap can
  fall between one case's variants: a case's council then has a row for that run and its team or brainstorm does not,
  and the team verdict for that case reads incomplete. A bare bench over today's cases is estimated at ~73M against
  the 50M cap, so a bare bench's run 2 is likely cut this way. To measure the skill alone, name it:
  `wsh council bench --variant brainstorm`, or the `go run` below.
- `go run ./cmd/council-bench-brainstorm --case <id> [--runs N] [--data-dir <path>]` runs the same code straight from
  the checkout, reading the installed app's cases and appending to the same results file (data dir defaults as
  `scripts/council-bench-cases.mjs` documents: `%LOCALAPPDATA%\dev.arc.app\data` on Windows,
  `~/Library/Application Support/dev.arc.app` on a Mac). It runs as soon as the code is merged; `wsh council bench`
  gets the variant once the app is rebuilt and installed.

## Tests

- `nextLine`: table test, one case per branch above.
- The fake wsh: run for real in a test (needs `sh`), checking `requests.jsonl` and what it prints.
- `runBrainstorm` with the existing seams `startLead` and `runClaude` faked: a script of two questions, one approach
  question through the judge, done, check, one builder question, finished, producing the right row.
- `Plan` skips `brainstorm` on a Review case; a results row with the new fields round-trips, and an old row reads.
- One real run on `run-pause` is a hand check (`docs/hand-checks.md`).

## Left to the builder

The file split inside `pkg/council/bench` (e.g. `brainstorm.go`, `brainstormdriver.go`, `fakewsh.go`); whether the
fake wsh is an embedded string or `go:embed`; the format of the new columns in the text table of
`wsh council bench results`; the first prompt's wording, as long as it never mentions a benchmark.

## Calls made while planning (autonomous run, 2026-11-10)

Nobody was at the cockpit when this was planned; these are the planner's calls on what the spec leaves open, each with
its reason.

1. **The driver finds `brainstorm.json` itself.** After each turn it looks under `<copy>/.superpowers/brainstorm/*/`
   and takes the one `brainstorm.json` there (several: the most recently written). The path a recorded request names
   is only logged. Why: on Windows the agent's Bash is Git Bash and may pass `/c/...` paths; the copy holds one
   brainstorm, so translating paths buys nothing.
2. **`nextLine` takes the first pending request's command, not the request.** Its signature is
   `nextStep(s brainstormState, pending string) step`, where `pending` is `""`, `"judge"` or `"check"`; the driver
   handles the request's `--line` and consumes it. Why: it keeps the pure function free of the fake wsh's types, so
   the two are built side by side.
3. **The bench judge scores both marks at the end.** At step 6 the driver snapshots the decision items; at step 8 it
   judges the snapshot and the final items (two bench judge calls). A run that fails between them spends no judge
   tokens. Either judge failing leaves the row `failed` with no scores, as `judgeRow` does for every variant.
4. **One judge path for every variant.** `JudgeDesign(ctx, c, items)` in `pkg/council/bench/judge.go` judges every
   item it is given, with no cut and no Kept list, through the same prompt and parsing code as `Judge`.
5. **`pkg/brainstormcheck` becomes a leaf package, and `judgeFileBytes` becomes `JudgeFileBytes`.** Today it imports
   `pkg/jarvis` and `pkg/waveobj` for its watcher half alone (`Action`, `Decide`, `DecideJudge`, which judge a
   `waveobj.Run`), and `jarvis` → `wshrpc` → `council/bench`: the bench importing it would be an import cycle (plan
   review, round 1). The watcher half moves to its one user, `pkg/wshrpc/wshserver`, with its tests; brainstormcheck
   keeps the pure prompt and line builders and imports neither. `judgeFileBytes` is exported (renamed, not wrapped) so
   both the server's `DecideJudge` and the bench use it.
6. **The skill's judge and the builder reviewer run through `startLead`**, the same `claude -p` launch the agent's
   turns use (project copy, fake wsh first on `PATH`, `--disallowedTools` naming every tool but Read, Grep, Glob,
   Write and Bash). Their `modelUsage` counts in `tokens`. The report path is a fresh temp file, as in production.
   A judge whose launch fails, writes no report, or writes a report `JudgeFileBytes` refuses gets
   `JudgeFailedLine(<reason>)`. So does a judge request `ReadJudgeInput` refuses, with its error as the reason (the real
   `wsh brainstorm judge` fails the same way). A check request whose spec is missing gets a reminder line naming the
   path, which counts toward the 3 reminders: the real `wsh brainstorm check` refuses it.
7. **How the skill text is pinned.** Every `claude` launch gets `--setting-sources project,local`, so the user's
   settings stay out: the installed arc mod (listed in their `env.CLAUDE_CODE_PLUGIN_DIRS`), the hooks it installs,
   and the user's enabled plugins. It also gets two `--plugin-dir`s: a temp plugin named `arc` holding the embedded
   `skills/brainstorm` tree (so the skill is `arc:brainstorm`, the name its own text uses), and the installed
   superpowers plugin. The bench finds superpowers' `installPath` and `version` in
   `<claude config dir>/plugins/installed_plugins.json` (the key whose name starts with `superpowers@`; several
   installs: the last). No superpowers install is a failed row naming that.
8. **`skill` is `<8 hex> superpowers@<version>`**, e.g. `3f9a01bc superpowers@4.0.3`: the sha256 of the embedded
   `SKILL.md`, then the version found in step 7.
9. **Reminders.** A missing or invalid file, or a failed turn, gets one reminder; a second one **in a row** ends the
   run `failed` (a valid turn in between resets it), since an agent in a 40-turn run may slip twice far apart. Stuck
   turns (no step applies) count over the whole run, as the spec says: the 4th ends it.
10. **The first turn chooses the session id** (`--session-id <uuid>`) and later turns pass `--resume <that id>`, so a
    run that never prints a result still has a transcript for the key-read check.
11. **New row fields' JSON names follow the spec** (`recall_done`, `matches_done`, `decisions`, `questions`, `skill`,
    `mode`), all `omitempty`. `Summarize(results, modes)` takes the case id → mode map; `CouncilBenchRow` gains `mode`,
    `skill`, and `recall_done`, `decisions` and `questions`, each summed over the row's scored runs, so the done mark
    and a padded design reach the table: the Brainstorm section shows them as columns.
12. **`go run ./cmd/council-bench-brainstorm` goes through `bench.Run`** with `Options{Cases: [id], Variants:
    ["brainstorm"], Runs: N}` and `Funcs{Judge: bench.Judge, Brainstorm: bench.RunBrainstorm}`, so the tool and
    `wsh council bench` share one runner and one row builder.
