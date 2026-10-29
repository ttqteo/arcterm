# Council with live agents, and a Slack-style council chat

## Why

Sometimes two agents have each done work with their own context, and the person wants them to discuss it together in
one room. A council today cannot do that: its experts are fresh one-shot `claude -p` calls (`ConsultCaller`,
`pkg/council/caller.go`) that carry no session. Separately, the person wants the council's discussion to read like a
Slack channel with threads instead of today's group-chat feed and Reddit-style thread.

## What runs today

- `pkg/council` runs three rounds of one-shot calls through the `Caller` interface (`pkg/council/caller.go`); the
  runner never starts a process itself. Experts are `CouncilExpert` (`pkg/council/types.go`), with a `Brief`.
- `CouncilProposal` is a top-level idea; `CouncilReply` carries `proposalid` and `parentid`, so threads fit the data as
  it is.
- UI: `councilfeed.tsx` (group chat while running), `councilthread.tsx` (Reddit-style thread once ended),
  `councilsummary.tsx` (the report), `councilsetup.tsx` (Setup), all shown in the Agent centre with
  `centerMode = "council"` (`agentcenter.ts`, `showCouncil` / `showCouncilSetup`).
- `wsh agents send / read / wait` (spec `2026-10-06-agent-to-agent-commands-design.md`) delivers a prompt to a live
  claude or pi session through `orchestrate.SendToSession` and reads its last answer. Server side:
  `AgentsSendCommand` / `AgentsReadCommand` (`pkg/wshrpc/wshserver/wshserver_agentmsg.go`); `--wait` is a client-side
  loop over read (`cmd/wsh/cmd/wshcmd-agents.go`, `agentsWait`).

## Decisions

### Where it lives

A room is a council whose seats include live agents. It is listed under Councils in the Agent sidebar and shown in the
Agent centre like any council. There is no separate Rooms section.

### Which councils get the new chat

Every council, expert councils and agent rooms alike, shows its discussion as a Slack-style chat with threads. It
replaces the running feed (`councilfeed.tsx`) and the after-the-end Reddit-style thread (`councilthread.tsx`). The
Summary report view stays as it is.

### Chat look

Each idea (`CouncilProposal`) is a channel message with a reply chip ("3 replies", the avatars of who replied, the time
of the last reply). Every reaction to it (`CouncilReply`), the person's included, lives in its thread, which opens as a
side panel. Agreement with nothing to add stays a reaction on the idea's message, as today.

### Who sits in the room

A council can seat live agents and role experts (fresh `claude -p`, as today) side by side. The coordinator writes the
summary as it does now.

### Who drives the turns

The seats answer each round by themselves for a capped number of rounds (default 2; Setup offers 1, 2 or 3), then
the coordinator writes the summary. The person can post to everyone or @ one seat at any time.

**Every answer waits for the person.** Left on auto, the talk drifts from the person's original idea, so nothing one
seat says reaches another seat until the person sends it. Each answer arrives in the channel as a held draft with
**Send to the others**, **Edit** and **Drop**. An edited draft is sent as edited; a dropped one reaches no one. The next
round starts once every draft of the round is sent or dropped. The council waits on the person with no timeout, and
its header and its row under Councils say it waits for them. The coordinator writes the summary from sent messages
only. This replaces the copy-by-hand relay (A's answer pasted into B, B's into A) the person does today. A message the person
posts, or an @ to one agent, reaches that agent at its next round turn, with the other messages since its last turn;
after the last round it is answered in the follow-up pass, as today. No off-round turn is ever started, so a round
turn and a person-triggered turn never both go into one live session.

Within a round every seat answers at once, as experts do today (`forEachExpert`); a round lasts as long as its slowest
seat, a busy agent at most 10 minutes more.

Agent's call: the Rounds switch shows only when an agent is seated; expert-only councils keep today's fixed shape
(`roundsWork`, `pkg/council/runner.go`). Rounds counts the ideas round too: 2 is today's shape (ideas, one reply pass)
and the default; 1 is ideas then the summary; 3 adds a second reply pass that reuses the round-2 prompt and parser.
Picks (`applyPicks`) are taken only in the last reply pass. The synthesis and follow-ups move to round numbers above
the last reply pass (today `Round = 3` and `followRound` 4+), and councils saved before this are read as today;
`MarkStale`, `Retry` and `CouncilFailure.Round` follow the moved numbers. `Estimate` / `EstimateRemaining` count the
extra passes.

