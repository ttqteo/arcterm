# Brainstorm mode: an agent's brainstorm beside its terminal

When an agent inside Arc runs `superpowers:brainstorming`, Arc draws the brainstorm on the Agent
surface in place of the terminal: the question it is waiting on, with an answer box, the design's
parts as they form, mockups beside their parts, and at the end a builder check and the start of an
orchestrator run. `b` or Ctrl+Shift+B (or the header's **Terminal | Brainstorm** switch) flips between
the two; the terminal stays mounted underneath.

The design and the reasons behind it are in `docs/superpowers/specs/2026-10-18-brainstorm-mode-design.md`.
The agent's half of the protocol is `skills/brainstorm/SKILL.md` (`arc:brainstorm` in Claude Code).
This page is how the pieces fit, what each action sends, and how to test it.

![Mid-conversation: question 4 on the left, the design forming on the right](../images/brainstorm/01-talking.png)

## The model in one paragraph

The brainstorm's state is one file the agent writes,
`<project>/.superpowers/brainstorm/<topic>/brainstorm.json` (gitignored). Arc never writes it: it
polls the file and draws it, and every action in the pane reaches the agent as **one line**, sent to
it as a prompt. An answer is sent as typed; every other action is a `brainstorm:` line the skill
defines. One writer means no merge, and the file is what survives a compaction, an Arc restart and
the agent exiting.

## How a brainstorm attaches

1. The agent invokes the `Skill` tool for `superpowers:brainstorming`. A synchronous PostToolUse hook
   (matcher `Skill`, `wsh agent-hook --skill-context`, registered by `install-agent-hooks`) adds
   context telling it to also follow `arc:brainstorm`. The agent then loads that skill itself.
2. The agent creates `brainstorm.json` with its file-writing tool. The async PostToolUse hook
   (`brainstormRevealFor` in `cmd/wsh/cmd/wshcmd-agenthook.go`) sees the path and sends
   `wsh ui reveal brainstorm:<topic>` for it: the switch appears, the tree line reads
   "Brainstorm · asking question 1", and the tab meta `session:brainstorm` records the file's path.
   Pi and opencode have no such hook; the skill has them run the reveal themselves.
3. `BrainstormPoller` (mounted in the cockpit root) reads every attached brainstorm's file every
   3 s (`BRAINSTORM_POLL_MS`). After a restart it re-attaches every agent whose tab carries
   `session:brainstorm`. One unreadable read is taken for an agent mid-write; the second in a row
   shows "Arc could not read the latest brainstorm.json" over the last good contents.

**Agents a run starts are left out.** `pkg/jarvis` sets `ARC_RUN_AGENT=1` in the environment of every
agent an Arc run launches (`jarvis.RunAgentEnv`). The skill-context hook adds nothing for them, and
the skill tells them not to use it: a lead routes every question through AskUserQuestion or
`wsh ask`, which the cockpit shows instead.

## What each action sends

| In the pane | Line the agent gets | The agent then |
|---|---|---|
| Type an answer, Enter | the answer, joined onto one line | records the exchange, writes the part, asks the next question |
| Type a line with no question open, Enter | the line, joined onto one line | reads it as pushback or a question back, replies under a new question, sets `done` false |
| Guess for me | `brainstorm: guess` | writes its own guess for the asked part, asks the next question |
| Skip the questions | `brainstorm: skip questions` | writes every open part as a guess, sets `done` |
| (the judge is done) | `brainstorm: judged <path>`, sent by the server | copies `judge.json` onto its question with one script, clears `working`, ends its turn on the question |
| (the judge failed or was lost) | `brainstorm: judge failed: <reason>`, sent by the server | writes its own options and pick, sets `question.judge` to `{ "failed": <reason> }`, clears `working` |
| An answer or Skip during the judge's wait | the line, as typed, or `brainstorm: skip questions` (Arc has stopped the judge first) | an answer is recorded as any answer, with `working` back to `null`; Skip works as above |
| Push back on a judged question, or type "double check" | the line, as typed | adds any alternative it names to `approaches`, runs `wsh brainstorm judge <brainstorm.json> --line <the line>`, ends its turn |
| That's right | `brainstorm: confirm <part>` | makes the part yours |
| Confirm all N guesses | `brainstorm: confirm every guess` | makes every plain guess yours (a changed part still waits) |
| Edit, Enter | `brainstorm: edit <part>: <text>` | replaces the part's body, makes it yours |
| Keep the change / Put mine back | `brainstorm: keep <part>` / `brainstorm: restore <part>` | settles a part it changed after you confirmed it |
| Keep all N changes | `brainstorm: keep every change` | keeps every part it changed after you confirmed it |
| Check with a builder | `brainstorm: check` | writes the spec, runs `wsh brainstorm check <brainstorm.json>`, ends its turn; Arc launches the reviewer |
| (the reviewer is done) | `brainstorm: builder questions <path>`, sent by the server | reads the questions file, sorts it into `check`, folds it into the parts and the spec |
| Try again (check failed) | `brainstorm: check` | the same as Check with a builder |
| Answer a builder question | `brainstorm: builder answer: <text>` | folds it into the part and the spec |
| Keep talking | `brainstorm: keep talking` | clears `done` and `check`, asks again |
| Approve and start run | `brainstorm: approved`, then the launcher opens | stops; does not start a run itself |
| (the run starts) | `brainstorm: run <id>`, sent by the launcher | records `run` |

Lines go out through `AgentPromptCommand` (`brainstormsend.ts`), the same path canvas marks use:
a session whose arc mod holds a control stream runs the line as a prompt, leaving a half-typed draft
in the composer alone; any other session has it typed.

## Why the pane says "Working" before the file changes

The agent writes the file **once per turn**, at the end. So that the pane does not sit on a stale
question for the whole turn, Arc records the line it sent (`sent` in the brainstorm state) and draws
the file as if the agent had set `working`. An answer closes the question card and shows its part as
"Being written"; any other line shows "Taking in your change." Every button that sends is disabled
meanwhile, so a second line cannot be sent into a running turn.

![An answer just sent: the working card, the part being written](../images/brainstorm/02-writing.png)

The poller settles the sent line (`settleSent` in `brainstormmodel.ts`) when the agent's turn ends
after the send, or when the file has changed and the agent is not at work. A write in the middle of a
turn does not settle it.

The one-write rule is about cost as much as tidiness. With two whole-file writes per answer, the
end-to-end test measured output growing from 1.8k to 6.5k tokens per answer, and 56 s per answer
once the file reached 6.8 KB. The skill now has the agent make small changes with a one-line
read-modify-write script: a confirm done that way took 574 tokens and 8 s, against 4.3k tokens and
30 s for a retyped file. In the dev app an answer now comes back with the next question in about 7 s.

## The three phases

**Talking it through.** One question at a time, each naming the part it is for. Parts are `yours`,
`guess` (dashed, with That's right and Edit), `asked` or `open`. "Before the builder check" lists
every part that is not yours yet, with Confirm all once there are two or more plain guesses.

A part an answer made yours shows that answer beside it, from the file's history (`partAnswer`):
under the gist, `answer 11: “Dark, like the spike”`, on one line until the row opens. It is how a
part that says more than the user did (a board, a named option the answer never picked) stands out
before the builder check and approval; the skill keeps such a part a guess. A question dropped after
pushback is a `superseded` history entry: the rail shows it as dropped, it counts as no answered
question, and the part it was asked for reads "Open · question N dropped" until a question asks it
again.

**What is new.** While a question is open it fills the pane, so notes and recon the agent adds then
(a report the user asked for, say) are out of sight. Arc remembers, per brainstorm file, what the
user has seen (`brainstormSeenAtom` in `brainstormstore.ts`): the file as first read, then the file as
the design last drew it, taken when the design closes. Parts whose text changed since then and recon
entries not seen before are new (`unseenSince` in `brainstormmodel.ts`): a part row reads "New", a
recon row in the rail "Recon · new", and while new notes exist the question shows **New findings · N**,
which opens the design with those notes open. Coming back from the design clears the marks. A part
whose state alone changed (a confirm) is not new. The skill puts a summary of any report in the
question's `why` too, since the link says only how many notes there are.

A part's mockups draw under its body when its row opens: each board a scaled live thumbnail with
Open full size (the canvas), each of its `spikes` (a throwaway live page under the canvas folder, for
motion a board cannot show) a link that opens it in the browser from the same served folder.
`PartMockups` in `brainstormui.tsx` draws both, from `partBoards` and `partSpikes`.

**Builder check.** Check with a builder appears once the agent sets `done`, no question is open and
every part is yours.

![Nothing left to ask: Check with a builder](../images/brainstorm/03-ready.png)

The check view shows what a fresh builder asked: the questions only you can answer, the calls the
agent made (marked "Agent's call" in the spec and under their parts), and what the design already
answered. Approve stays off until every builder question has an answer. While the reviewer works the
pane shows "A builder is reading the design." and Check with a builder is unavailable.

The check's review keeps every part's mockups reachable while the user confirms the design: a review
row whose part has a board or a spike opens to them (even a row new since the check, which has
nothing it was), and so does a part opened from the "Yours, unchanged" and notes links under it.

Any question the agent waits on is in the file's `question`, in every phase. A question about no
part (a choice the agent needs before it can go on) shows as a plain "Question N" card, without
Guess or Skip; in the check view it sits above the builder's summary.

Whenever no question is open (the design after `done`, parts waiting on keep or restore, the builder
check's review) a box under the main area takes a line of the user's own: a pushback or a question
back. It sends the raw line as the answer box does, and is locked while the agent writes
(`lineBox` in `brainstormmodel.ts`, `LineBar` in `brainstormui.tsx`). The skill has the agent reply
by opening a question under the next `n` whose `why` leads with the reply, set `done` false, and
rewrite the parts the line changes. A run that has started takes no line.

![A question about no part, asked during the builder check](../images/brainstorm/04-check.png)

**Run.** Approve sends `brainstorm: approved` and opens the New launcher on its run half, prefilled:
orchestrator, the agent's project, a goal naming the spec's absolute path, and as prototype the first
mockup board any part lists (`approveAndOpenRun` in `brainstormsend.ts`, which calls
`openLauncher(model, "run", prefill)`). When the run starts, the launcher hands the run's id back
(`handBackStartedRun` in `launcherrun.ts`, through the prefill's `onStarted`) and `brainstormsend.ts`
sends `brainstorm: run <id>`; the window stays on the Agent surface rather than switching to the run's
Brief. The bar then reads "Run <id> started · Open run" and the tree "Brainstorm done · run <id>".
**Change** on the bar opens the same launcher without sending anything.

![The run started from the brainstorm](../images/brainstorm/05-run-started.png)

## How Arc runs the builder check

Design: `docs/superpowers/specs/2026-10-22-brainstorm-builder-check-reviewer-design.md`. The agent does
not review its own spec and dispatches no subagent; Arc runs a separate session, so claude and pi
agents behave the same.

- **The handoff.** On `brainstorm: check` the agent writes the spec and runs `wsh brainstorm check
  <abs brainstorm.json>`. That calls `BrainstormCheckCommand`, which validates the file and its spec,
  writes the check record and returns at once; a watcher goroutine does the rest. A second check on a
  tab whose record is `reading` is refused.
- **The reviewer session.** A one-shot judging session (`orchestrate.LaunchJudgingSession`, the launcher
  the plan reviewer and final verifier use) in the project's checkout, with Arc's prompt
  (`pkg/brainstormcheck/builder-check-prompt.md`). It reads the spec, changes no file, writes its ranked
  questions to a report and runs `wsh jarvis complete --report`, which ends it. Its run has
  `StageRole: builder-check`. In the Agent tree its tab is a "Builder check" row nested under the
  brainstorming agent whose `brainstorm:checkrun` names its run, reading the record's state; with that
  tab gone it is a top-level row of its own (`buildAgentTree`). A new check takes the record, so it closes
  the tab of the check before it (`startBrainstormSession`), which would otherwise be such a row; a new judge
  does the same to the judge before it.
- **The route.** The run settings' reviewer route (with a per-project override), else the brainstorming
  agent's runtime with its default model, else the default runtime.
- **The tab record.** The server alone writes `brainstorm:checkstate` (`reading`, `answered`, `failed`)
  with `checkts`, `checkrun`, `checkchannel` and `checkreason` on the agent's tab. The pane reads them
  through `builderCheckView` and never infers the state from the file.
- **The watcher.** Every 5 s it asks `brainstormcheck.Decide` about the run: a done run with a report is
  delivered, a done run with none fails, and the engine's liveness rules (`JudgingSessionLost`: the route
  refused it, the 20-minute `ReviewTimeout`, the worker exited, idle past its grace) fail it with their
  reason. Arc does not respawn a lost reviewer.
- **Delivery.** `Run.Report` is written to `<topic dir>/builder-check.md`, and the agent gets
  `brainstorm: builder questions <abs path>` through the same delivery `AgentPromptCommand` uses. The
  record becomes `answered`, and the pane reads "Taking in the builder's questions." until the agent
  takes the line (its turn ends after `checkts`, or the file changes while it is not at work). Then the
  file's `check` drives the view.
- **Failure and Try again.** `failed` shows its reason with **Try again**, which sends `brainstorm:
  check` again so the agent rewrites the spec and relaunches. The pane shows the same card, "The agent
  ended its turn without starting the builder check.", when a `brainstorm: check` send settled and no
  newer record appeared.
- **The startup sweep.** `ResumeBrainstormSessions` runs when wavesrv starts and re-arms both kinds,
  the builder check and the judge: a `reading` tab with a `checkrun` gets its watcher back (a reviewer
  that finished while Arc was down is delivered); one without is set to `failed`, "Arc restarted
  before the builder started."
- **Runs it hides.** A `builder-check` run is not a run to the user: it is left out of
  `GetChannelRunsCommand` / `GetChannelRunChangesCommand`, `wsh runs list`, attention items and the
  session tree's run rows, and its done step makes no seal. The reviewer's tab stays a solo session
  in the roster.

## How Arc runs the judge

Design: `docs/superpowers/specs/2026-10-23-unbiased-approach-questions-design.md`. On a question that
picks an approach (how to build, which design, which mechanism), the brainstorming agent lists the
approaches and the facts it found, with no verdict, and a fresh Opus session that never saw its
favorite weighs them. Permissions, process steps, plain choices and builder questions keep "Agent's
pick"; the agent decides which questions are approach questions (the skill's **Approach questions go
to the judge**). The judge rides the builder check's machinery.

- **The handoff.** The agent writes the question's `text`, `part`, `why` and `approaches` (at least
  five, each `{ "name", "description", "facts" }`, no odds, pick or pros and cons) with no `options` or
  `read`, sets `working` ("The judge is weighing 7 approaches."), runs `wsh brainstorm judge <abs
  brainstorm.json> [--line <text>]` and ends its turn. That calls `BrainstormJudgeCommand`, which reads
  the file with `brainstormcheck.ReadJudgeInput` (a missing question, or fewer than five approaches with
  a `name`, is refused), checks the file is under `.superpowers`, writes the judge record and returns at
  once; a watcher goroutine does the rest. A second judge on a tab whose judge record is `reading` is
  refused. The builder check and the judge keep separate records, so neither blocks the other.
- **The judge's session.** A one-shot judging session (`orchestrate.LaunchJudgingSession`) in the
  project's checkout, with Arc's prompt (`pkg/brainstormcheck/judge-prompt.md`). Arc builds it from the
  file, never from the agent's words (`brainstormcheck.JudgePrompt`): every answer the user gave, every
  part they confirmed, the question's text and the list in shuffled order. The agent's `why`, `read`,
  guesses and notes stay out. The judge works read-only and is told not to read `.superpowers/`, which
  is not enforced (spec D3). It asks what approach would beat every listed one, verifies the facts the
  choice turns on, writes one JSON object to its report (2-4 options with pros, cons and one pick, a
  `read`, what it `added`, and every listed approach it `dropped` with a reason) and runs `wsh jarvis
  complete --report`, which ends it. Its run has `StageRole: brainstorm-judge` and the label
  "Judge · <title>".
- **The route.** Fixed: claude with Opus, whatever runtime the brainstorming agent uses. The run
  settings' reviewer route, which the builder check reads, does not apply.
- **A rerun.** `--line` carries the user's pushback or "double check" as typed (spec D8). The rerun's
  prompt also holds the judge's earlier options and pick, read from `question.options` when
  `question.judge` is a weighed record. Each rerun is a fresh session, not a resume of the last one.
- **The tab record.** The server alone writes `brainstorm:judgestate` (`reading`, `answered`, `failed`,
  `stopped`) with `judgets`, `judgerun`, `judgechannel` and `judgereason` on the agent's tab. The agent
  tree reads it; the pane draws the judge's work from the file's `question.judge`, never from the record.
- **The wait view.** While the judge runs, the pane shows the question (part link, text, `why`), a status
  line (the file's `working` text), the approaches being weighed as clickable rows under "What the judge
  is weighing · N", and an open answer box ("Or answer now in your own words…"). It is the `"judging"`
  main view in `brainstormmodel.ts`: `working` set, `question.approaches` non-empty, and no line Arc sent
  still pending (then `shownFile` shows "Writing up your answer." or "Taking in your change." as on any
  question). A click sends the approach's `name` as the answer, recorded with no `picked`. Every other
  working state (a talk answer's wait, the builder check's reading) keeps the bare working note.
- **The pane's stop.** Before it sends an answer (typed, or a clicked row) or Skip during the wait, the
  pane calls `BrainstormJudgeStopCommand` (`{ BlockId }`; no `wsh` command). On a `reading` record it
  stops the judge's run and records `stopped` with the stop time, sending the agent no line; on any
  other record it does nothing. The watcher checks the record under the kind's lock before each tick
  and before writing its launched run, and exits silently (stopping a run it launched late) when the
  record is no longer its own `reading`. A stop that errors keeps the line from being sent, and the pane
  shows the error. `ResumeBrainstormSessions` leaves a `stopped` record alone, and a new judge may start
  after one. The agent never stops the judge; the skill's **While the judge weighs** says how it takes
  the lines (an answer, pushback rerunning the judge with `--line`, Skip) and to ignore a late
  `brainstorm: judge failed` for a question no longer open.
- **The watcher and the result check.** Every 5 s it asks `brainstormcheck.DecideJudge` about the run.
  A done run with a usable result is delivered. A done run with no report fails ("The judge ended
  without its result."), and so does a result that fails Arc's check: not one JSON object (prose or a
  code fence around it), not 2-4 options each with a label and a detail, not exactly one pick, an empty
  `read`, or a dropped entry with no name or reason. `JudgingSessionLost` fails a lost session with its
  reason, as for the builder check. Arc does not respawn a lost judge.
- **Delivery and the two lines.** A usable result is written to `<topic dir>/judge.json` as
  `{ "options", "read", "judge": { "added", "dropped" } }`, the agent gets `brainstorm: judged <abs
  path>` through the same delivery `AgentPromptCommand` uses, and the record becomes `answered`. The
  agent copies the file onto `question` with one `Object.assign` script, never retyping it, and clears
  `working` in the same write; `approaches` stays for a rerun. Any failure (no result, an unusable
  one, a lost session, a launch error, a restart before launch) records `failed` with the reason and
  sends `brainstorm: judge failed: <reason>`: unlike the builder check, a failure is a line, since the
  pane has no judge card. The agent then writes its own options with "Agent's pick" and
  `question.judge` as `{ "failed": <reason> }`.
- **The pane.** On a weighed question the read is "Judge's read" and the pick "Judge's pick", one
  line under the options says how many approaches the agent listed, what the judge added and how many
  it dropped, and a collapsed list gives each dropped approach with its reason (`judgeWork` in
  `brainstormmodel.ts`). A failed record keeps "Agent's read" and "Agent's pick", and its line gives
  the failure and its reason. A history row of a judged answer reads "Judge's pick".
- **The startup sweep.** `ResumeBrainstormSessions` re-arms both kinds when wavesrv starts: a
  `reading` judge with a `judgerun` gets its watcher back (a judge that finished while Arc was down is
  delivered); one without, or one whose tab no longer holds a brainstorm, is set to `failed` and the
  agent gets the failure line.
- **Runs it hides.** A `brainstorm-judge` run is hidden wherever a `builder-check` run is
  (`jarvis.IsBrainstormSession`): left out of `GetChannelRunsCommand` / `GetChannelRunChangesCommand`,
  `wsh runs list`, attention items and the session tree's run rows, and its done step makes no seal.
  Usage still counts it under `brainstorm-judge`.
- **The tree row.** In the Agent tree the judge's tab is a "Judge" row nested under the brainstorming
  agent whose `brainstorm:judgerun` names its run, reading the judge record's state, beside a builder
  check's row when both exist; with that tab gone it is a top-level row of its own (`buildAgentTree`,
  `brainstormJudgeOf`).

## Outside the pane

- **Tree and attention.** An agent whose file holds a question and whose turn has ended reads as
  asking in the agent tree: its row has a Brainstorm chip in the place of the canvas chip, and a line
  ("asking question 5", "writing up your answer", "builder check", then the run's state) in place of its
  model and branch. A builder check's reviewer and a judge nest under it as `check` rows
  (`agenttreemodel.ts`, read by `projectTree` in `agentsidebarmodel.ts`). When Arc is not focused, a new
  question flashes the taskbar button: the asking brainstorm joins the outward attention list
  (`brainstormAttentionItems` in `attentionstore.ts`, read by `attentionpoller.tsx`), which `taskbarSignal`
  turns into the flash. That item is made in the frontend; nothing is added to the server's ask registry,
  and the in-app attention lists stay the server's. Main has no popup window, so there is no card to read
  the question from: the tree line and the pane are where it shows.
- **A newcomer finds it.** The first pane a machine opens carries a one-time hint card (four lines, kept
  dismissed under `brainstorm.hintsSeen` in localStorage; `brainstormhints.ts`, `brainstormhintscard.tsx`),
  the Agent surface's zero-agent state and the New dialog's agent row say where a brainstorm starts, and
  with the pane focused the footer lists its keys.
- **Compaction.** After a compaction the agent re-reads the file and stamps `compacted`; the terminal
  shows a banner with the counts until you next open the brainstorm.
- **Agent exited.** The pane offers **Resume in a new agent**, which launches one in the same project
  with the prompt `Resume the brainstorm in <path> with arc:brainstorm.` A brainstorm that started a
  run is not offered this.
- **File deleted.** The pane says the file is gone; **Back to terminal** detaches it and clears the
  tab meta.

## Where the code is

| Piece | Where |
|---|---|
| File parsing and everything drawn from it (pure) | `frontend/app/view/agents/brainstormmodel.ts` |
| Per-agent state, sent line, shown file | `frontend/app/view/agents/brainstormstore.ts` |
| Polling, re-attach after a restart, settling a sent line | `frontend/app/view/agents/brainstormpoller.ts` |
| Sending lines, opening the launcher, run id handback | `frontend/app/view/agents/brainstormsend.ts` |
| The pane (frame, question, design) | `frontend/app/view/agents/brainstormpane.tsx`, `brainstormui.tsx` |
| The builder check's review and the Run step | `frontend/app/view/agents/brainstormcheck.tsx`, `brainstormreview.tsx`, `brainstormrun.tsx` |
| The first-open hint card and the start line | `frontend/app/view/agents/brainstormhints.ts`, `brainstormhintscard.tsx` |
| The pane's keys | `frontend/app/store/keybindings/bindings.ts` (`inBrainstorm…` predicates), `whenstate.ts` |
| Tree chip, tree line, nested check and judge rows | `frontend/app/view/agents/agenttree.tsx`, `agenttreemodel.ts`, `agentsidebarmodel.ts` |
| Taskbar flash for an asking brainstorm | `frontend/app/view/agents/attentionstore.ts` (`brainstormAttentionItems`), `attentionpoller.tsx` |
| The launcher handoff (`onStarted`, the run id back) | `frontend/app/view/agents/launcherstore.ts`, `launcherrun.ts`, `launchermodal.tsx` |
| Reveal on write, skill context, run-agent exclusion | `cmd/wsh/cmd/wshcmd-agenthook.go` |
| `ARC_RUN_AGENT` on run agents | `pkg/jarvis/runexec.go` |
| Builder check's and judge's pure parts: prompts, `Decide` / `DecideJudge`, result paths, lines | `pkg/brainstormcheck` |
| Builder check's and judge's handlers, watcher, routes, startup sweep | `pkg/wshrpc/wshserver/wshserver_brainstorm.go` |
| `wsh brainstorm check`, `wsh brainstorm judge` | `cmd/wsh/cmd/wshcmd-brainstorm.go` |
| The reviewer's launcher and liveness | `pkg/orchestrate/stagesession.go` (`LaunchJudgingSession`, `JudgingSessionLost`) |
| The agent's protocol | `skills/brainstorm/SKILL.md` (edit here; the mod copy is generated) |

## Testing it

- **Unit:** `npx vitest run frontend/app/view/agents/brainstorm` covers the parsing, the derived
  views, every line, the sent-line rules and the sender. The hook's context and exclusion are in
  `go test ./cmd/wsh/cmd -run BrainstormContext`.
- **Builder check, unit:** `go test ./pkg/brainstormcheck`; `go test ./pkg/wshrpc/wshserver -run
  'BrainstormCheck|BuilderCheck'` (the handler, route chain, watcher, delivery, sweep, with the launch
  stubbed); `go test ./pkg/orchestrate -run 'StageSession|JudgingSession'`; `go test ./cmd/wsh/cmd -run
  'BrainstormCheckCmd'`; `npx vitest run frontend/app/view/agents/brainstormmodel.test.ts`.
- **Builder check, pane:** `node scripts/cdp/final-verify.mjs brainstorm-builder-check` (with `ARC_FINAL_OUT`
  set; it starts its own dev app) plays the server's side by setting the tab meta: the pending card with
  Check unavailable, the result, the failed card and Try again.
- **Judge, unit:** `go test ./pkg/brainstormcheck -run Judge` (the prompt, the result check, the paths
  and lines); `go test ./pkg/wshrpc/wshserver -run 'BrainstormJudge|ResumeBrainstormSessions'` (the
  handler's refusals, the launch, delivery of both lines, the sweep, with the launch stubbed);
  `go test ./cmd/wsh/cmd -run BrainstormJudgeCmd`; `npx vitest run
  frontend/app/view/agents/brainstormmodel.test.ts` (the judge record and the work line).
- **Judge, pane and tree:** `node scripts/cdp/final-verify.mjs brainstorm-judged-question
  brainstorm-judge-tree` plays the agent's and the server's side: the judged question with its labels,
  work line and dropped list, the failed record, a judged history row, and the judge's row nested under
  its agent.
- **Pane, scripted:** `node scripts/cdp/final-verify.mjs brainstorm-mode`. It plays the agent's
  side by writing each state's `brainstorm.json` into a temp project and checks every state the
  mockup draws, every line the pane sends, the tree line and the taskbar flash. Between sends it plays the
  agent ending its turn (`bsAgentTook`), since a sent line keeps the pane busy until then. The
  screenshots above come from it. The other brainstorm scenarios are `brainstorm-main`,
  `brainstorm-question-reasons`, `brainstorm-review-skim`, `brainstorm-rail-reasons`,
  `brainstorm-new-findings`, `brainstorm-check-review`, `brainstorm-builder-ask`,
  `brainstorm-builder-tree`, `brainstorm-judge-wait`, `brainstorm-run-blocked`, `brainstorm-run-landed`,
  `brainstorm-run-missing`, `brainstorm-approve-run` (Approve opens New run prefilled, without starting
  the run) and `brainstorm-hints` (the first-open hint card, the start lines, the footer). Every one but
  `brainstorm-hints` sets `brainstorm.hintsSeen` first, so the hint card never shifts a layout assert.
- **With a real agent:** the scenario cannot tell you whether a model follows the skill. For that,
  start a Claude Code agent in the dev app on a scratch project, ask it to brainstorm something, and
  drive it only through the pane, watching each `brainstorm.json` write. Things worth checking: one
  write per turn, a short terminal reply, Check with a builder running without a second question,
  and `run` set after the run starts. Close the agent's tab before rerunning the scenario: a second
  brainstorming agent in the tree breaks its tree-line steps.
- A `claude -p ... --resume` loop that sends the same lines is a cheaper way to check the agent's
  side alone. Strip `WAVETERM_*` from its environment first, or its hook reveals the brainstorm in
  the Arc you are working in.

## Known gaps

- **Pi is untested** end to end; it has no reveal hook, so it depends on the skill's reveal step. The
  builder check no longer differs by harness: the reviewer is Arc's session, not the agent's subagent.
- **The builder check has never run end to end with a real reviewer.** The Go tests stub the launch and
  the scenario plays the server; see the "Builder check end to end" entry in `docs/deferred.md`.
- **The judge has never run end to end either.** The same holds for a live judge in a real
  brainstorm; see the "Brainstorm judge end to end" entry in `docs/deferred.md`.
- **The arc mod can deliver a mid-turn line twice.** A prompt that joins a running turn is queued as
  unread and only cleared on a tool result; a turn that ends on text submits it again. The pane avoids
  this by not sending while a line is pending; the mod itself (`claude/arc-mod/hooks`) is not fixed.
