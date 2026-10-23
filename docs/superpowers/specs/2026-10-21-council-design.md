# Council: a panel of expert agents that reviews a feature

Status: built, awaiting hand checks (design agreed 2026-10-21; the checks are the Council lines in
`docs/open-issues.md` "0 · Waiting on a hand check"). Prototype: `.superpowers\design\council\project\`
(canvas `council`, gitignored; boards Main = Discussion, Summary, Setup, Running, Paused).

## What it is

A Council takes one existing feature (or a spec, a plan, a paper draft) and a few expert roles. Each expert reviews it
from one angle, the experts argue over each other's proposals, and a coordinator turns what survives into ranked
directions to develop it further. It reads the code and never edits it.

It is not a brainstorm for new ideas, and it is not a way to build in parallel: building stays with the engine
(`pkg/orchestrate`). It is not Claude Code's agent teams either: experts are one-shot `pkg/consult` calls run in
rounds, not live sessions, so a council costs a counted number of calls and opens no terminal.

## Rounds

1. **Proposals.** Every expert runs at once, read-only (`claude -p --tools Read,Grep,Glob`, the tool list Radar's
   audit already uses, `pkg/reporadar/audit.go:21`), with the project folder as `cwd`. Each returns JSON: proposals
   (title, argument, evidence) and a short overall view.
2. **Cross-review.** Every expert gets the other experts' proposals as text (no tools) and gives each one a stance,
   `accept | challenge | oppose`, with one line of reason, then revises or withdraws its own proposals that were
   challenged.
3. **Synthesis.** The coordinator merges duplicate proposals, ranks the directions, attaches each expert's stance to
   each direction, and marks as `weak` any claim that cites no evidence.

**Evidence** is a `path:line` in the project or a region of an attached screenshot. A claim without one is drawn weak
(an amber chip) and the coordinator says so.

**Pause after round 1** (off by default) stops the council in `awaiting-you` after round 1: you untick proposals not
worth a review and may ask the experts something; round 2 reads only what you kept (board Paused).

**Synthesis runs once by itself** when round 2 ends. After that the discussion stays open: a reply or a follow-up
marks the Summary `Outdated · N replies since`, and **Summarize again** reruns round 3 on the discussion so far.

**Follow-ups** work after the council is done, days later too. Each question opens a short round with only the experts
it reaches: a reply in a branch goes to the experts in that branch, `@RAM` to one expert, **Ask the whole council** to
all of them. Each call is sent the expert's own proposals and the branch it argued in, as text, so its answer follows
on; an expert is given its read-only tools again only when you turn on **Let them read code** in the composer, and
the cost label says so, with the higher estimate, before you send.

## Experts, groups and models

- **Roles** live in a library: a name, a one-paragraph brief (the angle and what counts as evidence), a default model.
  Built-in roles ship in Go; the person's own go in `councilroles.json` in the config dir, the way `tools.json` extends
  `pkg/arctools`.
- **Groups** are saved sets of roles picked in one go. Two ship: **Review a UI feature** (UX, RAM, New user, Skeptic)
  and **Paper review** (Reviewer A for the venue's security bar, Reviewer B for baselines and datasets, Reader for
  prose: terms used before they are defined, sentences that read as machine-written; the coordinator acts as area
  chair). **Save as group** on Setup adds one; a group holds library role ids only, so a suggested role added to the
  panel and a per-row model change are not kept (Setup's note names what was left out).
- **The coordinator suggests roles** for the feature at hand from the files it is given (Setup's dashed rows: "Mac
  user: the frame reload is Windows-only for now"); you add or ignore them. It is one sonnet call when Setup has a
  feature and a file to read (a few tens of thousands of tokens, read-only tools), which also proposes the files the
  experts read; Setup works without it, with the group's roles and the files you pick.
- **Models:** experts default to sonnet, the coordinator to opus; each row can change it. Rounds 2 and 3 read only
  text, so they cost far less than round 1.
- One runtime, claude, in this version. Mixing runtimes (codex, agy, which `pkg/consult` already runs) is deferred
  until a benchmark says whether a single model's blind spots matter.

## Starting a council

Two ways, and nothing starts a council by itself: each costs 0.5–1.5M tokens.

1. **By hand.** New → **Council** (a project picked; 2026-10-23: it replaced the tree's New council row), or the palette's "New council…",
   opens **Setup** (board Setup): feature, question, the files the experts read (the coordinator picks them from the
   spec; you add or remove), a pasted screenshot, the group and each row's model, suggested roles, Pause after round
   1, and the estimate (`≈ 9 calls · ~0.8M tokens · ~6 min`). **Start council** runs it. An open `question` line in
   an agent's Ideas list has **Ask the council** too: it opens Setup with that question filled in, the session's
   project, and a group the coordinator suggests for it; the council's directions come back into that session's Ideas.
2. **An agent offers it,** the way `writing-plans` offers the Arc engine: a numbered choice at a natural point (a
   direction just weighed, a spec just written, a plan before it goes to the engine, a paper draft before it is
   submitted), naming the group, every model and the estimate. Picking it is the yes: the agent runs
   `wsh council start --group <g> --feature <f> --files <...>` at once, with no second question and no Setup. The
   skill is `skills/council` (embedded by `skills/skills.go` like the others, `arc:council` in Claude).

The agent's start passes through `pkg/tokengate`. The Claude mod asks the gate only before an `Agent`, `Task` or
`Workflow` tool call, and `wsh council start` arrives as a Bash command (which the mod sends to `wsh jobslot`), so
`wsh council start` asks the gate itself, as `wsh tokengate` does, with a new spawn kind, `Council`, priced from the
council's own estimate. A refusal prints `Not run: …` and starts nothing. Start council on Setup is itself the yes:
the button shows the estimate. `--queue` waits while another council is running, as `wsh runs start --queue` does.

**An agent that started a council reads it back:** it runs `wsh council wait <id>`, sums the directions up in the
conversation, and carries on (a spec, a plan) from there.

## Where it lives

A council is a centre mode of the Agent surface, `council`, beside `terminal | session | run | history | canvases`
(`view/agents/agentcenter.ts:23`). The Agent tree lists a project's councils under a **Councils** label inside its
folder (`projectTree`, `agentsidebarmodel.ts`), after its agents and before its terminals: each council with its state
(`Round 2`, `Waiting on you` in amber, `Done`, `Not run`). A project with no council has no Councils label (2026-10-23:
the tree's New council row moved to New → Council). A project with a council has a folder even with no agent or
terminal.
Council rows are not focus targets: `j`/`k` keep moving between agents and terminals.
No new surface and no nav rail entry.

### Discussion (the main view, board Main)

- **Header, one line:** the feature, a chip with the round (`Round 2 of 3 · 2 replying`), a stack of the experts'
  avatars (the ones writing lit with a green dot, the rest dimmed; hovering one names what it is doing:
  `Skeptic: Replying to UX on P2`), then `7:20 · 19 replies · 0.55M tokens`, **Summarize**, and Stop council.
- **Body: one proposal as a thread,** Reddit-style. The post carries a score (accepts minus opposes), its author,
  round and time, the argument, and its evidence chips. Replies nest under it with thread lines; each reply carries
  its stance and a **Reply** button. A reply being written shows as a dashed row (`Skeptic is writing a reply…`). Your
  own replies sit in the branch you answered, tinted, and labelled until they are answered: `Queued for round 2` when
  posted before round 2 starts (round 2 answers it), `Answered after the summary` when posted during round 2 or 3 (a
  short pass right after the synthesis answers it, and the Summary then reads `Outdated`).
- **Right column:** **Ask the whole council**, then the proposals ranked by score, the one open selected, a green dot
  on those someone is replying in, a withdrawn one dimmed with its negative score.

While round 1 runs (board Running) the body shows each expert's card with what it is reading
(`Grep "IdleSleep" in pkg/services`) and the proposals as they arrive; Summarize stays off until round 1 is done.

What an expert is reading comes from the tool events of its stream: `claudeParseLine`
(`pkg/consult/consult.go`) returns `tool_use` events as well as text, and `RunClaude` hands each to the council's
`OnTool` callback.

### Summary (board Summary)

Opened by Summarize, with a breadcrumb back to the Discussion.

- The coordinator's paragraph, then the **directions ranked**: each a row with its rank, title, where it came from
  (`Merged UX P2 + RAM P3`), one chip per expert with its stance, and `Agreed` or `Split`. A row opens to the
  coordinator's reasoning, each expert's position with evidence, weak claims flagged, and **Brainstorm this** and
  **Ask the experts again** (which goes to that direction's thread in the Discussion).
- Under the directions, the **Matrix**: proposals × experts, each cell a stance and one line of reason, and an
  Outcome column (`Direction 1`, `Merged into direction 3`, `Withdrawn in round 2`).
- Header actions: **Save as doc**, **Create initiative**, Run again.

## What comes out

- **Ideas.** Each direction becomes a line in the Ideas list of the agent session that started the council (topic
  `Council · <feature>`); a Summarize again adds a line only for a direction whose title the earlier Summary did not
  have. A council
  started by hand has no session: its directions stay on the council, and **Brainstorm this** opens a claude agent in
  the project, seeded with the direction and its thread, whose Ideas list then holds it.
- **Save as doc** writes the Summary and Matrix as markdown into the project (`docs/council/YYYY-MM-DD-<feature>.md`
  unless the person picks another path) and shows the path; nothing is committed.
- **Create initiative** makes a `wsh effort` initiative with one chunk per direction, for once the person has decided
  to build.

## Backend

- **`pkg/council`** runs the rounds and owns the council record. It is a file per council,
  `<data dir>/councils/<id>.json`, the way `pkg/ideastore` keeps a file per session: no waveobj and no migration. It
  holds the project, feature, question, inputs (file paths, screenshot paths), experts (role, brief, model), Pause
  after round 1, state (`running | awaiting-you | done | not-run | stopped | failed`), each round's structured
  result, the replies and follow-ups, the session that started it (if any), and the token count.
- **`pkg/consult` changes** (built as `RunClaude` and `ClaudeArgs`, `pkg/consult/exec.go`, `consult.go`): per-call
  `--model` and `--tools` arguments for claude, with `--strict-mcp-config` so the account's connector tools do not
  load; `tool_use` events from the stream; and token usage from claude's final `result` event, since `RunWithUsage`
  returns an empty `Usage` for a CLI runtime. `Usage.TotalTokens` is the sum of all four counts, cache reads included,
  so a council's token figure reads higher than Radar's audit total, which leaves cache reads out. An empty reply
  counts as a failed call.
- **RPC and events:** a `wshrpctypes_council.go` group (start, list, get, reply, continue, summarize, stop, retry,
  suggest, estimate, save-doc, roles, save-group) and a `council:changed` event in `pkg/wps/wpstypes.go`, regenerated with `task generate`.
- **`wsh council start | estimate | list | show | wait | stop`**, the agent-facing commands; `estimate` prints the
  group, every model and the estimate and starts nothing, for an agent's offer.

## Failures

- **An expert fails** (exit, timeout, unparseable JSON): its card says so with **Retry**; the round goes on without it
  and the coordinator names who was missing. Retry reruns that expert's call in the round it failed in. An expert
  that failed in round 1 sits round 2 out. A failed coordinator leaves the council `failed` with Retry on round 3.
  A Retry that succeeds restores the state the council had before it, so one that failed with every expert gone in
  round 1 stays `failed`, with its error, until Summarize (its next step, not a round 2) makes it `done`. A Retry of a
  round 1 failure on a council that is already done adds only that expert's proposals: nobody has reviewed them and
  the Summary is not rerun, so the Discussion says so on each such proposal and Summarize ranks them with the rest.
- **arcterm closes while a council runs:** at the next start every council left `running` is marked `stopped`, with
  `arcterm closed during round N`; the rounds that finished stay and Summarize works on them.
- **The gate refuses:** `wsh council start` saves the council as `not-run` without running it; its tree row says
  `Not run`, and its Discussion offers **Start council** (with the estimate), which is the yes.
- **Stop council** keeps whatever rounds finished; Summarize works on them.
- **Empty state:** a project with no council shows no Councils block; New → Council starts one.

## RAM and cost

A council holds no process between rounds: each call is a `claude -p` that exits. Round 1 runs one process per expert
at once (four in the shipped groups). A call with tools claims a slot in wavesrv's job queue first (`jobqueue.Hold`
in `pkg/council/caller.go`, 512 MiB each as the estimate, the way the engine's Verify queues), so on a tight machine
the experts wait their turn instead of all starting together; a call without tools (rounds 2 and 3) answers from text
and starts at once. The 512 MiB is a guess: open-issues' RAM watch has a pending row to measure it on the first real
run.

## Testing

- Pure models beside their views, with vitest: the round state machine, stance scoring and ranking, the Outdated
  count, the thread tree from replies, the estimate.
- Go tests for `pkg/council`'s rounds against a fake consult runtime, and for the consult parser's `tool_use` and
  usage events.
- CDP scenarios `council-discussion`, `council-summary`, `council-setup` over a fixture council.
- **Acceptance:** replaced by the benchmark in `2026-10-22-council-agent-team-design.md`.

## Deferred

- arcterm suggesting a council by itself in Needs you (a spec committed, a plan about to go to the engine, a deadline
  near).
- Mixed runtimes per council.
- A screen to manage the role library beyond Save as group.
