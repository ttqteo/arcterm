# Unbiased approach questions in brainstorming

Date: 2026-10-23. Status: design, from the brainstorm `.superpowers/brainstorm/brainstorm-like-orchestrator/`
(answers 2, 5, 14-17). Initiative `effort:07e27e1d-ba07-4868-89dd-c66da6331046`.

## Problem

For an approach question (how to build something, which design, which mechanism), the brainstorm should find
several approaches and give the pros and cons of each without bias (answer 5). Today, when the user answers
"double check", the agent usually comes back with a better approach: the first offer was under-checked, not caved
on (answer 2).

`skills/brainstorm/SKILL.md` already has a rule for this, **Check an approach before you offer it** (958d0e40,
2026-10-21). It is an instruction only. The agent that formed a favorite decides whether it ran the check and how
hard. The research behind this design (notes in the brainstorm) says a model can't be instructed out of anchoring,
a self-check without outside input rarely finds new ideas, and "are you sure?" flips answers often.

A benchmark on 12 real waveterm approach questions (3 repeats each, each followed by a literal "double check" turn)
measured it. Today's rule changed its pick on 10 of 36 double checks, and only 1 of those 10 moved toward what the
user actually chose. A wide list from the agent weighed by a blind Opus judge changed its pick on 1 of 36. Its pros
and cons cited code 33% of the time against 19%, for about $0.37 and a minute more per approach question. No
mechanism matched the user's past choices better than another. Full table:
`.superpowers/brainstorm/brainstorm-like-orchestrator/bench/report.txt`.

## Outcome

1. On an approach question, the brainstorming agent lists approaches and the facts it found, with no verdict. A fresh
   Opus session that never saw the agent's favorite adds what is missing, weighs, and writes the options, their
   pros and cons, the pick and the read (answer 14).
2. The pane says the read and the pick are the judge's, and shows how the judge got there: what it added and what
   it dropped, each drop with its reason (answer 15).
3. Only approach questions go to the judge. The agent decides which ones those are, by today's rule's scope (answer 16).
4. The judge runs the way the builder check's reviewer runs: Arc launches it, watches it, and hands its result back
   as one line (answer 17).
5. Claude and pi brainstorming agents behave the same. The judge itself always runs on claude with Opus.

## Flow

1. The agent reaches a question that picks an approach. It writes the question's `text`, `part` and `why`, plus its
   wide list of approaches, and no `options`, `pick` or `read`. It sets `working` to one line ("The judge is weighing
   7 approaches."), runs `wsh brainstorm judge <abs path of brainstorm.json>`, and ends its turn. The pane shows the
   working line, so the user never sees an unweighed question.
2. `wsh brainstorm judge` calls a new RPC with its own block and the file. The handler checks that the file's
   question holds a list and that no judge is already running for this tab. It writes the judge's record on the
   agent's tab and returns at once. A detached watcher launches the judge and watches it, as
   `BrainstormCheckCommand` does today (`pkg/wshrpc/wshserver/wshserver_brainstorm.go`).
3. Arc builds the judge's prompt from the file (D3). The judge checks in the code the facts the choice turns on, and
   writes its result to a report file. Then it runs `wsh jarvis complete --report <file>`, which ends its session.
4. The watcher sees the run done. It writes `Run.Report` beside `brainstorm.json` and sends the agent one line
   naming that file.
5. The agent copies the judge's options, pick, read and work record into `question` with a one-line script, never
   by retyping them. The list stays in the question for a rerun (D8). The agent clears `working` in the same write
   and ends its turn on the question.
6. The pane draws the judged question (D5).
7. Pushback against the options, or a typed "double check", goes back to a fresh judge from step 1 (D8).

A failed or lost judge: Arc sends a line with the reason. The agent then writes its own options with "Agent's
pick", and the work line says the judge failed and why (D6).

## Decisions

### D1. The agent lists, a blind judge weighs (answer 14)

The agent's list holds at least five distinct approaches. Each comes with the facts the agent found in the code
(files, functions, constraints that rule it in or out), and the list carries no pick, no ranking and no pros and
cons. The benchmark's proposer prompt (`bench/run.js`, `prompts.P`) is the starting point. That prompt asks for a
probability per approach. The agent may weigh approaches that way to widen the list, but writes no odds to the file
(D3).

The judge writes 2-4 options, each with `label`, `detail`, `pros` and `cons`, plus one pick and a `read` naming the
fact the pick rests on. It also records what it added and each listed approach it dropped, with a one-line reason.
Its prompt starts from the benchmark's (`prompts.J`) and today's rule:
- First ask what approach would beat every listed one, and add it if one does.
- Verify the facts the choice turns on, since the list's facts may be wrong.
- Ground every pro and con in a named fact.

Rejected: a Claude agent team per question. The one team-style debate run (q84) picked what 10 of the 13 benchmark
runs picked, at about $4 and 10 minutes against $0.69 and 2 minutes. A Sonnet judge held as well (1 of 36 flips),
but its pros and cons cited code less often (25%).

### D2. Which questions go to the judge (answer 16)

The agent decides, by the scope today's rule defines. A question that picks an approach (how to build, which design,
which mechanism) goes to the judge. Permissions, process steps and plain choices keep "Agent's pick". Builder-check
questions skip it.

