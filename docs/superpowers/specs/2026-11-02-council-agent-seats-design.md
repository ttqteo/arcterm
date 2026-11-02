# Council: an agent seats the chats you name

Status: design, agreed in brainstorm `.superpowers/brainstorm/council-agent-seats/` on 2026-11-02. Builds on
`2026-10-29-council-live-agents-design.md` (live-agent seats, shipped), which this file amends only where it says so.

## Why

On 2026-11-02 the person asked an agent in the website project for a council on "v5 này + 5065bd8c + 71d93e40": the
current chat plus two other tabs. Council 7096c31c came back with four fresh role experts (UX, RAM, New user, Skeptic)
and a coordinator, 3.62M tokens, and none of the chats sat in it:

- The starting agent (tab 82faafca) wrote 5065bd8c's knowledge as a six-row table in `council-context.md`; the experts
  read that summary, never the tab.
- 71d93e40 was not a live tab. The agent asked, "skip and run anyway" was picked, and the council ran without it.
- `wsh council start` has no way to seat a tab (`cmd/wsh/cmd/wshcmd-council.go:966-984`), so the default group
  `ui-feature` (`pkg/council/roles.go:112`) filled every seat.

Live-agent seats already exist: since 10-29 a seat with `CouncilExpert.Agent` set (`pkg/council/types.go:62`) takes its
turn in that tab through `AgentCaller` (`pkg/council/agentcaller.go`), but only Setup and the agent tree's multi-select
can seat one. The 10-29 spec kept `wsh council start` expert-only on purpose, so an agent's council never waits for a
click. This design opens that path.

## Goals

- When the person names chats for a council, those chats sit in it and speak from their own context, not from a
  summary someone else wrote.
- The seats are the named chats, one fresh Skeptic, and a fresh coordinator who writes the report.
- A council an agent starts runs to the report by itself, even with chats seated.
- A wrong tab id never silently drops a seat.

## Non-goals

- Native Claude Code peer messaging (`SendMessage`) between seats: arcterm cannot see that traffic today.
- Forking a tab's session for its seat: the live tab answers (decided, answer 3).
- Changes to Setup or the agent tree's "Discuss together and in council": they keep holding drafts.
- Council v2's fresh agent team (`2026-10-22-council-agent-team-design.md`), benchmarked no-go.

## Decisions

### Who sits (answer 2)

The chats the person names, plus one fresh Skeptic (sonnet, read-only, the existing `skeptic` role) who looks for holes
in what the chats say, plus the fresh coordinator (opus) who writes the report. A chat that did the work tends to defend
it; the Skeptic and the coordinator are the outside view.

The agent may add a few more role experts beside them when the question needs a view no seat has (UX for a UI
question, RAM for a memory question), with `--expert <role id>` (repeatable), and says why in its started line
(builder answer: "có thể thêm 1 số expert khác nếu cần thiết").

### How a seated chat speaks (answer 3)

As today: the runner sends each round into the tab only once it is idle or sleeping, reads its last answer, waits up to
10 minutes for a busy tab (then the seat skips that round) and up to 20 minutes for the answer. `AgentCaller` and
`liveAgentLink` are unchanged. The talk lands in each tab's own transcript.

### No held drafts when an agent starts it (answer 4)

Amends the 10-29 spec's "Held drafts only where an agent sits". Today `heldFor` (`pkg/council/runner.go:969`) holds every
answer whenever `HasAgents(c)`. New rule:

- A council started by `wsh council start` runs to the report with no held drafts, chats seated or not.
- A council started from Setup or the agent tree keeps today's rule: with an agent seated, every answer is held for the
  person's Send, Edit or Drop.

The council record carries which path started it, so the runner (and a restart that resumes it) knows. The person can
still post or @ a seat in the room while it runs, as with any council.

### The chat that starts it is a seat (answer 5)

The starting chat takes a seat **only when the person names it** ("this chat", "v5 này"; builder question 1): the agent
then passes `--agent self`. `wsh council start` never adds it on its own, and a council an agent starts with no chat
named stays expert-only (`ui-feature` / `product-ideas`, foreground `wait`), exactly as today, at today's price.

A seated starter runs `wsh council wait <id>` in the background (Claude Code's `run_in_background`,
with `--timeout 0`). Its turn ends, so its tab reads idle: each round reaches it as a new prompt, which it answers like
any seated tab, and the background wait's exit brings it the report. A pi starter has no background shell, so it does
not seat itself; the skill says so and it tells the person.

### Naming the seats on the command line (answer 6)

`wsh council start` gains `--agent <tab id>` (repeatable) and `--agent self` (the tab running the command, the id
`wsh agents list` shows).

- Each must be a live claude or pi tab. Otherwise start fails before the Token burn gate, naming the bad id and listing
  the live tabs it can see (id, project, title, as `wsh agents list --all` prints them). The agent asks the person which
  they meant, then starts again. It never starts without a seat the person named.
- With any `--agent` and no `--group`, the panel follows the mode, as `councilGroupFor` already does: a new group
  `agents` (Skeptic plus the coordinator) for review, and a new group `agents-ideas` (Contrarian plus the Facilitator)
  for brainstorm, both in `pkg/council/roles.go`. **Agent's call:** answer 2 asked for one outside voice and a fresh
  writer; in brainstorm mode, where judging waits and the Facilitator writes the report, the Contrarian is that
  voice and the Facilitator that writer, so a brainstorm with seated chats still ends on ideas to try, not ranked
  directions. An explicit `--group` still adds its roles beside the chats.