### How an agent seat speaks

An agent seat takes its turn in the agent's own live session: the council sends the turn's prompt through the same
path as `wsh agents send` (`orchestrate.SendToSession`) and reads the answer back as `wsh agents read` does. The
room's talk lands in that agent's transcript, and the agent is busy while it takes its turn. Only claude and pi
sessions can be seated (the ones `wsh agents` reaches).

Implementation shape: an `AgentCaller` beside `ConsultCaller` implementing `Caller`, chosen per expert by a new seat
kind on `CouncilExpert` (an agent seat names its block/tab id; a role expert stays as today). It sends, waits until the
session stops working, and returns the last answer as `CallRes.Text`. Tokens for an agent turn are read from the
session's usage delta where available, else estimated from its context size.

### When an agent is busy at its turn

When an agent's turn comes while it is working or asking the person, the council waits until it is idle (the
`wsh agents wait` condition), up to 10 minutes. Past the cap the chat shows a line that the agent skipped this round
("Witness synthesis skipped round 2: still working on its own task after 10 min", with Open its terminal), and the
council goes on. The message is never sent into a running turn.

Agent's call: a council with agents shares the one council slot (`holderLocked` / `waitsOnLocked`). A council queued
behind it says which council it waits for and, when that council waits on a busy agent, which agent.

### What an agent gets each turn

An agent already holds its own context. Its first turn sends the council question, the other seats (names, and
whether each is an agent or an expert) and the answer shape the experts use. Each later turn sends only the messages
sent (as approved or edited) since its last turn: the previous rounds' and the person's, never a seat's answer from the same round, since
seats answer a round in parallel. The answer is parsed like an expert's (`pkg/council/parse.go`); an answer that does not
parse is posted as a plain reply.

### How you start one

Select two or more agents in the Agent tree and right-click **Discuss together**: council Setup opens with them seated,
and there the person writes the question and adds role experts. Setup also gets an **Add agent** picker. The tree has
no multi-select today, so this adds it (Ctrl/Cmd+click toggles a row, Shift+click extends).

Agent's call: seats can span projects. The council belongs to the first selected agent's project (`Council.Project`):
its role experts run there, its document is saved there (`docpath.go`), and Setup's header names it with "+ N more"
for the other projects.

### Cost shown before start

The Setup estimate (`pkg/council/estimate.go`) counts an agent seat as its current context size (the figure the tree
shows) times the rounds, so a 625k agent for 2 rounds shows about 1.3M before the start. The Token burn gate prices
it as it does every council.

### Held drafts only where an agent sits

A council holds its seats' answers as drafts only when at least one agent is seated, and then every seat's answer is
held, the experts' too. An expert-only council runs to the summary as today, so a council an agent starts with
`wsh council start` never waits for a click.

### Waiting on drafts frees the slot

When every seat of a round has answered (or skipped) and a draft is held, the run ends and saves the council
`awaiting-you`, the state the round-1 pause uses, at the round it is in. It holds no council slot meanwhile, as any
council that waits on the person, so another council can run. Settling the last held draft of the round (Send or
Drop) starts the next round at once, as Continue does today: a person's action, never queued. The round-1 pause
(`PauseAfterRound1`) is not offered when an agent is seated, since the held drafts are the pause.

### What is held, and the edges

- Only ideas and replies with text are held. An agreement reaction (agree with nothing to add) applies at once. A
  seat's withdrawal or revision of its own idea rides on its reply and takes effect only when that reply is sent; a
  dropped reply cancels it.
