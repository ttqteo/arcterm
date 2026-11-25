# Pair an agent with a judge

Date: 2026-11-25. Brainstorm: `.superpowers/brainstorm/agent-pair-judge/brainstorm.json`.

**Prototype:** `.superpowers/design/agent-pair-judge/project`

The canvas holds three boards, all in Vietnamese sample copy taken from a real exchange in the mit-thesis project:

- `R1-center-chat-rail-decided.dc.html`: the pair's conversation in the Agent surface's centre, the Đã chốt (Decided) tab
  on the rail.
- `K2-header-button.dc.html`: the main way to start a pair, the Add judge button in the agent's header, and the header
  once paired.
- `K1-tree-menu.dc.html`: the second way, two agents picked in the Agent tree, right-click, and the small pairing sheet.

Rejected options are in `.superpowers/design/agent-pair-judge/unchosen/` and are not part of the spec.

## Why

Today the person relays by hand between two agents: one does the work (in mit-thesis, agent 61483cd6 running "Plan
oracle-tightening"), one judges it (agent 4c6ba858, asked to judge the plan). Over four exchanges the person pasted each
agent's reply into the other. The value came from the judge reading the code itself (prompt symmetry at `loop.py:177/218/298`,
the shared grader at `study_pilot.py:412`), raising ranked findings, then fixing the order of steps (lock the §16
threshold before the pilot measures, take pilot cases outside the test split). The working agent checked each finding
and stopped its long run, but had already started a probe before the judge's second opinion arrived, and the person
had to stop it by hand ("trước khi làm, đọc thử gợi ý tiếp"). The exchange ended with the working agent asking the
person exactly one question (is a 50% threshold fine).

The person wants this as an arcterm feature: the two agents talk to each other directly, as deep as they judge each
other, and the person sees each agent's messages and only steps in where a decision is theirs.

## What runs today

- `wsh agents send / read / wait` hands a prompt to a live claude or pi session and reads its last answer
  (`pkg/wshrpc/wshserver/wshserver_agentmsg.go`, `cmd/wsh/cmd/wshcmd-agents.go`, `orchestrate.SendToSession`).
- Councils can seat live agents (`2026-10-29-council-live-agents-design.md`, `2026-11-02-council-agent-seats-design.md`,
  `AgentCaller` in `pkg/council/agentcaller.go`): three rounds, a coordinator, several million tokens, ending in a report.
- **Discuss together**: Ctrl/Shift+click two agents in the Agent tree, right-click, "Discuss together"
  (`frontend/app/view/agents/agenttree.tsx:3806`) opens council Setup with them seated (`showCouncilSetupWithAgents`,
  `agentcenter.ts:138`). There is no lighter path for two agents.
- The rail has tabs that appear only while the agent has the thing: `council`, `brainstorm`, `initiative`
  (`frontend/app/view/agents/agentrailtabs.ts:21`, `RailHas`).
