# Council with live agents and a Slack-style council chat

Goal: seat live claude/pi agents in a council beside role experts, hold every answer of such a council as a draft the
person sends, edits or drops, and show every council's discussion as a Slack-style channel with threads.

**Spec:** `docs/superpowers/specs/2026-10-29-council-live-agents-design.md` — read its Decisions, "What is held, and the
edges" and "Wire shape" before your task; the Wire shape names the fields and the command every task relies on.
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs council-discussion council-summary council-setup council-ask council-tree council-needs-you`
**Prototype:** .superpowers\design\council-live-agents\project

Repo rules every task follows (AGENTS.md): never hand-edit generated files (run `task generate` after changing a
wshrpc or council wire type); colors from `@theme` tokens only; testable logic in a pure `foo.ts` with `foo.test.ts`,
no jsdom render tests; Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`; grep every
import, `import type` included, before deleting a file or an export; a user-visible change adds one line to
`CHANGELOG.md` under Unreleased (Task 8 owns that line for the whole feature). Prefer simple, direct code; no
abstraction for a single implementation; handle errors at boundaries and never swallow them silently. A task that
edits a CDP scenario file runs `node --check <file>` on it; its steps run in the Final, and each step below states
what it asserts.

Words used across tasks (Task 5 derives them, the views draw them): the step chip reads `Round N of R` while the seats
answer and `Writing the summary` during the synthesis, with ` · N drafts wait for you` appended while drafts are held;
a Councils row with held drafts reads `N drafts wait for you`. CDP hooks shared across tasks: a Setup seat row is
`[data-council-seat="<expert id>"]`, with `data-council-seat-agent="<tab id>"` on an agent seat (Task 9 adds them,
Task 10 asserts them); the thread panel's idea carries `data-council-post="<proposal id>"` and
`window.__arcCouncil.openProposal` keeps working (Task 8; `council-summary` relies on both).

### Task 1: Wire shape, the AgentLink seam and the draft command
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/types_test.go`, `pkg/council/agentlink.go`, `pkg/council/runner.go`, `pkg/council/estimate.go`, `pkg/council/estimate_test.go`, `cmd/wsh/cmd/wshcmd-council_test.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

The small interface every other task builds on. No behaviour yet beyond the helpers below.