- An agent seat that was sent its turn and has not answered after 20 minutes counts as skipped ("Witness synthesis gave
  no answer in round 2 within 20 min", with Open its terminal), and the council goes on. A late answer is not taken.
- After the summary, an agent seat's answer to the person's follow-up is held like any other. The council stays done,
  and Send or Drop only settles it; nothing reruns.
- A post or an @ the person makes while a round runs reaches each seat it names at that seat's next round turn; after
  the last round, the follow-up pass answers it.
- Continue (the round-1 pause) refuses a council that has held drafts.
- j/k move over ideas only while focus is inside the council channel or its thread. Elsewhere they keep the Agent
  surface's agent navigation. Enter opens the focused idea's thread; Esc closes it and gives j/k back.
- At start a council is refused when it seats the same agent twice, an agent as coordinator, an agent that is not
  claude or pi, or Rounds outside 0 to 3.

### Wire shape

- `CouncilExpert` gains `agent` (the seated agent's tab id; empty for a role expert), `harness` (claude or pi) and
  `context` (its context tokens when it was seated, for the estimate).
- `Council` gains `rounds` (1 to 3; 0 reads as 2, so councils saved before this read as today). The synthesis is round
  `rounds + 1` and follow-ups start at `rounds + 2`: for 2 rounds, today's 3 and 4+. One Go helper and one TS helper
  each derive these numbers; nothing else hard-codes 3 or 4.
- `CouncilProposal` and `CouncilReply` gain `draft` (empty once sent or never held, `held`, `dropped`) and `edited`. A
  held or dropped item reaches no seat's prompt and not the synthesis.
- `Council` gains `skips`, one `{expert, round, reason, ts}` per skipped agent turn, drawn as the skipped line.
- One new command, `CouncilDraftCommand {id, itemid, action: send | edit | drop, text}`; `edit` replaces the text and
  sends it.
- `pkg/council` declares an `AgentLink` seam (a tab's state: idle, working, asking, sleeping or gone, and its context
  size; send a text; its last answer and that answer's time). `wshserver` implements it over the agent roster,
  `deliverAgentMessage` (waking a sleeping agent the way `wsh agents send` does) and `agentsessions.LastAnswer`, so
  `pkg/council` imports nothing from `wshserver`. The Runner picks `AgentCaller` for a seat with `agent` set and its
  `Caller` otherwise.

## UI

Prototype: `.superpowers/design/council-live-agents/project/` (`Main.dc.html`, `Setup.dc.html`).

**Main (a running council).** The header keeps its title, step chip ("Round 2 of 2"), mode, cost, Summarize and Stop
council. Under it, one chip per seat: avatar, name, `agent · <context>` or `expert · <model>`, a state dot and what
it is doing. A click on an agent chip opens its terminal (`showTerminal`). The channel holds the person's question, a
divider per round, each idea as a message with its evidence chips, reply chip and agreement reactions, a held draft
(amber tint, "Waiting for you", Send to the others / Edit / Drop; a reply draft sits in its thread), a skipped-turn
line, and a typing row. While drafts wait, the step chip reads "Round 1 · 2 drafts wait for you". The composer posts to everyone; `@` asks one seat. The thread opens as a 400px panel on the
right: the idea on top, then its replies with their stance pills (has doubts, builds on it, is against it, replies),
then a reply box that names who will answer. The idea whose thread is open is highlighted in the channel. Esc closes
the thread.

**Setup.** The question composer as today; a **Seats** list (agents first, then experts and the coordinator), each
row with its per-turn cost and a remove button; **Add agent** and **Add expert**; a **Rounds** 1 / 2 / 3 switch
(default 2); one line saying the talk lands in the agents' transcripts and that a busy agent is waited for up to
10 minutes. The estimate in the composer bar splits out what the agents cost.

**Agent tree.** A seated agent's row says `in council` beside its state.

## Testing

- Go: `AgentCaller` with a fake send/read seam (sent, busy then idle, busy past the cap → skip, asking → wait, parse
  failure → plain reply); held drafts (a round waits until every draft is sent or dropped, an edit is what the next
  turn gets, a dropped draft reaches no seat and not the summary); the runner with a mix of agent and expert seats; the estimate with agent seats.
- Frontend: the chat's pure model (channel items, thread items, reply chips, skipped lines) beside the existing
  `councilfeedmodel.test.ts`; Setup model with agent seats; tree multi-select model.
- CDP: rewrite `council-discussion` for the channel and an open thread; add a step for Setup with agents seated.

## Left to the builder

The exact prompt an agent seat gets each turn and how its free-form answer is parsed into an idea or a reply; keeping
councils saved before this readable in the new chat; the CDP scenario `council-discussion` rewritten for the channel
and thread; keyboard (j/k over ideas, Enter opens the thread, Esc closes it).
