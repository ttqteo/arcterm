# Council: add a chat to a council that already exists

Date: 2026-11-02 · Brainstorm: `.superpowers/brainstorm/council-add-chat/brainstorm.json` ·
Prototype: `.superpowers/design/council-add-chat/project/B-at-mention.dc.html`

## Why

In the council "Home page tour video", the person sent "thêm lại 82faafca và 5065bd8c vào để nói chuyện tiếp" to a
council that was already Done, expecting those two chats to join. Nothing happened. A tab id typed in a message is only
text, and UX answered that it could not see the two tabs. Chats sit in a council only at start
(`wsh council start --agent`, `councilAgentSeats` in `pkg/wshrpc/wshserver/wshserver_councilagents.go:74`). Opening
a new council would lose the 37 replies already there.

## Goals

- From a council's message box, the person adds a live claude or pi chat to a council that exists, running or Done.
  The chat then speaks from its own context.
- The joining chat is briefed short: the report and what came after it, not the whole discussion.
- The person sees what a chat costs before picking it.
- Adding a chat never changes whether the council holds drafts.

## Non-goals

- An Add chat button on the seat bar (answer 2 chose @ only).
- A `wsh` command to add a chat. `wsh council` has no reply command at all today.
- Removing a seat.
- A confirm or estimate dialog on Send (answer 4).

## What exists today

- `councilAgentSeats` resolves tab ids or unique prefixes into seats in one roster read. It refuses a tab that is not
  a live claude or pi tab and lists the live ones.
- A seat that has not spoken gets `AgentFirstPrompt` (`pkg/council/prompts.go:1065`). For a seat joining after round 1
  it already sends every sent idea and every sent reply since round 1 (`agentNews`). It never sends the coordinator's
  report.
- `Runner.Reply` (`pkg/council/runner.go:1595`) posts the person's message. On a Done, Stopped or Failed council it
  starts a follow-up round at once. `replyTargets` sends the message to the @-mentioned seats when any are mentioned,
  else to the branch's or the whole panel.
- `HoldsDrafts` (`pkg/council/types.go:78`) is "a chat is seated now and `wsh council start` did not start it".
- The composer's @ picker is `mentionPicker` (`frontend/app/view/agents/councilchatmodel.ts:833`), drawn in
  `Composer` (`frontend/app/view/agents/councilchat.tsx:911`).

## Decisions

### Where the person adds a chat (answer 2)

Typing @ in the council message box lists the seats, then the live chats under **Add a live chat**. Each chat row
shows its short id, title, harness, project and context size. Picking one puts `@<short id>` in the message, like a
seat mention. The chat is seated when the message is sent, and it answers that message. There is no other way in: no
button on the seat bar.

The list holds only the live claude and pi chats that are not seats already. A chat already seated is listed under
Seats.

**Agent's call (builder question 1): the short id is a mention key.** A chat's short id is the shortest prefix of its
tab id, 8 characters or more, that no other chat shares (plan review: two tab ids can share their first 8). The picker
tells the chats apart among the seated chats and the ones it lists, so it inserts `@82faafca` almost always, and
`@3e19c0d2a1` when another chat starts `3e19c0d2`. A chat seat answers to `@` followed by a whole word of 8 characters
or more that starts its tab id and starts no other chat seat's tab id, as `resolveAgentTab` accepts a unique prefix.
It reaches the seat as a mention, beside the seat's name and id:

- in Go `mentioned()` (just above `replyTargets`)
- in the frontend's `answerers`, `replyReach` and `mentionPicker`

So `@82faafca` reaches the seat on Send and in every later message, and two chats with the same tab name stay apart.
The picks that count are the ones whose `@<short id>` is still in the text at Send. Deleting the mention before Send
drops the pick. Before Send, the composer's "Answered by" line names a picked chat as an answerer.

### What happens on Send

The reply carries the picked tab ids with the message (`CommandCouncilReplyData` gains `Agents []string`; run
`task generate`). Then wavesrv:

1. Resolves the ids with `councilAgentSeats`. A tab that is gone or cannot be seated fails the whole send with that
   function's error, and the message is not posted. A wrong id never drops a seat silently. An id named twice is
   seated once, as `councilAgentSeats` does for a council's start, and a chat already seated is no error and gets no
   second seat.
2. Puts the new seats in `c.Experts` after the existing seats and before the coordinator, which stays last.
3. Posts the message through the existing reply path. The new chats are mentioned seats, so `replyTargets` sends the
   message to them, plus any other seat the message @s. A Done council starts its follow-up round, as a reply does
   today.

