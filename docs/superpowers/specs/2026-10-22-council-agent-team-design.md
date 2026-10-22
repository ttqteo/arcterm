# Council v2: an agent team in one room, Brainstorm and Review, held to a benchmark

Status: design, not built (agreed in chat 2026-10-21/22). **Phase 0 done 2026-10-22 (`docs/council-phase0.md`): not
decided, leaning no-go.** The prompt-only agent team (V3) scored lowest (1/6 key lines over two cases) at about twice
council v1's tokens; a single agent (V0) was the best value; v1's argue round bought one borderline line. Teammates run
inside the lead's process (no RAM of their own), and arcterm's own spawn gates (10 Agent calls per session, a Token
burn card on 3+ spawns that refuses after 30 unanswered minutes) stall a headless team. Phases 1–3 wait on the
person's call after a stronger re-run. The paper case was removed from the benchmark at the person's request. Supersedes the "what it is", "Rounds", "Starting a council"
and "Where it lives" parts of `2026-10-21-council-design.md`; the role library, groups, the token gate and the file
store carry over unless this file says otherwise. Prototype: `.superpowers/design/council-newcomer/project/`
(gitignored; row C is this design: `V2Setup`, `V2Room`, `V2Report`; row B's `ReportDone` is the Review report).

## Where it stands (handoff, 2026-10-22)

Work moves to another machine; the person stopped the runs below on purpose.

- **Shipped:** run 74b368ce, the readable council on v1 (answer-first report, plain words, top-3 picks with agreement as
  a reaction, done toast and unread dot, a waiting council in Needs you, Setup as one composer). Its hand checks are in
  `docs/open-issues.md` "0 · Waiting on a hand check".
- **Next, in this order, each with Arc engine** (`wsh runs start --plan <file> --runtime claude --model opus`):
  1. `docs/superpowers/plans/2026-10-22-council-v1-room.md` (the room as a group chat, Brainstorm mode, one council at
     a time, started from a chat, saved into `docs/council/`). Cancelled right after it started; nothing of it landed.
  2. `docs/superpowers/plans/2026-10-22-council-bench.md` (`wsh council bench`, "Was this useful?"), with
     `--after <the run of 1>`. Never started.
  3. `docs/superpowers/plans/2026-10-22-council-phase0b.md` (the stronger benchmark). Cancelled at its task 4 with 9
     of 12 runs done (services-bugs, agents-bugs and newcomer, each V0, V2, V3; services-sleep not run) and nothing
     judged. Those results and every bench case live only in the old machine's data dir, so a new machine re-runs the
     plan from the start; its tasks 1 and 2 rebuild the cases, but the `newcomer` case must be rebuilt by hand first:
     `git archive 0a2c46437` into `<data dir>/council-bench-projects/newcomer/`, its key the five lines under
     "Benchmark" item 3, and its entry added to `<data dir>/council-bench/cases.json` (Phase 0's shape).
- The bench plan (2) also reads `cases.json`, so run 3's tasks 1–2 (or the hand rebuild) before it on a new machine.

## Why

Council v1 was built as "a panel of expert agents that reviews a feature": one-shot read-only `claude -p` calls in three
fixed rounds. Used for real on 2026-10-21 (a paper-direction review, 18 proposals, 37 replies, 0.91M tokens), it showed
three problems:

1. **It is not what the person meant.** They wanted agents that think together, for new ideas as much as for critique,
   the way Grok's multi-agent mode or Claude Code's agent teams feel: live agents talking in one room that you can watch
   and step into.
2. **A newcomer cannot use it.** The screens show the mechanism (rounds, proposals, P-ids, stances, a matrix) instead of
   the result. A finished council opens on the raw discussion; the answer is behind "Open summary". Words are code
   words (Accept / Challenge / Oppose, Split, Contested).
3. **The noise is the wrong noise.** Every expert answered every proposal, so agreement became a reply row ("↑2 · 2
   replies" on almost every card) and the vote told nothing apart.

The person also wants the arguing to earn its cost: token spend is accepted, but it is measured against cheaper
setups and re-measured whenever the harness changes.

## Goals

- A council is a **team of live agents in one room** (Claude Code agent teams as the base), talking to each other,
  visible as a group chat while it runs.
- **Two modes**: **Brainstorm** (new ideas for a problem) and **Review** (pick apart something that exists).
- **You can steer at any time**: message the room (a reply, an order, a new goal or approach), or @name one agent. You
  can also forget it: it finishes on its own and leaves a result.
- **The result is a report**, answer first, then what to do / ideas worth trying, with the argument behind each one a
  click away. Report and the whole room are **saved as a file in the project**.
- **Cheaper than a naive agent team** for the same quality (the levers below), with a **better harness** (system
  prompts, mode rules, turn-taking) and a **better UI** (the council surface, redesigned).
- **A benchmark** that compares setups on cost and quality, **re-run continuously**: every harness change, plus a
  one-tap rating on every real council.

## Non-goals

- Agents building or editing the project. A council reads, runs read-only commands and may write throwaway files in a
  scratch dir; building stays with the engine (`pkg/orchestrate`).
- A new surface, a graph view, or a view drawn inside the Claude Code TUI. The UI is the existing council centre mode
  of the Agent surface, redesigned. (The person considered `arc-view-mod` rows and a Jarvis-DAG-style idea graph and
  said "not that far".)
- Mixed runtimes inside one team in this version (agent teams are Claude-only). The benchmark may still include a
  non-Claude variant.
- Automatic harness evolution in the first version (see Phase 4).

## Anti-goals (a failure even if it works)

- Shipping the agent-team council while the benchmark shows it costs more without scoring better than v1 or a single
  agent.
- A finished council that opens on the debate, or any screen that needs the spec to be understood.
- Code words in the UI: P-ids, "stance", "round", "Split", "Contested", "Accept/Challenge/Oppose".
- A council that silently waits on the person forever, or finishes without telling them.
- A council that adds a screen or a second webview: the person ranks low RAM over a nicer result.

## The two modes

| | Brainstorm | Review |
|---|---|---|
| Input | a problem or goal, optional files | a thing that exists: a feature, spec, plan, paper draft, plus files |
| Phases (shown as a 3-part bar) | Ideas → Build on each other → Pick the best | Read and propose → Argue → Write the answer |
| Judging | deferred: no doubts allowed in phase 1; doubts open in phase 2 only on ideas someone builds on | from the start; every claim cites `path:line` or a screenshot region, or is marked "cites nothing" |
| Report | the answer, **Ideas worth trying** (≤3, each with why, a first step, who had it and who built on it), **Wild ideas kept aside**, the merged or dropped count | the answer, **What to do, most important first** (≤5, each with why and who disagrees and why), the not-ranked count |
| Default team | **Product ideas**: Scout, New user, Designer, Builder, Contrarian, Facilitator (my call; the person saw it on `V2Setup` and did not object) | the v1 groups (Review a UI feature, Paper review) plus a Scout; the coordinator is the lead |

**The mode is picked from the input, not by the person** (the person asked): a problem or goal ("how do we…", "what
should…") is Brainstorm; a thing that exists to be judged (a draft, a spec, a feature, "review", "what's wrong with")
is Review. The suggestion call that proposes the team also returns the mode and a one-line reason. Setup shows it as
a chip ("Brainstorm · picked from your question") the person can flip; a council started from a conversation records
the mode and the reason in its run facts.

Plain words everywhere (the person asked for this): a message's label is one of **idea, builds on it, wild idea,
proposes, has doubts, is against it, replies, sets the goal, steers**. Agreement is a reaction under a message ("Reader
agrees"), never its own message. In a report: **Everyone agrees**, or **<names> have doubts: <one line>**, or **<name>
is against it: <one line>**.

**The vote** (both modes): in the argue phase each agent names its top 3 of the others' ideas; an idea's ↑ is how many
agents put it in their top 3. Ideas no one picked fold into "n more with no picks" but the lead still reads them.

## Starting a council

1. **From a conversation (the main way)** (the person asked): while the person chats with an agent as usual, the agent
   starts a council by itself once the conversation holds enough: a clear problem or a thing to judge, and a real open
   question that more viewpoints would settle (two directions weighed and neither won, a spec or plan just written, a
   draft about to be submitted). It runs `wsh council start` with what the conversation already has: the question in
   the person's words, the files and screenshots discussed, and the constraints the person stated ("no new screens",
   "low RAM first"), which go into the lead's goal. The person does not fill in Setup. Cost is decided by the token gate
   that already exists (`pkg/tokengate`): a council it judges costly waits on a Token burn card with the estimate; one
   it lets through starts at once. The session shows one line that a council started (mode, team, estimate, a link to
   the room). When it ends, the agent reads the report (`wsh council wait`), sums it up in the conversation and carries
   on. The `arc:council` skill is rewritten for this: from "offer a numbered choice" to "start it when the conversation
   is ready, and say so in one line".
2. **When the person asks for one in the chat** (the person asked): "hỏi council đi", "ask a council about this", or
   `/arc:council`. The agent starts it at once with the conversation's context, the same way as above, without
   judging whether the conversation is ready.
3. **By hand**: Setup (`V2Setup`), or the palette's "New council…".

## The room: architecture

- **One lead, N teammates**, as a Claude Code agent team. The lead is the Facilitator (Brainstorm) or the coordinator
  (Review) and runs the phases; teammates are the roles. arcterm launches the lead as a normal arcterm agent with the
  team instructions, so it shows in the Agent tree under the project.
- **arcterm must see every message** to draw the room, store it and count tokens. How is the open question of Phase 0:
  - if agent teams keep their messages and task list in files arcterm can read (Claude Code keeps team state under
    `~/.claude/teams/` and `~/.claude/tasks/` as far as we know; never used on this machine, so unverified), wavesrv
    tails them;
  - if not, every agent posts through `wsh council say` (and reads with `wsh council read`), so wavesrv is the room and
    the agent team only provides the processes and the lead's coordination.
  Phase 0 picks one; the rest of this design holds either way.
- **Steering**: the person's message goes into the room (wavesrv) and to the lead (`wsh agents send`, as the
  cockpit already messages agents); the lead acknowledges it in the room ("Got it: no new screens…") and redirects
  the team. `@Name` goes to that teammate.
- **Waiting on you**: only when the lead asks the person a question it cannot proceed without. Then the council row is
  amber and the council appears in Jarvis Needs you with **Answer** and **Open**. Otherwise nothing waits on the person.
- **Done**: a toast carrying the answer's first sentence ("Council done: Chưa. Sửa baseline…"), opening the report; the
  council's tree row keeps an unread dot until the report is opened.
- **Stop**: the person can stop it; the lead writes a report from what exists.
- **RAM, computed, not fixed** (the person asked): every teammate is a Claude Code process. Phase 0 measures its peak
  (v1 claims 512 MiB per claude call with tools, `toolSlotBytes` in `pkg/council/caller.go`). How many agents may run
  at once is computed at start from the RAM free now, the way `pkg/memgate` decides a heavy job fits: (free − the 512
  MiB headroom) ÷ the per-agent peak, never above a hard max of 6 (more agents add noise faster than quality).
- **A council never waits for RAM; its agents take turns** (the person asked: the RAM a machine has does not grow by
  waiting). The limit caps how many agents are **awake at once**, not the team: an agent that is not speaking sleeps
  (its process ends, its session is kept) and is woken (resumed) when the lead calls it or it is @named. So a team of 6
  on a Mac with room for 3 starts at once and simply has at most 3 speaking at the same time; Setup says so next to the
  estimate ("3 of 6 awake at once on this Mac's free RAM"). Each awake agent holds a `pkg/jobqueue` slot as v1's calls
  do, so a turn may wait a moment while a build finishes, never the council. The Scout runs first and exits. Whether
  agent-team teammates can be put to sleep and resumed is a Phase 0 question; if they cannot, this is a reason to take
  the `wsh council say` path, where each turn is a resumed session that exits when it has spoken.
- **Going past the limit is allowed** (the person asked): the computed limit and the max of 6 are defaults, not walls.
  Setup's **More awake at once** (and Options for a team above 6) lets more agents run together, with one line saying
  what it risks ("may make the Mac swap and slow down every agent"). A council run past the limit is marked so in its
  run facts, so the benchmark can tell.
- **One council at a time** (the person asked, so one gets the depth and attention it needs): a second council started
  while one runs is queued and starts when the first ends (both from Setup and from `wsh council start`; today only
  `--queue` waits). Its tree row reads "Queued · after <the running council>", Start council on Setup reads "Queue
  council", and a queued council can be removed before it starts. A council waiting on the person holds no slot, as in
  v1.
- **Team size follows the problem** (the person asked): Setup suggests the roles and how many from the text and files,
  using v1's suggestion call (one sonnet call), usually 2–3 roles for a narrow problem and 4 for a broad one; the
  person adds or removes. The RAM limit above is a ceiling, not a target. Team size is also a benchmark knob (3 vs 5).
- **Guards (wavesrv records and guards; the lead runs the room)** (my call): the soft rules (who speaks when, idle
  until called, the two-empty-turns stop) are the lead's playbook. wavesrv enforces the hard ones: the turn cap; a token
  ceiling at 1.5× the estimate, where it tells the lead to write the report now and stops the team if no report comes
  within 2 minutes; and **Stop**, which asks the lead for a report from what exists, then ends every team process after
  60 seconds whatever happens.
- **Token count**: each agent's usage is read the way arcterm already reads an agent's session tokens (the usage
  reporting in `docs/agents/`), summed per council; the header's bar and the guards use it. In scope for Phase 1.
- **Token gate**: starting a council asks `pkg/tokengate` with the estimate, as v1 does.
- **v1 councils** (my call): the record gains `version: 2` and the v2 fields beside v1's. The new Report and the
  room replay also render v1 councils (v1's summary maps to the report, its proposals and replies to messages), so the
  v1 Discussion and Summary components go away. If the benchmark keeps v1's runner as a "Quick" option, it runs
  through the same views.

## Cost levers (each is a setting the benchmark turns on or off)

1. **Read once, share notes.** A Scout (haiku) reads the files and writes a notes file of facts with `path:line`;
   teammates start from it and read code only to check or extend a point. Expected to be the biggest saving: in v1,
   round 1's reading was the most expensive part.
2. **Model by role.** Teammates sonnet, Scout haiku, lead opus; each row can change it (v1's rule).
3. **Speak when called.** A teammate idles until the lead calls it, it is @named, or a new idea lands in its area. A
   message is capped (about 120 words, my call). Agreement is a reaction.
4. **Stop when ideas run out.** The lead moves to the last phase when two turns in a row bring nothing new, instead of
   fixed rounds; a hard cap on total turns (my call: 40) guards against loops.
5. **One shared prompt prefix.** Every agent's system prompt starts with the same block (mode rules, the notes, the
   goal) so it is cached.

The UI shows tokens so far against the estimate in the room's header, and "stopped early" on the report.

## The harness

The harness is everything the agents are given: the shared prefix (mode rules, room protocol, word list, message cap),
each role's brief, the lead's playbook (phases, when to call whom, the stop rule, how to merge and rank, how to answer
the person's question first), and the report schema. It lives in Go next to the role library (`pkg/council`), versioned:
each council records the harness version it ran, so the benchmark can compare versions.

## UI (council centre mode of the Agent surface)

Drawn in the prototype; the board names are given so the builder can match them.

- **Setup** (`V2Setup`): "Start a council"; the picked mode as a chip with its reason (the board draws two mode cards;
  build the chip instead, flipping between Brainstorm and Review, each with its one sentence of rules); one
  composer (the text is the problem or the review target plus the question; the first line names the council), an
  attach button, the team picker as a chip, the estimate, **Start council**. The team as chips (name + model; hover
  gives the role's one-line brief). **Options** holds files, roles, models, team size and the cost levers. One line
  says the Scout reads once, the council stops early, and it saves to `docs/council/`.
- **Room** (`V2Room`): header with the mode, time, a token bar against the estimate, **Stop**. The 3-part phase bar.
  A row of agent chips with what each is doing ("reading councilsummary.tsx", "waits to be called", green dot when
  working). The group chat: system lines for phase changes and the Scout's notes, messages with avatar colour, name,
  label, time, a "↳" line naming the idea it is about, evidence chips, "cites nothing" chips, reactions; the person's
  own messages on a grey fill. A typing row for whoever is working. The composer: "Message the room: steer, add a goal,
  or @name one agent".
- **Report** (`V2Report` for Brainstorm, row B's `ReportDone` for Review): "You asked: …", the answer in one bold
  sentence, two or three sentences under it, who wrote it; the ranked list; per item **Start an agent on it** (v1's
  Brainstorm this, renamed) and the argument behind it (inline, a few messages, then "See how it grew" into the room);
  wild ideas kept aside (Brainstorm); **Replay the room**; **Was this useful?** (Useful / Not really, fed to the
  benchmark); the saved file's path. A `⋯` menu holds Create initiative and Run again.
- The Agent tree keeps v1's Councils label per project; a council row shows its state in words (Running, Waiting on
  you, Done) and the unread dot.
- The palette's "New council…" stays. Adding Council to the New dialog is left to the builder.

## Storage

- **Project file**: on finish (or stop), wavesrv writes `docs/council/YYYY-MM-DD-<slug>.md` in the project: the report,
  then the whole room as a transcript (who, label, text, evidence), then the run facts (mode, team and models, harness
  version, tokens, time, levers on). Not committed by arcterm. A later council with the same slug gets a `-2` suffix.
- **arcterm store**: the council JSON under the data dir (v1's `councils/<id>.json`) keeps what the UI needs, live.
- The person's rating is stored on the council and in the benchmark results.

## Benchmark

**Cases** (each with an answer key, all from the person's real work; adding a public set is left open):

1. A paper-review case was here; removed at the person's request (2026-10-22). A replacement with an answer key from
   real reviews is open.
2. **Code review**: an arcterm feature at the commit before a known `fix(...)` commit; key: the bug that commit fixed.
   Two or three such cases in the full set (Phase 0's cheap pass has one; the person's call, 2026-10-22), picked so
   the bug is findable by reading.
3. **Brainstorm**: "Council is hard for a newcomer: it opens on threads and nobody knows what to do. Fix?" on arcterm at
   commit `0a2c46437`. Key: the ideas reached on 2026-10-21/22: open the report first and move the debate behind it;
   plain words instead of code words; the vote as top-3 picks with agreement as a reaction; an answer-first report;
   done and waiting notifications.
4. One or two past design decisions from `docs/superpowers/specs/` whose outcome is known (left to the builder to pick).

**Variants**: V0 one agent (one sonnet session with all briefs merged, plus the same report step); V1 council v1 with
no argue round (Pause after round 1, then Summarize); V2 council v1 as is; V3 the agent-team council; V3 with each cost
lever turned off, one at a time.

**Scores per run**: recall of the key in the report's top items (top 5 Review, top 3 Brainstorm, for every variant);
matches among a Brainstorm report's Wild ideas kept aside are counted in a column of their own, outside recall, since
only the agent-team council writes that list (the person's call, 2026-10-22); wrong or
empty items in the report; tokens; wall time; messages. Matching a report item to a key item is done by an LLM judge
(opus is fine even though the councils are Claude too; my call) with the key and a fixed rubric, spot-checked by hand
on the first run. Two runs per variant per case to start; more where two variants are close.

**Where the cases live** (my call): in the data dir (`council-bench/cases.json` plus each case's key), not the repo,
so a case's copies and keys never reach a commit.

**Continuous**: `wsh council bench [--case <c>] [--variant <v>]` runs the set and appends to a results file in the data
dir (`council-bench.jsonl`): date, harness version, case, variant, scores. It is run by hand after any harness or model
change; an initiative chunk reminds the person monthly (Phase 3). Real councils add their Useful / Not really rating
with harness version and mode.

**Cost of the benchmark**: about 0.5–1M tokens per run. **The first pass is the cheap one** (the person chose it): cases
1–3 × V0–V3 × 1 run in Phase 0, with V3 a prompt-only agent team, roughly 8–12M tokens, repeated only where two
variants land close. The full set (4 cases × 2 runs,
~12–24M) comes later. Any pass is said to the person before it runs, per AGENTS.md.

## Phases

**Ahead of Phase 0b** (the person's call, 2026-10-22; shipped the same day in run 74b368ce): the parts that need no
agent team were built on v1's runner and views: the answer-first report, plain words, the top-3 vote with agreement as a
reaction, the done and waiting notices (a waiting council's Needs you item offers Open only), and Setup as one
composer. It extends v1's Discussion and Summary on purpose; they still go away in Phase 2 if the room ships.

0. **Probe agent teams, then benchmark them before building** (no product code; the person wants the agent team, and
   because it costs more, its worth measured first): prepare the cases and keys, run a prompt-only agent-team council
   (V3: a lead given the harness as a prompt) against V0–V2 on cases 1–3, one run each, and probe agent teams: where messages and tasks live,
   whether arcterm can read them, in-process vs separate processes, RAM per teammate, whether the lead can be told to
   run phases, whether a message can be put into the lead from outside, and whether an idle teammate can be put to
   sleep and resumed with its context. Output: a findings note
   (`docs/council-phase0.md`) and the go/no-go for V3. If agent teams cannot be observed or steered, the room uses the
   `wsh council say` path: wavesrv is the room, every agent posts and reads through `wsh`, and the agent team only
   provides the processes. **Phases 1–3 are planned after this note, not before** (my call: their plumbing depends on
   it).
1. **The room**: wavesrv room store and events, team launch, steering, stop, waiting-on-you, done notification, the
   project file, the harness v2 (both modes), the cost levers as settings, the mode pick, and the `arc:council` skill
   rewritten so an agent starts a council from the conversation.
2. **The UI**: Setup, Room, Report for both modes, plain words, tree row states, Needs you entry, toast.
3. **Benchmark tooling**: `wsh council bench`, the judge, results file, the rating, the monthly chunk; then the built
   council is run against V0–V2 and Phase 0's prompt-only V3. v1's one-shot runner is removed only if the agent-team
   council wins on score per token, otherwise it stays as a "Quick" option and this design is revisited.
4. **Later**: harness evolution (propose a harness variant, bench it, keep the better one), mixed runtimes.

## Left to the builder

- Exact message cap, turn cap, idle rules, and the judge's rubric wording.
- The slug rule and the transcript layout of the project file.
- Whether the Room's agent chips also live in the tree.
- Picking the code-review and past-decision cases.
- Whether Council joins the New dialog.

## Open questions

- Phase 0's answer on observing and steering agent teams decides the room's plumbing.
- Is a public benchmark wanted next to the person's own cases? (Asked, not answered.)
