# Council: route a whole-council message to the right seat

**Spec:** `docs/superpowers/specs/2026-11-03-council-reply-routing-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/...`
**Check:** `task check:ts && go vet ./pkg/council/... ./pkg/wshrpc/...`
**Final:** `node scripts/cdp/final-verify.mjs council-routing council-discussion`

Read the spec first, its "Decisions made while planning" section above all: it fixes the wire shapes
(`CouncilRouted`, `ReplyIn`, `CommandCouncilAskTooData`, the estimate range), when the router runs, its fallback and
how each piece is drawn. Every task below follows it; a task that has to depart from it says so in its report.

Go is the source of truth for the wire types: never hand-edit `frontend/types/gotypes.d.ts`,
`frontend/app/store/wshclientapi.ts` or `pkg/wshrpc/wshclient/wshclient.go`; change the Go and run `task generate`.
Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash) in front of `go test`. A Go test
fakes `Caller` (see the fakes in `pkg/council/runner_test.go`); no test calls a real model. Frontend logic goes in the
pure `*model.ts` files with vitest tests beside them; `.tsx` stays thin (AGENTS.md "Frontend conventions"). Colors come
from the `@theme` tokens only (DESIGN.md). No CDP scenario spends tokens: a model-calling RpcApi command is replaced in
the page (`stubRpc`, `scripts/cdp/council/fixtures.mjs`). The shared fixtures file `scripts/cdp/council/fixtures.mjs`
and the `rail-apps-*.json` files are not edited: the `council-routing` scenario builds the councils its steps need
inside its own file (`scripts/cdp/council/routing.mjs`) and writes them with `writeCouncil`/`seedCouncil`'s pattern.

### Task 1: The wire: Routed on a reply, ReplyWith, ToolsAuto, the AskToo command
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/council/types.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/council/asktoo.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

The small interface every other task builds on. No router yet: nothing sets `Routed` in this task except tests, and
`AskToo` is a stub that Task 7 fills in.

- `pkg/council/types.go`: add `CouncilRouted` exactly as the spec's "Where the pick lives on the wire" gives it, and
  `Routed *CouncilRouted \`json:"routed,omitempty"\`` on `CouncilReply`, with a comment in the file's style.
- `pkg/council/runner.go`:
  - `type ReplyIn struct { ProposalId, ParentId, Text string; Tools, ToolsAuto bool; Seats []CouncilExpert; Attachments []string }`
    and `func (r *Runner) ReplyWith(id string, in ReplyIn) (*Council, error)`, which holds today's `Reply` body.
    `Reply(id, proposalId, parentId, text string, tools bool, seats []CouncilExpert, attachments ...string)` keeps its
    signature and calls `ReplyWith` with `ToolsAuto: false`. `ToolsAuto` is carried down to `appendPersonReply` as a new
    parameter (`toolsAuto bool`, after `tools`) and unused there until Task 4.
  - Pull Reply's launch-or-save step (the `r.active[id] == nil && state is done/stopped/failed` launch with
    `followRound` + `followupWork`, else a plain `Update`, then `r.changed` and `start`) into one helper,
    `func (r *Runner) post(id string, change func(c *Council) error) (*Council, error)` (it takes `r.mu` itself, loads
    the council, refuses not-run and queued, and applies `change` in the same save), used by `ReplyWith` now and by
    `AskToo` in Task 7.
  - `func routeCandidates(c *Council) []CouncilExpert` beside `panelOf`: the panel seats with no entry in `c.Failed`, in
    panel order (Tasks 3 and 4 use it).
- `pkg/council/asktoo.go` (new): `func (r *Runner) AskToo(id, replyId, expertId string) (*Council, error)` returning
  `errors.New("ask seat too is not built yet")`, with a doc comment saying what Task 7 makes it do (the spec's
  "Ask <seat> too").