**Agent's call (builder question 4): on a running or paused council, the chat takes part in the rounds that are
left.** `replyPass` and `answersPass` reload the council, so the new seat needs no "joined at round N" guard.
`roundsWork` reads the panel once at the start of round 1 (plan review), so a chat seated during round 1 sits that
round out and takes part from round 2. The chat feeds the report, and `Continue` on a council paused after round 1
runs round 2 with it.
A chat that joins during round 2 has no ideas of its own, and its first prompt says so.

After that, each chat is an ordinary seat. It shows on the seat bar, Everyone messages and later @s reach it, and
Summarize again counts what it said. A chat that is working when its turn comes is waited for and then skipped, as a
seated chat is today (`AgentCaller.waitRest`).

### Drafts (answer 1)

A council keeps the draft mode it started with. One that ran freely, with no chat at start, keeps running freely after
a chat joins. One that held drafts keeps holding them. To make this hold, `HoldsDrafts` must stop reading whether a
chat sits in the council now.

**Agent's call (builder question 2): a stored mode, frozen at the first join for old councils.** The council stores
its draft mode as `held` or `free` (a string; empty means a record from before the field). A council started after
this ships sets the mode at start, from "a chat was seated at start, and the council was not started by an agent".
A council with no mode reads as today until a chat first joins it. The join then freezes the mode from today's rule as
it read just before the join, so a chat-free council like "Home page tour video" keeps running freely. `HoldsDrafts`
reads the stored mode whenever there is one.

### What a joining chat reads (answer 3)

On its first turn, a chat that joins after the coordinator's report gets:

- the question
- the seats
- the coordinator's report
- the messages sent after the report
- the message it answers

**Agent's call (builder question 3): what "after the report" means.**

- It means after the latest summary (`Summary.At`).
- The messages include the person's own follow-ups, whoever they went to, beside the seats' replies. Without them,
  the chat would read answers to questions it never sees.
- No ideas are replayed: the report already names the ones it keeps.

So this is a new section of the first prompt, not a filter on `agentNews`.

That replaces the full replay of every idea and reply. A council with no report yet, such as one still running, sends
everything sent so far, as a seat that joins at start gets today. The change sits in `AgentFirstPrompt` /
`agentNews`.

### Cost (answer 4)

Each chat row in the @ list shows its context size (`182k`), the same number the agent tree shows. Send seats the
chat with no confirm and no dialog. The council header's token total grows as the chat answers.

On a council that has met (a follow-up), the line under the message box already prices the answer
("2 experts answer · ~40k"), at a flat 20k per answerer. It counts the picked chats among the answerers. Every chat
answerer, seated or picked, is priced at its context size, the cost the start estimate already gives a chat's turn
(plan review, and a follow-up answer). Role experts keep the flat price. The estimate request names the chat
answerers' tab ids (`CommandCouncilEstimateData.Agents`, which a follow-up does not read today), and wavesrv reads
their contexts from the roster, as `councilAgentSeats` does. If a chat cannot be read, the line shows no figure, as it
does while an estimate loads.

## Testing

- Go: seating on reply, covering a Done council (the follow-up round starts with the new seats as targets), a running
  council, an unknown id (the send fails and nothing is posted), an id named twice (seated once), and a chat already
  seated (no duplicate). The new seats sit before the coordinator.
- Go: a chat seated during round 1 takes part from round 2; one seated on a council paused after round 1 takes part in
  round 2 after Continue. Both are in the coordinator's input.
- Go: a follow-up estimate prices each named chat at its context and each role expert at the flat price.
- Go and vitest: two chats whose tab ids share their first 8 characters get distinct mention keys, and each reaches
  only its own seat.
- Go: `HoldsDrafts` keeps a council's start mode when a chat joins. An old chat-free record keeps running freely after
  its first join, and an old record with a chat at start keeps holding.
- Go: `mentioned()` matches a chat seat's short id.
- Go: the first prompt of a seat that joins after the report holds the latest report, every message after it (the
  person's included), and no ideas. Before a report it holds everything.
- Vitest: `mentionPicker` lists the seats, then the live chats not yet seated, each with its context. It filters both
  by what was typed after @. `answerers` / `replyReach` read a picked chat's `@<short id>`, and a deleted mention
  drops the pick.
- CDP scenario: open a council, type @, and screenshot the list with the Add a live chat section. Then send to a
  fixture council and see the new seat on the seat bar. On a Done council, the line under the message box counts a
  picked chat.