Code can't make this call. Many of the user's 424 past questions with a recommendation were permissions or process
steps, and a keyword test misfiled approach questions both ways. Classifying a question needs no independence the
way weighing does. When the agent skips the judge on an approach question, the question still says "Agent's pick",
and the user can push back in the answer box.

### D3. What the judge sees (confirmed guess)

Arc's code builds the judge's prompt from `brainstorm.json`, never from the agent's words about it. The prompt holds:
- every answer the user gave and every part they confirmed;
- the question's text;
- the agent's list of approaches with their facts, in shuffled order and without the agent's odds.

The agent's `why`, `read`, guesses and notes stay out, so its favorite can't reach the judge. The judge works
read-only in the project folder.

A rerun (D8) also gets the judge's earlier options and pick, and the user's line as they typed it.

Builder question 2 asked how the judge is kept blind. The judge runs as a normal worker in the live checkout
(`--dangerously-skip-permissions`, `pkg/jarvis/runexec.go:51`), where `brainstorm.json` sits. The answer is to keep
the file free of the favorite:
- The agent writes the list with no odds, and Arc shuffles it.
- An approach question's `why` states facts and what is unknown, never a lean.
- The judge's prompt says not to read `.superpowers/`.

This is deliberately not enforced. A judge that goes looking can still read notes from earlier questions. If a
judge's transcript shows it reading `.superpowers/`, move the judge to a clean worktree at HEAD or to a deny rule on
its launch.

Rejected for now:
- A clean worktree. Facts about uncommitted code would fail to check out, and parallel sessions share this checkout.
- A deny rule. The worker spawn path passes no per-session flag today.

### D4. Delivery, like the builder check (answer 17)

The judge runs through the builder check's machinery:
- the launch (`orchestrate.LaunchJudgingSession`, a run in the project's channel with a `StageRole` of its own, so
  Usage counts it under that role);
- the watcher;
- the record on the agent's tab, re-armed at startup (`ResumeBuilderChecks`);
- the result file beside `brainstorm.json`, delivered as one line with `deliverAgentMessage`.

The judge runs on claude with Opus pinned, whatever runtime the brainstorming agent uses. That is answer 14's model.
It does not use the reviewer route the builder check reads. One judge runs at a time per brainstorm. Field names,
the role name, the record's keys and the line's wording are the builder's.

Agent's call: the judge's run is hidden the way a builder-check run is: left out of the project's run lists,
`wsh runs list`, attention items and the session tree's run rows, and its done step makes no seal. This design first
accepted a judge run per approach question in the run list, but the builder check's machinery already hides its
runs (`jarvis.IsBuilderCheck` and its five callers), and Usage still counts the run under its role. The brainstorm
pane is the judge's only face.

Accepted cost: one more agent turn to copy the result in.

Agent's call: the judge's session nests under the brainstorming agent in the agent tree, as the builder check's
reviewer does since 855af287 (run 67ec2847), keyed on the run the tab's judge record names. Its row is titled
"Judge" and reads the judge record's state, as the reviewer's row reads the check record's.

Rejected:
- The agent waits on a one-shot judge through `pkg/consult`. Usage skips headless passes (`usagestats.go`), the
  consult claude spec passes no tool flags (`consult.go:74`), and nothing survives a restart.
- Arc writes the question into `brainstorm.json` itself. That breaks the rule that the agent is the file's only
  writer.

### D5. What the pane shows (answer 15)

The design is `.superpowers/design/brainstorm-judge/project/Main.dc.html`. On a question the judge wrote:
- The read is labeled "Judge's read" and the pick "Judge's pick", in place of "Agent's".
- One line under the options says how the judge got there: how many approaches the agent listed, what it added,
  and how many it dropped.
- A collapsed list names each dropped approach with the judge's one-line reason. The board shows it opened; it
  starts closed.

A question without the judge's record draws as today. The pane reads the record in `brainstormmodel.ts`
(`parseQuestion`) and draws it in `brainstormui.tsx` (`QuestionAnswers`).

### D6. A failed or lost judge

The watcher fails the judge the way `tickBuilderCheck` fails a check: a run done with an empty report, or a session
`JudgingSessionLost` judges lost. A result that fails Arc's check (D9) fails it too. Arc then sends the agent a line
with the reason. The agent writes the question with its own options and "Agent's pick", and the work line says the
judge failed and why. The user still gets a question, and can see that the judge did not weigh it.

### D7. The skill

In `skills/brainstorm/SKILL.md`, the wide list and `wsh brainstorm judge` replace **Check an approach before you
offer it** for approach questions. The lines table gets a row for the judge's result line and one for its failure
line. The copy is a one-line script, never a retyped question. `task sync:claudemod` carries the skill into the arc
mod; edit `skills/`, never the copy. `docs/agents/brainstorm.md` gets the new lines.

### D8. Pushback and "double check" on a judged question (builder question 1)

Two kinds of line go back to a fresh judge, launched as in D4:
- pushback against the options;
- a typed "double check".