- `types.go`: `CouncilExpert` gains `Agent string` (json `agent,omitempty`; the seated agent's tab id), `Harness string`
  (`harness,omitempty`) and `Context int64` (`context,omitempty`). `Council` gains `Rounds int` (`rounds,omitempty`)
  and `Skips []CouncilSkip` (`skips,omitempty`), with `CouncilSkip{Expert string; Round int; Reason string; Ts int64}`.
  `CouncilProposal` and `CouncilReply` gain `Draft string` (`draft,omitempty`) and `Edited bool` (`edited,omitempty`),
  with consts `DraftHeld = "held"`, `DraftDropped = "dropped"`.
- Helpers in `types.go`, the one Go source of round numbers: `RoundsOf(c) int` (0 or out of range reads as 2),
  `SynthesisRound(c) = RoundsOf(c)+1`, `FirstFollowRound(c) = RoundsOf(c)+2`, `HasAgents(c) bool`, `IsAgent(e) bool`
  (`e.Agent != ""`), `Sent(draft string) bool` (true for "").
- `agentlink.go`: `type AgentSeatState struct{ State string; Context int64 }` with consts `SeatIdle`, `SeatWorking`,
  `SeatAsking`, `SeatSleeping`, `SeatGone`; `type AgentLink interface { Seat(ctx, tabId string) (AgentSeatState,
  error); Send(ctx, tabId, text string) error; LastAnswer(ctx, tabId string) (text string, ts int64, err error) }`;
  `type SeatSkipped struct{ Reason string }` implementing `error` (what `AgentCaller.Call` returns for a skipped turn;
  the runner tells it apart with `errors.As`).
- `runner.go`: `Runner` gains `Agents Caller` (the caller for seats with `Agent` set) and a stub
  `func (r *Runner) Draft(id, itemId, action, text string) (*Council, error)` returning
  `errors.New("held drafts are not built yet")`, which Task 3 implements. Nothing else in the runner changes here.
- `estimate.go`: `CouncilEstimate` gains `AgentTokens int64` (`agenttokens,omitempty`); `Estimate` takes a third
  argument `rounds int`, ignored for now (Task 4 implements it). Update every call site (`estimate_test.go`,
  `cmd/wsh/cmd/wshcmd-council_test.go`, `wshserver_council.go`).
- `wshrpctypes_council.go`: `CommandCouncilStartData` and `CommandCouncilEstimateData` gain `Rounds int`;
  `CouncilEstimateRtnData` gains `AgentTokens`; new `CouncilDraftCommand(ctx, CommandCouncilDraftData) error` with
  `CommandCouncilDraftData{Id, ItemId, Action, Text string}` (Action `send` | `edit` | `drop`). `wshserver_council.go`:
  the start handler copies `Rounds` onto the council; the estimate handler passes `data.Rounds` and returns
  `AgentTokens`; the new handler calls `councilRunner.Draft`.
- Run `task generate` and commit the generated files listed above.

Acceptance: `go test ./pkg/council -run 'TestRoundsOf|TestSynthesisRound|TestFirstFollowRound|TestHasAgents|TestIsAgent|TestSent|TestEstimate'`
and `go test ./cmd/wsh/cmd -run 'TestCouncil'` pass; the Check passes; `frontend/types/gotypes.d.ts` has the new fields
and `RpcApi.CouncilDraftCommand` exists.

### Task 2: AgentCaller and the live AgentLink
**Depends on:** Task 1
**Files:** `pkg/council/agentcaller.go`, `pkg/council/agentcaller_test.go`, `pkg/wshrpc/wshserver/wshserver_councilagents.go`, `pkg/wshrpc/wshserver/wshserver_councilagents_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg_test.go`, `pkg/wshrpc/wshserver/wshserver_agentsleep_test.go`

- `agentcaller.go`: `type AgentCaller struct{ Link AgentLink; BusyCap, TurnCap, Poll time.Duration }` implementing
  `Caller` (zero caps default to 10 min busy, 20 min turn). `Call`: wait until the seat is idle or sleeping (`Send`
  wakes a sleeping one); a `working` or `asking` seat is polled, never sent into, up to `BusyCap`, then return
  `SeatSkipped{"still working on its own task after 10 min"}` (or `"a question waits for you in its terminal"` for
  asking). Note the last answer's ts, `Send` the prompt, wait for the seat to go busy and back to idle; past `TurnCap`
  return `SeatSkipped{"gave no answer within 20 min"}`. Then take `LastAnswer` newer than the noted ts as
  `CallRes.Text` (an older one is not an answer). A `gone` seat is an error. `CallRes.Tokens`: the context grown over
  the turn when `Seat` reports it, else the context at start over 10, in one commented line. While it waits for a busy
  seat it calls `req.OnTool("Waiting for <name> to finish its task")`, so the runner's activity names the agent.
- `wshserver_councilagents.go`: `liveAgentLink` implementing `council.AgentLink` over `loadAgentRosterFacts` /
  `buildAgentRoster` / `resolveAgentTab` (state from `wshrpc.AgentsState_*`, context from the row); `Send` through the
  wake-or-deliver path `AgentsSendCommand` uses, extracted in `wshserver_agentmsg.go` into one helper both call (no
  sender tab: the envelope names the council as the sender); `LastAnswer` through `agentTranscriptPath` +
  `agentsessions.LastAnswer`. Only claude and pi seats are accepted. `newCouncilRunner` in `wshserver_council.go` sets
  `Agents: council.AgentCaller{Link: liveAgentLink{}}`.

Acceptance: `go test ./pkg/council -run 'TestAgentCaller'` covers sent and answered, busy then idle, busy past the cap
→ `SeatSkipped`, asking → waits, a turn past `TurnCap` → `SeatSkipped`, gone → error, an answer older than the send not
taken, `OnTool` called while waiting (fake link, millisecond caps). `go test ./pkg/wshrpc/wshserver -run
'TestLiveAgentLink|TestAgentsSend|TestAgentsSleep'` covers the state mapping and `AgentsSendCommand` unchanged after the
extraction.

### Task 3: The runner — rounds, agent turns, held drafts and skips
**Depends on:** Task 1
**Files:** `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/parse.go`, `pkg/council/parse_test.go`, `pkg/council/markdown.go`, `pkg/council/markdown_test.go`

The spec's "Who drives the turns", "When an agent is busy", "What an agent gets each turn", "Held drafts only where an
agent sits", "Waiting on drafts frees the slot" and "What is held, and the edges".

- Caller per seat: `callerFor(e)` is `r.Agents` for `IsAgent(e)`, else `r.Caller` (nil `Agents` fails an agent seat
  with a clear error). `call` sets `req.OnTool` for agent seats as well as for tool calls, so a busy agent's
  "Waiting for …" is the seat's activity. A `SeatSkipped` error appends a `CouncilSkip` and is not a failure (no
  `Failed` entry, no Retry).
