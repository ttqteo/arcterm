# Using the orchestrator

How to run work through Jarvis's orchestrator as it behaves after the 2026-09-14 redesign and the Agent
surface follow-ups. Every screenshot is from the dev app on 2026-09-17 or 18, taken while running the flow it
illustrates: a sandbox repo built to break on purpose (`orch-guide-demo`), a Quick run in the same repo, and
the backlog-cleanup initiative run through a goal-led orchestrator.

The design lives in `docs/superpowers/specs/2026-09-14-orchestrator-redesign-design.md`.

The 2026-09-25 findings fixes changed how a run starts and ends, and the screenshots predate them. An engine
run now lands on its own branch by default ([Where a run lands](#2-where-a-run-lands)). A reviewer checks the
plan before any worker starts ([The plan review](#the-plan-review)). A final stage judges the combined result
before the run is done ([The final stage](#the-final-stage)). The engine merges the branch back when the run
completes ([Landing back](#landing-back)).

## Pick a flow

| You have | Use | What runs |
|---|---|---|
| One small change you can describe in a sentence | **Quick** | One fresh worker. No lead, no plan. It stops and asks if the goal turns out bigger. |
| A goal that still needs design decisions | **Orchestrator → A goal** | A lead brainstorms it with you in its terminal, then either does it itself or hands the engine a plan. |
| A plan already written in the plan format | **Orchestrator → A plan file** | The engine runs the plan at once. A lead is launched only when something needs judgment. |

Everything else in this guide is how to watch those three and what to do when they need you.

**The division of labor.** Code does the mechanics: scheduling, worktrees, Setup, merges, Verify, the final
stage's commands, retries, and merging the run back. Fresh reviewer sessions judge the plan, each task and the
combined result. The lead only judges what they turn up: questions, failures, conflicts, a failed Verify, a
failed review, a failed final stage. You get what the lead cannot or should not decide.

---

## Before you start

### 1. Register the project

The New dialog lists projects from `projects.json`, not from anything you have talked about in Jarvis. Open the
project switcher in the app bar → **+ New project**, give it a name and the repo's local path, and
**Create project**. The command palette's "New project" opens the same modal.

![New project modal](images/orchestrator-guide/01-new-project.png)

### 2. Where a run lands

An orchestrator run lands on its own branch by default. At launch it creates `wave/<runId>` in a tree at
`.waveterm/worktrees/<runId>`, and records the branch the checkout is on as the run's base. Its lead works in
that tree, its lanes squash-merge there, and Verify runs there. The plan's Setup runs there once when the plan is
submitted, or the project's `.arc/setup` when the plan has no Setup line. For this repo that is
`node scripts/worktree-junctions.mjs prepare`, which junctions `node_modules`, `src-tauri/target` and
`dist/bin` from the main checkout so tests run. The checkout does not move, and a dirty index there does not
hold the run's merges. When the run completes, the engine merges the branch back into the base itself (see
[Landing back](#landing-back)).

To land in the checkout instead, set **Runs land on → Project checkout** in the profile (global, or per project),
or pass `wsh runs start --landing checkout`. The flag wins over the profile, and an empty profile means branch.
The lanes then merge into whatever branch the checkout has checked out, the merge path refuses a dirty index, and
there is nothing to merge back. A run with no base (an unborn repo, or a directory that is not a git repository)
lands in the checkout either way. A run started on a detached HEAD gets its branch, but has no base branch to
merge into, so its land-back is held.

On a landed run the engine removes the tree and deletes `wave/<runId>` itself. A cancelled run, or one whose land
is held, keeps both. In this repo, remove them with `task worktree:cleanup -- .waveterm/worktrees/<runId>`:
Setup junctioned `node_modules`, `src-tauri/target` and `dist/bin` into the tree, and a plain
`git worktree remove` can follow those junctions and delete the main checkout's copies. It deletes the branch
only once merged; `git branch -D wave/<runId>` drops an unmerged one. In a repo whose Setup makes no junctions,
`git worktree remove .waveterm/worktrees/<runId>` and `git branch -D wave/<runId>` do the same.

For this repo there is a second reason to keep the branch default: the dev app serves the frontend from the main
checkout, so a merge landing there triggers HMR reloads mid-run.

To have a run start from, and merge back into, a branch you name, give it its own worktree by hand and register
*that* path as the project:

```bash
git worktree add -b backlog-cleanup .worktrees/backlog-cleanup main
cd .worktrees/backlog-cleanup && task worktree:prepare
```

### 3. Know which app you are driving

The packaged app and the dev app keep separate stores. A run started in the dev app, its efforts and its
`wsh` calls all live in the dev store; `wsh` in a terminal of the packaged app talks to the packaged store.
Terminals the run spawns (the lead and every worker) get a `wsh` bound to the app that spawned them, so the
run's own commands always reach the right store.

### 4. Routes

Leads and workers run on **Claude Code** or **pi** only. A route is a harness plus an exact model; there are
no tiers. An orchestrator run has three routes: the lead's, the workers setting, and the reviewer route. The
launcher picks each (**Lead**, **Workers**, **Reviewers**), and the profile's run defaults fill them in.

**The workers setting** is one of:

- **Same as lead**, the default: every task runs on the lead's route.
- **A route**: every task runs on it.
- **Reviewer picks**: each task runs on its plan's `**Model:**` line when it has one
  ([The plan format](#the-plan-format)), else on the model the plan reviewer picks for it, `sonnet` or the lead's
  ([Model picks](#model-picks)). Reviewer picks and a route are one setting, so a run never has both; the server
  refuses one that sends both.

The engine resolves each task's route with one rule (`effectiveTaskRoute`, `pkg/orchestrate/modelroute.go`),
taking the first rung that applies:

1. A route you set on the task ([Model picks](#model-picks)), an escalation, or a pin in a dag submitted as JSON.
2. The plan's Model line or the reviewer's pick, only when the run is on Reviewer picks.
3. The workers route, when the run has one.
4. The lead's route.

So on Same as lead or a route, Model lines and reviewer picks are ignored, and a run that never opts in runs
exactly as before. A reviewer pick of the lead's model stores no pin, so it falls to rung 4.

**The reviewer route** is where the engine's judging sessions run: each task's reviewer, the plan reviewer and
the final verifier. It is the lead's route unless you pick one. Only you set it (the launcher, the profile,
`wsh runs start`); a lead has no command that writes it.

A pi lead needs the `@juicesharp/rpiv-ask-user-question` package (so its questions reach the cockpit) and the
superpowers package installed into pi itself (the lead plans with `brainstorming` and `writing-plans`).

---

## Flow 1: Quick

Press `⌘⇧R` (or `r` on the Jarvis Brief), or **+ New** in the app bar: the New dialog opens on a run row (**+ New**
opens it on whatever you picked last). Press **Quick run**'s number in the Start column, `Tab` to the project and pick it, write
the goal, then **Start run** (`⌘⏎`).

![+ Run with the Quick shape](images/orchestrator-guide/02-quick-modal.png)

The Brief opens the run's sheet. A Quick run has no task graph; its worker's transcript is the whole run,
so **Open in Agent ↗** is where you watch it.

![A Quick run executing](images/orchestrator-guide/03-quick-running.png)

The worker is told that if the goal turns out to be more than one change or needs a design decision, it
should stop and ask instead of pushing on. That question arrives in **Waiting on you** like any other.
Settings are fixed for a Quick run: there is no scheduler to reconfigure.

This run appended one line to `README.md` and committed it; the sheet went to **Done** with its evidence
sealed.

---

## Flow 2: Orchestrator from a goal

### Configure the run

![+ Run configured for a goal-led orchestrator](images/orchestrator-guide/04-goal-modal.png)

| Control | What it decides |
|---|---|
| **Project** | Where the lead works and where lanes merge. Tab to the column and type to filter, or press its number. |
| **Start → Orchestrate** | A lead plus the engine. |
| **Start from → A goal** | "A lead works the goal with you in its terminal, then hands the engine a plan." |
| **Workers at once** | How many lanes run at once, 1-8, default 3. Lowerable on a live run. |
| **Lead model** | The lead's route. It brainstorms, writes the spec and plan, and later judges wakes, so this is the model whose judgment a retry cannot recover. |
| **Workers model** | The workers setting ([Routes](#4-routes)): Same as lead, Reviewer picks, or a route. Changeable on a live run for tasks not yet dispatched. |
| **Reviewers model** | The reviewer route: task reviews, the plan review and the final verify. "Same as lead" unless set. |
| **Goal** | What the lead starts from. |

**RAM.** The chip left of the usage donuts in the top bar reads the machine's free RAM (`1.3 GB free`). Its
tooltip gives free of total RAM, a typical worker's size, the heaviest job's size, how many workers run now and
how many more fit. A worker spends most of its life small (idle or asking ~330 MB, a vitest run ~0.9 GB) and
spikes only in a heavy job (`tsc` ~3 GB for about a minute), and several workers rarely spike at once. So each
worker counts at its typical size (the mean of its process-tree readings, averaged over the live workers and the
last 10 finished ones; 1 GB until one has been measured), and one heavy job's extra (the highest peak; 3 GB until
measured) is held back once: `more = (free − growth room of live workers − (heavy − typical)) ÷ typical`, rounded
down. When a width you pick in New run, or on a live run's **Adjust → Worker parallelism**, adds more workers than
that, the number turns amber with a ⚠ whose tooltip says how many fit, and Jarvis says so once. It only warns; the
run starts as picked. When not one more fits, Jarvis wears its tired look with a sweat drop. The chip turns amber
with a ⚠ only when free RAM drops below 512 MB, where `wsh memgate` starts holding heavy commands.

The route picker filters by harness (**All / Pi / Claude Code**) and accepts a custom model id:

![The Lead model picker filtered to Claude Code](images/orchestrator-guide/05-route-picker.png)

For the backlog run: lead **Claude Code · opus**, workers **Claude Code · sonnet**, parallelism 3.

### The lead brainstorms with you

**Start run** creates the run and opens its sheet at **Planning** ("the lead is writing the plan"). Nothing is
dispatched until the lead submits a plan.

![A goal run in Planning](images/orchestrator-guide/06-goal-planning.png)

**Open lead ↗** takes you to the lead on the Agent surface. The lead runs `superpowers:brainstorming` against
the real code in its tree (the run's branch, or the checkout). The details rail's **Run** section reads
"planning · no plan submitted yet" until it submits.

![The lead brainstorming in its terminal](images/orchestrator-guide/07-lead-terminal.png)

### Answering the lead

The lead is told to put every question and approval through its ask tool, so each one lands in **Waiting
on you** on the Brief instead of scrolling past in a terminal. The Jarvis nav icon carries the count.

![A lead's question in Waiting on you, with the initiative it is working on expanded below](images/orchestrator-guide/08-brief-waiting.png)

**Review** expands the waiting list; clicking the row opens the run's sheet with the question as a
**Clarifying question** card:

![A lead's clarifying question on the run sheet](images/orchestrator-guide/09-lead-question-card.png)

- **Pick an option:** click it. A single-question, single-select card sends on the click. Ignore the card's
  "Press 1–9" hint for a lead's question: the sheet's digit and Enter keys only reach a worker asking from
  inside a plan task, and a planning lead is not one.
- **Answer in your own words:** do it in the lead's terminal on the Agent surface (the harness's own picker
  has a free-text choice). The card's "or type your own answer…" field has no send action on the Brief
  sheet today; see [Rough edges](#rough-edges-found-while-writing-this).
- **✕** dismisses the question.

**The review dialog.** The lead's **Spec review**, and its round-2 **Plan review**
([The plan review](#the-plan-review)), open as one dialog over whatever surface you are on: the document
rendered on the left, the decisions (or findings) it asks you to accept on the right, and **Approve** (the
plan's is **Accept all and proceed**, `Ctrl Enter`) or **Request changes** at the bottom. Request changes
takes a note and sends it to the lead as your answer. Select text in the document to quote it: a note field
opens under the selection (`Enter` adds, `Esc` drops), the passage stays highlighted, and the notes collect
under the decisions, where a click reopens one and **✕** removes it. Both buttons then carry them (**Approve
with N notes**, **Request changes · N notes**, whose message becomes optional), and the lead gets one answer:
your message or the approve label, then each passage on a `> ` line with its note under it, in document order.
Once sent, the notes lock. Everywhere else the ask shows as a one-line summary with
a **Review** button: the Cockpit lead card, the Brief's card, the run sheet. On the Agent surface the lead's
tree row carries a `review` tag, the lead's header an amber `Spec review` / `Plan review` chip, and `r` opens
it on the focused lead. It opens by itself only once per ask, when you focus the lead itself on the Agent
surface and are not typing in its terminal; never from another agent or another surface. `Esc` hides it and
leaves the question open, and it closes once the lead picks up your answer.

Push back when an option rests on something you know is wrong. On the backlog run the lead's first question
recommended deleting four channel RPCs; the answer "delete them, but grep `scripts/` for callers first" made
it find that `deletechannel` is the teardown of the CDP scenarios, and it came back with a narrower option.

### What the lead does with the goal

The brainstorming skill classifies the goal. The lead states the path it takes and proceeds, asking about the
path only when it is genuinely unclear, and finishes accordingly:

| Class | The lead | You see |
|---|---|---|
| **Spike** (a question to answer) | reports the answer, `wsh jarvis complete` | Done, with its answer as the summary |
| **Bounded** (one change) | asks for your yes, implements in its tree (the run's branch, or the checkout), tests, commits, `wsh jarvis complete --commit` | Done, with the commit, merged back |
| **Architectural** (needs a plan) | asks the decisions it needs as questions with options, writes the design straight into the spec, asks one **Spec review** (the spec's path on the question's first line), writes the plan with `superpowers:writing-plans`, runs `wsh jarvis dag submit --plan <plan> --spec <spec>` and stops | the plan review, then the sheet fills with tasks |

The Spec review is the one approval: the lead does not ask section by section, and after `dag submit` it does not
ask you to review the plan or pick an execution mode, since the engine reviews the plan.

When the goal names a mockup or design canvas that settles the design, the lead writes no spec. Its Spec review
carries the mockup's path on the first line and one line per decision beyond the mockup. The plan names the mockup
on its `**Prototype:**` line and is submitted without `--spec`, and the plan reviewer reads the canvas as the spec.

A plan's tasks carry the design decisions, the files each owns, the interfaces other tasks rely on, and acceptance
criteria with their tests, but not the implementation: the prompt overrides `writing-plans`' complete-code rule,
since pasted code made the lead's plan-writing the longest phase of a small run (7 to 14 min for 17 to 88 KB plans).

Once the plan review passes, or you accept a plan it failed, the engine waits for the lead to go idle and types a
`/compact` that keeps what you said and drops code it read. A plan submitted as JSON, with no review, is handed
over at `dag submit`. A failed review sends the plan back to a lead that still has its context to revise it. Every compaction of a lead re-injects its orchestration rules (`wsh jarvis dag rules`), so
it knows it is the lead of a run when it next wakes.

On a run landing on its own branch, `dag submit` commits the spec and plan to `wave/<runId>` before any lane is
cut (subject `docs: spec and plan for <title>`, without the plan template's " Implementation Plan", trailer
`Arc-Run: <runId>`). Every lane branches from that
commit, so each worker and reviewer reads that snapshot in its own tree, never the lead's live copy, and the docs
land with the run. A resubmit with revised docs amends that commit while no lane has been cut from it (after a
failed plan review), and commits anew once one has (a fix round's plan); identical content commits nothing. On a
checkout-landed run the docs stay uncommitted until the first lane merges, and the engine folds both into that
lane's squash commit.

A lead that exits before submitting fails the run with a **Lead exited** row.

A goal the lead would work as a plan, task by task with a subagent per task, is architectural, not bounded: the
engine runs it. Every claude session in an arcterm block, lead, worker or one you opened yourself, dispatches at most
`jarvis.MaxSubagents` (10) subagents. The lead, quick and worker prompts state the cap, and `wsh agent-hook`
refuses each Agent call past it in its PreToolUse hook, telling the agent to finish the work itself or hand a plan
to the engine (`wsh runs start --plan`). One session ran a 29-task plan through `subagent-driven-development` and
dispatched 96. The hook counts each session's calls in `%TEMP%\arc-subagents\<session>.log`, so a parallel batch
cannot slip past the cap before its subagents' transcripts exist.

### Writing the goal

The goal is the only thing the lead starts from. The backlog run's goal named the effort to read, the scope
and the one chunk excluded, where the verified facts live, and the constraints the plan must carry (Setup and
Verify commands, which tasks must share a lane, "locate by symbol, not line number", close the chunk before
`wsh jarvis complete`). Pre-answering decisions there saves a round of questions.

Check that the constraints don't force a serial plan. That goal also said "each task updates its tracker row
in the same commit" and "two tasks that edit the same file must not run in parallel". Every task would then
edit `docs/open-issues.md`, whose rows sit on adjacent lines that conflict when merged, so the tasks could
only run one after another. The lead caught it and proposed code tasks that never touch `docs/`, plus one
final task that depends on all of them and updates the rows from each task's chunk note. A shared file
that every task must edit is what sets a plan's width, so keep that edit out of the parallel tasks.

---

## Flow 3: Orchestrator from a plan file

### The plan format

```markdown
**Setup:** `task worktree:prepare`
**Verify:** `npx vitest run`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke`
**Prototype:** .superpowers/design/<topic>/<canvas>.dc.html
**Spec:** `docs/superpowers/specs/<date>-<topic>-design.md`

### Task 1: <title>
**Depends on:** none
**Model:** sonnet
...task text...

### Task 2: <title>
...no Depends line: runs after Task 1...

### Task 3: <title>
**Depends on:** Task 1, Task 2
```

- **Setup** runs in every new lane worktree before its first worker (2-minute limit), and once in a run's own
  branch tree when the plan is submitted. A plan with no Setup line takes the project's checked-in `.arc/setup`
  (one command) as its Setup. **Verify** runs where lanes land (the project checkout, or the run's
  own branch tree) after every batch of lane merges (20-minute limit), with `ARC_VERIFY_CHANGED` naming a file
  that lists the paths the batch changed, one per line: a Verify that reads it should test only what those paths
  can break.
  The final stage runs Verify once more with `ARC_VERIFY_CHANGED` unset, on the merged result, where it runs
  everything. The last merge of a plan skips its own Verify for that one
  ([The last merge](#the-last-merge-skips-its-verify)). Both are optional, both run in a POSIX shell (Git Bash on
  Windows).
  **Flaky tests.** Every Verify, at a merge and in the final stage, runs with `ARC_VERIFY_FLAKY` naming an empty
  file. A Verify that reruns a failing test and sees it pass exits 0 and appends that test's name to the file,
  one per line. The Verify still passes, but each name becomes an unverified reason of the run
  (`Verify reported flaky: <test> (failed, then passed on a rerun, in the Verify after merging t-2)`), so a race
  that passes on a rerun reaches you instead of a clean pass. A merge's report is also appended to its tasks'
  kept Verify output. A failed Verify's file is not read. The engine knows nothing else about the command:
  this repo's `scripts/verify.mjs` reruns a failed Go test alone once and reports it as `<package> <test>`, and
  reruns the files of failed vitest tests alone once and reports each as `<file> > <test>`; a vitest file that failed to
  load (a collection error) is never rerun, and fails the Verify.
- **Check** is a fast whole-project static check. Each worker runs it itself instead of Verify, and the final
  stage runs it once on the merged result. The engine also runs it once at submit, in a detached tree at the
  commit the lanes start from; if it fails there, the lead is woken, every worker is told those failures are
  not theirs, and the final stage and the land report a failing Check as unverified instead of failing.
  **Final** is one command the final stage runs on the merged result, and **Prototype** names the design canvas
  the result should match (a path, not in backticks). All three are optional; see
  [The final stage](#the-final-stage).
- **Spec** names the spec the plan implements: a repo-relative or absolute path in backticks, prose allowed after
  it (`superpowers:writing-plans` writes this line in every plan header). A submit without `--spec`, which is
  every **A plan file** start and `wsh runs start --plan`, takes it from here: the engine commits it with the
  plan and points the plan reviewer, task reviewers and final verifier at it. A Spec line naming no file is
  left as prose and the plan runs without a spec. The line also reaches every worker as header text.
- Headings are `### Task N` or `## Task N`, numbered 1, 2, 3… in order.
- `**Depends on:**` must be the first line after the heading. Left out, the task depends on the task before it,
  so a plan with no Depends lines is **serial**. `none` means independent. References must point backwards.
- `**Model:** <model>` pins one task's worker model: a model id or alias as `dag escalate --model` takes it
  (`sonnet`, `claude-opus-5-5`, a pi `provider/model`), not in backticks, resolved on the lead's harness. It goes
  in the task's head block with its Chunk lines: after the Depends line, or first under the heading when there is
  none. Anywhere else it is task text. One per task; an empty value, a space or a backtick is refused. It counts
  only on a run whose workers setting is Reviewer picks ([Routes](#4-routes)), but submit checks it on every run:
  a model this machine cannot run fails the submit, naming the task.
- ``**Files:** `pkg/a.go`, `pkg/b.go` `` lists every repo-relative path the task creates, edits or deletes,
  generated files included: each in backticks, separated by commas, files only (no directories or globs). It
  goes in the same head block, a second Files line continues the list, and the line stays in the task text the
  worker reads. Submit refuses a plan in which two tasks list the same path and neither depends on the other,
  directly or through other tasks; the error names both tasks and the path. Paths compare exactly after slash
  normalisation. A task without the line takes no part in the check, so a plan with no Files lines is accepted
  as before and the plan reviewer is the only check of its file overlaps.
- There is no task cap.
- **Every worker gets the plan's header.** Its prompt is the engine's worker contract, then the prose above
  Task 1, then its own task's section (`taskPrompt`, `engine.go`). This used to be the task alone: the backlog
  plan's header said "Never edit `docs/`. Task 13 writes all docs." and five lanes edited `docs/open-issues.md`
  anyway. Put rules every task shares in the header; a rule for one task belongs in that task.
- **Worker commit ids don't survive the merge.** A worker cites the commit on its lane branch, but the lane lands
  as a new squash commit. On the backlog run t-8's doc row cited `3f6d5814`, and what landed was `5eac07ed`.
  A later task that records commits should take them from `dag status` (its `landed` lines). A
  `git cat-file` check passes for either id while the lane branch exists.

The engine turns tasks into **lanes**: a chain where each task has one dependency and is its only dependent
shares one worktree and one branch, each task a fresh worker committing on top of the last, and lands as one
squash merge. The squash commit carries its workers' commit messages, oldest first, and names the lane in an
`Arc-Run:` trailer; the plan's task titles stand in only when those messages are empty. Independent tasks and tasks after a fork or join start their own lane. Lanes are what
parallelism counts. A task whose dependency is in another lane starts once that lane has merged, while the merge's
Verify still runs; a failed Verify holds the next merge, not a dependent's start.

**Merges batch.** When nothing holds the merge queue, every ready lane merges, each as its own squash commit,
and one Verify judges them all, scoped from the oldest of them to `HEAD`. A lane whose dependency merged earlier
in the same batch waits for the next one. A conflict ends the batch, and no Verify starts while the tree is
mid-merge: the lanes merged before it are verified with the conflicted one after the lead's `--continue`. If
the Verify of a batch of two or more fails, the engine bisects it: it verifies prefixes of the batch in a
detached tree, `<project>/.waveterm/worktrees/<run>-bisect`, set up with the plan's Setup, until it finds the
first lane whose merge fails. The lanes before that one land. That one is verify-failed, and the lead is woken
("… bisected from t-1, t-4, t-6"). The lanes after it stay verifying, shown as "held", and the Verify after the
lead's fix and `dag merge <task> --continue` judges them together. A single lane is never bisected, and neither
is a batch after a fix commit, since a prefix without the fix would blame that lane again: the oldest lane
takes the failure. A bisect that cannot run (the tree or its Setup fails) blames the oldest lane not yet known
good, so it never lands a lane no Verify passed.

#### The last merge skips its Verify

When a merge leaves nothing to run, review or merge, the final stage starts next and runs the whole Verify on
that same tree, so the merge runs none of its own. The task goes straight to done, and its **Task merged** row
reads "Verify left to the final stage" (`"verify": "final"` on the `task-merged` event); there is no **Verify
started** or **Verify passed** row for it. A failure then shows as a failed final stage ("Verify … failed on the
merged result"), which blocks the run and wakes the lead for a fix round as any final Verify failure does. It is
not bisected and names no lane, because the final stage never does. A stage that ends before its Verify ran (it
could not make its tree, Check failed, or you ended it) leaves that merge with no Verify at all: the stage's own
failure or unverified reason says so, and the merge's chunks stay open until a later round's Verify passes.

Every other merge verifies as before:

- any task is still pending, running, in review, at a gate or waiting to merge;
- the merge is one of a batch of two or more, even the plan's last batch, so a failure can still be bisected to
  its lane;
- the plan has no Verify line, so the final stage has none to run;
- the merge is a fix round's: every fix-round merge runs its Verify, the last one too.

### Start it

Pick **A plan file** and paste the plan's absolute path. The launcher parses it as you type and will not
start until it parses:

![A relative path is rejected](images/orchestrator-guide/10-plan-preview-error.png)

A plan with no Depends lines and no Verify is flagged **serial** and **unverified** before you start:

![A serial, unverified plan](images/orchestrator-guide/11-plan-preview-serial.png)

The sandbox plan: five tasks, five lanes, longest chain 2.

![The sandbox plan parsed](images/orchestrator-guide/12-plan-preview-ready.png)

A real one, the backlog cleanup plan its own lead wrote and then handed back: 13 tasks, 13 lanes, longest
chain 6. The preview line under the path is the fastest check that the Depends lines say what you meant.

The longest chain also sets how a run ends. The backlog chain is Task 2 → 3 → 4 → 6 → 7 → 13. Once the eight
independent tasks had landed, the run went one task at a time, with two of its three slots empty. `dag status`
reports such a stretch as `dependency-wait`, naming the task each waiter needs (the rail's Run section reads
"… waiting on …"). `parallelism-wait` ("waiting for a slot") means every slot is busy. To shorten that tail, cut
Depends lines in the plan. Raising parallelism won't help. When slots are short, the engine gives a free one to
the ready task with the longest chain of tasks waiting behind it, then by task id, so a chain does not queue behind
tasks nothing depends on.

![The backlog plan in the launcher](images/orchestrator-guide/24-plan-dialog-backlog.png)

The New dialog lists the parsed plan's tasks with a model column that follows the Workers picker. On
Reviewer picks a Model line reads `<model> · plan` and a task without one reads `at review`, under the mix line
`N set by the plan · M picked at review`. On any other workers setting a task without a Model line reads the
workers model, a Model line is struck through, and the mix line reads `all on <model>`, plus
` · plan lines ignored` when the plan has any.

**Start run** submits the plan immediately. There is no approval step from you and no lead. The engine's plan
reviewer reads the plan first ([The plan review](#the-plan-review)), and the first layer dispatches once it
passes. The launcher passes no spec of its own; the plan's `**Spec:**` line names it. On a branch-landed run the
engine commits the plan and that spec to `wave/<runId>` at submit; on a checkout-landed one it folds them into
the first squash commit. A plan with no Spec line runs without one.

![A plan run executing](images/orchestrator-guide/13-plan-run-started.png)

The engine launches a lead only at the first judgment event, with the orchestration rules as its prompt and
the event as its first line. A failed plan review is one. A plan that lands and ends its final stage passed or
unverified, with nothing to decide, never gets a lead: the engine closes the run, seals its evidence and merges
it back itself.

The sandbox plan (`orch-guide-demo/docs/plan.md`) was written to need judgment three ways, and the rest of
this guide uses what happened to it: task 1 sets `status.txt` to `broken` so Verify fails after it merges,
tasks 2 and 3 both rewrite the one line of `greeting.txt` so the second merge conflicts, and task 4 asks a
product question the plan's notes tell the lead to forward.

---

## The plan review

Both flows submit a plan file, and the engine reviews it before any worker starts. The dag's status reads
`plan-review`, and the scheduler dispatches nothing until the review passes or the lead accepts it. A dag
submitted as JSON, with no plan file, and a fix round skip it.

The engine starts a fresh plan-reviewer session in the tree where lanes land, on the reviewer route. It reads the
spec (or, with no spec, the plan's design canvas), the plan and the files they name, and checks that:

- every requirement in the spec has a task;
- no two tasks edit the same file without a Depends between them;
- types, functions and flags have the same names in every task that mentions them;
- each task states its acceptance criteria and names the tests that prove them;
- the commands the plan names exist.

It also reports gaps in the spec and places where the spec and plan contradict each other. It only reads, and
ends with `wsh jarvis dag planreview pass "<summary>"` or `wsh jarvis dag planreview fail "<findings>"`. A
reviewer that ends without a verdict, or runs past 20 minutes, is replaced once. One lost twice fails the review
with the reason, and the same plan can be submitted again.

- **Pass:** the workers start, and the lead gets a quiet `plan review passed; workers are starting: …` line.
- **Fail:** the lead wakes with the findings. It revises the plan, puts any spec change to you, and runs
  `wsh jarvis dag submit` again. While no task has dispatched, a resubmit replaces the failed proposal and opens
  review round 2. A plan run started without a lead gets one launched by this wake.
- **Round 2 fails:** the lead must put it to you, as a **Plan review** ask: the plan's path and one line per
  finding, which opens as the review dialog ([Answering the lead](#answering-the-lead)). If you say to proceed
  anyway, it runs `wsh jarvis dag planreview accept "<your reason>"`, and dispatch starts on the plan as it
  stands.

A lead's resubmit replaces the plan, not your settings: the run's workers setting and reviewer route stay, a change
you made in the run sheet before it included, and on Reviewer picks the next round's reviewer is asked for picks
again.

### Model picks

On a run whose workers setting is Reviewer picks, the plan reviewer also picks a model for every task the plan
gives no Model line. Its brief lists those tasks and the rule: `sonnet` only for a mechanical, tightly specified
task (a copy of an existing pattern, a field threaded through, prose against written code), `lead` for anything
with a design choice, with one line on why. Its pass carries one `--pick` per listed task:

```bash
wsh jarvis dag planreview pass "<summary>" --pick "t-2=sonnet: copies the existing row pattern" --pick "t-3=lead: picks the precedence rule"
```

The shape is `t-N=<sonnet|lead>: <reason>`. `wsh` refuses anything else before sending it (`Task 2=sonnet`,
`t-2 sonnet`, a missing reason). The server refuses the pass, naming the task,
for a missing pick, a pick for a task with a Model line, an unknown or repeated task, an empty reason, a reason of
more than one line or over 200 characters, and a `sonnet` pick when the claude harness cannot run a worker here
(it says to pick `lead`). The reviewer then resends. A run not on Reviewer picks refuses any pick.

A fail carries picks the same way, and may leave tasks out; those stay on the lead's route. The picks are applied
to the held tasks at once, so the banner shows them while the review is failed. A resubmit replaces the tasks and
drops them, and `planreview accept` dispatches on them. `accept` itself takes no `--pick`.

The picks are applied in the same write that records the verdict, so no worker starts without its pick. `sonnet` puts
the task on Claude Code · `sonnet`; `lead` leaves it on the lead's route. Tasks the review did not pick for (a task a
failed review left out, a fix round's tasks) run on the lead's route unless they have a Model line.

**Where picks show.** The run's timeline lists them under the **Plan reviewed** row, one `t-N · <model> · <reason>`
line each. A task card whose model differs from the run's workers model carries a tag, `<model> · plan`,
`· review`, `· you`, `· escalated` or `· pinned`, and the DAG view's detail rail names where the task's worker
model came from (`plan's pick`, `reviewer's pick`, `your pick`, `escalated`, `pinned`, `workers route`,
`same as lead`). The graph header shows the workers setting and the reviewer route as chips.

**Changing a pick.** While a task the reviewer put on `sonnet`, or one you changed, has not started, the live DAG
view shows a banner, "Plan review passed and put N of M tasks on sonnet. They run as picked unless you change
them.", and a **Model picks** panel above the timeline rail. Each row has a `sonnet | <lead>` toggle, the reviewer's reason, and
`waiting` or `you changed it`. **Put waiting tasks back on <lead>** moves every waiting picked task at once. A
task counts as waiting until it first dispatches; after that its row reads `running on <model>`, and a change is
refused with the task's state, shown on the row. A started task keeps its model; to move it, retry or escalate it.
Your change wins over the plan and the reviewer (rung 1 of [Routes](#4-routes)), and the reviewer's reason stays on
the row. Both banner and panel go away once every listed task has started; the cards and rail keep the source.

---

## Watching a run

### The run sheet

Open a run from **Waiting on you**, **Conversation History**, or right after **Start run**. Top to bottom:

- **Verb** and subtext: Planning, Starting, Executing, Waiting on you, Landing, Blocked, Done, Cancelled.
- **Meter** (one segment per task) and chips: elapsed, worker minutes, landed, answered, forwarded,
  unverified, attention.
- **Timing** (orchestrator runs): one bar per activity (Planning, Execution, Task review, Merge & Verify,
  Final verification, Landing / wrap-up) on a since-launch axis. Collapsed while the run runs, with a line
  naming the executing tasks and what is still ahead of them; open on a finished run. Activities overlap, so
  the rows do not add up.
- **Questions for you**, when you hold any.
- **Tasks**: one row per task with its state and an action: **Open in Agent ↗** for a live worker, **View
  child run** for a finished one, **Open DAG ↗** for one blocked on a merge. Then a `next:` line saying what
  the run is waiting for.
- **▸ timeline**: every run event, newest first. **open the full timeline ↗** opens it in the DAG view.
- **Settings line**: `engine · orchestrator · lead … · parallelism … · workers …` with **Adjust**.
- **Dock**: **Open DAG**, **Open lead ↗**, **Ask Jarvis**, **Cancel run**.

A 13-task run a minute after its plan went in — every task listed with the reason it is not running yet
("waiting on …", "not dispatched yet"), the first three dispatched, and the settings line under them:

![A 13-task run executing](images/orchestrator-guide/21-run-executing.png)

The timeline is the most useful thing on the sheet when a run needs you. This is the sandbox run recovering
from its conflict and failed Verify, then taking the answer to its question:

![The run timeline](images/orchestrator-guide/16-answered-timeline.png)

### The DAG view

**Open DAG** shows the task graph with a **Lifecycle** rail (filters All / Task / Attention). Selecting a node
shows its detail panel. Per-node buttons appear only when a node needs a decision: `retry` / `skip` /
`escalate` on a failed or stalled task, `resolve` on a blocked merge or failed Verify, `merge` on a lane end
the engine is not merging itself. **Cancel** in its header cancels the DAG.

![The Route DAG view](images/orchestrator-guide/17-dag.png)

### The Agent surface

The Agent tree groups agents by project and nests a run's workers under its lead ("◆ name"), with a chip
for live workers or "N done". Finished workers fold under **✓ N done**. A worker row reads `t-4 · Pick the
sign-off` with its lane and state. Its header links back to the lead (**↑ lead**) and names its lane.

The details rail (`d`) carries a **Run** section for a lead (progress, lanes, health, the last timeline rows,
held questions) and a **Task** section for a worker (**plan · Task N ↗**, Lead, Lane, Depends on, Result).

![The sandbox lead after its run finished, with the run section in the rail](images/orchestrator-guide/19-lead-rail-done.png)

A goal-led lead reporting what it submitted, with its run row above it in the tree ("◆ backlog-cleanup ·
working · 0/13 done"). The lead stops there; the engine wakes it when it needs a decision:

![The lead after submitting its plan](images/orchestrator-guide/22-agent-tree-executing.png)

A landing doesn't wake the lead. Each task that passes review queues a line (`t-4 passed review: …`) that rides on
the lead's next wake, and the run-finished wake carries whatever is left, so the lead learns what landed without a
turn per task. A wake reads its action first, then the questions, then `Unverified:` (what passed reviews could
not verify), and the recaps last under `Since your last wake:`. `wsh jarvis dag status` shows each task's result and latest review. While the lead
waits at its prompt, its row reads `standing by`; its Workflow mark stays accent, without the pulse, while a worker,
reviewer or Verify is at work, and goes muted only when nothing is.

---

## When the run needs judgment

The engine wakes the lead by typing one self-contained line into its terminal (for example
`wake: Verify failed after merging task t-1 (exit 1). wsh jarvis dag status`). A wake that does not turn the
lead to working within 30 seconds is retried once; after that the lead counts as dead and its events come to
you.

| Event | The lead | What reaches you |
|---|---|---|
| **Plan review failed** | revises the plan and runs `dag submit` again; after round 2, asks you, and on your word carries each accepted finding into the pending tasks it affects with `dag amend` (every task still waits), then runs `dag planreview accept "<your reason>"` | spec changes, and a second failed review |
| **Merge conflict** at a lane merge | fixes it where lanes land (the run's branch tree, or the checkout), commits, `wsh jarvis dag merge <task> --continue` | nothing, unless the lead forwards it or is dead |
| **Verify failed** after a merge | fixes it, commits, `dag merge <task> --continue` (re-runs Verify at HEAD) | same |
| **Review failed** twice, or the reviewer couldn't do its job | reads the findings in `dag status`; `dag sendback <task> "<guidance>"`, `dag approve <task>`, retry, escalate, skip or forward | forwarded review failures |
| **A passed task with a note for later tasks** that the engine could not deliver (nothing unfinished follows the task, or a named task already finished or without a live terminal) | amends the pending tasks the note affects (`dag amend`), or tells a running one (`dag tell`) | nothing |
| **A worker's question** | answers from the spec, plan and code, or forwards a product call with a note | forwarded questions and any it does not answer within **10 minutes** |
| **Task failed** with its retry spent | `dag retry`, `dag escalate --model`, `dag skip`, or forwards | forwarded failures |
| **Worker hung** (15 min silent, process alive, no ask pending) | same as a failure | same |
| **Worker may be stuck** (worktree unchanged 20 min while active, or the same failure 3x) | `dag tell`, `dag retry`, `dag escalate`, or lets it run | same |
| **Worker never started** (5 min after spawn, its terminal's shell never came up) | `dag retry` | same |
| **Final stage failed** | writes a fix plan and runs `dag submit --round --plan <fix plan>` (tasks only: the round runs the run's own Verify, Setup, Check and Final, and a fix plan naming different ones is refused); puts it to you when no round is left or the fix is a product call | a failed last round, or a product call |
| **Run finished** | fixes and commits what the landed tasks left behind, writes a judgment-only report to a file (a line per task, its decisions and why, wrap-up commits, open issues; the engine records landed commits, worktrees left behind, counts and unverified reasons in the sealed record), adds open issues to the initiative, then completes on its own with `wsh jarvis complete --report <file>` | a question only when a decision is needed (a failed verification, a deviation, a proposed fix round), then the Done face |

In `dag status`, a running worker that has written nothing lately reads `idle Nm`, or `running a command Nm · <tool>`
while its processes are busy (a long test writes no transcript); a flagged one reads `stuck? <reason>`. Each done task shows one presence line naming its non-empty report sections and
the pull command, e.g. `t-3 report: differs, not verified, found not fixed (wsh jarvis dag report t-3)`; a legacy report
reads `t-3 report: unstructured (wsh jarvis dag report t-3)`.

### A task's review

Tests are not the only check. A worker ends by committing, writing its report to a file the engine names outside
every worktree (`<temp>/arc-reports/<dag>/<task>.md`), and running
`wsh jarvis complete --commit $(git rev-parse HEAD) --report <that file>`. The report is five sections, in this
order: `## Done`, `## Differs from plan`, `## Not verified`, `## For later tasks`, `## Found not fixed`, each with
`None` when empty and nothing before the first heading. The server refuses a task worker's `complete` without
`--report`, or with a report that doesn't parse, and prints the template in the refusal; leads, spikes, reviewers and
the final verifier are not held to it. A report written before this format falls back to being read whole.

Each section reaches the reader that acts on it: the lead's review-pass wake carries Differs from plan, Not verified
and Found not fixed (and For later tasks only when nothing unfinished follows the task), later tasks get For later
tasks by plan edge, and the final stage lists each landed task's Not verified. A section over 2500 characters is cut
at a line and ends `… <N> more characters: wsh jarvis dag report <task> <section>`; that command (sections `done`,
`differs`, `not-verified`, `for-later`, `found-not-fixed`) reads the rest. At the lead's seal the engine records the
tasks' sections, the counts, the told messages and the worktrees left behind; `wsh runs show` and the run sidebar
render that record.

When a worker finishes with a commit, the task goes to **reviewing** and the engine starts a reviewer in the
task's lane worktree, on the reviewer route (the lead's unless you picked one, see [Routes](#4-routes)). The
reviewer reads the task, the spec, the worker's whole report and `git diff` of the task's commits. It checks the
change against what the task asked for (missing requirements, contradictions of the spec, cut corners, changes
outside the task), and ends with one command:

- `wsh jarvis dag review pass "<summary>"`: the task lands as before. The reviewer checks the worker's For later tasks
  section instead of relaying it. `--downstream "<note>"` reaches the task's unfinished descendants (plus any
  `--for t-3,t-5`): the engine adds it to the prompt of a task that hasn't started and types it into a working one's
  terminal, and the lead reads where it went on its next wake. It wakes the lead only when no unfinished task
  follows. `--for` alone forwards the worker's For later tasks to the tasks named; it is refused when that section is
  None or the report is a legacy one. The section goes to the lead only when nothing unfinished follows the task.
  Adding `--unverified "<what, and why>"` records a check the task asked for (a test, a screenshot, a live run)
  that the diff and the report show was not done. The lead's `passed review` line prints it whole, first; `dag
  status` prints it under the task and in the report; and it becomes one of the run's unverified reasons at the
  final stage.
- `wsh jarvis dag review fail "<findings>"`: the first time, the task goes back to a worker in the same worktree,
  starting from the rejected commit with the findings in its prompt. The second time, it goes to
  **review-failed** and the lead wakes.

A reviewer that ends without a verdict or runs past 20 minutes is replaced once; a reviewer that commits has its
verdict thrown out. Either way the task goes to review-failed after that. A worker that reports no commit is not
reviewed: the task is done, and the lead's next wake says `t-N finished without reporting a commit` with the
worker's closing note.

On a review-failed task the lead (or you, from the DAG) can `approve` it (overrule the reviewer; it lands as it
is), `sendback` it with guidance for one more round, or `retry`, `escalate`, `skip` or `forward` it.

The lead steers later tasks with `dag amend <task> "<note>"` (added to the prompt of a task that hasn't started)
and `dag tell <task> "<text>"` (typed into a running worker's terminal, logged as `lead told t-N`).

### Merge conflict and failed Verify

On the sandbox run, tasks 2 and 3 both landed, and the second merge conflicted. The sheet flagged it as
**blocked-merge** with a `resolve-merge` action, and the engine launched the plan run's first lead with the
conflict as its wake. Other lanes keep merging meanwhile:

![A blocked merge](images/orchestrator-guide/14-merge-conflict.png)

The lead resolved `greeting.txt` as the plan's notes said, committed and ran `dag merge t-3 --continue`. Task 1
had landed in the meantime with `status.txt` set to `broken`, so both merges' Verify runs failed; the engine
woke the lead with both lines in one message, it restored `status.txt`, committed, and continued both. The
timeline above records the whole sequence, conflict to **Verify passed**, in about two minutes.

To do it yourself: fix the tree where lanes land (the project checkout, or the run's own branch tree, which the
card names), commit, then `resolve` on the DAG node (or
`wsh jarvis dag merge <task> --continue`).

### A worker asks a question

A worker's question goes to the lead first and stays off your Brief. While the lead holds it, the details
rail's **Run** section shows it with a countdown ("lead is answering · Nm left") and a **Take over** button
that moves it to you; the lead's `dag answer` is refused from then on.

A question the lead forwards, one it does not answer within 10 minutes, and one you take over all show up
under **Questions for you** on the run sheet, with the lead's note:

![A forwarded question](images/orchestrator-guide/15-question-for-you.png)

Pick an option or type an answer and **Send answer**. The worker continues, and the timeline records
`t-4 answered` (above). The sandbox worker wrote `ciao`, the option picked on this card.

### A task fails or hangs

A failed or stalled task shows on its row and in the DAG with `retry`, `skip` and `escalate`. The lead gets it
first; you see it when it is forwarded or the lead is dead. Retry and escalate stop the worker they
replace, so before you retry a stalled task, check its lane worktree under `.waveterm/worktrees/` for recent
writes: a worker that is still writing files is alive, and the stall signal is wrong.

A task whose dispatch fails before a worker exists, because its worktree could not be made (`worktree-failed`)
or its worker tab could not be opened or started (`spawn-failed`), is dispatched again by the engine on its next
tick, up to three times in a row. Each one is a **Task retried** row and wakes nobody; the retry rebuilds
whatever tree the failed attempt left. Only when those are spent does the task fail and the lead wake. A route
that does not resolve, a missing harness and a failed Setup are not retried: the task fails at once.

To move a task to another model, use **escalate…** in the DAG's detail panel under the graph (it opens a
route picker, then **Re-queue on model**). Escalation is one hop per task.

### The lead is dead

Before `dag submit`: the run goes **Blocked** with a **Lead exited** row. **Resume** restarts the lead in its own
session ([The app restarted mid-run](#the-app-restarted-mid-run)); or cancel the run and start again.

After `dag submit`: the engine keeps merging and verifying, the timeline shows **Lead wake failed**, and every
judgment event and lead-held question comes to you. Select the **Lead wake failed** row and press **Relaunch
lead** to start a replacement: it refuses while the lead is still running, and its prompt is the events the dead
lead missed rather than the original plan. Until then, answer from the sheet and act with the DAG buttons or
`wsh jarvis dag`. A stalled task with no live lead is retried once by the engine itself, so it no longer parks
the run; a second stall waits for you.

### The app restarted mid-run

A Quick run, or an orchestrator run before `dag submit`, whose worker was running when the app quit or crashed
comes back **Blocked** with an **Interrupted by restart** row. A worker whose process exited on its own reads the
same, with a **Worker exited** row (**Lead exited** for a lead). Opening the worker's tab does not start it again;
its terminal says the worker stopped. The blocked card offers:

- **Resume** restarts the worker in its own tab and session (`claude --resume`, `pi --session`) with a one-line
  nudge to check the working tree and continue, never the task again. The run reads Executing and the timeline
  gains a **Worker resumed** row. Shown for claude and pi runs that recorded a session; a refusal shows its reason
  on the card.
- **Take control** opens the worker's terminal as it was left.
- **Cancel run** ends the run.

A run after `dag submit` is the engine's: its watchdog picks the dag up again at boot.

### The engine is stuck

A scheduler tick that has not finished in 12 minutes, or a merge-point Verify that has held the project checkout
for 30, is in a wait the engine cannot end. The timeline gains an **Engine stuck** row, the lead is woken to put
it to you, and the server log (`waveapp.log`) gets a dump of every goroutine, taken at the report. The other
runs keep being ticked. Nothing in the run advances until Arc is restarted; after a restart the dag resumes from
where it was, as above. The row is reported once per stuck tick or Verify.

---

## Steering a live run

- **Talk to a worker.** Type into its terminal on the Agent surface. What you type is logged on the lead's run
  as a `you told t-2 · …` row and in `dag status`, so the lead sees it at its next wake. It wakes nobody.
- **Change parallelism or the workers' route.** **Adjust** on the settings line → **Worker parallelism**,
  **Worker route** → **Save settings**. It applies to dispatches from then on. **Save as project defaults**
  makes the next run start this way. Shape, machine and the lead's route are fixed at launch, and nothing
  already running changes. The **Worker route** picker also offers **Reviewer picks**, and a **Reviewers**
  picker beside it sets the reviewer route ([Routes](#4-routes)). The profile's run defaults set the same pair
  in the **Worker route** row (which includes **Reviewer picks**) and the **Reviewer route** row below it.

  ![Adjust on a live run](images/orchestrator-guide/23-adjust.png)

- **Cancel.** **Cancel run** is meant to confirm first ("Stop N running workers and cancel this run?
  Completed phases, transcripts, and artifacts are kept.", with **Keep running** to back out). On an engine
  run it does not: it cancels on the first click, kills the running workers and skips every task that had not
  started. See [Rough edges](#rough-edges-found-while-writing-this) — treat the button as immediate. If a
  worker survives the cancel, the sheet says so with **Take control** and **Stop** per worker.

---

## The final stage

A run is not done when its last task lands. Once every task is terminal and merged, the dag's status reads
`finalizing` and the engine runs a final stage on the merged result. The dag is `done` only when that stage ends
passed or unverified.

**Where it runs.** On a branch-landed run, in the landing tree at `wave/<runId>`. On a checkout-landed run, in a
detached worktree at the checkout's HEAD (`.waveterm/worktrees/<runId>-final`), with the plan's Setup run in it,
removed when the stage ends. It never runs in the shared checkout.

**The steps.** Check, Verify and Final run one after another; the verifier runs after them when the plan has a
Final line, and alongside Check and Verify when it has none:

1. **Check**, the plan's Check line, on the merged result (20-minute limit). A non-zero exit fails the stage,
   unless Check already failed on the base at submit: then the stage goes on and reports it as unverified.
2. **Verify**, the plan's Verify line with `ARC_VERIFY_CHANGED` unset, on the merged result (20-minute limit). A
   non-zero exit fails the stage. Each test it reports flaky in `ARC_VERIFY_FLAKY` becomes an unverified reason.
   It is also the only Verify of the plan's last merge ([The last merge](#the-last-merge-skips-its-verify)),
   whose chunks close when it passes.
3. **Final**, the plan's `**Final:**` command, in a POSIX shell with `ARC_FINAL_OUT` set to a fresh directory
   for its screenshots and reports (`<data dir>/final-shots/<dag>/<round>`, outside every tree). Exit 0 passes.
   Exit 3 means it could not verify, and its last output line becomes an unverified reason. Any other exit, or
   running past 30 minutes ("timed out"), fails the stage with the output tail. Whatever the exit, the engine
   then stores the round's screenshots on the stage (`shots`), from an optional manifest
   `$ARC_FINAL_OUT/shots.json`: a JSON array of
   `{ "name": string, "files": string[], "steps": [{ "step": string, "state": "pass"|"fail"|"skip", "detail"?: string }] }`,
   one entry per scenario, file paths relative to `ARC_FINAL_OUT` with forward slashes (`shotsmanifest` is
   set). Without one, or with one over 1 MiB, unparseable, or with another state (logged as `dag <id>: reading
   shots.json: <why>`), every `*.png` under `ARC_FINAL_OUT` becomes an entry of its own, sorted by path, named
   for its file, with no steps. A file path that is absolute, on a drive, or climbs out with `..` is dropped. A
   fix round keeps the finished round, shots included, in the dag's `pastfinals`. The round directories stay
   30 days: wavesrv sweeps older ones at startup and every 4 hours.
4. **The verifier**, a fresh session in the final tree on the reviewer route. Its brief names the spec and plan,
   `git diff <base>..<head>` of the run, `ARC_FINAL_OUT`, the `**Prototype:**` canvas, and every unverified
   note so far. It checks that the combined change does what the spec asks, and looks for breaks where tasks
   meet: code one task changed that another uses, a name two tasks spell differently, behavior two tasks both
   touch. It compares screenshots to the canvas's boards structurally (which elements, their order, copy,
   controls at that width), never by pixels, and classifies each difference as allowed (listed in the spec's
   Deviations) or a defect. It only reads, never runs the plan's commands, and ends with
   `wsh jarvis dag final pass "<summary>" [--unverified "<what, and why>"]` or
   `wsh jarvis dag final fail "<defects: each, where, the fix>"`. A verifier silent past 20 minutes, or ending
   without a verdict, is replaced once. One lost twice adds the unverified reason
   `the verifier did not finish: <why>`.

**When the verifier starts.** With a Final line it starts only once Final is done, unless a step failed, since
it reads Final's screenshots and reports. With no Final line it starts on the merged tree as soon as the tree is
ready, while Check and Verify run, so the stage takes about the longer of the two instead of their sum; its brief
says the commands are running rather than that they passed. A verdict given before they finish waits for them.
A Check or Verify failure fails the stage with that command's output whatever the verifier said, and stops a
verifier still working; their unverified reasons join the verifier's. The tree is made once and removed once
both are done. With no Check, no Verify and no Final line, the stage goes straight to the verifier.

A server restart mid-stage runs Check and Verify again in the tree the stage recorded. A verdict given while they
ran is held in memory only, so after a restart the verifier, whose session ended with it, is replaced.

**Ending a stuck stage.** You can end a stage stuck in any running step, from the run sheet's **End final
stage** or with `wsh runs end-final <run-id> unverified|failed "<reason>"`. It stops the running commands and
the verifier, and records the reason on the stage as `ended by the human: …`. Unverified finishes the dag done but
unverified. Failed is a verifier's fail: the lead plans a fix round from the reason, so cancel the run instead
when you want no fix round.

**The outcome:**

| Outcome | When | Then |
|---|---|---|
| **passed** | nothing failed and nothing is unverified | the dag is done; the lead gets `run finished` with the outcome |
| **unverified** | nothing failed, but there is a reason: a test a merge's or the final stage's Verify reported flaky, a Final exit 3, the verifier's `--unverified`, a reviewer's `--unverified` note, a plan with no Verify, or you ended the stage unverified | the dag is done; the `run finished` wake lists every reason in full |
| **failed** | Check, Final or the verifier failed, or you ended the stage failed | the lead wakes with the failure in full |

`wsh jarvis dag status` prints the stage as `final <state> round=N commit=… out=<ARC_FINAL_OUT>`, then each
`final unverified:` reason and a `final failed:` detail, whole.

**Watching it run.** While a command runs, the stage names it in `step` (`tree`, which makes the tree and runs
Setup when the stage makes its own, then `check`, `verify`, `final`), with when it started and its output tail,
published at most every 10 seconds as merge Verify's is. Status adds `step=<step> (<elapsed>)` to the stage line.
In the cockpit the run's row reads `final: running Verify`, `final: running Final`, `final: verifier reviewing`
(with `· verifier alongside` while a verifier works beside Check and Verify), and the DAG view's stage line adds
the elapsed time, with the plan's command and the output's last lines on hover. Each step that ends records a
`final-step` run event (`round`, `step`, `ms`, `ok`), so a run's timeline shows where the stage's minutes went.

**The fix round.** On a failed stage the lead writes a fix plan in the plan format and runs
`wsh jarvis dag submit --round --plan <fix plan>`. The fix plan's tasks are appended as `t-(n+1)…`, with its
own numbers and Depends mapped on. Each description opens with `Fix round N: this is task K of the fix plan at
<path>`, so its worker reads the fix plan, not the run's. The dag keeps its Verify, Setup, Check, Final and
Prototype. On a branch-landed run the fix plan is committed to `wave/<runId>` first, and the new tasks cut from
the landing tree's head. A fix round skips the plan review, but each of its tasks is reviewed. When its tasks
land, the final stage runs again as round 2. The final stage runs at most twice (`MaxFinalRounds`): the first
round and one fix round. `--round` is refused, with the reason, while the stage is still running, after it
passed, or when no round is left. After round 2 fails, the wake tells the lead to put it to you. It does the same
when the fix is a product call.

**This repo's Final command** is `node scripts/cdp/final-verify.mjs [scenario...]`. It starts a dev app from the
final tree, runs the named `verify:ui` scenarios (all of them with none named) and writes into `ARC_FINAL_OUT`:
`cdp-shots/` (with `index.html` as the contact sheet), `shots.json` (the manifest above, one entry per
scenario with its screenshots and steps), `dev-app.log`, `waveapp.log` (the app's own log),
`webview2-profile/` and `tauri.final.json`. A dev app from the main checkout is usually running, so the final one
shares nothing with it: its own CDP port, a Vite port from 5175 up (passed as `task dev -- --config
tauri.final.json`), a fresh store under `%LOCALAPPDATA%\arc-final\stores\` (a short path, since wavesrv's
`wave.sock` must stay under Windows' 108-byte socket path limit; dropped after the run),
the cargo target dir `%LOCALAPPDATA%\arc-final\target` (shared by final stages, so only the first pays the cold
build), and its own `dist/bin`: it unlinks the tree's `dist/bin` and `src-tauri/target` junctions first. It sets
`ARC_DEV_NO_GLOBAL_INSTALL`, so the run's branch installs no agent hooks or `~/.arc/bin/wsh`. Two final
stages at once share the target dir, so the second should fail to replace a `wave-tauri.exe` the first is running
and report unverified (not tested). It stops only the processes it started. It exits 3 with a reason when the app does not
come up within its boot budget (`ARC_FINAL_BOOT_MS`, default 10 minutes). Otherwise it exits with verify.mjs's
own code: 0 pass, 1 a scenario failed, 2 an unknown scenario name. `ARC_FINAL_DEV_CMD` overrides the start
command (default `task dev -- --config <ARC_FINAL_OUT>/tauri.final.json`).

---

## When the run ends

The sheet goes to **Done**: tasks, commits landed, wall clock, worker time, and **evidence sealed**. **What
landed** lists each task's commit; **Sealed evidence** has the diff stat and the lead's summary. The evidence
also seals the run's outcome from the final stage (`passed` or `unverified`, with the reasons) and the tokens
it spent. On a checkout-landed run it counts only the run's own commits, the ones with its `Arc-Run:` trailer;
the lead ends each commit it makes with `Arc-Run: <runId>` so its own fixes count.

![A finished plan run](images/orchestrator-guide/18-done.png)

Finished workers stay on the Agent tree under **✓ N done**. Opening one shows its read-only transcript
("Session ended · landed `<sha>` · read-only transcript"), starting with the worker contract it was given,
and the rail names the branch it committed on:

![A finished worker's transcript](images/orchestrator-guide/20-done-worker.png)

### Landing back

A branch-landed run's work reaches its base without you. When the run completes (the lead's `complete`, or the
engine closing a lead-free run), the engine seals the evidence, then merges `wave/<runId>` into the base branch in
the project checkout. The merge is `git merge --no-ff` with the plan's title (else the goal's first line) as its
subject and `Arc-Run: <runId>` as its trailer. It then removes the landing tree and deletes the branch; the
evidence keeps the branch's tip. Landing is its own step with its own state, so completion never waits on it.

Before merging, the engine takes these steps:

- If the branch moved past the commit the final stage verified, or the base took commits since the run forked, it
  merges the base into the landing tree without committing and runs Check, then Verify with `ARC_VERIFY_CHANGED`
  listing what differs from the verified commit. It then aborts that merge. When the base has not moved and
  every changed path is Markdown, it skips Check, which cannot scope itself; Verify still runs.
- It removes an untracked file in the checkout that is identical to one the run adds, such as the spec or plan the
  lead wrote there before submit.
- The land notes the base commits that arrived after that check, "merged onto N commits that landed on <base>
  during the run; the combination was not verified".

It **holds** the land, with a reason, and leaves the checkout as it was, when:

- the final stage failed or has not finished;
- the run started on a detached HEAD;
- the checkout is on another branch;
- the checkout is stopped mid-merge, mid-rebase or mid-cherry-pick;
- the checkout has staged changes;
- an untracked file in the checkout differs from one the run adds;
- the land's Check or Verify fails (a Check that already failed on the base at submit only adds a note), or
  the run conflicts with the base in the landing tree;
- the landing tree is stopped mid-merge;
- the merge conflicts (it is aborted, and the reason names the files);
- git refuses to overwrite uncommitted edits to files the merge touches (the edits stay).

Uncommitted edits to other files do not hold it, and survive the merge.

A conflict with the base is predicted before the lead leaves, because the land runs after `complete` has closed
the lead's tab. At run finished the engine runs `git merge-tree` of the branch against the base, which touches no
tree. When it finds a conflict, the wake ends with "The land into <base> will conflict in <files>: merge <base>
into this tree, resolve, commit, then complete". The lead's `wsh jarvis complete` checks again and is refused while
the conflict stands. `wsh jarvis complete --hold-land` completes anyway, for when the human decides to leave it,
and the land then holds as above. The base can still move between `complete` and the merge; a conflict that
arrives then holds the land.

A held land raises a **land held** item under Waiting on you: "The run's branch was not merged back: <reason>".
Clear the reason, then press **Land again**: on that row in Jarvis's popup and in the Brief's Waiting list, and in the
run sheet's footer, which also prints the reason. It is the same retry as `wsh runs land <run-id>`, which prints where
the land stands; a land still held keeps the row and names the new reason. **Dismiss** on the popup's row drops the
item for a branch that will never land: the branch stays, and a later retry that holds raises it again.
`wsh runs land <run-id> --force` lands a run whose final stage failed; it is your call only. When the last final
round fails, the lead asks you what to do with the land, with at least **Land anyway** and **Keep the land held**.
On **Land anyway** it completes with `wsh jarvis complete --force-land`, and the land that follows skips the
failed-final hold; every other hold still applies. Otherwise it completes as usual and the land holds until you run
the command above.

A done run whose outcome is unverified, or whose land carries a note, raises an **unverified** item ("Finished,
but N things were not verified.") naming each reason. It holds nothing, since the run is done. It stays until you
read it and press **Acknowledge** on its row, or run `wsh runs ack <run-id>`.

`wsh runs show <run-id>` prints all of it:

- `usage`, the tokens per role, with the lead's wrap-up counted once sealed;
- `outcome` with each `unverified:` reason;
- `land <state>` with the held reason or the merge commit, and each `note:`.

`wsh jarvis dag status` prints the same token totals as a `usage` line (`lead … · workers … · reviewers … ·
plan-reviewer … · verifier …`), then one `t-N usage:` line per task for its worker and reviewer. The lead's total
counts every lead session, a relaunched lead's included. A transcript that can't be read is not read as zero: the
line ends `(N unreadable)`. The totals are tokens only; cost stays in the cockpit.

A checkout-landed run has nothing to merge back: its commits are on the project checkout's branch. Review and
merge that branch yourself.

The backlog run finished on 2026-09-18 after 3h12m of wall clock and 5h46m of worker time. All 13 tasks landed
as 13 squash commits on `backlog-cleanup`, and a merge Verify passed after every one of them. One earlier
attempt had timed out and been re-run. Its Done face:

![The backlog run done](images/orchestrator-guide/27-backlog-done.png)

The finished DAG shows the plan's shape. Eight independent tasks ran up to three at a time, and the
t-3 → t-4 → t-6 → t-7 → t-13 chain ran one at a time behind them:

![The backlog run's DAG, done](images/orchestrator-guide/26-backlog-dag-done.png)

### Who wraps up

Done doesn't mean finished. The work after the last merge splits four ways:

| Work | Whose job | On the backlog run |
|---|---|---|
| The run's report | **The lead's.** Its rules (`OrchestrationRules`, `leadprompt.go`) have it fix and commit what the landed tasks left behind in docs (a code defect found then is an open issue, not a wrap-up commit), write the report to a file, and add each open issue as a pending chunk on the initiative (creating one if the run has none). Then it completes on its own with `wsh jarvis complete --report <file>`, without asking whether to. It asks you first only when a decision is needed: a failed verification, a deviation that needs your call, or a proposed fix round. An unverified outcome never blocks completion. | Not written. The rules then said "write the report …, then `wsh jarvis complete`". The lead ran `complete` first, and the engine closed its tab before it could recover. The sandbox lead did the same. |
| Closing the initiative's tracker chunks | **The engine's.** A task names its chunks with `**Chunk:**` lines after its Depends line, and the engine marks each done with the landed commit once the task's merge passes Verify (for the last merge, once the final stage's Verify passes). | The plan gave it to workers through a header line they never saw. The tracker read 3/16 with all 13 tasks landed. |
| Merging the branch back | **The engine's** on a branch-landed run ([Landing back](#landing-back)); **yours** on a checkout-landed one, or when a land is held. | The run landed on the project checkout's branch, and merging it was left to the human. |
| Checking what the final stage could not, committing anything | **Yours.** The unverified item names what nothing checked. | Four fixes still need a live check once the branch is on `main` and running in the dev app. |

Both gaps the backlog run hit are closed in code: `wsh jarvis complete --report <file>` seals the report the lead
wrote, and `**Chunk:**` lines let the engine close the tracker. If a sealed summary is still a half-sentence, the
lead ran `complete` without `--report`, or the engine closed the run itself because the lead could not be woken when
the DAG finished. Either way a later `wsh jarvis complete --report <file>` still attaches the report and replaces
that summary.

### What the backlog run left open

The run merged to `main` as `cf2fe485`. This list is the single record of what it left open; the rows it
closed in `docs/open-issues.md` point here.

- **Four fixes needed a live check in the dev app; all four passed on 2026-09-21.** Restart `task dev` on the
  merged `main` before re-running any of them — three are backend changes, and a `wavesrv` started before the
  merge doesn't have them.
  - **F25, hung agents** (`1f116196`): freeze a Claude Code agent mid-work, for example by suspending its
    process. After 3 minutes its row should read `hung · no output Nm`. **Passed**, firing at ~2m45s of true
    silence: the displayed stamp leads real silence by up to the 30s publish throttle, which errs toward
    flagging and matches the intent.
  - **F22/F23, questions and answers** (`2628c6a0`): answer a plain session's question while its agent is
    frozen. Within 30 seconds the card should come back noted "answer was sent but never confirmed". Also, an
    agent kept open after its process ended (`cmd:keeponexit`) should lose its pending question. **Both
    passed**; the note came back at 39s, which is the 30s `AnswerClearTimeout` plus one 5s sweep tick.
  - **F26, a killed worker** (`646f032c`): kill a Quick run's worker process. The run should fail with a
    `worker-exited` event. Quitting the app mid-run should not fail it. **Passed.** Note the app was killed,
    not quit, and nothing reconciled runs at boot, so the run stayed `executing` until cancelled by hand.
    Since 2026-09-30 a boot marks that run **Interrupted by restart** and the blocked card offers **Resume**
    ([The app restarted mid-run](#the-app-restarted-mid-run)).
  - **Chunk 8, the record peek** (`293f55ca`, frontend only): open a record peek, raise its confirm and press
    Escape. Only the confirm should close, and focus should return to the peek. **Passed.**
- **The hung overlay covers Claude Code only** (F25), and that is now the settled answer rather than an
  unmeasured gap. pi was measured on 2026-09-21: while a tool call is pending its TUI redraws an elapsed
  counter about once a second, but the moment the tool returns it renders nothing at all until the model
  replies — a minimal turn (run one `ping`, report the exit code) sat silent for 142.8s. `HUNG_AFTER_MS`
  is 180s and the frontend reads a `lastoutputts` that `blockcontroller` publishes on a 30s throttle, so
  the overlay can fire at ~150s of real silence: pi cleared a false `hung` by about 7 seconds on the
  simplest turn there is. The silence is bounded by model latency, which grows with reasoning effort and
  context, so no threshold is both safe and tight enough to be useful. Covering pi needs a liveness
  signal other than PTY bytes.
- **The frontend `deleteChannel` wrapper is gone.** It had no caller after `5827e43b` deleted the rest of the
  channel lifecycle stack. The `deletechannel` RPC and `DeleteChannelCommand` stay: `scripts/cdp/scenarios.mjs`,
  `scripts/cdp-e2e-runs-piece4.mjs` and `scripts/cdp-profile-verify.mjs` use it as their teardown.

---

## Tracking an initiative across runs

Big efforts live as initiatives (`wsh effort`, the Brief's **Initiatives** region). A run does not attach
itself to one: the goal names the effort, and a chunk closes when an agent runs
`wsh effort chunk status <effort> "<chunk>" done --note "…"`, or when the engine lands a task that names it
in a `**Chunk:**` line (see [Who wraps up](#who-wraps-up)). When a run finishes, its lead adds each open issue as a pending chunk on the
initiative the goal, spec or plan names, and creates one when there is none. To show a run against a chunk, attach it:
`wsh effort chunk attach <effort> "<chunk>" --run <run-oid>`. Expanding an initiative on the Brief shows each
chunk's status and note trail. On the backlog run the lead closed chunk 1 as already fixed, with its evidence,
before asking its first question. After that only t-4's worker closed any chunks.

---

## CLI: `wsh jarvis dag`

Inside a lead's or worker's terminal, the run is inferred. Elsewhere pass `--channel <id> --runid <id>`.

| Command | Does |
|---|---|
| `dag submit --plan <md> [--spec <md>]` | validate the plan and start the engine on it (one DAG per run); after a failed plan review, submit the revised plan again |
| `dag submit --round --plan <fix plan>` | after a failed final stage, append the fix plan's tasks as a fix round |
| `dag status` | per-task digest, the report numbers, landed commits, Verify and merge errors, what you told workers, unverified notes, the final stage, token usage |
| `dag asks` | questions the lead holds, oldest first, with every option |
| `dag answer <task> <answers-json>` | answer as the lead |
| `dag forward <task> "<note>"` | hand a question, failure, stall or conflict to the human |
| `dag amend <task> "<note>"` | add a note to a task that hasn't started; its worker's prompt carries it |
| `dag tell <task> "<text>"` | type into a running worker's or reviewer's terminal |
| `dag sendback <task> ["<guidance>"]` | one more round for a review-failed task, with your guidance beside the findings |
| `dag approve <task>` | overrule a failed review; the task lands as it is |
| `dag review <pass\|fail> "<note>" [--downstream "<note>"] [--for <task ids>] [--unverified "<what, why>"]` | a reviewer's verdict; ends the reviewer's session |
| `dag planreview <pass\|fail> "<text>" [--pick "t-N=<sonnet\|lead>: <reason>" ...]` | the plan reviewer's verdict; ends its session. On a Reviewer picks run a pass carries one `--pick` per task without a Model line, and a fail the ones it can judge ([Model picks](#model-picks)) |
| `dag planreview accept "<the human's reason>"` | as the lead, proceed past a failed plan review on the human's word |
| `dag final pass "<summary>" [--unverified "<what, why>"]` / `dag final fail "<defects>"` | the final verifier's verdict; ends its session |
| `dag retry <task>` / `dag skip <task>` | retry or skip a failed or stalled task |
| `dag stop <task>` | stop a running or stalled task's worker and close its tab; the task fails as `stopped-by-human` and waits until it is retried, escalated or skipped (the Consumers panel's Stop on a worker) |
| `dag escalate <task> --model <id> [--runtime <rt>]` | re-queue on another model, once per task |
| `dag merge <task> [--continue]` | squash-merge a lane end, or finish a resolved conflict / re-run a failed Verify |
| `dag retry-cleanup <task>` | retry removing a task's worktree after its automatic attempts gave up (close whatever held it first) |
| `dag cancel <task>` | cancel the whole DAG (the task argument is required and ignored) |
| `wsh jarvis complete [--commit <sha>] [--report <file>]` | finish the run or task; `--commit` scopes its evidence, `--report` seals the file as the summary (required of a task worker) |

Run-level commands, from any terminal in the project:

| Command | Does |
|---|---|
| `wsh runs start [goal] [--plan <md>] [--landing branch\|checkout]` | start a run; `--landing` wins over the profile, and the default is branch |
| `wsh runs start … --worker-runtime <rt> [--worker-model <id>]` | the workers setting is that route |
| `wsh runs start … --reviewer-picks` | the workers setting is Reviewer picks; refused with `--worker-runtime`/`--worker-model` |
| `wsh runs start … --reviewer-runtime <rt> [--reviewer-model <id>]` | the reviewer route; `--reviewer-model` needs `--reviewer-runtime` |
| `wsh runs route [--global] [--worker-runtime <rt> [--worker-model <id>] \| --reviewer-picks \| --same-as-lead]` | print the lead, workers and reviewer routes a new run would use and where each comes from; with a workers flag, save that default for this project (or every project) |
| `wsh runs show <run-id>` | status, commits, `usage`, the task digest, `outcome` with its reasons, `land`, the report; its `route` line adds `workers=…` and `reviewers=…` when the run has them |
| `wsh runs answer <run-id> <answers-json>` | answer the run's own question (the lead's), which `runs show` prints |
| `wsh runs land <run-id> [--force]` | retry a held land-back; `--force` lands a failed final stage (the human's call only) |
| `wsh runs ack <run-id>` | acknowledge an unverified outcome, clearing its attention item |

The worker and reviewer flags need an orchestrator run, like `--parallelism` and `--landing`. Left out, the run
takes the profile's workers setting and reviewer route ([Routes](#4-routes)).

---

## Rough edges found while writing this

Seen live on 2026-09-17 and 18 or confirmed in code; none block a run.

- **A slow Verify reads as a failed one.** Verify is capped at 20 minutes (`VerifyTimeout`,
  `pkg/orchestrate/plancmd.go`). The engine also writes the plan's Verify into every worker's contract ("Run
  `<Verify>` and get it passing before you complete", `engine.go`). So at parallelism 3 with a full-suite Verify
  (tsc, vitest, `go test ./pkg/...`), up to four copies of the suite run at once. The backlog run's first merge
  Verify ran past the cap. The task went to `verify-failed` with "timed out after 20m" and the tail of the output,
  in which every package shown had passed. The lead woke for it, timed the next package alone
  (`pkg/orchestrate`: 241s under that load), found nothing to fix and re-ran Verify with
  `dag merge t-1 --continue`. If your Verify is the full suite, lower parallelism or expect a timeout like this.
  The same load used to push a worker that was only waiting on its own test run past the stall threshold; a
  busy process tree now counts as activity.
- **A timed-out Verify keeps running on Windows.** The timeout kills only the Git Bash launcher
  (`exec.CommandContext` in `plancmd_windows.go`). The real `bash` under it and the `go test` it started are
  never killed. On the backlog run the first Verify's `go test` was still running 30 minutes after it
  started, competing with the re-run. Kill the orphan tree by hand; it is the `bash.exe -c "<Verify>"` whose
  parent has exited.
- **The sealed summary can be the lead's previous message.** The sandbox lead ran `wsh jarvis complete` in the
  same step as its final check, so the evidence captured its mid-run update, not a report. The backlog lead
  lost more. `wsh jarvis complete` is what makes a run terminal, and the engine used to close a lead's tab the
  moment its run and DAG both were — so the lead ran `complete` mid-turn, having just said it would check why
  the tracker read 3/16, and its tab was deleted before the command returned. It never closed a chunk or wrote
  a report, and the sealed summary is that last line.

  **Fixed in `89dd3705`:** `MaybeCloseOrchestratorLead` now refuses to delete a tab whose lead process is
  still alive, and `CloseOrchestratorLeadOnExit` collects it from the lead's own exit hook instead. A
  terminal run says the work is done, not that the turn is over; only the process says that. The advice
  still stands on its own merits, though: tell a lead to do every tracker update and write its report before
  it runs `complete`, because `complete` seals the evidence from what it can see at that moment.