- `pkg/wshrpc/wshrpctypes_council.go`: `ToolsAuto bool \`json:"toolsauto,omitempty"\`` on `CommandCouncilReplyData`
  (document: Auto switch, no image or @file; Tools then holds the composer's guess);
  `CommandCouncilAskTooData{Id, ReplyId, ExpertId}` (`id`, `replyid`, `expertid`) and
  `CouncilAskTooCommand(ctx, data CommandCouncilAskTooData) error` on `CouncilCommands`; on
  `CommandCouncilEstimateData` add `Routed bool \`json:"routed,omitempty"\`` and `ToolsAuto bool \`json:"toolsauto,omitempty"\``;
  on `CouncilEstimateRtnData` add `CallsMax int \`json:"callsmax,omitempty"\`` and `TokensMax int64 \`json:"tokensmax,omitempty"\``
  (the estimate handler fills them in Task 3; leave them zero here).
- `pkg/wshrpc/wshserver/wshserver_council.go`: `CouncilReplyCommand` calls `ReplyWith` with `ToolsAuto`;
  `CouncilAskTooCommand` calls `councilRunner.AskToo`.
- Run `task generate`; commit the generated files with the rest.

Acceptance (`go test ./pkg/council -run 'TestRouteCandidates|TestReply'`,
`go test ./pkg/wshrpc/wshserver -run 'TestCouncilReplyCommand|TestCouncilAskTooCommand'`):
- `TestRouteCandidates` (in `runner_test.go`): skips the coordinator and a seat with a failed call, keeps panel order.
- The existing `TestReply*` tests pass unchanged through the `Reply` wrapper and the `post` helper.
- In `wshserver_council_test.go`: `TestCouncilReplyCommandCarriesToolsAuto` (a reply sent with `toolsauto` reaches
  `ReplyWith` with `ToolsAuto` set: read it off the stored reply through a seam, or a test hook the file already uses
  for the runner) and `TestCouncilAskTooCommandReturnsRefusal` (the command on a council whose reply has no `Routed`
  returns AskToo's error; the stub refuses it here and Task 7's body refuses it for the same input, so the test holds
  across both).

### Task 2: The router call: prompt, parse, candidates
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/council/router.go`, `pkg/council/router_test.go`

Pure functions and one call, as the spec's "The router call" fixes them. Nothing calls them yet (Task 4 does).

- `const ModelRouter = "sonnet"`; `const routerId = "router"` (the `CouncilExpert.Id` the call speaks as, Name
  `Router`); `const routerRecent = 6`. (`routeCandidates` is Task 1's, in `runner.go`; this task does not need it.)
- `type Route struct { Seats []string; Tools bool; Reason string }` (Seats are expert ids, at most two, router order).
- `func routerPrompt(c *Council, pr CouncilReply, candidates []CouncilExpert) string`: the person's text, the base names
  of its attachments (never their paths' folders or contents), the last `routerRecent` sent ideas and replies of the
  Discussion before `pr` by `Ts` (each `Author: text`, the author by `speaker`, text cut at 500 characters), one line
  per candidate (`id — Name: Brief`; a chat seat with an empty Brief reads `a live chat: <Name>`), and the rules: one
  seat unless the message plainly asks about two different areas, never more than two; `tools` true only when the
  answer needs something the Discussion does not hold (a new or fixed version, code, or a file a reply cited but did
  not copy in); reply with one JSON object `{"seats": [...], "tools": bool, "reason": "..."}` and nothing else.
- `func parseRoute(text string, candidates []CouncilExpert) (Route, error)`: `decodeReply(text, "router", &raw)`; a seat
  matches a candidate's id or name in any case; unknown and repeated seats are dropped; at most two are kept; the reason
  is folded to one line (`strings.Fields` joined) and cut at 200 characters; no seat left is an error.
- `func (r *Runner) routeCall(ctx context.Context, c *Council, pr CouncilReply, candidates []CouncilExpert) (Route, CallRes, error)`:
  one `r.Caller.Call` with `Tools: false`, `Cwd: c.Project`, the router expert, the prompt; `emptyReply` checked; then
  `parseRoute`. The CallRes is returned even on a parse error, so the caller can book its tokens.

Acceptance (`go test ./pkg/council -run 'TestRoute|TestParseRoute|TestRouterPrompt'`):
- `TestParseRoute`: one seat; two seats; three seats keep the first two; a seat by name in other case; an unknown seat
  dropped; a repeated seat once; no known seat is an error; prose around the JSON object still parses (as
  `decodeReply` allows); `tools` true and false; a reason over 200 characters or with newlines folded and cut.
- `TestRouterPromptHolds`: the text, attachment base names (and not their folders), the six most recent messages and
  not the seventh, every candidate line, a chat seat's fallback brief, the JSON shape.
- `TestRouteCallNoTools`: the fake Caller sees `Tools: false`, model `sonnet`, the project as Cwd; an error from the
  Caller comes back as the error.

### Task 3: Price a routed message
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/council/estimate.go`, `pkg/council/estimate_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`

As the spec's "The estimate" fixes it.

- `estimate.go`: `routerTokens = 15_000` with a comment that it is to be re-measured; `CallsMax` and `TokensMax` on
  `CouncilEstimate` (`omitempty`); `func EstimateRouted(c *Council, tools, toolsAuto bool) CouncilEstimate`: candidates
  are `routeCandidates(c)`; a seat's price is its chat `Context` when it is a chat with a known context, else
  `followupTokens` or `followupToolsTokens`; low = router + the cheapest candidate (no files when `toolsAuto`, else
  `tools`), high = router + the two dearest (one when there is one candidate; files when `toolsAuto`, else `tools`);
  `Calls`/`CallsMax` 2 and 3 (2 and 2 for one candidate); `Minutes` the follow-up minutes of the high end;
  `AgentTokens` the chats' share of the high end. No candidate: the zero estimate.
- `wshserver_council.go`: in `CouncilEstimateCommand`, a new first case `data.Id != "" && data.Routed` loads the council
  and returns `EstimateRouted(c, data.Tools, data.ToolsAuto)`, with `CallsMax` and `TokensMax` copied onto the reply.

Acceptance (`go test ./pkg/council -run 'TestEstimateRouted'`, `go test ./pkg/wshrpc/wshserver -run 'TestCouncilEstimate'`):
- `TestEstimateRouted`: three role seats, tools off: low = router + 20k, high = router + 40k, calls 2–3; tools on:
  both ends at 110k per seat; `toolsAuto`: low 20k, high 220k (+ router each); a chat seat with context 300k is the
  dearest at the high end and absent from the low end; one candidate gives one seat at both ends; a seat with a failed
  call is left out; the coordinator is never priced.
- The handler test: `Routed` true returns `tokensmax` and `callsmax`; without it the old cases answer as before.

### Task 4: Route the message in the runner
**Depends on:** Task 1, Task 2 (uses `routeCall` and `Route`)
**Model:** sonnet
**Files:** `pkg/council/runner.go`, `pkg/council/runner_test.go`

As the spec's "When the router runs", "`@all`" and "Fallback" fix it. `routeCandidates` and `ReplyWith` are Task 1's.

- `replyTargets` / `appendPersonReply`: `@all` and `@everyone` (whole words via `mentions`, any case) return the whole
  panel and route nothing. A reply is routed when it has no proposal, no parent, no seat @-mentioned, no `@all`, no chat
  joined by this message, and `len(routeCandidates(c)) >= 2`: stored with `To` empty and `Routed{Pending: true,
  AutoTools: toolsAuto && no attachments && !fileMentioned(text)}`. One candidate: `To` = that seat, no `Routed`.
  `Continue`'s question is not routed (it does not go through `appendPersonReply`; keep it so).
- The Runner gains `routing map[string]chan struct{}` (keyed `councilId + "/" + replyId`, guarded by `r.mu`, made lazily).
  `func (r *Runner) routeReply(ctx context.Context, id, replyId string)`: if a channel is in flight for the key, wait on
  it or ctx and return; else register one, load the council, return if the reply is gone or not pending, call
  `routeCall` with `routeCandidates`, then `Update`: if the reply is still pending, set `Routed.Pending = false`;
  on success `Chose` = the route's seats that are still candidates, `Reason`, and `Tools = route.Tools` when
  `AutoTools`; on an error, or no seat left, `Chose` = the first candidate, `Failed = true`, `Reason` = `errText(err)`
  (Tools unchanged); `To` = `Chose`; book `Calls++` and `Tokens += res.Tokens` on the council (no seat's Stats). Report
  the save (`r.changed`), then close and remove the channel. A save error is logged, never swallowed.
- `func (r *Runner) routePending(ctx context.Context, id string)`: routes every person reply with `Routed.Pending`,
  one after another, through `routeReply`.
- `ReplyWith`: after the save, when the new reply is pending, start `go r.routeReply(ctx, id, replyId)` with
  `context.WithTimeout(context.Background(), 2*time.Minute)`, whatever the state. `replyPass` and `answersPass` call
  `r.routePending(ctx, id)` first, before they load their snapshot.
- `MarkStale`: after marking the councils it stops, start `go r.routePending(...)` (2-minute timeout) for every council,
  in any state, that holds a reply with `Routed.Pending` (spec: "`MarkStale` (wavesrv's startup) routes every reply
  still pending").
- `firstAnswerers`: walk `pr.To` in its order, taking the first id that is on the panel and has no failed call (spec:
  "`To` keeps the router's order").
- Existing tests that send a whole-council message and expect every seat to answer: add `@all` to their text where the
  test is about every seat answering, or teach their fake Caller to answer the router (expert id `router`) where the
  test is about something else. Do not weaken what they check.

Acceptance (`go test ./pkg/council -run 'TestRoute|TestReplyRouted|TestAtAll|TestAnswersPass|TestReply|TestContinue|TestFirstAnswerers'`,
plus the suite through Verify), each with a fake Caller that answers the router with a JSON route:
- `TestReplyRoutedOneSeat`: a done council, a whole-council message: the router is called once, without tools; only
  the chosen seat answers; `Routed.Chose`, `Reason` are stored, `To` is that seat; the council books the router's
  tokens and one more call.
- `TestReplyRoutedTwoSeats`: the second seat runs after the first and its prompt holds the first answer and
  `othersAnsweredRule`; no third seat is called.
- `TestReplyMentionSkipsRouter`, `TestReplyInThreadSkipsRouter`, `TestReplyJoiningChatSkipsRouter`,
  `TestContinueQuestionNotRouted`: no router call; `To` as today.
- `TestAtAllReachesEverySeat` (and `@everyone`): no router call; first seat answers, then the rest shown its answer.
- `TestReplyRouterFailsFallsBack`: the router errors (and, separately, names an unknown seat): the first candidate in
  panel order answers alone, `Routed.Failed`, no second pass.
- `TestReplyRouterTools`: Auto with the router's `tools` true stores `Tools` true and the seat's call has tools; `tools`
  false stores false; the person's On (`ToolsAuto` false, `Tools` true) stays on when the router says false, and Off
  stays off when it says true; an attachment or an `@file` keeps it on (no `AutoTools`); a failed router keeps the
  composer's guess.
- `TestReplyRoutedBeforeRound2`: a message at the pause after round 1 is routed at once (no run on; wait for the save by
  polling `Load` with a deadline), and round 2 takes it up only for the chosen seat.
- `TestRoutePendingOnce`: a pass that finds a reply still pending while Reply's router is in flight waits for it, and
  the fake Caller sees one router call, not two.
- `TestReplyOneCandidateNotRouted`: a panel of one (or every other seat failed) sends to it with no router call.
- `TestMarkStaleRoutesPending`: a done council saved with a pending reply is routed after `MarkStale` (poll `Load`
  with a deadline): `Pending` cleared, `Chose` and `To` set, one router call.

### Task 5: The composer: Auto · On · Off, @all, the routed hint
**Depends on:** Task 1 (uses the generated `toolsauto`, `routed`, `callsmax`, `tokensmax` fields)
**Model:** sonnet
**Files:** `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`, `frontend/app/view/agents/councilchatmodel.ts`, `frontend/app/view/agents/councilchatmodel.test.ts`, `frontend/app/view/agents/councilchat.tsx`, `scripts/cdp/council/routing.mjs`, `scripts/cdp/councilscenarios.mjs`, `scripts/cdp/council/discussion.mjs`, `CHANGELOG.md`

As the spec's "`@all`", "The estimate" and "How it is drawn" (first two bullets) fix it.

- `councilmodel.ts`: `answerers` returns the whole panel for a text that holds `@all` or `@everyone` as a whole word
  (`mentions`' rule). `export function routedMessage(c, proposalId, parentId, text, joining): boolean` mirrors Go's
  rule (no proposal, no parent, no seat or chat named, no `@all`, nothing joining, two or more panel seats with no
  failed call). `estimateLabel` draws a range when `callsmax`/`tokensmax` are set (`≈ 2–3 calls · ~35k–235k tokens`).
  `routedLabel(est)`: `Router picks 1–2 seats` then the range, or the head alone before the estimate comes back.
- `councilchatmodel.ts`: `readsFiles(choice, text, attached, routed = false)` keeps its result shape; in Auto (`choice`
  null, not locked) with `routed` true its `why` is `the router decides` and `on` stays the `namedFile` guess. The `@`
  picker gains an **All seats** row (`PickerRow` kind `"all"`) first among the seats when the query is empty or a
  prefix of `all` or `everyone`; picking it inserts `@all ` (an `insertAllMention` beside `insertMention`).
- `councilchat.tsx` `Composer`: the switch becomes a three-way control labelled `Read files` with `Auto`, `On`, `Off`
  (`drafts.tools` null / true / false), keeping `data-council-tools` on its group with `data-council-tools-state=
  "auto"|"on"|"off"`, `data-council-tools-why` and `data-council-tools-locked`, each option a button with
  `aria-pressed`; locked shows On and disables the others. Send passes `toolsauto: true` when the choice is Auto and
  nothing locks it. For a routed message: in a follow-up the estimate asks `{id, routed: true, tools: reads.on,
  toolsauto}` and the hint is `routedLabel`; outside one the hint is `The router picks who answers`. The All seats row
  renders in the picker's Seats group.
- `scripts/cdp/council/discussion.mjs`: under the new rule a channel message that names no seat is routed, so three
  steps there change what they type or expect, each keeping what it proves:
  - the **roomComposer** step (~l.1395, `composer: a message to the box posts to everyone`) types `@all ` before its
    text, so the hint still reads `Everyone answers` and the stubbed CouncilReplyCommand still carries the text and no
    idea;
  - the **attach-send-call** step (~l.2301, `@docs/recap-notes.md what do you make…`) also starts with `@all `, so the
    hint still reads `Everyone answers` while the `@file` still locks reading files on;
  - the **done** step (~l.1057, `What does rail-apps.json hold?`) types `@UX What does rail-apps.json hold?`, so the
    `namedFile` note still shows (`data-council-tools-state="auto"`, `data-council-tools-why="rail-apps.json"`, reading
    on); the routed Auto case is proven in `council-routing`'s composer-auto step.
  - The steps that read or click `[data-council-tools]` (the thread follow-up's click that turns it on, ~l.1076; the
    attach locked switch, ~l.1966 and ~l.2178) move to the three-way control: click its `On` option, read
    `data-council-tools-state` instead of `aria-checked`; what they check stays the same.
- `scripts/cdp/council/routing.mjs` (new, exporting `councilRouting` with arrange / assert / teardown in
  `discussion.mjs`'s shape) and `council-routing` registered in `scripts/cdp/councilscenarios.mjs`. Its arrange seeds a
  done council of three role seats with its own data in this file; it stubs `CouncilEstimateCommand` (answering a
  range when `routed` is set) and `CouncilReplyCommand`. Steps, each with a screenshot: **composer-auto** (the channel
  composer shows Read files with Auto pressed, the note `· the router decides`, and the hint `Router picks 1–2 seats · …`
  with a range); **composer-awaiting** (a second council built in this file and written with
  `writeCouncil(ctx, "awaiting", …)`: a plain channel message shows the hint `The router picks who answers`, and
  `@UX why?` shows the old reach line `Answered by: UX`); **composer-on-off**
  (On then Off pressed; the hint's range collapses to the chosen branch); **composer-mention** (`@UX why?` shows
  `1 expert answers` and no router hint); **picker-all** (typing `@` lists All seats first; choosing it puts `@all ` in
  the box and the hint reads every seat answering); **send-auto** (Send in Auto: the stubbed reply call got
  `toolsauto: true`).
- `CHANGELOG.md`: one line under `Added` in the top section (open a `## Unreleased` above a dated one): a message to
  the whole council now goes to the one seat (or two) best placed to answer, with Ask <seat> too to hear another and
  `@all` to ask everyone.

Acceptance: `npx vitest run frontend/app/view/agents/councilmodel.test.ts frontend/app/view/agents/councilchatmodel.test.ts`
covers `routedMessage` (each skip case and the one-candidate case), `answerers` with `@all`/`@everyone` (and `@allison`
not matching), `estimateLabel`/`routedLabel` ranges, `readsFiles` with `routed`, and the picker's All seats row and
insert; `task check:ts` passes; the `council-routing` steps above and the edited `council-discussion` steps pass under
Final.

### Task 6: The Discussion: the router line and Ask <seat> too
**Depends on:** Task 5
**Model:** sonnet
**Files:** `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`, `frontend/app/view/agents/councilchatmodel.ts`, `frontend/app/view/agents/councilchatmodel.test.ts`, `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/councilstore.test.ts`, `scripts/cdp/council/routing.mjs`, `scripts/cdp/council/discussion.mjs`

As the spec's "How it is drawn" (last three bullets) fixes it.

- `councilchatmodel.ts`: `ReplyPost` gains `router: string` (the line above a seat's answer: set only on the first
  answer, by `Ts`, to a routed reply of the person's: `Router chose UX: <reason>`, `Router chose UX and RAM: <reason>`,
  `Router chose UX · reading files: <reason>` when `autotools` and the reply's `tools`, `Router failed, UX answered`
  when `failed`; no `: <reason>` when the reason is empty) and `askToo: { id: string; name: string }[]` (on the last
  answer to a routed, no-longer-pending reply: the panel seats not in its `to`, in panel order; the reply's id rides
  along as `routedReply: string`). Pure helpers `routerLine(c, reply)` and `askTooSeats(c, reply)` with tests.
- `councilmodel.ts` `replyLabel`: a reply with `routed.pending` reads `Router is choosing a seat…`; `reachOf` /
  `reachIsDefault` in `councilchatmodel.ts`: a routed reply names the seats in its `to` (`For UX`), never
  `For everyone`, even when they are the whole panel, and is never the default reach (so the line under the post shows
  it); a pending one shows no reach.
- `councilstore.ts`: `askCouncilSeatToo(id, replyId, expertId)` through `RpcApi.CouncilAskTooCommand`, returning
  the same `CouncilCall` result shape as `replyCouncil`; a test beside the existing `replyCouncil` one.
- `councilchat.tsx` `ReplyMessage`: draws `router` as a small muted line above the answer (`data-council-router`), and
  the `askToo` chips under it (`data-council-ask-too={seatId}`, text `Ask RAM too`); pressing one calls
  `askCouncilSeatToo`, disables the chips until the council changes, and shows a refusal inline (`role="alert"`).
- `discussion.mjs`: adjust any step whose assertion reads the person's pending label or reach line, if the change above
  alters it; what it checks stays the same.
- `routing.mjs` gains seeded councils (built in this file): one routed reply answered by UX with a reason; one routed to
  UX and RAM; one with `autotools` and tools; one failed router; one pending. Steps, each with a screenshot:
  **router-line** (`Router chose UX: …` above UX's answer, and the person's post reads `For UX`, not `For everyone`);
  **router-two** (`Router chose UX and RAM: …` above the first answer only; the post reads `For UX and RAM`, also on a
  council of two seats where the router chose both); **router-files** (`· reading files`); **router-failed**
  (`Router failed, UX answered`); **router-pending** (the person's post reads `Router is choosing a seat…`, shows no
  `For everyone` reach, and no chips show); **ask-too-chips** (one chip per other seat under
  the last answer); **ask-too-press** (pressing `Ask RAM too` calls the stubbed `CouncilAskTooCommand` with
  `{id, replyid, expertid: "ram"}` and the chips go disabled); **ask-too-refused** (the stub rejects: the error shows
  inline).

Acceptance: `npx vitest run frontend/app/view/agents/councilchatmodel.test.ts frontend/app/view/agents/councilmodel.test.ts frontend/app/view/agents/councilstore.test.ts`
covers `routerLine` (one seat, two, reading files, failed, empty reason), `askTooSeats` (excludes `to`, empty while
pending and on an unrouted reply), the pending label, the routed reach (`For UX`, and `For UX and RAM` when they are the
whole panel), and the store call; `task check:ts` passes; the `council-routing` steps above pass under Final.

### Task 7: Ask <seat> too in the runner
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/council/asktoo.go`, `pkg/council/asktoo_test.go`

Replace Task 1's stub with the body the spec's "Ask <seat> too" fixes, through Task 1's `post` helper.

- `AskToo(id, replyId, expertId)`: refused (an error naming why) when `r.Caller == nil`, the reply is missing, not the
  person's, has no `Routed`, or `Routed.Pending`, or when the expert is not on the panel (`panelOf`; the coordinator is
  not) or is already in `To`; `post` refuses a not-run or queued council. Otherwise, in `post`'s save, it appends the
  expert to `To` and sets `Answered = false`. Nothing else (Chose, Reason) changes.

Acceptance (`go test ./pkg/council -run 'TestAskToo'`, fake Caller, temp store as the runner tests set it up):
- `TestAskTooAddsSeatAndStartsFollowup`: a done council with a routed, answered reply (`To: [ux]`, an answer from ux):
  AskToo(ram) puts ram in `To`, clears `Answered`, runs a follow-up in which only ram is called, and ram's prompt holds
  ux's answer and `othersAnsweredRule`; `Routed.Chose` is still `[ux]`; the council ends done.
- `TestAskTooRefuses`: a reply with no `Routed`, a pending one, a seat already in `To`, a seat not on the panel, the
  coordinator, and another seat's reply are each refused, and nothing is saved.
- `TestAskTooWhileAwaitingSaves`: on a council awaiting-you, AskToo saves the change and starts no run.
- `TestCouncilAskTooCommandReturnsRefusal` (Task 1's, in `wshserver_council_test.go`) still passes.