- Rounds: replace the hard-coded 3 / 4+ with `SynthesisRound` / `FirstFollowRound` everywhere (`roundsWork`,
  `synthesisFailed`, `followRound`, `answersPass`, `MarkStale`, `Retry`, `CouncilFailure.Round` users). `Rounds` is
  honoured only when `HasAgents`; an expert-only council keeps today's shape exactly. Rounds 1 = ideas then summary; 3
  = a second reply pass reusing the round-2 prompt and parser; `applyPicks` only in the last reply pass.
- Validation at start (`validateCouncil`): refuse a duplicate agent seat, an agent as coordinator, a harness other
  than claude or pi, Rounds outside 0..3. `stampNew` clears `Skips`.
- Agent turns: `prompts.go` gains `AgentFirstPrompt(c, e, round)` (the question, the other seats each marked agent or
  expert, the answer shape the experts use for that round) and `AgentLaterPrompt(c, e, round)` (only sent items since
  the seat's last turn — previous rounds' and the person's — never a same-round answer). Parse with the experts'
  parsers; an answer that does not parse becomes one plain reply from that seat to the whole council (`parse.go`
  fallback).
- Held drafts (only when `HasAgents`): every idea and reply with text a seat produces is saved `Draft: DraftHeld`; an
  agreement reaction applies at once; a withdrawal or revision rides on its reply and applies when it is sent.
  When a round's calls end and a draft of the round is held, the run ends `StateAwaiting` at that round, holding no
  slot. `Draft(id, itemId, action, text)`: `send` clears `Draft`; `edit` replaces the text, sets `Edited` and sends;
  `drop` sets `DraftDropped`. Settling the last held draft of the round launches the next round at once (as `Continue`
  does: a person's action, never queued); after the last reply pass, the synthesis. A held follow-up answer (after the
  summary) only settles; the council stays done. Refuse an unknown item, one not held, or a council with no held draft
  for that item. Held and dropped items never enter a prompt, the picks, the synthesis or the saved document
  (`markdown.go`). `Continue` refuses a council with held drafts. `PauseAfterRound1` is ignored when `HasAgents`.
- The person's posts: with agents seated, a post or an @ made while a round runs or while awaiting reaches each seat it
  names at that seat's next round turn (in its `AgentLaterPrompt` / round-2 prompt); after the last round, the
  follow-up pass answers it, as today.

Acceptance: `go test ./pkg/council` (the whole package: the existing tests such as `TestStartRunsThreeRounds`,
`TestPauseAfterRound1ThenContinue` and `TestQueue*` prove a council with `Rounds` 0 and no agents runs as today) passes
with new tests `TestAgentSeatsHoldDrafts` (a round waits until every draft is sent or dropped), `TestDraftEditIsSent`
(the next turn gets the edited text), `TestDroppedDraftReachesNoOne` (no prompt, not the summary, not the document),
`TestAgreeAppliesAtOnce`, `TestWithdrawRidesOnReply`, `TestMixedSeats`, `TestSkippedTurnGoesOn`,
`TestAgentRounds1And3`, `TestFollowupDraftKeepsDone`, `TestContinueRefusesHeldDrafts`, `TestPostReachesNextTurn`,
`TestValidateAgentSeats`, `TestAgentPrompts`, `TestUnparsedAgentAnswerIsPlainReply`.

### Task 4: The estimate with agent seats and rounds
**Depends on:** Task 1
**Files:** `pkg/council/estimate.go`, `pkg/council/estimate_test.go`

Implement the `rounds` argument Task 1 added to `Estimate`. An agent seat costs its `Context` × rounds (625k × 2 ≈
1.3M), reported in `AgentTokens` as well as in `Tokens`; with agents seated, rounds 1 drops the reply pass and 3 adds a
second one for the experts; an expert-only council prices exactly as today (rounds ignored). `EstimateRemaining` counts
the extra passes and the agent seats' turns left when the council has agents.

Acceptance: `go test ./pkg/council -run 'TestEstimate'` covers 625k × 2 rounds, rounds 1 and 3, an expert-only council
unchanged, `EstimateRemaining` with agents.

### Task 5: Frontend round helpers, words and the setup draft's seats
**Depends on:** Task 1 (uses the generated council types)
**Files:** `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`

`councilmodel.ts` becomes the one TS source of round numbers: `roundsOf(c)` (0 reads as 2), `synthesisRound(c)`,
`firstFollowRound(c)`, `hasAgents(c)`, `isAgentSeat(e)`, `heldDrafts(c)` (held ideas and replies, in order). Replace
`ROUNDS` and the hard-coded 3/4 in this file with them. The step and row words above ("Round N of R", "Writing the
summary", " · N drafts wait for you", "N drafts wait for you"); the queued line names the holder council and, when the
holder's seat activity is "Waiting for <agent> to finish its task", that agent. `CouncilSetupDraft` gains `rounds`
(default 2) and agent seats (as `CouncilExpert` with `agent`, `harness`, `context`), and `draftWithAgents(agents)`
builds a Setup draft with those agents seated and the first agent's project as the council's project.

Acceptance: `npx vitest run frontend/app/view/agents/councilmodel.test.ts` covers each helper (rounds 0 reads as 2,
synthesis 3 and follow-ups 4 for 2 rounds, 4/5 for 3), the chip and row words with and without held drafts, the queued
line naming an agent, `draftWithAgents` across two projects.

### Task 6: The draft store action and the room fixture
**Depends on:** Task 1 (uses RpcApi.CouncilDraftCommand and the new fields)
**Files:** `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/councilstore.test.ts`, `scripts/cdp/council/fixtures.mjs`, `scripts/cdp/council/fixtures.test.mjs`, `scripts/cdp/council/rail-apps-room.json`

- `councilstore.ts`: `draftCouncil(id, itemId, action, text?)` over `RpcApi.CouncilDraftCommand`, answering
  `{ ok, error }` like its siblings.
- `rail-apps-room.json`, registered as `room` in `fixtures.mjs` (`COUNCIL_FIXTURES`, `PLACE` with `updatedAgoMs: 0`):
  state running, `rounds` 2, round 2; seats: agent "Witness synthesis" (claude, 625k, project `council-fixture`), agent
  "UX audit" (pi, 210k, a second project), expert "Security" and the coordinator. Round 1 ideas with replies (some
  sent, one dropped, one edited), a held idea draft and a held reply draft in a thread, one skip in round 1, the
  person's question and an @ to an agent, UX audit at work (activity "Replying to …", the typing row) and Witness
  waiting ("Waiting for Witness synthesis to finish its task").
- `fixtures.mjs` exports `ROOM_AGENTS` (tab id, name, project, harness, context per agent seat, the ids the fixture's
  seats use) and `writeRoomRoster(h)` / `restoreRoomRoster(ctx)`, which write those agents as the cockpit fixture
  roster `public/cockpit-fixtures/active.json` (the file and shape `agent-tree-rail` and `usage-insights` write in
  `scripts/cdp/scenarios.mjs`, TREE_RAIL_FIXTURE), reload, and put the previous file back.
- `fixtures.test.mjs`: update the name list (`:64`) and the order over `COUNCIL_FIXTURES` (`:272`) for `room`; test the
  room fixture's seats match `ROOM_AGENTS`.

Acceptance: `npx vitest run frontend/app/view/agents/councilstore.test.ts scripts/cdp/council/fixtures.test.mjs`
covers `draftCouncil` passing action, item and text and answering `{ ok, error }` on a refusal, and the room fixture;
`node --check scripts/cdp/council/fixtures.mjs`.

### Task 7: The chat's pure model
**Depends on:** Task 5 (uses its round helpers and words)
**Files:** `frontend/app/view/agents/councilchatmodel.ts`, `frontend/app/view/agents/councilchatmodel.test.ts`

`councilchatmodel.ts` derives what the channel and thread draw, from a `Council`: channel items in time order (the
person's question, one divider per round, each idea as a message with evidence chips, agreement reactions, a "picked
by N" chip in the last reply pass's picks, a wild pill for a Brainstorm wild idea, and a reply chip — count, the
avatars of who replied, the time of the last reply —, held idea drafts with their actions, skipped-turn lines with
the seat and reason, the person's posts with who they reach, failure lines with Retry, a typing row per seat at work);
thread items for one idea (the idea, its replies with stance pills "has doubts" / "builds on it" / "is against it" /
"replies", held reply drafts, and who the reply box reaches); the seat chips (`agent · <context>` or `expert · <model>`,
state dot, what it is doing); the step chip; the j/k order of ideas. Dropped items are left out; edited ones say so.
It may import from `councildiscussionmodel.ts` only `evidenceChip`, `reactions`, `sinceStart`, `avatarTone`,
`expertDoing`, `isLit` and `listNames` (Task 8 keeps them); it does not import `councilfeedmodel.ts` (Task 8 deletes
it) — what it needs from there it writes over Task 5's helpers. A council saved before this (no drafts, no agents,
`rounds` 0) yields a sensible channel.

Acceptance: `npx vitest run frontend/app/view/agents/councilchatmodel.test.ts` covers channel items, thread items,
reply chips, held drafts in channel and thread, dropped and edited items, skipped lines, seat chips, the step chip,
picks and wild ideas, and an old expert-only council built in the test in today's round2 and done shapes.

### Task 8: The chat view replaces the feed and the Reddit thread
**Depends on:** Task 7 (draws what councilchatmodel.ts derives), Task 6 (uses draftCouncil and the room fixture)
**Files:** `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councildiscussion.tsx`, `frontend/app/view/agents/councildiscussionmodel.ts`, `frontend/app/view/agents/councildiscussionmodel.test.ts`, `frontend/app/view/agents/councilfeed.tsx`, `frontend/app/view/agents/councilfeedmodel.ts`, `frontend/app/view/agents/councilfeedmodel.test.ts`, `frontend/app/view/agents/councilthread.tsx`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/council/discussion.mjs`, `scripts/cdp/council/summary.mjs`, `CHANGELOG.md`

Build the Main board in `councilchat.tsx`: the header (title, step chip, mode, cost, Summarize, Stop council), the
seat chips (a click on an agent chip runs `showTerminal` for its tab; a failed seat's chip carries Retry), the
channel, held drafts (amber tint from a theme token, "Waiting for you", Send to the others / Edit / Drop through
`draftCouncil`; a reply draft sits in its thread), the skipped line with Open its terminal, the typing row, the
composer (posts to everyone; typing `@` opens a seat picker and posts to that seat) and the 400px thread panel (the
idea on top carrying `data-council-post`, replies with stance pills, held reply drafts, a reply box naming who will
answer; the open idea highlighted in the channel). Keyboard: j/k over ideas only while focus is inside the channel or
thread, Enter opens the focused idea's thread, Esc closes it — defined in `bindings.ts`, active only with that focus,
mirrored in `docs/keyboard-shortcuts.md`.

`councildiscussion.tsx` shows the chat in place of the feed and the thread for every council that has ideas: while
running from round 2, once ended, and while awaiting with held drafts (no Continue then); the pause body only for an
awaiting council with no held draft. The round-1 expert cards, queued, not-run and paused bodies stay. The Summary's
"Ask the experts again" (it sets `councilOpenProposalAtom`) opens that idea's thread in the chat;
`window.__arcCouncil.openProposal` keeps working. `councilsummary.tsx`: replace `c.round >= 3` (line ~673) with
`synthesisRound(c)` and import `CouncilAvatar` from `councilchat.tsx`. Delete `councilfeed.tsx`, `councilthread.tsx`,
`councilfeedmodel.ts` and its test (move `CouncilAvatar` / `CouncilPill` to `councilchat.tsx`); trim
`councildiscussionmodel.ts` of what only the deleted views used, keeping the exports Task 7 names, and replace its
hard-coded rounds (line ~112) with Task 5's helpers. CHANGELOG: one Added line for live agents in a council and the
new chat (`<!-- big -->`).

Rewrite `council-discussion` (`scripts/cdp/council/discussion.mjs`). Keep, with updated words ("Round N of R" for
"Step N of 3"), the steps on views that stay: round-1 expert cards, queued, paused, not run, a failed expert's Retry.
Port to chat hooks the steps that read the feed or the thread (`data-feed-*`: round 2 messages, system lines, the
person's reply, a hidden reply, picks, Brainstorm wild ideas, the follow-up). Add, on the `room` fixture with
`writeRoomRoster`: (a) the channel shows seat chips with `agent · 625k`, round dividers, an idea with its reply chip
(count, avatars, last time) and agree reactions, the held idea draft with its three buttons, the skipped line, the
typing row, and the chip `Round 2 of 2 · 2 drafts wait for you`; (b) Send to the others, Edit then send, and Drop each
call `CouncilDraftCommand` with the right action and text (`stubRpc`); (c) a thread opens with its replies, stance
pills and the held reply draft, the idea highlighted, the reply box naming who answers, Esc closing it; (d) j/k move
over ideas once the channel has focus, Enter opens the thread; (e) the composer posts to everyone and `@` picks one
seat (`CouncilReplyCommand` stubbed, its text and target read); (f) a click on an agent seat chip and on Open its
terminal each land on that agent's terminal (the Agent centre shows its id); (g) the `done` fixture shows as a
channel. Port `council-summary`'s "Ask the experts again" step (`summary.mjs` ~596) to assert the chat's thread panel
opens with `data-council-post="P5"`.

Acceptance: the Check passes; `npx vitest run frontend/app/view/agents/councildiscussionmodel.test.ts
frontend/app/store/keybindings` passes; `node --check` on both scenario files; `council-discussion` and
`council-summary` pass in the Final. `docs/keyboard-shortcuts.md` is a hand check.

### Task 9: Setup with agent seats and Rounds
**Depends on:** Task 5 (uses the setup draft's seats and rounds), Task 6 (uses ROOM_AGENTS and writeRoomRoster)
**Files:** `frontend/app/view/agents/councilsetup.tsx`, `frontend/app/view/agents/councilsetupmodel.ts`, `frontend/app/view/agents/councilsetupmodel.test.ts`, `scripts/cdp/council/setup.mjs`

The Setup board: a **Seats** list (agents first, then experts and the coordinator; rows `[data-council-seat]`, agent
rows with `data-council-seat-agent`), each with its per-turn cost and a remove button; **Add agent** (a picker over the
live claude/pi agents from the cockpit's agent state, those already seated left out) and **Add expert**; the **Rounds**
1 / 2 / 3 switch (default 2), shown only when an agent is seated; the one line that the talk lands in the agents'
transcripts and a busy agent is waited for up to 10 minutes; the estimate in the composer bar splitting out what the
agents cost (`agenttokens`); the header naming the project with "+ N more" when seats span projects; "Pause after
round 1" hidden when an agent is seated. In `councilsetupmodel.ts`, `startData`, `estimateRequest` and `estimateKey`
carry `rounds` and the agent seats with their context. An expert-only Setup keeps its hooks (`data-council-group`,
`data-council-expert`) so `council-ask` still passes.

Extend `council-setup` (with `writeRoomRoster`): open Setup from `draftWithAgents` of both room agents (two projects)
and assert the two agent seat rows first, the header `council-fixture + 1 more`, the Rounds switch at 2, the transcript
line, the estimate's agent part, no Pause option; click Rounds 3 and see the estimate request carry `rounds: 3`; open
Add agent and see the picker list the roster minus the seated; remove an agent seat and add it back from the picker;
remove both agents and see the Rounds switch go and Pause return; Start council with agents seated sends the seats and
`rounds` (`CouncilStartCommand` stubbed, its data read).

Acceptance: `npx vitest run frontend/app/view/agents/councilsetupmodel.test.ts` covers seat ordering, per-turn cost,
rounds default, "+ N more", the hidden pause, `startData` / `estimateRequest` / `estimateKey` with agents;
`node --check scripts/cdp/council/setup.mjs`; `council-setup` and `council-ask` pass in the Final.

### Task 10: Agent tree multi-select, Discuss together and "in council"
**Depends on:** Task 5 (uses draftWithAgents and the council words), Task 6 (uses ROOM_AGENTS, writeRoomRoster and the room fixture)
**Files:** `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/agenttreemodel.ts`, `frontend/app/view/agents/agenttreemodel.test.ts`, `frontend/app/view/agents/agentcenter.ts`, `frontend/app/view/agents/agentcenter.test.ts`, `scripts/cdp/council/tree.mjs`

Multi-select in the Agent tree's agent rows: Ctrl/Cmd+click toggles a row, Shift+click extends from the last clicked
row over the agent rows between, a plain click selects one as today and clears the multi-selection (`focusIdAtom`
stays the one selected agent; the multi-selection is its own atom). The right-click menu on a selected agent, with two
or more claude/pi agents selected, offers **Discuss together**, which opens council Setup (`showCouncilSetup`) with
`draftWithAgents` of the selection. A seated agent's row says `in council` beside its state while a council it sits in
is running or awaiting. A Councils row with held drafts reads `N drafts wait for you`; a queued council's row names
the holder and the agent it waits on (Task 5's words). Selection and `in council` rules in `agenttreemodel.ts`.

Extend `council-tree`. Keep its existing steps as they are (they expect the four councils and no agent rows): add the
new ones in a phase after them that seeds `room` and `writeRoomRoster`, and a queued council behind `room`
(`writeCouncil` with `queuedafter`). Assert: Ctrl+click two agent rows → both selected; Shift+click extends; a plain
click clears; the context menu shows Discuss together, and picking it lands on Setup with both agents in
`[data-council-seat-agent]` rows; the room's agents' rows read `in council`; the room's Councils row reads
`2 drafts wait for you`; the queued row names `room` and `Witness synthesis`.

Acceptance: `npx vitest run frontend/app/view/agents/agenttreemodel.test.ts frontend/app/view/agents/agentcenter.test.ts`
covers toggle, shift-extend, clear, the Discuss together rule and `in council`; `node --check
scripts/cdp/council/tree.mjs`; `council-tree` and `council-needs-you` pass in the Final.