- Seats may span projects, as the 10-29 spec allows; the council belongs to the starting project.
- The estimate counts each seated tab as its current context times the rounds, as Setup's estimate already does
  (`pkg/council/estimate.go:52`), so the Token burn gate prices it.
- `wsh council estimate` takes the same `--agent` flags.

### What the skill tells the agent

`skills/council/SKILL.md`:

- When the person names chats or tabs for a council, pass each as `--agent`, and `--agent self` only when they name the
  current chat ("this chat", "v5 này"). Do not summarise another tab into a file for the panel. A council with no chat
  named stays expert-only, as today.
- Add `--expert <role>` only when the question needs a view no seat has, and say why.
- With `--agent self`, run `wsh council wait <id> --timeout 0` in the background and answer each council turn that
  arrives as a prompt; sum up the report when the wait exits.
- If start fails on an id, ask the person with the printed list; never run without a seat they named.
- A pi agent does not seat itself; it says so.

## Implementation (lead's recon, 2026-11-02)

What the builder questions above settle into, grounded in the code as it stands.

### The record and the wire

- `Council` gains `ByAgent bool` (`json:"byagent,omitempty"`): started by `wsh council start`. It is kept through
  `Record` (a refused start saved as not run) and `StartSaved`, so a not-run agent council the person later starts from
  the app still runs without held drafts.
- `CommandCouncilStartData` gains `Agents []string` (tab ids or unique prefixes, in seat order) and `ByAgent bool`;
  `CommandCouncilEstimateData` gains `Agents []string`. `wsh council start` always sends `ByAgent: true`; Setup and the
  agent tree never set it. `task generate` regenerates the bindings.

### Seats are resolved in wavesrv, once

- One function in `pkg/wshrpc/wshserver/wshserver_councilagents.go` turns `Agents` into seats, from the same roster
  `liveAgentLink.find` reads (`resolveAgentTab`, `seatHarnesses`, `seatContext`): each is
  `CouncilExpert{Id: "agent-<tabid>", Name: <tab name>, Agent: <tabid>, Harness, Context}`, the same shape Setup's
  `agentSeat` builds (`frontend/app/view/agents/councilmodel.ts`). A tab named twice sits once.
- An id that is not a live claude or pi tab fails the whole call with an error naming the id and listing every live
  claude and pi tab, one per line: short id, project, title (the columns `wsh agents list --all` prints). Nothing is
  seated without it.
- Both `CouncilEstimateCommand` and `CouncilStartCommand` call it. `wsh council start` prices the council before it asks
  the Token burn gate, so a bad id fails at the estimate, before the gate; a tab that closes between the estimate and the
  start fails the start the same way.
- The panel is the resolved seats first, then the role experts wsh sent, the coordinator last.

### wsh

- `--agent <tab>` (repeatable) on `start` and `estimate`. `--agent self` is replaced in wsh by `getTabIdFromEnv()`
  (`cmd/wsh/cmd/wshcmd-root.go`); outside an agent's terminal it fails with "--agent self runs only inside an agent's
  terminal".
- `--expert <role id>` (repeatable) on `start` and `estimate` adds that role from the role library before the
  coordinator; an unknown or repeated id, or a coordinator role (`coordinator`, `areachair`, `facilitator`), fails,
  listing the role ids it takes. It works with or without `--agent`. (It is not `wsh council retry --expert <seat>`.)
- With any `--agent` and no `--group`, `councilGroupFor` picks `agents` (review) or `agents-ideas` (brainstorm).
- The started line names the seats, counted from the council wavesrv returns (a tab named twice sits once):
  `council <id> started: <feature> · review · Chats with a Skeptic · 2 chats + Skeptic · ≈ 7 calls · ~1.4M tokens`
  (2 chats and a Skeptic over 2 rounds, plus the summary); with no chat seated it stays as today (`4 experts`). The
  gate's agent count, asked before the start, is the number of `--agent` flags plus the role experts.

### pkg/council

- Built-in groups gain `{Id: "agents", Name: "Chats with a Skeptic", Roles: ["skeptic"], Coordinator: "coordinator"}`
  and `{Id: "agents-ideas", Name: "Chats with a Contrarian", Roles: ["contrarian"], Coordinator: "facilitator"}`.
  Setup's group picker lists them too, like any group, but Setup's suggestion (`Runner.Suggest`) never offers or
  accepts them: with no chat seated they are a panel of one.
- One predicate, `HoldsDrafts(c) = HasAgents(c) && !c.ByAgent`, replaces `HasAgents` wherever the runner decides on
  holding: `heldFor`, the `held` of `roundsWork`, and `heldRoundAfter` (`pkg/council/runner.go`). `HasAgents` keeps
  its other uses (the rounds a council honours, the estimate, the picks wording). `--pause` therefore pauses an agent
  council after round 1 as it does an expert-only one.
- `AgentFirstPrompt` says "Nothing you say reaches the others until the person sends it" only when the council holds
  drafts; an agent council's seats are told what they say reaches the others as they write it, and that the person is in
  the room and may post or @ a seat.

### Tests

- Go: the flag (a good id, a prefix, a bad id with the tab list, `self`, a seat from another project, a tab named twice),
  `--expert` (known, unknown), the group a start with agents picks per mode, the started line; the no-hold rule (an
  agent council with agents and `ByAgent` runs every round with nothing held and reaches done, also when it was saved
  not-run and started later), Setup's council still holding; the suggestion leaving the two groups out; the agent
  prompt's two wordings.
- No vitest or CDP change: the chat already draws a council with agent seats and no held drafts.

## Left to the builder

- A hand check with a real council from a chat with `--agent self` and one other tab, logged in `docs/open-issues.md`
  "0 · Waiting on a hand check".
