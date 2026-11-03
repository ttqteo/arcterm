# Council: route a whole-council message to the right seat

Date: 2026-11-03. Brainstorm: `.superpowers/brainstorm/council-reply-routing/brainstorm.json`.

## Why

A message the person sends to the whole council (no @, not in an idea's thread) runs every seat today. That costs
tokens (~20k per role seat answering from text, ~110k with tools, a seated chat's whole context), gives the person a
pile of messages to read, and the answers often repeat each other. The person wants fewer tokens, fewer words and no
duplicate answers: one seat answers, or two when the message asks about two different things, and the others answer
only when asked.

## What the code does today

- `replyTargets` (`pkg/council/runner.go:1650`): a reply that @-mentions seats goes only to them (`mentioned`,
  `runner.go:1624`, by name, id, or a chat's tab-id prefix). In a thread it goes to the proposal's author and every
  seat on the path to the parent. With no proposal and no parent it goes to the whole panel (`panelOf`, every seat but
  the coordinator, `runner.go:190`).
- The answers pass (`runner.go:1410-1445`): `firstAnswerers` (`runner.go:1451`) picks, for each open reply, the first
  seat **in panel order** it is addressed to; that seat answers alone (`answerAll` with a `take` filter). Then
  `answerAll(..., nil)` runs every other addressed seat at once, shown the first answer.
- `othersAnsweredRule` (`pkg/council/prompts.go:305`) tells the later seats not to repeat the first answer and to leave
  `text` empty when they have nothing new, but every one of them still costs a call.
- Seated chats sit after the role seats and before the coordinator (`seatBeforeCoordinator`, `runner.go:1721`), so a
  role seat is the one that answers first.
- A cheap no-tools call already exists: `autoGenerate` calls `r.Caller.Call` with `Tools: false`
  (`pkg/council/autogen.go:98`).
- Each seat has `Name` and `Brief` (`pkg/council/types.go:56-58`): what it looks at.

## Design

### 1. Which messages go through the router

The router runs only for a reply of the person's with no proposal, no parent and no @-mention: the "whole panel"
branch of `replyTargets`. It runs when the message is sent, whether the council is still running or done, and narrows
the reply's `To` at once. A message sent before round 2 (or at the pause after round 1) is then taken up in round 2 only
by the chosen seats (`unansweredFor`, `agentAsks`); every seat still runs its round 2, so this saves words and
duplicates, not tokens, and two chosen seats answer it in parallel there without seeing each other. After the synthesis
and in a follow-up (the answers pass), the token saving applies and a second chosen seat runs after the first, as
below. Everything else keeps today's routing:

- A message that @-mentions seats goes straight to them.
- A reply in an idea's thread goes to the proposal's author and the seats on the path to the parent: that branch is
  already narrow.
- A message that seats a live chat (picked under Add a live chat) goes to that chat, as today (`withJoined`,
  `runner.go:1704`): the person seated it for this message, so the router does not run. *Agent's call.*
- `Continue`'s question (stored with `To` = the whole panel, `runner.go:1885`) is the council's own question and is
  not routed. *Agent's call.*

**Where the pick lives.** The router's pick replaces the reply's `To`, so `owed`, `unansweredFor`, `agentAsks`,
`personLine` and `retrySeat` work unchanged. A new field on `CouncilReply` (e.g. `Routed {Reason, Failed}`) records
that `To` came from the router, for the router line and the chips. When the chosen seat's call fails, Retry reruns
that seat, as for any failed seat; the router does not pick again. *Agent's call.*

### 2. The router

Before any seat is called, one **sonnet** call with **no tools** reads:

- the person's message (and its attachments' names, not their contents),
- the last few messages of the Discussion, so a message like "what about that one?" resolves,
- the `Name` and `Brief` of every seat in the panel, seated chats included (a chat's brief is its title and project).

It returns the seat to answer and a one-sentence reason. It usually returns **one** seat; it returns **two** only when
the message plainly asks about two different areas. Never more than two.

Only the chosen seats run. With two, the second runs after the first and is shown its answer (today's
`othersAnsweredRule`), so it adds only what is new. The second `answerAll` pass over the rest of the panel does not run
for a routed message.

### 3. How the pick is shown

The chosen seat's answer carries a small line above it: `Router chose <seat>: <reason>`. Under the answer is one chip
per other seat in the panel, `Ask <seat> too`. Pressing a chip **reopens the original message** for that seat: the
seat is added to the reply's `To`, `Answered` is cleared, and the seat answers under the same message, seeing the
answers already there through `othersAnsweredRule`, so it adds only what is new. The message is not posted twice, and
the router does not run again on a reopened reply (its `Routed` field marks it). In a done council this starts a
follow-up for that seat. It needs its own wshrpc command (an "ask seat too" on a reply id), so `task generate`.
*Agent's call.*

If the router fails (the call errors, or it names no seat or a seat that is not on the panel), the message falls back
to the first addressed seat in panel order, as `firstAnswerers` picks today, with **no** second pass, and the line
reads `Router failed, <seat> answered`.

### 4. Asking every seat on purpose

`@all` in the message (or `@everyone`) skips the router and sends the message to every seat, answered as today: the
first seat in panel order answers, then the rest, shown its answer. The composer's @ menu gets an **All seats** row
that inserts `@all`.

### 5. Whether the chosen seats read files

*Proposed by another session (2026-11-03); confirmed by the person.*

Today Let them read files turns itself on only when the question names a file or a path (`readsFiles` + `namedFile`,
`frontend/app/view/agents/councilchatmodel.ts:848-883`). "Review the v5.1 we just fixed" names no file, so it stays
off and the seats answer blind ("I only have v5"). Keyword guessing is too brittle, and the router already reads what
the decision needs (the question, the last few messages, the seats' briefs).

- The router's result gains `tools`: `{"seats": ["ux"], "tools": true, "reason": "..."}`. It is true when the question
  needs something not in the Discussion: a new or fixed version, code or a file earlier replies cited but did not copy
  in.
- The composer's switch becomes three states, **Auto / On / Off** (`readsFiles` already takes `choice: boolean | null`,
  `null` being auto). On or Off set by the person is never changed by the router. An attached image or an `@file` still
  locks it On, whatever the router says.
- The estimate before sending: in Auto the router has not run, so the footer shows a range (both branches, with and
  without files). The router line names the decision: `Router chose UX · reading files: <reason>`.
- Scope: the router decides `tools` only for the messages it routes (section 1). A message with an @-mention, a reply in
  a thread, or one that seats a chat keeps the `namedFile` heuristic; no extra router call is made just to decide files.
  *Agent's call:* a second call per message would spend tokens on every @-message to save some on a few.
- A failed router falls back to the `namedFile` heuristic for `tools`, beside the seat fallback in section 3.

## Left to the builder

- The router prompt, its return shape (JSON: `seats`, `reason`) and parsing.
- How many recent Discussion messages the router reads.
- Where the router sits in `Reply` / the answers pass (`runner.go`), and where its pick is stored (on the
  `CouncilReply`, so the Discussion can draw the router line and the chips).
- `EstimateFollowup` (`pkg/council/estimate.go:105`) prices one or two seats plus one router call instead of the
  whole panel.
- Go tests with a fake `Caller`: one seat chosen, two seats chosen, an @-mention skips the router, `@all` reaches every
  seat, a failed router falls back to the first seat with no second pass; the router returns `tools` true and false;
  the person's On or Off beats the router; an image or an `@file` locks On; a failed router falls back to `namedFile`
  for `tools`.
- One `CHANGELOG.md` line.

## Not in this change

- Routing replies inside an idea's thread.
- A setting to turn the router off for a council.

## Decisions made while planning (autonomous run, 2026-11-03)

Nobody was at the cockpit for this run; each call below is the one the builder would recommend, with why.

### Where the pick lives on the wire

`CouncilReply` gains `Routed *CouncilRouted` (`pkg/council/types.go`), set only on a reply the router takes up:

```go
type CouncilRouted struct {
    Pending   bool     `json:"pending,omitempty"`   // the router has not answered yet: To is empty meanwhile
    Chose     []string `json:"chose,omitempty"`     // the seats the router (or its fallback) picked, in its order
    Reason    string   `json:"reason,omitempty"`    // the router's one sentence; on Failed, why it failed
    Failed    bool     `json:"failed,omitempty"`    // the router failed: Chose is the fallback seat
    AutoTools bool     `json:"autotools,omitempty"` // Let them read files was Auto (no image, no @file): the router sets Tools
}
```

- **`To` stays empty while the router works** (`Pending`). `owed`, `unansweredFor`, `agentAsks` and `firstAnswerers`
  read `To`, so a pending reply is owed by nobody and no seat can answer it before it is routed, with no new check in
  any of them. *Why:* `To` stays the single source of who answers; a pending flag every reader had to check would be a
  second one.
- **`Chose` is kept apart from `To`.** `Ask <seat> too` adds a seat to `To`; the line keeps saying whom the router chose,
  and the chips are the panel seats not in `To`.
- **`To` keeps the router's order** (`Chose`), and `firstAnswerers` walks `pr.To` in order (skipping seats not on the
  panel or with a failed call) instead of walking the panel. Every reply stored before this change has `To` in panel
  order already (`replyTargets`, `withJoined`, `Continue`), so their behaviour is unchanged; a routed reply's first
  answerer is the router's first pick.

### When the router runs

The router does not block the send: a sonnet call through `claude -p` takes 10–20 s, and the message would not show for
that long. *Agent's call.*

- `appendPersonReply` decides whether the reply is routed: no proposal, no parent, no seat @-mentioned, no `@all` /
  `@everyone`, no chat seated by this message, and **two or more candidates** (panel seats with no failed call). A
  routed reply is stored with `To` empty and `Routed{Pending: true, AutoTools: …}`. With one candidate the reply goes to
  it, unrouted (there is nothing to choose); with none it goes to the whole panel as today.
- `Reply` starts the router at once in its own goroutine after the save (`context.Background` with a 2-minute timeout),
  whatever the council's state: the pick shows within seconds, also at the pause after round 1, where no run is on.
- Every pass that reads the person's replies routes the still-pending ones first and waits for a router already in
  flight: `replyPass` (rounds 2 and 3) and `answersPass` call `routePending(ctx, id)` before they load their snapshot.
  The Runner keeps one in-flight channel per reply (`routing map[string]chan struct{}` under `r.mu`), so the goroutine
  `Reply` started and a pass never make two router calls for one reply. *Why:* a reply left pending by a wavesrv restart
  is routed by the next pass, and no pass runs on a reply nobody has routed.
- The router call is booked on the council (`Calls++`, `Tokens += …`), not on any seat's `Stats`. The router is no seat:
  it draws no card and no activity row.
- The router candidates are the panel seats with no failed call (`routeCandidates(c)`, beside `panelOf` in
  `runner.go`); a pick that names a seat outside them is dropped.
- A routed post's reach line names the seats in its `To` (`For UX`), never `For everyone`, even when the router chose
  every seat of a small panel: the router chose them, the person did not ask everyone.
- **Fallback**: when the call errors, returns nothing parseable, or names no candidate, `Chose` = the first candidate in
  panel order, `Failed: true`, `Reason` = the error in one line, and `Tools` stays what the composer sent (the
  `namedFile` heuristic). `To` = `Chose`, so the second `answerAll` pass has nobody left to run.
- `MarkStale` (wavesrv's startup) routes every reply still pending, in the background, in any state: a wavesrv that
  quit in the router's 10–20 s left it pending, and in a done or stopped council no pass would ever come to route it, so
  its post would read `Router is choosing a seat…` for good. Routing it there only settles the pick and its line: the
  reply stays open and unanswered, and the answers pass of the next follow-up the council runs (the next message the
  person sends) answers it with the rest.

### `Reply`'s signature

`Runner.ReplyWith(id string, in ReplyIn)` is the entry point, `ReplyIn{ProposalId, ParentId, Text, Tools, ToolsAuto,
Seats, Attachments}`; `Reply(...)` stays as a thin wrapper with `ToolsAuto: false`. *Why:* `Reply` has 49 test callers
whose meaning does not change; a person's On or Off is `ToolsAuto: false`, which the router never overrides.
`CommandCouncilReplyData` gains `ToolsAuto bool` (`toolsauto`): the composer sends it when its switch is Auto and no image
or `@file` locks it, with `Tools` holding the `namedFile` guess (the fallback). The router sets `Tools` only when
`Routed.AutoTools`.

### Ask <seat> too

`CouncilAskTooCommand(CommandCouncilAskTooData{Id, ReplyId, ExpertId})`, `Runner.AskToo(id, replyId, expertId)` in its
own file, `pkg/council/asktoo.go`. It is
refused unless the reply is the person's, routed and no longer pending, and the seat is on the panel and not in `To`.
It appends the seat to `To`, clears `Answered`, and posts as `Reply` does: a council that is done, stopped or failed with
no run on starts a follow-up at once; any other state saves the change, and the run that is on (or the next round) takes
it up. `Reply` and `AskToo` share one helper for that launch-or-save step. The new seat is not the first answerer (the
reply already has answers), so the second `answerAll` runs it, shown the answers there (`othersAnsweredRule`).

### `@all`

`@all` and `@everyone` (whole words, `mentions`) make `replyTargets` return the whole panel and skip the router; an
`@all` beside a seat's name still reaches every seat. The frontend mirrors it in `answerers`. The `@` picker gets an
**All seats** row first in its Seats group when the query is empty or a prefix of `all` or `everyone`; picking it
inserts `@all `.

### The router call

A new file `pkg/council/router.go`: `ModelRouter = "sonnet"`, `routerPrompt(c, pr, candidates)`, `parseRoute(text,
candidates) (Route, error)` with `Route{Seats []string; Tools bool; Reason string}`, and `(r *Runner) routeCall(ctx, c,
pr, candidates) (Route, CallRes, error)`. The prompt holds the person's message, its attachments' base names, the last
**6** sent messages of the Discussion (ideas and replies by `Ts`, each `Author: text` cut at 500 characters), and one line
per candidate (`id — Name: Brief`; a chat seat with no `Brief` reads `a live chat: <Name>`). It asks for one JSON object
`{"seats": [...], "tools": bool, "reason": "..."}`: one seat unless the message plainly asks about two different areas,
never more than two; `tools` true only when the answer needs something the Discussion does not hold (a new or fixed
version, code or a file a reply cited but did not copy in). `parseRoute` reads it with `decodeReply`, matches a seat by
id or name (any case), drops unknown and repeated ones, keeps at most two, folds the reason to one line of at most 200
characters, and errors when no seat is left. *Why 6 messages:* enough for "what about that one?" to resolve, small
enough that the call stays near the no-tools price.

### The estimate

`EstimateRouted(c, tools, toolsAuto) CouncilEstimate` prices router + one seat (low) up to router + two seats (high),
with a new `routerTokens = 15_000` (a sonnet `claude -p` call with no tools; re-measure once real routed messages run).
A seat costs its chat context or the flat follow-up price (`followupTokens`, `followupToolsTokens`); the low end prices
the cheapest candidate, the high end the two dearest (one, when there is one candidate). With `toolsAuto` the low end
reads no files and the high end does (the spec's "range, both branches"); otherwise both ends use `tools`.
`CouncilEstimate` and `CouncilEstimateRtnData` gain `CallsMax` and `TokensMax` (omitempty, set only for a range);
`CommandCouncilEstimateData` gains `Routed` and `ToolsAuto`. The composer asks for it on a follow-up whose message the
router would take, and draws `Router picks 1–2 seats · ≈ 2–3 calls · ~35k–235k tokens`.

### How it is drawn

- The composer's switch becomes a three-way **Read files: Auto · On · Off** control (`drafts.tools` null / true /
  false), shown wherever the switch shows today. An image or `@file` locks it on On. In Auto the existing
  `· it names <file>` note stays for a message the router does not take; for one it does, the note reads
  `· the router decides`.
- Under a composer whose message the router would take, the hint reads `The router picks who answers` (outside a
  follow-up) or the range above (in one).
- Above the first answer to a routed reply, a small muted line: `Router chose UX: <reason>`, `Router chose UX and RAM:
  <reason>`, `Router chose UX · reading files: <reason>`, or `Router failed, UX answered`. While `Pending`, the person's
  post shows `Router is choosing a seat…` where it shows its pending label today.
- Under the last answer to a routed reply, once it is no longer pending, one small chip per panel seat not in `To`:
  `Ask RAM too`. Pressing one calls `CouncilAskTooCommand`; the chip goes busy until the council changes, and a refusal
  shows inline like the composer's error.
- One new CDP scenario, `council-routing`, with its own fixtures and its own scenario file, shows each of these.