- Chat reads an ```` ```arc-steps ```` block at the end of a reply into a checklist (`chatsteplist.ts`: `stepBlocksOf`,
  `parseSteps`).
- Heavy shell commands: the arc mod's Bash hook routes them through `wsh jobslot` (`claude/arc-mod/hooks/jobslot-core.ts:42`),
  and `jobslotClassify` decides heavy from memgate plus the commands wavesrv has measured heavy
  (`cmd/wsh/cmd/wshcmd-jobslot.go:312`).

## Decisions

### A pair, not a council (answer 1)

A pair is one working agent and its judge. Each side's reply passes to the other on its own, and the working agent
waits for the judge before it runs anything heavy. The exchange runs until the two agree or something needs the
person, then the person gets one place showing what was agreed and what still waits on them. A council is not used for
this: it is too heavy for two agents talking.

### How a pair starts (said after question 3)

- **Main way (board K2): Add judge in the working agent's header.** It is used at the moment the person reaches a
  message they want judged. The menu offers **Open a new judge** (a new tab in the same project, briefed with the plan
  or spec at hand and the agent's latest reply) or any live agent in the project as the judge. Once paired the button
  reads "Paired with judge `<id>`" with a count of new messages, and opens the conversation.
- **Second way (board K1): the Agent tree.** With two agents picked, the right-click menu gets **Pair: worker + judge**
  above Discuss together (which keeps opening council Setup). A small sheet names who works and who judges, with Swap,
  the "hold heavy commands until the judge answers" box (on by default), an optional note to the judge, and Pair.
- No `/judge` slash command.

### Judges (answer 5)

One judge by default. Pressing Add judge again adds a second or third judge to the same pair. A judge arcterm opens
runs **Opus**, in the working agent's project.

**Agent's call (builder question 4), several judges:** the working agent's reply goes to every judge; judges see each
other's messages (it is one conversation); judge messages that arrive while the working agent is busy are batched into
one prompt for its next turn, not one turn per message. A held heavy command waits until every judge has answered.

### Where the conversation shows, and how it reads (answer 4, after pushbacks on boards A to G)

Board R1. Pressing the Pair button (or finishing pairing) turns the working agent's centre into the pair's
conversation; the agent's name in the header goes back to its own Chat.

- Reads like messaging between two people, top to bottom in time order: the working agent's messages lean left, the
  judge's lean right. With several judges, each right-side message names its judge.
- Every message is shown in full, as its own block with a head (who, time). There are **no rounds**: no round counter,
  no "round 2/4" anywhere.
- A message that answers another quotes the line it answers at its top (a click scrolls to it). Reply on hover answers
  that message.
- One composer at the bottom talks to both; `@worker` or `@judge` talks to one.
- The person's own messages show in the timeline too.
- A held command shows as one dashed line in the working agent's message with **Run now**.

The rail gets a **Decided** tab (the "Đã chốt" of the board) while the agent is paired, beside Overview, Files and
Changes. From top to bottom: **Waits on you** (each item with its answer chips, as on the board), **Agreed** (numbered,
each linking to the message where it was settled), **Still open**. It updates as they talk.

Rejected along the way: the judge folded into the working agent's Chat (A), two chats side by side (B, D: two columns
drift apart in time and are hard to read), a council-style channel with bubbles and coloured stance pills (C: too rough),
a transcript with a points board (G: felt like a council, not messaging), the whole pair as a rail tab (R2).

### What passes, and when it stops (answer 6)

- **Every reply** of each side passes straight to the other. No agent in between (nothing like the council's router or
  coordinator) chooses what passes or who speaks.
- The pair stops and shows its result when: the judge says it has no new points; nothing is left still open (only
  agreed items and items waiting on the person); or the pair passes its token cap (builder question 3: counted like council run facts, Input + CacheRead + CacheCreation + Output of every session in the pair since pairing; default 3M, changeable on the pairing sheet).
- **Waits-on-you items (builder question 2):** an item waiting on the person does not halt the exchange; the two keep
  talking about the other items, as board R1 shows. The person's answer (a chip or typed) goes to both the working
  agent and the judge(s).
- Stopping is said by the two agents themselves in their messages.
- **After a stop (builder question 1):** the pair pauses relaying but stays paired. The person's answer, or a new reply
  of the working agent, starts relaying again. The heavy-command hold keeps applying while paired; Unpair ends it.
- **Agent's call (builder question 3):** arcterm detects a stop from machine-readable marks, never by reading prose: the
  working agent's block (D/O/A lines) plus a "no new points" line in the judge's marking syntax. With several judges the
  pair stops only when every judge has said it has no new points.
- **Agent's call (builder question 7):** while paired, every turn of the working agent passes to the judge, including a
  turn the person starts in the agent's own Chat ("every reply"). Relaying hooks the session's turn end. To work with
  the agent without the judge, Unpair.

### Holding heavy commands (answer 7)

While the judge has not answered the working agent's latest reply, the working agent still reads, edits files and runs
light commands. A heavy command (the job queue's rule: `jobslotClassify`) waits until the judge answers. The held
command shows in the conversation with **Run now**, which lets it through.

**Mid-turn (builder question 4 of the check, answered "hold, tell the agent to end its turn"):** a heavy command the
working agent starts in the middle of a turn is held too. The hook refuses it with a reason telling the agent to end its
turn and say which command it means to run. That reply passes to the judge like any other; once the judge answers, the
working agent runs the command in its next turn. No message goes to the judge mid-turn. This is what stops the
mit-thesis case, where the probe started in the same turn that proposed it.

### Who writes the Decided list (answer 8, the judge's pick)

The working agent, which is always exactly one, ends each reply with a numbered block: `D1` agreed, `O2` still open,
`A3` waits on the person. Judges write no list of their own: a judge that disagrees with an item names its number in
its message, and arcterm moves that item back to still open until the working agent changes it. arcterm reads the block
the way Chat reads `arc-steps` (`stepBlocksOf` finds the fence by name, `parseSteps` reads its lines) and draws the
Decided tab from the newest block plus the judges' marks. No third model, no comparing free text.

The judge's brief has to say plainly that it reads the block and marks items by number. Also to settle (builder): how
long a marked item stays open, and what happens when the working agent drops a number from its block.

## Left to the builder

- The block's format and the judge's marking syntax, in the style of `arc-steps`.
- The first brief to a new judge: the plan or spec at hand, the current reply, "read the real code before you conclude".
- How messages pass: `wsh agents send` / `SendToSession`, as `AgentCaller` does for council seats.
- Where a pair lives in wavesrv so it survives a restart.
- What Unpair does to a held command (let it run).
- UI strings follow the app's language rules; the boards' Vietnamese is sample copy.
- CDP scenarios that show R1 (the conversation and the Decided tab), K1 and K2.

## Decisions made while planning

Made by the lead of the autonomous run that planned this (2026-11-25), each with why. The plan
(`docs/superpowers/plans/2026-11-25-agent-pair-judge.md`) builds on them.

### Where a pair lives and who runs it

- **A pair is a JSON file, `<wave data dir>/pairs/<pairId>.json`**, written atomically (`fileutil.AtomicWriteFile`),
  with an in-memory index of the active ones rebuilt on first use, as board forwards rebuild theirs from the talk files
  (`pkg/wshrpc/wshserver/wshserver_boardforward.go`). Why: it survives a wavesrv restart with no SQL migration and no new
  waveobj type; a pair is one record with its own conversation, which a file holds whole.
- **The logic is a new package, `pkg/agentpair`**: the stored types, the block parsers, the Decided view, the stop rule,
  the briefs (pure), and a `Manager` that owns the store, the relay and the hold. wshserver only adapts it: RPC handlers,
  a `Link` over the live roster (`deliverToAgent`, `agentsessions.LastAnswer`), and two hooks. Why: the relay is the
  part that has to be right, and a package with an injected `Link` is testable without a store or live agents.
- **The server parses the blocks, never the frontend.** The stop rule needs them and the Decided tab draws them; one Go
  parser serves both and the wire carries the parsed Decided lists (`PairView.Decided`) and message bodies with the
  blocks taken out. Why: one source of truth; the frontend only draws.
- **An agent is in at most one active pair, on either side.** `PairStart` refuses a second. Why: a judge in two pairs
  would have its every reply relayed to both, and nothing in the spec needs it.
- Pairable harnesses are claude and pi, the ones a council can seat (`seatHarnesses`), since a reply is read with
  `agentsessions.LastAnswer`.

### The blocks

- **The working agent's block** is a fence named `arc-pair` at the end of its reply, one item per line:
  `D<n> <text>`, `O<n> <text>`, `A<n> <question>`. Any item may add ` — <note>` (an em dash, or ` -- `) for the second
  line the board shows; an `A` item may end with `[<chip> | <chip>]`, its answer chips. Numbers are the item's for life
  and never reused; the block lists every item each time. A line that does not parse is skipped. The last top-level
  `arc-pair` fence of a reply counts; fences are found as `stepBlocksOf` finds `arc-steps` (a closing fence of the same
  character at least as long; a fence left open runs to the end).
- **A judge's marks** are a fence named `arc-judge`: `reopen <n>: <why>` (`reopen D2: …` or `reopen 2: …`),
  `new: <point>`, and `no new points` (any case). The spec's "judges write no list of their own" holds: `new:` only
  flags a point the working agent has not listed yet. Why `new:` exists at all: the stop on "nothing left open" must not
  fire when the judge raised a point in prose that the working agent never saw listed, and arcterm reads no prose.
- **How long a marked item stays open:** until the working agent's next block. Marks are read only from judge messages
  newer than the newest block, so a block written after the mark is the working agent's answer to it; a judge that still
  disagrees reopens it again. **A number the working agent drops** is gone from the Decided tab: the newest block is the
  whole list.
- **An agreed item links** to the oldest message in the unbroken run of blocks, back from the newest, in which that
  number was `D`.
- **A message quotes the line it answers** when the reply starts with a Markdown quote line (`> …`): that line becomes
  the quote and leaves the body. Without one, the quote is the first line of the message it answers. Each relayed
  reply answers the newest message relayed to its author; a person's Reply on hover names its message.
- The shown body of a message has its `arc-pair` / `arc-judge` fence and its leading quote line taken out; the raw text
  is what the file stores.

### What passes, and when

- **Each agent has a queue in the pair** of messages waiting for it, persisted in the file. A working agent's message
  queues for every live judge; a judge's message queues for the working agent and for every other judge; the person's
  goes where its `@` sends it (both by default). A queue is delivered as **one prompt** when its agent is at rest (idle
  or asleep: a send wakes a sleeper) and the queue holds a message that calls for an answer: for a judge, a message of
  the working agent or the person; for the working agent, a judge's or the person's. Another judge's message waits in a
  judge's queue as context for its next prompt and never starts a turn by itself. Why: judges see one conversation,
  but two judges answering each other would talk past the working agent forever.
- Delivery is tried right after a message queues, on every turn end of that agent (an idle or asleep status), and on a
  resume. An asking agent is busy: its queue waits.
- A relayed prompt opens with the agent message header (`agentmsg`'s envelope prefix, so Chat and the hooks read it as
  not typed by the person), saying the pair relays it and the reply passes back on its own (no `wsh agents send`).
  The working agent's first relayed prompt starts with the worker brief: it is paired, every reply passes to the
  judge(s), end every reply with the `arc-pair` block, heavy commands wait for the judge.
- **The judge brief** (a new judge's launch task, or a live agent's first prompt): whose work it judges, the plan or
  spec at hand (the `plans/` / `specs/` Markdown paths the working agent's recent turns name, for the judge to read
  itself, not pasted), the working agent's latest reply, "read the real code before you conclude, cite file:line, rank
  findings", the `arc-judge` marks with an example, "start your reply with `> ` and the line you answer", "you judge:
  do not edit files or run heavy commands", and the person's note.
- **A turn ends** when a paired agent reports idle (`baseds.AgentState_Idle`; no status event says asleep, which is a
  roster state only) and its `LastAnswer` is newer than the last one the pair took from it. At wavesrv's boot the
  manager loads every active pair, takes any answer a member gave while it was down, and tries every queue, so a
  restart neither blinds the hold nor strands a prompt for an agent that is already idle. Every turn of the working agent passes, a turn the person started in its own Chat included (spec).
- **At pairing** the working agent's latest reply is the conversation's first message, and the judge owes an answer to
  it. A judge arcterm launched is briefed by its launch task (`briefed`); a live agent picked as judge gets the brief as
  its first prompt.

### Stops

- **Owed:** a live judge owes an answer while the working agent's newest message is newer than that judge's newest.
- The stop rule runs when the last owed judge answers: **no new points** when every live judge's reply since the working
  agent's newest message has `no new points` and no `reopen` or `new:`; **settled** when the newest block came with the
  working agent's newest message, has no `O` item, and every judge's reply to it carries an `arc-judge` fence with no
  `reopen` or `new:`. **Token cap** runs on every turn end of a member: Input + CacheRead + CacheCreation + Output of
  every session in the pair since the cap's start (`agentsessions.TokensSince`), default 3,000,000. **Judges gone**
  when no judge is live.
- On a stop the pair writes one system line ("Paused: the judge has no new points", "Paused: both agree", "Paused:
  token cap reached (3.0M)"), stops delivering, and keeps its queues. The judge replies behind a no-new-points or
  settled stop are not delivered to the working agent: they ask nothing of it, and delivering them would start a turn
  that restarts the exchange.
- **Resume:** the person's message resumes any stop; a new reply of the working agent resumes all but a token-cap stop.
  A token-cap stop resumes only by the person, and the cap then counts again from that moment. Why: after the cap a
  reply of the working agent would pass the cap again at once, and spending more is the person's call.

### Holding heavy commands

- **The hold is in wavesrv's `JobSlotCommand`**, not in the mods: every agent hook (the Claude mod's Bash hook, the pi
  extension, agy) already sends each heavy command there with its block, and a light or long-running one never reaches
  it. A heavy command from a working agent whose pair holds (paired, hold on, a judge owes) is refused with
  `run: false` and a reason: "Held: arcterm holds heavy commands while your judge has not answered your last reply.
  End your turn now and say in your reply that you mean to run `<cmd>`; once the judge answers, run it in your next
  turn." The mods already deny a refused command with its reason, mid-turn included. Why: one place, every harness.
- The refused command is recorded on the pair and shown on the working agent's next message as the dashed held line.
- **Run now** grants a one-time pass for that exact command (consumed by its next `JobSlotCommand`), marks the line as
  let through, and sends the working agent a person message, shown in the timeline: "Run `<cmd>` now: the person let
  it through without waiting for the judge."
- **Unpair** ends the pair (its file stays, state `ended`, and it leaves the list) and lifts the hold. A held command
  not yet let through is let run: the working agent gets one line naming it and saying it may run it now.

### The interface

- RPCs (`pkg/wshrpc/wshrpctypes_pair.go`): `PairList`, `PairGet`, `PairBrief`, `PairStart` (pair, or add a judge to the
  working agent's pair), `PairSay`, `PairRunNow`, `PairUnpair`. Event `pair:update` (`PairUpdateData`: the pair id and
  its working agent's tab) after every change; the frontend re-reads the pair on it.
- No `wsh pair` command: nothing in the spec asks an agent or a script to pair.

### The views

- **The conversation is a new centre mode, `pair`** (`agentcenter.ts`, beside council, project, held and board), with
  `pairSelAtom` and `showPair`. Any route that chooses an agent calls `showTerminal()` already, which leaves it. Its top
  bar: the working agent's name (back to its own Chat), the judges with their state, and Unpair.
- The person's own messages draw across the timeline's width, headed "You" and whom they went to.
- **Header (K2):** unpaired, an **Add judge** button with the menu (Open a new judge, or the project's live claude and pi
  agents not in a pair). Paired, **Paired with judge `<id>` · N new** opens the conversation, beside a small Add judge
  icon button that adds another judge; the agent's state line reads "waiting on judge" while a judge owes. A judge's own
  header shows **Judging `<worker id>`**, which opens the same conversation. N new counts messages since the person last
  had the conversation open (per pair, in the frontend, kept in localStorage).
- **Open a new judge** launches a claude tab with `--model opus` in the working agent's folder (its worktree when it
  has one, so the judge reads the same code), with `PairBrief`'s text as its task. The judge tab takes the focus while
  it boots (a process starts only when its terminal mounts); once its row has reported in, `PairStart` runs with
  `briefed` and the focus goes back to the working agent. `PairStart` takes an answer the judge already gave to its
  brief.
- **The pairing sheet (K1)** also has the token cap (in millions, default 3).
- **Decided** is a rail tab after Changes, there while the agent is paired (as working agent or judge), reading the
  pair's `Decided` lists, with an amber dot while Waits on you is not empty (the board's). An open item a judge reopened says so; a judge's `new:` point shows under Still open as the
  judge's until the next block. A Waits-on-you item answered by the person shows the answer until the next block.
- UI strings are English, as the rest of the app (it has no translation layer); the boards' Vietnamese is sample copy.
- CDP scenarios: `pair-conversation` (R1's centre), `pair-decided` (R1's rail tab), `pair-header` (K2) and `pair-tree`
  (K1), each seeding a pair into the page's atoms over the dev mock roster, so no agent runs.