The agent adds any alternative the user names to the list, then runs `wsh brainstorm judge` again with the user's
line. The judge's prompt holds the list, its own earlier options and pick, and that line (D3). A plain question back
(what something means) is not pushback: the agent answers it itself. The skill's **When the line is not an answer**
rule, which today reruns **Check an approach before you offer it**, says this for judged questions.

The benchmark measured a different path: it resumed the judge's own session for the double check (1 flip in 36). A
fresh judge given its earlier result is unmeasured. Switching to a resume later (`ResumeRunWorker` in
`pkg/jarvis/runexec.go` already reopens a worker's session with a new first turn) changes only the launch, not the
prompt or the pane.

Rejected: the agent answering pushback itself. That is today's rule, which changed its pick on 10 of 36 double
checks, and the user's alternative would be weighed by the agent that wrote the odds.

### D9. The shapes the parts agree on (agent's calls)

The Go side, the pane and the skill are built side by side, so these are fixed here. Names not listed below stay
the builder's.

**In `brainstorm.json`.** The agent's list is `question.approaches`, an array of
`{ "name", "description", "facts": [] }`: no odds, no pick, no pros or cons. A judged question also holds
`question.judge`, Arc's account of the judge's work:
- a weighed question: `{ "added": ["<name>", ...], "dropped": [{ "name", "reason" }, ...] }`;
- a failed judge (D6): `{ "failed": "<reason>" }`, with the agent's own `options` and `read`.

The pane draws "Judge's read", "Judge's pick" and the work line only for a weighed record. A failed record keeps
"Agent's read" and "Agent's pick" and draws the work line as the failure and its reason. How many approaches the
agent listed is `approaches.length`, never a stored count. A question with no `judge` draws as today. When the
user answers a judged question, the agent copies `judge` into the history entry beside `options`, and the
history row reads "Judge's pick" instead of "Agent's pick".

**Arc's checks on `wsh brainstorm judge`.** The handler refuses a file whose `question` is missing or holds fewer
than five approaches (D1's floor), and a tab whose judge is already running. The command's error is the refusal.

**The judge's result.** The judge writes one JSON object to its report file:
`{ "options": [{ "label", "detail", "pros", "cons", "pick" }], "read", "added", "dropped" }`. Arc checks it before
delivery: 2-4 options, each with a label and a detail, exactly one with `"pick": true`, a non-empty `read`, every
dropped entry with a name and a reason. A result that fails the check fails the judge like an empty report (D6),
with the check's error as the reason. A good one is written to `<topic dir>/judge.json` in the shape the agent
merges into `question` as is: `{ "options", "read", "judge": { "added", "dropped" } }`. The agent's copy is then
one `Object.assign` of that file onto `question`, with `working` set to `null` in the same write.

**The lines.** `brainstorm: judged <abs path of judge.json>` on a weighed question, and
`brainstorm: judge failed: <reason>` on a failed or lost judge. Unlike the builder check, a failure is sent as a
line, since the pane has no judge card to show it on.

**The command.** `wsh brainstorm judge <brainstorm.json> [--line <text>]`, where `--line` is the user's pushback or
"double check" as they typed it, for a rerun (D8). On a rerun Arc reads the judge's earlier options and pick from
`question.options` when `question.judge` is a weighed record.

**Server side.** The run's `StageRole` is `brainstorm-judge`. The judge's route is a fixed
`{ Runtime: "claude", Model: "opus" }`. Its tab record is five `brainstorm:judge*` keys mirroring the five
`brainstorm:check*` keys (`judgestate`, `judgets`, `judgerun`, `judgechannel`, `judgereason`), written only by the
server. The pure half (prompt, result check, paths, lines, verdict) lives in `pkg/brainstormcheck` beside the
builder check's, sharing its `Decide`. The watcher, the launch and the startup re-arm are the builder check's, made
to serve both rather than copied.

## Out of scope

- Agent teams inside a brainstorm. A Claude team stays something the user starts on demand (10-21 decision).
- A model or route setting for the judge. It is claude with Opus.
- Judging builder-check questions; they already come from a separate reviewer.

## Verification

- Go: the pure half beside `pkg/brainstormcheck`'s tests: the prompt Arc builds from a file (shuffled, no odds, no
  why or read; a rerun's earlier options, pick and line), the result check and the shape it writes, the result path,
  the lines, and `Decide` for done, empty, malformed and lost. The handler's refusals (no question, fewer than five
  approaches, a judge already running), delivery of both lines, and the startup re-arm, with the launch stubbed. A
  judge's run is hidden wherever a builder-check run is.
- Vitest: `brainstormmodel.test.ts` parses a weighed and a failed judge record, on the question and on a history
  entry, and a question without one parses as today. The agent tree nests a judge's session under the agent whose
  judge record names its run.
- CDP: a scenario opens a judged question in the pane and shows "Judge's read", "Judge's pick", the work line, and
  the dropped list opened. A second shows the judge's session nested under the brainstorming agent.
- A live judge can't run in a scenario: it costs a real session and about a minute. An end-to-end check in a real
  brainstorm goes in `docs/deferred.md` if the run can't do it.
